import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { HttpModule } from '@nestjs/axios'; // Để gọi API ngoài
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    PrismaModule,
    HttpModule, // Quan trọng: Để gọi Global API
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'secretKey', // Nhớ cấu hình trong .env
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}