import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DifyClientService } from './dify-client.service';
import { DifyDatasetClientService } from './services/dify-dataset-client.service';
import { DifyDocumentClientService } from './services/dify-document-client.service';
import { DifySegmentClientService } from './services/dify-segment-client.service';

/**
 * @module DifyClientModule
 * @description NestJS Module kết nối Dify Open API Client Services.
 */
@Module({
  imports: [HttpModule], 
  providers: [
    DifyClientService,
    DifyDatasetClientService,
    DifyDocumentClientService,
    DifySegmentClientService,
  ],
  exports: [
    DifyClientService,
    DifyDatasetClientService,
    DifyDocumentClientService,
    DifySegmentClientService,
  ]
})
export class DifyClientModule {}