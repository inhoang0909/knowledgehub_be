import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PgBossModule } from '../pg-boss/pg-boss.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FileProcessingController } from './file-processing.controller';
import { FileProcessingService } from './file-processing.service';
import { FileProcessingWorkerService } from './file-processing-worker.service';
import { PdfParserService } from './parsers/pdf-parser.service';
import { TxtParserService } from './parsers/txt-parser.service';
import { ExcelParserService } from './parsers/excel-parser.service';
import { CsvParserService } from './parsers/csv-parser.service';
import { OCRService } from './services/ocr.service';
import { GotenbergService } from './services/gotenberg.service';

@Module({
  imports: [PgBossModule, PrismaModule, HttpModule],
  controllers: [FileProcessingController],
  providers: [
    FileProcessingService,
    FileProcessingWorkerService,
    PdfParserService,
    TxtParserService,
    ExcelParserService,
    CsvParserService,
    OCRService,
    GotenbergService,
  ],
  exports: [FileProcessingService],
})
export class FileProcessingModule {}
