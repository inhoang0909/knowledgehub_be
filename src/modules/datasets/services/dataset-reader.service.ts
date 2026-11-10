import { DifyClientService } from "@/modules/dify-client/dify-client.service";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { Injectable, NotFoundException } from "@nestjs/common";
import { User, UserRole } from "@prisma/client";
import { ValidationService } from "@common/services/validation.service";

/**
 * @class DatasetReaderService
 * @description Service chuyên trách các thao tác ĐỌC dữ liệu Dataset (Read Operations).
 * 
 * Luồng hoạt động chính:
 * 1. `findAll`: Truy vấn mảng Dataset theo 4 điều kiện phân quyền (Direct Member, GLOBAL Category space, Department Permissions, Department Ownership).
 * 2. `findOne`: Lấy chi tiết Dataset, đồng thời thực hiện **Trộn Danh Sách Tài Liệu (Document Merging Algorithm)**:
 *    - Lấy danh sách Document từ Dify API qua HTTP.
 *    - Lấy danh sách các file Local đang xử lý ngầm (Status: `PARSING`, `UPLOADED`, `PROCESSING_AI`, `FAILED` chưa được sync sang Dify).
 *    - Trộn 2 danh sách, đính kèm `wrapper_id`, đặt các file Pending lên đầu danh sách để UI hiển thị trạng thái xử lý real-time.
 * 3. `testRetrieve`: Thực hiện kiểm thử Hit Testing (Semantic Search accuracy) trên Dify Dataset, lọc theo ngưỡng điểm tương đồng `score >= 0.4`.
 */
@Injectable()
export class DatasetReaderService {
  constructor(
    private prisma: PrismaService,
    private difyService: DifyClientService,
    private validationService: ValidationService,
  ) { }

