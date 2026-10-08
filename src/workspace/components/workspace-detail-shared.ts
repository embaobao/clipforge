import {
  BarChart3,
  Copy,
  ExternalLink,
  FileJson,
  FileText,
  Image,
  Table2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import type { ClipItem, ClipPayloadKind } from "../../App";
import type { TranslationKey } from "../../i18n";
import { getImagePath } from "../../services/clipboard";

/** Workspace 各组件共享的翻译函数签名：key 必须来自 TranslationKey 联合类型。 */
export type WorkspaceTr = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** 详情页快捷动作条目（由插件/宿主注入，展示在溢出菜单里）。 */
export type DetailQuickAction = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
};

/** 详情页 agent provider 列表（脱敏）：apiKey 一律剥离换 hasApiKey 布尔，
 *  防止设置态（legacy 读路径可能带明文）把 key 传进详情组件树；
 *  AI 调用的真实 key 走 agent_resolve_pi_provider 运行时解析，与此展示态无关。 */
export function toDetailAgentProviders(
  providers: Array<Record<string, unknown>> | undefined,
): Array<Record<string, unknown>> {
  return (providers ?? []).map((entry) => {
    const apiKey = typeof entry.apiKey === "string" ? entry.apiKey : "";
    const { apiKey: _stripped, ...rest } = entry;
    return { ...rest, hasApiKey: apiKey.trim() !== "" };
  });
}

/** 编辑器变量抽屉的单行变量描述（key/类型/示例值）。 */
export type EditorVariableRow = {
  key: string;
  type: string;
  example: string;
};

/** payload 类型 → 展示文案；未知类型兜底为纯文本。 */
export function getPayloadKindLabel(kind: ClipPayloadKind, tr: WorkspaceTr): string {
  switch (kind) {
    case "link":
      return tr("main.payloadKind.link");
    case "markdown":
      return "Markdown";
    case "code":
      return tr("main.payloadKind.code");
    case "command":
      return tr("main.payloadKind.command");
    case "html":
      return "HTML";
    case "rtf":
      return "RTF";
    case "file":
      return tr("main.payloadKind.file");
    case "image":
      return tr("main.payloadKind.image");
    case "json":
      return "JSON";
    case "chart":
      return tr("main.payloadKind.chart");
    case "table":
      return tr("main.payloadKind.table");
    default:
      return tr("main.payloadKind.text");
  }
}

/** payload 类型 → 图标组件；与 getPayloadKindLabel 一一对应。 */
export function getPayloadKindIcon(kind: ClipPayloadKind) {
  switch (kind) {
    case "link":
      return ExternalLink;
    case "markdown":
      return FileText;
    case "code":
      return Copy;
    case "command":
      return Copy;
    case "html":
      return FileText;
    case "rtf":
      return FileText;
    case "file":
      return FileText;
    case "image":
      return Image;
    case "json":
      return FileJson;
    case "chart":
      return BarChart3;
    case "table":
      return Table2;
    default:
      return FileText;
  }
}

