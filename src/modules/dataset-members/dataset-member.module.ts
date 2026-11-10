import { Module } from '@nestjs/common';
import { DatasetMembersService } from './dataset-members.service';
import { DatasetMembersController } from './dataset-member.controller';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { ValidationService } from '@common/services/validation.service'; 

/**
 * @module DatasetMembersModule
 * @description NestJS Module quản lý phân quyền thành viên và chia sẻ Dataset (Dataset Access Control Management).
 */
@Module({
  imports: [PrismaModule], 
  controllers: [DatasetMembersController],
  providers: [
    DatasetMembersService, 
    ValidationService 
  ],
})
export class DatasetMembersModule {}