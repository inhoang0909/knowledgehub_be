// src/modules/segments/dto/check-duplicate.dto.ts

import { IsInt, IsNotEmpty, IsObject, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CheckDuplicateDto {
  @ApiProperty({ example: 1, description: 'ID của Document chứa segment' })
  @IsInt()
  @IsNotEmpty()
  documentId: number;

  @ApiProperty({ 
    example: { question: "ABC", answer: "XYZ" }, 
    description: 'Dữ liệu segment cần kiểm tra' 
  })
  @IsObject()
  @IsNotEmpty()
  data: Record<string, any>;

  @ApiProperty({ 
    example: 10, 
    description: 'ID của segment hiện tại (nếu đang Edit) để bỏ qua chính nó',
    required: false 
  })
  @IsOptional()
  @IsInt()
  excludeSegmentId?: number;
}