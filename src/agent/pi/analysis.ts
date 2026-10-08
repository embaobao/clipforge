/** pi 底层的条目分析能力：摘要 + 标签建议（对应 Rust clipboard_analyze 命令）。
 *  边界：provider 配置从设置服务异步解析；无配置/调用失败抛错，由调用方降级展示。 */
import { invoke } from "@tauri-apps/api/core";
import type { ClipItem } from "../../App";
import type { AgentProviderConfig } from "./provider-config";
import { piComplete } from "./provider-config";

/** agent_resolve_pi_provider 的返回形状（Rust 侧 agent/pi.rs 解析，camelCase）。 */
type ResolvedRuntimePiProvider = {
  provider?: string;
  label?: string;
  modelId?: string;
  baseUrl?: string;
  apiKey?: string;
};

/** 运行时解析默认 pi provider：settings 读路径的 apiKey 恒为 "[redacted]" 占位（redaction），
 *  真实 key 只在调用时由 Rust 侧（agent_resolve_pi_provider）解析返回，前端设置态不出现明文。
 *  无可用 provider 时返回 null。 */
export async function resolveDefaultPiProvider(): Promise<AgentProviderConfig | null> {
  const resolved = await invoke<ResolvedRuntimePiProvider | null>("agent_resolve_pi_provider");
  if (!resolved || typeof resolved.provider !== "string" || !resolved.provider) return null;
  return {
    provider: resolved.provider,
    label: typeof resolved.label === "string" ? resolved.label : undefined,
    modelId: typeof resolved.modelId === "string" ? resolved.modelId : undefined,
    baseUrl: typeof resolved.baseUrl === "string" ? resolved.baseUrl : undefined,
    apiKey: typeof resolved.apiKey === "string" ? resolved.apiKey : undefined,
  };
}

export type ClipPiAnalysis = {
  summary: string;
  tags: string[];
};

function extractJson(text: string): ClipPiAnalysis | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      summary?: unknown;
      tags?: unknown;
    };
    if (typeof parsed.summary !== "string") return null;
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 6)
      : [];
    return { summary: parsed.summary.trim(), tags };
  } catch {
    return null;
  }
}

/** AI 分析一条剪贴板条目：返回摘要与标签建议。要求已配置 provider，否则抛错。 */
export async function analyzeClipWithPi(
  item: ClipItem,
  providerConfig: AgentProviderConfig,
): Promise<ClipPiAnalysis> {
  const message = await piComplete({
    system:
      "你是剪贴板条目分析助手。只输出一个 JSON 对象，形如 {\"summary\":\"一句话摘要（不超过 60 字）\",\"tags\":[\"建议标签\", ...]}，标签不超过 4 个，不要输出其他内容。",
    prompt: `条目类型：${item.payloadKind}\n标题：${item.analysis.title}\n内容：\n${item.content.slice(0, 4000)}`,
    providerConfig,
  });

  const textParts = message.content.flatMap((part) =>
    part.type === "text" ? [part.text] : [],
  );
  const parsed = extractJson(textParts.join("\n"));
  if (!parsed) throw new Error("AI 分析返回格式异常：缺少 JSON 输出");
  return parsed;
}
