import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { ValidationService } from "@common/services/validation.service";
import { DatasetRole, User, UserRole } from "@prisma/client";

/**
 * @class DatasetAdminService
 * @description Service chuyên trách các thao tác QUẢN TRỊ CAO CẤP trên Dataset (Admin Operations).
 * 
 * Luồng hoạt động chính:
 * 1. `findAllWithPermissions`: Dành riêng cho Super Admin — Lấy toàn bộ danh sách Datasets kèm mảng phân quyền các Phòng ban (`departmentPermissions`) và danh sách thành viên trực tiếp (`members`).
 * 2. `updateDeptPermission`: Dành riêng cho Super Admin — Cập nhật hoặc Thu hồi (`role = null`) quyền truy cập của cả một Phòng ban trên Dataset.
 *    - Nếu cấp mới/thay đổi role: Tự động upsert `DatasetDepartmentPermission` và đồng bộ phân quyền trực tiếp `DatasetMember` cho toàn bộ nhân viên active thuộc phòng ban đó.
 *    - Nếu xóa role: Thu hồi `DatasetDepartmentPermission` và tự động xóa phân quyền direct của các nhân viên thuộc phòng ban đó.
 * 3. `transferOwnership`: Chuyển giao quyền Chủ sở hữu Dataset (`ownerId`) cho một tài khoản User khác đang hoạt động (`isActive = true`).
 */
@Injectable()
export class DatasetAdminService {
  constructor(
    private prisma: PrismaService,
    private validationService: ValidationService
  ) {}

