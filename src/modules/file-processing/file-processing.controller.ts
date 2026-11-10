import {
  Controller,
  Post,
  Get,
  Delete,
  Put,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Query,
  UseGuards,
  Body,
} from '@nestjs/common';
import * as path from 'path';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { FileProcessingService } from './file-processing.service';
import { ListFilesDto } from './dto/list-files.dto';
import { AuthGuard } from '@common/guards/auth.guard';
import { ActiveUser } from '@common/decorators/active-user.decorator';

@ApiTags('File Processing')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('api/file-processing')
export class FileProcessingController {
  constructor(private readonly fileProcessingService: FileProcessingService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload and process a file (PDF, TXT, Excel, CSV, PPTX, DOCX, images)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @ActiveUser('sub') userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'image/png',
      'image/jpeg',
      'image/tiff',
      'image/gif',
      'image/webp',
    ];

    // Also accept by filename extension because some clients send generic mimetypes
    const allowedExts = ['.pdf', '.txt', '.md', '.markdown', '.xlsx', '.xls', '.csv', '.png', '.jpg', '.jpeg', '.tiff', '.gif', '.webp', '.pptx', '.ppt', '.docx', '.doc'];
    const ext = path.extname(file.originalname || '').toLowerCase();

    if (!allowedTypes.includes(file.mimetype) && !allowedExts.includes(ext)) {
      throw new BadRequestException(
        'Invalid file type. Supported types: PDF, TXT, MD, Excel (XLSX, XLS), CSV, PPTX/PPT, DOCX/DOC, images',
      );
    }

    // Validate file size (50MB max)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException('File size exceeds 50MB limit');
    }

    const result = await this.fileProcessingService.submitFile(file, userId);

    return {
      message: 'File submitted for processing',
      ...result,
    };
  }

  @Get('files')
  @ApiOperation({ summary: 'List all processed files' })
  async listFiles(
    @Query() query: ListFilesDto,
    @ActiveUser('sub') userId: string,
  ) {
    return this.fileProcessingService.listFiles(
      userId,
      query.status as any, // Status from DTO matches FileProcessingStatus enum
      query.skip,
      query.take,
    );
  }

  @Get('files/:fileId')
  @ApiOperation({ summary: 'Get file processing status' })
  async getFileStatus(
    @Param('fileId') fileId: string,
    @ActiveUser('sub') userId: string,
  ) {
    return this.fileProcessingService.getFileStatus(fileId, userId);
  }

  @Get('files/:fileId/markdown')
  @ApiOperation({ summary: 'Get markdown content of processed file' })
  async getMarkdown(
    @Param('fileId') fileId: string,
    @ActiveUser('sub') userId: string,
  ) {
    const content = await this.fileProcessingService.getMarkdownContent(fileId, userId);
    return {
      content,
    };
  }

  @Put('files/:fileId/markdown')
  @ApiOperation({ summary: 'Update markdown content of processed file' })
  async updateMarkdown(
    @Param('fileId') fileId: string,
    @Body('content') content: string,
    @ActiveUser('sub') userId: string,
  ) {
    await this.fileProcessingService.updateMarkdownContent(fileId, userId, content);
    return {
      message: 'Content updated successfully',
    };
  }

  @Get('files/:fileId/parsed')
  @ApiOperation({ summary: 'Get processed file record including parsed markdown content' })
  async getParsedFile(
    @Param('fileId') fileId: string,
    @ActiveUser('sub') userId: string,
  ) {
    const record = await this.fileProcessingService.getFileWithParsedContent(fileId, userId);
    return record;
  }

  @Delete('files/:fileId')
  @ApiOperation({ summary: 'Delete a processed file' })
  async deleteFile(
    @Param('fileId') fileId: string,
    @ActiveUser('sub') userId: string,
  ) {
    await this.fileProcessingService.deleteFile(fileId, userId);
    return {
      message: 'File deleted successfully',
    };
  }
}
