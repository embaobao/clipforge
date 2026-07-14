import type { SmartParsedTarget } from "../plugin-actions.js";

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

export type EditorDraft = {
  sessionId: string;
  draftVersion: number;
  clipId: string;
  content: string;
  tags: string[];
  dirty: boolean;
  createdAt: number;
  updatedAt: number;
};

export type EditorContextSnapshot = {
  schemaVersion: 1;
  clip: {
    id: string;
    kind: ClipKind;
    payloadKind: ClipPayloadKind;
    title: string;
    summary: string;
    tags: string[];
    sourceAppName?: string;
  };
  editor: {
    sessionId: string;
    draftVersion: number;
    format: ClipPayloadKind;
    selectionText: string;
    contentLength: number;
    tags: string[];
    suggestedTags: string[];
    dirty: boolean;
  };
  runtime: {
    platform: string;
    route: string;
    activeView: string;
    panelPinned: boolean;
  };
  permission: {
    exposeFullContent: boolean;
    redactedFields: string[];
  };
};

export type TagPatch = {
  add: string[];
  remove: string[];
  keep: string[];
};

export type EditorSuggestionResult = {
  id: string;
  sessionId: string;
  draftVersion: number;
  contentPatch?: {
    type: "replaceDocument" | "replaceSelection" | "insertText";
    preview: string;
    replacement: string;
  };
  tagPatch?: TagPatch;
  rationale: string;
  riskLevel: "low" | "medium" | "high";
};

export type EditorPluginAction =
  | { type: "replaceSelection"; text: string }
  | { type: "replaceDocument"; text: string }
  | { type: "insertText"; text: string }
  | { type: "setMetadata"; metadata: Record<string, unknown> }
  | { type: "updateTags"; tagPatch: TagPatch };

export type AgentContextReferenceSource =
  | "current"
  | "clip"
  | "favorites"
  | "search-result"
  | "all"
  | "file"
  | "skill-context";

export type AgentContextMode = "current" | "selected" | "favorites" | "search-result" | "all" | "skill";

export type AgentContextReference = {
  id: string;
  source: AgentContextReferenceSource;
  clipId?: string;
  title: string;
  summary: string;
  payloadKind: string;
  primaryUrl?: string;
  textPreview: string;
  tags: string[];
  sourceAppName?: string;
  permissionScope: "summary" | "current-content" | "metadata-only";
  itemCount?: number;
  scopeLabel?: string;
  parsedTargets?: SmartParsedTarget[];
};

export type ClipboardContextSnapshot = {
  schemaVersion: 1;
  clip: AgentContextReference;
  permission: {
    includeContent: boolean;
    redactedFields: string[];
    decision: "summary-only" | "user-authorized-content";
  };
  trace: {
    traceId: string;
    contextSchema: "ClipboardContextSnapshot.v1";
  };
};

export type AgentContextSet = {
  id: string;
  mode: AgentContextMode;
  references: AgentContextReference[];
  createdAt: number;
  updatedAt: number;
  limits: {
    maxItems: number;
    maxCharsPerItem: number;
    maxTotalChars: number;
  };
};

export type ClipboardAgentMessagePart =
  | { type: "text"; text: string }
  | { type: "data-context-set"; data: AgentContextSet }
  | { type: "data-status"; data: { status: AgentRun["status"] | "drafting"; message?: string } }
  | { type: "data-result-actions"; data: AgentResultAction[] }
  | { type: "data-tool-call"; data: { name: string; argumentsPreview: string; status: "pending" | "running" | "succeeded" | "failed" } }
  | { type: "data-tool-result"; data: { name: string; resultPreview: string; status: "succeeded" | "failed" } }
  | { type: "data-custom"; data: { event: string; payload: Record<string, unknown> } };

export type AgentMessage = {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  parts: ClipboardAgentMessagePart[];
  metadata: {
    conversationId: string;
    createdAt: number;
    anchorId?: string;
  };
};

export type AgentConversation = {
  id: string;
  title: string;
  contextSetId: string;
  currentAnchorId?: string;
  liveEdgeFollowing: boolean;
  createdAt: number;
  updatedAt: number;
};

export type AgentResultAction = {
  type: "copyResult" | "saveAsClip" | "favoriteSourceClip" | "archiveSourceClip" | "appendTag" | "pasteResult";
  label: string;
};

