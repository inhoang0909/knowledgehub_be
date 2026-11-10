import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
const FormData = require("form-data");

/**
 * @class DifyDocumentClientService
 * @description Client Service giao tiếp với Dify Open API cho các thao tác trên Document Container (File Upload, Metadata, Status).
 * 
 * Luồng hoạt động chính:
 * 1. `createContainerDocument`: Tải file hoặc văn bản lên Dify qua FormData multipart API.
 *    - Thử nghiệm tạo ở chế độ `automatic` trước. Nếu thất bại, tự động chuyển sang chế độ `custom` fallback.
 * 2. `getDocumentDetail`: Lấy thông tin chi tiết của 1 Document từ Dify.
 * 3. `updateDocumentStatus`: Thay đổi trạng thái Document (`enable` | `disable` | `archive`).
 * 4. `deleteDocument`: Xóa Document khỏi Dify.
 * 5. `updateDocumentMetadata`: Cập nhật thuộc tính trường tùy chỉnh (Doc Metadata) cho Document.
 */
@Injectable()
export class DifyDocumentClientService {
  private readonly logger = new Logger(DifyDocumentClientService.name);

  constructor(private readonly httpService: HttpService) { }

  private get headers() {
    return {
      Authorization: `Bearer ${process.env.DIFY_API_KEY}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Tạo Document Container trên Dify bằng cách tải File hoặc gửi nội dung text
   * 
   * @param difyDatasetId UUID Dataset
   * @param name Tên tài liệu
   * @param fileBuffer Buffer của file tài liệu
   * @param originalFilename Tên file gốc
   * @param metadata (Optional) Object chứa các trường Metadata tùy chỉnh
   */
  async createContainerDocument(
    difyDatasetId: string,
    name: string,
    fileBuffer?: Buffer,
    originalFilename?: string,
    metadata?: Record<string, any>
  ) {
    const url = `${process.env.DIFY_API_URL}/datasets/${difyDatasetId}/document/create-by-file`;

    try {
      const buildForm = (mode: 'custom' | 'automatic') => {
        const f = new FormData();

        const configData: any = {
          indexing_technique: 'high_quality',
          doc_form: 'text_model',
          process_rule: {
            mode: mode,
            ...(mode === 'custom' ? {
              rules: {
                pre_processing_rules: [
                  { id: "remove_extra_spaces", enabled: true },
                  { id: "remove_urls_emails", enabled: false }
                ],
                segmentation: {
                  separator: "\n",
                  max_tokens: 10000,
                  chunk_overlap: 50
                }
              }
            } : {})
          },
        };

        if (metadata && Object.keys(metadata).length > 0) {
          configData.doc_metadata = metadata;
        }

        f.append('data', JSON.stringify(configData));

        if (fileBuffer && originalFilename) {
          f.append('file', fileBuffer, { filename: originalFilename });
        } else {
          const dummyContent = `# ${name}\n---\nContainer document`;
          f.append('file', Buffer.from(dummyContent), { filename: `${name}.txt` });
        }

        return { f, configData };
      };

      const tryPost = async (mode: 'custom' | 'automatic') => {
        const { f, configData } = buildForm(mode);
        this.logger.debug(`Dify: POST ${url} with mode=${mode}`);
        const resp = await firstValueFrom(
          this.httpService.post(url, f, {
            headers: {
              Authorization: `Bearer ${process.env.DIFY_API_KEY}`,
              ...f.getHeaders(),
            },
          }),
        );
        return resp.data;
      };

      // Thử mode 'automatic' trước, nếu lỗi chuyển sang 'custom'
      try {
        return await tryPost('automatic');
      } catch (err: any) {
        const errMsg = err.response?.data || err.message || JSON.stringify(err);
        this.logger.debug(`Dify: POST with automatic mode failed, trying custom mode:`, errMsg);
        try {
          return await tryPost('custom');
        } catch (fallbackErr: any) {
          const fallbackMsg = fallbackErr.response?.data || fallbackErr.message || JSON.stringify(fallbackErr);
          this.logger.error("Dify: Both automatic and custom modes failed", fallbackMsg);
          throw new InternalServerErrorException(
            `Lỗi khi tạo Document trên Dify: ${typeof fallbackMsg === 'string' ? fallbackMsg : JSON.stringify(fallbackMsg)}`
          );
        }
      }
    } catch (error: any) {
      const errorDetail = error.response?.data || error.message || JSON.stringify(error);
      this.logger.error("Dify Create Container Document Error:", errorDetail);
      throw new InternalServerErrorException(
        `Lỗi khi tạo Container Document trên Dify: ${typeof errorDetail === 'string' ? errorDetail : JSON.stringify(errorDetail)}`
      );
    }
  }

  /**
   * Lấy thông tin chi tiết của Document từ Dify
   */
  async getDocumentDetail(difyDatasetId: string, difyDocumentId: string) {
    const url = `${process.env.DIFY_API_URL}/datasets/${difyDatasetId}/documents/${difyDocumentId}`;
    try {
      const response = await firstValueFrom(
        this.httpService.get(url, { headers: this.headers }),
      );
      return response.data;
    } catch (error: any) {
      this.logger.error("Dify Get Detail Error:", error.response?.data || error.message);
      if (error.response?.status === 404) return null;
      throw new InternalServerErrorException("Lỗi kết nối Dify");
    }
  }

  /**
   * Cập nhật trạng thái Document trên Dify (`enable` | `disable` | `archive`)
   */
  async updateDocumentStatus(
    difyDatasetId: string,
    difyDocumentId: string,
    action: "enable" | "disable" | "archive",
  ) {
    const url = `${process.env.DIFY_API_URL}/datasets/${difyDatasetId}/documents/status/${action}`;

    try {
      const response = await firstValueFrom(
        this.httpService.patch(
          url,
          {
            document_ids: [difyDocumentId],
          },
          { headers: this.headers },
        ),
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(
        `Dify Update Status Error (${action}):`,
        error.response?.data || error.message,
      );
      throw new InternalServerErrorException(
        `Lỗi khi cập nhật trạng thái '${action}' trên Dify`,
      );
    }
  }

  /**
   * Xóa Document khỏi Dify
   */
  async deleteDocument(difyDatasetId: string, difyDocumentId: string) {
    const url = `${process.env.DIFY_API_URL}/datasets/${difyDatasetId}/documents/${difyDocumentId}`;

    try {
      await firstValueFrom(
        this.httpService.delete(url, { headers: this.headers }),
      );
      return true;
    } catch (error: any) {
      this.logger.error("Dify Delete Error:", error.response?.data || error.message);
      return true;
    }
  }

  /**
   * Cập nhật Metadata cho Document trên Dify
   */
  async updateDocumentMetadata(difyDatasetId: string, difyDocumentId: string, metadata: Record<string, any>) {
    const url = `${process.env.DIFY_API_URL}/datasets/${difyDatasetId}/documents/${difyDocumentId}/metadata`;
    try {
      const response = await firstValueFrom(
        this.httpService.put(
          url,
          { doc_metadata: metadata },
          { headers: this.headers }
        )
      );
      return response.data;
    } catch (error: any) {
      this.logger.error("Dify Update Metadata Error:", error.response?.data || error.message);
      return null;
    }
  }
}
