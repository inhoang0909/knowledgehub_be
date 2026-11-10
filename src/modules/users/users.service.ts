import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-users.dto';
import { User, UserRole } from '@prisma/client';
import axios from 'axios';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) { }

  async findAll() {

    const whereCondition: any = {};

    const users = await this.prisma.user.findMany({
      where: whereCondition,
      include: {
        department: true, // Lấy tên phòng ban
      },
      orderBy: { createdAt: 'desc' },
    });

    return users;
  }

  // 2. Xem chi tiết 1 User
  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        department: true,
        _count: { // Đếm số lượng tài nguyên họ đã tạo
          select: {
            createdDatasets: true,
            createdSegments: true // Track segments created by user
          }
        }
      },
    });

    if (!user) throw new NotFoundException('User không tồn tại');
    return user;
  }

  // 3. Cập nhật User (Role, Dept, Active)
  async update(id: number, dto: UpdateUserDto, currentUser: User) {
    // 1. Tìm User
    const userToUpdate = await this.prisma.user.findUnique({
      where: { id },
      include: { ownedDatasets: true } // check dataset logic
    });
    if (!userToUpdate) throw new NotFoundException('User không tồn tại');

    // 2. Kiểm tra phân quyền đối với DEPT_MANAGER
    if (currentUser.role === UserRole.DEPT_MANAGER) {
      // DEPT_MANAGER chỉ được phép chỉnh sửa user trong cùng phòng ban với mình
      if (userToUpdate.departmentCode !== currentUser.departmentCode) {
        throw new ForbiddenException('Bạn chỉ có quyền quản lý người dùng thuộc phòng ban của mình.');
      }
      // DEPT_MANAGER không được chỉnh sửa tài khoản Super Admin
      if (userToUpdate.role === UserRole.SUPER_ADMIN) {
        throw new ForbiddenException('Bạn không có quyền chỉnh sửa tài khoản Super Admin.');
      }
      // DEPT_MANAGER không được thăng chức người dùng lên Super Admin
      if (dto.role === UserRole.SUPER_ADMIN) {
        throw new ForbiddenException('Bạn không có quyền thăng chức người dùng lên Super Admin.');
      }
    }

    // 3. Bảo vệ Trưởng phòng (DEPT_MANAGER) cuối cùng của phòng ban
    const isCurrentlyActiveDeptManager =
      userToUpdate.role === UserRole.DEPT_MANAGER && userToUpdate.isActive === true;

    const willLoseActiveDeptManagerRole =
      isCurrentlyActiveDeptManager &&
      ((dto.role !== undefined && dto.role !== UserRole.DEPT_MANAGER) ||
       (dto.isActive !== undefined && dto.isActive === false) ||
       (dto.departmentCode !== undefined && dto.departmentCode !== userToUpdate.departmentCode));

    if (willLoseActiveDeptManagerRole && userToUpdate.departmentCode) {
      const otherActiveDeptManagers = await this.prisma.user.count({
        where: {
          departmentCode: userToUpdate.departmentCode,
          role: UserRole.DEPT_MANAGER,
          isActive: true,
          id: { not: userToUpdate.id },
        },
      });

      if (otherActiveDeptManagers === 0) {
        throw new BadRequestException(
          'Phòng ban phải có ít nhất 1 Trưởng phòng (Dept Manager) đang hoạt động. Không thể giáng chức hoặc vô hiệu hóa Trưởng phòng cuối cùng.',
        );
      }
    }

    // 4. Xử lý gán/gỡ quyền Trưởng phòng (Department Manager) trong Transaction
    return this.prisma.$transaction(async (tx) => {
      // A. Cập nhật bảng User trước
      const updatedUser = await tx.user.update({
        where: { id },
        data: {
          role: dto.role,
          isActive: dto.isActive,
          departmentCode: dto.departmentCode
        },
        include: { department: true }
      });

      // B. Xử lý Side-effect cho bảng Department
      // Trường hợp 1: Thăng chức lên DEPT_MANAGER
      if (dto.role === UserRole.DEPT_MANAGER && userToUpdate.role !== UserRole.DEPT_MANAGER) {
        if (updatedUser.departmentCode) {
          // Gán user này làm manager của phòng ban đó
          await tx.department.update({
            where: { code: updatedUser.departmentCode },
            data: { managerId: updatedUser.id }
          });
        } else {
          throw new BadRequestException("Không thể thăng chức Manager cho user không thuộc phòng ban nào.");
        }
      }

      // Trường hợp 2: Bị giáng chức từ DEPT_MANAGER xuống MEMBER (hoặc role khác)
      if (userToUpdate.role === UserRole.DEPT_MANAGER && dto.role && dto.role !== UserRole.DEPT_MANAGER) {
        // Nếu user này đang đứng tên quản lý phòng ban nào đó, hãy gỡ ra
        await tx.department.updateMany({
          where: { managerId: userToUpdate.id },
          data: { managerId: null }
        });
      }

      return updatedUser;
    });
  }

  // Helper cho API toggle nhanh status
  async toggleStatus(id: number, isActive: boolean, currentUser: User) {
    return this.update(id, { isActive }, currentUser);
  }

  // 4. Get owned datasets by user
  async getOwnedDatasets(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        ownedDatasets: {
          where: { isDeleted: false },
          select: {
            id: true,
            name: true,
            description: true,
            difyDatasetId: true,
            createdAt: true,
            createdBy: {
              select: { id: true, username: true, email: true }
            }
          }
        }
      }
    });

    if (!user) throw new NotFoundException('User không tồn tại');
    return user.ownedDatasets;
  }

  async searchExternalUsers(keyword: string) {
    // 1. Gọi API tìm kiếm nhân viên từ hệ thống bên ngoài
    const externalSearchUrl =
      process.env.EXTERNAL_USER_SEARCH_URL ||
      'http://localhost:8000/api/emp/getAllEmployeeBySearch';
    const response = await axios.post(externalSearchUrl, {
      chunk: keyword // Gửi body { keyword: "..." }
    });

    // Nếu API trả về dạng { params: ... } thì giữ nguyên code của bạn, 
    // nhưng thường axios.post tham số thứ 2 là body data luôn.

    const externalUsers = response.data;

    // 2. Map dữ liệu về format thống nhất
    // Không cần check DB ở đây nữa
    return externalUsers.map(extUser => ({
      externalId: extUser.empno,         // Key quan trọng nhất để định danh
      username: extUser.name,   // Key để login/hiển thị
    }));
  }

  /**
   * DEPT_MANAGER: Lấy danh sách user trong phòng ban do mình quản lý.
   *
   * - Trả về tất cả users thuộc department (đã tồn tại trong DB).
   * - Nếu `onlyLoggedIn = true`: chỉ lấy những user đã từng đăng nhập
   *   (lastLoginAt != null).
   * - Throws ForbiddenException nếu manager chưa được gán vào phòng ban.
   */
  async findMyDepartmentUsers(currentUser: User) {
    // 1. Kiểm tra manager có thuộc phòng ban nào không
    if (!currentUser.departmentCode) {
      throw new ForbiddenException(
        'Bạn chưa được gán vào phòng ban nào. Vui lòng liên hệ Super Admin.',
      );
    }

    // 2. Xác nhận phòng ban tồn tại và user này đang là manager
    const department = await this.prisma.department.findUnique({
      where: { code: currentUser.departmentCode },
      select: { id: true, code: true, name: true, managerId: true },
    });

    if (!department) {
      throw new NotFoundException(
        `Phòng ban "${currentUser.departmentCode}" không tồn tại.`,
      );
    }

    // Optional: chỉ cho phép đúng manager của phòng ban đó xem
    if (
      currentUser.role === UserRole.DEPT_MANAGER &&
      department.managerId !== currentUser.id
    ) {
      throw new ForbiddenException(
        'Bạn không phải trưởng phòng của phòng ban này.',
      );
    }

    // 3. Lấy danh sách user
    const users = await this.prisma.user.findMany({
      where: { departmentCode: currentUser.departmentCode }, // Chuyển thẳng condition vào đây cho gọn
      select: {
        id: true,
        externalId: true,
        username: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        departmentCode: true,
        department: {
          select: { code: true, name: true },
        },
      },
      orderBy: [
        { role: 'asc' },      // Manager lên trước
        { name: 'asc' },
      ],
    });

    return {
      department: {
        code: department.code,
        name: department.name,
      },
      total: users.length,
      users,
    };
  }
}