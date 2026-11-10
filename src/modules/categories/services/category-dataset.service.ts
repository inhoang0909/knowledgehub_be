import { Injectable } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { CategoryTreeService } from './category-tree.service';

/**
 * @class CategoryDatasetService
 * @description Service hỗ trợ gắn kết Datasets hợp lệ vào Cây Thư mục Danh mục (Category-Dataset Hydration).
 * 
 * Quy trình hoạt động:
 * 1. Truy vấn toàn bộ Datasets mà User có quyền truy cập (theo User ID, Phòng ban, hoặc GLOBAL Space).
 * 2. Phán quyết vai trò thực tế của User trên từng Dataset (Permission Resolution: MANAGER / EDITOR / VIEWER).
 * 3. Kiểm tra các Dataset nằm trong các Category thuộc phòng ban khác nhưng User được phân quyền.
 * 4. Truy vấn bổ sung các Category thiếu và toàn bộ Chuỗi Thư mục Tổ tiên (Ancestor Chain) để không bị đứt gãy Cây thư mục.
 * 5. Ghép Datasets vào các node Category tương ứng và nạp cho `CategoryTreeService` dựng cây hoàn chỉnh.
 */
@Injectable()
export class CategoryDatasetService {
  constructor(
    private prisma: PrismaService,
    private treeService: CategoryTreeService,
  ) {}

  /**
   * Dựng Cây Thư mục hoàn chỉnh được nạp đầy đủ các Datasets có quyền truy cập
   * 
   * @param rawCategories Mảng các category đã query ban đầu theo phòng ban User & GLOBAL
   * @param user User thực hiện request
   * @returns Bối cảnh cây hoàn chỉnh `{ categories: Tree, rootDatasets: [...] }`
   */
  async getTree(rawCategories: any[], user: User) {
    const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;

    // -----------------------------------------------------------------
    // BƯỚC 1: Lấy toàn bộ Datasets mà User được phép xem
    // -----------------------------------------------------------------
    const allowedDatasets = await this.fetchAllowedDatasets(user, isSuperAdmin);

    const datasetsWithPermission = allowedDatasets.map((ds) =>
      this.resolveDatasetPermission(ds, user, isSuperAdmin),
    );

    // -----------------------------------------------------------------
    // BƯỚC 2: Map các Category đã có sẵn từ DB
    // -----------------------------------------------------------------
    const existingCategoryMap = new Map<number, any>(
      (rawCategories || []).map((c) => [c.id, c]),
    );

    // -----------------------------------------------------------------
    // BƯỚC 3: Lọc các Category ID của Dataset mà chưa có trong existingCategoryMap
    // -----------------------------------------------------------------
    const datasetCategoryIds = Array.from(
      new Set(
        datasetsWithPermission
          .map((ds) => ds.categoryId)
          .filter((id): id is number => id !== null && id !== undefined),
      ),
    );

    const missingCategoryIds = datasetCategoryIds.filter(
      (id) => !existingCategoryMap.has(id),
    );

    // -----------------------------------------------------------------
    // BƯỚC 4: Truy vấn bổ sung các Category thiếu & Chuỗi thư mục tổ tiên (Ancestors)
    // -----------------------------------------------------------------
    if (missingCategoryIds.length > 0) {
      const additionalCategories = await this.prisma.category.findMany({
        where: { id: { in: missingCategoryIds } },
        include: {
          parent: true,
          department: { select: { id: true, code: true, name: true } },
          _count: { select: { datasets: true, subCategories: true } },
        },
      });

      // Tách chuỗi Materialized Path để lấy tất cả ID của thư mục tổ tiên
      const allAncestorIds = new Set<number>();
      for (const cat of additionalCategories) {
        if (cat.path) {
          const parts = cat.path.split('/').filter(Boolean).map(Number);
          parts.forEach((id) => {
            if (!isNaN(id)) allAncestorIds.add(id);
          });
        } else {
          allAncestorIds.add(cat.id);
        }
      }

      const ancestorIdsToFetch = Array.from(allAncestorIds).filter(
        (id) => !existingCategoryMap.has(id),
      );

      if (ancestorIdsToFetch.length > 0) {
        const ancestorCategories = await this.prisma.category.findMany({
          where: { id: { in: ancestorIdsToFetch } },
          include: {
            parent: true,
            department: { select: { id: true, code: true, name: true } },
            _count: { select: { datasets: true, subCategories: true } },
          },
        });

        for (const cat of ancestorCategories) {
          existingCategoryMap.set(cat.id, cat);
        }
      }
    }

    const allCategoriesList = Array.from(existingCategoryMap.values());

    // -----------------------------------------------------------------
    // BƯỚC 5: Gán các Datasets hợp lệ vào mảng `datasets` của từng Category tương ứng
    // -----------------------------------------------------------------
    const rawCategoriesWithDatasets = allCategoriesList.map((cat) => ({
      ...cat,
      datasets: datasetsWithPermission.filter(
        (ds) => ds.categoryId === cat.id,
      ),
    }));

    // -----------------------------------------------------------------
    // BƯỚC 6: Dựng Cây thư mục hoàn chỉnh
    // -----------------------------------------------------------------
    const categoryTree = this.treeService.buildTreeStructure(
      rawCategoriesWithDatasets,
    );

    // Lọc các Dataset không nằm trong Category nào (Dataset ở cấp Root)
    const allCategoryIdsSet = new Set(allCategoriesList.map((c) => c.id));
    const rootDatasets = datasetsWithPermission.filter(
      (ds) => !ds.categoryId || !allCategoryIdsSet.has(ds.categoryId),
    );

    return {
      categories: categoryTree,
      rootDatasets: rootDatasets,
    };
  }

