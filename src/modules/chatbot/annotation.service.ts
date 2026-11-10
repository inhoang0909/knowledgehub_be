import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { DifyClientService } from "../dify-client/dify-client.service";
import { DifyConsoleAuthService } from "./dify-console-auth.service";
import { User } from "@prisma/client";
import { UpsertAnnotationDto } from "./dto/upsert-annotation.dto";

/**
 * @class AnnotationService
 * @description Service quản lý Hiệu chỉnh / Sửa lỗi câu trả lời của AI Chatbot (Annotations).
 * 
 * Luồng hoạt động chính:
 * 1. `upsertAnnotation`: Lưu bản nháp (DRAFT) câu trả lời kỳ vọng (expectedAnswer) của Admin cho một tin nhắn cụ thể vào Local DB.
 * 2. `publishAnnotation`: Đóng gói cặp Q&A đã hiệu chỉnh thành file văn bản và đẩy lên Dify Dataset (Knowledge Base) để huấn luyện/tinh chỉnh lại AI.
 * 3. Quản lý Annotation trên Dify Console API (Get, Create, Update, Delete).
 */
@Injectable()
export class AnnotationService {
  private readonly logger = new Logger(AnnotationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly difyClient: DifyClientService,
    private readonly consoleAuth: DifyConsoleAuthService,
  ) {}

