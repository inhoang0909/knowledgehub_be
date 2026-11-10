import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { User } from "@prisma/client";
import { ValidationService } from "@common/services/validation.service";
import { FileProcessingService } from "../file-processing/file-processing.service";
import { DifyClientService } from "../dify-client/dify-client.service";
import * as fs from "fs";
import * as path from "path";
import { DocumentUtils } from "./utils/document.utils";

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_FILES_BATCH = 5;

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private difyService: DifyClientService,
    private validationService: ValidationService,
    private fileProcessingService: FileProcessingService,
  ) {}

  async create(datasetId: number, name: string, user: User, file?: any) {
    await this.validationService.validateDatasetAccess(datasetId, user, "WRITE_DOCUMENT");
    const dataset = await this.prisma.dataset.findUnique({ where: { id: datasetId } });
    
    if (!dataset) throw new NotFoundException("Dataset not found");
    if (!file) throw new BadRequestException("No file provided");

    if (file.size && file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(`File ${file.originalname || ''} vượt quá dung lượng tối đa 15MB`);
    }

    // LUỒNG 1: Gửi cho Worker
    if (DocumentUtils.needsWorkerProcessing(file.originalname)) {
      const { fileId } = await this.fileProcessingService.submitFile(file, user.id);
      return this.prisma.document.create({
        data: {
          dataset: { connect: { id: dataset.id } },
          fileName: file.originalname,
          fileUrl: "",
          status: "PARSING",
          rawData: {
            name: name,
            type: "file",
            status: "pending_worker",
            filename: file.originalname,
            processedFileId: fileId,
            userId: String(user.id),
          },
        },
      });
    }

    // LUỒNG 2: Đẩy thẳng lên Dify
    if (DocumentUtils.isDirectUpload(file.originalname)) {
      const fileBuffer = file.buffer || (file.path && fs.existsSync(file.path) ? fs.readFileSync(file.path) : null);
      
      let difyRes: any;
      if (fileBuffer) {
        try {
          difyRes = await this.difyService.createContainerDocument(
            dataset.difyDatasetId,
            name || file.originalname,
            fileBuffer,
            file.originalname
          );
        } catch (err) {
          console.error(`[DocumentsService] Upload direct lên Dify lỗi:`, err.message);
          throw new BadRequestException(err.message || "Upload tài liệu lên Dify thất bại");
        }
      }

      if (!difyRes || difyRes.error || !difyRes.document) {
        throw new BadRequestException(difyRes?.message || "Upload tài liệu lên Dify thất bại");
      }

      if (dataset.categoryId) {
        try {
          await this.difyService.updateDocumentMetadata(
            dataset.difyDatasetId,
            difyRes.document.id,
            { category_id: String(dataset.categoryId) }
          );
        } catch (e) {
          console.warn("Update document category metadata failed", e.message);
        }
      }

      return this.prisma.document.create({
        data: {
          dataset: { connect: { id: dataset.id } },
          fileName: file.originalname,
          fileUrl: difyRes.document.url || "",
          difyDocumentId: difyRes.document.id,
          status: "PROCESSING_AI",
          rawData: {
            name: name || file.originalname,
            type: "file",
            status: "indexing",
            filename: file.originalname,
          },
        },
      });
    }

    throw new NotFoundException("Unsupported file type");
  }

  async createMultiple(datasetId: number, user: User, files: any[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException("Không có file nào được đính kèm");
    }
    if (files.length > MAX_FILES_BATCH) {
      throw new BadRequestException(`Tối đa ${MAX_FILES_BATCH} file cho mỗi lần tải lên`);
    }

    const createdDocs = [];
    for (const file of files) {
      const doc = await this.create(datasetId, file.originalname, user, file);
      createdDocs.push(doc);
    }
    return createdDocs;
  }

  async findOne(id: number, user: User) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: { dataset: true, _count: { select: { segments: true } } },
    });

    if (!doc) throw new NotFoundException("Document not found");
    await this.validationService.validateDatasetAccess(doc.datasetId, user, "READ");

    return { ...doc, status: (doc.rawData as any)?.status || "unknown" };
  }

  async updateStatus(documentId: number, action: "enable" | "disable" | "archive", user: User) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId }, include: { dataset: true } });
    if (!doc) throw new NotFoundException("Document không tồn tại");

    await this.validationService.validateDatasetAccess(doc.datasetId, user, "WRITE_DOCUMENT");

    if (doc.difyDocumentId) {
      await this.difyService.updateDocumentStatus(doc.dataset.difyDatasetId, doc.difyDocumentId, action);
    }

    const currentRawData = (doc.rawData as Record<string, any>) || {};
    return this.prisma.document.update({
      where: { id: documentId },
      data: {
        rawData: { ...currentRawData, enabled: action === "enable", archived: action === "archive" },
      },
    });
  }

  async remove(documentId: number, user: User) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId }, include: { dataset: true } });
    if (!doc) throw new NotFoundException("Document not found");

    await this.validationService.validateDatasetAccess(doc.datasetId, user, "WRITE_DOCUMENT");

    if (doc.difyDocumentId) {
      try {
        await this.difyService.deleteDocument(doc.dataset.difyDatasetId, doc.difyDocumentId);
      } catch (e) {
        console.warn("Dify delete failed", e);
      }
    }

    if (doc.status === "UPLOADED" && doc.fileUrl) {
      DocumentUtils.safeDeleteFile(doc.fileUrl);
    }

    return this.prisma.document.delete({ where: { id: documentId } });
  }

  async reindex(documentId: number, mode: 'local_first' | 'file_reset' = 'local_first', user: User) {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { dataset: true, segments: true },
    });
    if (!doc) throw new NotFoundException("Document không tồn tại");

    await this.validationService.validateDatasetAccess(doc.datasetId, user, "WRITE_DOCUMENT");

    // Mode 1: Local-First (Bảo toàn Segments trong Local DB)
    if (mode === "local_first" && doc.segments.length > 0) {
      if (doc.difyDocumentId) {
        try {
          await this.difyService.deleteDocument(doc.dataset.difyDatasetId, doc.difyDocumentId);
        } catch (err) {
          console.warn("[DocumentsService] Reindex - Delete old Dify doc warning:", err.message);
        }
      }

      const difyRes = await this.difyService.createContainerDocument(
        doc.dataset.difyDatasetId,
        doc.fileName || "Reindexed Document",
        undefined,
        doc.fileName || "reindex.txt"
      );

      if (!difyRes || !difyRes.document?.id) {
        throw new BadRequestException("Không thể tạo Container Document mới trên Dify");
      }

      const newDifyDocId = difyRes.document.id;

      const batchItems = doc.segments.map((seg) => {
        const raw = (seg.rawData as Record<string, any>) || {};
        let textContent = "";
        if (typeof raw === "string") {
          textContent = raw;
        } else if (raw.content) {
          textContent = String(raw.content);
        } else {
          textContent = Object.entries(raw)
            .map(([k, v]) => `"${k}":"${v}"`)
            .join(";");
        }
        return { content: textContent || "Empty segment" };
      });

      const createdDifySegments = await this.difyService.createSegmentsBatch(
        doc.dataset.difyDatasetId,
        newDifyDocId,
        batchItems
      );

      if (Array.isArray(createdDifySegments)) {
        for (let i = 0; i < doc.segments.length; i++) {
          const localSeg = doc.segments[i];
          const newDifySeg = createdDifySegments[i];
          if (newDifySeg?.id) {
            await this.prisma.segment.update({
              where: { id: localSeg.id },
              data: {
                difySegmentId: newDifySeg.id,
                isDirty: false,
              },
            });
          }
        }
      }

      const currentRawData = (doc.rawData as Record<string, any>) || {};
      const updatedDoc = await this.prisma.document.update({
        where: { id: documentId },
        data: {
          difyDocumentId: newDifyDocId,
          status: "COMPLETED",
          errorMessage: null,
          rawData: {
            ...currentRawData,
            status: "completed",
            indexing_status: "completed",
            reindexed_at: new Date().toISOString(),
            reindex_mode: "local_first",
          },
        },
      });

      return {
        message: `Đã Reindex thành công ${doc.segments.length} đoạn phân đoạn từ Local DB lên Dify.`,
        document: updatedDoc,
        syncedSegmentsCount: doc.segments.length,
      };
    }

    // Mode 2: File-Reset (Băm lại từ đầu từ File gốc)
    await this.prisma.segment.deleteMany({ where: { documentId: doc.id } });

    if (doc.difyDocumentId) {
      try {
        await this.difyService.deleteDocument(doc.dataset.difyDatasetId, doc.difyDocumentId);
      } catch (err) {
        console.warn("[DocumentsService] Reindex file_reset warning:", err.message);
      }
    }

    if (doc.fileUrl && fs.existsSync(doc.fileUrl)) {
      const fileBuffer = fs.readFileSync(doc.fileUrl);
      const difyRes = await this.difyService.createContainerDocument(
        doc.dataset.difyDatasetId,
        doc.fileName,
        fileBuffer,
        doc.fileName
      );

      const currentRawData = (doc.rawData as Record<string, any>) || {};
      const updatedDoc = await this.prisma.document.update({
        where: { id: documentId },
        data: {
          difyDocumentId: difyRes.document?.id || null,
          status: "PROCESSING_AI",
          errorMessage: null,
          rawData: {
            ...currentRawData,
            status: "indexing",
            indexing_status: "indexing",
            reindexed_at: new Date().toISOString(),
            reindex_mode: "file_reset",
          },
        },
      });

      return {
        message: "Đã yêu cầu Dify phân đoạn lại hoàn toàn từ file gốc.",
        document: updatedDoc,
      };
    }

    throw new BadRequestException("Không tìm thấy file gốc trên server để băm lại.");
  }
}