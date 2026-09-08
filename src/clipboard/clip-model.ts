/** Clip 数据模型与内容分析域：类型定义、payload/format 映射与纯函数分析器（从 App.tsx 切出）。
 *  边界：不依赖 React 与 AppSettings；settings 相关的 generateTags/getTypeTags 留在 App.tsx。 */
import type { AppSettings } from "../App";
import { middleEllipsis } from "./clipboard-domain";
import { normalizeTagName } from "../search-query";

export type ClipKind = "text" | "code" | "link" | "markdown" | "command" | "attachment" | "json" | "chart" | "table";
export type ClipPayloadKind = "text" | "link" | "markdown" | "code" | "command" | "html" | "rtf" | "file" | "image" | "json" | "chart" | "table";
export type ClipTypeFilter = "all" | ClipPayloadKind;
export type ClipBucket = "history" | "archive" | "snippet";
export type PasteMode = "rich" | "plain" | "filesAsPaths";

export type SourceAppInfo = {
  name: string;
  bundleId: string;
  executablePath: string;
  iconBase64?: string;
};

export type ClipboardRepresentation = {
  format: "text/plain" | "text/html" | "text/rtf" | "image/png" | "application/file-list" | "text/uri-list" | string;
  storage: "inline" | "file" | "derived" | string;
  content?: string | null;
  fileName?: string | null;
  size?: number | null;
  hash?: string | null;
  preferred?: boolean;
};

export type ClipCaptureContext = {
  schemaVersion: number;
  surface: string;
  sourceLabel: string;
  sourceApp?: Record<string, unknown> | null;
  applicationContext?: Record<string, unknown> | null;
  observedAt: number;
  primaryFormat: string;
  availableFormats: string[];
  environment: Record<string, unknown>;
};

export type ContentSource =
  | "github"
  | "gitlab"
  | "command"
  | "markdown"
  | "code"
  | "json"
  | "table"
  | "image"
  | "file"
  | "link"
  | "text";

export type AttachmentInfo = {
  name: string;
  description: string;
  target: string;
  targetType: "url" | "path";
  isImage: boolean;
};

export type ClipAnalysis = {
  source: ContentSource;
  sourceName: string;
  badge: string;
  title: string;
  summary: string;
  url?: string;
  host?: string;
  isMarkdown: boolean;
  attachment?: AttachmentInfo;
};

export type ClipItem = {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  lastCopiedAt?: number;
  source: string;
  kind: ClipKind;
  bucket: ClipBucket;
  favorite: boolean;
  tags: string[];
  copyCount: number;
  analysis: ClipAnalysis;
  payloadKind: ClipPayloadKind;
  contentHash: string;
  primaryFormat: string;
  availableFormats: string[];
  representations: ClipboardRepresentation[];
  plainText: string;
  searchText?: string | null;
  subKind?: string | null;
  width?: number | null;
  height?: number | null;
  size?: number | null;
  fileTypes?: string | null;
  thumbnailPath?: string | null;
  imageFile?: string | null;
  isSensitive?: boolean;
  captureContext: ClipCaptureContext;
  metadata: Record<string, unknown>;
  agentContext: Record<string, unknown>;
  sourceApp?: SourceAppInfo;
  deletedAt?: number | null;
};

/** 生成条目 id：时间戳 36 进制 + 随机段，前端本地去重用。 */
export function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 规整 tag 列表：去空、大小写去重、上限 12 个。 */
export function normalizeTagList(values: string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  values.forEach((value) => {
    const tag = normalizeTagName(value);
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(tag);
  });
  return tags.slice(0, 12);
}