  /**
   * Lưu hoặc Cập nhật bản nháp Annotation (Status: DRAFT) trong Local DB
   * 
   * @param messageId ID tin nhắn trong Local DB
   * @param dto Dữ liệu annotation (expectedAnswer, targetDatasetId)
   * @param user User (Admin/Manager) thực hiện sửa lỗi
   */
  async upsertAnnotation(
    messageId: number,
    dto: UpsertAnnotationDto,
    user: User,
  ) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message)
      throw new NotFoundException(`Message #${messageId} không tồn tại`);

    return this.prisma.annotation.upsert({
      where: { messageId },
      update: {
        expectedAnswer: dto.expectedAnswer,
        targetDatasetId: dto.targetDatasetId,
        status: "DRAFT",
        updatedAt: new Date(),
      },
      create: {
        messageId,
        expectedAnswer: dto.expectedAnswer,
        targetDatasetId: dto.targetDatasetId,
        createdById: user.id,
        status: "DRAFT",
      },
    });
  }

  /**
   * Xuất bản Annotation (Status: PUBLISHED) — Đẩy cặp Hỏi-Đáp vào Dify Dataset được chọn
   * 
   * @param annotationId ID bản ghi Annotation trong Local DB
   * @param user User thực hiện xuất bản
   */
  async publishAnnotation(annotationId: number, user: User) {
    const annotation = await this.prisma.annotation.findUnique({
      where: { id: annotationId },
      include: {
        message: true,
        targetDataset: {
          select: { id: true, name: true, difyDatasetId: true },
        },
      },
    });

    if (!annotation)
      throw new NotFoundException(`Annotation #${annotationId} không tồn tại`);

    // Tạo nội dung văn bản chuẩn Q&A
    const qaText = `Question: ${annotation.message.query}\n\nAnswer: ${annotation.expectedAnswer}`;
    const docName = `annotation-${annotationId}-message-${annotation.messageId}`;

    // Đẩy sang Dify Dataset thông qua Container Document API
    await this.difyClient.createContainerDocument(
      annotation.targetDataset.difyDatasetId,
      docName,
      Buffer.from(qaText, "utf-8"),
      `${docName}.txt`,
    );

    // Cập nhật trạng thái thành PUBLISHED
    return this.prisma.annotation.update({
      where: { id: annotationId },
      data: { status: "PUBLISHED" },
    });
  }

  /**
   * Lấy danh sách tất cả Annotations của một Chatbot App từ Dify Console API
   * 
   * @param difyAppId UUID của Dify App
   */
  async getAnnotationsByAppId(difyAppId: string): Promise<any[]> {
    const url = `${this.consoleAuth.consoleBaseUrl}/console/api/apps/${difyAppId}/annotations`;

    try {
      const fetch = (await import('node-fetch')).default;
      const doReq = async () =>
        fetch(url, {
          headers: { ...(await this.consoleAuth.getAuthHeaders()), 'Content-Type': 'application/json' },
        });

      let res = await doReq();
      if (res.status === 401) {
        this.consoleAuth.invalidate();
        res = await doReq();
      }
      if (!res.ok) {
        const errText = await res.text();
        this.logger.error(`getAnnotationsByAppId failed (${res.status}): ${errText}`);
        return [];
      }
      const data: any = await res.json();
      this.logger.log(`Retrieved ${data?.data?.length ?? 0} annotations for app ${difyAppId}`);
      return data?.data ?? [];
    } catch (err) {
      this.logger.error(`getAnnotationsByAppId failed for app ${difyAppId}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /**
   * Cập nhật Annotation trực tiếp trên Dify qua Console API
   */
  async updateAnnotation(difyAppId: string, annotationId: string, question: string, answer: string): Promise<any> {
    const url = `${this.consoleAuth.consoleBaseUrl}/console/api/apps/${difyAppId}/annotations/${annotationId}`;

    try {
      const fetch = (await import('node-fetch')).default;
      const doReq = async () =>
        fetch(url, {
          method: 'POST',
          headers: { ...(await this.consoleAuth.getAuthHeaders()), 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, answer }),
        });

      let res = await doReq();
      if (res.status === 401) {
        this.consoleAuth.invalidate();
        res = await doReq();
      }
      if (!res.ok) {
        const errText = await res.text();
        this.logger.error(`updateAnnotation failed (${res.status}): ${errText}`);
        if (res.status === 404) throw new NotFoundException(`Annotation ${annotationId} not found`);
        throw new InternalServerErrorException('Lỗi khi cập nhật annotation trên Dify.');
      }
      this.logger.log(`Updated annotation ${annotationId} via Console API`);
      return await res.json();
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof InternalServerErrorException) throw err;
      this.logger.error(`updateAnnotation failed for ${annotationId}:`, err instanceof Error ? err.message : String(err));
      throw new InternalServerErrorException('Lỗi khi cập nhật annotation trên Dify.');
    }
  }

  /**
   * Xóa Annotation trực tiếp trên Dify qua Console API
   */
  async deleteAnnotation(difyAppId: string, annotationId: string): Promise<{ success: boolean }> {
    const url = `${this.consoleAuth.consoleBaseUrl}/console/api/apps/${difyAppId}/annotations/${annotationId}`;

    try {
      const fetch = (await import('node-fetch')).default;
      const doReq = async () =>
        fetch(url, {
          method: 'DELETE',
          headers: { ...(await this.consoleAuth.getAuthHeaders()), 'Content-Type': 'application/json' },
        });

      let res = await doReq();
      if (res.status === 401) {
        this.consoleAuth.invalidate();
        res = await doReq();
      }
      if (!res.ok && res.status !== 404) {
        const errText = await res.text();
        this.logger.error(`deleteAnnotation failed (${res.status}): ${errText}`);
        throw new InternalServerErrorException('Lỗi khi xóa annotation trên Dify.');
      }
      this.logger.log(`Deleted annotation ${annotationId} via Console API`);
      return { success: true };
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err;
      this.logger.error(`deleteAnnotation failed for ${annotationId}:`, err instanceof Error ? err.message : String(err));
      throw new InternalServerErrorException('Lỗi khi xóa annotation trên Dify.');
    }
  }

  /**
   * Tạo Annotation mới trực tiếp trên Dify qua Console API
   */
  async createDifyAnnotation(
    difyAppId: string,
    data: { question: string; answer: string; message_id?: string },
  ): Promise<any> {
    const url = `${this.consoleAuth.consoleBaseUrl}/console/api/apps/${difyAppId}/annotations`;

    try {
      const fetch = (await import('node-fetch')).default;
      const doReq = async () =>
        fetch(url, {
          method: 'POST',
          headers: { ...(await this.consoleAuth.getAuthHeaders()), 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: data.question, answer: data.answer }),
        });

      let res = await doReq();
      if (res.status === 401) {
        this.consoleAuth.invalidate();
        res = await doReq();
      }
      if (!res.ok) {
        const errText = await res.text();
        this.logger.error(`createDifyAnnotation failed (${res.status}): ${errText}`);
        throw new InternalServerErrorException('Lỗi khi tạo annotation trên Dify.');
      }
      const created = await res.json();
      this.logger.log(`Successfully created annotation for app ${difyAppId} via Console API`);
      return created;
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err;
      this.logger.error(`createDifyAnnotation failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new InternalServerErrorException('Lỗi khi tạo annotation trên Dify.');
    }
  }
}
