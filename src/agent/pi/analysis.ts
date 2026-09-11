/** pi 底层的条目分析能力（替代原 DSH clipboard_analyze）：摘要 + 标签建议。
 *  边界：provider 配置从设置服务异步解析；无配置/调用失败抛错，由调用方降级展示。 */
import type { ClipItem } from "../../App";
import { settingsService } from "../../services/settings";
import type { AgentProviderConfig } from "./provider-config";
import { piComplete } from "./provider-config";

/** 从设置服务的 agentProviders 解析首个有效 provider 配置；无配置返回 null。 */
export async function resolveDefaultPiProvider(): Promise<AgentProviderConfig | null> {
  const document = await settingsService.get(false);
  const providers = (document.settings.agentProviders ?? []) as Array<Record<string, unknown>>;
  for (const raw of providers) {
    const provider = typeof raw.provider === "string" ? raw.provider : "";
    if (!provider) continue;
    return {
      provider,
      label: typeof raw.label === "string" ? raw.label : undefined,
      modelId: typeof raw.modelId === "string" ? raw.modelId : undefined,
      apiKey: typeof raw.apiKey === "string" ? raw.apiKey : undefined,
      baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : undefined,
    };
  }
  return null;
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
