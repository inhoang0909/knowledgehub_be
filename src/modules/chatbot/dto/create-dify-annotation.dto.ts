import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDifyAnnotationDto {
  @ApiProperty({ description: 'The question/query from the user' })
  @IsString()
  @IsNotEmpty()
  question: string;

  @ApiProperty({ description: 'The corrected answer/response' })
  @IsString()
  @IsNotEmpty()
  answer: string;

  @ApiProperty({ description: 'The Dify message ID to annotate' })
  @IsString()
  @IsNotEmpty()
  message_id: string;
}
