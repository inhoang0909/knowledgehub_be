import { Injectable, Logger, InternalServerErrorException } from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { DifyDbService } from "../dify-db.service";
import { DifyConsoleAuthService } from "../dify-console-auth.service";
import { CreateChatbotDto } from "../dto/create-chatbot.dto";
import { generateSystemPrompt } from "../utils/prompt-template.util";

/**
 * @class ChatbotAdminService
 * @description Sub-service chuyên trách quản lý Quản trị Chatbot App (Tạo mới, Cấu hình Prompt/LLM Model, Xóa App) trên Dify Console API.
 * 
 * Luồng hoạt động chính:
 * 1. `createChatbot`:
 *    - Lấy danh sách `difyDatasetId` từ danh sách ID Dataset truyền lên.
 *    - Tự động sinh System Pre-Prompt chuẩn hóa từ Role, Task & Language (`generateSystemPrompt`).
 *    - Gọi Dify Console API (`/console/api/apps`) để khởi tạo App mới dạng `chat`.
 *    - Cấu hình LLM Model (mặc định lấy model mặc định của Workspace hoặc OpenAI `gpt-4o-mini`).
 *    - Gắn mảng Datasets vào cấu hình `dataset_configs` của App.
 *    - Tự động liên kết `app_model_config_id` trong bảng `apps` trên Dify DB.
 * 2. `deleteChatbot`: Gọi Dify Console API xóa App theo `difyAppId`.
 */
@Injectable()
export class ChatbotAdminService {
  private readonly logger = new Logger(ChatbotAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly difyDb: DifyDbService,
    private readonly consoleAuth: DifyConsoleAuthService,
  ) {}

