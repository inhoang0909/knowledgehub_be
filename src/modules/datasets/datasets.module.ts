import { Module } from "@nestjs/common";
import { DatasetReaderService } from "./services/dataset-reader.service";
import { DatasetWriterService } from "./services/dataset-writer.service";
import { DatasetAdminService } from "./services/dataset-admin.service";
import { DatasetsController } from "./datasets.controller";
import { DifyClientModule } from "../dify-client/dify-client.module";
import { ValidationService } from "@common/services/validation.service";

/**
 * @module DatasetsModule
 * @description NestJS Module quản lý Kho tri thức Dataset (Knowledge Base Management).
 * Phân chia nhiệm vụ theo 3 Dịch vụ chuyên biệt: ReaderService, WriterService và AdminService.
 */
@Module({
  imports: [DifyClientModule],
  controllers: [DatasetsController],
  providers: [
    DatasetReaderService,
    DatasetWriterService,
    DatasetAdminService,
    ValidationService,
  ],
})
export class DatasetsModule {}
