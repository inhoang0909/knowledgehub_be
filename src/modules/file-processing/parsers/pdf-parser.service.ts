import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

export interface ImageExtractionResult {
  images: string[];      // Mảng chứa đường dẫn tuyệt đối tới các ảnh đã render
  tempDir: string;       // Thư mục tạm chứa ảnh (để xóa sau khi xử lý xong)
  metadata?: any;
}

@Injectable()
export class PdfParserService {
  private readonly logger = new Logger(PdfParserService.name);

  /**
   * Chuyển đổi các trang PDF thành hình ảnh sử dụng pdftoppm (poppler)
   * Ảnh được lưu trong thư mục /tmp/ và cần được dọn dẹp sau khi dùng xong.
   * * @param filePath - Đường dẫn tới file PDF
   * @returns Kết quả chứa danh sách đường dẫn ảnh và thư mục tạm
   */
  async extractPagesToImages(filePath: string): Promise<ImageExtractionResult> {
    try {
      const fileName = path.basename(filePath, '.pdf');
      
      // 1. Tạo thư mục tạm riêng biệt cho mỗi lần xử lý
      const tempDir = path.join(os.tmpdir(), `pdf_render_${Date.now()}_${fileName}`);
      await fs.mkdir(tempDir, { recursive: true });

      const outputPrefix = path.join(tempDir, 'page');
      this.logger.log(`Đang render PDF thành ảnh: ${filePath}`);

      // 2. Chạy pdftoppm để render toàn bộ trang thành ảnh PNG
      // -png: Xuất định dạng PNG
      // -rx 300 -ry 300: Set độ phân giải 300 DPI (Cực kỳ quan trọng để AI đọc được chữ nhỏ)
      await execAsync(`pdftoppm -png -rx 300 -ry 300 "${filePath}" "${outputPrefix}"`);

      // 3. Đọc thư mục tạm để lấy danh sách ảnh
      const files = await fs.readdir(tempDir);
      
      const images = files
        .filter(f => f.startsWith('page-') && f.endsWith('.png'))
        // 4. Sort lại cho đúng thứ tự trang (tránh lỗi page-10 đứng trước page-2)
        .sort((a, b) => {
          const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
          const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
          return numA - numB;
        })
        .map(f => path.join(tempDir, f));

      this.logger.log(`Đã trích xuất thành công ${images.length} trang thành ảnh.`);

      return {
        images,
        tempDir,
        metadata: {
          originalFile: filePath,
          totalPages: images.length,
        },
      };
    } catch (error) {
      this.logger.error(`Lỗi khi trích xuất ảnh từ PDF: ${filePath}`, error);
      throw new Error(`Không thể trích xuất ảnh từ PDF: ${error.message}`);
    }
  }

  /**
   * Xóa toàn bộ thư mục tạm sau khi VLM đã xử lý xong ảnh
   */
  async cleanupTempDirectory(tempDir: string): Promise<void> {
    try {
      // Dùng rm với option recursive để xóa cả thư mục và ruột bên trong
      await fs.rm(tempDir, { recursive: true, force: true });
      this.logger.log(`Đã dọn dẹp thư mục tạm: ${tempDir}`);
    } catch (error) {
      this.logger.warn(`Lỗi khi dọn dẹp thư mục tạm: ${tempDir}`, error);
    }
  }
}