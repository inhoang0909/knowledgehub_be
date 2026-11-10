import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * @class DifyConsoleAuthService
 * @description Service quản lý Xác thực phiên đăng nhập Admin với Dify Console API (Dify v1.9+ Cookie Session Mode).
 * 
 * Luồng hoạt động:
 * 1. Dify v1.9+ trả về Session qua Header `Set-Cookie` (`access_token`, `csrf_token`, `refresh_token`).
 * 2. Service tự động đăng nhập (`/console/api/login`), trích xuất chuỗi Cookie & CSRF Token để gửi kèm các Mutation Request.
 * 3. Tự động tính toán thời gian hết hạn (Max-Age) và Refresh Session trước 5 phút khi Token hết hạn.
 */
@Injectable()
export class DifyConsoleAuthService {
  private readonly logger = new Logger(DifyConsoleAuthService.name);

  /** Chuỗi Cookie hoàn chỉnh để gửi kèm Header Request (vd: "access_token=xxx; csrf_token=yyy") */
  private cookieString: string | null = null;
  /** Mã CSRF Token trích xuất từ Cookie để đính kèm Header 'X-Csrf-Token' cho các request Mutation (POST/PUT/DELETE) */
  private csrfToken: string | null = null;
  /** Thời điểm Hết hạn của Token (Unix timestamp ms) */
  private tokenExpiresAt: number = 0;

  constructor(private readonly configService: ConfigService) {}

  /** Lấy Base URL của Dify Console API (loại bỏ hậu tố /v1 nếu có) */
  get consoleBaseUrl(): string {
    return (this.configService.get<string>('DIFY_API_URL') || '').replace(/\/v1$/, '');
  }

  /**
   * Lấy Auth Headers cho các request gọi sang Dify Console API.
   * Tự động gọi `login()` để làm mới Session nếu Token sắp hết hạn hoặc chưa đăng nhập.
   * 
   * @returns Object chứa Header `Cookie` và `X-Csrf-Token`
   */
  async getAuthHeaders(): Promise<{ Cookie: string; 'X-Csrf-Token'?: string }> {
    const now = Date.now();
    // Làm mới phiên đăng nhập 5 phút trước khi Token hết hạn
    if (this.cookieString && now < this.tokenExpiresAt - 5 * 60 * 1000) {
      return this.buildHeaders();
    }
    await this.login();
    return this.buildHeaders();
  }

  /** Đóng gói các Header xác thực */
  private buildHeaders(): { Cookie: string; 'X-Csrf-Token'?: string } {
    const headers: { Cookie: string; 'X-Csrf-Token'?: string } = {
      Cookie: this.cookieString!,
    };
    if (this.csrfToken) {
      headers['X-Csrf-Token'] = this.csrfToken;
    }
    return headers;
  }

  /**
   * Thực hiện Đăng nhập Admin vào Dify Console API & Trích xuất Session Cookies
   */
  async login(): Promise<void> {
    const email = this.configService.get<string>('DIFY_ADMIN_EMAIL');
    const password = this.configService.get<string>('DIFY_ADMIN_PASSWORD');

    if (!email || !password) {
      throw new Error(
        'DIFY_ADMIN_EMAIL and DIFY_ADMIN_PASSWORD must be set in .env to use the Dify Console API.',
      );
    }

    const url = `${this.consoleBaseUrl}/console/api/login`;
    this.logger.log(`Logging into Dify Console API (v1.9 cookie mode) as ${email}...`);

    const fetch = (await import('node-fetch')).default;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, remember_me: true }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Dify Console login failed (${res.status}): ${errText}`);
    }

    // Trích xuất mảng Header Set-Cookie từ Response
    const setCookieHeaders: string[] = (res.headers.raw()['set-cookie'] as string[]) ?? [];

    if (setCookieHeaders.length === 0) {
      const body = await res.text();
      throw new Error(`Dify Console login: no Set-Cookie headers in response. Body: ${body}`);
    }

    // Lọc lấy cặp name=value từ từng Cookie
    const cookiePairs = setCookieHeaders.map(c => c.split(';')[0].trim());
    this.cookieString = cookiePairs.join('; ');

    // Trích xuất giá trị csrf_token cho Header X-Csrf-Token
    const csrfPair = cookiePairs.find(c => c.startsWith('csrf_token='));
    this.csrfToken = csrfPair ? csrfPair.slice('csrf_token='.length) : null;

    // Tính thời gian hết hạn dựa trên Max-Age của access_token cookie
    const accessCookieFull = setCookieHeaders.find(c => c.startsWith('access_token='));
    const maxAgeMatch = accessCookieFull?.match(/Max-Age=(\d+)/i);
    const maxAgeSecs = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
    this.tokenExpiresAt = Date.now() + maxAgeSecs * 1000;

    this.logger.log(
      `Dify Console login successful. Session cached for ${Math.round(maxAgeSecs / 60)} minutes.`,
    );
  }

  /**
   * Xóa Session Cache hiện tại (Gợi ý gọi khi nhận lỗi HTTP 401 để ép Login mới)
   */
  invalidate(): void {
    this.cookieString = null;
    this.csrfToken = null;
    this.tokenExpiresAt = 0;
  }
}
