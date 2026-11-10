import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DatasetRole } from '@prisma/client';

/**
 * @class UpdateMemberRoleDto
 * @description DTO dùng cho request cập nhật vai trò (Role) của thành viên trong Dataset.
 */
export class UpdateMemberRoleDto {
  @ApiProperty({ enum: DatasetRole, description: 'Vai trò mới (MANAGER | EDITOR | VIEWER)' })
  @IsEnum(DatasetRole)
  @IsNotEmpty()
  role: DatasetRole;
}