export type AgentTranscriptRow = {
  id: string;
  messageId?: string;
  kind: "reference" | "user-message" | "assistant-message" | "run-marker" | "result-actions";
  scrollAnchor: boolean;
  createdAt: number;
  parts: ClipboardAgentMessagePart[];
};

export type ClipboardPrivateSkill = {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  defaultContextMode: AgentContextMode;
  outputActions: AgentResultAction["type"][];
  createdAt: number;
  updatedAt: number;
};

export type AgentProviderReadiness = {
  providerId: string;
  status: string;
  reason: string;
  checkedAt: number;
  commandPreview: string;
};

export type ClipboardAgentProviderConfig = {
  id: string;
  label: string;
  kind: "local-cli" | "openai-compatible" | "remote-http" | "acp" | string;
  configured: boolean;
  commandPreview: string;
  redactedConfig: Record<string, unknown>;
  lastReadiness?: AgentProviderReadiness | null;
};

export type LocalCliAgentProviderAdapterDescriptor = {
  id: string;
  kind: "local-cli";
  commandPreview: string;
  configured: boolean;
  readiness?: AgentProviderReadiness | null;
};

export type RemoteHttpAgentProviderAdapterDescriptor = {
  id: string;
  kind: "remote-http" | "openai-compatible";
  protocol: "ag-ui" | "openai-compatible";
  endpointRef: string;
  apiKeyRef?: string;
  modelId?: string;
  timeoutMs: number;
  configured: boolean;
  redactedConfig: Record<string, unknown>;
};

export type AcpAgentProviderAdapterDescriptor = {
  id: string;
  kind: "acp";
  serverRef: string;
  agentId?: string;
  sessionMode: "ephemeral" | "sticky";
  configured: boolean;
  redactedConfig: Record<string, unknown>;
};

export type AgentProviderAdapterDescriptor =
  | LocalCliAgentProviderAdapterDescriptor
  | RemoteHttpAgentProviderAdapterDescriptor
  | AcpAgentProviderAdapterDescriptor;

export type AgentInvocationConfig = {
  providerId?: string | null;
  prompt: string;
  contextSet: AgentContextSet;
  allowFullContent?: boolean;
};

export type AgentRun = {
  id: string;
  conversationId: string;
  providerId: string;
  status: "idle" | "preparing" | "waiting_confirmation" | "running" | "streaming" | "succeeded" | "failed" | "cancelling" | "cancelled";
  promptPreview: string;
  commandPreview: string;
  contextSummary: string;
  output: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  exitCode?: number | null;
  createdAt: number;
  updatedAt: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  durationMs?: number | null;
};

export type ClipboardAgentAdapter = {
  id: string;
  kind: ClipboardAgentProviderConfig["kind"];
  prepareRun: (input: AgentInvocationConfig) => Promise<{ run: AgentRun; requiresConfirmation: boolean }>;
  startRun: (input: AgentInvocationConfig & { runId?: string; confirmed?: boolean }) => Promise<AgentRun>;
  cancelRun: (runId: string) => Promise<AgentRun>;
};

export type ClipboardAgentEvent =
  | { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string }
  | { type: "TOOL_CALL"; messageId: string; name: string; argumentsPreview: string }
  | { type: "TOOL_RESULT"; messageId: string; name: string; resultPreview: string }
  | { type: "CUSTOM"; messageId: string; event: "renderPanel" | "previewPatch" | "suggestUpdate" | "tagPatchPreview"; payload: Record<string, unknown> };

export type AgentAgUiEventPayload = {
  runId: string;
  messageId: string;
  eventType: "TEXT_MESSAGE_CONTENT" | "STATE_DELTA" | "TOOL_CALL" | "TOOL_RESULT" | "CUSTOM" | string;
  role: AgentMessage["role"];
  text?: string | null;
  status?: AgentRun["status"] | null;
  toolName?: string | null;
  argumentsPreview?: string | null;
  resultPreview?: string | null;
  customEvent?: ClipboardAgentEvent extends { type: "CUSTOM"; event: infer T } ? T : string;
  customPayload?: Record<string, unknown> | null;
  createdAt: number;
};

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

/** 统一设置服务契约（前端设置页 / Agent 配置区共用）。 */
export type SettingsService = {
  get(includeSchema?: boolean): Promise<SettingsDocument>;
  patch(request: SettingsPatchRequest): Promise<SettingsWriteResult>;
  replace(request: SettingsReplaceRequest): Promise<SettingsWriteResult>;
  reset(request: SettingsResetRequest): Promise<SettingsWriteResult>;
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
