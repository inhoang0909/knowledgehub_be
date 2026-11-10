import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { DifyClientModule } from '../dify-client/dify-client.module';
import { ValidationService } from '@common/services/validation.service';
import { FileProcessingModule } from '../file-processing/file-processing.module';
import { DocumentsCronService } from './documents-cron.service';

@Module({
  imports: [DifyClientModule, FileProcessingModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, ValidationService, DocumentsCronService],
})
export class DocumentsModule {}
