import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt'; 
import { PrismaService } from '@/modules/prisma/prisma.service';
import { RedisService } from '@/modules/redis/redis.service';

/**
 * @class AuthGuard
 * @implements {CanActivate}
 * @description Guard bảo mật cấp route: Kiểm tra Bearer Token, giải mã JWT, và nạp thông tin User vào Request.
 * 
 * Luồng hoạt động chi tiết:
 * 1. Trích xuất Authorization Header từ Request HTTP (`Bearer <token>`).
 * 2. Giải mã JWT (Verify) với secret key cấu hình trong môi trường.
 * 3. Kiểm tra Session Cache trong Redis (`user:session:<user_id>`) để giảm tải cho PostgreSQL database.
 * 4. Nếu Cache Miss (chưa có trong Redis), truy vấn DB PostgreSQL và lưu kết quả vào Redis TTL 300s (5 phút).
 * 5. Gắn thông tin User (`request['user']`) để `@ActiveUser()` decorator hoặc Controller truy cập.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  /**
   * Phương thức xác thực chính được NestJS gọi trước khi route handler chạy
   * 
   * @param context Bối cảnh thực thi của request HTTP
   * @returns `true` nếu xác thực thành công; Ném `UnauthorizedException` nếu thất bại
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Chưa đăng nhập (No token provided)');
    }

    try {
      // -----------------------------------------------------------------
      // BƯỚC 1: Verify & giải mã JWT payload
      // -----------------------------------------------------------------
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET, 
      });

      // -----------------------------------------------------------------
      // BƯỚC 2: Kiểm tra Redis Cache trước, nếu miss mới truy vấn DB
      // -----------------------------------------------------------------
      const cacheKey = `user:session:${payload.sub}`;
      let user = await this.redisService.getJson<any>(cacheKey);

      if (!user) {
        user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
          include: { department: true },
        });

        if (!user) {
          throw new UnauthorizedException('User không tồn tại trong hệ thống');
        }

        // Cache thông tin session trong 5 phút (300 giây)
        await this.redisService.setJson(cacheKey, user, 300);
      }

      // -----------------------------------------------------------------
      // BƯỚC 3: Gắn User Object đã nạp đầy đủ vào Request context
      // -----------------------------------------------------------------
      request['user'] = user;
      
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        console.warn('Auth Guard: Token expired for request to', context.switchToHttp().getRequest().url);
        throw new UnauthorizedException({ message: 'Token đã hết hạn, vui lòng đăng nhập lại', error: 'TOKEN_EXPIRED' });
      }
      console.error('Auth Guard Error:', error.message);
      throw new UnauthorizedException({ message: 'Token không hợp lệ', error: 'INVALID_TOKEN' });
    }
    return true;
  }

  /**
   * Trích xuất JWT Token từ Header 'Authorization: Bearer <token>'
   * 
   * @param request Object Request HTTP từ Express
   * @returns Chuỗi Token hoặc `undefined` nếu không hợp lệ
   */
  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}