  // =================================================================
  // 1. GET /api/datasets (TRUY VẤN DANH SÁCH DATASETS)
  // =================================================================
  /**
   * Lấy danh sách tất cả các Dataset mà User được phép truy cập
   * 
   * @param user User hiện tại thực hiện request
   * @returns Danh sách Datasets kèm mảng phân quyền hiệu lực `permission_type`
   */
  async findAll(user: User) {
    const whereCondition: any = { isDeleted: false };

    // Nếu không phải SUPER_ADMIN, dựng mảng điều kiện lọc OR đa nhánh
    if (user.role !== UserRole.SUPER_ADMIN) {
      const conditions: any[] = [
        // 1. Là thành viên cá nhân trực tiếp (Direct Member)
        { members: { some: { userId: user.id } } },
        // 2. Thuộc Không gian dùng chung GLOBAL (Ai cũng xem được)
        { category: { department: { code: 'GLOBAL' } } }
      ];

      if (user.departmentCode) {
        // 3. Dataset được phân quyền chia sẻ cho cả Phòng ban của User
        conditions.push({
          departmentPermissions: { some: { department: { code: user.departmentCode } } }
        });
        // 4. Dataset thuộc sở hữu trực tiếp của Phòng ban User
        conditions.push({
          owner: { departmentCode: user.departmentCode }
        });
      }

      whereCondition.OR = conditions;
    }

    // Truy vấn dữ liệu từ Prisma Local DB
    const datasets = await this.prisma.dataset.findMany({
      where: whereCondition,
      include: {
        createdBy: { select: { id: true, username: true, email: true } },
        owner: { select: { id: true, email: true } },
        category: {
          select: {
            id: true, name: true, parentId: true,
            parent: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: { createdAt: "desc" },
    });

    // Hydrate vai trò phân quyền thực tế (Role) cho từng Dataset
    const datasetsWithPermission = await Promise.all(
      datasets.map(async (ds) => {
        const context = await this.validationService.getDatasetContext(ds.id, user);
        return {
          id: ds.id,
          difyDatasetId: ds.difyDatasetId,
          name: ds.name,
          description: ds.description,
          permission_type: context.role || "VIEWER",
          created_by: ds.createdBy,
          owner: ds.owner,
          category: ds.category,
        };
      })
    );

    return datasetsWithPermission;
  }

  // =================================================================
  // 2. GET /api/datasets/:id (TRUY VẤN CHI TIẾT & MERGE PENDING DOCS)
  // =================================================================
  /**
   * Lấy thông tin chi tiết Dataset và danh sách Documents (Trộn file Dify & file Pending)
   * 
   * @param id ID của Dataset
   * @param user User hiện tại thực hiện request
   * @param queryParams Tham số phân trang (`page`) và từ khóa tìm kiếm (`keyword`)
   */
  async findOne(id: number, user: User, queryParams?: { page?: number; keyword?: string }) {
    // -----------------------------------------------------------------
    // BƯỚC 1: Gatekeeper — Kiểm tra quyền XEM (READ)
    // -----------------------------------------------------------------
    await this.validationService.validateDatasetAccess(id, user, "READ");
    const context = await this.validationService.getDatasetContext(id, user);

    const dataset = await this.prisma.dataset.findUnique({
      where: { id },
      include: {
        category: {
          select: {
            id: true, name: true, parentId: true,
            parent: { select: { id: true, name: true } }
          }
        }
      }
    });

    if (!dataset || dataset.isDeleted) throw new NotFoundException("Dataset not found");

    // -----------------------------------------------------------------
    // BƯỚC 2: Gọi Dify Open API lấy danh sách tài liệu đã index xong
    // -----------------------------------------------------------------
    const page = queryParams?.page || 1;
    const keyword = queryParams?.keyword || "";
    const difyDocuments = await this.difyService.getDocuments(dataset.difyDatasetId, page, 20, keyword);

    // -----------------------------------------------------------------
    // BƯỚC 3.1: Mapping wrapper_id từ Local DB cho các Document của Dify
    // -----------------------------------------------------------------
    const difyIds = difyDocuments.data.map((doc: any) => doc.id);
    const localDocs = await this.prisma.document.findMany({
      where: { datasetId: id, difyDocumentId: { in: difyIds } },
      select: { id: true, difyDocumentId: true },
    });

    const localMap = new Map(localDocs.map((doc) => [doc.difyDocumentId, doc]));

    const mergedDifyDocuments = difyDocuments.data.map((dDoc: any) => {
      const localMatch = localMap.get(dDoc.id);
      return {
        ...dDoc,
        wrapper_id: localMatch ? localMatch.id : null,
        is_managed: !!localMatch,
      };
    });

    // -----------------------------------------------------------------
    // BƯỚC 3.2: Lấy các Document đang "PENDING" ở Local DB (chưa sync sang Dify)
    // các trạng thái: PARSING, UPLOADED, PROCESSING_AI, FAILED
    // -----------------------------------------------------------------
    const pendingLocalDocs = await this.prisma.document.findMany({
      where: {
        datasetId: id,
        difyDocumentId: null, // File chưa tạo bản ghi tương ứng trên Dify
        status: { in: ['PARSING', 'UPLOADED', 'PROCESSING_AI', 'FAILED'] }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Chuẩn hóa cấu trúc tài liệu Pending giống hệt schema response của Dify API
    const formattedPendingDocs = pendingLocalDocs.map(doc => {
      const raw = (doc.rawData as Record<string, any>) || {};

      let indexingStatus = 'waiting';
      if (doc.status === 'PARSING') indexingStatus = 'parsing';
      if (doc.status === 'FAILED') indexingStatus = 'error';

      return {
        id: `local-pending-${doc.id}`, // Mock ID tạm thời cho Frontend
        wrapper_id: doc.id,
        name: doc.fileName || raw?.name || "Tài liệu đang xử lý",
        indexing_status: indexingStatus,
        created_at: Math.floor(doc.createdAt.getTime() / 1000), // Convert sang Unix Timestamp (giây)
        is_managed: true,
        word_count: 0,
        display_status: doc.status
      };
    });

    // -----------------------------------------------------------------
    // BƯỚC 3.3: TRỘN DANH SÁCH (Đưa file Pending lên đầu danh sách)
    // -----------------------------------------------------------------
    const finalDocumentsList = [...formattedPendingDocs, ...mergedDifyDocuments];

    return {
      id: dataset.id,
      difyDatasetId: dataset.difyDatasetId,
      name: dataset.name,
      schemaConfig: dataset.schemaConfig,
      createdAt: dataset.createdAt,
      description: dataset.description,
      isDeleted: dataset.isDeleted,
      createdById: dataset.createdById,
      ownerId: dataset.ownerId,
      categoryId: dataset.categoryId,
      category: dataset.category,
      permission_details: context.role || "VIEWER",
      dify_documents: finalDocumentsList,
      dify_meta: difyDocuments.meta,
    };
  }

  // =================================================================
  // 3. TRUY VẤN THEO OWNER & KIỂM THỬ HIT TESTING
  // =================================================================
  /**
   * Lấy danh sách Datasets do một User làm Chủ sở hữu (Owner)
   */
  async findByOwnerId(ownerId: number) {
    return this.prisma.dataset.findMany({
      where: { ownerId, isDeleted: false },
      select: { id: true, name: true, description: true, difyDatasetId: true, createdAt: true },
    });
  }

  /**
   * Kiểm thử độ chính xác tìm kiếm (Hit Testing Retrieval) trên Dify Dataset
   * 
   * @param datasetId ID Dataset
   * @param query Câu hỏi tìm kiếm
   * @param user User hiện tại thực hiện request
   * @returns Danh sách các đoạn văn bản match với độ tương đồng `score >= 0.4`
   */
  async testRetrieve(datasetId: number, query: string, user: User) {
    // 1. Kiểm tra quyền XEM (READ)
    await this.validationService.validateDatasetAccess(datasetId, user, "READ");

    const dataset = await this.prisma.dataset.findUnique({
      where: { id: datasetId },
      select: { difyDatasetId: true },
    });

    if (!dataset?.difyDatasetId) {
      throw new NotFoundException("Dataset not found or not synced with Dify");
    }

    // 2. Gọi Dify API thực hiện vector retrieval search
    const result = await this.difyService.retrieveSegments(
      dataset.difyDatasetId,
      query,
    );

    if (!result?.records || !Array.isArray(result.records)) {
      return [];
    }

    // 3. Lọc danh sách các đoạn văn bản có điểm tương đồng score >= 0.4
    return result.records
      .filter((record: any) => (record.score ?? 0) >= 0.4)
      .map((record: any) => {
        const segment = record.segment || {};
        const document = segment.document || {};

        return {
          content: segment.content || segment.sign_content || "",
          word_count: segment.word_count || 0,
          document_name: document.name || "Unknown Document",
          score: record.score || 0,
        };
      });
  }
}