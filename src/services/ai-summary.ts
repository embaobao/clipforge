import type { ClipItem } from "../App";
import type { ClipboardAgentProviderConfig } from "./contracts";
import { settingsService } from "./settings";

export type ClipAiJobStatus = "idle" | "pending" | "ready" | "failed";

export type ClipAiSummary = {
  status: ClipAiJobStatus;
  oneLine?: string;
  keyPoints?: string[];
  tags?: string[];
  category?: string;
  providerId?: string;
  providerKind?: string;
  modelId?: string;
  generatedAt?: number;
  createdAt?: number;
  durationMs?: number;
  jobId?: string;
  errorCode?: string;
  blockedReason?: string;
  message?: string;
};

export type AiProviderSummary = {
  status: "not-configured" | "ready" | "unsupported" | "sdk-unavailable" | "failed";
  providerId?: string;
  providerKind?: string;
  modelId?: string;
  message?: string;
};

export type AiSummaryCallBoundary = {
  boundary: "openai-compatible";
  jobId: string;
  providerId: string;
  providerKind: string;
  modelId?: string;
  status: "blocked";
  errorCode: "AI_SDK_NOT_ENABLED";
  blockedReason: "AI_SDK_NOT_ENABLED";
  createdAt: number;
  durationMs: number;
};

export type ClipAiRecommendation = {
  clip: ClipItem;
  score: number;
  reasons: string[];
};

export type ClipAiSummaryLogMetadata = {
  clipId: string;
  jobId: string;
  status: ClipAiJobStatus | "failed-state-write-failed";
  providerId: string | null;
  providerKind: string | null;
  modelId: string | null;
  errorCode: string | null;
  blockedReason: string | null;
  generatedAt: number | null;
  durationMs: number | null;
  errorName?: string;
};

