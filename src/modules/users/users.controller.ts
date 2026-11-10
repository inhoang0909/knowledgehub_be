import { Controller, Get, Body, Patch, Param, ParseIntPipe, ParseBoolPipe, DefaultValuePipe, UseGuards, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-users.dto';
import { UserRole } from '@prisma/client';
import { User } from '@prisma/client';
import { AuthGuard } from '@common/guards/auth.guard';
import { ActiveUser } from '@common/decorators/active-user.decorator';
import { RolesGuard } from '@common/guards/roles.guard';
import { Roles } from '@common/decorators/role.decorator';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

@ApiBearerAuth()
@ApiTags('Users')
@Controller('/api/users/')
@UseGuards(AuthGuard, RolesGuard) // Bảo vệ toàn bộ route
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  // 1. GET /api/users
  // Chỉ Super Admin, DEPT_MANAGER mới xem được tất cả
  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.DEPT_MANAGER)
  findAll() {
    return this.usersService.findAll();
  }

  @Get('search')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DEPT_MANAGER, UserRole.MEMBER) // <--- Cấp quyền rộng hơn
  @ApiOperation({ summary: 'Search external users (GMO API) để Add Member' })
  @ApiQuery({ name: 'keyword', required: true, example: 'Oanh', description: 'Tên hoặc mã nhân viên' })
  async searchExternal(@Query('keyword') keyword: string) {
    // Validate nhẹ
    if (!keyword || keyword.trim().length === 0) {
      return [];
    }
    return this.usersService.searchExternalUsers(keyword);
  }

  // 2. GET /api/users/my-department
  // DEPT_MANAGER xem danh sách user trong phòng ban do mình quản lý
  // Mục đích: hiển thị cả user đã đăng nhập và user chưa login (stored in DB)
  @Get('my-department')
  @Roles(UserRole.DEPT_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'DEPT_MANAGER: Lấy danh sách user trong phòng ban của mình' })
  findMyDepartmentUsers(@ActiveUser() currentUser: User) {
    return this.usersService.findMyDepartmentUsers(currentUser);
  }

  // 3. GET /api/users/:id
  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  // 3. PATCH /api/users/:id
  // Dùng để update Role, đổi phòng ban, hoặc disable
  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DEPT_MANAGER)
  @ApiOperation({ summary: 'Update thông tin User (Role, Dept, Active)' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @ActiveUser() currentUser: User
  ) {
    return this.usersService.update(id, dto, currentUser);
  }

  // 4. GET /api/users/:id/owned-datasets
  @Get(':id/owned-datasets')
  @Roles(UserRole.SUPER_ADMIN, UserRole.DEPT_MANAGER)
  @ApiOperation({ summary: 'Get datasets owned by a user' })
  getOwnedDatasets(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getOwnedDatasets(id);
  }
}