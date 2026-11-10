import { Module } from '@nestjs/common';
import { SegmentsService } from './segments.service';
import { SegmentsController } from './segments.controller';
import { DifyClientModule } from '../dify-client/dify-client.module';
import { ValidationService } from '@common/services/validation.service';

@Module({
  imports: [DifyClientModule],
  controllers: [SegmentsController],
  providers: [SegmentsService, ValidationService],
})
export class SegmentsModule {}
