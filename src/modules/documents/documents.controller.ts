import {
  Controller,
  Post,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Delete,
  Get,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { DocumentsService } from "./documents.service";
import {
  CreateDocumentDto,
  UpdateDocumentStatusDto,
  ReindexDocumentDto,
} from "./dto/create-document.dto";
import { AuthGuard } from "@common/guards/auth.guard";
import { ActiveUser } from "@common/decorators/active-user.decorator";
import { User } from "@prisma/client";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";

@ApiTags("Documents")
@Controller()
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  // 1. Tạo Document mới trong Dataset
  // POST /api/datasets/:datasetId/documents
 @Post('/api/datasets/:datasetId/documents')
  @UseInterceptors(FileInterceptor('file'))
  
  // 2. Báo cho Swagger biết đây là form-data
  @ApiConsumes('multipart/form-data')
  
  // 3. Định nghĩa Schema để Swagger hiện nút "Choose File"
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        // Field file upload
        file: {
          type: 'string',
          format: 'binary',
        },
        // Field name từ DTO (nếu có)
        name: {
          type: 'string',
          example: 'Tài liệu hướng dẫn.pdf'
        }
      },
      required: ['file', 'name'] // Nếu bắt buộc
    },
  })
  @ApiOperation({ summary: 'Upload single file vào Dataset (Tối đa 15MB)' })
  create(
    @Param('datasetId', ParseIntPipe) datasetId: number,
    @Body() dto: CreateDocumentDto,
    @UploadedFile() file: Express.Multer.File,
    @ActiveUser() user: User
  ) {
    return this.documentsService.create(datasetId, dto.name, user, file);
  }

  // 1b. Upload nhiều file (tối đa 5 file, tối đa 15MB/file) vào Dataset
  // POST /api/datasets/:datasetId/documents/batch
  @Post('/api/datasets/:datasetId/documents/batch')
  @UseInterceptors(FilesInterceptor('files', 5))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
      required: ['files'],
    },
  })
  @ApiOperation({ summary: 'Upload nhiều file vào Dataset (Tối đa 5 file, 15MB/file)' })
  createBatch(
    @Param('datasetId', ParseIntPipe) datasetId: number,
    @UploadedFiles() files: Express.Multer.File[],
    @ActiveUser() user: User
  ) {
    return this.documentsService.createMultiple(datasetId, user, files);
  }

  // 2. Cập nhật trạng thái (Enable/Disable/Archive)
  // POST /api/documents/:id/status
  // Body: { "action": "disable" }
  @Post("/api/documents/:id/status")
  updateStatus(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateDocumentStatusDto,
    @ActiveUser() user: User,
  ) {
    return this.documentsService.updateStatus(id, dto.action, user);
  }

  // 3. Reindex Document (Local-First preservation hoặc File-Reset)
  // POST /api/documents/:id/reindex
  // Body: { "mode": "local_first" | "file_reset" }
  @Post("/api/documents/:id/reindex")
  @ApiOperation({ summary: "Reindex tài liệu (Bảo toàn Local Segments hoặc Reset từ file)" })
  reindex(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ReindexDocumentDto,
    @ActiveUser() user: User,
  ) {
    return this.documentsService.reindex(id, dto.mode || 'local_first', user);
  }

  // 4. Xóa Document
  // DELETE /api/documents/:id
  @Delete("/api/documents/:id")
  remove(@Param("id", ParseIntPipe) id: number, @ActiveUser() user: User) {
    return this.documentsService.remove(id, user);
  }

  // GET /api/documents/:id
  @Get("/api/documents/:id")
  getDetail(@Param("id", ParseIntPipe) id: number, @ActiveUser() user: User) {
    return this.documentsService.findOne(id, user);
  }
}
