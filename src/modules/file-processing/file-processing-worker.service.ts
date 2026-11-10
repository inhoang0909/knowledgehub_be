import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PgBossService } from '../pg-boss/pg-boss.service';
import { OCRService } from './services/ocr.service';
import { GotenbergService } from './services/gotenberg.service';
import { PrismaService } from '../prisma/prisma.service';
import { FileTypeDetector } from './utils/file-type-detector';
import * as fs from 'fs/promises';

export enum FileProcessingStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface FileProcessingJob {
  fileId: string;
  filePath: string;
  fileName?: string;
  fileType: string;
  userId: string;
}

@Injectable()
export class FileProcessingWorkerService implements OnModuleInit {
  private readonly logger = new Logger(FileProcessingWorkerService.name);
  private readonly QUEUE_NAME = 'file-processing';

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly ocrService: OCRService,
    private readonly gotenbergService: GotenbergService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.registerWorker();
  }

  private async registerWorker() {
    await this.pgBossService.work<FileProcessingJob>(
      this.QUEUE_NAME,
      async (job) => {
        this.logger.log(`Processing job ${job.id} for file ${job.data.filePath}`);
        await this.processFile(job.data);
      },
    );
  }

  async processFile(jobData: FileProcessingJob): Promise<void> {
    const filesToClean: string[] = []; // Chứa file gốc lúc user upload
    const { fileId } = jobData;
    let fileType = jobData.fileType;
    const filePath = jobData.filePath;

    try {
      await this.updateFileStatus(fileId, FileProcessingStatus.PROCESSING);

      if (!filePath) throw new Error('Missing filePath in processing job');
      filesToClean.push(filePath);

      const detectedType = await FileTypeDetector.detectFileType(filePath);
      if (detectedType && !FileTypeDetector.typesMatch(detectedType, fileType)) {
        fileType = detectedType;
      }

      let result: any = {};
      let markdown: string | undefined = undefined;

      switch (fileType.toLowerCase()) {
        case 'pptx':
        case 'ppt': {
          this.logger.log(`Converting ${fileType.toUpperCase()} to PDF using Gotenberg...`);
          const conversionResult = await this.gotenbergService.convertToPdf(filePath);

          if (!conversionResult.success || !conversionResult.pdfPath) {
            throw new Error(`Failed to convert ${fileType.toUpperCase()} to PDF: ${conversionResult.error}`);
          }
          this.logger.log(`Successfully converted to PDF: ${conversionResult.pdfPath}`);

          // QUAN TRỌNG: Lưu đường dẫn PDF và thư mục tạm vào metadata để Cron Job đọc và dọn dẹp sau khi upload lên Dify
          result = {
            metadata: {
              convertedPdfPath: conversionResult.pdfPath,
              tempDirToCleanByCron: conversionResult.tempDir
            }
          };
          break;
        }

        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'tiff':
        case 'gif':
        case 'webp': {
          this.logger.log(`Detected image file. Sending ${filePath} to OCR.`);
          const ocrRes = await this.ocrService.processImage(filePath);
          if (!ocrRes.success) throw new Error(ocrRes.error);
          
          markdown = ocrRes.content || '';
          result = { metadata: { pages: 1 } };
          break;
        }

        default:
          throw new Error(`File type ${fileType} bypasses Worker. It should be Direct Upload.`);
      }

      // Đánh dấu xong, truyền DB cho Cron xử lý tiếp
      await this.updateFileStatus(fileId, FileProcessingStatus.COMPLETED, markdown, result.metadata);
      this.logger.log(`Successfully processed file ${fileId}`);

    } catch (error) {
      this.logger.error(`Failed to process file ${fileId}`, error);
      await this.updateFileStatus(fileId, FileProcessingStatus.FAILED, undefined, { error: error.message });
      throw error;
    } finally {
      // Worker CHỈ xóa file gốc mà user upload. Không xóa file PDF vừa convert (để dành cho Cron Job)
      for (const file of filesToClean) {
        try {
          await fs.unlink(file);
        } catch (err: any) {
          if (err?.code !== 'ENOENT') this.logger.warn(`Failed to cleanup temp file: ${file}`);
        }
      }
    }
  }

  private async updateFileStatus(fileId: string, status: FileProcessingStatus, parsedContent?: string, metadata?: any): Promise<void> {
    try {
      await (this.prisma as any).processedFile.update({
        where: { id: fileId },
        data: {
          status,
          parsedContent,
          metadata: metadata ? JSON.stringify(metadata) : undefined,
          processedAt: status === FileProcessingStatus.COMPLETED ? new Date() : undefined,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to update file status for ${fileId}`, error);
    }
  }
}