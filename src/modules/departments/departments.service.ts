import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * @class DepartmentsService
 * @description Service quản lý Dữ liệu Phòng ban / Bộ phận (Department Management).
 * 
 * Luồng hoạt động chính:
 * 1. `findAll`: Truy vấn toàn bộ danh sách phòng ban từ cơ sở dữ liệu.
 * 2. `findOneByCode`: Tìm kiếm phòng ban duy nhất dựa trên mã code (VD: `IT`, `HR`, `GLOBAL`).
 */
@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Lấy toàn bộ danh sách phòng ban trong hệ thống
   */
  async findAll() {
    return this.prisma.department.findMany();
  }

  /**
   * Tìm kiếm phòng ban dựa theo Mã Code (Unique Department Code)
   * 
   * @param code Mã phòng ban (vd: 'HR', 'IT', 'GLOBAL')
   */
  async findOneByCode(code: string) {
    return this.prisma.department.findUnique({ where: { code } });
  }
}