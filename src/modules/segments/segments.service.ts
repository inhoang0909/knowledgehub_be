import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { DifyClientService } from "../dify-client/dify-client.service";
import { CreateSegmentDto, UpdateSegmentDto } from "./dto/create-segment.dto";
import { User, UserRole } from "@prisma/client";
import { ValidationService } from "@common/services/validation.service";

@Injectable()
export class SegmentsService {
  constructor(
    private prisma: PrismaService,
    private difyService: DifyClientService,
    private validationService: ValidationService, // <--- Inject ValidationService
  ) {}

  async findAllFromDify(documentId: number, user: User) {
    // 1. Lấy thông tin Document
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { dataset: true },
    });

    if (!doc || !doc.difyDocumentId) {
      throw new NotFoundException("Document không tồn tại hoặc chưa đồng bộ Dify");
    }

    // (Option) Có thể check quyền READ Dataset ở đây nếu muốn chặt chẽ
    await this.validationService.validateDatasetAccess(doc.datasetId, user, 'READ');

    // 2. Gọi Dify lấy dữ liệu mới nhất
    const { data: difySegments, total } = await this.difyService.getSegments(
      doc.dataset.difyDatasetId,
      doc.difyDocumentId,
    );

    // -----------------------------------------------------------------------
    // [AUTO-SYNC LOGIC]
    // -----------------------------------------------------------------------
    const difyIds = difySegments.map((s: any) => s.id);
    
    // Lấy các segment đã có trong DB
    const existingLocalSegments = await this.prisma.segment.findMany({
      where: { 
        documentId: doc.id,
        difySegmentId: { in: difyIds } 
      },
      select: { difySegmentId: true }
    });
    const existingIdSet = new Set(existingLocalSegments.map(s => s.difySegmentId));

    // Lọc ra các segment MỚI (có trên Dify nhưng chưa có ở Local)
    const newSegments = difySegments.filter((s: any) => !existingIdSet.has(s.id));

    if (newSegments.length > 0) {
      // Lưu hàng loạt vào DB Local
      // Lưu ý: Vì Document không có createdById, segments được tạo auto không có owner cụ thể
      // Chỉ có segments tạo thủ công (qua API create) mới gán createdById
      await this.prisma.segment.createMany({
        data: newSegments.map((seg: any) => ({
          documentId: doc.id,
          difySegmentId: seg.id,
          rawData: this.parseTextToJson(seg.content),
          createdById: user.id, // Người gọi API là người fetch -> Become owner
          createdAt: new Date(seg.created_at * 1000)
        })),
        skipDuplicates: true
      });
    }
    // -----------------------------------------------------------------------

    // 3. Query lại Local DB để lấy đầy đủ thông tin (ID, User, isDirty)
    const allLocalSegments = await this.prisma.segment.findMany({
      where: { difySegmentId: { in: difyIds } },
      select: {
        id: true,
        difySegmentId: true,
        isDirty: true,
        createdAt: true,
        createdBy: { select: { id: true, username: true, email: true } },
      },
    });

    // 4. Map dữ liệu
    const localMap = new Map(allLocalSegments.map((s) => [s.difySegmentId, s]));

    const mappedData = difySegments.map((difySeg: any) => {
      const local = localMap.get(difySeg.id);
      return {
        ...difySeg,
        dify_segment_id: difySeg.id,
        data: this.parseTextToJson(difySeg.content),
        
        // Merge Local Info
        id: local?.id || null,
        is_dirty: local?.isDirty || false,
        created_at: local?.createdAt || null,
        created_by: local?.createdBy || null,
      };
    });

    return { data: mappedData, total };
  }

  // =================================================================
  // 2. CREATE SEGMENT
  // =================================================================
  async create(documentId: number, dto: CreateSegmentDto, user: User) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { dataset: true }
    });
    if (!doc) throw new NotFoundException("Document not found");

    // A. Check quyền WRITE vào Dataset (Validation Service)
    // VIEWER có thể thêm/sửa/xóa segments theo yêu cầu
    await this.validationService.validateDatasetAccess(doc.datasetId, user, 'WRITE_SEGMENT');

    // B. Check Schema dữ liệu (Validation Service)
    this.validationService.validateJsonSchema(doc.dataset.schemaConfig as any[], dto.data);

    // C. Logic Dify
    const textContent = this.transformDataToText(dto.data);
    const difySeg = await this.difyService.createSegment(
      doc.dataset.difyDatasetId,
      doc.difyDocumentId,
      textContent,
    );

    // D. Lưu DB (Kế thừa quyền của User đang tạo)
    return this.prisma.segment.create({
      data: {
        documentId: doc.id,
        difySegmentId: difySeg.id,
        rawData: dto.data as any,
        isDirty: true,
        createdById: user.id, // User hiện tại là chủ sở hữu
      },
    });
  }

  // =================================================================
  // 3. UPDATE SEGMENT
  // =================================================================
  async update(segmentId: number, dto: UpdateSegmentDto, user: User) {
    // Lấy context Segment + Dataset
    const segment = await this.prisma.segment.findUnique({
      where: { id: segmentId },
      include: { document: { include: { dataset: true } } }
    });
    if (!segment) throw new NotFoundException("Segment not found");

    // A. Check quyền WRITE_SEGMENT (VIEWER có thể sửa segment)
    await this.validationService.validateDatasetAccess(
      segment.document.datasetId,
      user,
      'WRITE_SEGMENT'
    );

    // B. Check Schema
    this.validationService.validateJsonSchema(segment.document.dataset.schemaConfig as any[], dto.data);

    // C. Update Dify
    const textContent = this.transformDataToText(dto.data);
    await this.difyService.updateSegment(
      segment.document.dataset.difyDatasetId,
      segment.document.difyDocumentId,
      segment.difySegmentId,
      textContent,
    );

    // D. Update Local DB (Track updatedBy for audit & mark isDirty)
    return this.prisma.segment.update({
      where: { id: segmentId },
      data: { 
        rawData: dto.data as any,
        isDirty: true,
        updatedById: user.id, // Track who made the last edit
      },
    });
  }

  // =================================================================
  // 4. REMOVE SEGMENT
  // =================================================================
  async remove(segmentId: number, user: User) {
    const segment = await this.prisma.segment.findUnique({
      where: { id: segmentId },
      include: { document: { include: { dataset: true } } }
    });
    if (!segment) throw new NotFoundException("Segment not found");

    // Check quyền WRITE_SEGMENT (VIEWER có thể xóa segment)
    await this.validationService.validateDatasetAccess(
      segment.document.datasetId,
      user,
      'WRITE_SEGMENT'
    );

    // Remove Dify
    await this.difyService.deleteSegment(
      segment.document.dataset.difyDatasetId,
      segment.document.difyDocumentId,
      segment.difySegmentId,
    );

    // Remove Local DB
    return this.prisma.segment.delete({ where: { id: segmentId } });
  }

  // =================================================================
  // 5. CHECK DUPLICATE (Exact Match Normalization)
  // =================================================================
