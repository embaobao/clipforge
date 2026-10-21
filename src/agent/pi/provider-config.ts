/** pi sdk 适配层：把 ClipForge 的 agentProviders 设置映射为 pi-ai 的模型与调用配置。
 *  边界：本目录是 pi sdk 的唯一接入点，业务代码不直接 import pi-ai（便于版本锁定与替换）。
 *  1.1.0 适配：`completeSimple`/`getModel`/`getProviders` 不再从主入口导出，统一走
 *  `@earendil-works/pi-ai/compat` 兼容入口（官方标注 deprecated，迁移期保留最小改动）。 */
import {
  completeSimple,
  getModel,
  getProviders,
  type AssistantMessage,
} from "@earendil-works/pi-ai/compat";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { BuiltinProvider } from "@earendil-works/pi-ai/providers/all";

/** ClipForge 设置里单个 Agent provider 的配置形状（settings.agentProviders 数组成员）。 */
export type AgentProviderConfig = {
  /** pi-ai 的 provider 标识（anthropic/openai/deepseek/zai/...；1.1.0 字面量见 KnownProvider）。 */
  provider: string;
  /** 展示名（设置页可读标签）。 */
  label?: string;
  /** 模型 id（pi-ai MODELS 表的 key；留空用 provider 默认模型）。 */
  modelId?: string;
  /** API Key（只在运行时经 agent_resolve_pi_provider 解析注入，前端设置态不出现明文）。 */
  apiKey?: string;
  /** 基础 baseURL（自建网关/代理时用）。 */
  baseUrl?: string;
};

/** 一次最小 Agent 调用的输入：系统指令 + 用户内容。 */
export type PiCompletionInput = {
  system: string;
  prompt: string;
  /** 覆盖默认 provider/model（来自条目级配置时使用）。 */
  providerConfig?: AgentProviderConfig;
  apiKey?: string;
};

/** pi-ai 当前可用的 provider 列表（诊断/设置页展示用）。 */
export function availablePiProviders(): string[] {
  return getProviders() as string[];
}

/** 由 provider 标识与模型 id 取 pi-ai 模型对象；modelId 留空取该 provider 首个模型。
 *  baseUrl 存在时覆盖模型默认 baseUrl（自建/兼容网关场景，compat 由 pi-ai 按 baseUrl 自动探测）。
 *  1.1.0 起 getModel 对未知 provider/模型返回 undefined（0.73.1 为抛错），这里显式抛错
 *  保留「配置错误立刻失败」的可观测行为。 */
export function resolvePiModel(providerConfig: AgentProviderConfig): Model<Api> {
  const provider = providerConfig.provider as BuiltinProvider;
  const modelId = providerConfig.modelId as never;
  const model = modelId
    ? getModel(provider, modelId)
    : getModel(provider, undefined as never);
  if (!model) {
    throw new Error(`pi provider 无可用模型：${providerConfig.provider}${providerConfig.modelId ? ` / ${providerConfig.modelId}` : ""}`);
  }
  return providerConfig.baseUrl ? { ...model, baseUrl: providerConfig.baseUrl } : model;
}

/** 最小补全调用：system + prompt → 助手消息（非流式，适合分析/标签等一次性任务）。
 *  apiKey 只取运行时解析结果（resolveDefaultPiProvider → agent_resolve_pi_provider），
 *  缺省时 pi-ai 走自身 env 回退；前端设置态不持有明文 key。 */
export async function piComplete(input: PiCompletionInput): Promise<AssistantMessage> {
  const config = input.providerConfig ?? { provider: "anthropic" as const };
  const model = resolvePiModel(config);
  const apiKey = input.apiKey ?? config.apiKey;
  return completeSimple(
    model,
    {
      systemPrompt: input.system,
      messages: [
        { role: "user", content: input.prompt, timestamp: Date.now() },
      ],
    },
    apiKey ? { apiKey } : undefined,
  );
}