  // =====================================================
  // 1. TỔNG QUAN TẤT CẢ DATASETS + PHÂN QUYỀN (SUPER ADMIN)
  // =====================================================
  /**
   * Lấy tất cả Datasets và phân quyền phòng ban chi tiết (Chỉ dành cho Super Admin)
   * 
   * @param user User hiện tại thực hiện request (Yêu cầu `UserRole.SUPER_ADMIN`)
   */
  async findAllWithPermissions(user: User) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException("Chỉ Super Admin mới có quyền xem toàn bộ phân quyền");
    }

    const datasets = await this.prisma.dataset.findMany({
      where: { isDeleted: false },
      include: {
        departmentPermissions: {
          select: {
            departmentId: true,
            role: true,
            department: {
              select: { id: true, name: true, code: true },
            },
          },
        },
        members: {
          include: {
            user: {
              select: { id: true, email: true, username: true },
            },
          },
        },
        owner: {
          select: { id: true, email: true, username: true },
        },
        createdBy: {
          select: { id: true, email: true, username: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Chuẩn hóa response theo format phẳng (flatten departmentPermissions -> permissions)
    return datasets.map((ds) => ({
      ...ds,
      permissions: ds.departmentPermissions.map((dp) => ({
        departmentId: dp.departmentId,
        role: dp.role, // VIEWER | EDITOR | MANAGER
        departmentName: dp.department.name,
        departmentCode: dp.department.code,
      })),
    }));
  }

  // =====================================================
  // 2. CẬP NHẬT / THU HỒI PHÂN QUYỀN PHÒNG BAN (SUPER ADMIN)
  // =====================================================
  /**
   * Cập nhật hoặc Thu hồi quyền truy cập của cả một Phòng ban trên Dataset
   * 
   * @param datasetId ID Dataset
   * @param departmentId ID Phòng ban
   * @param role Vai trò mới (`DatasetRole` hoặc `null` nếu muốn thu hồi)
   * @param user User hiện tại thực hiện request (Yêu cầu Super Admin)
   */
  async updateDeptPermission(
    datasetId: number,
    departmentId: number,
    role: DatasetRole | null,
    user: User
  ) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException("Chỉ Super Admin mới có quyền thay đổi phân quyền phòng ban");
    }

    // -----------------------------------------------------------------
    // TRƯỜNG HỢP 1: Thu hồi quyền (Nếu role = null hoặc gửi NONE từ Frontend)
    // -----------------------------------------------------------------
    if (!role) {
      // 1. Xóa bản ghi phân quyền phòng ban
      await this.prisma.datasetDepartmentPermission.deleteMany({
        where: {
          datasetId,
          departmentId,
        },
      });

      // 2. Tự động xóa các bản ghi phân quyền trực tiếp (Direct Members) thuộc phòng ban đó
      const department = await this.prisma.department.findUnique({
        where: { id: departmentId },
        select: { code: true }
      });

      if (department) {
        await this.prisma.datasetMember.deleteMany({
          where: {
            datasetId,
            user: {
              departmentCode: department.code
            }
          }
        });
      }

      return { message: "Thu hồi quyền phòng ban thành công", datasetId, departmentId, role: null };
    }

    // -----------------------------------------------------------------
    // TRƯỜNG HỢP 2: Cấp mới / Cập nhật quyền cho Phòng ban
    // -----------------------------------------------------------------
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      include: {
        users: {
          where: { isActive: true },
          select: { id: true }
        }
      }
    });
    if (!department) throw new NotFoundException("Phòng ban không tồn tại");

    // Upsert quyền phòng ban trong bảng DatasetDepartmentPermission
    const permission = await this.prisma.datasetDepartmentPermission.upsert({
      where: {
        datasetId_departmentId: { datasetId, departmentId },
      },
      update: { role },
      create: {
        datasetId,
        departmentId,
        role,
      },
      include: {
        department: { select: { id: true, name: true, code: true } },
      },
    });

    // Tự động đồng bộ phân quyền cho toàn bộ nhân viên active thuộc phòng ban
    const existingMembers = await this.prisma.datasetMember.findMany({
      where: {
        datasetId,
        userId: { in: department.users.map(u => u.id) }
      },
      select: { userId: true }
    });

    const existingMemberIds = new Set(existingMembers.map(m => m.userId));
    const newMembers = department.users.filter(u => !existingMemberIds.has(u.id));

    // Thêm các nhân viên chưa có bản ghi direct
    if (newMembers.length > 0) {
      await this.prisma.datasetMember.createMany({
        data: newMembers.map(u => ({
          datasetId,
          userId: u.id,
          role: role
        })),
        skipDuplicates: true
      });
    }

    // Cập nhật lại role của các nhân viên đã có bản ghi direct
    if (existingMembers.length > 0) {
      await Promise.all(
        existingMembers.map(member =>
          this.prisma.datasetMember.update({
            where: {
              datasetId_userId: { datasetId, userId: member.userId }
            },
            data: { role: role }
          })
        )
      );
    }

    return permission;
  }

  // =====================================================
  // 3. CHUYỂN GIAO QUYỀN SỞ HỮU (TRANSFER OWNERSHIP)
  // =====================================================
  /**
   * Chuyển giao quyền Owner của Dataset cho tài khoản User khác
   * 
   * @param datasetId ID Dataset
   * @param newOwnerId ID của User chủ sở hữu mới
   * @param user User hiện tại thực hiện request (Cần quyền MANAGE)
   */
  async transferOwnership(
    datasetId: number,
    newOwnerId: number,
    user: User
  ) {
    // 1. Kiểm tra quyền MANAGE trên Dataset
    await this.validationService.validateDatasetAccess(
      datasetId,
      user,
      "MANAGE"
    );

    // 2. Validate tài khoản Owner mới
    const newOwner = await this.prisma.user.findUnique({
      where: { id: newOwnerId },
    });
    if (!newOwner) throw new NotFoundException("Người dùng mới không tồn tại");
    if (!newOwner.isActive) {
      throw new ForbiddenException("Tài khoản người dùng mới đang bị vô hiệu hóa");
    }

    // 3. Cập nhật Owner mới trong bảng Dataset
    return this.prisma.dataset.update({
      where: { id: datasetId },
      data: { ownerId: newOwnerId },
      include: {
        owner: { select: { id: true, email: true, username: true } },
      },
    });
  }
}