/** 提取内容中的 #hash tag（含中文/数字/下划线/连字符）。 */
export function extractHashTags(content: string): string[] {
  return normalizeTagList(
    Array.from(content.matchAll(/(^|[\s([{])#([\p{L}\p{N}_-]{1,32})/gu)).map((match) => match[2]),
  );
}

function extractFirstUrl(content: string) {
  const match = content.match(/https?:\/\/[^\s<>"')\]]+/i);
  return match?.[0];
}

/** 提取内容中的全部去重 URL（供搜索域等复用）。 */
export function extractUrls(content: string) {
  return Array.from(new Set(content.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []));
}

const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);
const resourceExtensions = new Set([
  ...imageExtensions,
  "pdf",
  "zip",
  "txt",
  "md",
  "json",
  "json5",
  "csv",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
]);

function getExtension(value: string) {
  const clean = value.split(/[?#]/)[0] ?? value;
  const name = clean.split(/[\\/]/).pop() ?? clean;
  const match = name.match(/\.([a-z0-9]{2,8})$/i);
  return match?.[1]?.toLowerCase() ?? "";
}

function getResourceName(value: string) {
  try {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || url.hostname);
    }
  } catch {
    return value;
  }
  return value.replace(/^file:\/\//, "").split(/[\\/]/).filter(Boolean).pop() || value;
}

/** 识别附件型内容（按扩展名判断图片/资源），返回附件描述或 null。 */
export function detectAttachment(content: string): AttachmentInfo | null {
  const trimmed = content.trim();
  const singleLine = trimmed.split(/\s+/)[0] ?? trimmed;
  const url = extractFirstUrl(trimmed);
  const target = url ?? singleLine;
  const ext = getExtension(target);
  if (!resourceExtensions.has(ext)) return null;
  const isImage = imageExtensions.has(ext);
  const targetType = /^https?:\/\//i.test(target) ? "url" : "path";
  const name = getResourceName(target);
  return {
    name,
    description: `${ext.toUpperCase()} · ${targetType === "url" ? "链接资源" : "本地资源"}`,
    target,
    targetType,
    isImage,
  };
}

function isCommandLike(content: string) {
  const trimmed = content.trim();
  if (!trimmed || /[\u4e00-\u9fa5]/.test(trimmed)) return false;
  if (/^\$\s+\S+/.test(trimmed)) return true;
  if (trimmed.includes("\n")) return false;
  const [command = "", firstArg = ""] = trimmed.split(/\s+/);
  const commandSet = new Set([
    "pnpm",
    "npm",
    "npx",
    "yarn",
    "bun",
    "cargo",
    "git",
    "gh",
    "brew",
    "tauri",
    "node",
    "python",
    "python3",
    "pip",
    "pip3",
    "curl",
    "ssh",
  ]);
  if (!commandSet.has(command)) return false;
  if (!firstArg) return false;
  return /^[-./:@\w=]+$/.test(firstArg);
}

function isCodeLike(content: string) {
  const trimmed = content.trim();
  return (
    /(^|\n)\s*(const|let|var|fn|func|class|import|export|def|type|interface|pub)\s/.test(
      trimmed,
    ) ||
    trimmed.includes("=>") ||
    trimmed.includes("```")
  );
}

function isMarkdownLike(content: string) {
  const trimmed = content.trim();
  return (
    /^#{1,6}\s+\S/m.test(trimmed) ||
    /^[-*]\s+\S/m.test(trimmed) ||
    /^\d+\.\s+\S/m.test(trimmed) ||
    /\[[^\]]+\]\([^)]+\)/.test(trimmed) ||
    /^>\s+\S/m.test(trimmed) ||
    /^\|.+\|$/m.test(trimmed)
  );
}

function isJsonLike(content: string) {
  const trimmed = content.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

function parseUrlSummary(urlValue: string) {
  try {
    const url = new URL(urlValue);
    const host = url.hostname.replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    if (host === "github.com" && parts.length >= 2) {
      return {
        source: "github" as ContentSource,
        sourceName: "GitHub",
        badge: "GH",
        title: `${parts[0]}/${parts[1]}`,
        summary: parts.slice(2).join("/") || host,
        host,
      };
    }
    if (host === "gitlab.com" && parts.length >= 2) {
      return {
        source: "gitlab" as ContentSource,
        sourceName: "GitLab",
        badge: "GL",
        title: `${parts[0]}/${parts[1]}`,
        summary: parts.slice(2).join("/") || host,
        host,
      };
    }
    return {
      source: "link" as ContentSource,
      sourceName: host,
      badge: "URL",
      title: host,
      summary: url.pathname === "/" ? url.origin : `${url.pathname}${url.search}`,
      host,
    };
  } catch {
    return null;
  }
}

/** 内容分析器：判定 payload 来源（附件/链接/命令/JSON/Markdown/代码/文本）并生成展示元信息。 */
export function analyzeContent(content: string): ClipAnalysis {
  const normalized = content.replace(/\s+/g, " ").trim();
  const firstLine = content.trim().split(/\r?\n/)[0]?.trim() || "";
  const attachment = detectAttachment(content);
  if (attachment) {
    return {
      source: attachment.isImage ? "image" : "file",
      sourceName: attachment.isImage ? "Image" : "File",
      badge: attachment.isImage ? "IMG" : "FILE",
      title: attachment.name,
      summary: attachment.description,
      url: attachment.targetType === "url" ? attachment.target : undefined,
      isMarkdown: false,
      attachment,
    };
  }
  const url = extractFirstUrl(content);
  if (url) {
    const summary = parseUrlSummary(url);
    if (summary) {
      return {
        ...summary,
        url,
        isMarkdown: isMarkdownLike(content),
      };
    }
  }
  if (isCommandLike(content)) {
    return {
      source: "command",
      sourceName: "Command",
      badge: "$",
      title: content.trim().split(/\s+/).slice(0, 3).join(" "),
      summary: middleEllipsis(content, 44, 10),
      isMarkdown: false,
    };
  }
  if (isJsonLike(content)) {
    const isArray = content.trimStart().startsWith("[");
    return {
      source: "json",
      sourceName: "JSON",
      badge: "JSON",
      title: isArray ? "JSON Array" : "JSON Object",
      summary: middleEllipsis(normalized, 56, 12),
      isMarkdown: false,
    };
  }
  if (isMarkdownLike(content)) {
    const titleMatch = content.match(/^#{1,6}\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim().slice(0, 60) : firstLine.slice(0, 60) || "Markdown";
    return {
      source: "markdown",
      sourceName: "Markdown",
      badge: "MD",
      title,
      summary: middleEllipsis(normalized, 56, 12),
      isMarkdown: true,
    };
  }
  if (isCodeLike(content)) {
    const funcMatch = firstLine.match(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|var)\s+(\w+)/);
    const classNameMatch = firstLine.match(/^(?:export\s+)?class\s+(\w+)/);
    const title = funcMatch
      ? `${funcMatch[1]}()`
      : classNameMatch
        ? `${classNameMatch[1]}`
        : firstLine.slice(0, 50) || "Code";
    return {
      source: "code",
      sourceName: "Code",
      badge: "{}",
      title,
      summary: middleEllipsis(normalized, 56, 12),
      isMarkdown: false,
    };
  }
  const textTitle = firstLine.length > 0 ? firstLine.slice(0, 60) : "空内容";
  return {
    source: "text",
    sourceName: "Text",
    badge: "T",
    title: textTitle,
    summary: content.length > firstLine.length ? middleEllipsis(content, 56, 12) : "",
    isMarkdown: false,
  };
}

/** 由分析结果推断 ClipKind（attachment/link/command/json/markdown/code/text）。 */
export function detectKind(content: string): ClipKind {
  const analysis = analyzeContent(content);
  if (analysis.attachment) return "attachment";
  if (analysis.source === "github" || analysis.source === "gitlab" || analysis.source === "link") {
    return "link";
  }
  if (analysis.source === "command") return "command";
  if (analysis.source === "json") return "json";
  if (analysis.source === "markdown") return "markdown";
  if (analysis.source === "code") return "code";
  return "text";
}

/** 剪贴板格式 → payloadKind 映射；未识别时回落到调用方给的 fallback。 */
export function getPayloadKindFromFormat(primaryFormat: string, fallback: ClipPayloadKind): ClipPayloadKind {
  if (primaryFormat === "image/png") return "image";
  if (primaryFormat === "application/file-list") return "file";
  if (primaryFormat === "text/html") return "html";
  if (primaryFormat === "text/rtf") return "rtf";
  if (primaryFormat === "text/uri-list") return "link";
  return fallback;
}

/** payloadKind → 首选剪贴板格式。 */
export function getPrimaryFormatForPayload(payloadKind: ClipPayloadKind) {
  if (payloadKind === "image") return "image/png";
  if (payloadKind === "file") return "application/file-list";
  if (payloadKind === "html") return "text/html";
  if (payloadKind === "rtf") return "text/rtf";
  return "text/plain";
}

/** 构造文本/HTML 条目的 representation 列表（HTML 附带派生纯文本）。 */
export function createTextRepresentation(content: string, payloadKind: ClipPayloadKind): ClipboardRepresentation[] {
  return [
    {
      format: getPrimaryFormatForPayload(payloadKind),
      storage: "inline",
      content,
      size: new Blob([content]).size,
      preferred: true,
    },
    ...(payloadKind === "html"
      ? [{ format: "text/plain", storage: "derived", content: content.replace(/<[^>]+>/g, " "), preferred: false }]
      : []),
  ];
}

export function generateTags(content: string, settings: AppSettings): string[] {  if (settings.tagMode === "off") return [];  const analysis = analyzeContent(content);  return getTypeTags(analysis);}function getTypeTags(analysis: ClipAnalysis): string[] {  if (analysis.attachment) return [analysis.attachment.isImage ? "图片" : "资源"];  if (analysis.source === "github" || analysis.source === "gitlab" || analysis.source === "link") return ["链接"];  if (analysis.source === "command") return ["命令"];  if (analysis.source === "json") return ["JSON"];  if (analysis.source === "markdown") return ["Markdown"];  if (analysis.source === "code") return ["代码"];  return ["文本"];}

export function createClip(content: string, settings: AppSettings): ClipItem {  const now = Date.now();  const analysis = analyzeContent(content);  const kind = detectKind(content);  const payloadKind = kind === "attachment" ? (analysis.attachment?.isImage ? "image" : "file") : (kind as ClipPayloadKind);  const primaryFormat = getPrimaryFormatForPayload(payloadKind);  return {    id: makeId(),    content,    createdAt: now,    updatedAt: now,    lastSeenAt: now,    source: analysis.sourceName,    kind,    bucket: "history",    favorite: false,    tags: generateTags(content, settings),    copyCount: 0,    analysis,    payloadKind,    contentHash: `${payloadKind}:${now}`,    primaryFormat,    availableFormats: [primaryFormat],    representations: createTextRepresentation(content, payloadKind),    plainText: content,    searchText: content,    subKind: payloadKind === "html" ? "html" : null,    size: new Blob([content]).size,    fileTypes: null,    thumbnailPath: null,    imageFile: null,    isSensitive: false,    captureContext: {      schemaVersion: 1,      surface: "frontend",      sourceLabel: analysis.sourceName,      sourceApp: null,      applicationContext: null,      observedAt: now,      primaryFormat,      availableFormats: [primaryFormat],      environment: {},    },    metadata: {},    agentContext: {},  };}

export function clampNumber(value: number, min: number, max: number, fallback: number) {  if (!Number.isFinite(value)) return fallback;  return Math.min(max, Math.max(min, Math.round(value)));}

export function truncateText(text: string, maxLength: number): string {  if (text.length <= maxLength) return text;  return `${text.slice(0, maxLength - 1)}…`;}

export function normalizeClip(raw: Partial<ClipItem>, settings: AppSettings): ClipItem | null {  if (typeof raw.content !== "string" || !raw.content.trim()) return null;  const createdAt = typeof raw.createdAt === "number" ? raw.createdAt : Date.now();  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : createdAt;  const lastSeenAt = typeof raw.lastSeenAt === "number" ? raw.lastSeenAt : updatedAt;  const analysis = analyzeContent(raw.content);  const detectedKind = detectKind(raw.content);  const validKinds: ClipKind[] = ["text", "code", "link", "markdown", "command", "attachment", "json", "chart", "table"];  const kind = validKinds.includes(raw.kind as ClipKind) ? (raw.kind as ClipKind) : detectedKind;  const payloadKind =    typeof raw.payloadKind === "string"      ? getPayloadKindFromFormat(raw.primaryFormat ?? "", raw.payloadKind as ClipPayloadKind)      : kind === "attachment"        ? (analysis.attachment?.isImage ? "image" : "file")        : (kind as ClipPayloadKind);  const primaryFormat =    typeof raw.primaryFormat === "string" && raw.primaryFormat      ? raw.primaryFormat      : getPrimaryFormatForPayload(payloadKind);  const availableFormats = Array.isArray(raw.availableFormats) && raw.availableFormats.length    ? raw.availableFormats.filter((format): format is string => typeof format === "string")    : [primaryFormat];  const representations = Array.isArray(raw.representations) && raw.representations.length    ? raw.representations    : createTextRepresentation(raw.content, payloadKind);  const tags = Array.isArray(raw.tags) ? normalizeTagList(raw.tags) : normalizeTagList(generateTags(raw.content, settings));  return {    id: typeof raw.id === "string" ? raw.id : makeId(),    content: raw.content,    createdAt,    updatedAt,    lastSeenAt,    lastCopiedAt: typeof raw.lastCopiedAt === "number" ? raw.lastCopiedAt : undefined,    deletedAt: typeof raw.deletedAt === "number" ? raw.deletedAt : null,    source: analysis.sourceName,    kind,    bucket:      raw.bucket === "archive" || raw.bucket === "snippet" || raw.bucket === "history"        ? raw.bucket        : "history",    favorite: Boolean(raw.favorite),    tags,    copyCount: typeof raw.copyCount === "number" ? raw.copyCount : 0,    analysis,    payloadKind,    contentHash: typeof raw.contentHash === "string" ? raw.contentHash : `${payloadKind}:${raw.id ?? createdAt}`,    primaryFormat,    availableFormats,    representations,    plainText: typeof raw.plainText === "string" ? raw.plainText : raw.content,    searchText: typeof raw.searchText === "string" ? raw.searchText : raw.content,    subKind: typeof raw.subKind === "string" ? raw.subKind : null,    width: typeof raw.width === "number" ? raw.width : null,    height: typeof raw.height === "number" ? raw.height : null,    size: typeof raw.size === "number" ? raw.size : new Blob([raw.content]).size,    fileTypes: typeof raw.fileTypes === "string" ? raw.fileTypes : null,    thumbnailPath: typeof raw.thumbnailPath === "string" ? raw.thumbnailPath : null,    imageFile: typeof raw.imageFile === "string" ? raw.imageFile : null,    isSensitive: Boolean(raw.isSensitive),    captureContext: raw.captureContext ?? {      schemaVersion: 1,      surface: "clipboard",      sourceLabel: raw.source ?? analysis.sourceName,      sourceApp: null,      applicationContext: null,      observedAt: lastSeenAt,      primaryFormat,      availableFormats,      environment: {},    },    metadata: raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {},    agentContext: raw.agentContext && typeof raw.agentContext === "object" ? raw.agentContext : {},    sourceApp: raw.sourceApp,  };}
