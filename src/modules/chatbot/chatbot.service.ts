import { Injectable } from "@nestjs/common";
import { Response } from "express";
import { User } from "@prisma/client";
import { CreateChatbotDto } from "./dto/create-chatbot.dto";
import { ChatbotAdminService } from "./services/chatbot-admin.service";
import { ChatbotStreamService } from "./services/chatbot-stream.service";
import { ChatbotLogsService } from "./services/chatbot-logs.service";
import { ChatbotConversationService } from "./services/chatbot-conversation.service";

/**
 * @class ChatbotService
 * @description Facade Service trung tâm của Chatbot Module. 
 * Uỷ quyền nhiệm vụ chuyên biệt cho các sub-services gọn gàng (< 300 lines mỗi file):
 * - ChatbotAdminService: Quản trị ứng dụng (Tạo/Xóa app, Cấu hình prompt/model)
 * - ChatbotStreamService: Proxy SSE Stream & Site Tokens
 * - ChatbotLogsService: Truy xuất lịch sử chat trực tiếp & Upsert message
 * - ChatbotConversationService: Quản lý & Xóa cuộc trò chuyện
 */
@Injectable()
export class ChatbotService {
  constructor(
    private readonly adminService: ChatbotAdminService,
    private readonly streamService: ChatbotStreamService,
    private readonly logsService: ChatbotLogsService,
    private readonly conversationService: ChatbotConversationService,
  ) {}

  /** Lấy lịch sử chat trực tiếp từ Dify DB theo Dataset ID */
  getLiveDatasetLogs(difyDatasetId: string) {
    return this.logsService.getLiveDatasetLogs(difyDatasetId);
  }

  /** Đồng bộ nhanh một tin nhắn Dify sang Local DB */
  upsertDifyMessage(body: {
    difyMessageId: string;
    difyConversationId: string;
    difyAppId: string;
    query: string;
    answer: string;
  }) {
    return this.logsService.upsertDifyMessage(body);
  }

  /** Truy xuất Site Token (iframe code) cho Chatbot App */
  getSiteTokenForApp(difyAppId: string) {
    return this.streamService.getSiteTokenForApp(difyAppId);
  }

  /** Proxy SSE Stream chat-message từ Dify API về client */
  proxyChatStream(
    difyAppId: string,
    body: { query: string; conversationId?: string; userId?: string },
    res: Response,
  ) {
    return this.streamService.proxyChatStream(difyAppId, body, res);
  }

  /** Tạo Chatbot mới trên Dify qua Console API */
  createChatbot(dto: CreateChatbotDto) {
    return this.adminService.createChatbot(dto);
  }

  /** Xóa Chatbot khỏi Dify qua Console API */
  deleteChatbot(difyAppId: string) {
    return this.adminService.deleteChatbot(difyAppId);
  }

  /** Xóa 1 cuộc trò chuyện cụ thể */
  deleteLiveConversation(
    difyDatasetId: string,
    conversationId: string,
    user: User,
  ) {
    return this.conversationService.deleteLiveConversation(difyDatasetId, conversationId, user);
  }
}