function makeAiJobId(clipId: string) {
  return `clip_ai_${clipId}_${Date.now().toString(36)}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readModelId(redactedConfig: Record<string, unknown>): string | undefined {
  return (
    readString(redactedConfig.modelId) ??
    readString(redactedConfig.model) ??
    readString(redactedConfig.defaultModel)
  );
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function readErrorName(error: unknown) {
  return error instanceof Error && error.name ? error.name : "Error";
}

/** 生成摘要日志元数据；不包含 prompt、原文、摘要输出或异常 message。 */
export function getClipAiSummaryLogMetadata(
  clipId: string,
  summary: ClipAiSummary,
  fallbackJobId: string,
): ClipAiSummaryLogMetadata {
  return {
    clipId,
    jobId: summary.jobId ?? fallbackJobId,
    status: summary.status,
    providerId: summary.providerId ?? null,
    providerKind: summary.providerKind ?? null,
    modelId: summary.modelId ?? null,
    errorCode: summary.errorCode ?? null,
    blockedReason: summary.blockedReason ?? null,
    generatedAt: summary.generatedAt ?? null,
    durationMs: summary.durationMs ?? null,
  };
}

/** 生成摘要失败日志元数据；只保留错误类型和内部错误码。 */
export function getClipAiSummaryErrorLogMetadata(
  clipId: string,
  jobId: string,
  errorCode: string,
  error: unknown,
  status: ClipAiSummaryLogMetadata["status"] = "failed",
): ClipAiSummaryLogMetadata {
  return {
    clipId,
    jobId,
    status,
    providerId: null,
    providerKind: null,
    modelId: null,
    errorCode,
    blockedReason: null,
    generatedAt: Date.now(),
    durationMs: null,
    errorName: readErrorName(error),
  };
}

function isOpenAiCompatibleProvider(provider: ClipboardAgentProviderConfig) {
  return (
    provider.kind === "openai-compatible" ||
    (provider.kind === "remote-http" && provider.redactedConfig.protocol === "openai-compatible")
  );
}

function readEnvFlag(name: string) {
  const runtime = globalThis as typeof globalThis & {
    __CLIPFORGE_AI_TEST_FLAGS__?: Record<string, boolean | undefined>;
  };
  const runtimeValue = runtime.__CLIPFORGE_AI_TEST_FLAGS__?.[name];
  if (typeof runtimeValue === "boolean") return runtimeValue;
  const value =
    name === "VITE_CLIPFORGE_AI_MOCK"
      ? import.meta.env?.VITE_CLIPFORGE_AI_MOCK
      : name === "VITE_CLIPFORGE_AI_MOCK_FAILURE"
        ? import.meta.env?.VITE_CLIPFORGE_AI_MOCK_FAILURE
        : undefined;
  return value === true || value === "1" || value === "true";
}

/**
 * 准备 OpenAI-compatible 调用边界。真实 AI SDK 尚未启用时，只返回
 * metadata-only 状态；不接收 prompt、clip 正文、输出正文或明文 apiKey，也不发起网络请求。
 */
export function prepareOpenAiCompatibleSummaryBoundary(
  provider: ClipboardAgentProviderConfig,
  jobId: string,
): AiSummaryCallBoundary {
  const startedAt = nowMs();
  return {
    boundary: "openai-compatible",
    jobId,
    providerId: provider.id,
    providerKind: provider.kind,
    modelId: readModelId(provider.redactedConfig),
    status: "blocked",
    errorCode: "AI_SDK_NOT_ENABLED",
    blockedReason: "AI_SDK_NOT_ENABLED",
    createdAt: Date.now(),
    durationMs: Math.max(0, Math.round(nowMs() - startedAt)),
  };
}

function compactText(value: string, limit = 120) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function tokenize(value: string) {
  return new Set(
    value
      .toLowerCase()
      .match(/[\p{L}\p{N}]{2,}/gu)
      ?.slice(0, 80) ?? [],
  );
}

function getSummarySignals(clip: ClipItem) {
  const stored = getStoredClipAiSummary(clip);
  return [
    clip.analysis.title,
    clip.analysis.summary,
    clip.searchText ?? "",
    clip.plainText,
    clip.content,
    ...(stored?.keyPoints ?? []),
    ...(stored?.tags ?? []),
    stored?.category ?? "",
    ...clip.tags,
  ].join(" ");
}

function makeMockSummary(clip: ClipItem, jobId: string): ClipAiSummary {
  const text = clip.plainText || clip.content;
  const firstLine = text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  const keyPoints = text
    .split(/[\r\n。.!?]+/)
    .map((item) => compactText(item, 90))
    .filter(Boolean)
    .slice(0, 3);
  const tags = Array.from(new Set([...clip.tags, clip.analysis.sourceName, clip.payloadKind].filter(Boolean))).slice(0, 8);
  return {
    status: "ready",
    oneLine: compactText(clip.analysis.summary || firstLine || text, 140),
    keyPoints: keyPoints.length ? keyPoints : [compactText(text, 90)],
    tags,
    category: clip.kind,
    providerId: "mock-provider",
    modelId: "clipforge-local-mock",
    generatedAt: Date.now(),
    jobId,
  };
}

/** 读取 provider 摘要，不返回 apiKey、prompt 或 clip 正文。 */
export async function getAiProviderSummary(): Promise<AiProviderSummary> {
  if (readEnvFlag("VITE_CLIPFORGE_AI_MOCK")) {
    return {
      status: "ready",
      providerId: "mock-provider",
      providerKind: "mock",
      modelId: "clipforge-local-mock",
      message: "AI_MOCK_PROVIDER_ENABLED",
    };
  }
  try {
    const result = await settingsService.agent.providers();
    const active =
      result.providers.find((provider) => provider.id === result.activeProviderId) ??
      result.providers.find((provider) => provider.configured);
    if (!active || !active.configured) {
      return { status: "not-configured", message: "AI_PROVIDER_NOT_CONFIGURED" };
    }
    const modelId = readModelId(active.redactedConfig);
    if (!isOpenAiCompatibleProvider(active)) {
      return {
        status: "unsupported",
        providerId: active.id,
        providerKind: active.kind,
        modelId,
        message: "AI_PROVIDER_KIND_UNSUPPORTED",
      };
    }
    return {
      status: "sdk-unavailable",
      providerId: active.id,
      providerKind: active.kind,
      modelId,
      message: "AI_SDK_NOT_ENABLED",
    };
  } catch (error) {
    return { status: "failed", message: String(error) };
  }
}

export function getStoredClipAiSummary(clip: ClipItem): ClipAiSummary | null {
  const summary = clip.metadata.aiSummary;
  if (!summary || typeof summary !== "object") return null;
  const value = summary as Partial<ClipAiSummary>;
  if (value.status !== "ready" && value.status !== "failed" && value.status !== "pending") return null;
  return {
    status: value.status,
    oneLine: readString(value.oneLine),
    keyPoints: Array.isArray(value.keyPoints)
      ? value.keyPoints.filter((item): item is string => typeof item === "string")
      : undefined,
    tags: Array.isArray(value.tags)
      ? value.tags.filter((item): item is string => typeof item === "string")
      : undefined,
    category: readString(value.category),
    providerId: readString(value.providerId),
    providerKind: readString(value.providerKind),
    modelId: readString(value.modelId),
    generatedAt: typeof value.generatedAt === "number" ? value.generatedAt : undefined,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : undefined,
    durationMs: typeof value.durationMs === "number" ? value.durationMs : undefined,
    jobId: readString(value.jobId),
    errorCode: readString(value.errorCode),
    blockedReason: readString(value.blockedReason),
    message: readString(value.message),
  };
}

/** 第一阶段只建立异步摘要边界；真实 SDK 调用需等 Context7 恢复后确认依赖与 API。 */
export async function generateClipAiSummary(clip: ClipItem, jobId = makeAiJobId(clip.id)): Promise<ClipAiSummary> {
  const provider = await getAiProviderSummary();
  const generatedAt = Date.now();
  if (provider.providerKind === "mock") {
    if (readEnvFlag("VITE_CLIPFORGE_AI_MOCK_FAILURE")) {
      return {
        status: "failed",
        jobId,
        generatedAt,
        providerId: provider.providerId,
        modelId: provider.modelId,
        errorCode: "AI_MOCK_FAILED",
        message: "AI_MOCK_PROVIDER_FAILURE",
      };
    }
    return makeMockSummary(clip, jobId);
  }
  if (provider.status === "not-configured") {
    return {
      status: "failed",
      jobId,
      generatedAt,
      errorCode: "AI_PROVIDER_NOT_CONFIGURED",
      message: provider.message,
    };
  }
  if (provider.status === "unsupported") {
    return {
      status: "failed",
      jobId,
      generatedAt,
      providerId: provider.providerId,
      providerKind: provider.providerKind,
      modelId: provider.modelId,
      errorCode: "AI_PROVIDER_KIND_UNSUPPORTED",
      message: provider.message,
    };
  }
  if (provider.status === "failed") {
    return {
      status: "failed",
      jobId,
      generatedAt,
      errorCode: "AI_PROVIDER_READ_FAILED",
      message: provider.message,
    };
  }
  try {
    const result = await settingsService.agent.providers();
    const active =
      result.providers.find((item) => item.id === result.activeProviderId) ??
      result.providers.find((item) => item.configured);
    if (active && active.configured && isOpenAiCompatibleProvider(active)) {
      const boundary = prepareOpenAiCompatibleSummaryBoundary(active, jobId);
      return {
        status: "failed",
        jobId: boundary.jobId,
        generatedAt,
        createdAt: boundary.createdAt,
        durationMs: boundary.durationMs,
        providerId: boundary.providerId,
        providerKind: boundary.providerKind,
        modelId: boundary.modelId,
        errorCode: boundary.errorCode,
        blockedReason: boundary.blockedReason,
        message: boundary.blockedReason,
      };
    }
  } catch {
    // 保持 SDK 缺失路径为 metadata-only fallback；不把 provider profile 读取错误扩散成正文日志。
  }
  return {
    status: "failed",
    jobId,
    generatedAt,
    providerId: provider.providerId,
    providerKind: provider.providerKind,
    modelId: provider.modelId,
    errorCode: "AI_SDK_NOT_ENABLED",
    blockedReason: "AI_SDK_NOT_ENABLED",
    message: provider.message,
  };
}

export function findSimilarClipRecommendations(
  current: ClipItem,
  candidates: ClipItem[],
  limit = 4,
): ClipAiRecommendation[] {
  const currentTokens = tokenize(getSummarySignals(current));
  return candidates
    .filter((candidate) => candidate.id !== current.id && !candidate.deletedAt)
    .map((candidate) => {
      let score = 0;
      const reasons: string[] = [];
      const tagMatches = candidate.tags.filter((tag) =>
        current.tags.some((currentTag) => currentTag.toLowerCase() === tag.toLowerCase()),
      );
      if (tagMatches.length) {
        score += tagMatches.length * 4;
        reasons.push("tag");
      }
      if (current.analysis.host && current.analysis.host === candidate.analysis.host) {
        score += 4;
        reasons.push("host");
      }
      if (current.payloadKind === candidate.payloadKind) {
        score += 2;
        reasons.push("format");
      }
      if (current.analysis.source === candidate.analysis.source) {
        score += 2;
        reasons.push("source");
      }
      const candidateTokens = tokenize(getSummarySignals(candidate));
      let overlap = 0;
      for (const token of candidateTokens) {
        if (currentTokens.has(token)) overlap += 1;
        if (overlap >= 6) break;
      }
      if (overlap) {
        score += overlap;
        reasons.push("keywords");
      }
      if (candidate.favorite) {
        score += 1;
        reasons.push("favorite");
      }
      return { clip: candidate, score, reasons: Array.from(new Set(reasons)) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.clip.updatedAt - a.clip.updatedAt)
    .slice(0, limit);
}
