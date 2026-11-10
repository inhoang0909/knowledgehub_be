import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/role.decorator'; 

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Lấy danh sách roles yêu cầu từ Metadata (gắn trên Controller hoặc Handler)
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Nếu API không gắn @Roles -> Ai cũng vào được (miễn là đã login qua AuthGuard)
    if (!requiredRoles) {
      return true;
    }

    // 2. Lấy User từ Request
    // Lưu ý: RolesGuard phải chạy SAU AuthGuard/JwtStrategy thì mới có request.user
    const { user } = context.switchToHttp().getRequest();

    if (!user) {
      // Trường hợp hiếm: Code quên đặt UseGuards(AuthGuard) trước RolesGuard
      throw new ForbiddenException('User chưa được xác thực');
    }

    // 3. So sánh
    // User được phép nếu role của họ nằm trong danh sách requiredRoles
    const hasRole = requiredRoles.includes(user.role);

    if (!hasRole) {
       throw new ForbiddenException('Bạn không có quyền truy cập chức năng này');
    }

    return true;
  }
}