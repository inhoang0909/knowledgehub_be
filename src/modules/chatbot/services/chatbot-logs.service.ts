import { Injectable, Logger, InternalServerErrorException } from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { DifyDbService } from "../dify-db.service";

/**
 * @class ChatbotLogsService
 * @description Sub-service chuyên trách truy xuất Lịch sử Chat trực tiếp từ Dify DB & Đồng bộ Message local.
 * 
 * Luồng hoạt động chính:
 * 1. `getLiveDatasetLogs`:
 *    - Thực thi truy vấn SQL JOIN 5 bảng trên Dify DB (`app_dataset_joins`, `apps`, `conversations`, `end_users`, `messages`).
 *    - Gom nhóm dữ liệu trả về theo Cấu trúc Phân cấp: `Chatbot App` -> `Conversations` -> `Messages`.
 *    - Tra cứu và đính kèm trạng thái Annotation (Hiệu chỉnh) tương ứng từ Local Prisma DB.
 * 2. `upsertDifyMessage`:
 *    - Tạo hoặc cập nhật bản ghi `Conversation` và `Message` từ Dify vào Local Prisma DB để phục vụ tính năng Annotation.
 */
@Injectable()
export class ChatbotLogsService {
  private readonly logger = new Logger(ChatbotLogsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly difyDb: DifyDbService,
  ) {}

  /**
   * Lấy toàn bộ lịch sử chat trực tiếp từ Dify DB theo Dataset ID
   * 
   * @param difyDatasetId UUID của Dify Dataset
   * @returns Mảng cấu trúc gom nhóm Chatbots -> Conversations -> Messages (Kèm thông tin Annotation nếu có)
   */
  async getLiveDatasetLogs(difyDatasetId: string) {
    // Câu lệnh SQL JOIN lấy dữ liệu lịch sử chat đa tầng
    const sql = `
      SELECT 
          a.id AS dify_app_id,
          a.name AS chatbot_name,
          c.id AS conversation_id,
          c.name AS conversation_name,
          eu.session_id AS user_identifier,
          m.id AS dify_message_id,
          m.query AS user_query,
          m.answer AS bot_answer,
          m.created_at
      FROM 
          app_dataset_joins adj
      JOIN 
          apps a ON adj.app_id = a.id
      LEFT JOIN 
          conversations c ON a.id = c.app_id
      LEFT JOIN
          end_users eu ON c.from_end_user_id = eu.id
      LEFT JOIN 
          messages m ON c.id = m.conversation_id
      WHERE 
          adj.dataset_id = $1 AND a.status = 'normal'
      ORDER BY 
          a.created_at DESC,
          c.created_at DESC, 
          m.created_at ASC
    `;

    try {
      // 1. Thực thi Raw SQL Query tới Dify DB Connection Pool
      const result = await this.difyDb.query(sql, [difyDatasetId]);
      const rows = result.rows;

      if (rows.length === 0) {
        return [];
      }

      // 2. Tra cứu mảng Annotations đã được lưu trong Local Prisma DB
      const difyMsgIds = rows.map((r) => r.dify_message_id).filter(Boolean);
      const localMsgs = difyMsgIds.length > 0 ? await this.prisma.message.findMany({
        where: { difyMessageId: { in: difyMsgIds } },
        include: {
          annotation: {
            select: {
              id: true,
              expectedAnswer: true,
              status: true,
              updatedAt: true,
            },
          },
        },
      }) : [];
      const localMsgMap = new Map(localMsgs.map((m) => [m.difyMessageId, m]));

      // 3. Gom nhóm dữ liệu dạng Phân cấp 3 tầng (App -> Conversation -> Messages)
      const groupedData = rows.reduce((acc, row) => {
        let chatbot = acc.find((c) => c.difyAppId === row.dify_app_id);
        if (!chatbot) {
          chatbot = {
            difyAppId: row.dify_app_id,
            chatbotName: row.chatbot_name,
            conversations: [],
          };
          acc.push(chatbot);
        }

        if (row.conversation_id) {
          let conversation = chatbot.conversations.find(
            (c) => c.conversationId === row.conversation_id,
          );
          if (!conversation) {
            conversation = {
              conversationId: row.conversation_id,
              conversationName: row.conversation_name,
              userIdentifier: row.user_identifier || null,
              messages: [],
            };
            chatbot.conversations.push(conversation);
          }

          if (row.dify_message_id) {
            const localMsg = localMsgMap.get(row.dify_message_id);

            conversation.messages.push({
              id: localMsg ? localMsg.id : null,
              difyMessageId: row.dify_message_id,
              difyConversationId: row.conversation_id,
              difyAppId: row.dify_app_id,
              userQuery: row.user_query,
              botAnswer: row.bot_answer,
              createdAt: row.created_at,
              feedback: localMsg ? localMsg.feedback : "NONE",
              annotation: localMsg ? localMsg.annotation : null,
            });
          }
        }

        return acc;
      }, []);

      return groupedData;
    } catch (err) {
      this.logger.error(
        `getLiveDatasetLogs failed for dataset ${difyDatasetId}:`,
        err instanceof Error ? err.message : String(err),
      );
      throw new InternalServerErrorException(
        "Lỗi khi truy xuất toàn bộ dữ liệu tin nhắn từ Dify DB.",
      );
    }
  }

  /**
   * Đồng bộ nhanh một tin nhắn Dify cụ thể sang Local DB để chuẩn bị Annotate
   * 
   * @param body Thông tin tin nhắn (`difyMessageId`, `difyConversationId`, `difyAppId`, `query`, `answer`)
   */
  async upsertDifyMessage(body: {
    difyMessageId: string;
    difyConversationId: string;
    difyAppId: string;
    query: string;
    answer: string;
  }) {
    // Tạo hoặc cập nhật bản ghi Conversation trước
    const conversation = await this.prisma.conversation.upsert({
      where: { difyConversationId: body.difyConversationId },
      update: {},
      create: {
        difyConversationId: body.difyConversationId,
        difyAppId: body.difyAppId,
      },
    });

    // Upsert bản ghi Message
    return this.prisma.message.upsert({
      where: { difyMessageId: body.difyMessageId },
      update: {},
      create: {
        difyMessageId: body.difyMessageId,
        conversationId: conversation.id,
        query: body.query ?? "",
        answer: body.answer ?? "",
      },
      include: {
        annotation: {
          select: {
            id: true,
            expectedAnswer: true,
            status: true,
            updatedAt: true,
          },
        },
      },
    });
  }
}
