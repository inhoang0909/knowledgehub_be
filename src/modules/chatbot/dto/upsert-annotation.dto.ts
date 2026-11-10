import { IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpsertAnnotationDto {
  @ApiProperty({ description: 'Câu trả lời chuẩn mà admin muốn lưu' })
  @IsString()
  @IsNotEmpty()
  expectedAnswer: string;

  @ApiProperty({ description: 'ID của Dataset trong Local DB mà annotation sẽ được push vào khi Publish' })
  @IsNumber()
  targetDatasetId: number;
}