  /**
   * Tạo Chatbot mới trên Dify dựa trên Name, Role và các Dataset được liên kết
   * 
   * @param dto Dữ liệu tạo Chatbot (name, role, tasks, lang, datasetIds)
   * @returns Thông tin phản hồi tạo Chatbot thành công kèm `difyAppId` và prePrompt đã sinh
   */
  async createChatbot(dto: CreateChatbotDto) {
    let difyDatasetIds: string[] = [];

    // -----------------------------------------------------------------
    // BƯỚC 1: Lấy danh sách Dify Dataset UUIDs từ Prisma Local DB
    // -----------------------------------------------------------------
    if (dto.datasetIds && dto.datasetIds.length > 0) {
      const datasets = await this.prisma.dataset.findMany({
        where: {
          id: { in: dto.datasetIds },
          isDeleted: false,
        },
        select: { difyDatasetId: true, name: true },
      });
      difyDatasetIds = datasets.map(d => d.difyDatasetId);
    }

    // -----------------------------------------------------------------
    // BƯỚC 2: Tự động tạo System Prompt Template theo Ngôn ngữ & Vai trò
    // -----------------------------------------------------------------
    const prePrompt = generateSystemPrompt(dto.role, dto.tasks, dto.lang);

    // -----------------------------------------------------------------
    // BƯỚC 3: Gọi Dify Console API khởi tạo Chatbot App
    // -----------------------------------------------------------------
    const createAppUrl = `${this.consoleAuth.consoleBaseUrl}/console/api/apps`;
    const fetch = (await import("node-fetch")).default;

    let authHeaders = await this.consoleAuth.getAuthHeaders();
    let createAppRes = await fetch(createAppUrl, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: dto.name,
        icon: "🤖",
        icon_background: "#FFEAD5",
        mode: "chat",
        description: dto.role,
      }),
    });

    // Thử làm mới Token nếu nhận HTTP Status 401 Unauthorized
    if (createAppRes.status === 401) {
      this.consoleAuth.invalidate();
      authHeaders = await this.consoleAuth.getAuthHeaders();
      createAppRes = await fetch(createAppUrl, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: dto.name,
          icon: "🤖",
          icon_background: "#FFEAD5",
          mode: "chat",
          description: dto.role,
        }),
      });
    }

    if (!createAppRes.ok) {
      const errText = await createAppRes.text();
      this.logger.error(`Create Chatbot App failed (${createAppRes.status}): ${errText}`);
      throw new InternalServerErrorException(`Không thể tạo Chatbot trên Dify: ${errText}`);
    }

    const createdApp: any = await createAppRes.json();
    const difyAppId = createdApp.id;
    this.logger.log(`Created Dify App ${difyAppId} (${dto.name}) successfully.`);

    // -----------------------------------------------------------------
    // BƯỚC 4: Cấu hình Prompt & Gắn Datasets vào Model Config của App
    // -----------------------------------------------------------------
    const modelConfigUrl = `${this.consoleAuth.consoleBaseUrl}/console/api/apps/${difyAppId}/model-config`;
    let existingModelConfig: any = {};
    try {
      const appDetailUrl = `${this.consoleAuth.consoleBaseUrl}/console/api/apps/${difyAppId}`;
      const getRes = await fetch(appDetailUrl, {
        method: "GET",
        headers: await this.consoleAuth.getAuthHeaders(),
      });
      if (getRes.ok) {
        const appDetail: any = await getRes.json();
        existingModelConfig = appDetail?.model_config || {};
      }
    } catch (e) {
      this.logger.warn(`Could not fetch app detail for app ${difyAppId}:`, e);
    }

    // Xác định LLM Model từ cấu hình Workspace hoặc dùng fallback gpt-4o-mini
    let modelObj = existingModelConfig?.model;
    if (!modelObj) {
      try {
        const defaultModelUrl = `${this.consoleAuth.consoleBaseUrl}/console/api/workspaces/current/default-model?model_type=llm`;
        const defRes = await fetch(defaultModelUrl, {
          method: "GET",
          headers: await this.consoleAuth.getAuthHeaders(),
        });
        if (defRes.ok) {
          const defData: any = await defRes.json();
          if (defData?.data) {
            const providerRaw = defData.data.provider;
            const providerStr = typeof providerRaw === 'string'
              ? providerRaw
              : providerRaw?.provider || 'openai';

            modelObj = {
              provider: providerStr,
              name: defData.data.model,
              mode: defData.data.model_properties?.mode || "chat",
              completion_params: {},
            };
          }
        }
      } catch (e) {
        this.logger.warn(`Could not fetch workspace default model:`, e);
      }
    }

    if (modelObj && typeof modelObj.provider === 'object' && modelObj.provider !== null) {
      modelObj.provider = modelObj.provider.provider || 'openai';
    }

    if (!modelObj) {
      modelObj = {
        provider: "openai",
        name: "gpt-4o-mini",
        mode: "chat",
        completion_params: {},
      };
    }

    const modelConfigBody: any = {
      pre_prompt: prePrompt,
      prompt_type: "simple",
      chat_prompt_config: {},
      completion_prompt_config: {},
      user_input_form: [],
      model: modelObj,
      dataset_query_variable: "",
      opening_statement: "",
      suggested_questions: [],
      more_like_this: existingModelConfig?.more_like_this || { enabled: false },
      suggested_questions_after_answer: existingModelConfig?.suggested_questions_after_answer || { enabled: false },
      speech_to_text: existingModelConfig?.speech_to_text || { enabled: false },
      text_to_speech: existingModelConfig?.text_to_speech || { enabled: false },
      retriever_resource: existingModelConfig?.retriever_resource || { enabled: true },
      sensitive_word_avoidance: existingModelConfig?.sensitive_word_avoidance || { enabled: false },
      file_upload: existingModelConfig?.file_upload || {
        image: { enabled: false, number_limits: 3, detail: "high", transfer_methods: ["remote_url", "local_file"] },
      },
      agent_mode: {
        enabled: false,
        strategy: "function_call",
        tools: [],
      },
    };

    if (difyDatasetIds.length > 0) {
      modelConfigBody.dataset_configs = {
        retrieval_model: "multiple",
        datasets: {
          datasets: difyDatasetIds.map(id => ({ dataset: { enabled: true, id } })),
        },
      };
    } else {
      modelConfigBody.dataset_configs = {
        retrieval_model: "multiple",
        datasets: { datasets: [] },
      };
    }

    try {
      const configRes = await fetch(modelConfigUrl, {
        method: "POST",
        headers: {
          ...(await this.consoleAuth.getAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(modelConfigBody),
      });

      if (!configRes.ok) {
        const configErr = await configRes.text();
        this.logger.warn(`Update model config for app ${difyAppId} returned status ${configRes.status}: ${configErr}`);
      } else {
        const configData: any = await configRes.json();
        const modelConfigId = configData?.model_config?.id || configData?.id;
        if (modelConfigId) {
          try {
            await this.difyDb.query(
              `UPDATE apps SET app_model_config_id = $1 WHERE id = $2`,
              [modelConfigId, difyAppId],
            );
            this.logger.log(`Linked app_model_config_id ${modelConfigId} to app ${difyAppId}`);
          } catch (e) {
            this.logger.warn(`Could not update app_model_config_id in apps table:`, e);
          }
        }
      }
    } catch (err) {
      this.logger.error(`Failed to update model config for app ${difyAppId}:`, err);
    }

    return {
      success: true,
      message: "Tạo Chatbot thành công",
      difyAppId,
      name: createdApp.name,
      role: dto.role,
      prompt: prePrompt,
      linkedDatasetCount: difyDatasetIds.length,
    };
  }

  /**
   * Xóa Chatbot khỏi Dify qua Console API
   * 
   * @param difyAppId UUID của Dify App cần xóa
   */
  async deleteChatbot(difyAppId: string) {
    const url = `${this.consoleAuth.consoleBaseUrl}/console/api/apps/${difyAppId}`;
    const fetch = (await import("node-fetch")).default;

    let authHeaders = await this.consoleAuth.getAuthHeaders();
    let res = await fetch(url, {
      method: "DELETE",
      headers: {
        ...authHeaders,
      },
    });

    if (res.status === 401) {
      this.consoleAuth.invalidate();
      authHeaders = await this.consoleAuth.getAuthHeaders();
      res = await fetch(url, {
        method: "DELETE",
        headers: {
          ...authHeaders,
        },
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      this.logger.error(`Delete Chatbot app ${difyAppId} failed (${res.status}): ${errText}`);
      throw new InternalServerErrorException(`Không thể xóa Chatbot trên Dify: ${errText}`);
    }

    this.logger.log(`Deleted Dify App ${difyAppId} successfully.`);
    return {
      success: true,
      message: "Xóa Chatbot thành công",
      difyAppId,
    };
  }
}
