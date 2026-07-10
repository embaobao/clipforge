import {
  Archive,
  Bot,
  Check,
  Clipboard,
  Copy,
  FileText,
  Heart,
  MessageSquare,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
  Tags,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { ClipItem } from "./App";

type AgentContextReferenceSource =
  | "current"
  | "clip"
  | "favorites"
  | "search-result"
  | "all"
  | "skill-context";

type AgentContextMode = "current" | "selected" | "favorites" | "search-result" | "all" | "skill";

type AgentContextReference = {
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
  permissionScope: "summary" | "current-content";
  itemCount?: number;
  scopeLabel?: string;
};

type AgentContextSet = {
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

type ClipboardAgentMessagePart =
  | { type: "text"; text: string }
  | { type: "data-context-set"; data: AgentContextSet }
  | { type: "data-status"; data: { status: "idle" | "drafting" | "succeeded" | "failed"; message?: string } }
  | { type: "data-result-actions"; data: AgentResultAction[] };

type ClipboardAgentUiMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  parts: ClipboardAgentMessagePart[];
  metadata: {
    conversationId: string;
    createdAt: number;
  };
};

type AgentTranscriptRow = {
  id: string;
  messageId?: string;
  kind: "reference" | "user-message" | "assistant-message" | "run-marker" | "result-actions";
  scrollAnchor: boolean;
  createdAt: number;
  parts: ClipboardAgentMessagePart[];
};

type AgentResultAction = {
  type: "copyResult" | "saveAsClip" | "favoriteSourceClip" | "archiveSourceClip" | "appendTag";
  label: string;
};

type ClipboardPrivateSkill = {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  defaultContextMode: AgentContextMode;
  outputActions: AgentResultAction["type"][];
  createdAt: number;
  updatedAt: number;
};

type ClipboardAgentPanelProps = {
  activeClip: ClipItem | null;
  allClips: ClipItem[];
  filteredClips: ClipItem[];
  selectedClips: ClipItem[];
  query: string;
  onCopyResult: (text: string) => Promise<void> | void;
  onSaveResult: (text: string, context: { sourceClipId?: string; conversationId: string }) => Promise<void>;
  onFavoriteClip: (clip: ClipItem) => Promise<void> | void;
  onArchiveClip: (clip: ClipItem) => Promise<void> | void;
  onBackToClipboard: () => void;
};

const SKILLS_STORAGE_KEY = "clipforge.agent.privateSkills.v1";
const CONVERSATION_ID = "agent-local-conversation";
const DEFAULT_LIMITS = { maxItems: 20, maxCharsPerItem: 480, maxTotalChars: 4000 };

function makeAgentId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function compactText(value: string, max = 160) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function getClipTitle(clip: ClipItem) {
  return clip.analysis.title || clip.analysis.host || compactText(clip.content, 52) || clip.id;
}

function getModeLabel(mode: AgentContextMode) {
  switch (mode) {
    case "current":
      return "当前";
    case "selected":
      return "指定";
    case "favorites":
      return "收藏";
    case "search-result":
      return "搜索";
    case "all":
      return "All";
    case "skill":
      return "Skill";
  }
}

function makeClipReference(clip: ClipItem, source: AgentContextReferenceSource): AgentContextReference {
  return {
    id: `${source}:${clip.id}`,
    source,
    clipId: clip.id,
    title: getClipTitle(clip),
    summary: clip.analysis.summary || compactText(clip.content, 120),
    payloadKind: clip.payloadKind,
    primaryUrl: clip.analysis.url,
    textPreview: compactText(clip.content, 180),
    tags: clip.tags.slice(0, 8),
    sourceAppName: clip.sourceApp?.name || clip.captureContext?.sourceLabel,
    permissionScope: "summary",
  };
}

function summarizeReferences(references: AgentContextReference[]) {
  if (!references.length) return "当前没有可引用的剪贴板上下文。";
  return references
    .map((reference, index) => {
      const tags = reference.tags.length ? ` tags=${reference.tags.join(",")}` : "";
      const url = reference.primaryUrl ? ` url=${reference.primaryUrl}` : "";
      return `${index + 1}. [${reference.source}/${reference.payloadKind}] ${reference.title}${url}${tags}\n   ${reference.summary || reference.textPreview}`;
    })
    .join("\n");
}

function inferSmartHints(references: AgentContextReference[]) {
  const kinds = new Set(references.map((reference) => reference.payloadKind));
  const hasUrl = references.some((reference) => reference.primaryUrl);
  const hints: string[] = [];
  if (hasUrl) hints.push("检测到链接，可优先做文章摘要、收藏说明或打开目标后的分析。");
  if (kinds.has("json")) hints.push("检测到 JSON，可提取字段、校验结构或生成表格摘要。");
  if (kinds.has("code") || kinds.has("command")) hints.push("检测到代码/命令，可分析错误、生成修复步骤或整理为片段。");
  if (kinds.has("image") || kinds.has("file")) hints.push("检测到文件/图片引用，默认只使用元数据，正文或二进制需要授权。");
  if (references.length > 1) hints.push(`当前引用集合包含 ${references.length} 项，适合做批量整理、标签建议或对比摘要。`);
  return hints;
}

function buildLocalDraftResponse(message: string, contextSet: AgentContextSet, skills: ClipboardPrivateSkill[]) {
  const references = contextSet.references;
  const hints = inferSmartHints(references);
  const scope = contextSet.mode === "all" ? "最近剪贴板范围" : getModeLabel(contextSet.mode);
  const skillHint = skills.length
    ? `\n\n可用私域 skill：${skills.slice(0, 3).map((skill) => skill.name).join("、")}。`
    : "";
  return [
    `已基于「${scope}」上下文生成本地草稿。`,
    "",
    `用户请求：${message.trim()}`,
    "",
    "引用摘要：",
    summarizeReferences(references),
    "",
    "建议处理：",
    ...(hints.length ? hints.map((hint) => `- ${hint}`) : ["- 可以先让外部 Agent 基于这些摘要继续分析，或直接保存此草稿到剪贴板。"]),
    "- 结果写回剪贴板前需要点击复制、保存、收藏或归档等显式动作。",
    skillHint,
  ]
    .filter(Boolean)
    .join("\n");
}

function loadPrivateSkills(): ClipboardPrivateSkill[] {
  try {
    const raw = localStorage.getItem(SKILLS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ClipboardPrivateSkill => Boolean(item?.id && item?.name && item?.promptTemplate));
  } catch {
    return [];
  }
}

export function ClipboardAgentPanel({
  activeClip,
  allClips,
  filteredClips,
  selectedClips,
  query,
  onArchiveClip,
  onBackToClipboard,
  onCopyResult,
  onFavoriteClip,
  onSaveResult,
}: ClipboardAgentPanelProps) {
  const [contextMode, setContextMode] = useState<AgentContextMode>("current");
  const [removedReferenceIds, setRemovedReferenceIds] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<ClipboardAgentUiMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "drafting" | "succeeded" | "failed">("idle");
  const [liveEdge, setLiveEdge] = useState(true);
  const [hasUnread, setHasUnread] = useState(false);
  const [lastResult, setLastResult] = useState("");
  const [skills, setSkills] = useState<ClipboardPrivateSkill[]>(() => loadPrivateSkills());
  const [skillDraftName, setSkillDraftName] = useState("");
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const contextSet = useMemo<AgentContextSet>(() => {
    const sourceClips = (() => {
      if (contextMode === "current") return activeClip ? [activeClip] : [];
      if (contextMode === "selected") return selectedClips.length ? selectedClips : activeClip ? [activeClip] : [];
      if (contextMode === "favorites") return allClips.filter((clip) => clip.favorite && !clip.deletedAt).slice(0, DEFAULT_LIMITS.maxItems);
      if (contextMode === "search-result") return filteredClips.filter((clip) => !clip.deletedAt).slice(0, DEFAULT_LIMITS.maxItems);
      if (contextMode === "all") return allClips.filter((clip) => !clip.deletedAt).slice(0, DEFAULT_LIMITS.maxItems);
      return activeClip ? [activeClip] : [];
    })();
    const source: AgentContextReferenceSource =
      contextMode === "current"
        ? "current"
        : contextMode === "selected"
          ? "clip"
          : contextMode === "favorites"
            ? "favorites"
            : contextMode === "search-result"
              ? "search-result"
              : contextMode === "skill"
                ? "skill-context"
                : "all";
    const references = sourceClips
      .map((clip) => makeClipReference(clip, source))
      .filter((reference) => !removedReferenceIds.has(reference.id));
    const scopeLabel =
      contextMode === "search-result"
        ? query.trim() || "当前筛选结果"
        : contextMode === "all"
          ? `最近 ${references.length} 条`
          : getModeLabel(contextMode);
    return {
      id: `ctx_${contextMode}_${references.map((reference) => reference.id).join("_")}`,
      mode: contextMode,
      references: references.map((reference) => ({ ...reference, scopeLabel })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      limits: DEFAULT_LIMITS,
    };
  }, [activeClip, allClips, contextMode, filteredClips, query, removedReferenceIds, selectedClips]);

  const rows = useMemo<AgentTranscriptRow[]>(() => {
    const referenceRow: AgentTranscriptRow = {
      id: `reference:${contextSet.id}`,
      kind: "reference",
      scrollAnchor: false,
      createdAt: contextSet.updatedAt,
      parts: [{ type: "data-context-set", data: contextSet }],
    };
    return [
      referenceRow,
      ...messages.flatMap((message) => {
        const kind = message.role === "user" ? "user-message" : message.role === "assistant" ? "assistant-message" : "run-marker";
        return [{
          id: `message:${message.id}`,
          messageId: message.id,
          kind,
          scrollAnchor: message.role === "user",
          createdAt: message.metadata.createdAt,
          parts: message.parts,
        } satisfies AgentTranscriptRow];
      }),
    ];
  }, [contextSet, messages]);

  const resultActions: AgentResultAction[] = useMemo(
    () => [
      { type: "copyResult", label: "复制结果" },
      { type: "saveAsClip", label: "保存为剪贴板" },
      { type: "favoriteSourceClip", label: "收藏来源" },
      { type: "archiveSourceClip", label: "归档来源" },
      { type: "appendTag", label: "追加 AI 标签" },
    ],
    [],
  );

  useEffect(() => {
    if (!liveEdge) {
      setHasUnread(true);
      return;
    }
    const node = viewportRef.current;
    if (!node) return;
    window.requestAnimationFrame(() => {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
      setHasUnread(false);
    });
  }, [liveEdge, rows.length, lastResult]);

  const handleScroll = useCallback(() => {
    const node = viewportRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 36;
    setLiveEdge(nearBottom);
    if (nearBottom) setHasUnread(false);
  }, []);

  const jumpToLatest = useCallback(() => {
    const node = viewportRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    setLiveEdge(true);
    setHasUnread(false);
  }, []);

  const submit = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      const prompt = input.trim();
      if (!prompt || status === "drafting") return;
      const createdAt = Date.now();
      const userMessage: ClipboardAgentUiMessage = {
        id: makeAgentId("user"),
        role: "user",
        parts: [
          { type: "data-context-set", data: contextSet },
          { type: "text", text: prompt },
        ],
        metadata: { conversationId: CONVERSATION_ID, createdAt },
      };
      setMessages((current) => [...current, userMessage]);
      setInput("");
      setStatus("drafting");
      setLiveEdge(true);
      window.setTimeout(() => {
        const text = buildLocalDraftResponse(prompt, contextSet, skills);
        setLastResult(text);
        setMessages((current) => [
          ...current,
          {
            id: makeAgentId("assistant"),
            role: "assistant",
            parts: [
              { type: "text", text },
              { type: "data-result-actions", data: resultActions },
            ],
            metadata: { conversationId: CONVERSATION_ID, createdAt: Date.now() },
          },
        ]);
        setStatus("succeeded");
      }, 420);
    },
    [contextSet, input, resultActions, skills, status],
  );

  const saveSkillDraft = useCallback(() => {
    const name = skillDraftName.trim() || `剪贴板处理 ${skills.length + 1}`;
    const now = Date.now();
    const skill: ClipboardPrivateSkill = {
      id: makeAgentId("skill"),
      name,
      description: `${getModeLabel(contextMode)}上下文处理模板`,
      promptTemplate: input.trim() || "请基于当前 ClipForge 上下文集合完成整理、摘要或回填建议。",
      defaultContextMode: contextMode,
      outputActions: ["copyResult", "saveAsClip"],
      createdAt: now,
      updatedAt: now,
    };
    const next = [skill, ...skills].slice(0, 20);
    setSkills(next);
    localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(next));
    setSkillDraftName("");
  }, [contextMode, input, skillDraftName, skills]);

  const runSkill = useCallback((skill: ClipboardPrivateSkill) => {
    setInput(skill.promptTemplate);
    window.setTimeout(() => {
      const form = document.querySelector<HTMLFormElement>(".agent-composer");
      form?.requestSubmit();
    }, 0);
  }, []);

  const sourceClip = contextSet.references.find((reference) => reference.clipId)?.clipId
    ? allClips.find((clip) => clip.id === contextSet.references.find((reference) => reference.clipId)?.clipId)
    : null;

  return (
    <section className="agent-panel" aria-label="剪贴板 Agent 工作面板">
      <div className="agent-panel-head">
        <div>
          <span><Bot size={13} />Agent</span>
          <strong>剪贴板工作面板</strong>
        </div>
        <button className="icon-button subtle" onClick={onBackToClipboard} type="button" aria-label="返回剪贴板">
          <Clipboard size={13} />
        </button>
      </div>

      <div className="agent-context-bar" aria-label="上下文引用篮">
        <div className="agent-context-modes" role="tablist" aria-label="引用范围">
          {(["current", "selected", "favorites", "search-result", "all"] as AgentContextMode[]).map((mode) => (
            <button
              aria-selected={contextMode === mode}
              className={contextMode === mode ? "active" : ""}
              key={mode}
              onClick={() => {
                setContextMode(mode);
                setRemovedReferenceIds(new Set());
              }}
              role="tab"
              type="button"
            >
              {getModeLabel(mode)}
            </button>
          ))}
        </div>
        <div className="agent-reference-list">
          {contextSet.references.length ? (
            contextSet.references.slice(0, 6).map((reference) => (
              <span className="agent-reference-chip" key={reference.id} title={reference.summary || reference.textPreview}>
                <FileText size={11} />
                <span>{reference.title}</span>
                <em>{reference.permissionScope}</em>
                <button
                  aria-label={`移除引用 ${reference.title}`}
                  onClick={() => setRemovedReferenceIds((current) => new Set([...current, reference.id]))}
                  type="button"
                >
                  <X size={10} />
                </button>
              </span>
            ))
          ) : (
            <span className="agent-reference-empty">没有可用引用</span>
          )}
        </div>
      </div>

      <div className="agent-capability-strip" aria-label="ClipForge 能力入口">
        <button type="button" onClick={() => setInput("帮我总结当前引用，并给出可保存到剪贴板的摘要。")}>
          <Sparkles size={12} />摘要
        </button>
        <button type="button" onClick={() => setInput("根据当前引用建议 3 个标签，并说明原因。")}>
          <Tags size={12} />标签
        </button>
        <button type="button" onClick={() => setInput("分析当前引用里最适合下钻处理的链接、文件路径、JSON 字段或错误信息。")}>
          <Search size={12} />解析
        </button>
        <button type="button" onClick={saveSkillDraft}>
          <Wrench size={12} />存 Skill
        </button>
      </div>

      <div className="agent-message-scroller">
        <div className="agent-message-viewport" aria-label="Agent messages" onScroll={handleScroll} ref={viewportRef} tabIndex={0}>
          <div className="agent-message-content" aria-busy={status === "drafting"}>
            {rows.map((row) => (
              <AgentMessageRow key={row.id} row={row} />
            ))}
            {status === "drafting" ? (
              <div className="agent-row run-marker" role="status">
                <RefreshCw size={12} />
                <span>正在生成本地草稿，真实 Agent provider 将走后台 runtime 接入。</span>
              </div>
            ) : null}
          </div>
        </div>
        {hasUnread || !liveEdge ? (
          <button className="agent-jump-latest" onClick={jumpToLatest} type="button">
            <MessageSquare size={12} />跳到最新
          </button>
        ) : null}
      </div>

      {lastResult ? (
        <div className="agent-result-actions" aria-label="结果动作">
          <button type="button" onClick={() => void onCopyResult(lastResult)}>
            <Copy size={12} />复制
          </button>
          <button type="button" onClick={() => void onSaveResult(lastResult, { sourceClipId: sourceClip?.id, conversationId: CONVERSATION_ID })}>
            <Save size={12} />保存
          </button>
          <button disabled={!sourceClip} type="button" onClick={() => sourceClip && void onFavoriteClip(sourceClip)}>
            <Heart size={12} />收藏来源
          </button>
          <button disabled={!sourceClip} type="button" onClick={() => sourceClip && void onArchiveClip(sourceClip)}>
            <Archive size={12} />归档来源
          </button>
        </div>
      ) : null}

      {skills.length ? (
        <div className="agent-private-skills" aria-label="私域剪贴板 skill">
          {skills.slice(0, 3).map((skill) => (
            <button key={skill.id} onClick={() => runSkill(skill)} type="button">
              <Check size={11} />
              <span>{skill.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      <form className="agent-composer" onSubmit={submit}>
        <input
          aria-label="私域 skill 名称"
          onChange={(event) => setSkillDraftName(event.currentTarget.value)}
          placeholder="Skill 名称"
          value={skillDraftName}
        />
        <textarea
          aria-label="Agent 请求"
          onChange={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
          }}
          placeholder="引用已附带。输入要让 Agent 处理的问题，Cmd/Ctrl+Enter 发送。"
          rows={2}
          value={input}
        />
        <button disabled={!input.trim() || status === "drafting" || contextSet.references.length === 0} type="submit">
          <Send size={13} />
          发送
        </button>
      </form>
    </section>
  );
}

function AgentMessageRow({ row }: { row: AgentTranscriptRow }) {
  if (row.kind === "reference") {
    const context = row.parts.find((part): part is { type: "data-context-set"; data: AgentContextSet } => part.type === "data-context-set")?.data;
    if (!context) return null;
    return (
      <div className="agent-row reference">
        <span>引用集合</span>
        <strong>{getModeLabel(context.mode)} · {context.references.length} 项</strong>
        <em>默认 summary，最多 {context.limits.maxItems} 项</em>
      </div>
    );
  }
  const text = row.parts.find((part): part is { type: "text"; text: string } => part.type === "text")?.text ?? "";
  return (
    <div className={`agent-row ${row.kind}`}>
      <span>{row.kind === "user-message" ? "你" : "Agent"}</span>
      <pre>{text}</pre>
    </div>
  );
}
