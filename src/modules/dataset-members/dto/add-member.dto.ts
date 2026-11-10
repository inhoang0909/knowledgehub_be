import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DatasetRole } from '@prisma/client';

/**
 * @class AddMemberDto
 * @description DTO dùng cho request thêm/mời thành viên mới vào Dataset.
 * Hỗ trợ 2 phương thức: Truyền `userId` trực tiếp hoặc truyền `externalId` (mã SSO nhân viên) để hệ thống tự tạo User.
 */
export class AddMemberDto {
  @ApiPropertyOptional({ description: 'ID tài khoản User trong Local DB (nếu đã có)' })
  @IsOptional()
  @IsNumber()
  userId?: number;

  @ApiPropertyOptional({ description: 'Mã nhân viên từ hệ thống SSO (dùng cho Find-or-Create)' })
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional({ description: 'Tên người dùng / Tên nhân viên' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({ description: 'Họ tên hiển thị' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ enum: DatasetRole, description: 'Vai trò phân quyền (MANAGER | EDITOR | VIEWER)' })
  @IsNotEmpty()
  @IsEnum(DatasetRole)
  role: DatasetRole;
}