  /**
   * Query toàn bộ Dataset mà User được phép truy cập từ Prisma
   */
  private async fetchAllowedDatasets(user: User, isSuperAdmin: boolean) {
    const datasetWhere: any = {
      isDeleted: false,
    };

    if (!isSuperAdmin) {
      datasetWhere.OR = this.buildAccessConditions(user);
    }

    return this.prisma.dataset.findMany({
      where: datasetWhere,
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        categoryId: true,
        createdBy: { select: { id: true, username: true, email: true } },
        owner: { select: { id: true, departmentCode: true } },
        departmentPermissions: { include: { department: true } },
        members: { where: { userId: user.id } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Xây dựng điều kiện OR truy cập cho người dùng thường
   */
  private buildAccessConditions(user: User): any[] {
    const conditions: any[] = [
      // Được mời trực tiếp với tư cách thành viên cá nhân
      { members: { some: { userId: user.id } } },
      // Dataset nằm trong không gian GLOBAL
      { category: { department: { code: 'GLOBAL' } } },
    ];

    if (user.departmentCode) {
      // Dataset được phân quyền cho cả phòng ban
      conditions.push({
        departmentPermissions: {
          some: { department: { code: user.departmentCode } },
        },
      });
      // Dataset thuộc sở hữu của phòng ban User
      conditions.push({ owner: { departmentCode: user.departmentCode } });
    }

    return conditions;
  }

  /**
   * Phán quyết vai trò phân quyền hiệu lực (`permission_type`) cho từng Dataset
   */
  private resolveDatasetPermission(
    ds: any,
    user: User,
    isSuperAdmin: boolean,
  ) {
    const ROLE_WEIGHT: Record<string, number> = {
      MANAGER: 3,
      EDITOR: 2,
      VIEWER: 1,
      NULL: 0,
    };

    let role = 'VIEWER';

    if (isSuperAdmin || ds.owner?.departmentCode === user.departmentCode) {
      role = 'MANAGER';
    } else {
      const memberPerm = ds.members[0];
      const deptPerm = ds.departmentPermissions.find(
        (dp: any) => dp.department.code === user.departmentCode,
      );

      const mWeight = ROLE_WEIGHT[memberPerm?.role ?? 'NULL'];
      const dWeight = ROLE_WEIGHT[deptPerm?.role ?? 'NULL'];

      if (mWeight > 0 || dWeight > 0) {
        role = mWeight >= dWeight ? memberPerm!.role : deptPerm!.role;
      }
    }

    // Loại bỏ các trường phục vụ tính toán quyền trước khi trả về client
    const { owner, departmentPermissions, members, ...cleanDs } = ds;
    return { ...cleanDs, permission_type: role };
  }
}