// src/modules/segments/segments.service.ts

 async checkDuplicate(
    documentId: number,
    data: Record<string, any>,
    excludeSegmentId?: number
  ): Promise<{ 
    status: 'SAFE' | 'DUPLICATE' | 'CONFLICT'; // <--- Update kiểu trả về rõ ràng hơn
    duplicateSegment?: { id: number; content: Record<string, any> } 
  }> {
    
    // 1. Normalize Input
    const normalizedInput = this.normalizeSegmentData(data);
    const inputKeys = Object.keys(normalizedInput);

    if (inputKeys.length === 0) return { status: 'SAFE' };

    // 2. Xác định Identity Key (Khóa chính để check trùng)
    // Ưu tiên các key thông dụng hoặc lấy key đầu tiên làm định danh
    // Ví dụ: 'question', 'q', 'input', 'title'
    const identityKey = inputKeys.find(k => ['question', 'q', 'title', 'instruction'].includes(k)) || inputKeys[0];

    // 3. Query Candidates
    const existingSegments = await this.prisma.segment.findMany({
      where: {
        documentId,
        ...(excludeSegmentId && { id: { not: excludeSegmentId } })
      },
      select: { id: true, rawData: true }
    });

    // 4. Loop Check
    for (const segment of existingSegments) {
      const normalizedExisting = this.normalizeSegmentData(segment.rawData as Record<string, any>);
      
      // A. Check Identity (Ví dụ: Chỉ so sánh Question)
      // Nếu DB không có key này thì bỏ qua
      if (!normalizedExisting[identityKey]) continue;

      const isIdentityMatch = normalizedExisting[identityKey] === normalizedInput[identityKey];

      if (isIdentityMatch) {
        // B. Nếu Identity khớp, check tiếp xem các field còn lại có khớp không (Full Match)
        const isFullMatch = inputKeys.every(key => {
            return Object.prototype.hasOwnProperty.call(normalizedExisting, key) &&
                   normalizedExisting[key] === normalizedInput[key];
        });

        if (isFullMatch) {
            return {
                status: 'DUPLICATE', // Trùng 100% (cả hỏi và trả lời)
                duplicateSegment: { id: segment.id, content: segment.rawData as any }
            };
        } else {
            return {
                status: 'CONFLICT', // Trùng câu hỏi, nhưng khác câu trả lời
                duplicateSegment: { id: segment.id, content: segment.rawData as any }
            };
        }
      }
    }

    return { status: 'SAFE' };
  }
  // --- PRIVATE HELPER ---

  /**
   * Hàm chuẩn hóa dữ liệu để so sánh chính xác:
   * - Chuyển Key về lowercase + trim
   * - Chuyển Value về string + lowercase + trim
   * - Loại bỏ null, undefined hoặc chuỗi rỗng
   */
  private normalizeSegmentData(data: Record<string, any>): Record<string, string> {
    const normalized: Record<string, string> = {};

    if (!data || typeof data !== 'object') return {};

    for (const [key, value] of Object.entries(data)) {
      // Chỉ xử lý nếu có giá trị thực
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        const normKey = key.toLowerCase().trim();
        const normValue = String(value).toLowerCase().trim();
        
        normalized[normKey] = normValue;
      }
    }

    return normalized;
  }

  private transformDataToText(data: Record<string, any>): string {
    return Object.entries(data).map(([k, v]) => `"${k}":"${v}"`).join(";");
  }

  private parseTextToJson(text: string): Record<string, any> {
    if (!text || typeof text !== 'string') return { content: "" };
    const trimmed = text.trim();

    // 1. Nếu là chuỗi JSON hợp lệ (ví dụ: {"question": "...", "answer": "..."})
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch (e) {
        // Không phải JSON hợp lệ -> Tiếp tục xuống bên dưới
      }
    }

    // 2. Kiểm tra định dạng Key-Value có ngoặc kép chuẩn ("key":"value" hoặc "key": "value")
    // File docx/pdf bình thường sẽ không có dấu ngoặc kép bọc quanh key ở đầu chuỗi (ví dụ: Chương 1: ...)
    const pairRegex = /"([^"\r\n]+)"\s*:\s*"([^"]*)"/g;
    const matches = [...trimmed.matchAll(pairRegex)];

    // Bắt buộc chuỗi phải bắt đầu bằng ngoặc kép " VÀ tìm thấy ít nhất 1 cặp key-value chuẩn
    if (trimmed.startsWith('"') && matches.length > 0) {
      const result: Record<string, any> = {};
      for (const match of matches) {
        const key = match[1].trim();
        const value = match[2];
        if (key) {
          result[key] = value;
        }
      }
      if (Object.keys(result).length > 0) {
        return result;
      }
    }

    // 3. Với các file văn bản tự do (DOCX, PDF, TXT) -> Bọc toàn bộ nội dung vào key "content"
    return { content: text };
  }

}