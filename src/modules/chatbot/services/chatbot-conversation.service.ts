import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { User } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { DifyDbService } from "../dify-db.service";
import { ValidationService } from "@common/services/validation.service";

/**
 * @class ChatbotConversationService
 * @description Sub-service chuyên trách Quản lý & Xóa Cuộc trò chuyện (Conversations).
 * 
 * Luồng hoạt động chính:
 * 1. Kiểm tra tồn tại của Dataset trong Local DB và Gatekeep quyền người dùng (yêu cầu quyền `WRITE_DOCUMENT` - Editor trở lên).
 * 2. Xác minh cuộc trò chuyện có thuộc Dataset được chỉ định trên Dify DB hay không.
 * 3. Thực thi chuỗi 6 câu lệnh SQL xóa dây chuyền (Cascading Delete) trên Dify DB để giải phóng triệt để các bảng phụ thuộc.
 * 4. Dọn dẹp các bản ghi conversation/message cached tương ứng trong Local Prisma DB.
 */
@Injectable()
export class ChatbotConversationService {
  private readonly logger = new Logger(ChatbotConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly difyDb: DifyDbService,
    private readonly validationService: ValidationService,
  ) {}

  /**
   * Xóa 1 cuộc trò chuyện cụ thể (Kiểm tra quyền truy cập Dataset)
   * 
   * @param difyDatasetId UUID Dify Dataset
   * @param conversationId UUID Cuộc trò chuyện trên Dify DB
   * @param user User thực hiện yêu cầu xóa
   */
  async deleteLiveConversation(
    difyDatasetId: string,
    conversationId: string,
    user: User,
  ) {
    // -----------------------------------------------------------------
    // BƯỚC 1: Tìm Dataset và Kiểm tra Quyền truy cập của User
    // -----------------------------------------------------------------
    const dataset = await this.prisma.dataset.findUnique({
      where: { difyDatasetId },
    });

    if (!dataset) {
      throw new NotFoundException("Dataset không tồn tại");
    }

    // Yêu cầu quyền WRITE_DOCUMENT (Editor hoặc Manager) trên Dataset
    await this.validationService.validateDatasetAccess(
      dataset.id,
      user,
      "WRITE_DOCUMENT",
    );

    // -----------------------------------------------------------------
    // BƯỚC 2: Kiểm tra cuộc trò chuyện có thuộc Dataset này hay không
    // -----------------------------------------------------------------
    const checkSql = `
      SELECT c.id
      FROM conversations c
      JOIN app_dataset_joins adj ON c.app_id = adj.app_id
      WHERE c.id = $1 AND adj.dataset_id = $2
    `;
    const checkRes = await this.difyDb.query(checkSql, [
      conversationId,
      difyDatasetId,
    ]);

    if (checkRes.rows.length === 0) {
      throw new NotFoundException(
        "Cuộc trò chuyện không tồn tại hoặc không thuộc dataset này",
      );
    }

    // -----------------------------------------------------------------
    // BƯỚC 3: Xóa Dây chuyền (Cascading Delete) trên Dify DB
    // -----------------------------------------------------------------
    const deleteQueries = [
      `DELETE FROM message_feedbacks WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = $1)`,
      `DELETE FROM message_annotations WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = $1)`,
      `DELETE FROM message_agent_thoughts WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = $1)`,
      `DELETE FROM messages WHERE conversation_id = $1`,
      `DELETE FROM conversation_variables WHERE conversation_id = $1`,
      `DELETE FROM conversations WHERE id = $1`,
    ];

    for (const query of deleteQueries) {
      try {
        await this.difyDb.query(query, [conversationId]);
      } catch (err: any) {
        this.logger.warn(
          `Non-fatal SQL warning during conversation ${conversationId} delete: ${err.message}`,
        );
      }
    }

    // -----------------------------------------------------------------
    // BƯỚC 4: Dọn dẹp dữ liệu lưu tạm trong Local Prisma DB
    // -----------------------------------------------------------------
    try {
      await this.prisma.message.deleteMany({
        where: { conversation: { difyConversationId: conversationId } },
      });
      await this.prisma.conversation.deleteMany({
        where: { difyConversationId: conversationId },
      });
    } catch (err: any) {
      this.logger.warn(
        `Local DB cleanup warning for conversation ${conversationId}: ${err.message}`,
      );
    }

    return {
      success: true,
      message: "Xóa cuộc trò chuyện thành công",
      conversationId,
    };
  }
}
