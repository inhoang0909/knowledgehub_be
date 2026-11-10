import { IsInt, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * @class TransferOwnershipDto
 * @description DTO dùng cho request chuyển giao quyền Chủ sở hữu (Owner) của Dataset.
 */
export class TransferOwnershipDto {
  @ApiProperty({ description: 'ID của tài khoản User chủ sở hữu mới', example: 12 })
  @IsInt()
  @IsNotEmpty()
  @Type(() => Number)
  newOwnerId: number;
}
