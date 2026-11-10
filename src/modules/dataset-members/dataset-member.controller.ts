import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, ParseIntPipe, UseGuards
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DatasetMembersService } from './dataset-members.service';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { AuthGuard } from '@common/guards/auth.guard';
import { ActiveUser } from '@common/decorators/active-user.decorator';
import { User } from '@prisma/client';

/**
 * @class DatasetMembersController
 * @description Controller quản lý Thành viên trực thuộc Dataset (Dataset Member Access Control).
 * 
 * Cung cấp các API:
 * - `GET /api/datasets/:datasetId/members`: Lấy danh sách thành viên hợp nhất (Direct + Dept-inherited Members).
 * - `POST /api/datasets/:datasetId/members`: Mời/Thêm thành viên mới (Hỗ trợ Find-or-Create theo Mã nhân viên externalId).
 * - `PATCH /api/datasets/:datasetId/members/:userId`: Cập nhật vai trò phân quyền (Role: MANAGER, EDITOR, VIEWER).
 * - `DELETE /api/datasets/:datasetId/members/:userId`: Xóa thành viên khỏi Dataset (Bảo vệ Owner và Quyền Phòng ban).
 */
@ApiTags('Dataset Members')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('/api/datasets/:datasetId/members')
export class DatasetMembersController {
  constructor(private readonly membersService: DatasetMembersService) { }

  /**
   * API Lấy tổng hợp danh sách thành viên có quyền truy cập Dataset
   * 
   * @param datasetId ID Dataset
   * @param user User hiện tại đang thực hiện request (Inject qua @ActiveUser)
   */
  @Get()
  @ApiOperation({ summary: 'Lấy danh sách thành viên của Dataset' })
  getMembers(
    @Param('datasetId', ParseIntPipe) datasetId: number,
    @ActiveUser() user: User
  ) {
    return this.membersService.getMembers(datasetId, user);
  }

  /**
   * API Thêm/Mời thành viên mới vào Dataset (Yêu cầu quyền MANAGE)
   * 
   * @param datasetId ID Dataset
   * @param dto Dữ liệu thêm thành viên (userId, externalId, username, role)
   * @param user User hiện tại thực hiện request
   */
  @Post()
  @ApiOperation({ summary: 'Thêm thành viên vào Dataset' })
  addMember(
    @Param('datasetId', ParseIntPipe) datasetId: number,
    @Body() dto: AddMemberDto,
    @ActiveUser() user: User
  ) {
    return this.membersService.addMember(datasetId, dto, user);
  }

  /**
   * API Thay đổi vai trò phân quyền (Role) của một thành viên trong Dataset
   * 
   * @param datasetId ID Dataset
   * @param userId ID của thành viên cần đổi vai trò
   * @param dto Dữ liệu role mới (MANAGER | EDITOR | VIEWER)
   * @param user User hiện tại thực hiện request
   */
  @Patch(':userId')
  @ApiOperation({ summary: 'Cập nhật quyền hạn (Role) của thành viên' })
  updateMemberRole(
    @Param('datasetId', ParseIntPipe) datasetId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateMemberRoleDto,
    @ActiveUser() user: User
  ) {
    return this.membersService.updateMemberRole(datasetId, userId, dto, user);
  }

  /**
   * API Xóa thành viên khỏi Dataset (Loại bỏ quyền truy cập cá nhân)
   * 
   * @param datasetId ID Dataset
   * @param userId ID của thành viên bị xóa
   * @param user User hiện tại thực hiện request
   */
  @Delete(':userId')
  @ApiOperation({ summary: 'Xóa thành viên khỏi Dataset' })
  removeMember(
    @Param('datasetId', ParseIntPipe) datasetId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @ActiveUser() user: User
  ) {
    return this.membersService.removeMember(datasetId, userId, user);
  }
}