import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";

/**
 * @class DifyDatasetClientService
 * @description Client Service giao tiếp với Dify Open API cho các thao tác trên Dataset (Knowledge Base Management).
 * 
 * Luồng hoạt động chính:
 * 1. `createDataset`: Gửi HTTP POST tới `/v1/datasets` tạo kho tri thức mới trên Dify với `indexing_technique: 'high_quality'`.
 * 2. `deleteDataset`: Gửi HTTP DELETE tới `/v1/datasets/:id`. Nếu nhận lỗi 404 (đã bị xóa trên Dify) thì bỏ qua để dọn dẹp DB local.
 * 3. `getDocuments`: Gửi HTTP GET tới `/v1/datasets/:id/documents` lấy danh sách các tài liệu đã được tạo trong Dataset.
 */
@Injectable()
export class DifyDatasetClientService {
  private readonly logger = new Logger(DifyDatasetClientService.name);

  constructor(private readonly httpService: HttpService) {}

  /** Trả về HTTP Auth Headers tiêu chuẩn sử dụng DIFY_API_KEY */
  private get headers() {
    return {
      Authorization: `Bearer ${process.env.DIFY_API_KEY}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Tạo Dataset mới (Knowledge Base) trên Dify Engine
   * 
   * @param name Tên Dataset
   * @param description Mô tả mục đích sử dụng
   */
  async createDataset(name: string, description?: string) {
    const url = `${process.env.DIFY_API_URL}/datasets`;
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          url,
          {
            name,
            description,
            indexing_technique: "high_quality",
            permission: "only_me",
          },
          { headers: this.headers },
        ),
      );
      return response.data;
    } catch (error: any) {
      this.logger.error("Dify Create Dataset Error:", error.response?.data || error.message);
      throw new InternalServerErrorException(
        "Failed to create dataset on Dify",
      );
    }
  }

  /**
   * Xóa Dataset khỏi Dify Engine
   * 
   * @param difyDatasetId UUID của Dataset trên Dify
   */
  async deleteDataset(difyDatasetId: string): Promise<boolean> {
    const url = `${process.env.DIFY_API_URL}/datasets/${difyDatasetId}`;

    try {
      await firstValueFrom(
        this.httpService.delete(url, { headers: this.headers }),
      );
      return true;
    } catch (error: any) {
      this.logger.error("Dify Delete Dataset Error:", error.response?.data || error.message);
      // Nếu lỗi 404 nghĩa là bên Dify đã xóa trước đó, coi như thành công để tiếp tục xóa DB Local
      if (error.response?.status === 404) return true;
      throw new InternalServerErrorException("Lỗi khi xóa Dataset trên Dify");
    }
  }

  /**
   * Lấy danh sách các tài liệu (Documents) thuộc về một Dataset trên Dify
   * 
   * @param difyDatasetId UUID Dataset
   * @param page Trang hiện tại (Mặc định 1)
   * @param limit Số lượng bản ghi trên 1 trang (Mặc định 100)
   * @param keyword Từ khóa tìm kiếm tên tài liệu
   */
  async getDocuments(
    difyDatasetId: string,
    page: number = 1,
    limit: number = 100,
    keyword: string = "",
  ) {
    const url = `${process.env.DIFY_API_URL}/datasets/${difyDatasetId}/documents`;

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: this.headers,
          params: {
            page,
            limit,
            keyword,
          },
        }),
      );
      return response.data; // Response dạng: { data: [...], meta: { total_docs, ... } }
    } catch (error: any) {
      this.logger.error("Dify Get Documents Error:", error.response?.data || error.message);
      return { data: [], meta: { total: 0, page, limit } };
    }
  }
}
