/** ClipForge Agent 会话装配：pi-agent-core 的 Agent + pi-ai 模型 + 剪贴板工具。
 *  边界：provider/model/API Key 由调用方传入（设置层解析）；本文件不读设置、不做网络。
 *  1.1.0 适配：Agent 构造强制要求 streamFn（`@earendil-works/pi-ai/providers/all` 的
 *  builtinModels() 集合的 streamSimple 满足 StreamFn 形状）；getApiKey 签名改为
 *  `(provider: string) => ...`，provider 未命中时返回 undefined 交给 pi 自身 env 回退。 */
import { Agent } from "@earendil-works/pi-agent-core";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { Api, Model } from "@earendil-works/pi-ai";
import { clipForgeTools } from "./tools";

export type ClipForgeAgentOptions = {
  /** pi-ai 的 provider 标识（anthropic/openai/deepseek/zai/...）。 */
  provider: string;
  modelId?: string;
  apiKey?: string;
  /** 会话系统提示（默认面向剪贴板条目分析场景）。 */
  systemPrompt?: string;
};

const DEFAULT_SYSTEM_PROMPT =
  "你是 ClipForge 的剪贴板助手，可以调用 clipboard_search 工具检索用户的剪贴板历史。" +
  "回答基于工具返回的真实条目，不要编造内容。";

/** pi-ai 1.1.0 静态目录读取：modelId 留空或未命中时回落该 provider 首个模型。
 *  getBuiltinModel 对未知 provider/模型返回 undefined，与 0.73.1 的 getModel 行为一致。 */
function resolveAgentModel(provider: string, modelId?: string): Model<Api> {
  const models = builtinModels();
  const model = modelId ? models.getModel(provider, modelId) : undefined;
  const fallback = model ?? models.getModels(provider)[0];
  if (!fallback) {
    throw new Error(`pi provider 无可用模型：${provider}${modelId ? ` / ${modelId}` : ""}`);
  }
  return fallback;
}

/** 装配一个带剪贴板工具的 Agent 会话。 */
export function createClipForgeAgent(options: ClipForgeAgentOptions): Agent {
  const model = resolveAgentModel(options.provider, options.modelId);
  const models = builtinModels();
  return new Agent({
    initialState: {
      model,
      systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      tools: clipForgeTools() as never,
    },
    // Agent 构造必填：把内置 provider 集合的 streamSimple 作为流式实现。
    streamFn: (m, context, streamOptions) => models.streamSimple(m, context, streamOptions),
    // 1.1.0 起 getApiKey 接收 provider 参数；未配置 key 时返回 undefined，
    // 由 pi-ai 走自身 env 回退（findEnvKeys）。
    getApiKey: async (provider: string) => (provider === options.provider ? options.apiKey : undefined),
  });
}
