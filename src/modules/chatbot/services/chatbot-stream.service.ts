import { Injectable, Logger, InternalServerErrorException } from "@nestjs/common";
import { Response } from "express";
import { DifyDbService } from "../dify-db.service";
import { DifyConsoleAuthService } from "../dify-console-auth.service";

/**
 * @class ChatbotStreamService
 * @description Sub-service chuyên trách Proxy Chat Stream qua Server-Sent Events (SSE) & Trích xuất Site Tokens.
 * 
 * Luồng hoạt động chính:
 * 1. `getSiteTokenForApp`: Lấy chuỗi `iframe_code` từ bảng `sites` trên Dify DB để nhúng widget chat vào website.
 * 2. `proxyChatStream`:
 *    - Tìm kiếm API Key của Chatbot App từ Dify DB. Nếu thiếu, tự động tạo key mới qua Console API.
 *    - Tự động kiểm tra & sửa chữa trường `app_model_config_id` bị NULL trên Dify DB để tránh lỗi streaming.
 *    - Cấu hình HTTP Response Headers dạng `text/event-stream` (SSE).
 *    - Gọi Dify Chat-Messages API (`response_mode: 'streaming'`) và pipe dữ liệu phản hồi real-time về cho client.
 */
@Injectable()
export class ChatbotStreamService {
  private readonly logger = new Logger(ChatbotStreamService.name);

  constructor(
    private readonly difyDb: DifyDbService,
    private readonly consoleAuth: DifyConsoleAuthService,
  ) {}

  /**
   * Truy xuất Site Token (mã Iframe) cho Chatbot App từ Dify DB
   * 
   * @param difyAppId UUID của Dify App
   * @returns Object chứa `token` (iframe code)
   */
  async getSiteTokenForApp(difyAppId: string): Promise<{ token: string | null }> {
    const sql = `
      SELECT s.code AS iframe_code
      FROM sites s
      WHERE s.app_id = $1
      LIMIT 1
    `;

    try {
      const result = await this.difyDb.query(sql, [difyAppId]);
      if (result.rows.length > 0) {
        return { token: result.rows[0].iframe_code };
      }
      this.logger.warn(`No site token found for app ${difyAppId}`);
      return { token: null };
    } catch (err) {
      this.logger.error(
        `getSiteTokenForApp failed for app ${difyAppId}:`,
        err instanceof Error ? err.message : String(err),
      );
      throw new InternalServerErrorException(
        "Lỗi khi truy xuất site token từ Dify DB.",
      );
    }
  }

  /**
   * Proxy chat-message stream từ Dify API về frontend bằng Server-Sent Events (SSE)
   * 
   * @param difyAppId UUID của Dify App
   * @param body Thông tin câu hỏi (`query`), `conversationId`, `userId`
   * @param res Object Response HTTP của Express để ghi stream trực tiếp
   */
  async proxyChatStream(
    difyAppId: string,
    body: { query: string; conversationId?: string; userId?: string },
    res: Response,
  ) {
    let appToken: string | null = null;

    // -----------------------------------------------------------------
    // BƯỚC 1: Lấy App API Key từ Dify DB (Nếu chưa có -> Tự tạo qua Console API)
    // -----------------------------------------------------------------
    try {
      const apiTokenSql = `
        SELECT token FROM api_tokens
        WHERE app_id = $1 AND (type = 'app' OR token LIKE 'app-%')
        ORDER BY created_at DESC
        LIMIT 1
      `;
      const result = await this.difyDb.query(apiTokenSql, [difyAppId]);
      if (result.rows.length > 0) {
        appToken = result.rows[0].token;
      } else {
        this.logger.warn(
          `proxyChatStream: No app API key found in DB for app ${difyAppId}. Creating one via Console API...`,
        );
        try {
          const createKeyUrl = `${this.consoleAuth.consoleBaseUrl}/console/api/apps/${difyAppId}/api-keys`;
          const fetch = (await import("node-fetch")).default;
          const keyRes = await fetch(createKeyUrl, {
            method: "POST",
            headers: await this.consoleAuth.getAuthHeaders(),
          });
          if (keyRes.ok) {
            const keyData: any = await keyRes.json();
            appToken = keyData?.token || keyData?.api_key || null;
          }
        } catch (e) {
          this.logger.warn(`Could not create app API key via Console API for app ${difyAppId}:`, e);
        }
      }
    } catch (err) {
      this.logger.warn(
        `proxyChatStream: Failed to get app token from Dify DB: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // -----------------------------------------------------------------
    // BƯỚC 2: Tự động kiểm tra & sửa app_model_config_id nếu bị NULL
    // -----------------------------------------------------------------
    try {
      const checkAppSql = `SELECT app_model_config_id FROM apps WHERE id = $1`;
      const appRes = await this.difyDb.query(checkAppSql, [difyAppId]);
      if (appRes.rows.length > 0 && !appRes.rows[0].app_model_config_id) {
        const findConfigSql = `SELECT id FROM app_model_configs WHERE app_id = $1 ORDER BY created_at DESC LIMIT 1`;
        const configRes = await this.difyDb.query(findConfigSql, [difyAppId]);
        if (configRes.rows.length > 0) {
          const latestConfigId = configRes.rows[0].id;
          await this.difyDb.query(`UPDATE apps SET app_model_config_id = $1 WHERE id = $2`, [latestConfigId, difyAppId]);
        }
      }
    } catch (e) {
      this.logger.warn(`proxyChatStream: Check/repair app_model_config_id warning:`, e);
    }

    // -----------------------------------------------------------------
    // BƯỚC 3: Cấu hình Response Header dạng Server-Sent Events (SSE)
    // -----------------------------------------------------------------
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    const difyBaseUrl = (process.env.DIFY_API_URL || "").replace(/\/v1$/, "");
    const difyUrl = `${difyBaseUrl}/v1/chat-messages`;

    const authHeader = appToken
      ? `Bearer ${appToken}`
      : `Bearer ${process.env.DIFY_APP_API_KEY || process.env.DIFY_API_KEY}`;

    const payload = {
      inputs: {},
      query: body.query,
      response_mode: "streaming",
      conversation_id: body.conversationId || "",
      user: body.userId || "dify-wrapper-user",
      files: [],
    };

    // -----------------------------------------------------------------
    // BƯỚC 4: Pipe dữ liệu Stream từ Dify API trực tiếp về cho Client
    // -----------------------------------------------------------------
    try {
      const fetch = (await import("node-fetch")).default;
      const difyRes = await fetch(difyUrl, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!difyRes.ok) {
        const errText = await difyRes.text();
        this.logger.error(`Dify chat API error ${difyRes.status}: ${errText}`);
        res.write(
          `data: ${JSON.stringify({ event: "error", message: errText })}\n\n`,
        );
        res.end();
        return;
      }

      difyRes.body.on("data", (chunk: Buffer) => {
        res.write(chunk);
      });

      difyRes.body.on("end", () => {
        res.end();
      });

      difyRes.body.on("error", (err: Error) => {
        this.logger.error(`Stream error: ${err.message}`);
        res.end();
      });
    } catch (err) {
      this.logger.error(`proxyChatStream fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      res.write(
        `data: ${JSON.stringify({ event: "error", message: err instanceof Error ? err.message : String(err) })}\n\n`,
      );
      res.end();
    }
  }
}
