import { Module } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { DepartmentsController } from './departments.controller';

/**
 * @module DepartmentsModule
 * @description NestJS Module quản lý cơ cấu Tổ chức và Phòng ban trong hệ thống (Department Management).
 */
@Module({
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
