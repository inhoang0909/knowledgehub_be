import { Controller, Get, UseGuards } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { AuthGuard } from '@common/guards/auth.guard';
import { ActiveUser } from '@common/decorators/active-user.decorator';
import { User } from '@prisma/client';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

/**
 * @class DepartmentsController
 * @description Controller xử lý các yêu cầu API liên quan đến Phòng ban / Bộ phận trong hệ thống (Department Management).
 * 
 * Cung cấp API:
 * - `GET /api/departments`: Lấy danh sách toàn bộ các phòng ban để phục vụ dropdown phân quyền và tạo danh mục.
 */
@ApiTags('Departments')
@Controller('/api/departments')
@ApiBearerAuth()
@UseGuards(AuthGuard) // Bảo vệ toàn bộ các endpoint bằng JWT AuthGuard
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  /**
   * API Lấy danh sách tất cả các Phòng ban trong hệ thống
   * 
   * @param user User hiện tại thực hiện request (Inject qua @ActiveUser)
   * @returns Danh sách các phòng ban (Department Entities)
   */
  @Get()
  @ApiOperation({ summary: 'Lấy danh sách tất cả các phòng ban' })
  findAll(@ActiveUser() user: User) {
    return this.departmentsService.findAll();
  }
}