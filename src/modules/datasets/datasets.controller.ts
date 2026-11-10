import { Controller, Get, Post, Put, Patch, Body, Param, ParseIntPipe, UseGuards, Delete } from '@nestjs/common';
import { DatasetReaderService } from './services/dataset-reader.service';
import { DatasetWriterService } from './services/dataset-writer.service';
import { DatasetAdminService } from './services/dataset-admin.service';

import { CreateDatasetDto } from './dto/create-dataset.dto';
import { UpdateSchemaDto } from './dto/update-schema.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { AuthGuard } from '@common/guards/auth.guard';
import { ActiveUser } from '@common/decorators/active-user.decorator';
import { User } from '@prisma/client';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { TestRetrieveBodyDto } from './dto/test-retrieve.dto';

/**
 * @class DatasetsController
 * @description Controller trung tâm quản lý Kho tri thức Dataset (Knowledge Base Management).
 * 
 * Được chia thành 3 nhóm dịch vụ chính:
 * 1. Read Operations (`DatasetReaderService`): Lấy danh sách, chi tiết, trộn tài liệu pending và test tìm kiếm hit-testing.
 * 2. Write Operations (`DatasetWriterService`): Tạo mới, cập nhật Schema Config và xóa hard-delete Dataset.
 * 3. Admin Operations (`DatasetAdminService`): Cấp quyền cấp Phòng ban và Chuyển giao quyền sở hữu (Transfer Ownership).
 */
@ApiTags('Datasets')
@ApiBearerAuth()
@Controller('api/')
@UseGuards(AuthGuard)
export class DatasetsController {
  constructor(
    private readonly readService: DatasetReaderService,
    private readonly writeService: DatasetWriterService,
    private readonly adminService: DatasetAdminService,
  ) {}

  // =================================================================
  // GROUP 1: READ OPERATIONS (DatasetReaderService)
  // =================================================================

  /**
   * API Lấy danh sách toàn bộ Dataset mà User có quyền xem (Phân quyền theo User, Phòng ban, GLOBAL)
   */
  @Get('datasets')
  @ApiOperation({ summary: 'Lấy danh sách tất cả Datasets được phép truy cập' })
  findAll(@ActiveUser() user: User) {
    return this.readService.findAll(user);
  }

  /**
   * API Lấy chi tiết Dataset kèm danh sách tài liệu (Trộn file đã có trên Dify + file đang Pending ở Local)
   */
  @Get('datasets/:id')
  @ApiOperation({ summary: 'Lấy chi tiết Dataset và danh sách tài liệu' })
  @ApiParam({ name: 'id', description: 'Dataset ID', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number, @ActiveUser() user: User) {
    return this.readService.findOne(id, user);
  }
  
  // =================================================================
  // GROUP 2: WRITE OPERATIONS (DatasetWriterService)
  // =================================================================

  /**
   * API Tạo mới Dataset (Tạo trên Dify trước -> Lưu DB local -> Cấp quyền MANAGER cho Creator)
   */
  @Post('datasets')
  @ApiOperation({ summary: 'Tạo mới Dataset' })
  create(@ActiveUser() user: User, @Body() createDatasetDto: CreateDatasetDto) {
    return this.writeService.create(user, createDatasetDto);
  }

  /**
   * API Cập nhật cấu hình Schema (Trường dữ liệu tùy chỉnh) cho Dataset
   */
  @Put('datasets/:id/schema')
  @ApiOperation({ summary: 'Cập nhật Schema Config cho Dataset' })
  @ApiParam({ name: 'id', description: 'Dataset ID', type: Number })
  updateSchema(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateSchemaDto: UpdateSchemaDto,
    @ActiveUser() user: User
  ) {
    return this.writeService.updateSchema(id, updateSchemaDto, user);
  }

  /**
   * API Xóa vĩnh viễn Dataset (Xóa trên Dify -> Hard-delete Segments/Documents/Permissions trong Local DB)
   */
  @Delete('datasets/:id')
  @ApiOperation({ summary: 'Xóa vĩnh viễn Dataset' })
  @ApiParam({ name: 'id', description: 'Dataset ID', type: Number })
  remove(
    @Param('id', ParseIntPipe) id: number,
    @ActiveUser() user: User
  ) {
    return this.writeService.remove(id, user);
  }

  // =================================================================
  // GROUP 3: ADMIN OPERATIONS (DatasetAdminService)
  // =================================================================

  /**
   * API Xem tổng quan toàn bộ Datasets kèm mảng phân quyền chi tiết (Chỉ dành cho Super Admin)
   */
  @Get('datasets/permissions/all')
  @ApiOperation({ summary: 'Xem tất cả Datasets và phân quyền (Super Admin)' })
  findAllWithPermissions(@ActiveUser() user: User) {
    return this.adminService.findAllWithPermissions(user);
  }

  /**
   * API Phân quyền cho cả Phòng ban trên Dataset (Chỉ dành cho Super Admin)
   */
  @Patch('datasets/:datasetId/permissions/:departmentId')
  @ApiOperation({ summary: 'Cập nhật phân quyền phòng ban trên Dataset (Super Admin)' })
  @ApiParam({ name: 'datasetId', description: 'Dataset ID', type: Number })
  @ApiParam({ name: 'departmentId', description: 'Department ID', type: Number })
  updatePermission(
    @Param('datasetId', ParseIntPipe) datasetId: number,
    @Param('departmentId', ParseIntPipe) departmentId: number,
    @Body() updatePermissionDto: UpdatePermissionDto,
    @ActiveUser() user: User
  ) {
    return this.adminService.updateDeptPermission(
      datasetId,
      departmentId,
      updatePermissionDto.role,
      user
    );
  }

  /**
   * API Chuyển giao quyền Chủ sở hữu (Transfer Ownership) cho người dùng khác
   */
  @Patch('datasets/:id/transfer-ownership')
  @ApiOperation({ summary: 'Chuyển giao quyền Owner của Dataset' })
  @ApiParam({ name: 'id', description: 'Dataset ID', type: Number })
  transferOwnership(
    @Param('id', ParseIntPipe) id: number,
    @Body() transferOwnershipDto: TransferOwnershipDto,
    @ActiveUser() user: User
  ) {
    return this.adminService.transferOwnership(
      id,
      transferOwnershipDto.newOwnerId,
      user
    );
  }

  /**
   * API Lấy danh sách các Dataset do một User cụ thể làm Owner
   */
  @Get('datasets/owner/:ownerId')
  @ApiOperation({ summary: 'Lấy các Datasets do một User làm Owner' })
  @ApiParam({ name: 'ownerId', description: 'Owner User ID', type: Number })
  findByOwnerId(@Param('ownerId', ParseIntPipe) ownerId: number) {
    return this.readService.findByOwnerId(ownerId);
  }

  /**
   * API Test kiểm thử độ chính xác truy xuất đoạn văn bản (Hit Testing Retrieval)
   */
  @Post('datasets/:id/test-retrieve')
  @ApiOperation({ summary: 'Kiểm thử độ chính xác truy xuất đoạn văn bản (Hit Testing)' })
  @ApiParam({ name: 'id', description: 'Dataset ID', type: Number })
  async testRetrieve(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: TestRetrieveBodyDto,
    @ActiveUser() user: User
  ) {
    return this.readService.testRetrieve(id, body.query, user);
  }
}