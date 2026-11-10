import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { Prisma } from "@prisma/client";

/**
 * @class SemanticRouterService
 * @description Service Định tuyến Ngữ nghĩa (Semantic Vector Routing) sử dụng Local LLM (Ollama) & PostgreSQL pgvector.
 * 
 * Luồng hoạt động chính:
 * 1. Gọi Local Ollama Embeddings Service (model `embeddinggemma`) để vectorize câu hỏi người dùng thành 768-dimensional float vector.
 * 2. Thực hiện truy vấn Vector Similarity Search trên bảng `categories` sử dụng toán tử Cosine Distance (`<=>`) của pgvector.
 * 3. Lọc Top 3 Category có độ tương đồng cao nhất, kiểm tra ngưỡng an toàn (Similarity Threshold >= 0.3).
 * 4. Trả về Materialized Path của Category tốt nhất để Router tự động định tuyến câu hỏi đến đúng kho tri thức.
 * 5. Hỗ trợ tự động tạo/cập nhật Vector Embedding ngầm khi Category thay đổi & Tool đồng bộ batch toàn bộ danh mục.
 */
@Injectable()
export class SemanticRouterService {
  private readonly logger = new Logger(SemanticRouterService.name);
  private readonly ollamaUrl: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private httpService: HttpService, 
  ) {
    // Cấu hình URL endpoint kết nối tới Local Ollama Service
    this.ollamaUrl = this.configService.get<string>(
      "OLLAMA_BASE_URL",
      "http://localhost:11434",
    );
  }

  /**
   * Tạo Vector Embedding cho văn bản thông qua Ollama Model `embeddinggemma`
   * 
   * @param text Chuỗi văn bản cần tạo vector
   * @returns Mảng số thực float 768 chiều đại diện cho Vector Embedding, hoặc `null` nếu thất bại
   */
  async getEmbedding(text: string): Promise<number[] | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.ollamaUrl}/api/embeddings`, {
          model: "embeddinggemma",
          prompt: text.replace(/\n/g, " "),
        }),
      );
      // Response dạng { "embedding": [0.1, 0.2, ... 768 float numbers] }
      return response.data.embedding;
    } catch (error) {
      this.logger.error(
        "Failed to generate embedding via Ollama",
        error?.response?.data || error.message,
      );
      return null;
    }
  }

  /**
   * Định tuyến Ngữ nghĩa: Tìm kiếm Category phù hợp nhất cho User Query thông qua pgvector Similarity Search
   * 
   * @param query Câu hỏi nhập vào từ người dùng
   * @param departmentId (Optional) ID phòng ban để giới hạn phạm vi tìm kiếm
   * @returns Chuỗi Materialized Path của Category phù hợp nhất (vd: `/1/5/`) hoặc `null` nếu không match
   */
  async findSuitableCategory(
    query: string,
    departmentId?: number,
  ): Promise<string | null> {
    
    this.logger.log(`\n========== [ROUTER START] ==========`);
    this.logger.log(`[1] User Query: "${query}"`);

    // Bước 1: Vectorize câu hỏi của User
    const embedding = await this.getEmbedding(query);
    if (!embedding) {
      this.logger.error(`[X] Không tạo được embedding cho query!`);
      return null;
    }

    const vectorQuery = `[${embedding.join(",")}]`;
    const departmentFilter = departmentId
      ? Prisma.sql`AND "department_id" = ${departmentId}`
      : Prisma.empty;

    try {
      // Bước 2: Truy vấn PostgreSQL pgvector tìm TOP 3 Categories có Cosine Similarity cao nhất
      const topCategories = await this.prisma.$queryRaw<
        Array<{
          path: string;
          name: string;
          description: string;
          similarity: number;
        }>
      >`
        SELECT "path", "name", "description", 1 - ("embedding" <=> ${vectorQuery}::vector) as similarity
        FROM "categories"
        WHERE "embedding" IS NOT NULL ${departmentFilter}
        ORDER BY "embedding" <=> ${vectorQuery}::vector ASC
        LIMIT 3
      `;

      if (topCategories.length === 0) {
        this.logger.log(`[X] Vector DB: Trống hoặc không có Category nào có vector!`);
        return null;
      }

      // Log kết quả Top 3 để Debug & Monitor
      this.logger.log(`[2] Vector DB Top 3:`);
      topCategories.forEach((cat, index) => {
        this.logger.log(`   #${index + 1} | Điểm: ${cat.similarity.toFixed(4)} | Path: ${cat.path} | Name: ${cat.name}`);
      });

      // Bước 3: Kiểm tra Ngưỡng tương đồng An toàn (Threshold Check >= 0.3)
      if (topCategories[0].similarity < 0.3) {
         this.logger.log(`[X] Dừng sớm: Điểm tương đồng cao nhất (${topCategories[0].similarity.toFixed(4)}) quá thấp (< 0.3). User đang hỏi lệch chủ đề.`);
         return null;
      }

      // Bước 4: Chốt chọn kết quả Top 1 tương đồng nhất
      const finalPath = topCategories[0].path;
      this.logger.log(`[3] CHỐT HẠ (Vector Tự Quyết): "${finalPath}"`);
      this.logger.log(`========== [ROUTER END] ==========\n`);

      return finalPath;

    } catch (error) {
      this.logger.error("[X] Vector search failed", error);
    }

    return null;
  }

  /**
   * Cập nhật cột vector embedding trong DB khi tạo hoặc chỉnh sửa thông tin Category
   * 
   * @param categoryId ID Category cần cập nhật
   * @param name Tên Category
   * @param description Mô tả Category
   */
  async updateCategoryEmbedding(
    categoryId: number,
    name: string,
    description?: string | null,
  ) {
    const textToEmbed = `${name} ${description || ""}`.trim();
    if (!textToEmbed) return;

    const embedding = await this.getEmbedding(textToEmbed);
    if (!embedding) return;

    const vectorString = `[${embedding.join(",")}]`;

    try {
      // Thực thi Raw SQL Update cột "embedding" dạng vector(768)
      await this.prisma.$executeRaw`
        UPDATE "categories" SET "embedding" = ${vectorString}::vector WHERE "id" = ${categoryId}
      `;
      this.logger.log(`Updated embedding for category ${categoryId}`);
    } catch (error) {
      this.logger.error(
        `Failed to update embedding for category ${categoryId}`,
        error,
      );
    }
  }

  /**
   * Tool đồng bộ hàng loạt (Batch Sync) Vector Embeddings cho toàn bộ các Category đã tồn tại trong DB
   */
  async syncAllCategories() {
    this.logger.log('Bắt đầu đồng bộ Vector cho toàn bộ Categories...');
    
    const categories = await this.prisma.category.findMany();
    
    let successCount = 0;
    let failCount = 0;

    for (const cat of categories) {
      try {
        await this.updateCategoryEmbedding(cat.id, cat.name, cat.description);
        successCount++;
        // Thêm delay 100ms giữa các request để tránh gây tải cao cho Local Ollama Server
        await new Promise(resolve => setTimeout(resolve, 100)); 
      } catch (error) {
        this.logger.error(`Lỗi khi sync category ID ${cat.id}:`, error.message);
        failCount++;
      }
    }

    this.logger.log(`Hoàn tất đồng bộ! Thành công: ${successCount}, Thất bại: ${failCount}`);
    
    return {
      total: categories.length,
      success: successCount,
      failed: failCount,
      message: 'Tiến trình đồng bộ Vector đã chạy xong!'
    };
  }
}