/** 规整单个 tag：去掉 # / tag: 前缀，截断到 32 字符，空值返回 null。 */
export function normalizeDetailTag(value: string): string | null {
  const tag = value.trim().replace(/^#/, "").replace(/^tag:/i, "").trim();
  if (!tag) return null;
  return tag.slice(0, 32);
}

/** 批量规整 tags：去空、去重（大小写不敏感）、上限 12 个。 */
export function normalizeDetailTags(values: string[]) {
  const seen = new Set<string>();
  const tags: string[] = [];
  values.forEach((value) => {
    const tag = normalizeDetailTag(value);
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(tag);
  });
  return tags.slice(0, 12);
}

/** 压缩内联空白并截断到指定长度（末尾加省略号），用于变量示例等紧凑展示。 */
export function compactInlineText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

/** 从内容中提取 #hash tag（含中文/数字/下划线/连字符），交给 normalizeDetailTags 去重。 */
export function extractDetailHashTags(content: string) {
  return normalizeDetailTags(
    Array.from(content.matchAll(/(^|[\s([{])#([\p{L}\p{N}_-]{1,32})/gu)).map((match) => match[2]),
  );
}

/** 图片类 clip 的本地预览地址：优先 imageFile，其次 thumbnailPath（经 Tauri asset 协议转换）。 */
export function clipImageSrc(clip: ClipItem) {
  const path = clip.imageFile || clip.thumbnailPath;
  return getImagePath(path);
}

/** 文件列表 clip 的路径行集合：按行拆分并去空。 */
export function fileRowsFromClip(clip: ClipItem) {
  return clip.content
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
}

/** 推断详情页渲染模式：image/markdown/code/json/table/link/text。 */
export function getDetailModeId(clip: ClipItem) {
  if (clip.analysis.attachment?.isImage) return "image";
  if (clip.kind === "markdown") return "markdown";
  if (clip.kind === "code") return "code";
  if (/^\s*[\[{]/.test(clip.content)) return "json";
  if (/\t/.test(clip.content) || /^\|.+\|$/m.test(clip.content)) return "table";
  if (clip.kind === "link") return "link";
  return "text";
}

/** 渲染模式的展示名；text/table/link 等走 i18n。 */
export function getDetailModeLabel(clip: ClipItem, tr: WorkspaceTr) {
  const mode = getDetailModeId(clip);
  if (mode === "markdown") return "Markdown";
  if (mode === "json") return "JSON";
  return tr(`main.detail.mode.${mode}` as TranslationKey);
}

/** 是否按 Markdown 渲染：显式 kind、分析标记或模式推断任一命中即可。 */
export function isLikelyMarkdown(clip: ClipItem) {
  return clip.kind === "markdown" || clip.analysis.isMarkdown || getDetailModeId(clip) === "markdown";
}

/** 是否按 JSON 渲染：payloadKind 或模式推断命中。 */
export function isLikelyJson(clip: ClipItem) {
  return clip.payloadKind === "json" || getDetailModeId(clip) === "json";
}

/** 尝试格式化 JSON；失败时返回原始内容与错误信息，不抛异常。 */
export function formatJsonPreview(content: string) {
  try {
    const value = JSON.parse(content);
    const formatted = JSON.stringify(value, null, 2);
    const root =
      Array.isArray(value)
        ? `Array(${value.length})`
        : value && typeof value === "object"
          ? `Object(${Object.keys(value as Record<string, unknown>).length})`
          : typeof value;
    return { formatted, root, error: "" };
  } catch (error) {
    return {
      formatted: content,
      root: "Invalid JSON",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Workspace 专用日志：写 Tauri append_app_log，失败静默（日志不能影响剪贴板渲染）。 */
export function appendWorkspacePanelLog(level: "info" | "warn" | "error", message: string, context: Record<string, unknown>) {
  let contextText = "";
  try {
    contextText = JSON.stringify(context);
  } catch {
    contextText = String(context);
  }
  void invoke("append_app_log", { level, message, context: contextText }).catch(() => {
    // Logging must not break clipboard rendering.
  });
}

/** 详情页实际使用的渲染器名，用于渲染诊断上下文。 */
export function getDetailRendererName(clip: ClipItem) {
  if (clip.analysis.attachment?.isImage && clip.analysis.attachment.targetType === "url") return "image-preview";
  if (clip.analysis.url || clip.kind === "link") return "link-preview";
  if (isLikelyMarkdown(clip)) return "markdown-preview";
  return "plain-text";
}

/** 详情渲染诊断的统一上下文（traceId/schema/业务链路），供 append_app_log 排查渲染问题。 */
export function getClipRenderDiagnostics(clip: ClipItem, extra: Record<string, unknown> = {}) {
  return {
    traceId: `detail_render_${clip.id}_${Date.now().toString(36)}`,
    contextSchema: "ClipDetailRenderDiagnostics.v1",
    businessChain: "quick-panel -> workspace-router -> detail-route -> ClipDetailWorkspace -> content-renderer",
    routePath: "/clip/$clipId",
    component: "ClipDetailWorkspace",
    renderer: getDetailRendererName(clip),
    clipId: clip.id,
    clipKind: clip.kind,
    payloadKind: clip.payloadKind,
    detailMode: getDetailModeId(clip),
    chars: clip.content.length,
    lines: clip.content.split(/\r?\n/).length,
    sourceAppName: clip.sourceApp?.name ?? "",
    sourceAppBundle: clip.sourceApp?.bundleId ?? "",
    hasAnalysisUrl: Boolean(clip.analysis.url),
    hasAttachment: Boolean(clip.analysis.attachment),
    isMarkdown: clip.analysis.isMarkdown,
    ...extra,
  };
}

/** 模块级去重表：同一条「链接被丢弃」告警在组件重渲染时只记一次日志。 */
export const droppedLinkLogKeys = new Set<string>();

/** 仅接受 http(s) URL，其余返回 null；不合法输入不抛异常。 */
export function parseHttpUrl(value: string | null | undefined) {
  if (!value || !/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** 批量提取去重后的 http(s) 链接（保留 hostname 作为展示 label）。 */
export function safeHttpUrls(values: string[]) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const url = parseHttpUrl(value);
    if (!url || seen.has(url.href)) return [];
    seen.add(url.href);
    return [{ href: url.href, label: url.hostname.replace(/^www\./, "") }];
  });
}

/** 从采集上下文提炼一行人类可读摘要：窗口标题 / 浏览器标题与 URL / 文档路径 / 选区数量。 */
export function getApplicationContextSummary(clip: ClipItem) {
  const context = clip.captureContext?.applicationContext;
  if (!context || typeof context !== "object") return null;
  const values: string[] = [];
  const window = context.window;
  if (window && typeof window === "object") {
    const title = (window as Record<string, unknown>).title;
    if (typeof title === "string" && title.trim()) values.push(title.trim());
  }
  const browser = context.browser;
  if (browser && typeof browser === "object") {
    const browserRecord = browser as Record<string, unknown>;
    const title = browserRecord.title;
    const url = browserRecord.url;
    if (typeof title === "string" && title.trim() && !values.includes(title.trim())) values.push(title.trim());
    if (typeof url === "string" && url.trim()) values.push(url.trim());
  }
  for (const key of ["workspace", "document"] as const) {
    const entry = context[key];
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const value = record.path || record.name;
    if (typeof value === "string" && value.trim() && !values.includes(value.trim())) values.push(value.trim());
  }
  const selection = context.selection;
  if (selection && typeof selection === "object") {
    const count = (selection as Record<string, unknown>).count;
    if (typeof count === "number" && count > 0) values.push(`selection ${count}`);
  }
  return values.length ? values.join(" · ") : null;
}

/** 图片「在系统中打开」的目标路径：优先 imageFile，其次 path 类型附件。 */
export function getImageOpenPath(clip: ClipItem) {
  return clip.imageFile || (clip.analysis.attachment?.targetType === "path" ? clip.analysis.attachment.target : "");
}

/** 详情页来源地址：分析 URL > 附件 target > 图片文件 > 浏览器 URL。 */
export function getDetailSourceAddress(clip: ClipItem) {
  const context = clip.captureContext?.applicationContext;
  const browser = context && typeof context === "object" ? context.browser : null;
  const browserUrl = browser && typeof browser === "object" ? (browser as Record<string, unknown>).url : null;
  return clip.analysis.url
    || clip.analysis.attachment?.target
    || clip.imageFile
    || (typeof browserUrl === "string" ? browserUrl : "");
}
