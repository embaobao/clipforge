/** Agent 域契约：上下文引用、会话消息、provider 适配器、运行记录与 Ag-UI 事件。 */
import type { SmartParsedTarget } from "../../plugin-actions.js";
import type { ClipCaptureContextRecord } from "./clipboard-contracts.js";

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
  applicationContext?: Record<string, unknown> | null;
  captureContext?: ClipCaptureContextRecord | null;
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
