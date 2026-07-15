import {
  Check,
  Clipboard,
  File,
  Filter,
  Heart,
  Tags,
  Search,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { settingsService } from "./services/settings";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { ClipItem } from "./App";
import { AgentChatPage, type AgentReferenceScopeOption } from "./agent-chat-page";
import type {
  AgentContextReference,
  AgentContextReferenceSource,
  AgentContextSet,
  AgentConversation,
  AgentMessage as ClipboardAgentUiMessage,
  AgentProviderReadiness,
  AgentResultAction,
  AgentRun as AgentRunPayload,
  AgentTranscriptRow,
  ClipboardAgentMessagePart,
  ClipboardAgentProviderConfig,
} from "./services/contracts";
import { parseSmartTargets } from "./plugin-actions";
import { useI18n, type AppLanguagePreference, type TranslationKey } from "./i18n";

type AgentConfigPayload = {
  activeProviderId?: string | null;
  providers: ClipboardAgentProviderConfig[];
};

type AgentPreparedRunPayload = {
  run: AgentRunPayload;
  requiresConfirmation: boolean;
};

type PendingPreparedRun = {
  prompt: string;
  prepared: AgentPreparedRunPayload;
  contextSet: AgentContextSet;
  allowFullContent: boolean;
};

type AgentMessageDeltaPayload = {
  runId: string;
  stream: "stdout" | "stderr";
  text: string;
};

type AgentUiMessagePayload = {
  runId: string;
  messageId: string;
  role: ClipboardAgentUiMessage["role"];
  parts: ClipboardAgentMessagePart[];
  metadata?: {
    conversationId?: string;
    createdAt?: number;
    runId?: string;
  };
};

type AgentTranscriptRowPayload = {
  id: string;
  runId: string;
  kind: string;
  text: string;
  scrollAnchor: boolean;
  createdAt: number;
};

type AgentRunSnapshotPayload = {
  run: AgentRunPayload;
  transcript: AgentTranscriptRowPayload[];
};

type AgentSessionSnapshotPayload = {
  runs: AgentRunSnapshotPayload[];
  activeRunId?: string | null;
  restoredAt: number;
};

type ClipboardAgentPanelProps = {
  activeClip: ClipItem | null;
  allClips: ClipItem[];
  filteredClips: ClipItem[];
  selectedClips: ClipItem[];
  onCopyResult: (text: string) => Promise<void> | void;
  onPasteResult: (text: string) => Promise<void> | void;
  onSaveResult: (text: string, context: { sourceClipId?: string; conversationId: string }) => Promise<void>;
  onFavoriteClip: (clip: ClipItem) => Promise<void> | void;
  onArchiveClip: (clip: ClipItem) => Promise<void> | void;
  onAppendTagToSource: (clip: ClipItem, tag: string) => Promise<void> | void;
  onBackToClipboard: () => void;
  onOpenReference: (reference: AgentContextReference) => void;
  language: AppLanguagePreference;
};

type AgentReferenceScope = "current" | "selection" | "favorites" | "search-result" | "all" | "file" | "skill-context";
type AgentPermissionMode = "metadata" | "summary" | "content";

type AgentReferenceScopeRequest = {
  scope: AgentReferenceScope;
  createdAt: number;
};

const CONVERSATION_STORAGE_KEY = "clipforge.agent.conversation.v1";
const CONVERSATION_ID = "agent-local-conversation";
const DEFAULT_LIMITS = { maxItems: 20, maxCharsPerItem: 480, maxTotalChars: 4000 };

function makeAgentId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function compactText(value: string, max = 160) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}...`;
}

function getClipTitle(clip: ClipItem) {
  return clip.analysis.title || clip.analysis.host || compactText(clip.content, 52) || clip.id;
}

function uniqueClips(clips: Array<ClipItem | null | undefined>) {
  const seen = new Set<string>();
  const items: ClipItem[] = [];
  for (const clip of clips) {
    if (!clip || clip.deletedAt || seen.has(clip.id)) continue;
    seen.add(clip.id);
    items.push(clip);
  }
  return items;
}

function uniqueReferences(references: Array<AgentContextReference | null | undefined>) {
  const seen = new Set<string>();
  const items: AgentContextReference[] = [];
  for (const reference of references) {
    if (!reference || seen.has(reference.id)) continue;
    seen.add(reference.id);
    items.push(reference);
  }
  return items;
}

function getMentionQuery(value: string) {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(value);
  return match ? match[1] : null;
}

function replaceMentionQuery(value: string, label: string) {
  return value.replace(/(^|\s)@([^\s@]*)$/, `$1@${label} `);
}

function normalizeMentionFilter(value: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/:$/, "");
}

function mentionPayloadFilter(value: string | null): "image" | "file" | null {
  const token = normalizeMentionFilter(value);
  if (!token) return null;
  if (["img", "image", "images", "图片"].includes(token)) return "image";
  if (["file", "files", "attachment", "attachments", "文件", "附件"].includes(token)) return "file";
  return null;
}

function scrollViewportToEnd(node: HTMLDivElement, behavior: ScrollBehavior = "smooth") {
  node.scrollTo({ top: Math.max(0, node.scrollHeight - node.clientHeight), behavior });
}

function makeClipReference(clip: ClipItem, source: AgentContextReferenceSource, permissionMode: AgentPermissionMode = "summary"): AgentContextReference {
  const allowFullContent = permissionMode === "content";
  const metadataOnly = permissionMode === "metadata" || clip.payloadKind === "file" || clip.payloadKind === "image" || source === "skill-context";
  const permissionScope = metadataOnly ? "metadata-only" : allowFullContent ? "current-content" : "summary";
  return {
    id: `${source}:${clip.id}`,
    source,
    clipId: clip.id,
    title: getClipTitle(clip),
    summary: clip.analysis.summary || compactText(clip.content, 120),
    payloadKind: clip.payloadKind,
    primaryUrl: clip.analysis.url,
    textPreview: metadataOnly ? "" : compactText(clip.content, allowFullContent ? 480 : 180),
    tags: clip.tags.slice(0, 8),
    sourceAppName: clip.sourceApp?.name || clip.captureContext?.sourceLabel,
    permissionScope,
    parsedTargets: parseSmartTargets(clip.content).slice(0, 5),
  };
}

function suggestedPromptsForClip(clip: ClipItem | null, tr: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  if (!clip) {
    return [tr("agent.suggestion.search"), tr("agent.suggestion.organize"), tr("agent.suggestion.rules")];
  }
  if (clip.payloadKind === "image") {
    return [tr("agent.suggestion.imageMetadata"), tr("agent.suggestion.imageNext"), tr("agent.suggestion.saveImageNote")];
  }
  if (clip.payloadKind === "file") {
    return [tr("agent.suggestion.fileSummary"), tr("agent.suggestion.fileAction"), tr("agent.suggestion.fileChecklist")];
  }
  if (clip.payloadKind === "html") {
    return [tr("agent.suggestion.htmlDecode"), tr("agent.suggestion.htmlSummary"), tr("agent.suggestion.htmlClean")];
  }
  if (clip.payloadKind === "code" || clip.payloadKind === "json" || clip.payloadKind === "command") {
    return [tr("agent.suggestion.explainCode"), tr("agent.suggestion.findRisk"), tr("agent.suggestion.rewriteCommand")];
  }
  if (clip.payloadKind === "link") {
    return [tr("agent.suggestion.linkBrief"), tr("agent.suggestion.linkAction"), tr("agent.suggestion.linkTags")];
  }
  return [tr("agent.suggestion.summarize"), tr("agent.suggestion.extractTodos"), tr("agent.suggestion.rewrite")];
}

function hasSkillContext(clip: ClipItem) {
  return Object.keys(clip.agentContext ?? {}).length > 0 || clip.tags.some((tag) => tag.toLowerCase() === "ai");
}

function referenceSourceForScope(scope: AgentReferenceScope): AgentContextReferenceSource {
  if (scope === "selection") return "clip";
  if (scope === "favorites") return "favorites";
  if (scope === "search-result") return "search-result";
  if (scope === "all") return "all";
  if (scope === "file") return "file";
  if (scope === "skill-context") return "skill-context";
  return "current";
}

function clipsForReferenceScope(scope: AgentReferenceScope, options: { activeClip: ClipItem | null; allClips: ClipItem[]; filteredClips: ClipItem[]; selectedClips: ClipItem[] }) {
  if (scope === "current") return uniqueClips([options.activeClip]).slice(0, 1);
  if (scope === "selection") return uniqueClips(options.selectedClips);
  if (scope === "favorites") return uniqueClips(options.allClips.filter((clip) => clip.favorite));
  if (scope === "search-result") return uniqueClips(options.filteredClips);
  if (scope === "all") return uniqueClips(options.allClips);
  if (scope === "file") return uniqueClips(options.allClips.filter((clip) => clip.payloadKind === "file" || clip.payloadKind === "image"));
  if (scope === "skill-context") return uniqueClips(options.allClips.filter(hasSkillContext));
  return [];
}

function loadAgentSession(): {
  conversation?: AgentConversation;
  messages?: ClipboardAgentUiMessage[];
  liveEdge?: boolean;
  lastResult?: string;
  activeRunId?: string | null;
} {
  try {
    const raw = localStorage.getItem(CONVERSATION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      conversation: parsed.conversation,
      messages: Array.isArray(parsed.messages) ? parsed.messages.map(normalizeAgentMessage).filter(Boolean) : [],
      liveEdge: typeof parsed.liveEdge === "boolean" ? parsed.liveEdge : true,
      lastResult: typeof parsed.lastResult === "string" ? parsed.lastResult : "",
      activeRunId: typeof parsed.activeRunId === "string" ? parsed.activeRunId : null,
    };
  } catch {
    return {};
  }
}

function normalizeMessageMetadata(
  metadata: ClipboardAgentUiMessage["metadata"] | AgentUiMessagePayload["metadata"] | null | undefined,
) {
  return {
    conversationId: typeof metadata?.conversationId === "string" ? metadata.conversationId : CONVERSATION_ID,
    createdAt: typeof metadata?.createdAt === "number" ? metadata.createdAt : Date.now(),
  };
}

function normalizeAgentMessage(message: Partial<ClipboardAgentUiMessage> | null | undefined): ClipboardAgentUiMessage | null {
  if (!message || typeof message.id !== "string" || !message.id) return null;
  const role =
    message.role === "user" || message.role === "assistant" || message.role === "system" || message.role === "tool"
      ? message.role
      : "assistant";
  return {
    id: message.id,
    role,
    parts: Array.isArray(message.parts) ? message.parts : [],
    metadata: normalizeMessageMetadata(message.metadata),
  };
}

function panelStatusFromRun(status: AgentRunPayload["status"]): "idle" | "drafting" | "waiting_confirmation" | "succeeded" | "failed" {
  if (status === "waiting_confirmation") return "waiting_confirmation";
  if (status === "succeeded") return "succeeded";
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "preparing" || status === "running" || status === "streaming" || status === "cancelling") return "drafting";
  return "idle";
}

function messagesFromRunSnapshot(snapshot: AgentRunSnapshotPayload): ClipboardAgentUiMessage[] {
  const userRows = snapshot.transcript.filter((row) => row.kind === "user-message");
  const assistantText = snapshot.run.output ||
    snapshot.transcript
      .filter((row) => row.kind === "assistant-message" || row.kind === "stderr")
      .map((row) => row.text)
      .filter(Boolean)
      .join("\n");
  const messages: ClipboardAgentUiMessage[] = userRows.slice(-1).map((row) => ({
    id: `restored-user:${row.id}`,
    role: "user",
    parts: [{ type: "text", text: row.text }],
    metadata: { conversationId: snapshot.run.conversationId, createdAt: row.createdAt },
  }));
  const assistantFallback = snapshot.run.errorMessage || snapshot.run.commandPreview || snapshot.run.status;
  messages.push({
    id: `assistant:${snapshot.run.id}`,
    role: "assistant",
    parts: [
      { type: "text", text: assistantText || assistantFallback },
      { type: "data-status", data: { status: snapshot.run.status, message: snapshot.run.errorCode ?? snapshot.run.providerId } },
    ],
    metadata: {
      conversationId: snapshot.run.conversationId,
      createdAt: snapshot.run.startedAt || snapshot.run.updatedAt || snapshot.run.createdAt,
    },
  });
  return messages;
}

function textPart(parts: ClipboardAgentMessagePart[]) {
  return parts.find((part): part is { type: "text"; text: string } => part.type === "text")?.text ?? "";
}

function statusPart(parts: ClipboardAgentMessagePart[]) {
  return parts.find((part): part is Extract<ClipboardAgentMessagePart, { type: "data-status" }> => part.type === "data-status")?.data.status;
}

function contextSetPart(parts: ClipboardAgentMessagePart[]) {
  return parts.find((part): part is Extract<ClipboardAgentMessagePart, { type: "data-context-set" }> => part.type === "data-context-set")?.data;
}

export function ClipboardAgentPanel({
  activeClip,
  allClips,
  filteredClips,
  selectedClips,
  onArchiveClip,
  onAppendTagToSource,
  onBackToClipboard,
  onCopyResult,
  onFavoriteClip,
  onOpenReference,
  onPasteResult,
  onSaveResult,
  language,
}: ClipboardAgentPanelProps) {
  const { t: tr } = useI18n(language);
  const [restoredSession] = useState(() => loadAgentSession());
  const [conversation, setConversation] = useState<AgentConversation>(
    () =>
      restoredSession.conversation ?? {
        id: CONVERSATION_ID,
        title: "Agent",
        contextSetId: "",
        liveEdgeFollowing: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
  );
  const [attachedClipIds, setAttachedClipIds] = useState<string[]>([]);
  const [scopeRequests, setScopeRequests] = useState<AgentReferenceScopeRequest[]>([]);
  const [removedReferenceIds, setRemovedReferenceIds] = useState<Set<string>>(new Set());
  const [contextRefreshAt, setContextRefreshAt] = useState(() => Date.now());
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>("summary");
  const [messages, setMessages] = useState<ClipboardAgentUiMessage[]>(() => restoredSession.messages ?? []);
  const [input, setInput] = useState("");
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [referenceSearch, setReferenceSearch] = useState("");
  const [status, setStatus] = useState<"idle" | "drafting" | "waiting_confirmation" | "succeeded" | "failed">("idle");
  const [providers, setProviders] = useState<ClipboardAgentProviderConfig[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [providerReadiness, setProviderReadiness] = useState<AgentProviderReadiness[]>([]);
  const [prewarmingProviderId, setPrewarmingProviderId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(restoredSession.activeRunId ?? null);
  const [pendingRun, setPendingRun] = useState<PendingPreparedRun | null>(null);
  const [liveEdge, setLiveEdge] = useState(restoredSession.liveEdge ?? true);
  const [hasUnread, setHasUnread] = useState(false);
  const [lastResult, setLastResult] = useState(restoredSession.lastResult ?? "");
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pendingTurnAnchorRef = useRef<string | null>(null);
  const standardMessageRunIds = useRef<Set<string>>(new Set());
  const visibleRowRef = useRef<{ id: string; offset: number } | null>(null);
  const liveEdgeRef = useRef(liveEdge);
  const runningPrefix = tr("agent.run.runningPrefix");
  const allowFullContentForRun = permissionMode === "content";

  const resultActions: AgentResultAction[] = useMemo(
    () => [
      { type: "copyResult", label: tr("agent.resultAction.copy") },
      { type: "pasteResult", label: tr("agent.resultAction.paste") },
      { type: "saveAsClip", label: tr("agent.resultAction.save") },
      { type: "favoriteSourceClip", label: tr("agent.resultAction.favorite") },
      { type: "archiveSourceClip", label: tr("agent.resultAction.archive") },
      { type: "appendTag", label: tr("agent.resultAction.appendTag") },
    ],
    [tr],
  );

  const rows = useMemo<AgentTranscriptRow[]>(
    () =>
      messages.map((message) => {
        const kind = message.role === "user" ? "user-message" : message.role === "assistant" ? "assistant-message" : "run-marker";
        return {
          id: `message:${message.id}`,
          messageId: message.id,
          kind,
          scrollAnchor: message.role === "user",
          createdAt: message.metadata?.createdAt ?? Date.now(),
          parts: message.parts,
        };
      }),
    [messages],
  );

  const rememberVisibleRow = useCallback(() => {
    const node = viewportRef.current;
    if (!node) return;
    const items = Array.from(node.querySelectorAll<HTMLElement>("[data-message-scroller-item]"));
    const viewportTop = node.scrollTop;
    const visible = items.find((item) => item.offsetTop + item.offsetHeight >= viewportTop + 1) ?? items[0];
    const id = visible?.dataset.agentRowId;
    if (!visible || !id) return;
    visibleRowRef.current = { id, offset: visible.offsetTop - viewportTop };
  }, []);

  const restoreVisibleRow = useCallback(() => {
    const node = viewportRef.current;
    const visible = visibleRowRef.current;
    if (!node || !visible) return;
    const current = node.querySelector<HTMLElement>(`[data-agent-row-id="${visible.id}"]`);
    if (!current) return;
    node.scrollTop = Math.max(0, current.offsetTop - visible.offset);
  }, []);

  const preserveVisibleRowDuring = useCallback(
    (mutate: () => void) => {
      if (!liveEdgeRef.current && !pendingTurnAnchorRef.current) rememberVisibleRow();
      mutate();
    },
    [rememberVisibleRow],
  );

  const preserveVisibleRowForDomChange = useCallback(() => {
    if (liveEdgeRef.current || pendingTurnAnchorRef.current) return;
    rememberVisibleRow();
    window.requestAnimationFrame(restoreVisibleRow);
  }, [rememberVisibleRow, restoreVisibleRow]);

  useEffect(() => {
    liveEdgeRef.current = liveEdge;
  }, [liveEdge]);

  // Gap1：刷新 provider 配置——mount 加载与 settings_changed 事件复用同一逻辑（agent_get_config 是本地读取，非网络）。
  const refreshProviderConfig = useCallback(() => {
    invoke<AgentConfigPayload>("agent_get_config")
      .then((payload) => {
        setProviders(payload.providers);
        setActiveProviderId(payload.activeProviderId ?? payload.providers[0]?.id ?? null);
      })
      .catch(() => {
        setProviders([]);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const configTimer = window.setTimeout(() => {
      if (cancelled) return;
      refreshProviderConfig();
    }, 180);
    const detectTimer = window.setTimeout(() => {
      if (cancelled) return;
      void invoke<AgentProviderReadiness[]>("agent_detect")
        .then((items) => {
          if (cancelled) return;
          setProviderReadiness(items);
          const ready = items.find((item) => item.status === "ready");
          if (ready) setActiveProviderId(ready.providerId);
        })
        .catch(() => {
          if (!cancelled) setProviderReadiness([]);
        });
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(configTimer);
      window.clearTimeout(detectTimer);
    };
  }, [refreshProviderConfig]);

  // Gap1：订阅 settings_changed——provider 配置在设置页/MCP 改动后实时同步到已打开的 Agent 面板。
  // 只在 agent 相关路径变化时重读 provider 配置，避免无关设置变更触发多余刷新（按 changedPaths 过滤）。
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    settingsService
      .subscribe((event) => {
        if (!active) return;
        const agentTouched = event.changedPaths.some(
          (path) => path.startsWith("$.agent") || path.startsWith("$.agentProviders"),
        );
        if (!agentTouched) return;
        refreshProviderConfig();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [refreshProviderConfig]);

  const prewarmProvider = useCallback(
    async (providerId: string | null = activeProviderId) => {
      if (!providerId) return;
      setPrewarmingProviderId(providerId);
      try {
        const readiness = await invoke<AgentProviderReadiness>("agent_check_provider", { providerId });
        setProviderReadiness((current) => {
          const next = current.filter((item) => item.providerId !== readiness.providerId);
          return [readiness, ...next];
        });
      } catch {
        setProviderReadiness((current) => {
          const next = current.filter((item) => item.providerId !== providerId);
          return [
            {
              providerId,
              status: "health-timeout",
              reason: "provider prewarm failed",
              checkedAt: Date.now(),
              commandPreview: providers.find((provider) => provider.id === providerId)?.commandPreview ?? "",
            },
            ...next,
          ];
        });
      } finally {
        setPrewarmingProviderId((current) => (current === providerId ? null : current));
      }
    },
    [activeProviderId, providers],
  );

  useEffect(() => {
    if (!activeProviderId) return;
    const timer = window.setTimeout(() => void prewarmProvider(activeProviderId), 1600);
    return () => window.clearTimeout(timer);
  }, [activeProviderId, prewarmProvider]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let disposed = false;
    listen<AgentUiMessagePayload>("agent_ui_message", (event) => {
      if (disposed) return;
      const payload = event.payload;
      preserveVisibleRowDuring(() => {
        standardMessageRunIds.current.add(payload.runId);
        const incomingStatus = statusPart(payload.parts);
        const incomingText = textPart(payload.parts);
        if (incomingStatus === "succeeded") {
          setLastResult(incomingText);
          setStatus("succeeded");
          setActiveRunId((current) => (current === payload.runId ? null : current));
        } else if (incomingStatus === "failed" || incomingStatus === "cancelled") {
          setStatus("failed");
          setActiveRunId((current) => (current === payload.runId ? null : current));
        }
        setMessages((current) => {
          const messageId = payload.messageId;
          const existingIndex = current.findIndex((message) => message.id === messageId);
          const baseMessage: ClipboardAgentUiMessage = {
            id: messageId,
            role: payload.role,
            parts: payload.parts,
            metadata: normalizeMessageMetadata(payload.metadata),
          };
          if (existingIndex < 0) {
            const withActions =
              incomingStatus === "succeeded" && incomingText
                ? {
                    ...baseMessage,
                    parts: [...payload.parts, { type: "data-result-actions", data: resultActions } satisfies ClipboardAgentMessagePart],
                  }
                : baseMessage;
            return [...current, withActions];
          }
          const existing = current[existingIndex];
          const existingText = textPart(existing.parts);
          const isStreamingChunk = incomingStatus === "streaming" && incomingText && !incomingText.startsWith(runningPrefix);
          const nextText = isStreamingChunk ? [existingText, incomingText].filter(Boolean).join("\n") : incomingText;
          const nextParts: ClipboardAgentMessagePart[] =
            incomingStatus === "succeeded" && nextText
              ? [
                  { type: "text", text: nextText } satisfies ClipboardAgentMessagePart,
                  ...payload.parts.filter((part) => part.type !== "text"),
                  { type: "data-result-actions", data: resultActions } satisfies ClipboardAgentMessagePart,
                ]
              : nextText
                ? [{ type: "text", text: nextText } satisfies ClipboardAgentMessagePart, ...payload.parts.filter((part) => part.type !== "text")]
                : payload.parts;
          const next = [...current];
          next[existingIndex] = {
            ...existing,
            role: payload.role,
            parts: nextParts,
            metadata: {
              ...normalizeMessageMetadata(existing.metadata),
              conversationId: payload.metadata?.conversationId || existing.metadata?.conversationId || CONVERSATION_ID,
            },
          };
          return next;
        });
      });
    }).then((unlisten) => unlisteners.push(unlisten));

    listen<AgentMessageDeltaPayload>("agent_message_delta", (event) => {
      if (disposed) return;
      const delta = event.payload;
      if (standardMessageRunIds.current.has(delta.runId)) return;
      const messageId = `assistant:${delta.runId}`;
      preserveVisibleRowDuring(() => {
        setMessages((current) =>
          current.map((message) => {
            if (message.id !== messageId) return message;
            const existingText = textPart(message.parts);
            const prefix = existingText ? `${existingText}\n` : "";
            return {
              ...message,
              parts: [
                { type: "text", text: `${prefix}${delta.text}` },
                { type: "data-status", data: { status: "running", message: delta.stream } },
              ],
            };
          }),
        );
      });
    }).then((unlisten) => unlisteners.push(unlisten));

    const finish = (run: AgentRunPayload) => {
      if (disposed) return;
      const text = run.output || run.errorMessage || run.status;
      preserveVisibleRowDuring(() => {
        setLastResult(run.output);
        setStatus(run.status === "succeeded" ? "succeeded" : "failed");
        setActiveRunId((current) => (current === run.id ? null : current));
        setMessages((current) =>
          current.map((message) =>
            message.id === `assistant:${run.id}`
              ? {
                  ...message,
                  parts: [
                    { type: "text", text },
                    { type: "data-status", data: { status: run.status === "succeeded" ? "succeeded" : "failed", message: run.errorCode ?? undefined } },
                    ...(run.output ? [{ type: "data-result-actions", data: resultActions } satisfies ClipboardAgentMessagePart] : []),
                  ],
                }
              : message,
          ),
        );
      });
    };
    listen<AgentRunPayload>("agent_run_finished", (event) => finish(event.payload)).then((unlisten) => unlisteners.push(unlisten));
    listen<AgentRunPayload>("agent_run_error", (event) => finish(event.payload)).then((unlisten) => unlisteners.push(unlisten));
    listen<AgentTranscriptRowPayload[]>("agent_transcript_rows", (event) => {
      if (disposed) return;
      const rowsByRun = event.payload.reduce<Record<string, AgentTranscriptRowPayload[]>>((acc, row) => {
        acc[row.runId] = [...(acc[row.runId] ?? []), row];
        return acc;
      }, {});
      preserveVisibleRowDuring(() => {
        setMessages((current) =>
          current.map((message) => {
            const runId = message.id.startsWith("assistant:") ? message.id.slice("assistant:".length) : "";
            const runRows = rowsByRun[runId];
            if (!runRows?.length) return message;
            const text = runRows
              .filter((row) => row.kind === "assistant-message" || row.kind === "stderr")
              .map((row) => row.text)
              .join("\n");
            if (!text) return message;
            return {
              ...message,
              parts: [
                { type: "text", text },
                { type: "data-status", data: { status: "running", message: "transcript" } },
              ],
            };
          }),
        );
      });
    }).then((unlisten) => unlisteners.push(unlisten));
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [preserveVisibleRowDuring, resultActions, runningPrefix]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      void invoke<AgentSessionSnapshotPayload>("agent_restore_session")
      .then((snapshot) => {
        if (cancelled || !snapshot.runs.length) return;
        const activeSnapshot =
          snapshot.runs.find((item) => item.run.id === snapshot.activeRunId) ?? snapshot.runs[snapshot.runs.length - 1];
        if (!activeSnapshot) return;
        const restoredMessages = messagesFromRunSnapshot(activeSnapshot);
        const lastUserRow = activeSnapshot.transcript.filter((row) => row.kind === "user-message").at(-1);
        preserveVisibleRowDuring(() => {
          setActiveRunId(activeSnapshot.run.id);
          setStatus(panelStatusFromRun(activeSnapshot.run.status));
          if (activeSnapshot.run.output) setLastResult(activeSnapshot.run.output);
          setConversation((current) => ({
            ...current,
            id: activeSnapshot.run.conversationId || current.id,
            currentAnchorId: lastUserRow ? `message:restored-user:${lastUserRow.id}` : current.currentAnchorId,
            updatedAt: snapshot.restoredAt || Date.now(),
          }));
          setMessages((current) => {
            const existing = new Set(current.map((message) => message.id));
            const merged = restoredMessages.filter((message) => !existing.has(message.id));
            return merged.length ? [...current, ...merged].slice(-40) : current;
          });
        });
      })
      .catch(() => undefined);
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [preserveVisibleRowDuring]);

  const contextSet = useMemo<AgentContextSet>(() => {
    const hasCurrentScope = scopeRequests.some((request) => request.scope === "current");
    const attachedClips = attachedClipIds
      .map((id) => allClips.find((clip) => clip.id === id))
      .filter((clip): clip is ClipItem => Boolean(clip && !clip.deletedAt));
    const currentReference = activeClip && hasCurrentScope ? makeClipReference(activeClip, "current", permissionMode) : null;
    const attachedReferences = attachedClips.map((clip) => makeClipReference(clip, "clip", permissionMode));
    const scopedReferences = scopeRequests.flatMap((request) => {
      const source = referenceSourceForScope(request.scope);
      return clipsForReferenceScope(request.scope, { activeClip, allClips, filteredClips, selectedClips })
        .slice(0, DEFAULT_LIMITS.maxItems)
        .map((clip) => makeClipReference(clip, source, permissionMode));
    });
    const references = uniqueReferences([currentReference, ...attachedReferences, ...scopedReferences]).filter((reference) => !removedReferenceIds.has(reference.id));
    return {
      id: `ctx_chat_${contextRefreshAt}_${permissionMode}_${references.map((reference) => reference.id).join("_")}`,
      mode: scopeRequests[0]?.scope === "favorites" ? "favorites" : scopeRequests[0]?.scope === "search-result" ? "search-result" : scopeRequests[0]?.scope === "all" ? "all" : scopeRequests[0]?.scope === "skill-context" ? "skill" : references.length > 1 ? "selected" : hasCurrentScope ? "current" : "selected",
      references: references.map((reference) => ({
        ...reference,
        scopeLabel: references.length > 1 ? tr("agent.scope.references", { count: references.length }) : tr("agent.scope.current"),
      })),
      createdAt: contextRefreshAt,
      updatedAt: contextRefreshAt,
      limits: DEFAULT_LIMITS,
    };
  }, [activeClip, allClips, attachedClipIds, contextRefreshAt, filteredClips, permissionMode, removedReferenceIds, scopeRequests, selectedClips, tr]);

  const mentionQuery = useMemo(() => getMentionQuery(input), [input]);
  const activeReferenceQuery = referencePickerOpen ? referenceSearch : mentionQuery;
  const activeReferencePayloadFilter = useMemo(() => mentionPayloadFilter(activeReferenceQuery), [activeReferenceQuery]);
  const referenceCandidates = useMemo(() => {
    const queryText = normalizeMentionFilter(activeReferenceQuery);
    const usedClipIds = new Set(contextSet.references.map((reference) => reference.clipId).filter(Boolean) as string[]);
    const pool = uniqueClips([
      activeClip,
      ...selectedClips,
      ...filteredClips,
      ...allClips.filter((clip) => clip.favorite),
      ...allClips,
    ]);
    return pool
      .filter((clip) => !usedClipIds.has(clip.id))
      .filter((clip) => {
        if (activeReferencePayloadFilter === "image" && clip.payloadKind !== "image") return false;
        if (activeReferencePayloadFilter === "file" && clip.payloadKind !== "file" && clip.payloadKind !== "image") return false;
        if (!queryText) return true;
        if (activeReferencePayloadFilter) return true;
        const haystack = [clip.payloadKind, getClipTitle(clip), clip.content, clip.analysis.host, clip.tags.join(" ")].join(" ").toLowerCase();
        return haystack.includes(queryText);
      })
      .slice(0, 6);
  }, [activeClip, activeReferencePayloadFilter, activeReferenceQuery, allClips, contextSet.references, filteredClips, selectedClips]);

  useEffect(() => {
    setConversation((current) => ({
      ...current,
      contextSetId: contextSet.id,
      liveEdgeFollowing: liveEdge,
      updatedAt: Date.now(),
    }));
  }, [contextSet.id, liveEdge]);

  useEffect(() => {
    localStorage.setItem(
      CONVERSATION_STORAGE_KEY,
      JSON.stringify({
        conversation,
        messages: messages.slice(-40),
        liveEdge,
        lastResult,
        activeRunId,
      }),
    );
  }, [activeRunId, conversation, liveEdge, lastResult, messages]);

  useEffect(() => {
    if (liveEdge || !conversation.currentAnchorId) return;
    window.requestAnimationFrame(() => {
      const node = viewportRef.current?.querySelector<HTMLElement>(`[data-agent-row-id="${conversation.currentAnchorId}"]`);
      node?.scrollIntoView({ block: "start" });
    });
  }, []);

  useLayoutEffect(() => {
    if (liveEdge || pendingTurnAnchorRef.current) return;
    restoreVisibleRow();
  }, [liveEdge, pendingRun, restoreVisibleRow, rows, status]);

  useEffect(() => {
    const anchorId = pendingTurnAnchorRef.current;
    if (!anchorId) return;
    const node = viewportRef.current;
    if (!node) return;
    window.requestAnimationFrame(() => {
      const anchor = node.querySelector<HTMLElement>(`[data-agent-row-id="${anchorId}"]`);
      if (!anchor) return;
      const previousItemPeek = 44;
      node.scrollTo({ top: Math.max(0, anchor.offsetTop - previousItemPeek), behavior: "smooth" });
      pendingTurnAnchorRef.current = null;
      setHasUnread(false);
    });
  }, [rows.length]);

  useEffect(() => {
    if (pendingTurnAnchorRef.current) return;
    if (!liveEdge) {
      setHasUnread(true);
      return;
    }
    const node = viewportRef.current;
    if (!node) return;
    window.requestAnimationFrame(() => {
      scrollViewportToEnd(node);
      setHasUnread(false);
    });
  }, [liveEdge, messages, lastResult]);

  const attachClip = useCallback(
    (clip: ClipItem) => {
      setAttachedClipIds((current) => (current.includes(clip.id) ? current : [...current, clip.id].slice(0, DEFAULT_LIMITS.maxItems)));
      setRemovedReferenceIds((current) => {
        const next = new Set(current);
        next.delete(`clip:${clip.id}`);
        return next;
      });
      if (mentionQuery !== null) {
        setInput((current) => replaceMentionQuery(current, getClipTitle(clip)));
      }
      setReferencePickerOpen(false);
      setReferenceSearch("");
      setContextRefreshAt(Date.now());
    },
    [mentionQuery],
  );

  const attachScope = useCallback((scope: AgentReferenceScope) => {
    if (scope === "current") {
      if (activeClip) {
        setRemovedReferenceIds((current) => {
          const next = new Set(current);
          next.delete(`current:${activeClip.id}`);
          return next;
        });
        setScopeRequests((current) => (current.some((request) => request.scope === "current") ? current : [{ scope: "current", createdAt: Date.now() }, ...current]));
        setContextRefreshAt(Date.now());
      }
      setReferencePickerOpen(false);
      setReferenceSearch("");
      return;
    }
    setScopeRequests((current) => (current.some((request) => request.scope === scope) ? current : [...current, { scope, createdAt: Date.now() }]));
    setReferencePickerOpen(false);
    setReferenceSearch("");
    setContextRefreshAt(Date.now());
  }, [activeClip]);

  const removeReference = useCallback((reference: AgentContextReference) => {
    if (reference.source === "current") {
      setScopeRequests((current) => current.filter((request) => request.scope !== "current"));
      setRemovedReferenceIds((current) => new Set([...current, reference.id]));
      return;
    }
    if (reference.source === "favorites" || reference.source === "search-result" || reference.source === "all" || reference.source === "file" || reference.source === "skill-context") {
      setRemovedReferenceIds((current) => new Set([...current, reference.id]));
      return;
    }
    if (reference.clipId) {
      setAttachedClipIds((current) => current.filter((id) => id !== reference.clipId));
    }
  }, []);

  const handleScroll = useCallback(() => {
    const node = viewportRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 36;
    if (!nearBottom) rememberVisibleRow();
    setLiveEdge(nearBottom);
    if (nearBottom) setHasUnread(false);
  }, [rememberVisibleRow]);

  const jumpToLatest = useCallback(() => {
    const node = viewportRef.current;
    if (!node) return;
    scrollViewportToEnd(node);
    setLiveEdge(true);
    setHasUnread(false);
  }, []);

  const startAgentTurn = useCallback(
    async (prompt: string, turnContextSet: AgentContextSet) => {
      const createdAt = Date.now();
      const userMessage: ClipboardAgentUiMessage = {
        id: makeAgentId("user"),
        role: "user",
        parts: [
          { type: "data-context-set", data: turnContextSet },
          { type: "text", text: prompt },
        ],
        metadata: { conversationId: CONVERSATION_ID, createdAt },
      };
      const turnAnchorId = `message:${userMessage.id}`;
      pendingTurnAnchorRef.current = turnAnchorId;
      setConversation((current) => ({
        ...current,
        currentAnchorId: turnAnchorId,
        liveEdgeFollowing: true,
        updatedAt: createdAt,
      }));
      setMessages((current) => [...current, userMessage]);
      setReferencePickerOpen(false);
      setStatus("drafting");
      setLiveEdge(true);
      try {
        const prepared = await invoke<AgentPreparedRunPayload>("agent_prepare_run", {
          input: {
            providerId: activeProviderId,
            prompt,
            contextSet: turnContextSet,
            allowFullContent: allowFullContentForRun,
          },
        });
        setActiveRunId(prepared.run.id);
        setPendingRun({ prompt, prepared, contextSet: turnContextSet, allowFullContent: allowFullContentForRun });
        setMessages((current) => [
          ...current,
          {
            id: `assistant:${prepared.run.id}`,
            role: "assistant",
            parts: [
              { type: "text", text: tr("agent.run.waitingConfirmation", { command: prepared.run.commandPreview }) },
              { type: "data-status", data: { status: "waiting_confirmation", message: prepared.run.providerId } },
            ],
            metadata: { conversationId: prepared.run.conversationId || CONVERSATION_ID, createdAt: Date.now() },
          },
        ]);
        setStatus("waiting_confirmation");
      } catch (error) {
        const text = tr("agent.error.runtimeCallFailed", { error: String(error) });
        setMessages((current) => [
          ...current,
          {
            id: makeAgentId("assistant"),
            role: "assistant",
            parts: [
              { type: "text", text },
              { type: "data-status", data: { status: "failed", message: "runtime-error" } },
            ],
            metadata: { conversationId: CONVERSATION_ID, createdAt: Date.now() },
          },
        ]);
        setStatus("failed");
      }
    },
    [activeProviderId, allowFullContentForRun, tr],
  );

  const retryRunFromRow = useCallback(
    (row: AgentTranscriptRow) => {
      if (status === "drafting" || status === "waiting_confirmation") return;
      const currentIndex = messages.findIndex((message) => message.id === row.messageId);
      const previousUserMessage = messages
        .slice(0, currentIndex >= 0 ? currentIndex : messages.length)
        .reverse()
        .find((message) => message.role === "user");
      if (!previousUserMessage) return;
      const prompt = textPart(previousUserMessage.parts).trim();
      if (!prompt) return;
      void startAgentTurn(prompt, contextSetPart(previousUserMessage.parts) ?? contextSet);
    },
    [contextSet, messages, startAgentTurn, status],
  );

  const confirmPendingRun = useCallback(async () => {
    if (!pendingRun) return;
    const { prompt, prepared, contextSet: preparedContextSet, allowFullContent } = pendingRun;
    preserveVisibleRowDuring(() => {
      setPendingRun(null);
      setStatus("drafting");
    });
    try {
      const started = await invoke<AgentRunPayload>("agent_start_run", {
        input: {
          runId: prepared.run.id,
          providerId: prepared.run.providerId,
          prompt,
          contextSet: preparedContextSet,
          confirmed: true,
          allowFullContent,
        },
      });
      preserveVisibleRowDuring(() => {
        setPermissionMode("summary");
        setMessages((current) =>
          current.map((message) =>
            message.id === `assistant:${started.id}`
              ? {
                  ...message,
                  parts: [
                    {
                      type: "text",
                      text:
                        started.status === "failed"
                          ? started.errorMessage || tr("agent.error.providerUnavailable")
                          : tr("agent.run.runningWithCommand", { command: started.commandPreview }),
                    },
                    { type: "data-status", data: { status: started.status === "failed" ? "failed" : "running", message: started.errorCode ?? started.providerId } },
                  ],
                }
              : message,
          ),
        );
        if (started.status === "failed") {
          setStatus("failed");
          setActiveRunId(null);
        }
      });
    } catch (error) {
      preserveVisibleRowDuring(() => {
        setMessages((current) =>
          current.map((message) =>
            message.id === `assistant:${prepared.run.id}`
              ? {
                  ...message,
                  parts: [
                    { type: "text", text: tr("agent.error.runtimeStartFailed", { error: String(error) }) },
                    { type: "data-status", data: { status: "failed", message: "runtime-error" } },
                  ],
                }
              : message,
          ),
        );
        setStatus("failed");
      });
    }
  }, [pendingRun, preserveVisibleRowDuring, tr]);

  const submit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const prompt = input.trim();
      if (status === "drafting") return;
      if (status === "waiting_confirmation") {
        if (!pendingRun) return;
        if (!prompt || prompt === pendingRun.prompt.trim()) {
          await confirmPendingRun();
          return;
        }
        const runId = pendingRun.prepared.run.id;
        preserveVisibleRowDuring(() => {
          setPendingRun(null);
          setStatus("idle");
          setActiveRunId(null);
          setMessages((current) =>
            current.map((message) =>
              message.id === `assistant:${runId}`
                ? {
                    ...message,
                    parts: [
                      { type: "text", text: tr("agent.run.cancelledPreview") },
                      { type: "data-status", data: { status: "cancelled" } },
                    ],
                  }
                : message,
            ),
          );
        });
        setInput("");
        await startAgentTurn(prompt, contextSet);
        return;
      }
      if (!prompt) return;
      setInput("");
      await startAgentTurn(prompt, contextSet);
    },
    [confirmPendingRun, contextSet, input, pendingRun, preserveVisibleRowDuring, startAgentTurn, status, tr],
  );

  const discardPendingRun = useCallback(() => {
    if (!pendingRun) return;
    const runId = pendingRun.prepared.run.id;
    preserveVisibleRowDuring(() => {
      setPendingRun(null);
      setStatus("idle");
      setActiveRunId(null);
      setMessages((current) =>
        current.map((message) =>
          message.id === `assistant:${runId}`
            ? {
                ...message,
                parts: [
                  { type: "text", text: tr("agent.run.cancelledPreview") },
                  { type: "data-status", data: { status: "cancelled" } },
                ],
              }
            : message,
        ),
      );
    });
  }, [pendingRun, preserveVisibleRowDuring, tr]);

  const replaceInput = useCallback(
    (value: string) => {
      if (pendingRun && status === "waiting_confirmation" && value.trim() && value.trim() !== pendingRun.prompt.trim()) {
        const runId = pendingRun.prepared.run.id;
        preserveVisibleRowDuring(() => {
          setPendingRun(null);
          setStatus("idle");
          setActiveRunId(null);
          setMessages((current) =>
            current.map((message) =>
              message.id === `assistant:${runId}`
                ? {
                    ...message,
                    parts: [
                      { type: "text", text: tr("agent.run.cancelledPreview") },
                      { type: "data-status", data: { status: "cancelled" } },
                    ],
                  }
                : message,
            ),
          );
        });
      }
      setInput(value);
    },
    [pendingRun, preserveVisibleRowDuring, status, tr],
  );

  const cancelRun = useCallback(() => {
    if (!activeRunId) return;
    void invoke<AgentRunPayload>("agent_cancel_run", { runId: activeRunId })
      .then((run) => {
        preserveVisibleRowDuring(() => {
          setStatus("failed");
          setActiveRunId((current) => (current === run.id ? null : current));
          setMessages((current) =>
            current.map((message) =>
              message.id === `assistant:${run.id}`
                ? {
                    ...message,
                    parts: [
                      { type: "text", text: run.output || tr("agent.run.cancelled") },
                      { type: "data-status", data: { status: "cancelled" } },
                    ],
                  }
                : message,
            ),
          );
        });
      })
      .catch(() => undefined);
  }, [activeRunId, preserveVisibleRowDuring, tr]);

  const sourceClip = contextSet.references.find((reference) => reference.clipId)?.clipId
    ? allClips.find((clip) => clip.id === contextSet.references.find((reference) => reference.clipId)?.clipId)
    : null;
  const activeProvider = providers.find((provider) => provider.id === activeProviderId);
  const activeReadiness = providerReadiness.find((item) => item.providerId === activeProviderId);
  const prewarmingProvider = Boolean(activeProviderId && prewarmingProviderId === activeProviderId);
  const suggestedPrompts = useMemo(() => suggestedPromptsForClip(activeClip, tr), [activeClip, tr]);
  const runStatusLabel = prewarmingProvider
    ? tr("agent.provider.prewarming")
    : status === "waiting_confirmation"
      ? tr("agent.run.awaitingConfirm")
      : status === "drafting"
        ? tr("agent.run.streaming")
        : activeReadiness?.status
          ? tr("agent.provider.status", { status: activeReadiness.status })
          : tr("agent.provider.idle");
  const showReferencePopover = referencePickerOpen || (mentionQuery !== null && referenceCandidates.length > 0);
  const referenceScopes = useMemo<AgentReferenceScopeOption[]>(() => {
    const isLocked = status === "drafting" || status === "waiting_confirmation";
    const options = [
      { scope: "current" as const, label: tr("agent.scope.current"), count: activeClip ? 1 : 0, icon: <Clipboard size={11} /> },
      { scope: "selection" as const, label: tr("agent.scope.selection"), count: selectedClips.length, icon: <Check size={11} /> },
      { scope: "favorites" as const, label: tr("agent.scope.favorites"), count: allClips.filter((clip) => clip.favorite && !clip.deletedAt).length, icon: <Heart size={11} /> },
      { scope: "search-result" as const, label: tr("agent.scope.searchResult"), count: filteredClips.filter((clip) => !clip.deletedAt).length, icon: <Search size={11} /> },
      { scope: "all" as const, label: tr("agent.scope.all"), count: allClips.filter((clip) => !clip.deletedAt).length, icon: <Filter size={11} /> },
      { scope: "file" as const, label: tr("agent.scope.file"), count: allClips.filter((clip) => !clip.deletedAt && (clip.payloadKind === "file" || clip.payloadKind === "image")).length, icon: <File size={11} /> },
      { scope: "skill-context" as const, label: tr("agent.scope.skillContext"), count: allClips.filter((clip) => !clip.deletedAt && hasSkillContext(clip)).length, icon: <Tags size={11} /> },
    ];
    return options.map((item) => {
      const active =
        item.scope === "current"
          ? Boolean(activeClip && scopeRequests.some((request) => request.scope === "current") && !removedReferenceIds.has(`current:${activeClip.id}`))
          : scopeRequests.some((request) => request.scope === item.scope);
      const count = Math.min(item.count, DEFAULT_LIMITS.maxItems);
      return {
        ...item,
        count,
        active,
        disabled: !count || active || isLocked,
      };
    });
  }, [activeClip, allClips, filteredClips, removedReferenceIds, scopeRequests, selectedClips.length, status, tr]);

  const runResultAction = useCallback(
    (action: AgentResultAction, text: string) => {
      if (!text) return;
      if (action.type === "copyResult") void onCopyResult(text);
      if (action.type === "pasteResult") void onPasteResult(text);
      if (action.type === "saveAsClip") void onSaveResult(text, { sourceClipId: sourceClip?.id, conversationId: CONVERSATION_ID });
      if (action.type === "favoriteSourceClip" && sourceClip) void onFavoriteClip(sourceClip);
      if (action.type === "archiveSourceClip" && sourceClip) void onArchiveClip(sourceClip);
      if (action.type === "appendTag" && sourceClip) void onAppendTagToSource(sourceClip, "AI");
    },
    [onArchiveClip, onAppendTagToSource, onCopyResult, onFavoriteClip, onPasteResult, onSaveResult, sourceClip],
  );

  return (
    <AgentChatPage
      activeProvider={activeProvider}
      activeProviderId={activeProviderId}
      activeReadiness={activeReadiness}
      canSubmit={
        status !== "drafting" &&
        ((Boolean(input.trim()) && status !== "waiting_confirmation") ||
          (Boolean(pendingRun) && status === "waiting_confirmation"))
      }
      contextReferences={contextSet.references}
      hasUnread={hasUnread}
      input={input}
      liveEdge={liveEdge}
      pendingRun={pendingRun ? { commandPreview: pendingRun.prepared.run.commandPreview, allowFullContent: pendingRun.allowFullContent } : null}
      providers={providers}
      referenceCandidates={referenceCandidates}
      referencePickerOpen={referencePickerOpen}
      referenceScopes={referenceScopes}
      referenceSearch={referenceSearch}
      rows={rows}
      runStatusLabel={runStatusLabel}
      showReferencePopover={showReferencePopover}
      status={status}
      suggestedPrompts={suggestedPrompts}
      viewportRef={viewportRef}
      onAction={runResultAction}
      onAttachClip={attachClip}
      onAttachScope={attachScope}
      onBackToClipboard={onBackToClipboard}
      onBeforeExpand={preserveVisibleRowForDomChange}
      onCancelPreview={discardPendingRun}
      onCloseReferencePicker={() => setReferencePickerOpen(false)}
      onConfirmPendingRun={confirmPendingRun}
      onInputChange={replaceInput}
      onJumpToLatest={jumpToLatest}
      onOpenReference={onOpenReference}
      onPointerReadStart={() => {
        rememberVisibleRow();
        setLiveEdge(false);
      }}
      onReferenceSearchChange={setReferenceSearch}
      onRemoveReference={removeReference}
      onRetry={retryRunFromRow}
      onScroll={handleScroll}
      onSelectProvider={setActiveProviderId}
      onStopRun={cancelRun}
      onSubmit={submit}
      onUseSuggestedPrompt={(prompt) => setInput(prompt)}
      tr={tr}
    />
  );
}
