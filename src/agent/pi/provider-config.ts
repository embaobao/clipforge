/** pi sdk 适配层：把 ClipForge 的 agentProviders 设置映射为 pi-ai 的模型与调用配置。
 *  边界：本目录是 pi sdk 的唯一接入点，业务代码不直接 import pi-ai（便于版本锁定与替换）。 */
import {
  completeSimple,
  getModel,
  getProviders,
  type AssistantMessage,
  type KnownProvider,
} from "@mariozechner/pi-ai";

/** ClipForge 设置里单个 Agent provider 的配置形状（settings.agentProviders 数组成员）。 */
export type AgentProviderConfig = {
  /** pi-ai 的 provider 标识（anthropic/openai/deepseek/zai/...）。 */
  provider: KnownProvider | string;
  /** 展示名（设置页可读标签）。 */
  label?: string;
  /** 模型 id（pi-ai MODELS 表的 key；留空用 provider 默认模型）。 */
  modelId?: string;
  /** API Key（调用时注入 env，不持久化到剪贴板数据）。 */
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

/** 由 provider 标识与模型 id 取 pi-ai 模型对象；modelId 留空取该 provider 首个模型。 */
export function resolvePiModel(providerConfig: AgentProviderConfig) {
  const provider = providerConfig.provider as KnownProvider;
  const modelId = providerConfig.modelId;
  return modelId ? getModel(provider, modelId as never) : getModel(provider, undefined as never);
}

/** 最小补全调用：system + prompt → 助手消息（非流式，适合分析/标签等一次性任务）。 */
export async function piComplete(input: PiCompletionInput): Promise<AssistantMessage> {
  const config = input.providerConfig ?? { provider: "anthropic" as const };
  const model = resolvePiModel(config);
  return completeSimple(
    model,
    {
      systemPrompt: input.system,
      messages: [
        { role: "user", content: input.prompt, timestamp: Date.now() },
      ],
    },
    input.apiKey ? { apiKey: input.apiKey } : undefined,
  );
}
