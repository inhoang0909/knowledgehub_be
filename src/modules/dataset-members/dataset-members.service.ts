import { 
  Injectable, 
  NotFoundException, 
  ForbiddenException, 
  BadRequestException 
} from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { ValidationService } from '@common/services/validation.service';
import { User } from '@prisma/client';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

/**
 * @class DatasetMembersService
 * @description Service chuyên trách quản lý Phân quyền Thành viên trên Dataset (Dataset Access Control Management).
 * 
 * Luồng hoạt động chính:
 * 1. `getMembers`: Lấy danh sách thành viên trực tiếp (Direct Members) và thành viên thừa kế từ Phòng ban (Department Permissions),
 *    sử dụng HashMap khử trùng lặp và ưu tiên quyền chỉ định trực tiếp (Direct Role) đè lên quyền phòng ban.
 * 2. `addMember`: Hỗ trợ chiến lược "Find-or-Create" User theo mã nhân viên (`externalId`) từ SSO nếu user chưa tồn tại trong Local DB,
 *    sau đó gán quyền truy cập cá nhân vào Dataset.
 * 3. `updateMemberRole`: Cập nhật quyền hạn (Role: MANAGER, EDITOR, VIEWER) của thành viên. Bảo vệ Owner tuyệt đối không thể bị đổi quyền qua API này.
 * 4. `removeMember`: Xóa thành viên khỏi Dataset. Bảo vệ Owner và ngăn xóa trực tiếp nếu user đang thừa kế quyền qua phòng ban.
 */
@Injectable()
export class DatasetMembersService {
  constructor(
    private prisma: PrismaService,
    private validationService: ValidationService
  ) {}

