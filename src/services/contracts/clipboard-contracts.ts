/** 剪贴板条目域契约：Clip 记录、采集输入/结果、查询与限额（与 Rust 存储层 serde 字段对齐）。 */

export type ClipKind = "text" | "code" | "link" | "markdown" | "command" | "attachment" | "json" | "chart" | "table";
export type ClipPayloadKind =
  | "text"
  | "link"
  | "markdown"
  | "code"
  | "command"
  | "html"
  | "rtf"
  | "file"
  | "image"
  | "json"
  | "chart"
  | "table";
export type ClipBucket = "history" | "archive" | "snippet";
export type ClipSource = "clipboard" | "import" | "sync" | "external";
export type SyncOperation = "create" | "update" | "delete";

export type ClipboardRepresentationRecord = {
  format: "text/plain" | "text/html" | "text/rtf" | "image/png" | "application/file-list" | "text/uri-list" | string;
  storage: "inline" | "file" | "derived" | string;
  content?: string | null;
  fileName?: string | null;
  size?: number | null;
  hash?: string | null;
  preferred?: boolean;
};

export type ClipCaptureContextRecord = {
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

export type AttachmentRecord = {
  name: string;
  description: string;
  target: string;
  targetType: "url" | "path";
  mimeType?: string;
  sizeBytes?: number;
  isImage: boolean;
};

export type ClipAnalysisRecord = {
  sourceName: string;
  badge: string;
  title: string;
  summary: string;
  url?: string;
  host?: string;
  isMarkdown: boolean;
  attachment?: AttachmentRecord;
};

export type ClipRecord = {
  id: string;
  content: string;
  contentHash: string;
  kind: ClipKind;
  bucket: ClipBucket;
  source: ClipSource;
  sourceLabel: string;
  favorite: boolean;
  tags: string[];
  copyCount: number;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  lastCopiedAt?: number;
  deletedAt?: number;
  analysis: ClipAnalysisRecord;
  payloadKind: ClipPayloadKind;
  primaryFormat: string;
  availableFormats: string[];
  representations: ClipboardRepresentationRecord[];
  plainText: string;
  searchText?: string | null;
  subKind?: string | null;
  width?: number | null;
  height?: number | null;
  size?: number | null;
  fileTypes?: string | null;
  thumbnailPath?: string | null;
  imageFile?: string | null;
  isSensitive: boolean;
  captureContext: ClipCaptureContextRecord;
  metadata: Record<string, unknown>;
  agentContext: Record<string, unknown>;
};

export type ClipboardCaptureInput = {
  content: string;
  source: ClipSource;
  observedAt: number;
  sourceLabel?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  agentContext?: Record<string, unknown>;
};

export type ClipboardCaptureResult = {
  status: "created" | "promoted" | "ignored";
  item?: ClipRecord;
  reason?: string;
};

export type ClipPatch = Partial<
  Pick<ClipRecord, "bucket" | "favorite" | "tags" | "lastCopiedAt" | "copyCount" | "metadata">
>;

export type ClipQuery = {
  text?: string;
  bucket?: ClipBucket | "all";
  kinds?: ClipKind[];
  tags?: string[];
  sources?: ClipSource[];
  favorite?: boolean;
  changedAfter?: number;
  changedBefore?: number;
  limit: number;
  cursor?: string;
  sort?: "recent" | "created" | "copied" | "relevance";
};

export type ClipQueryResult = {
  items: ClipRecord[];
  nextCursor?: string;
  total?: number;
  indexedAt?: number;
  window: {
    limit: number;
    cursor?: string;
    hasMore: boolean;
  };
};

/** 查询默认/上限与虚拟窗口大小（存储与搜索共用）。 */
export const CLIP_QUERY_LIMITS = {
  default: 50,
  max: 200,
  virtualWindow: 500,
} as const;
