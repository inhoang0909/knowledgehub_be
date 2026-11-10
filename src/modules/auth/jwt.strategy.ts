import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET, // Đảm bảo biến môi trường này đúng
    });
  }

  // Hàm này chạy tự động khi có request gửi token lên
  async validate(payload: any) {
    // Payload.sub chính là user.id (nội bộ)
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { 
        department: true // <--- QUAN TRỌNG: Include luôn Department ID
      }
    });

    if (!user) {
      throw new UnauthorizedException('User không tồn tại hoặc đã bị xóa');
    }

    // Kết quả trả về ở đây sẽ được gắn vào request.user
    return user; 
  }
}