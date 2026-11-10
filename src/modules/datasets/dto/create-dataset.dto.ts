import { IsNotEmpty, IsString, IsOptional, IsArray, IsInt } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * @class CreateDatasetDto
 * @description DTO dùng cho request tạo mới Dataset.
 */
export class CreateDatasetDto {
  @ApiProperty({ description: 'Tên gốc của Dataset', example: 'Hợp đồng 2026' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Mô tả mục đích sử dụng Dataset' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Cấu hình mảng các trường dữ liệu Schema tùy chỉnh', type: Array })
  @IsOptional()
  @IsArray()
  schemaConfig?: any[] | null;

  @ApiPropertyOptional({ description: 'ID Thư mục / Danh mục chứa Dataset' })
  @IsInt()
  @IsOptional()
  @Type(() => Number)
  categoryId?: number;
}