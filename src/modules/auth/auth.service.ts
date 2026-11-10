import { Injectable, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { firstValueFrom } from 'rxjs';
import { LoginDto } from './dto/login.dto';

/**
 * @class AuthService
 * @description Xử lý toàn bộ logic Xác thực (Authentication) & Đồng bộ tài khoản (SSO Sync).
 * 
 * Luồng hoạt động chính:
 * 1. Nhận thông tin đăng nhập (username, password) từ client.
 * 2. Gọi Service Xác thực ngoài (External Auth SSO API) qua HTTP POST.
 * 3. Nếu thành công, tự động kiểm tra và đồng bộ Phòng ban (Department) vào database local (Prisma).
 * 4. Tự động kiểm tra và đồng bộ/cập nhật thông tin User vào database local.
 * 5. Cấp phát JWT Access Token (chứa sub, username, role, deptCode) trả về cho client.
 */
@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private httpService: HttpService,
    private jwtService: JwtService,
  ) { }

  /**
   * Đăng nhập người dùng thông qua SSO ngoài & đồng bộ thông tin nội bộ
   * 
   * @param loginDto Thông tin tài khoản đăng nhập (username, password)
   * @returns JWT Access Token và thông tin User cơ bản
   */
  async login(loginDto: LoginDto) {
    const { username, password } = loginDto;
    const globalLoginUrl = process.env.LOGIN_URL;

    try {
      // -----------------------------------------------------------------
      // BƯỚC 1: Gọi API Xác thực bên ngoài (SSO / LDAP Service)
      // -----------------------------------------------------------------
      const response = await firstValueFrom(
        this.httpService.post(globalLoginUrl, { username, password }, {
          headers: { 'Content-Type': 'application/json' }
        })
      );
      const externalData = response.data;
      if (!externalData || !externalData.id) {
        throw new UnauthorizedException('Login failed: Invalid credentials');
      }

      // -----------------------------------------------------------------
      // BƯỚC 2: Đồng bộ Phòng ban (Department Sync)
      // Tạo phòng ban mới nếu chưa tồn tại; xử lý xung đột ghi đồng thời (P2002)
      // -----------------------------------------------------------------
      const deptCode = externalData.dept || 'UNKNOWN';
      let dept = await this.prisma.department.findUnique({ where: { code: deptCode } });
      if (!dept) {
        try {
          dept = await this.prisma.department.create({
            data: {
              code: deptCode,
              name: externalData.high_dept || deptCode,
            },
          });
        } catch (e: any) {
          // Tránh race-condition khi nhiều user thuộc phòng ban mới đăng nhập cùng lúc
          if (e?.code === 'P2002') {
            dept = await this.prisma.department.findUnique({ where: { code: deptCode } });
          } else {
            throw e;
          }
        }
      }

      // -----------------------------------------------------------------
      // BƯỚC 3: Đồng bộ Người dùng (User Sync) & Kiểm tra trạng thái Kích hoạt
      // -----------------------------------------------------------------
      const userIdentifier = externalData.username; // Sử dụng Mã Nhân Viên (username) làm externalId
      
      const existingUser = await this.prisma.user.findUnique({ where: { externalId: userIdentifier } });
      
      // Chặn đăng nhập nếu tài khoản đã bị Vô hiệu hóa (Deactivated) bởi Admin
      if (existingUser && existingUser.isActive === false) {
        throw new UnauthorizedException('Account is deactivated. Please contact administrator');
      }

      let user;
      if (existingUser) {
        // Cập nhật thông tin lần đăng nhập cuối và thông tin phòng ban mới nhất
        user = await this.prisma.user.update({
          where: { externalId: userIdentifier },
          data: {
            email: externalData.email,
            departmentCode: deptCode,
            lastLoginAt: new Date(),
          },
          include: { department: true },
        });
      } else {
        // Tạo người dùng mới trong DB local với role mặc định là MEMBER
        try {
          user = await this.prisma.user.create({
            data: {
              externalId: userIdentifier,
              username: externalData.username,
              email: externalData.email,
              departmentCode: deptCode,
              role: 'MEMBER',
              lastLoginAt: new Date(),
            },
            include: { department: true },
          });
        } catch (e: any) {
          // Tránh race-condition khi ghi đồng thời
          if (e?.code === 'P2002') {
            user = await this.prisma.user.findUnique({ where: { externalId: userIdentifier }, include: { department: true } });
            if (!user) throw e;
          } else {
            throw e;
          }
        }
      }

      // -----------------------------------------------------------------
      // BƯỚC 4: Tạo JWT Payload & Ký Token trả về Client
      // -----------------------------------------------------------------
      const payload = {
        sub: user.id,
        username: user.username,
        role: user.role,
        deptCode: user.departmentCode
      };

      return {
        access_token: await this.jwtService.signAsync(payload),
        user: {
          id: user.id,
          name: externalData.name,
          role: user.role,
          department: user.department?.code
        }
      };

    } catch (error) {
      // Giữ nguyên các ngoại lệ UnauthorizedException đã ném ở trên
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      // Xử lý các lỗi từ API SSO bên ngoài (mã 401/403)
      if (error.response) {
        const status = error.response.status;
        const errorData = error.response.data;

        if (status === 401 || status === 403) {
          throw new UnauthorizedException('Invalid username or password');
        }

        console.error('External API error:', errorData);
        throw new UnauthorizedException('Login failed: External authentication service error');
      }

      // Lỗi kết nối mạng hoặc lỗi hệ thống không xác định
      console.error('Network or unexpected error:', error);
      throw new InternalServerErrorException('Login service unavailable');
    }
  }
}