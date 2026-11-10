import { DifyClientService } from "@/modules/dify-client/dify-client.service";
import { PrismaService } from "@/modules/prisma/prisma.service";
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ValidationService } from "@common/services/validation.service";
import { CreateDatasetDto } from "../dto/create-dataset.dto";
import { User } from "@prisma/client";
import { UpdateSchemaDto } from "../dto/update-schema.dto";

/**
 * @class DatasetWriterService
 * @description Service chuyên trách các thao tác GHI / THAY ĐỔI DỮ LIỆU Dataset (Write Operations).
 * 
 * Luồng hoạt động chính:
 * 1. `create`:
 *    - Chuẩn hóa tên Dataset theo chuỗi thư mục tổ tiên (`RootCat-SubCat-BaseName`).
 *    - Gọi Dify Open API khởi tạo Dataset trên Dify trước.
 *    - Lưu bản ghi vào Local Prisma DB, tự động gán quyền `MANAGER` trực tiếp cho Người tạo (Creator/Owner),
 *      và cấp quyền `VIEWER` cho cả Phòng ban khởi tạo.
 *    - Nếu quá trình lưu DB thất bại, tự động dọn dẹp (Rollback Cleanup) xóa Dataset trên Dify để tránh dữ liệu mồ côi (Orphan Data).
 * 2. `updateSchema`: Cập nhật cấu hình Schema trường tùy chỉnh (Schema Config) cho Dataset.
 * 3. `remove`:
 *    - Gatekeeper với cờ `DELETE_DATASET` (Chỉ Super Admin, Owner, hoặc Dept Manager của phòng ban mới có quyền xóa).
 *    - Gọi Dify API xóa remote dataset.
 *    - Thực thi Hard Delete xóa dây chuyền các bản ghi `Segment` và `Document` trong Local DB.
 */
@Injectable()
export class DatasetWriterService {
  constructor(
    private prisma: PrismaService,
    private difyService: DifyClientService,
    private validationService: ValidationService,
  ) {}

  /** Chuẩn hóa từng phần của tên Dataset (thay khoảng trắng bằng dấu gạch ngang) */
  private normalizeNamePart(part: string): string {
    return part.trim().replace(/\s+/g, "-").replace(/-+/g, "-");
  }

