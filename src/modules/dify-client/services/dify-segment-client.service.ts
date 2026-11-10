import {
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom, lastValueFrom } from "rxjs";

/**
 * @class DifySegmentClientService
 * @description Client Service giao tiếp với Dify Open API cho các thao tác trên Segments (Chunks/Q&A) & Hit Testing Retrieval.
 * 
 * Luồng hoạt động chính:
 * 1. `getSegments`: Phân trang tự động để lấy toàn bộ các đoạn văn bản (Segments) đã index của một Document từ Dify API.
 * 2. `createSegment`: Thêm mới 1 đoạn văn bản (Segment/Chunk) vào Document.
 * 3. `updateSegment`: Cập nhật nội dung văn bản của 1 Segment trên Dify.
 * 4. `deleteSegment`: Xóa 1 Segment khỏi Document trên Dify.
 * 5. `retrieveSegments`: Thực thi truy vấn Hit Testing Retrieval (Hybrid Search / Semantic Vector Search) trên Dify Dataset.
 */
@Injectable()
export class DifySegmentClientService {
  private readonly logger = new Logger(DifySegmentClientService.name);

  constructor(private readonly httpService: HttpService) {}

  private get headers() {
    return {
      Authorization: `Bearer ${process.env.DIFY_API_KEY}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Lấy tất cả các Segments (Chunks) của một Document từ Dify
   */
  async getSegments(
    difyDatasetId: string,
    difyDocumentId: string,
    keyword?: string,
  ) {
    const url = `${process.env.DIFY_API_URL}/datasets/${difyDatasetId}/documents/${difyDocumentId}/segments`;

    const params: any = { status: "completed" };
    if (keyword) params.keyword = keyword;

    try {
      let allSegments: any[] = [];
      let currentPage = 1;
      let totalFetched = 0;
      let total = 0;

      // Duyệt phân trang tự động cho đến khi lấy hết toàn bộ Segments
      do {
        const response = await firstValueFrom(
          this.httpService.get(url, {
            headers: this.headers,
            params: { ...params, page: currentPage, limit: 1000 },
          }),
        );

        const pageData = response.data.data || [];
        allSegments = allSegments.concat(pageData);
        
        total = response.data.total || 0;
        totalFetched += pageData.length;
        currentPage++;

        if (pageData.length === 0 || totalFetched >= total) {
          break;
        }
      } while (true);

      return { data: allSegments, total: allSegments.length };
    } catch (error: any) {
      this.logger.error("Dify Get Segments Error:", error.response?.data || error.message);
      throw new InternalServerErrorException(
        "Lỗi khi lấy danh sách Segment từ Dify",
      );
    }
  }

  /**
   * Thêm mới một Segment (Chunk) vào Document trên Dify
   */
  async createSegment(
    difyDatasetId: string,
    difyDocumentId: string,
    text: string,
  ) {
    const url = `${process.env.DIFY_API_URL}/datasets/${difyDatasetId}/documents/${difyDocumentId}/segments`;

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          url,
          {
            segments: [
              {
                content: text,
                answer: "",
                keywords: [],
              },
            ],
          },
          { headers: this.headers },
        ),
      );
      return response.data.data[0];
    } catch (error: any) {
      this.logger.error("Dify Create Segment Error:", error.response?.data || error.message);
      throw new InternalServerErrorException("Lỗi khi thêm dữ liệu vào Dify");
    }
  }

  /**
   * Thêm mới hàng loạt Segments (Chunks) vào Document trên Dify trong 1 request
   */
  async createSegmentsBatch(
    difyDatasetId: string,
    difyDocumentId: string,
    items: Array<{ content: string; answer?: string; keywords?: string[] }>,
  ) {
    const url = `${process.env.DIFY_API_URL}/datasets/${difyDatasetId}/documents/${difyDocumentId}/segments`;

    try {
      const payloadSegments = items.map((item) => ({
        content: item.content,
        answer: item.answer || "",
        keywords: item.keywords || [],
      }));

      const response = await firstValueFrom(
        this.httpService.post(
          url,
          { segments: payloadSegments },
          { headers: this.headers },
        ),
      );
      return response.data.data;
    } catch (error: any) {
      this.logger.error("Dify Create Segments Batch Error:", error.response?.data || error.message);
      throw new InternalServerErrorException("Lỗi khi thêm dữ liệu hàng loạt vào Dify");
    }
  }

  /**
   * Cập nhật nội dung của 1 Segment trên Dify
   */
  async updateSegment(
    difyDatasetId: string,
    difyDocumentId: string,
    difySegmentId: string,
    text: string,
  ) {
    const url = `${process.env.DIFY_API_URL}/datasets/${difyDatasetId}/documents/${difyDocumentId}/segments/${difySegmentId}`;

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          url,
          {
            segment: {
              content: text,
              answer: "",
              keywords: [],
            },
          },
          { headers: this.headers },
        ),
      );
      return response.data;
    } catch (error: any) {
      this.logger.error("Dify Update Segment Error:", error.response?.data || error.message);
      throw new InternalServerErrorException(
        "Lỗi khi cập nhật dữ liệu trên Dify",
      );
    }
  }

  /**
   * Xóa 1 Segment khỏi Document trên Dify
   */
  async deleteSegment(
    difyDatasetId: string,
    difyDocumentId: string,
    difySegmentId: string,
  ) {
    const url = `${process.env.DIFY_API_URL}/datasets/${difyDatasetId}/documents/${difyDocumentId}/segments/${difySegmentId}`;

    try {
      await firstValueFrom(
        this.httpService.delete(url, { headers: this.headers }),
      );
      return true;
    } catch (error: any) {
      this.logger.error("Dify Delete Segment Error:", error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Kiểm thử độ chính xác truy xuất Hit Testing Retrieval trên Dify Dataset
   * 
   * @param difyDatasetId UUID Dataset
   * @param userQuery Câu hỏi người dùng
   */
  async retrieveSegments(difyDatasetId: string, userQuery: string) {
    try {
      const url = `${process.env.DIFY_API_URL}/datasets/${difyDatasetId}/retrieve`;

      const payload = {
        query: {
          content: userQuery,
        },
        retrieval_model: {
          search_method: "hybrid_search",
          reranking_enable: false,
          weights: 0.7,
          top_k: 3,
          score_threshold_enabled: false,
        },
      };

      const response = await lastValueFrom(
        this.httpService.post(url, payload, { headers: this.headers }),
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(
        "Dify Retrieve Error:",
        error?.response?.data || error.message,
      );
      throw new HttpException(
        error?.response?.data?.message || "Failed to retrieve from Dify",
        error?.response?.status || 500,
      );
    }
  }
}
