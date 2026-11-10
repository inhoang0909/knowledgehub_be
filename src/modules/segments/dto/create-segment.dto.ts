import { IsNotEmpty, IsObject } from 'class-validator';

export class CreateSegmentDto {
  @IsObject()
  @IsNotEmpty()
  data: Record<string, any>; 
}

export class UpdateSegmentDto extends CreateSegmentDto {}