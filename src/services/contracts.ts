export type ClipKind = "text" | "code" | "link" | "markdown" | "command" | "attachment" | "json" | "chart" | "table";
export type ClipPayloadKind =
  | "text"
  | "link"
  | "markdown"
  | "code"
  | "command"
  | "html"
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

export const CLIP_QUERY_LIMITS = {
  default: 50,
  max: 200,
  virtualWindow: 500,
} as const;

export type StoragePerformanceTarget = {
  minRetainedItems: 100_000;
  queryLimitMax: typeof CLIP_QUERY_LIMITS.max;
  requiresCursorPagination: true;
  requiresFullTextIndex: true;
  durableLocalStore: "sqlite";
};

export const storagePerformanceTarget: StoragePerformanceTarget = {
  minRetainedItems: 100_000,
  queryLimitMax: CLIP_QUERY_LIMITS.max,
  requiresCursorPagination: true,
  requiresFullTextIndex: true,
  durableLocalStore: "sqlite",
};

export type ClipboardRepository = {
  initialize(): Promise<{ storagePath: string; migrated: number }>;
  capture(input: ClipboardCaptureInput): Promise<ClipboardCaptureResult>;
  get(id: string): Promise<ClipRecord | null>;
  query(input: ClipQuery): Promise<ClipQueryResult>;
  count(input?: Omit<ClipQuery, "limit" | "cursor" | "sort">): Promise<{ total: number }>;
  update(id: string, patch: ClipPatch): Promise<ClipRecord>;
  delete(ids: string[], options?: { soft?: boolean }): Promise<{ deletedIds: string[] }>;
  cleanup(input: CleanupRequest): Promise<CleanupResult>;
  export(input: ExportRequest): Promise<ExportResult>;
  import(input: ImportRequest): Promise<ImportResult>;
};

export type CleanupPolicy = {
  enabled: boolean;
  intervalHours: number;
  softDeletedRetentionDays: number;
  maxItems?: number;
};

export type CleanupRequest = {
  policy: CleanupPolicy;
  now: number;
  dryRun?: boolean;
};

export type CleanupResult = {
  hardDeleted: number;
  softDeleted: number;
  retained: number;
  ranAt: number;
};

export type SearchIndex = {
  initialize(): Promise<{ indexPath: string; ready: boolean }>;
  search(input: ClipQuery): Promise<ClipQueryResult>;
  upsert(items: ClipRecord[]): Promise<{ indexed: number; indexedAt: number }>;
  remove(ids: string[]): Promise<{ removed: number }>;
  rebuild(): Promise<{ indexed: number; indexedAt: number }>;
};

export type SettingsStore<TSettings> = {
  read(): Promise<{ path: string; settings: TSettings }>;
  write(settings: TSettings): Promise<{ path: string; updatedAt: number }>;
  watch(onChange: (settings: TSettings) => void): Promise<() => void>;
};

export type ExportRequest = {
  format: "json" | "jsonl" | "csv";
  query?: ClipQuery;
  includeDeleted?: boolean;
};

export type ExportResult = {
  format: ExportRequest["format"];
  fileName: string;
  content: string;
  exportedAt: number;
  count: number;
};

export type ImportRequest = {
  format: "json" | "jsonl" | "csv";
  content: string;
  strategy: "append" | "merge" | "replace";
  sourceLabel?: string;
};

export type ImportResult = {
  imported: number;
  skipped: number;
  updated: number;
  errors: Array<{ row?: number; message: string }>;
};

export type SyncChange = {
  id: string;
  operation: SyncOperation;
  item?: ClipRecord;
  changedAt: number;
  clientId: string;
};

export type SyncPullRequest = {
  clientId: string;
  since?: number;
  cursor?: string;
  limit: number;
};

export type SyncPullResult = {
  changes: SyncChange[];
  serverTime: number;
  nextCursor?: string;
};

export type SyncPushRequest = {
  clientId: string;
  changes: SyncChange[];
};

export type SyncPushResult = {
  accepted: string[];
  rejected: Array<{ id: string; reason: string; serverItem?: ClipRecord }>;
  serverTime: number;
};

export type SyncAdapter = {
  pull(input: SyncPullRequest): Promise<SyncPullResult>;
  push(input: SyncPushRequest): Promise<SyncPushResult>;
  subscribe(onChange: (change: SyncChange) => void): Promise<() => void>;
};

export type ExternalToolName =
  | "clipboard.capture"
  | "clipboard.search"
  | "clipboard.copy"
  | "clipboard.update"
  | "clipboard.delete"
  | "clipboard.export"
  | "clipboard.import";

export type ExternalToolRequest =
  | { tool: "clipboard.capture"; input: ClipboardCaptureInput }
  | { tool: "clipboard.search"; input: ClipQuery }
  | { tool: "clipboard.copy"; input: { id: string } }
  | { tool: "clipboard.update"; input: { id: string; patch: ClipPatch } }
  | { tool: "clipboard.delete"; input: { ids: string[]; soft?: boolean } }
  | { tool: "clipboard.export"; input: ExportRequest }
  | { tool: "clipboard.import"; input: ImportRequest };

export type ExternalToolResult =
  | { tool: "clipboard.capture"; output: ClipboardCaptureResult }
  | { tool: "clipboard.search"; output: ClipQueryResult }
  | { tool: "clipboard.copy"; output: { id: string; copiedAt: number } }
  | { tool: "clipboard.update"; output: ClipRecord }
  | { tool: "clipboard.delete"; output: { deletedIds: string[] } }
  | { tool: "clipboard.export"; output: ExportResult }
  | { tool: "clipboard.import"; output: ImportResult };

export type ExternalToolBridge = {
  call(request: ExternalToolRequest): Promise<ExternalToolResult>;
  listTools(): Promise<Array<{ name: ExternalToolName; description: string }>>;
};

export type StorageDriver = {
  kind: "sqlite";
  path: string;
  schemaVersion: number;
  durable: true;
};

export type ServiceRegistry = {
  storage: StorageDriver;
  repository: ClipboardRepository;
  searchIndex: SearchIndex;
  sync?: SyncAdapter;
  externalTools?: ExternalToolBridge;
};
