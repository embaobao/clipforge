/** 服务契约域：存储/仓储/检索/导入导出/同步/外部工具桥与统一设置服务（settings-service-unified-protocol）。 */
import type { ClipboardAgentProviderConfig, AgentProviderReadiness } from "./agent-contracts.js";
import { CLIP_QUERY_LIMITS } from "./clipboard-contracts.js";
import type {
  ClipPatch,
  ClipQuery,
  ClipQueryResult,
  ClipRecord,
  ClipboardCaptureInput,
  ClipboardCaptureResult,
  SyncOperation,
} from "./clipboard-contracts.js";

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

// ===== 统一设置服务契约（settings-service-unified-protocol）=====
// 与 Rust SettingsService 的 serde 字段对齐（camelCase）。
// settings 字段以宽松 JSON 对象表达（Rust 侧是 serde_json::Value）；
// src/settings.tsx 的 AppSettings 是它的强类型视图。

/** 设置写入发起方。 */
export type SettingsActor = "settings-window" | "mcp" | "agent" | "system";

/** 设置写入模式：patch 局部更新；replace 全量替换；reset 按 scope 重置。 */
export type SettingsWriteMode = "patch" | "replace" | "reset";

/** 设置重置范围。 */
export type SettingsResetScope =
  | "all"
  | "agent"
  | "shortcuts"
  | "display"
  | "capture"
  | "storage"
  | "logs"
  | "tags";

/** 写入策略：默认推荐 patch；replace / reset 必须显式 confirmed。 */
export type SettingsWritePolicy = {
  recommendedMode: "patch";
  replaceRequiresConfirmation: true;
  resetRequiresConfirmation: true;
  arrayMerge: "replace";
};

/** 设置文档（get 返回）：含 settings、可选 schema、revision、写入策略与 redaction 说明。 */
export type SettingsDocument = {
  settings: Record<string, unknown>;
  schema: unknown;
  revision: string;
  previousRevision?: string;
  changedPaths?: string[];
  nextActions?: string[];
  updatedAt: number;
  source: "tauri" | "mcp";
  writePolicy: SettingsWritePolicy;
  warnings: string[];
  redaction: Record<string, string>;
  durationMs?: number;
};

/** 局部更新请求（推荐写入方式）。 */
export type SettingsPatchRequest = {
  patch: Record<string, unknown>;
  actor?: SettingsActor;
  reason?: string;
  expectedRevision?: string;
};

/** 全量替换请求，必须 confirmed=true。 */
export type SettingsReplaceRequest = {
  settings: Record<string, unknown>;
  actor?: SettingsActor;
  reason?: string;
  expectedRevision?: string;
  confirmed: true;
};

/** 按 scope 重置请求，必须 confirmed=true。 */
export type SettingsResetRequest = {
  scope: SettingsResetScope;
  actor?: SettingsActor;
  reason?: string;
  expectedRevision?: string;
  confirmed: true;
};

/** 写入结果（patch/replace/reset 返回），含 revision、changedPaths、nextActions。 */
export type SettingsWriteResult = SettingsDocument;

/** settings_changed 事件 payload：只携带小字段，不含 settings body / schema / apiKey。 */
export type SettingsChangedEvent = {
  revision: string;
  previousRevision: string;
  changedPaths: string[];
  actor: SettingsActor;
  mode: SettingsWriteMode;
  updatedAt: number;
};

/** Settings Service 暴露的 Agent provider 配置摘要。 */
export type SettingsAgentProvidersResult = {
  activeProviderId?: string | null;
  providers: ClipboardAgentProviderConfig[];
  tools?: unknown[];
  revision: string;
};

/** Settings Service 暴露的 Agent model 列表摘要；具体 provider 差异保留为可扩展字段。 */
export type SettingsAgentModelsResult = {
  providerId?: string | null;
  activeModelId?: string | null;
  status?: string;
  reason?: string;
  source?: string;
  message?: string;
  models?: Array<{ id: string; label?: string } | string>;
  checkedAt?: number;
};

/** 统一设置服务契约（前端设置页 / Agent 配置区共用）。 */
export type SettingsService = {
  get(includeSchema?: boolean): Promise<SettingsDocument>;
  patch(request: SettingsPatchRequest): Promise<SettingsWriteResult>;
  replace(request: SettingsReplaceRequest): Promise<SettingsWriteResult>;
  reset(request: SettingsResetRequest): Promise<SettingsWriteResult>;
  agent: {
    providers(): Promise<SettingsAgentProvidersResult>;
    check(providerId?: string | null): Promise<AgentProviderReadiness>;
    models(providerId?: string | null): Promise<SettingsAgentModelsResult>;
  };
  subscribe(handler: (event: SettingsChangedEvent) => void): Promise<() => void>;
};

/** MCP 设置 / Agent 工具名（与 Rust mcp_tool_specs 对齐）。 */
export type SettingsToolName =
  | "clipf.settings.get"
  | "clipf.settings.patch"
  | "clipf.settings.replace"
  | "clipf.settings.reset"
  | "clipf.agent.providers"
  | "clipf.agent.check"
  | "clipf.agent.models";
