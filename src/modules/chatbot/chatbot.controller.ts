import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  Request,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthGuard } from '@common/guards/auth.guard';
import { ChatbotService } from './chatbot.service';
import { AnnotationService } from './annotation.service';
import { UpsertAnnotationDto } from './dto/upsert-annotation.dto';
import { CreateDifyAnnotationDto } from './dto/create-dify-annotation.dto';
import { CreateChatbotDto } from './dto/create-chatbot.dto';

/**
 * @class ChatbotController
 * @description Controller trung tâm xử lý toàn bộ các API liên quan tới Chatbot, Chat Streaming SSE, Annotations & Live Dataset Logs.
 */
@ApiTags('Chatbot')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('api')
export class ChatbotController {
  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly annotationService: AnnotationService,
  ) {}

  /**
   * API Tạo Chatbot mới trên Dify với Name, Role và danh sách Datasets liên kết
   */
  @Post('chatbots')
  @ApiOperation({ summary: 'Tạo Chatbot mới với Name, Role và Dataset được liên kết' })
  createChatbot(@Body() dto: CreateChatbotDto) {
    return this.chatbotService.createChatbot(dto);
  }

  /**
   * API Xóa Chatbot khỏi Dify qua Console API
   */
  @Delete('chatbots/:difyAppId')
  @ApiOperation({ summary: 'Xóa Chatbot khỏi Dify qua Dify Console API' })
  @ApiParam({ name: 'difyAppId', description: 'Dify App UUID', type: String })
  deleteChatbot(@Param('difyAppId') difyAppId: string) {
    return this.chatbotService.deleteChatbot(difyAppId);
  }

  /**
   * API Lưu/Cập nhật bản nháp Annotation (DRAFT) cho một tin nhắn trong Local DB
   */
  @Post('messages/:messageId/annotations')
  @ApiOperation({ summary: 'Lưu annotation (DRAFT) cho một message' })
  @ApiParam({ name: 'messageId', type: Number })
  upsertAnnotation(
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() dto: UpsertAnnotationDto,
    @Request() req: any,
  ) {
    return this.annotationService.upsertAnnotation(messageId, dto, req.user);
  }

  /**
   * API Xuất bản Annotation (PUBLISH) — Đẩy câu trả lời đã sửa lên Dify Dataset
   */
  @Post('annotations/:id/publish')
  @ApiOperation({ summary: 'Publish annotation lên Dify Dataset' })
  @ApiParam({ name: 'id', type: Number })
  publishAnnotation(
    @Param('id', ParseIntPipe) annotationId: number,
    @Request() req: any,
  ) {
    return this.annotationService.publishAnnotation(annotationId, req.user);
  }

  /**
   * API Truy xuất toàn bộ Lịch sử Chat trực tiếp từ Dify DB theo Dataset ID
   */
  @Get('datasets/:difyDatasetId/live-logs')
  @ApiOperation({ summary: 'Lấy toàn bộ lịch sử chat trực tiếp từ Dify DB theo Dataset ID' })
  @ApiParam({ name: 'difyDatasetId', description: 'Dify Dataset UUID', type: String })
  getLiveDatasetLogs(@Param('difyDatasetId') difyDatasetId: string) {
    return this.chatbotService.getLiveDatasetLogs(difyDatasetId);
  }

  /**
   * API Lấy Site Token (Mã Iframe) để nhúng Chatbot Widget vào Website
   */
  @Get('chatbots/:difyAppId/site-token')
  @ApiOperation({ summary: 'Lấy site token (iframe code) cho một Dify app' })
  @ApiParam({ name: 'difyAppId', description: 'Dify App UUID', type: String })
  getSiteToken(@Param('difyAppId') difyAppId: string) {
    return this.chatbotService.getSiteTokenForApp(difyAppId);
  }

  /**
   * API Lấy tất cả Annotations của một Chatbot App từ Dify Console API
   */
  @Get('chatbots/:difyAppId/annotations')
  @ApiOperation({ summary: 'Lấy tất cả annotations cho một Dify app từ Dify DB' })
  @ApiParam({ name: 'difyAppId', description: 'Dify App UUID', type: String })
  getAnnotations(@Param('difyAppId') difyAppId: string) {
    return this.annotationService.getAnnotationsByAppId(difyAppId);
  }

  /**
   * API Cập nhật Annotation trực tiếp trên Dify Console API
   */
  @Put('chatbots/:difyAppId/annotations/:annotationId')
  @ApiOperation({ summary: 'Cập nhật annotation qua Dify Console API' })
  @ApiParam({ name: 'difyAppId', description: 'Dify App UUID', type: String })
  @ApiParam({ name: 'annotationId', description: 'Annotation ID', type: String })
  updateAnnotation(
    @Param('difyAppId') difyAppId: string,
    @Param('annotationId') annotationId: string,
    @Body() body: { question: string; answer: string },
  ) {
    return this.annotationService.updateAnnotation(difyAppId, annotationId, body.question, body.answer);
  }

  /**
   * API Xóa Annotation trực tiếp trên Dify Console API
   */
  @Delete('chatbots/:difyAppId/annotations/:annotationId')
  @ApiOperation({ summary: 'Xóa annotation qua Dify Console API' })
  @ApiParam({ name: 'difyAppId', description: 'Dify App UUID', type: String })
  @ApiParam({ name: 'annotationId', description: 'Annotation ID', type: String })
  deleteAnnotation(
    @Param('difyAppId') difyAppId: string,
    @Param('annotationId') annotationId: string,
  ) {
    return this.annotationService.deleteAnnotation(difyAppId, annotationId);
  }

  /**
   * API Tạo Annotation mới trực tiếp trên Dify Console API
   */
  @Post('chatbots/:difyAppId/annotations')
  @ApiOperation({ summary: 'Tạo annotation trên Dify cho một message' })
  @ApiParam({ name: 'difyAppId', description: 'Dify App UUID', type: String })
  createDifyAnnotation(
    @Param('difyAppId') difyAppId: string,
    @Body() dto: CreateDifyAnnotationDto,
  ) {
    return this.annotationService.createDifyAnnotation(difyAppId, dto);
  }

  /**
   * API Đồng bộ nhanh tin nhắn từ Dify DB sang Local DB trước khi thực hiện Annotate
   */
  @Post('messages/upsert-dify')
  @ApiOperation({ summary: 'Đồng bộ nhanh tin nhắn từ Dify DB sang Local DB trước khi Annotate' })
  upsertDifyMessage(
    @Body() body: {
      difyMessageId: string;
      difyConversationId: string;
      difyAppId: string;
      query: string;
      answer: string;
    }
  ) {
    return this.chatbotService.upsertDifyMessage(body);
  }

  /**
   * API Proxy Chat Streaming SSE — Gửi câu hỏi tới Dify AI và Stream phản hồi dạng Server-Sent Events
   */
  @Post('chatbots/:difyAppId/chat-stream')
  @ApiOperation({ summary: 'Gửi tin nhắn tới Dify và stream phản hồi qua SSE' })
  @ApiParam({ name: 'difyAppId', description: 'Dify App UUID', type: String })
  async chatStream(
    @Param('difyAppId') difyAppId: string,
    @Body() body: { query: string; conversationId?: string; userId?: string },
    @Res() res: Response,
    @Request() req: any,
  ) {
    const userId = req?.user?.id ? `user-${req.user.id}` : (body.userId || 'dify-wrapper-user');
    await this.chatbotService.proxyChatStream(difyAppId, { ...body, userId }, res);
  }

  /**
   * API Xóa một Cuộc trò chuyện cụ thể khỏi Dify DB và Local DB (Kiểm tra quyền Editor trở lên trên Dataset)
   */
  @Delete('datasets/:difyDatasetId/conversations/:conversationId')
  @ApiOperation({ summary: 'Xóa một cuộc trò chuyện cụ thể (Kiểm tra quyền truy cập Dataset)' })
  @ApiParam({ name: 'difyDatasetId', description: 'Dify Dataset UUID', type: String })
  @ApiParam({ name: 'conversationId', description: 'Dify Conversation UUID', type: String })
  deleteLiveConversation(
    @Param('difyDatasetId') difyDatasetId: string,
    @Param('conversationId') conversationId: string,
    @Request() req: any,
  ) {
    return this.chatbotService.deleteLiveConversation(difyDatasetId, conversationId, req.user);
  }
}
