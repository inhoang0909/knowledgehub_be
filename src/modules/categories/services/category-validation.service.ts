import { PrismaService } from '@/modules/prisma/prisma.service';
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';

/**
 * @class CategoryValidationService
 * @description Service xác thực quyền truy cập Category & Kiểm tra ràng buộc cấu trúc cây (Hierarchy Constraints).
 * 
 * Các nhiệm vụ kiểm tra chính:
 * 1. Phân quyền READ / UPDATE / DELETE trên Category dựa trên bối cảnh Phòng ban & Quản lý Không gian GLOBAL.
 * 2. Kiểm tra tính hợp lệ của Phòng ban gán cho Category.
 * 3. Kiểm tra ràng buộc khi Xóa (Ngăn xóa thư mục nếu đang có sub-categories hoặc datasets bên trong).
 * 4. Phát hiện & Ngăn chặn Lỗi Vòng lặp Cây thư mục (Circular Dependency Detection) bằng chuỗi Materialized Path.
 */
@Injectable()
export class CategoryValidationService {
  constructor(private prisma: PrismaService) {}

  /**
   * Lấy thông tin phòng ban hợp lệ của User (Dùng khi tạo danh mục mặc định)
   */
  async getValidDepartment(user: User) {
    if (!user.departmentCode) { 
      throw new ForbiddenException('User chưa được gán phòng ban');
    }
    const department = await this.prisma.department.findUnique({
      where: { code: user.departmentCode },
    });
    if (!department) throw new NotFoundException('Không tìm thấy phòng ban của User');
    return department;
  }

  // =================================================================
  // GATEKEEPER CHO CÁC THAO TÁC READ / UPDATE / DELETE CATEGORY
  // =================================================================
  /**
   * Kiểm tra quyền truy cập và trả về thông tin Category nếu hợp lệ
   * 
   * @param id ID của Category
   * @param user User đang thực hiện request
   * @param action Hành động muốn thực hiện ('read' | 'update' | 'delete')
   * @returns Entity Category đã kèm theo thông tin phòng ban và số đếm con
   */
  async validateAndGetCategory(id: number, user: User, action: 'read' | 'update' | 'delete') {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { department: true, _count: { select: { datasets: true, subCategories: true } } },
    });
    
    if (!category) throw new NotFoundException('Category không tồn tại');

    // Các biến cờ (Flags) hỗ trợ phân quyền
    const isGlobal = category.department.code === 'GLOBAL';
    const isGlobalManager = isGlobal && category.department.managerId === user.id;
    const isSameDept = user.departmentCode === category.department.code;
    const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;

    // -----------------------------------------------------------------
    // 1. Phân quyền cho hành động XEM (READ)
    // -----------------------------------------------------------------
    if (action === 'read') {
      // Ai cũng có quyền xem GLOBAL. Nếu là danh mục bộ phận thì phải cùng phòng ban hoặc Super Admin
      if (!isGlobal && !isSameDept && !isSuperAdmin) {
        throw new ForbiddenException('Bạn không có quyền xem Category của phòng ban khác');
      }
    }

    // -----------------------------------------------------------------
    // 2. Phân quyền cho hành động SỬA (UPDATE)
    // -----------------------------------------------------------------
    if (action === 'update') {
      if (isGlobal) {
        if (!isSuperAdmin && !isGlobalManager) {
          throw new ForbiddenException('Chỉ Super Admin hoặc Quản lý Không gian chung (GLOBAL) mới được sửa');
        }
      } else {
        if (!isSameDept && !isSuperAdmin) {
          throw new ForbiddenException('Bạn không được phép sửa Category của phòng ban khác');
        }
      }
    }

    // -----------------------------------------------------------------
    // 3. Phân quyền cho hành động XÓA (DELETE)
    // -----------------------------------------------------------------
    if (action === 'delete') {
      if (isGlobal) {
        if (!isSuperAdmin && !isGlobalManager) {
          throw new ForbiddenException('Chỉ Super Admin hoặc Quản lý Không gian chung (GLOBAL) mới được xóa');
        }
      } else {
        if (!isSameDept && !isSuperAdmin) {
          throw new ForbiddenException('Bạn không được phép xóa Category của phòng ban khác');
        }
        // Xóa ở phòng ban nội bộ: Yêu cầu Trưởng phòng (DEPT_MANAGER) hoặc Super Admin
        if (!isSuperAdmin && user.role !== UserRole.DEPT_MANAGER) {
          throw new ForbiddenException('Chỉ Department Manager hoặc Super Admin mới có quyền xóa Category');
        }
      }

      // Kiểm tra ràng buộc tính toàn vẹn dữ liệu trước khi xóa (Bảo vệ dữ liệu)
      if (category._count.datasets > 0) {
        throw new BadRequestException(`Không thể xóa Category đang chứa ${category._count.datasets} dataset.`);
      }
      if (category._count.subCategories > 0) {
        throw new BadRequestException(`Không thể xóa Category đang chứa ${category._count.subCategories} thư mục con.`);
      }
    }

    return category;
  }

  // =================================================================
  // VALIDATE LUỒNG CHA CON & NGĂN CHẶN CIRCULAR DEPENDENCY
  // =================================================================
  /**
   * Kiểm tra tính hợp lệ của Thư mục cha (Parent Category)
   * 
   * @param parentId ID của thư mục cha mới
   * @param departmentId ID phòng ban của thư mục hiện tại
   * @param currentCategoryId (Optional) ID của thư mục hiện tại (khi Update)
   * @param currentCategoryPath (Optional) Path hiện tại của thư mục (khi Update)
   */
  async validateParent(parentId: number | null, departmentId: number, currentCategoryId?: number, currentCategoryPath?: string) {
    if (!parentId) return;

    // Chặn gán chính nó làm cha của chính nó
    if (currentCategoryId && parentId === currentCategoryId) {
      throw new BadRequestException('Category không thể làm cha của chính nó');
    }

    const parent = await this.prisma.category.findUnique({ where: { id: parentId } });
    if (!parent) throw new NotFoundException('Category cha không tồn tại');

    // Chặn liên kết thư mục giữa hai phòng ban khác nhau
    if (parent.departmentId !== departmentId) {
      throw new ForbiddenException('Category cha phải thuộc cùng một không gian / phòng ban');
    }

    // Algorithmic Optimization: Kiểm tra Lỗi Vòng lặp (Circular Dependency) qua chuỗi Materialized Path
    if (currentCategoryId && currentCategoryPath) {
      // Nếu Materialized Path của thư mục cha MỚI có chứa ID của thư mục HIỆN TẠI
      // => Nghĩa là đang biến thư mục con/cháu thành thư mục cha => Lỗi vòng lặp!
      if (parent.path.includes(`/${currentCategoryId}/`)) {
        throw new BadRequestException('Cấu trúc cây bị lỗi vòng lặp (Không thể lấy thư mục con làm thư mục cha)');
      }
    }
  }

}