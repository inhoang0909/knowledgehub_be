import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { FileProcessingService } from "../file-processing/file-processing.service";
import { DifyClientService } from "../dify-client/dify-client.service";
import * as fs from "fs";
import { DocumentUtils } from "./utils/document.utils";

/**
 * @class DocumentsCronService
 * @description Service lập lịch ngầm (Background Worker & Cron Polling) quản lý tiến trình xử lý Tài liệu (Document Pipeline).
 * 
 * Ba tiến trình Cron chính (chạy định kỳ 10 giây):
 * 1. `handleCronUploadToDify`: Đẩy các tài liệu trực tiếp (`pending_dify`) lên Dify AI Engine.
 * 2. `handleCronCheckWorker`: Theo dõi kết quả xử lý nâng cao (Worker OCR / Convert PDF cho PPTX) từ `FileProcessingService`.
 * 3. `handleCronSyncDocuments`: Đồng bộ trạng thái Indexing/Embedding vector từ Dify AI Engine về Database local.
 */
@Injectable()
export class DocumentsCronService {
  constructor(
    private prisma: PrismaService,
    private difyService: DifyClientService,
    private fileProcessingService: FileProcessingService,
  ) { }

  /**
   * Cron Task 1: Upload trực tiếp tài liệu thô (`pending_dify`) lên Dify Knowledge Base
   * Tần suất: Mỗi 10 giây
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleCronUploadToDify() {
    const pendingDocs = await this.prisma.document.findMany({
      where: { rawData: { path: ["status"], equals: "pending_dify" } },
      include: { dataset: true },
    });

    for (const doc of pendingDocs) {
      try {
        if (!fs.existsSync(doc.fileUrl)) throw new Error("File local không tồn tại trên ổ đĩa");

        const fileBuffer = fs.readFileSync(doc.fileUrl);
        const docName = (doc.rawData as any)?.name || doc.fileName;

        // Gọi Dify Client API để tạo Container Document
        const difyRes = await this.difyService.createContainerDocument(
          doc.dataset.difyDatasetId, docName, fileBuffer, doc.fileName
        );

        if (!difyRes || difyRes.error || !difyRes.document) {
          throw new Error(difyRes.message || "Upload tài liệu lên Dify thất bại");
        }

        // Cập nhật Metadata Category ID trên Dify nếu Dataset có gán Category
        if (doc.dataset.categoryId) {
          await this.difyService.updateDocumentMetadata(
            doc.dataset.difyDatasetId, difyRes.document.id, { category_id: String(doc.dataset.categoryId) }
          );
        }

        // Dọn dẹp file tạm trên local server sau khi đã push thành công lên Dify
        DocumentUtils.safeDeleteFile(doc.fileUrl);

        // Cập nhật trạng thái chuyển giao sang PROCESSING_AI (chờ Dify index vector)
        await this.prisma.document.update({
          where: { id: doc.id },
          data: {
            difyDocumentId: difyRes.document.id,
            fileUrl: difyRes.document.url || "",
            status: "PROCESSING_AI",
            rawData: { ...((doc.rawData as any) || {}), status: "indexing" },
          },
        });
      } catch (error) {
        console.error(`[Cron 1] Lỗi khi upload tài liệu trực tiếp ${doc.id}:`, error.message);
        await this.markAsFailed(doc.id, doc.rawData, error.message);
      }
    }
  }

  /**
   * Cron Task 2: Kiểm tra kết quả từ Worker xử lý file phức tạp (`pending_worker`)
   * Tần suất: Mỗi 10 giây
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleCronCheckWorker() {
    const workerDocs = await this.prisma.document.findMany({
      where: { rawData: { path: ["status"], equals: "pending_worker" } },
      include: { dataset: true },
    });

    for (const doc of workerDocs) {
      const processedFileId = (doc.rawData as any)?.processedFileId;
      if (!processedFileId) continue;

      try {
        const fileStatus = await this.fileProcessingService.getFileStatus(
          processedFileId, String((doc.rawData as any)?.userId || "1")
        );

        if (fileStatus.status === "COMPLETED") {
          const fileMeta = fileStatus.metadata || {};
          const docName = (doc.rawData as any)?.name || doc.fileName;
          let difyRes: any;

          // TRƯỜNG HỢP 1: File PPTX đã được Gotenberg convert sang PDF thành công
          if (fileMeta.convertedPdfPath && fs.existsSync(fileMeta.convertedPdfPath)) {
            const fileBuffer = fs.readFileSync(fileMeta.convertedPdfPath);
            const safeFileName = doc.fileName.replace(/\.[^/.]+$/, "") + ".pdf";

            difyRes = await this.difyService.createContainerDocument(
              doc.dataset.difyDatasetId, docName, fileBuffer, safeFileName
            );

            // Dọn dẹp thư mục tạm của Gotenberg
            DocumentUtils.safeDeleteFolder(fileMeta.tempDirToCleanByCron);
          }
          // TRƯỜNG HỢP 2: File Ảnh đã được OCR chuyển thành văn bản Markdown
          else if (fileStatus.hasParsedContent) {
            const markdownContent = await this.fileProcessingService.getMarkdownContent(
              processedFileId, String((doc.rawData as any)?.userId || "1")
            );
            const safeFileName = doc.fileName.replace(/\.[^/.]+$/, "") + ".md";

            difyRes = await this.difyService.createContainerDocument(
              doc.dataset.difyDatasetId, docName, Buffer.from(markdownContent), safeFileName
            );

            await this.prisma.document.update({
              where: { id: doc.id },
              data: { parsedContent: markdownContent },
            });
          } else {
            throw new Error("Worker báo thành công nhưng không tìm thấy file PDF hoặc Markdown");
          }

          if (!difyRes || difyRes.error || !difyRes.document) {
            throw new Error(difyRes.message || "Upload kết quả xử lý từ Worker lên Dify thất bại");
          }

          if (doc.dataset.categoryId) {
            await this.difyService.updateDocumentMetadata(
              doc.dataset.difyDatasetId, difyRes.document.id, { category_id: String(doc.dataset.categoryId) }
            );
          }

          // Chuyển trạng thái sang PROCESSING_AI
          await this.prisma.document.update({
            where: { id: doc.id },
            data: {
              difyDocumentId: difyRes.document.id,
              fileUrl: difyRes.document.url || "",
              status: "PROCESSING_AI",
              rawData: { ...((doc.rawData as any) || {}), status: "indexing" },
            },
          });
        } else if (fileStatus.status === "FAILED") {
          throw new Error("Worker gặp lỗi trong quá trình OCR/Convert file");
        }
      } catch (error) {
        console.error(`[Cron 2] Lỗi kiểm tra Worker cho tài liệu ${doc.id}:`, error.message);
        await this.markAsFailed(doc.id, doc.rawData, error.message);
      }
    }
  }

  /**
   * Cron Task 3: Đồng bộ trạng thái Indexing Vector từ Dify về Database local
   * Tần suất: Mỗi 10 giây
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleCronSyncDocuments() {
    const processingDocs = await this.prisma.document.findMany({
      where: { rawData: { path: ["status"], equals: "indexing" } },
      include: { dataset: true },
    });

    if (processingDocs.length === 0) return;

    for (const doc of processingDocs) {
      if (!doc.difyDocumentId || !doc.dataset?.difyDatasetId) continue;

      try {
        const difyDetail = await this.difyService.getDocumentDetail(doc.dataset.difyDatasetId, doc.difyDocumentId);

        if (difyDetail.indexing_status === "completed") {
          await this.prisma.document.update({
            where: { id: doc.id },
            data: {
              status: "COMPLETED",
              rawData: { ...((doc.rawData as any) || {}), status: "completed", word_count: difyDetail.word_count },
            },
          });
        } else if (difyDetail.indexing_status === "error") {
          await this.markAsFailed(doc.id, doc.rawData, "Lỗi khi Dify indexing/embed vector");
        }
      } catch (error) {
        console.error(`[Cron 3] Lỗi đồng bộ trạng thái tài liệu ${doc.id}:`, error.message);
      }
    }
  }

  /**
   * Helper cập nhật trạng thái FAILED cho tài liệu khi gặp sự cố ở bất kỳ bước nào
   */
  private async markAsFailed(docId: number, rawData: any, errorMessage: string) {
    await this.prisma.document.update({
      where: { id: docId },
      data: {
        status: "FAILED",
        errorMessage: errorMessage,
        rawData: { ...(rawData || {}), status: "error" },
      },
    });
  }
}