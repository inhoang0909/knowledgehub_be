import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult } from 'pg';

/**
 * @class DifyDbService
 * @implements {OnModuleInit}, {OnModuleDestroy}
 * @description Connection Pool Service trực tiếp tới PostgreSQL Database nội bộ của Dify Engine.
 * 
 * Lưu ý kiến trúc:
 * Service này sử dụng thư viện `pg` (Node Postgres) thay vì Prisma Client để linh hoạt thực hiện
 * các truy vấn SQL đọc/xóa trực tiếp trên schema DB của Dify mà không bị phụ thuộc vào Prisma Migration.
 */
@Injectable()
export class DifyDbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DifyDbService.name);
  private pool: Pool;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Khởi tạo Connection Pool khi NestJS Module khởi động
   */
  onModuleInit() {
    const DIFY_DB_HOST = this.configService.get<string>('DIFY_DB_HOST');
    const DIFY_DB_PORT = this.configService.get<string>('DIFY_DB_PORT');
    const DIFY_DB_USER = this.configService.get<string>('DIFY_DB_USER');
    const DIFY_DB_PASSWORD = this.configService.get<string>('DIFY_DB_PASSWORD');
    const DIFY_DB_NAME = this.configService.get<string>('DIFY_DB_NAME');

    if (!DIFY_DB_HOST || !DIFY_DB_USER || !DIFY_DB_PASSWORD) {
      this.logger.warn(
        'Biến môi trường Dify DB (DIFY_DB_HOST, DIFY_DB_USER, DIFY_DB_PASSWORD) chưa được cấu hình. ' +
        'Tính năng sync-logs và quản lý live logs sẽ không hoạt động.',
      );
      return;
    }

    this.pool = new Pool({
      host: DIFY_DB_HOST,
      port: parseInt(DIFY_DB_PORT || '5432', 10),
      user: DIFY_DB_USER,
      password: DIFY_DB_PASSWORD,
      database: DIFY_DB_NAME || 'dify',
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.pool.on('error', (err) => {
      this.logger.error('Dify DB pool error:', err.message);
    });

    this.logger.log(`Connected to Dify DB at ${DIFY_DB_HOST}:${DIFY_DB_PORT || 5432}/${DIFY_DB_NAME || 'dify'}`);
  }

  /**
   * Đóng Connection Pool khi ứng dụng tắt
   */
  async onModuleDestroy() {
    if (this.pool) await this.pool.end();
  }

  /**
   * Thực thi câu lệnh SQL Parameterized Query tới Dify DB
   * 
   * @param text Câu lệnh SQL (dùng tham số $1, $2...)
   * @param params Mảng tham số truyền vào
   * @returns Kết quả QueryResult
   */
  async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    if (!this.pool) {
      throw new Error('Dify DB pool chưa được khởi tạo. Vui lòng kiểm tra biến DIFY_DB_* trong file .env.');
    }
    return this.pool.query<T>(text, params);
  }
}