  // =================================================================
  // 1. LẤY DANH SÁCH THÀNH VIÊN (HỢP NHẤT DIRECT + DEPARTMENT)
  // =================================================================
  /**
   * Lấy tổng hợp danh sách tất cả thành viên có quyền truy cập vào Dataset
   * 
   * @param datasetId ID của Dataset cần xem thành viên
   * @param currentUser User đang thực hiện request (cần quyền MANAGE)
   * @returns Danh sách thành viên hợp nhất kèm thông tin nguồn gốc quyền (`source`: 'DIRECT' | 'DEPARTMENT')
   */
  async getMembers(datasetId: number, currentUser: User) {
    // -----------------------------------------------------------------
    // BƯỚC 1: Kiểm tra quyền quản lý (MANAGE) của người dùng hiện tại
    // -----------------------------------------------------------------
    await this.validationService.validateDatasetAccess(datasetId, currentUser, 'MANAGE');

    // Lấy thông tin bối cảnh Category & Phòng ban sở hữu của Dataset
    const dataset = await this.prisma.dataset.findUnique({
      where: { id: datasetId },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            parentId: true,
            parent: {
              select: { id: true, name: true }
            },
            department: {
              select: { id: true, code: true, name: true }
            }
          }
        }
      }
    });

    // -----------------------------------------------------------------
    // BƯỚC 2: Truy vấn danh sách thành viên được gán trực tiếp (Direct Members)
    // -----------------------------------------------------------------
    const directMembers = await this.prisma.datasetMember.findMany({
      where: { datasetId },
      include: {
        user: {
          select: { id: true, username: true, email: true, departmentCode: true, role: true }
        }
      }
    });

    // -----------------------------------------------------------------
    // BƯỚC 3: Truy vấn danh sách thành viên thừa kế quyền qua Phòng ban (Dept Members)
    // -----------------------------------------------------------------
    const deptPermissions = await this.prisma.datasetDepartmentPermission.findMany({
      where: { datasetId },
      include: {
        department: {
          include: {
            users: { // Lấy tất cả user thuộc phòng ban được chia sẻ
               select: { id: true, username: true, email: true, departmentCode: true, role: true }
            }
          }
        }
      }
    });

    // -----------------------------------------------------------------
    // BƯỚC 4: Hợp nhất & Khử trùng lặp (Merge & Normalize)
    // Dùng HashMap `memberMap` để khử trùng lặp nếu User vừa có quyền trực tiếp vừa thuộc phòng ban được share.
    // Nguyên tắc: Quyền chỉ định trực tiếp (Direct Role) ưu tiên cao hơn quyền Phòng ban (Dept Role).
    // -----------------------------------------------------------------
    const memberMap = new Map<number, any>();

    // 4.1. Nạp danh sách thành viên từ Phòng ban vào Map trước (source = 'DEPARTMENT')
    for (const perm of deptPermissions) {
      for (const user of perm.department.users) {
        memberMap.set(user.id, {
          id: `dept-${perm.departmentId}-user-${user.id}`, // ID giả lập phục vụ UI Render Key
          userId: user.id,
          role: perm.role, // Vai trò thừa kế từ phòng ban (VD: VIEWER)
          source: 'DEPARTMENT', // Cờ báo hiệu Frontend không cho phép sửa/xóa trực tiếp dòng này
          departmentName: perm.department.name,
          user: user
        });
      }
    }

    // 4.2. Nạp danh sách thành viên trực tiếp vào Map (Ghi đè nếu đã tồn tại từ phòng ban)
    for (const member of directMembers) {
      memberMap.set(member.userId, {
        id: member.id, // ID thực trong bảng DatasetMember
        userId: member.userId,
        role: member.role,
        source: 'DIRECT', // Cờ báo hiệu Frontend cho phép sửa/xóa dòng này
        user: member.user
      });
    }

    return {
      members: Array.from(memberMap.values()),
      category: dataset?.category || null
    };
  }

  // =================================================================
  // 2. THÊM THÀNH VIÊN (INVITE / ADD MEMBER)
  // =================================================================
  /**
   * Thêm thành viên mới vào Dataset (Hỗ trợ logic "Find-or-Create" User theo mã SSO externalId)
   * 
   * @param datasetId ID Dataset
   * @param dto Dữ liệu thêm thành viên (`userId`, `externalId`, `username`, `role`)
   * @param currentUser User thực hiện yêu cầu
   */
  async addMember(datasetId: number, dto: AddMemberDto, currentUser: User) {
    // 1. Kiểm tra quyền MANAGE của người dùng hiện tại
    await this.validationService.validateDatasetAccess(datasetId, currentUser, 'MANAGE');

    let targetUserId = dto.userId;

    // 2. LOGIC "FIND OR CREATE" USER DỰA TRÊN EXTERNAL_ID (SSO Employee Code)
    // Nếu Client không truyền `userId` (ví dụ gõ mã nhân viên để tìm nhưng user chưa từng login hệ thống),
    // backend sẽ tự động tạo tài khoản User mới trong Local DB.
    if (!targetUserId) {
      if (!dto.externalId) {
        throw new BadRequestException('Thiếu thông tin externalId để thêm thành viên.');
      }

      // Upsert User theo mã nhân viên SSO externalId (VD: "00475")
      const user = await this.prisma.user.upsert({
        where: { externalId: dto.externalId },
        update: {}, 
        create: {
          externalId: dto.externalId,
          username: dto.externalId, 
          name: dto.username || dto.name || dto.externalId, // Fallback tên nhân viên
          role: 'MEMBER',
          isActive: true
        }
      });
      
      targetUserId = user.id; // Lấy ID tài khoản thật trong Local DB
    }

    // 3. Kiểm tra xem User đã là thành viên trực tiếp của Dataset chưa (Tránh trùng lặp)
    const existingMember = await this.prisma.datasetMember.findUnique({
      where: { 
        datasetId_userId: { datasetId, userId: targetUserId } 
      }
    });

    if (existingMember) {
      throw new BadRequestException(`User ${dto.username || targetUserId} đã là thành viên của Dataset này rồi.`);
    }

    // 4. Tạo bản ghi phân quyền trực tiếp trong bảng DatasetMember
    return this.prisma.datasetMember.create({
      data: {
        datasetId,
        userId: targetUserId,
        role: dto.role
      },
      include: { user: true }
    });
  }

  // =================================================================
  // 3. CẬP NHẬT QUYỀN (UPDATE MEMBER ROLE)
  // =================================================================
  /**
   * Thay đổi vai trò phân quyền (MANAGER, EDITOR, VIEWER) của thành viên
   * 
   * @param datasetId ID Dataset
   * @param targetUserId ID của thành viên cần sửa
   * @param dto Dữ liệu vai trò mới
   * @param currentUser User thực hiện yêu cầu
   */
  async updateMemberRole(datasetId: number, targetUserId: number, dto: UpdateMemberRoleDto, currentUser: User) {
    // 1. Gatekeeper: Kiểm tra quyền MANAGE
    await this.validationService.validateDatasetAccess(datasetId, currentUser, 'MANAGE');

    // 2. QUAN TRỌNG: Bảo vệ Chủ sở hữu (Dataset Owner)
    // Không ai được phép thay đổi quyền của Chủ sở hữu Dataset (kể cả Super Admin qua API này)
    const dataset = await this.prisma.dataset.findUnique({ where: { id: datasetId } });
    if (dataset.ownerId === targetUserId) {
      throw new ForbiddenException('Không thể thay đổi quyền của Owner (Chủ sở hữu).');
    }

    // 3. Upsert: Cập nhật nếu đã có bản ghi DIRECT, hoặc Tạo mới bản ghi DIRECT nếu user trước đó chỉ có quyền DEPT
    return await this.prisma.datasetMember.upsert({
      where: { datasetId_userId: { datasetId, userId: targetUserId } },
      update: { role: dto.role },
      create: {
        datasetId,
        userId: targetUserId,
        role: dto.role,
      },
    });
  }

  // =================================================================
  // 4. XÓA THÀNH VIÊN (REMOVE / KICK MEMBER)
  // =================================================================
  /**
   * Xóa quyền truy cập trực tiếp của thành viên khỏi Dataset
   * 
   * @param datasetId ID Dataset
   * @param targetUserId ID thành viên bị xóa
   * @param currentUser User thực hiện yêu cầu
   */
  async removeMember(datasetId: number, targetUserId: number, currentUser: User) {
    // 1. Gatekeeper: Kiểm tra quyền MANAGE
    await this.validationService.validateDatasetAccess(datasetId, currentUser, 'MANAGE');

    // 2. QUAN TRỌNG: Bảo vệ Chủ sở hữu (Dataset Owner)
    const dataset = await this.prisma.dataset.findUnique({ where: { id: datasetId } });
    if (dataset.ownerId === targetUserId) {
      throw new ForbiddenException('Không thể xóa Owner khỏi Dataset.');
    }

    // 3. Kiểm tra bản ghi phân quyền trực tiếp
    const member = await this.prisma.datasetMember.findUnique({
      where: { datasetId_userId: { datasetId, userId: targetUserId } }
    });

    if (!member) {
      // Nếu không tìm thấy bản ghi DIRECT, kiểm tra xem user có đang truy cập nhờ quyền Phòng ban không
      const targetUser = await this.prisma.user.findUnique({
        where: { id: targetUserId },
        select: { departmentCode: true }
      });
      if (targetUser?.departmentCode) {
        const deptPerm = await this.prisma.datasetDepartmentPermission.findFirst({
          where: { datasetId, department: { code: targetUser.departmentCode } }
        });
        if (deptPerm) {
          throw new BadRequestException('Thành viên có quyền truy cập thông qua Phòng ban. Không thể xóa trực tiếp khỏi Dataset.');
        }
      }
      throw new NotFoundException('Thành viên không tồn tại để xóa');
    }

    // 4. Xóa bản ghi phân quyền trực tiếp
    return await this.prisma.datasetMember.delete({
      where: { datasetId_userId: { datasetId, userId: targetUserId } }
    });
  }
}