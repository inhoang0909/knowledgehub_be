import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DatasetRole } from '@prisma/client';

/**
 * @class UpdatePermissionDto
 * @description DTO dùng cho request cấp/cập nhật vai trò phân quyền của Phòng ban trên Dataset.
 */
export class UpdatePermissionDto {
  @ApiProperty({ 
    description: 'Vai trò phân quyền mới cho phòng ban (MANAGER | EDITOR | VIEWER)', 
    enum: DatasetRole,
    example: 'EDITOR' 
  })
  @IsEnum(DatasetRole)
  role: DatasetRole;
}
