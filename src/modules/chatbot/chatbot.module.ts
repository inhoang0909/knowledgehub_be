import { Module } from '@nestjs/common';
import { ChatbotService } from './chatbot.service';
import { AnnotationService } from './annotation.service';
import { ChatbotController } from './chatbot.controller';
import { DifyDbService } from './dify-db.service';
import { DifyConsoleAuthService } from './dify-console-auth.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DifyClientModule } from '../dify-client/dify-client.module';
import { ValidationService } from '@common/services/validation.service';
import { ChatbotAdminService } from './services/chatbot-admin.service';
import { ChatbotStreamService } from './services/chatbot-stream.service';
import { ChatbotLogsService } from './services/chatbot-logs.service';
import { ChatbotConversationService } from './services/chatbot-conversation.service';

@Module({
  imports: [
    PrismaModule,       // for PrismaService
    DifyClientModule,   // for DifyClientService (publish annotation → Dify API)
  ],
  controllers: [ChatbotController],
  providers: [
    ChatbotService,
    ChatbotAdminService,
    ChatbotStreamService,
    ChatbotLogsService,
    ChatbotConversationService,
    AnnotationService,
    DifyDbService,              // raw pg pool for Dify DB direct queries
    DifyConsoleAuthService,     // auto-login for Dify Console API
    ValidationService,
  ],
  exports: [
    ChatbotService, 
    ChatbotAdminService,
    ChatbotStreamService,
    ChatbotLogsService,
    ChatbotConversationService,
    AnnotationService,
  ],
})
export class ChatbotModule {}
