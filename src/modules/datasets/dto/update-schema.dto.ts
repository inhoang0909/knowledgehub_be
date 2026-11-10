import { IsArray, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * @class UpdateSchemaDto
 * @description DTO dùng cho request cập nhật cấu hình Schema trường dữ liệu tùy chỉnh của Dataset.
 */
export class UpdateSchemaDto {
  @ApiProperty({ description: 'Mảng định nghĩa các trường dữ liệu tùy chỉnh (Schema Config)', type: Array })
  @IsArray()
  @IsNotEmpty()
  schemaConfig: any[];
}