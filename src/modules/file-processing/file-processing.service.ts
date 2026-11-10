import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PgBossService } from "../pg-boss/pg-boss.service";
import { PrismaService } from "../prisma/prisma.service";
import * as fs from "fs/promises";
import * as path from "path";
import { FileProcessingStatus } from "./file-processing-worker.service";

@Injectable()
export class FileProcessingService {
  private readonly logger = new Logger(FileProcessingService.name);
  private readonly QUEUE_NAME = "file-processing";
  private readonly uploadTempDir = path.join(process.cwd(), "uploads", "temp");

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly prisma: PrismaService,
  ) {}

  private get processedFile() {
    return (this.prisma as any).processedFile;
  }

  private async ensureUploadDir() {
    await fs.mkdir(this.uploadTempDir, { recursive: true });
  }

  /**
   * Submit a file for processing
   * Files are stored on the PHYSICAL FILE SYSTEM, not in the database
   */
  async submitFile(
    file: Express.Multer.File,
    userId: any,
  ): Promise<{ fileId: string; jobId: string }> {
    let tempFilePath: string | undefined;
    let isJobQueued = false;

    try {
      await this.ensureUploadDir();

      const fileExt = path.extname(file.originalname);
      const safeOriginalName = path.basename(file.originalname);
      const fileName = `${Date.now()}-${safeOriginalName}`;
      tempFilePath = path.join(this.uploadTempDir, fileName);
      const actualUserId = String(userId.id || userId);

      if (file.buffer) {
        await fs.writeFile(tempFilePath, file.buffer);
      } else if ((file as any).path) {
        await fs.copyFile((file as any).path, tempFilePath);
      } else {
        throw new Error('Uploaded file has no buffer or source path');
      }

      // Determine file type from extension (detailed validation will be performed in worker)
      const fileType = this.getFileType(fileExt);

      // Create database record (stores metadata + temp file pointer)
      const processedFile = await this.processedFile.create({
        data: {
          originalName: file.originalname,
          filePath: tempFilePath,
          fileType,
          fileSize: file.size,
          status: "PENDING",
          userId: actualUserId,
        },
      });

      // Submit job to pg-boss with pointer payload only (no raw base64 content)
      const jobId = await this.pgBossService.sendJob(this.QUEUE_NAME, {
        fileId: processedFile.id,
        fileName: file.originalname,
        filePath: tempFilePath,
        fileType,
        userId: actualUserId,
      });
      isJobQueued = true;

      this.logger.log(
        `File ${processedFile.id} submitted for processing with job ${jobId}`,
      );

      return {
        fileId: processedFile.id,
        jobId: String(jobId),
      };
    } catch (error) {
      if (tempFilePath && !isJobQueued) {
        try {
          await fs.unlink(tempFilePath);
          this.logger.log(`Cleaned up orphan temp file after submit failure: ${tempFilePath}`);
        } catch (cleanupError: any) {
          if (cleanupError?.code !== "ENOENT") {
            this.logger.warn(
              `Failed to clean up orphan temp file: ${tempFilePath}`,
              cleanupError,
            );
          }
        }
      }

      this.logger.error("Failed to submit file for processing", error);
      throw error;
    }
  }

  /**
   * Get file processing status
   */
  async getFileStatus(fileId: string, userId: string) {
    const actualUserId = typeof userId === 'object' ? String((userId as any).id ?? (userId as any).sub ?? userId) : String(userId);
    const file = await this.processedFile.findFirst({
      where: {
        id: fileId,
        userId: actualUserId,
      },
    });

    if (!file) {
      throw new NotFoundException("File not found");
    }

    return {
      id: file.id,
      originalName: file.originalName,
      status: file.status,
      fileType: file.fileType,
      fileSize: file.fileSize,
      hasParsedContent: !!file.parsedContent, // Indicate if markdown is available
      metadata: file.metadata ? JSON.parse(file.metadata) : null,
      createdAt: file.createdAt,
      processedAt: file.processedAt,
    };
  }

  /**
   * Get markdown content directly from database
   * No file system access needed
   */
  async getMarkdownContent(fileId: string, userId: string): Promise<string> {
    const actualUserId = typeof userId === 'object' ? String((userId as any).id ?? (userId as any).sub ?? userId) : String(userId);
    const file = await this.processedFile.findFirst({
      where: {
        id: fileId,
        userId: actualUserId,
      },
    });

    if (!file) {
      throw new NotFoundException("File not found");
    }

    if (file.status !== FileProcessingStatus.COMPLETED) {
      throw new Error("File processing not completed");
    }

    if (!file.parsedContent) {
      throw new Error("Markdown content not available");
    }

    // Return markdown content directly from database
    return file.parsedContent;
  }

  /**
   * Update markdown content in database
   */
  async updateMarkdownContent(fileId: string, userId: string, content: string): Promise<void> {
    const actualUserId = typeof userId === 'object' ? String((userId as any).id ?? (userId as any).sub ?? userId) : String(userId);
    const file = await this.processedFile.findFirst({
      where: {
        id: fileId,
        userId: actualUserId,
      },
    });

    if (!file) {
      throw new NotFoundException("File not found");
    }

    await this.processedFile.update({
      where: { id: fileId },
      data: { parsedContent: content },
    });
  }

  /**
   * Return processed file record including parsedContent and metadata
   */
  async getFileWithParsedContent(fileId: string, userId: string) {
    const actualUserId = typeof userId === 'object' ? String((userId as any).id ?? (userId as any).sub ?? userId) : String(userId);
    const file = await this.processedFile.findFirst({
      where: { id: fileId, userId: actualUserId },
      select: {
        id: true,
        originalName: true,
        fileType: true,
        fileSize: true,
        status: true,
        parsedContent: true,
        metadata: true,
        createdAt: true,
        processedAt: true,
      },
    });

    if (!file) throw new NotFoundException('File not found');

    return {
      ...file,
      metadata: file.metadata ? JSON.parse(file.metadata) : null,
    };
  }

  /**
   * List all files for a user
   */
  async listFiles(
    userId: string,
    status?: FileProcessingStatus,
    skip = 0,
    take = 20,
  ) {
    const actualUserId = typeof userId === 'object' ? String((userId as any).id ?? (userId as any).sub ?? userId) : String(userId);
    const where: any = { userId: actualUserId };
    if (status) {
      where.status = status;
    }

    // Ensure pagination params are integers (Prisma expects Int)
    const skipNum = Number.isFinite(Number(skip)) ? Math.max(0, Math.trunc(Number(skip))) : 0;
    const takeNum = Number.isFinite(Number(take)) ? Math.max(1, Math.trunc(Number(take))) : 20;

    const [rawFiles, total] = await Promise.all([
      this.processedFile.findMany({
        where,
        skip: skipNum,
        take: takeNum,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          originalName: true,
          fileType: true,
          fileSize: true,
          status: true,
          createdAt: true,
          processedAt: true,
          parsedContent: true,
          metadata: true,
        },
      }),
      this.processedFile.count({ where }),
    ]);

    const files = rawFiles.map((f: any) => ({
      id: f.id,
      originalName: f.originalName,
      fileType: f.fileType,
      fileSize: f.fileSize,
      status: f.status,
      createdAt: f.createdAt,
      processedAt: f.processedAt,
      hasParsedContent: !!f.parsedContent,
      metadata: f.metadata ? JSON.parse(f.metadata) : null,
    }));

    return {
      files,
      total,
      skip: skipNum,
      take: takeNum,
    };
  }

  /**
   * Delete a file
   * Only deletes the original file from disk and the database record
   * Markdown content is stored in DB, so no markdown file to delete
   */
  async deleteFile(fileId: string, userId: string): Promise<void> {
    const actualUserId = typeof userId === 'object' ? String((userId as any).id ?? (userId as any).sub ?? userId) : String(userId);
    const file = await this.processedFile.findFirst({
      where: {
        id: fileId,
        userId: actualUserId,
      },
    });

    if (!file) {
      throw new NotFoundException("File not found");
    }

    // If there was an original filePath stored (legacy), attempt deletion
    if (file.filePath) {
      try {
        await fs.unlink(file.filePath);
        this.logger.log(`Deleted original file: ${file.filePath}`);
      } catch (error: any) {
        if (error?.code !== "ENOENT") {
          this.logger.warn(
            `Failed to delete file from disk: ${file.filePath}`,
            error,
          );
        }
      }
    }

    // Delete from database (this includes the parsedContent)
    await this.processedFile.delete({
      where: { id: fileId },
    });
  }

  private getFileType(extension: string): string {
    const ext = extension.toLowerCase().replace(".", "");
    const typeMap: { [key: string]: string } = {
      pdf: "pdf",
      txt: "txt",
      xlsx: "xlsx",
      xls: "xls",
      csv: "csv",
      png: "png",
      jpg: "jpg",
      jpeg: "jpeg",
      tiff: "tiff",
      gif: "gif",
      webp: "webp",
      pptx: "pptx",
      ppt: "ppt",
      docx: "docx",
      doc: "doc",
    };

    return typeMap[ext] || ext;
  }
}
