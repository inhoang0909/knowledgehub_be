import { Controller, Get, Post, Put, Delete, Body, Param, ParseIntPipe, UseGuards, Query } from '@nestjs/common';
import { SegmentsService } from './segments.service';
import { CreateSegmentDto, UpdateSegmentDto } from './dto/create-segment.dto';
import { AuthGuard } from '@common/guards/auth.guard';
import { ActiveUser } from '@common/decorators/active-user.decorator';
import { User } from '@prisma/client';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CheckDuplicateDto } from './dto/check-duplicate.dto';

@ApiTags('Segments')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard)
export class SegmentsController {
  constructor(private readonly segmentsService: SegmentsService) {}

  // 1. Lấy danh sách segment của 1 Document (để vẽ bảng dữ liệu)
  // GET /api/datasets/documents/:documentId/segments
  // Lưu ý: datasetId ở đây chỉ để đúng chuẩn RESTful URL, logic chính dùng documentId
@Get('/api/documents/:documentId/segments')
  findAll(
    @Param('documentId', ParseIntPipe) documentId: number,
    @ActiveUser() user: User
  ) {
    // Lưu ý: datasetId trong URL chỉ để đẹp đội hình, logic dùng documentId
    return this.segmentsService.findAllFromDify(documentId, user);
  }

  // 2. Thêm segment mới vào Document
  // POST /api/documents/:documentId/segments
  @Post('/api/documents/:documentId/segments')
  create(
    @Param('documentId', ParseIntPipe) documentId: number,
    @Body() dto: CreateSegmentDto,
    @ActiveUser() user: User
  ) {
    return this.segmentsService.create(documentId, dto, user);
  }

  // 3. Sửa segment
  // PUT /api/segments/:id
  // (URL ngắn gọn hơn vì ID segment là duy nhất)
  @Put('/api/segments/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSegmentDto,
    @ActiveUser() user: User
  ) {
    return this.segmentsService.update(id, dto, user);
  }

  // 4. Xóa segment
  // DELETE /api/segments/:id
  @Delete('/api/segments/:id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @ActiveUser() user: User
  ) {
    return this.segmentsService.remove(id, user);
  }
  @Post('/api/segments/check-duplicate')
  async checkDuplicate(@Body() dto: CheckDuplicateDto) {
    return this.segmentsService.checkDuplicate(
      dto.documentId,
      dto.data,
      dto.excludeSegmentId
    );
  }
}