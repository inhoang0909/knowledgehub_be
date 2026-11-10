import { IsNotEmpty, IsString, IsIn } from 'class-validator';

export class CreateDocumentDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class UpdateDocumentStatusDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['enable', 'disable', 'archive'])
  action: 'enable' | 'disable' | 'archive';
}

export class ReindexDocumentDto {
  @IsString()
  @IsIn(['local_first', 'file_reset'])
  mode?: 'local_first' | 'file_reset' = 'local_first';
}