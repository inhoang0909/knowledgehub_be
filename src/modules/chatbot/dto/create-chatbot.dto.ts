import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateChatbotDto {
  @ApiProperty({ description: 'Tên hiển thị của Chatbot', example: 'HR Assistant' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Mô tả vai trò chính của Chatbot',
    example: 'Trợ lý hỗ trợ nhân sự và tư vấn chính sách công ty',
  })
  @IsString()
  @IsNotEmpty()
  role: string;

  @ApiPropertyOptional({
    description: 'Danh sách nhiệm vụ & công việc cụ thể thực hiện',
    example: '- Giải đáp thắc mắc nghỉ phép, bảo hiểm\n- Hướng dẫn quy trình nộp đơn online',
  })
  @IsString()
  @IsOptional()
  tasks?: string;

  @ApiPropertyOptional({
    description: 'Danh sách ID của các Dataset kiến thức local liên kết với Chatbot',
    example: [1, 2],
    type: [Number],
  })
  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  datasetIds?: number[];

  @ApiPropertyOptional({
    description: 'Ngôn ngữ của prompt (vi, en, zh). Tự động phát hiện nếu không truyền',
    example: 'vi',
  })
  @IsString()
  @IsOptional()
  lang?: string;
}
