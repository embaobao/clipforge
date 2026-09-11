/** ClipForge Agent 会话装配：pi-agent-core 的 Agent + pi-ai 模型 + 剪贴板工具。
 *  边界：provider/model/API Key 由调用方传入（设置层解析）；本文件不读设置、不做网络。 */
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, type KnownProvider } from "@mariozechner/pi-ai";
import { clipForgeTools } from "./tools";

export type ClipForgeAgentOptions = {
  provider: KnownProvider | string;
  modelId?: string;
  apiKey?: string;
  /** 会话系统提示（默认面向剪贴板条目分析场景）。 */
  systemPrompt?: string;
};

const DEFAULT_SYSTEM_PROMPT =
  "你是 ClipForge 的剪贴板助手，可以调用 clipboard_search 工具检索用户的剪贴板历史。" +
  "回答基于工具返回的真实条目，不要编造内容。";

/** 装配一个带剪贴板工具的 Agent 会话。 */
export function createClipForgeAgent(options: ClipForgeAgentOptions): Agent {
  const model = getModel(options.provider as KnownProvider, options.modelId as never);
  return new Agent({
    initialState: {
      model,
      systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      tools: clipForgeTools() as never,
    },
    getApiKey: async () => options.apiKey,
  });
}
