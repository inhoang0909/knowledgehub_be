import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User, UserRole } from '@prisma/client';
import { CategoryValidationService } from './category-validation.service';
import { CategoryDatasetService } from './category-dataset.service';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { CreateCategoryDto } from '../dto/create-category.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';

/** Cấu hình mặc định các mối quan hệ được nạp kèm khi query Category */
const DEFAULT_CATEGORY_INCLUDE = {
  parent: true,
  department: { select: { id: true, code: true, name: true } },
  _count: { select: { datasets: true, subCategories: true } },
};

/**
 * @class CategoriesService
 * @description Service trung tâm quản lý cấu trúc Cây Thư mục Danh mục (Category Hierarchy) & Materialized Path.
 * 
 * Tính năng chính:
 * 1. Quản lý thư mục đa cấp vô hạn (Infinite Sub-categories) bằng mô hình Materialized Path (`/parent_id/child_id/`).
 * 2. Phân quyền theo Không gian Phòng ban (Home Department vs GLOBAL Space).
 * 3. Hỗ trợ trả về dạng Danh sách phẳng (Flat List) hoặc Cây thư mục (Hierarchical Tree) ghép kèm Datasets.
 * 4. Cập nhật dây chuyền (Cascade Path Update) khi di chuyển thư mục sang vị trí cha mới.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private prisma: PrismaService,
    private validationService: CategoryValidationService,
    private datasetService: CategoryDatasetService,
  ) {}

  // =================================================================
  // HELPER MỘT SỐ HÀM DÙNG NỘI BỘ
  // =================================================================

  /**
   * Định dạng lại dữ liệu Category trả về cho Client, chuyển đổi `_count` thành các cờ boolean & số đếm rõ ràng
   */
  private formatCategory(rawCategory: any) {
    if (!rawCategory) return null;
    const { _count, ...rest } = rawCategory;
    return {
      ...rest,
      hasChildren: _count?.subCategories > 0,
      datasetCount: _count?.datasets || 0,
    };
  }

  /**
   * Truy vấn danh sách Category từ DB phù hợp với quyền hạn của User
   * - Super Admin: Xem toàn bộ.
   * - Member/Manager: Xem danh mục phòng ban của mình + Danh mục chung (GLOBAL).
   */
  private async fetchCategoriesFromDB(user: User, rootPath?: string) {
    const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;

    let departmentId: number | undefined;
    if (!isSuperAdmin && user.departmentCode) {
      const department = await this.validationService.getValidDepartment(user);
      departmentId = department.id;
    }

    const orConditions: any[] = [{ department: { code: 'GLOBAL' } }];
    if (departmentId) {
      orConditions.push({ departmentId });
    }

    return this.prisma.category.findMany({
      where: {
        ...(isSuperAdmin ? {} : { OR: orConditions }),
        ...(rootPath ? { path: { startsWith: rootPath } } : {}),
      },
      include: DEFAULT_CATEGORY_INCLUDE,
      orderBy: { path: 'asc' } as any,
    });
  }

  /**
   * Xây dựng chuỗi Materialized Path cho Category (VD: `/1/5/12/`)
   */
  private async buildPath(
    newCategoryId: number,
    parentId: number | null,
  ): Promise<string> {
    if (!parentId) return `/${newCategoryId}/`;

    const parent = await this.prisma.category.findUnique({
      where: { id: parentId },
      select: { path: true },
    });

    return parent?.path
      ? `${parent.path}${newCategoryId}/`
      : `/${newCategoryId}/`;
  }

  // =================================================================
  // 1. TẠO CATEGORY MỚI
  // =================================================================
  /**
   * Tạo Category mới trong không gian phòng ban đích
   * 
   * @param dto Dữ liệu tạo category (name, description, departmentId, parentId)
   * @param user User tạo category
   */
  async create(dto: CreateCategoryDto, user: User) {
    const targetDepartment = await this.resolveTargetDepartment(dto, user);
    const normalizedParentId =
      typeof dto.parentId === 'number' && dto.parentId > 0 ? dto.parentId : null;

    // Validate tính hợp lệ của thư mục cha (cùng phòng ban, không tạo vòng lặp)
    await this.validationService.validateParent(
      normalizedParentId,
      targetDepartment.id,
    );

    // Bước 1: Insert bản ghi mới vào DB
    const newCategory = await this.prisma.category.create({
      data: {
        name: dto.name,
        description: dto.description,
        departmentId: targetDepartment.id,
        parentId: normalizedParentId ?? null,
      },
    });

    // Bước 2: Tạo Materialized Path dựa trên ID vừa sinh ra
    const newPath = await this.buildPath(newCategory.id, normalizedParentId);

    // Bước 3: Cập nhật lại cột `path`
    const finalCategory = await this.prisma.category.update({
      where: { id: newCategory.id },
      data: { path: newPath },
      include: DEFAULT_CATEGORY_INCLUDE,
    });

    return this.formatCategory(finalCategory);
  }

  /**
   * Xác định phòng ban đích khi tạo Category & Kiểm tra quyền hạn tương ứng
   */
  private async resolveTargetDepartment(dto: CreateCategoryDto, user: User) {
    if (!dto.departmentId) {
      return this.validationService.getValidDepartment(user);
    }

    const targetDepartment = await this.prisma.department.findUnique({
      where: { id: dto.departmentId },
    });
    if (!targetDepartment)
      throw new NotFoundException('Phòng ban đích không tồn tại');

    const isGlobalManager =
      targetDepartment.code === 'GLOBAL' &&
      targetDepartment.managerId === user.id;

    // Chặn tạo ở không gian GLOBAL nếu không phải Super Admin hoặc Manager của GLOBAL
    if (
      targetDepartment.code === 'GLOBAL' &&
      user.role !== UserRole.SUPER_ADMIN &&
      !isGlobalManager
    ) {
      throw new ForbiddenException(
        'Chỉ Super Admin hoặc Quản lý Không gian chung mới được tạo ở đây',
      );
    }

    // Chặn tạo ở phòng ban khác nếu không phải Super Admin
    if (
      targetDepartment.code !== 'GLOBAL' &&
      targetDepartment.code !== user.departmentCode &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Bạn không được phép tạo thư mục ở bộ phận khác',
      );
    }

    return targetDepartment;
  }

  // =================================================================
  // 2. LẤY DANH SÁCH PHẲNG (Flat List)
  // =================================================================
  async findAll(user: User, rootPath?: string) {
    const rawCategories = await this.fetchCategoriesFromDB(user, rootPath);
    return rawCategories.map((cat) => this.formatCategory(cat));
  }

  // =================================================================
  // 3. LẤY CÂY PHÂN CẤP (Tree View kèm Datasets)
  // =================================================================
  async getTree(user: User, rootPath?: string) {
    const rawCategories = await this.fetchCategoriesFromDB(user, rootPath);
    // Uỷ quyền gán Datasets hợp lệ & dựng Cây cho CategoryDatasetService
    return this.datasetService.getTree(rawCategories, user);
  }

  // =================================================================
  // 4. LẤY CHI TIẾT THEO ID
  // =================================================================
  async findOne(id: number, user: User) {
    await this.validationService.validateAndGetCategory(id, user, 'read');

    const rawCategory = await this.prisma.category.findUnique({
      where: { id },
      include: {
        ...DEFAULT_CATEGORY_INCLUDE,
        subCategories: {
          include: {
            _count: { select: { datasets: true, subCategories: true } },
          },
        },
        datasets: {
          where: { isDeleted: false },
          select: { id: true, name: true, description: true, createdAt: true },
        },
      },
    });

    if (!rawCategory) return null;

    const { _count, subCategories, ...rest } = rawCategory as any;

    return {
      ...rest,
      hasChildren: _count?.subCategories > 0,
      datasetCount: _count?.datasets || 0,
      subCategories: subCategories?.map((sub: any) => {
        const { _count: subCount, parent, department, ...subRest } = sub;
        return {
          ...subRest,
          hasChildren: subCount?.subCategories > 0,
          datasetCount: subCount?.datasets || 0,
        };
      }),
    };
  }

  // =================================================================
  // 5. CẬP NHẬT CATEGORY & CẬP NHẬT CHUỖI DÂY CHUYỀN (Cascade Path)
  // =================================================================
  async update(id: number, dto: UpdateCategoryDto, user: User) {
    const category = await this.validationService.validateAndGetCategory(
      id,
      user,
      'update',
    );

    const oldPath = category.path;
    const isChangingParent =
      dto.parentId !== undefined && dto.parentId !== category.parentId;

    let normalizedParentId: number | null | undefined = undefined;
    let newPath: string | undefined = undefined;

    if (isChangingParent) {
      normalizedParentId = dto.parentId > 0 ? dto.parentId : null;
      
      // Check chống vòng lặp (Circular Dependency) khi đổi thư mục cha
      await this.validationService.validateParent(
        normalizedParentId,
        category.departmentId,
        id,
        category.path,
      );
      newPath = await this.buildPath(id, normalizedParentId);
    }

    // Thực hiện Cập nhật trong Transaction để đảm bảo tính nhất quán chuỗi Materialized Path
    const updatedCategory = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({
        where: { id },
        data: {
          ...(dto.name && { name: dto.name }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          ...(isChangingParent && { parentId: normalizedParentId, path: newPath }),
        },
        include: DEFAULT_CATEGORY_INCLUDE,
      });

      // Nếu có di chuyển vị trí thư mục cha -> Cập nhật dây chuyền `path` cho TOÀN BỘ thư mục con cháu bên dưới
      if (isChangingParent && newPath && oldPath) {
        await tx.$executeRawUnsafe(
          `UPDATE "categories"
           SET "path" = REPLACE("path", $1, $2)
           WHERE "path" LIKE $3 AND "id" != $4`,
          oldPath,
          newPath,
          `${oldPath}%`,
          id,
        );
      }

      return updated;
    });

    return this.formatCategory(updatedCategory);
  }

  // =================================================================
  // 6. XÓA CATEGORY
  // =================================================================
  async remove(id: number, user: User) {
    // Validate trước khi xóa (Chặn xóa nếu đang có sub-categories hoặc datasets)
    await this.validationService.validateAndGetCategory(id, user, 'delete');
    return this.prisma.category.delete({ where: { id } });
  }
}