import { IsNotEmpty, IsString, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * @class TestRetrieveBodyDto
 * @description DTO chứa dữ liệu câu query dùng cho tính năng Hit Testing tìm kiếm thử nghiệm.
 */
export class TestRetrieveBodyDto {
  @ApiProperty({ example: 'điện thoại di động', description: 'Câu hỏi hoặc từ khóa cần test tìm kiếm' })
  @IsString()
  @IsNotEmpty()
  query: string;
}

/**
 * @class TestRetrieveResponseDto
 * @description DTO định dạng kết quả đoạn văn bản trả về sau khi lọc theo score >= 0.4.
 */
export class TestRetrieveResponseDto {
  @ApiProperty({ description: 'Nội dung đoạn văn bản tìm thấy' })
  content: string;

  @ApiProperty({ description: 'Số lượng từ trong đoạn' })
  word_count: number;

  @ApiProperty({ description: 'Tên file tài liệu chứa đoạn văn bản' })
  document_name: string;

  @ApiProperty({ description: 'Điểm tương đồng Cosine Similarity' })
  score: number;
}