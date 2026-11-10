import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { DepartmentsModule } from '@/modules/departments/departments.module';
import { DatasetsModule } from '@/modules/datasets/datasets.module';
import { SegmentsModule } from '@/modules/segments/segments.module';
import { DocumentsModule } from '@/modules/documents/documents.module';
import { UsersModule } from '@/modules/users/users.module';
import { DatasetMembersModule } from '@/modules/dataset-members/dataset-member.module';
import { CategoriesModule } from '@/modules/categories/categories.module';
import { ScheduleModule } from '@nestjs/schedule';
import { PgBossModule } from '@/modules/pg-boss/pg-boss.module';
import { FileProcessingModule } from '@/modules/file-processing/file-processing.module';
import { RedisModule } from '@/modules/redis/redis.module';
import { ChatbotModule } from '@/modules/chatbot/chatbot.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // Global Config
    ScheduleModule.forRoot(), // Đăng ký ScheduleModule để sử dụng Cron Jobs
    PrismaModule, // Global Module
    PgBossModule, // Job Queue Management
    RedisModule, // Redis Service for caching and data storage
    AuthModule,
    DepartmentsModule,
    DatasetsModule,
    SegmentsModule,
    DocumentsModule,
    UsersModule,
    DatasetMembersModule,
    CategoriesModule,
    FileProcessingModule,
    ChatbotModule,

  ],
})
export class AppModule { }