  /**
   * Tạo tên Dataset có kèm Tiền tố Chuỗi Thư mục Tổ tiên (Materialized Category Prefix)
   * Ví dụ: Category "Pháp lý" -> SubCategory "Hợp đồng" -> Dataset "Năm 2026"
   * => Tên hiển thị trên Dify: "Phap-ly-Hop-dong-Nam-2026"
   */
  private async buildDatasetNameWithCategoryPrefix(
    categoryId: number,
    baseName: string,
    departmentId: number,
  ): Promise<string> {
    const leafCategory = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: {
        id: true,
        name: true,
        parentId: true,
        departmentId: true,
      },
    });

    if (!leafCategory) {
      throw new NotFoundException("Category không tồn tại");
    }

    if (leafCategory.departmentId !== departmentId) {
      throw new ForbiddenException("Category không thuộc về phòng ban của bạn");
    }

    const categoryNames: string[] = [leafCategory.name];
    const visitedIds = new Set<number>([leafCategory.id]);
    let currentParentId = leafCategory.parentId;

    // Duyệt ngược lên thư mục gốc để lấy tên toàn bộ thư mục cha
    while (currentParentId) {
      if (visitedIds.has(currentParentId)) {
        break; // Ngăn lặp vô tận nếu gãy cây
      }

      const parentCategory = await this.prisma.category.findUnique({
        where: { id: currentParentId },
        select: {
          id: true,
          name: true,
          parentId: true,
        },
      });

      if (!parentCategory) {
        break;
      }

      categoryNames.unshift(parentCategory.name);
      visitedIds.add(parentCategory.id);
      currentParentId = parentCategory.parentId;
    }

    // Ghép tên các danh mục + tên gốc của dataset
    return [...categoryNames, baseName]
      .map((part) => this.normalizeNamePart(part))
      .filter(Boolean)
      .join("-");
  }

  // =================================================================
  // 1. POST /api/datasets (TẠO MỚI DATASET DUAL-PHASE)
  // =================================================================
  /**
   * Tạo mới Dataset trên Dify Engine và Lưu bản ghi vào Local DB
   * 
   * @param user User hiện tại thực hiện request
   * @param dto Dữ liệu tạo Dataset (`name`, `description`, `categoryId`, `schemaConfig`)
   */
  async create(user: any, dto: CreateDatasetDto) {
    if (!user.departmentCode) {
      throw new ForbiddenException(
        "User chưa thuộc phòng ban nào, không thể tạo Dataset",
      );
    }

    const department = await this.prisma.department.findUnique({
      where: { code: user.departmentCode },
    });
    if (!department) {
      throw new ForbiddenException("Phòng ban không tồn tại");
    }

    // Đặt tên Dataset kèm Tiền tố Danh mục nếu có gán categoryId
    const datasetName = dto.categoryId
      ? await this.buildDatasetNameWithCategoryPrefix(
          dto.categoryId,
          dto.name,
          department.id,
        )
      : dto.name;

    // -----------------------------------------------------------------
    // BƯỚC 1: Khởi tạo Dataset trên Dify Engine qua Open API
    // -----------------------------------------------------------------
    const difyData = await this.difyService.createDataset(
      datasetName,
      dto.description,
    );

    // Kiểm tra xem ID đã tồn tại trong DB local chưa để tránh trùng lặp
    const existing = await this.prisma.dataset.findUnique({
      where: { difyDatasetId: difyData.id },
    });
    if (existing) {
      try {
        await this.difyService.deleteDataset(difyData.id);
      } catch (e) {
        // Bỏ qua lỗi dọn dẹp remote
      }
      throw new ConflictException("Dataset đã tồn tại trong hệ thống");
    }

    // -----------------------------------------------------------------
    // BƯỚC 2: Lưu vào Local DB & Cấp quyền MANAGER cho Creator
    // -----------------------------------------------------------------
    try {
      const schemaConfigValue = (() => {
        const val = (dto as any).schemaConfig;
        if (val === undefined || val === null) return null;
        if (Array.isArray(val)) return val.length > 0 ? val : null;
        if (typeof val === 'object') return Object.keys(val).length > 0 ? val : null;
        return val;
      })();

      const dataset = await this.prisma.dataset.create({
        data: {
          difyDatasetId: difyData.id,
          name: datasetName,
          description: dto.description,
          schemaConfig: schemaConfigValue as any,
          createdBy: { connect: { id: user.id } },
          owner: { connect: { id: user.id } }, // Gán Owner = Creator ban đầu
          ...(dto.categoryId && { category: { connect: { id: dto.categoryId } } }),
          departmentPermissions: {
            create: {
              departmentId: department.id,
              role: "VIEWER", // Cấp quyền VIEWER mặc định cho toàn bộ Phòng ban
            },
          },
          // Cấp quyền MANAGER trực tiếp duy nhất cho Người tạo (Creator)
          members: {
            create: [
              {
                userId: user.id,
                role: "MANAGER",
              },
            ],
          },
        },
      });

      return dataset;
    } catch (e) {
      this.loggerError("LỖI PRISMA CREATE DATASET GỐC:", e);

      // Rollback: Xóa Dataset vừa tạo trên Dify nếu lưu DB Local thất bại
      try {
        await this.difyService.deleteDataset(difyData.id);
      } catch (cleanupErr) {
        console.warn(
          "Failed to cleanup remote Dify dataset after DB failure",
          cleanupErr,
        );
      }

      throw new InternalServerErrorException(`Lỗi DB: ${e.message}`);
    }
  }

  private loggerError(msg: string, e: any) {
    console.error(`🔥🔥🔥 ${msg}`, e);
  }

  // =================================================================
  // 2. PUT /api/datasets/:id/schema (CẬP NHẬT SCHEMA CONFIG)
  // =================================================================
  /**
   * Cập nhật cấu hình các trường tùy chỉnh (Schema Config) cho Dataset
   */
  async updateSchema(id: number, dto: UpdateSchemaDto, user: User) {
    // Yêu cầu quyền MANAGE trên Dataset
    await this.validationService.validateDatasetAccess(id, user, "MANAGE");

    return this.prisma.dataset.update({
      where: { id },
      data: {
        schemaConfig: dto.schemaConfig as any,
      },
    });
  }

  // =================================================================
  // 3. DELETE /api/datasets/:id (HARD DELETE DATASET)
  // =================================================================
  /**
   * Xóa vĩnh viễn Dataset (Xóa remote Dify + Cascade delete local records)
   * 
   * @param id ID Dataset
   * @param user User hiện tại thực hiện request
   */
  async remove(id: number, user: User) {
    // -----------------------------------------------------------------
    // BƯỚC 1: Gatekeeper đặc biệt cho hành động XÓA DATASET
    // Phân quyền: Chỉ Super Admin, Owner, hoặc Dept Manager của phòng ban chứa dataset mới có quyền xóa.
    // Member thường (dù được gán quyền MANAGER cá nhân) KHÔNG được xóa.
    // -----------------------------------------------------------------
    await this.validationService.validateDatasetAccess(id, user, "DELETE_DATASET");

    const dataset = await this.prisma.dataset.findUnique({ where: { id } });
    if (!dataset || dataset.isDeleted)
      throw new NotFoundException("Dataset không tồn tại");

    // -----------------------------------------------------------------
    // BƯỚC 2: Xóa Dataset trên Dify Engine qua Open API
    // -----------------------------------------------------------------
    if (dataset.difyDatasetId) {
      try {
        await this.difyService.deleteDataset(dataset.difyDatasetId);
      } catch (e) {
        console.warn("Dify delete failed", e);
      }
    }

    // -----------------------------------------------------------------
    // BƯỚC 3: Hard Delete xóa dây chuyền tất cả dữ liệu liên quan trong Local DB
    // -----------------------------------------------------------------
    // 3.1. Xóa các Segments trước
    await this.prisma.segment.deleteMany({
      where: { document: { datasetId: id } },
    });

    // 3.2. Xóa các Documents
    await this.prisma.document.deleteMany({
      where: { datasetId: id },
    });

    return this.prisma.dataset.delete({
      where: { id },
    });
  }
}
