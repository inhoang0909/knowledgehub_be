import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { UserRole } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional({ 
    enum: UserRole, 
    description: 'Update role (SUPER_ADMIN, MEMBER)' 
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole; // <--- Đây chính là chỗ update permission

  @ApiPropertyOptional({ example: 'TIT001', description: 'Chuyển phòng ban' })
  @IsOptional()
  @IsString()
  departmentCode?: string;

  @ApiPropertyOptional({ example: true, description: 'Khóa/Mở khóa tài khoản' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean; // <--- Đây là chỗ update status
}