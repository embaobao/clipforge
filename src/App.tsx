import {
  Archive,
  Check,
  CheckSquare,
  Clipboard,
  Copy,
  Database,
  ExternalLink,
  Eye,
  FileCode,
  FileText,
  Heart,
  History,
  Image,
  Inbox,
  Layers3,
  Paperclip,
  Plus,
  Search,
  Settings,
  Square,
  Star,
  Tag,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import type { ErrorInfo, PointerEvent } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Kbd } from "@/components/ui/kbd";
import "./App.css";

type ClipKind = "text" | "code" | "link" | "markdown" | "command" | "attachment";
type ClipBucket = "history" | "archive" | "snippet";
type ViewKey = "quick" | "history" | "favorites" | "archive" | "snippets" | "folders" | "settings";
type PanelDensity = "dense" | "normal" | "comfortable";
type TagMode = "similar" | "rules" | "off";
type ContentDisplayMode = "summary" | "middle" | "raw";

type ContentSource =
  | "github"
  | "gitlab"
  | "command"
  | "markdown"
  | "code"
  | "image"
  | "file"
  | "link"
  | "text";

type AttachmentInfo = {
  name: string;
  description: string;
  target: string;
  targetType: "url" | "path";
  isImage: boolean;
};

type ClipAnalysis = {
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

type ClipItem = {
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
};

type PanelUiState = {
  previewClip: ClipItem | null;
  isPreviewOpen: boolean;
  isClosing: boolean;
  setPreviewClip: (clip: ClipItem | null) => void;
  setPreviewOpen: (isOpen: boolean) => void;
  setClosing: (isClosing: boolean) => void;
};

const usePanelUiStore = create<PanelUiState>()((set) => ({
  previewClip: null,
  isPreviewOpen: false,
  isClosing: false,
  setPreviewClip: (previewClip) => set({ previewClip }),
  setPreviewOpen: (isPreviewOpen) => set({ isPreviewOpen }),
  setClosing: (isClosing) => set({ isClosing }),
}));

type NativeClipboard = {
  text: string | null;
};

type TagRule = {
  id: string;
  label: string;
  query: string;
};

type AppSettings = {
  panelDensity: PanelDensity;
  quickItemLimit: number;
  maxStoredItems: number;
  clipboardPollMs: number;
  tagMode: TagMode;
  tagRules: TagRule[];
  contentDisplayMode: ContentDisplayMode;
  showSourceBadges: boolean;
  enableMarkdownPreview: boolean;
  globalShortcut: string;
  copyPreviewEnabled: boolean;
  cleanupEnabled: boolean;
  cleanupIntervalHours: number;
  softDeletedRetentionDays: number;
};

type UserSettingsPayload = {
  path: string;
  settings: Partial<AppSettings>;
};

type DbInitPayload = {
  path: string;
  schemaVersion: number;
};

type AccessibilityPermissionPayload = {
  status: "granted" | "missing" | "unsupported";
  canReadFocusedInput: boolean;
  message: string;
};

type CaptureClipPayload = {
  status: "created" | "promoted";
  item: ClipItem;
};

type QueryClipPayload = {
  items: ClipItem[];
  nextCursor?: string;
  limit: number;
};

const ACTIVE_VIEW_KEY = "clipforge.active-view.v1";
const LEGACY_DEFAULT_SHORTCUT = "CommandOrControl+Shift+V";
const DEFAULT_SHORTCUT = "Control+V";
const ROW_HEIGHT = 88;
const OVERSCAN = 5;

const defaultSettings: AppSettings = {
  panelDensity: "dense",
  quickItemLimit: 10,
  maxStoredItems: 500,
  clipboardPollMs: 900,
  tagMode: "similar",
  tagRules: [],
  contentDisplayMode: "summary",
  showSourceBadges: false,
  enableMarkdownPreview: true,
  globalShortcut: DEFAULT_SHORTCUT,
  copyPreviewEnabled: true,
  cleanupEnabled: true,
  cleanupIntervalHours: 24,
  softDeletedRetentionDays: 30,
};

const tagModeLabels: Record<TagMode, string> = {
  similar: "仅类型",
  rules: "类型 + 自定义搜索",
  off: "关闭",
};

const densityLabels: Record<PanelDensity, string> = {
  dense: "紧凑",
  normal: "标准",
  comfortable: "舒展",
};

const displayModeLabels: Record<ContentDisplayMode, string> = {
  summary: "智能摘要",
  middle: "中间省略",
  raw: "原文优先",
};

const navItems: Array<{ key: ViewKey; label: string; icon: typeof History }> = [
  { key: "history", label: "历史", icon: History },
  { key: "favorites", label: "收藏", icon: Heart },
];

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function middleEllipsis(value: string, head = 34, tail = 14) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= head + tail + 3) return normalized;
  return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`;
}

function extractFirstUrl(content: string) {
  const match = content.match(/https?:\/\/[^\s<>"')\]]+/i);
  return match?.[0];
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

function detectAttachment(content: string): AttachmentInfo | null {
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

function analyzeContent(content: string): ClipAnalysis {
  const normalized = content.replace(/\s+/g, " ").trim();
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
  if (isMarkdownLike(content)) {
    return {
      source: "markdown",
      sourceName: "Markdown",
      badge: "MD",
      title: normalized.replace(/^#{1,6}\s*/, "").slice(0, 48) || "Markdown",
      summary: middleEllipsis(normalized, 56, 12),
      isMarkdown: true,
    };
  }
  if (isCodeLike(content)) {
    return {
      source: "code",
      sourceName: "Code",
      badge: "{}",
      title: normalized.slice(0, 48) || "Code",
      summary: middleEllipsis(normalized, 56, 12),
      isMarkdown: false,
    };
  }
  return {
    source: "text",
    sourceName: "Text",
    badge: "T",
    title: normalized.slice(0, 48) || "Text",
    summary: middleEllipsis(normalized, 56, 12),
    isMarkdown: false,
  };
}

function detectKind(content: string): ClipKind {
  const analysis = analyzeContent(content);
  if (analysis.attachment) return "attachment";
  if (analysis.source === "github" || analysis.source === "gitlab" || analysis.source === "link") {
    return "link";
  }
  if (analysis.source === "command") return "command";
  if (analysis.source === "markdown") return "markdown";
  if (analysis.source === "code") return "code";
  return "text";
}

function generateTags(content: string, settings: AppSettings): string[] {
  if (settings.tagMode === "off") return [];
  const analysis = analyzeContent(content);
  return getTypeTags(analysis);
}

function getTypeTags(analysis: ClipAnalysis): string[] {
  if (analysis.attachment) return [analysis.attachment.isImage ? "图片" : "资源"];
  if (analysis.source === "github" || analysis.source === "gitlab" || analysis.source === "link") return ["链接"];
  if (analysis.source === "command") return ["命令"];
  if (analysis.source === "markdown") return ["Markdown"];
  if (analysis.source === "code") return ["代码"];
  return ["文本"];
}

function getSearchHaystack(item: ClipItem) {
  return [
    item.content,
    item.source,
    item.kind,
    item.bucket,
    item.analysis.title,
    item.analysis.summary,
    item.analysis.host,
    item.tags.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

function matchesSavedSearch(item: ClipItem, rule: TagRule) {
  const terms = rule.query
    .split(/[\s,，]+/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  if (!rule.label.trim() || !terms.length) return false;
  const haystack = getSearchHaystack(item);
  return terms.some((term) => haystack.includes(term));
}

function createClip(content: string, settings: AppSettings): ClipItem {
  const now = Date.now();
  const analysis = analyzeContent(content);
  return {
    id: makeId(),
    content,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    source: analysis.sourceName,
    kind: detectKind(content),
    bucket: "history",
    favorite: false,
    tags: generateTags(content, settings),
    copyCount: 0,
    analysis,
  };
}

function mergeSettings(value: Partial<AppSettings> | null | undefined): AppSettings {
  const next = { ...defaultSettings, ...(value ?? {}) };
  const globalShortcut = next.globalShortcut?.trim();
  return {
    ...next,
    quickItemLimit: clampNumber(next.quickItemLimit, 4, 30, defaultSettings.quickItemLimit),
    maxStoredItems: clampNumber(next.maxStoredItems, 50, 5000, defaultSettings.maxStoredItems),
    clipboardPollMs: clampNumber(next.clipboardPollMs, 500, 5000, defaultSettings.clipboardPollMs),
    cleanupIntervalHours: clampNumber(
      next.cleanupIntervalHours,
      1,
      720,
      defaultSettings.cleanupIntervalHours,
    ),
    softDeletedRetentionDays: clampNumber(
      next.softDeletedRetentionDays,
      1,
      365,
      defaultSettings.softDeletedRetentionDays,
    ),
    tagRules: Array.isArray(next.tagRules) ? next.tagRules : defaultSettings.tagRules,
    globalShortcut: !globalShortcut || globalShortcut === LEGACY_DEFAULT_SHORTCUT ? DEFAULT_SHORTCUT : globalShortcut,
  };
}

function clampNumber(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeClip(raw: Partial<ClipItem>, settings: AppSettings): ClipItem | null {
  if (typeof raw.content !== "string" || !raw.content.trim()) return null;
  const createdAt = typeof raw.createdAt === "number" ? raw.createdAt : Date.now();
  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : createdAt;
  const lastSeenAt = typeof raw.lastSeenAt === "number" ? raw.lastSeenAt : updatedAt;
  const analysis = analyzeContent(raw.content);
  return {
    id: typeof raw.id === "string" ? raw.id : makeId(),
    content: raw.content,
    createdAt,
    updatedAt,
    lastSeenAt,
    lastCopiedAt: typeof raw.lastCopiedAt === "number" ? raw.lastCopiedAt : undefined,
    source: analysis.sourceName,
    kind: detectKind(raw.content),
    bucket:
      raw.bucket === "archive" || raw.bucket === "snippet" || raw.bucket === "history"
        ? raw.bucket
        : "history",
    favorite: Boolean(raw.favorite),
    tags: generateTags(raw.content, settings),
    copyCount: typeof raw.copyCount === "number" ? raw.copyCount : 0,
    analysis,
  };
}

function loadLocalSettings(): AppSettings {
  return defaultSettings;
}

function retagClips(clips: ClipItem[], settings: AppSettings) {
  return clips.map((clip) => {
    const analysis = analyzeContent(clip.content);
    return {
      ...clip,
      analysis,
      source: analysis.sourceName,
      kind: detectKind(clip.content),
      tags: generateTags(clip.content, settings),
      updatedAt: Date.now(),
    };
  });
}

function formatTime(timestamp: number) {
  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  if (diff < minute) return "刚刚";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function getBucketForView(view: ViewKey): ClipBucket | null {
  if (view === "archive") return "archive";
  if (view === "snippets") return "snippet";
  if (view === "history") return "history";
  if (view === "favorites") return null;
  return null;
}

function getDisplayText(item: ClipItem, settings: AppSettings) {
  if (settings.contentDisplayMode === "raw") return item.content.replace(/\s+/g, " ").trim();
  if (settings.contentDisplayMode === "middle") return middleEllipsis(item.content);
  return item.analysis.summary || middleEllipsis(item.content);
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

function formatShortcutParts(shortcut: string) {
  return shortcut
    .replace(/CommandOrControl/gi, "⌘/Ctrl")
    .replace(/CmdOrControl/gi, "⌘/Ctrl")
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
}

function shortcutFromKeyboardEvent(event: KeyboardEvent<HTMLElement>) {
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (["Meta", "Control", "Alt", "Shift"].includes(key)) return "";
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("CommandOrControl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key.replace(" ", "Space"));
  return parts.join("+");
}

function makeRuleLabel(value: string) {
  return value
    .replace(/^https?:\/\//i, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ")
    .slice(0, 18);
}

function logAppError(level: "info" | "warn" | "error", message: string, context?: unknown) {
  const contextText =
    typeof context === "string" ? context : context ? JSON.stringify(context).slice(0, 2000) : "";
  invoke("append_app_log", { level, message, context: contextText }).catch(() => {
    if (level === "error") console.error(message, context);
  });
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError("error", error.message, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-fallback">
          <Clipboard size={28} />
          <h1>ClipForge 界面已进入兜底模式</h1>
          <p>错误已写入本地日志文件。可以重启应用继续使用剪贴板采集。</p>
          <button className="primary-button" onClick={() => window.location.reload()} type="button">
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ClipForgeApp() {
  const isSettingsWindow = useMemo(
    () => new URLSearchParams(window.location.search).get("window") === "settings",
    [],
  );
  const initialSettings = useMemo(loadLocalSettings, []);
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>(() => {
    const stored = localStorage.getItem(ACTIVE_VIEW_KEY) as ViewKey | null;
    return stored && (stored === "history" || stored === "favorites") ? stored : "history";
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [nativeStatus, setNativeStatus] = useState("准备监听剪贴板");
  const [lastCopiedId, setLastCopiedId] = useState<string | null>(null);
  const [, setIsReadingClipboard] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const [configStatus, setConfigStatus] = useState("配置文件待连接");
  const [databasePath, setDatabasePath] = useState("");
  const [accessibility, setAccessibility] = useState<AccessibilityPermissionPayload | null>(null);
  const [compactPanel, setCompactPanel] = useState(() => window.innerWidth <= 900);
  const [isPanelEntering, setIsPanelEntering] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 120);
  const clipsRef = useRef<ClipItem[]>(clips);
  const settingsRef = useRef<AppSettings>(settings);
  const configReadyRef = useRef(false);
  const lastSeenClipboard = useRef("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const isPanelClosing = usePanelUiStore((state) => state.isClosing);
  const setPanelClosing = usePanelUiStore((state) => state.setClosing);
  const previewClip = usePanelUiStore((state) => state.previewClip);
  const setPreviewClip = usePanelUiStore((state) => state.setPreviewClip);

  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  const appendLoadedClips = useCallback((items: ClipItem[], cursor?: string | null) => {
    setClips((current) => {
      const seen = new Set(current.map((item) => item.id));
      const next = [
        ...current,
        ...items.filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        }),
      ].slice(0, settingsRef.current.maxStoredItems);
      clipsRef.current = next;
      return next;
    });
    setNextCursor(cursor ?? null);
  }, []);

  const loadMoreClips = useCallback(async () => {
    if (!nextCursor || isLoadingMore || debouncedQuery.trim() || activeTag) return;
    setIsLoadingMore(true);
    try {
      const payload = await invoke<QueryClipPayload>("query_clip_records", {
        text: "",
        bucket: "all",
        limit: 200,
        cursor: nextCursor,
      });
      const items = payload.items
        .map((item) => normalizeClip(item, settingsRef.current))
        .filter((item): item is ClipItem => Boolean(item));
      appendLoadedClips(items, payload.nextCursor ?? null);
      setNativeStatus(payload.nextCursor ? `已加载 ${clipsRef.current.length} 条` : `已加载全部 ${clipsRef.current.length} 条`);
    } catch (error) {
      logAppError("warn", "Load more clip records failed", String(error));
      setNativeStatus("加载更多剪贴板失败，查看日志");
    } finally {
      setIsLoadingMore(false);
    }
  }, [activeTag, appendLoadedClips, debouncedQuery, isLoadingMore, nextCursor]);

  useEffect(() => {
    settingsRef.current = settings;
    if (configReadyRef.current) {
      invoke("write_user_settings", { settings })
        .then(() => setConfigStatus("配置已同步到 JSON5"))
        .catch(() => setConfigStatus("浏览器预览模式：配置文件在 Tauri 中同步"));
    }
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_VIEW_KEY, activeView);
  }, [activeView]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (isSettingsWindow) return;
    const appWindow = getCurrentWindow();
    let hideTimer: number | null = null;
    let closeTimer: number | null = null;
    const cancelHide = () => {
      if (hideTimer) window.clearTimeout(hideTimer);
      if (closeTimer) window.clearTimeout(closeTimer);
      hideTimer = null;
      closeTimer = null;
      setPanelClosing(false);
    };
    appWindow
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          cancelHide();
          return;
        }
        cancelHide();
        hideTimer = window.setTimeout(() => {
          setPanelClosing(true);
          closeTimer = window.setTimeout(() => {
            appWindow.hide().catch((error) => logAppError("warn", "Hide quick panel failed", String(error)));
            setPanelClosing(false);
          }, 180);
        }, 900);
      })
      .catch((error) => logAppError("warn", "Register focus listener failed", String(error)));
    return cancelHide;
  }, [isSettingsWindow, setPanelClosing]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const syncCompactPanel = () => setCompactPanel(media.matches);
    syncCompactPanel();
    media.addEventListener("change", syncCompactPanel);
    return () => media.removeEventListener("change", syncCompactPanel);
  }, []);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      logAppError("error", event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      logAppError("error", "Unhandled promise rejection", String(event.reason));
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<AccessibilityPermissionPayload>("check_accessibility_permission")
      .then((payload) => {
        if (cancelled) return;
        setAccessibility(payload);
        if (!payload.canReadFocusedInput) {
          setNativeStatus("辅助功能未授权，面板会贴到鼠标所在屏幕右侧");
        }
      })
      .catch((error) => logAppError("warn", "Check accessibility permission failed", String(error)));
    invoke<DbInitPayload>("init_clip_database")
      .then((payload) => {
        if (cancelled) return;
        setDatabasePath(payload.path);
        return invoke<QueryClipPayload>("query_clip_records", {
          text: "",
          bucket: "all",
          limit: 200,
        });
      })
      .then((payload) => {
        if (!payload || cancelled) return;
        const items = payload.items
          .map((item) => normalizeClip(item, settingsRef.current))
          .filter((item): item is ClipItem => Boolean(item));
        setClips(items);
        clipsRef.current = items;
        setNextCursor(payload.nextCursor ?? null);
      })
      .catch((error) => {
        if (cancelled) return;
        logAppError("error", "Initialize clip database failed", String(error));
        setNativeStatus("数据库初始化失败，查看日志");
      });
    invoke<UserSettingsPayload>("read_user_settings")
      .then((payload) => {
        if (cancelled) return;
        const merged = mergeSettings(payload.settings);
        setConfigPath(payload.path);
        setConfigStatus("已加载用户目录 JSON5 配置");
        configReadyRef.current = true;
        setSettings(merged);
        setClips((items) => retagClips(items, merged).slice(0, merged.maxStoredItems));
      })
      .catch(() => {
        if (cancelled) return;
        setConfigStatus("浏览器预览模式：配置文件在 Tauri 中启用");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const promoteClipboardText = useCallback(async (text: string) => {
    const now = Date.now();
    const payload = await invoke<CaptureClipPayload>("capture_clip_record", {
      content: text,
      sourceLabel: "Clipboard",
      observedAt: now,
    });
    const nextClip = normalizeClip(payload.item, settingsRef.current) ?? createClip(text, settingsRef.current);
    const current = clipsRef.current.filter((item) => item.id !== nextClip.id);
    const next = [nextClip, ...current].slice(0, settingsRef.current.maxStoredItems);
    clipsRef.current = next;
    setClips(next);
    setSelectedId(nextClip.id);
    setActiveView("history");
    return payload.status;
  }, []);

  const captureClipboard = useCallback(
    async (reason: "startup" | "manual" | "poll" | "shortcut") => {
      if (reason === "manual") {
        setIsReadingClipboard(true);
        setNativeStatus("正在读取系统剪贴板");
      }
      try {
        const response = await invoke<NativeClipboard>("read_clipboard_text");
        const text = response.text?.trim();
        if (!text) {
          setNativeStatus("剪贴板为空或不是文本");
          return;
        }
        if (reason === "poll" && text === lastSeenClipboard.current) {
          setNativeStatus("正在监听剪贴板");
          return;
        }
        lastSeenClipboard.current = text;
        const result = await promoteClipboardText(text);
        if (result === "created") {
          setNativeStatus(reason === "startup" ? "启动已捕获系统剪贴板" : "已记录当前系统剪贴板");
        } else {
          setNativeStatus("当前系统剪贴板已置顶");
        }
      } catch {
        setNativeStatus("浏览器预览模式：原生剪贴板在 Tauri 中启用");
      } finally {
        if (reason === "manual") setIsReadingClipboard(false);
      }
    },
    [promoteClipboardText],
  );

  const showQuickPanel = useCallback(
    async (reason: "shortcut" | "tray") => {
      setActiveView("history");
      setSelectedIds(new Set());
      setMultiSelectMode(false);
      setActiveTag(null);
      setIsPanelEntering(true);
      window.setTimeout(() => setIsPanelEntering(false), 180);
      window.setTimeout(() => searchRef.current?.focus(), 20);
      setNativeStatus(reason === "tray" ? "已从系统状态栏打开快捷面板" : "已打开快捷面板");
    },
    [],
  );

  const handleWindowDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, textarea, select, a, [role='menuitem']")) return;
    getCurrentWindow()
      .startDragging()
      .catch((error) => logAppError("warn", "Start window dragging failed", String(error)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    captureClipboard("startup");
    const timer = window.setInterval(() => {
      if (!cancelled) captureClipboard("poll");
    }, settings.clipboardPollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [captureClipboard, settings.clipboardPollMs]);

  useEffect(() => {
    if (!settings.cleanupEnabled) return;
    const runCleanup = () => {
      invoke("cleanup_clip_records", { retentionDays: settings.softDeletedRetentionDays })
        .then(() => logAppError("info", "Cleanup completed"))
        .catch((error) => logAppError("warn", "Cleanup failed", String(error)));
    };
    const timer = window.setInterval(runCleanup, settings.cleanupIntervalHours * 60 * 60 * 1000);
    runCleanup();
    return () => window.clearInterval(timer);
  }, [settings.cleanupEnabled, settings.cleanupIntervalHours, settings.softDeletedRetentionDays]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisteners: Array<() => void> = [];
    appWindow
      .listen<string>("clipforge://show-quick-panel", ({ payload }) => {
        showQuickPanel(payload === "tray" ? "tray" : "shortcut");
      })
      .then((unlisten) => unlisteners.push(unlisten))
      .catch((error) => logAppError("warn", "Register tray listener failed", String(error)));
    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [showQuickPanel]);

  const filteredClips = useMemo(() => {
    const normalized = normalizeSearch(debouncedQuery);
    const bucket = getBucketForView(activeView);
    const bucketSource = bucket ? clips.filter((item) => item.bucket === bucket) : clips;
    const source = activeView === "favorites" ? bucketSource.filter((item) => item.favorite) : bucketSource;
    const activeSavedSearch = activeTag
      ? settings.tagRules.find((rule) => rule.label.trim() === activeTag)
      : undefined;
    return source.filter((item) => {
      const haystack = getSearchHaystack(item);
      const matchesQuery = normalized ? haystack.includes(normalized) : true;
      const matchesTag = activeTag
        ? item.tags.includes(activeTag) || Boolean(activeSavedSearch && matchesSavedSearch(item, activeSavedSearch))
        : true;
      return matchesQuery && matchesTag;
    });
  }, [activeTag, activeView, clips, debouncedQuery, settings.tagRules]);

  const quickTags = useMemo(() => {
    const counts = new Map<string, number>();
    clips.forEach((item) => {
      item.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
    });
    const typeTags = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
      .slice(0, 4);
    const savedSearches = settings.tagRules
      .map((rule) => [rule.label.trim(), clips.filter((item) => matchesSavedSearch(item, rule)).length] as [string, number])
      .filter(([label, count]) => label && count > 0)
      .slice(0, 3);
    return [...typeTags, ...savedSearches].slice(0, 6);
  }, [clips, settings.tagRules]);

  const selectedClip = useMemo(() => {
    if (selectedId) {
      const found = clips.find((item) => item.id === selectedId);
      if (found) return found;
    }
    return filteredClips[0] ?? null;
  }, [clips, filteredClips, selectedId]);

  const detailClip = previewClip && clips.some((item) => item.id === previewClip.id) ? previewClip : selectedClip;

  useEffect(() => {
    if (!selectedClip) {
      setSelectedId(null);
      setPreviewClip(null);
      return;
    }
    setSelectedId(selectedClip.id);
    if (!previewClip || !clips.some((item) => item.id === previewClip.id)) {
      setPreviewClip(selectedClip);
    }
  }, [clips, previewClip, selectedClip, setPreviewClip]);

  const selectedInList = useMemo(() => {
    return filteredClips.filter((item) => selectedIds.has(item.id));
  }, [filteredClips, selectedIds]);

  async function copyClip(item: ClipItem) {
    try {
      await invoke("write_clipboard_text", { text: item.content });
      lastSeenClipboard.current = item.content.trim();
      setNativeStatus("已复制到系统剪贴板");
    } catch {
      await navigator.clipboard.writeText(item.content);
      setNativeStatus("已复制到浏览器剪贴板");
    }
    const now = Date.now();
    setLastCopiedId(item.id);
    invoke("update_clip_record", { input: { id: item.id, copied: true } }).catch((error) =>
      logAppError("warn", "Update copied state failed", String(error)),
    );
    setSelectedId(item.id);
    setClips((current) => {
      const base = current.find((clip) => clip.id === item.id) ?? item;
      const updated = {
        ...base,
        copyCount: base.copyCount + 1,
        lastCopiedAt: now,
        updatedAt: now,
      };
      const next = current
        .map((clip) => (clip.id === item.id ? updated : clip))
        .slice(0, settingsRef.current.maxStoredItems);
      clipsRef.current = next;
      return next;
    });
    window.setTimeout(() => setLastCopiedId(null), 1000);
  }

  async function copySelectedClips(items: ClipItem[]) {
    if (!items.length) {
      setNativeStatus("先选择需要聚合复制的内容");
      return;
    }
    const text = items.map((item) => item.content).join("\n\n");
    try {
      await invoke("write_clipboard_text", { text });
      lastSeenClipboard.current = text.trim();
      setNativeStatus(`已聚合复制 ${items.length} 条`);
    } catch {
      await navigator.clipboard.writeText(text);
      setNativeStatus(`已聚合复制 ${items.length} 条到浏览器剪贴板`);
    }
    const now = Date.now();
    setLastCopiedId(items[0]?.id ?? null);
    items.forEach((item) => {
      invoke("update_clip_record", { input: { id: item.id, copied: true } }).catch((error) =>
        logAppError("warn", "Update aggregated copied state failed", String(error)),
      );
    });
    setClips((current) =>
      current.map((clip) =>
        items.some((item) => item.id === clip.id)
          ? {
              ...clip,
              copyCount: clip.copyCount + 1,
              lastCopiedAt: now,
              updatedAt: now,
            }
          : clip,
      ),
    );
    window.setTimeout(() => setLastCopiedId(null), 1000);
  }

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.isComposing || multiSelectMode || activeView === "settings") return;
      if (!/^[1-9]$/.test(event.key)) return;

      const target = event.target as HTMLElement | null;
      const editable = target?.closest("input, textarea, select, [contenteditable='true']");
      if (editable && !(editable === searchRef.current && query.trim() === "")) return;

      const index = Number(event.key) - 1;
      const item = filteredClips.slice(0, settingsRef.current.quickItemLimit)[index];
      if (!item) return;
      event.preventDefault();
      setSelectedId(item.id);
      void copyClip(item);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeView, filteredClips, multiSelectMode, query]);

  async function openClipTarget(item: ClipItem) {
    const attachment = item.analysis.attachment;
    if (attachment?.targetType === "path") {
      try {
        await openPath(attachment.target.replace(/^file:\/\//, ""));
        setNativeStatus(`已打开：${attachment.name}`);
      } catch (error) {
        logAppError("warn", "Open path failed", { target: attachment.target, error: String(error) });
        setNativeStatus("资源路径暂时无法打开");
      }
      return;
    }
    const targetUrl = attachment?.targetType === "url" ? attachment.target : item.analysis.url;
    if (!targetUrl) return;
    try {
      await openUrl(targetUrl);
      setNativeStatus(`已打开：${item.analysis.sourceName}`);
    } catch (error) {
      logAppError("warn", "Open URL failed", { target: targetUrl, error: String(error) });
      window.open(targetUrl, "_blank", "noopener,noreferrer");
      setNativeStatus("已使用浏览器打开链接");
    }
  }

  function updateClip(id: string, next: Partial<ClipItem>) {
    invoke("update_clip_record", {
      input: {
        id,
        bucket: next.bucket,
        favorite: typeof next.favorite === "boolean" ? next.favorite : undefined,
      },
    }).catch((error) => logAppError("warn", "Update clip failed", String(error)));
    setClips((current) =>
      current.map((item) => (item.id === id ? { ...item, ...next, updatedAt: Date.now() } : item)),
    );
  }

  async function deleteClips(ids: string[]) {
    try {
      await invoke("soft_delete_clip_records", { ids });
      setNativeStatus(`已软删除 ${ids.length} 条`);
    } catch (error) {
      logAppError("warn", "Soft delete failed", String(error));
      setNativeStatus("软删除失败，查看日志");
    } finally {
      setClips((current) => current.filter((item) => !ids.includes(item.id)));
      setSelectedIds(new Set());
      setMultiSelectMode(false);
      if (selectedId && ids.includes(selectedId)) setSelectedId(null);
    }
  }

  function updateSettings(next: Partial<AppSettings>) {
    setSettings((current) => {
      const merged = mergeSettings({ ...current, ...next });
      setClips((items) => retagClips(items, merged).slice(0, merged.maxStoredItems));
      return merged;
    });
  }

  function updateTagRule(id: string, next: Partial<TagRule>) {
    updateSettings({
      tagRules: settings.tagRules.map((rule) => (rule.id === id ? { ...rule, ...next } : rule)),
    });
  }

  function createQuickTag() {
    const seed = query.trim() || selectedClip?.analysis.title || selectedClip?.analysis.sourceName || "";
    const label = makeRuleLabel(seed);
    if (!label) {
      setNativeStatus("先输入搜索词或选择一条剪贴板内容");
      return;
    }
    const exists = settings.tagRules.some((rule) => rule.label === label);
    updateSettings({
      tagMode: "rules",
      tagRules: exists
        ? settings.tagRules
        : [...settings.tagRules, { id: makeId(), label, query: query.trim() || seed }],
    });
    setActiveTag(label);
    setNativeStatus(`已保存自定义搜索：${label}`);
  }

  const total = clips.length;

  if (isSettingsWindow) {
    return (
      <main className="app-shell settings-window-shell density-normal">
        <SettingsPanel
          accessibility={accessibility}
          configPath={configPath}
          configStatus={configStatus}
          databasePath={databasePath}
          onOpenAccessibilitySettings={() => {
            invoke("open_accessibility_settings").catch((error) =>
              logAppError("warn", "Open accessibility settings failed", String(error)),
            );
          }}
          onAddTagRule={() =>
            updateSettings({
              tagRules: [...settings.tagRules, { id: makeId(), label: "新规则", query: "关键词" }],
            })
          }
          onDeleteTagRule={(id) =>
            updateSettings({ tagRules: settings.tagRules.filter((rule) => rule.id !== id) })
          }
          onSettingsChange={updateSettings}
          onTagRuleChange={updateTagRule}
          settings={settings}
        />
      </main>
    );
  }

  return (
    <main className={`app-shell view-${activeView} density-${settings.panelDensity}${isPanelEntering ? " is-entering" : ""}${isPanelClosing ? " is-closing" : ""}`}>
      <div aria-hidden="true" className="drag-strip" data-tauri-drag-region onPointerDown={handleWindowDrag} />
      <aside className="side-rail" aria-label="主导航" data-tauri-drag-region onPointerDown={handleWindowDrag}>
        <div className="brand">
          <div className="brand-mark">
            <Clipboard size={16} />
          </div>
          <div>
            <strong>ClipForge</strong>
            <span>跨平台剪贴板</span>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                aria-label={item.label}
                className={activeView === item.key ? "nav-item active" : "nav-item"}
                key={item.key}
                onClick={() => {
                  if (activeView === item.key) return;
                  setActiveView(item.key);
                  setSelectedIds(new Set());
                  setMultiSelectMode(false);
                  setActiveTag(null);
                  searchRef.current?.focus();
                }}
                title={item.label}
                type="button"
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
          <button
            aria-label="设置管理"
            className="nav-item"
            onClick={() => {
              invoke("open_settings_window").catch((error) =>
                logAppError("warn", "Open settings window failed", String(error)),
              );
              setSelectedIds(new Set());
              setMultiSelectMode(false);
              setActiveTag(null);
            }}
            title="设置管理"
            type="button"
          >
            <Settings size={17} />
            <span>设置</span>
          </button>
        </nav>

        <div className="rail-stats">
          <div>
            <span>历史</span>
            <strong>{total}</strong>
          </div>
          <div>
            <span>收藏</span>
            <strong>{clips.filter((item) => item.favorite).length}</strong>
          </div>
        </div>
      </aside>

      <section className="content-column">
        <header className="toolbar">
          <div className="search-wrap input-group">
            <span className="input-addon input-addon-start">
              <Search size={15} />
            </span>
            <input
              aria-label="搜索剪贴板"
              autoComplete="off"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="https://  搜索内容、tag、来源"
              ref={searchRef}
              spellCheck={false}
              value={query}
            />
            <button
              aria-label="保存当前搜索"
              className={activeTag ? "icon-button subtle active" : "icon-button subtle"}
              onClick={createQuickTag}
              title="保存当前搜索"
              type="button"
            >
              <Star size={15} />
            </button>
            {query ? (
              <button
                aria-label="清空搜索"
                className="icon-button subtle"
                onClick={() => {
                  setQuery("");
                  setActiveTag(null);
                  searchRef.current?.focus();
                }}
                type="button"
              >
                <X size={15} />
              </button>
            ) : null}
          </div>

          {multiSelectMode ? (
          <div className="toolbar-actions">
            <button className="text-button bulk-button" onClick={() => setSelectedIds(new Set(filteredClips.map((item) => item.id)))} type="button">
              全选
            </button>
            <button
              className="icon-button bulk-button"
              disabled={selectedInList.length === 0}
              onClick={() => copySelectedClips(selectedInList)}
              title="聚合复制选中"
              type="button"
            >
              <Copy size={16} />
            </button>
            <button
              className="icon-button bulk-button"
              disabled={selectedInList.length === 0}
              onClick={() => deleteClips(selectedInList.map((item) => item.id))}
              title="删除选中"
              type="button"
            >
              <Trash2 size={16} />
            </button>
          </div>
          ) : null}
        </header>

        <div className="status-row">
          <span>{nativeStatus}</span>
          <span>{query || activeTag ? `筛选 ${filteredClips.length}` : `列表 ${filteredClips.length}`}</span>
        </div>

        {activeView === "folders" ? (
          <FolderPanel clips={clips} onView={setActiveView} />
        ) : activeView === "quick" || compactPanel ? (
          <QuickPastePanel
            activeId={selectedClip?.id ?? null}
            activeTag={activeTag}
            hasMore={Boolean(nextCursor)}
            clips={filteredClips}
            copiedId={lastCopiedId}
            isLoadingMore={isLoadingMore}
            limit={settings.quickItemLimit}
            multiSelectMode={multiSelectMode}
            selectedIds={selectedIds}
            settings={settings}
            tags={quickTags}
            onAggregateCopy={() => copySelectedClips(selectedInList)}
            onCopy={copyClip}
            onDeleteSelected={() => deleteClips(selectedInList.map((item) => item.id))}
            onLoadMore={loadMoreClips}
            onOpen={openClipTarget}
            onSelect={(item) => setSelectedId(item.id)}
            onSelectAll={() => setSelectedIds(new Set(filteredClips.slice(0, settings.quickItemLimit).map((item) => item.id)))}
            onToggleMultiSelect={() => {
              setMultiSelectMode((current) => {
                if (current) setSelectedIds(new Set());
                return !current;
              });
            }}
            onToggleSelected={(id) =>
              setSelectedIds((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onTagSelect={(tag) => setActiveTag((current) => (current === tag ? null : tag))}
          />
        ) : (
          <ClipList
            activeId={selectedClip?.id ?? null}
            clips={filteredClips}
            copiedId={lastCopiedId}
            hasMore={Boolean(nextCursor)}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMoreClips}
            onArchive={(item) =>
              updateClip(item.id, {
                bucket: item.bucket === "archive" ? "history" : "archive",
              })
            }
            onCopy={copyClip}
            onDelete={(item) => deleteClips([item.id])}
            onFavorite={(item) => updateClip(item.id, { favorite: !item.favorite })}
            onOpen={openClipTarget}
            onSelect={(item) => setSelectedId(item.id)}
            onToggleSelected={(id) =>
              setSelectedIds((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            selectedIds={selectedIds}
            settings={settings}
          />
        )}
      </section>

      <aside className="detail-pane" aria-label="剪贴板详情">
        {detailClip ? (
          <ClipDetail
            copiedId={lastCopiedId}
            item={detailClip}
            onArchive={() =>
              updateClip(detailClip.id, {
                bucket: detailClip.bucket === "archive" ? "history" : "archive",
              })
            }
            onCopy={() => copyClip(detailClip)}
            onDelete={() => deleteClips([detailClip.id])}
            onOpen={() => openClipTarget(detailClip)}
            onSaveSnippet={() => updateClip(detailClip.id, { bucket: "snippet" })}
            settings={settings}
          />
        ) : (
          <div className="empty-detail">
            <Inbox size={32} />
            <h1>没有剪贴板内容</h1>
            <p>复制文本后会自动出现在快速面板。</p>
          </div>
        )}
      </aside>
    </main>
  );
}

function ClipPreviewCard({
  item,
  onCopy,
  onOpen,
  settings,
}: {
  item: ClipItem;
  onCopy: (item: ClipItem) => void;
  onOpen: (item: ClipItem) => void;
  settings: AppSettings;
}) {
  const canOpen = Boolean(item.analysis.url || item.analysis.attachment);
  const showMarkdown = settings.enableMarkdownPreview && item.analysis.isMarkdown;
  return (
    <div className="preview-card">
      <div className="preview-card-head">
        <span className={`kind-pill ${item.kind}`}>{item.kind}</span>
        <strong>{item.analysis.title}</strong>
      </div>
      {item.analysis.attachment ? (
        <AttachmentPreview item={item} compact />
      ) : showMarkdown ? (
        <div className="inline-markdown-preview">
          <MarkdownPreview content={item.content} />
        </div>
      ) : (
        <p>{item.analysis.summary}</p>
      )}
      <div className="preview-meta">
        <span>来源 {item.analysis.sourceName}</span>
        <span>创建 {formatTime(item.createdAt)}</span>
        <span>最近 {formatTime(item.lastSeenAt)}</span>
      </div>
      <div className="inline-tags">
        {item.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <div className="preview-actions" onClick={(event) => event.stopPropagation()}>
        {canOpen ? (
          <button className="text-button" onClick={() => onOpen(item)} type="button">
            <ExternalLink size={14} />
            打开
          </button>
        ) : null}
        <button className="text-button" onClick={() => onCopy(item)} type="button">
          <Copy size={14} />
          复制
        </button>
      </div>
    </div>
  );
}

function AttachmentPreview({ compact = false, item }: { compact?: boolean; item: ClipItem }) {
  const attachment = item.analysis.attachment;
  if (!attachment) return null;
  return (
    <Attachment className={compact ? "compact" : ""}>
      <AttachmentMedia>{attachment.isImage ? <Image size={16} /> : <Paperclip size={16} />}</AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{attachment.name}</AttachmentTitle>
        <AttachmentDescription>{attachment.description}</AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  );
}

function ClipList({
  activeId,
  clips,
  copiedId,
  hasMore,
  isLoadingMore,
  onArchive,
  onCopy,
  onDelete,
  onFavorite,
  onLoadMore,
  onOpen,
  onSelect,
  onToggleSelected,
  selectedIds,
  settings,
}: {
  activeId: string | null;
  clips: ClipItem[];
  copiedId: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  onArchive: (item: ClipItem) => void;
  onCopy: (item: ClipItem) => void;
  onDelete: (item: ClipItem) => void;
  onFavorite: (item: ClipItem) => void;
  onLoadMore: () => void;
  onOpen: (item: ClipItem) => void;
  onSelect: (item: ClipItem) => void;
  onToggleSelected: (id: string) => void;
  selectedIds: Set<string>;
  settings: AppSettings;
}) {
  const setPreviewClip = usePanelUiStore((state) => state.setPreviewClip);

  if (!clips.length) {
    return (
      <div className="empty-list">
        <Database size={30} />
        <h2>没有匹配内容</h2>
        <p>搜索会直接跨历史、归档、片段展示结果。</p>
      </div>
    );
  }

  return (
    <VirtualList
      className="clip-list"
      hasMore={hasMore}
      items={clips}
      isLoadingMore={isLoadingMore}
      itemHeight={ROW_HEIGHT}
      onEndReached={onLoadMore}
      renderItem={(item) => (
        <article
          className={activeId === item.id ? "clip-row active" : "clip-row"}
          onClick={() => {
            setPreviewClip(item);
            onSelect(item);
          }}
          onFocus={() => setPreviewClip(item)}
          onMouseEnter={() => setPreviewClip(item)}
          tabIndex={0}
        >
          <label className="check-cell" onClick={(event) => event.stopPropagation()}>
            <input
              checked={selectedIds.has(item.id)}
              onChange={() => onToggleSelected(item.id)}
              type="checkbox"
            />
          </label>
          <button
            className={item.favorite ? "icon-button favorite on" : "icon-button favorite"}
            onClick={(event) => {
              event.stopPropagation();
              onFavorite(item);
            }}
            title="收藏"
            type="button"
          >
            <Heart size={15} />
          </button>
          <div className="clip-main">
            <div className="clip-row-top">
              <strong>{item.analysis.title}</strong>
              <span>{formatTime(item.lastSeenAt)}</span>
              {item.bucket !== "history" ? <em>{item.bucket}</em> : null}
            </div>
            <p title={item.content}>{getDisplayText(item, settings)}</p>
            <div className="inline-tags">
              {item.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </div>
          <div className="row-actions" onClick={(event) => event.stopPropagation()}>
            {item.analysis.url || item.analysis.attachment ? (
              <button className="icon-button" onClick={() => onOpen(item)} title="打开链接" type="button">
                <ExternalLink size={15} />
              </button>
            ) : null}
            <button className="icon-button" onClick={() => onCopy(item)} title="复制" type="button">
              {copiedId === item.id ? <Check size={15} /> : <Copy size={15} />}
            </button>
            <button className="icon-button" onClick={() => onArchive(item)} title="归档" type="button">
              <Archive size={15} />
            </button>
            <button className="icon-button" onClick={() => onDelete(item)} title="删除" type="button">
              <Trash2 size={15} />
            </button>
          </div>
        </article>
      )}
    />
  );
}

function VirtualList<T extends { id: string }>({
  className,
  hasMore = false,
  items,
  isLoadingMore = false,
  itemHeight = ROW_HEIGHT,
  onEndReached,
  renderItem,
}: {
  className: string;
  hasMore?: boolean;
  items: T[];
  isLoadingMore?: boolean;
  itemHeight?: number;
  onEndReached?: () => void;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(420);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      setHeight(entry.contentRect.height);
    });
    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - OVERSCAN);
  const visibleCount = Math.ceil(height / itemHeight) + OVERSCAN * 2;
  const visible = items.slice(start, start + visibleCount);

  return (
    <div
      className={`${className} virtual-list`}
      onScroll={(event) => {
        const node = event.currentTarget;
        setScrollTop(node.scrollTop);
        if (hasMore && !isLoadingMore && node.scrollHeight - node.scrollTop - node.clientHeight < itemHeight * 6) {
          onEndReached?.();
        }
      }}
      ref={ref}
    >
      <div className="virtual-spacer" style={{ height: items.length * itemHeight }}>
        <div className="virtual-window" style={{ transform: `translateY(${start * itemHeight}px)` }}>
          {visible.map((item, index) => (
            <div className="virtual-item" key={item.id}>
              {renderItem(item, start + index)}
            </div>
          ))}
          {isLoadingMore ? <div className="loading-more">加载更多...</div> : null}
        </div>
      </div>
    </div>
  );
}

function QuickPastePanel({
  activeId,
  clips,
  copiedId,
  hasMore,
  activeTag,
  isLoadingMore,
  multiSelectMode,
  selectedIds,
  settings,
  tags,
  onAggregateCopy,
  onCopy,
  onDeleteSelected,
  onLoadMore,
  onOpen,
  onSelect,
  onSelectAll,
  onToggleMultiSelect,
  onToggleSelected,
  onTagSelect,
}: {
  activeId: string | null;
  clips: ClipItem[];
  copiedId: string | null;
  hasMore: boolean;
  activeTag: string | null;
  isLoadingMore: boolean;
  limit: number;
  multiSelectMode: boolean;
  selectedIds: Set<string>;
  settings: AppSettings;
  tags: Array<[string, number]>;
  onAggregateCopy: () => void;
  onCopy: (item: ClipItem) => void;
  onDeleteSelected: () => void;
  onLoadMore: () => void;
  onOpen: (item: ClipItem) => void;
  onSelect: (item: ClipItem) => void;
  onSelectAll: () => void;
  onToggleMultiSelect: () => void;
  onToggleSelected: (id: string) => void;
  onTagSelect: (tag: string) => void;
}) {
  const previewItem = usePanelUiStore((state) => state.previewClip);
  const isPreviewOpen = usePanelUiStore((state) => state.isPreviewOpen);
  const setPreviewClip = usePanelUiStore((state) => state.setPreviewClip);
  const setPreviewOpen = usePanelUiStore((state) => state.setPreviewOpen);
  const snippetClips = clips.filter((item) => item.bucket === "snippet").slice(0, 4);
  const selectedCount = clips.filter((item) => selectedIds.has(item.id)).length;

  useEffect(() => {
    if (!previewItem || !clips.some((item) => item.id === previewItem.id)) {
      setPreviewClip(clips[0] ?? null);
      setPreviewOpen(false);
    }
  }, [clips, previewItem, setPreviewClip, setPreviewOpen]);

  if (!clips.length) {
    return (
      <div className="empty-list">
        <Database size={30} />
        <h2>还没有剪贴板内容</h2>
        <p>复制文本后，这里会显示最近项目。</p>
      </div>
    );
  }

  return (
    <section className="quick-panel">
      <div className="quick-control-row">
        <div className="tag-filter-row" aria-label="标签筛选">
          {tags.length ? (
            tags.map(([tag, count]) => (
              <button
                className={activeTag === tag ? "tag-filter active" : "tag-filter"}
                key={tag}
                onClick={() => onTagSelect(tag)}
                type="button"
              >
                {tag}
                <span>{count}</span>
              </button>
            ))
          ) : (
            <span className="empty-note">暂无标签</span>
          )}
        </div>
        <div className="quick-bulk-actions" aria-label="快速批量操作">
          {multiSelectMode ? (
            <>
              <button aria-label="选择当前列表" className="icon-button" onClick={onSelectAll} title="选择当前列表" type="button">
                <CheckSquare size={14} />
              </button>
              <button
                aria-label="聚合复制"
                className="icon-button"
                disabled={selectedCount === 0}
                onClick={onAggregateCopy}
                title="聚合复制"
                type="button"
              >
                <Copy size={14} />
              </button>
              <button
                aria-label="删除选中"
                className="icon-button danger-icon"
                disabled={selectedCount === 0}
                onClick={onDeleteSelected}
                title="删除选中"
                type="button"
              >
                <Trash2 size={14} />
              </button>
              <span>{selectedCount}</span>
            </>
          ) : null}
          <button
            aria-label={multiSelectMode ? "退出多选" : "进入多选"}
            className={multiSelectMode ? "icon-button active" : "icon-button"}
            onClick={onToggleMultiSelect}
            title={multiSelectMode ? "退出多选" : "多选"}
            type="button"
          >
            {multiSelectMode ? <CheckSquare size={14} /> : <Square size={14} />}
          </button>
        </div>
      </div>

      <div className="quick-workspace">
        <VirtualList
          className="quick-menu"
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          itemHeight={50}
          items={clips}
          onEndReached={onLoadMore}
          renderItem={(item, index) => (
          <article
            className={[
              "quick-row",
              activeId === item.id ? "active" : "",
              copiedId === item.id ? "copied" : "",
              selectedIds.has(item.id) ? "selected" : "",
              multiSelectMode ? "selecting" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            key={item.id}
            onClick={() => {
              if (multiSelectMode) {
                onToggleSelected(item.id);
                return;
              }
              setPreviewClip(item);
              onSelect(item);
              onCopy(item);
            }}
            onFocus={() => setPreviewClip(item)}
            onMouseEnter={() => setPreviewClip(item)}
            tabIndex={0}
          >
            {multiSelectMode ? (
              <button
                aria-label={selectedIds.has(item.id) ? "取消选择" : "选择"}
                className="quick-check"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleSelected(item.id);
                }}
                type="button"
              >
                {selectedIds.has(item.id) ? <CheckSquare size={14} /> : <Square size={14} />}
              </button>
            ) : (
              <kbd>{copiedId === item.id ? <Check size={12} /> : index + 1}</kbd>
            )}
            <div>
              <strong>
                {item.analysis.title}
                <span>{formatTime(item.lastSeenAt)}</span>
              </strong>
              <p title={item.content}>{getDisplayText(item, settings)}</p>
            </div>
            <div className="row-actions" onClick={(event) => event.stopPropagation()}>
              {item.analysis.url || item.analysis.attachment ? (
                <button className="icon-button" onClick={() => onOpen(item)} title="打开链接" type="button">
                  <ExternalLink size={14} />
                </button>
              ) : null}
              <button
                className={isPreviewOpen && previewItem?.id === item.id ? "icon-button active" : "icon-button"}
                onClick={() => {
                  setPreviewClip(item);
                  setPreviewOpen(!(isPreviewOpen && previewItem?.id === item.id));
                }}
                title="查看详情"
                type="button"
              >
                <Eye size={14} />
              </button>
            </div>
          </article>
          )}
        />
        <aside
          className={isPreviewOpen && previewItem ? "quick-preview-pane open" : "quick-preview-pane"}
          aria-label="剪贴板详情预览"
        >
          {previewItem ? (
            <>
              <button
                aria-label="关闭详情"
                className="icon-button subtle preview-close"
                onClick={() => setPreviewOpen(false)}
                type="button"
              >
                <X size={13} />
              </button>
              <ClipPreviewCard item={previewItem} onCopy={onCopy} onOpen={onOpen} settings={settings} />
            </>
          ) : (
            <span>暂无详情</span>
          )}
        </aside>
      </div>

      {snippetClips.length ? (
        <div className="snippet-strip">
          {snippetClips.map((item) => (
            <button className="snippet-card" key={item.id} onClick={() => onCopy(item)} type="button">
              <FileText size={15} />
              <span>{getDisplayText(item, settings)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ClipDetail({
  copiedId,
  item,
  onArchive,
  onCopy,
  onDelete,
  onOpen,
  onSaveSnippet,
  settings,
}: {
  copiedId: string | null;
  item: ClipItem;
  onArchive: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onOpen: () => void;
  onSaveSnippet: () => void;
  settings: AppSettings;
}) {
  const showMarkdown = settings.enableMarkdownPreview && item.analysis.isMarkdown;
  return (
    <>
      <div className="detail-header">
        <div className="detail-title">
          <div>
            <span className={`kind-pill ${item.kind}`}>{item.kind}</span>
            <h1>{item.analysis.title}</h1>
            <p>{item.analysis.summary}</p>
          </div>
        </div>
        <button className="primary-button" onClick={onCopy} type="button">
          {copiedId === item.id ? <Check size={16} /> : <Copy size={16} />}
          复制
        </button>
      </div>

      {item.analysis.attachment ? (
        <div className="attachment-detail">
          <AttachmentPreview item={item} />
          <pre className="clip-preview compact-preview">{item.content}</pre>
        </div>
      ) : showMarkdown ? (
        <MarkdownPreview content={item.content} />
      ) : (
        <pre className="clip-preview">{item.content}</pre>
      )}

      <div className="meta-grid">
        <div>
          <span>来源</span>
          <strong>{item.analysis.sourceName}</strong>
        </div>
        <div>
          <span>创建</span>
          <strong>{formatTime(item.createdAt)}</strong>
        </div>
        <div>
          <span>最近出现</span>
          <strong>{formatTime(item.lastSeenAt)}</strong>
        </div>
        <div>
          <span>复制</span>
          <strong>{item.copyCount} 次</strong>
        </div>
      </div>

      <div className="tag-row">
        {item.tags.map((tag) => (
          <span className="tag-chip" key={tag}>
            <Tag size={12} />
            {tag}
          </span>
        ))}
      </div>

      <div className="detail-actions">
        {item.analysis.url || item.analysis.attachment ? (
          <button className="text-button" onClick={onOpen} type="button">
            <ExternalLink size={15} />
            打开
          </button>
        ) : null}
        <button className="text-button" onClick={onArchive} type="button">
          <Archive size={15} />
          {item.bucket === "archive" ? "移回" : "归档"}
        </button>
        <button className="text-button" onClick={onSaveSnippet} type="button">
          <FileText size={15} />
          片段
        </button>
        <button className="danger-button" onClick={onDelete} type="button">
          <Trash2 size={15} />
          删除
        </button>
      </div>
    </>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let codeLines: string[] = [];
  let inCode = false;

  function flushList(key: string) {
    if (!listItems.length) return;
    blocks.push(
      <ul key={key}>
        {listItems.map((line) => (
          <li key={line}>{renderInlineMarkdown(line)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  }

  function flushCode(key: string) {
    if (!codeLines.length) return;
    blocks.push(
      <pre key={key}>
        <code>{codeLines.join("\n")}</code>
      </pre>,
    );
    codeLines = [];
  }

  lines.forEach((line, index) => {
    if (line.trim().startsWith("```")) {
      if (inCode) flushCode(`code-${index}`);
      inCode = !inCode;
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushList(`list-${index}`);
      const level = heading[1].length;
      const text = heading[2];
      blocks.push(level === 1 ? <h1 key={index}>{text}</h1> : level === 2 ? <h2 key={index}>{text}</h2> : <h3 key={index}>{text}</h3>);
      return;
    }
    const list = line.match(/^[-*]\s+(.*)$/);
    if (list) {
      listItems.push(list[1]);
      return;
    }
    flushList(`list-${index}`);
    if (!line.trim()) return;
    if (line.startsWith(">")) {
      blocks.push(<blockquote key={index}>{renderInlineMarkdown(line.replace(/^>\s?/, ""))}</blockquote>);
      return;
    }
    blocks.push(<p key={index}>{renderInlineMarkdown(line)}</p>);
  });
  flushList("list-end");
  flushCode("code-end");

  return <div className="markdown-preview">{blocks}</div>;
}

function renderInlineMarkdown(text: string) {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <a href={match[2]} key={`${match[1]}-${match.index}`} rel="noreferrer" target="_blank">
        {match[1]}
      </a>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length ? parts : text;
}

function FolderPanel({ clips, onView }: { clips: ClipItem[]; onView: (view: ViewKey) => void }) {
  const folders = [
    {
      title: "History",
      label: "历史",
      count: clips.filter((item) => item.bucket === "history").length,
      view: "history" as ViewKey,
      icon: History,
    },
    {
      title: "Snippets",
      label: "片段",
      count: clips.filter((item) => item.bucket === "snippet").length,
      view: "snippets" as ViewKey,
      icon: Layers3,
    },
    {
      title: "Archive",
      label: "归档",
      count: clips.filter((item) => item.bucket === "archive").length,
      view: "archive" as ViewKey,
      icon: Archive,
    },
  ];

  return (
    <section className="extension-panel">
      <div className="panel-heading">
        <Archive size={20} />
        <div>
          <h2>文件夹</h2>
          <p>按历史、片段、归档整理。</p>
        </div>
      </div>
      <div className="folder-grid">
        {folders.map((folder) => {
          const Icon = folder.icon;
          return (
            <button className="folder-card" key={folder.title} onClick={() => onView(folder.view)} type="button">
              <Icon size={18} />
              <span>{folder.title}</span>
              <strong>{folder.count}</strong>
              <em>{folder.label}</em>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SettingsPanel({
  accessibility,
  configPath,
  configStatus,
  databasePath,
  onOpenAccessibilitySettings,
  onAddTagRule,
  onDeleteTagRule,
  onSettingsChange,
  onTagRuleChange,
  settings,
}: {
  accessibility: AccessibilityPermissionPayload | null;
  configPath: string;
  configStatus: string;
  databasePath: string;
  onOpenAccessibilitySettings: () => void;
  onAddTagRule: () => void;
  onDeleteTagRule: (id: string) => void;
  onSettingsChange: (next: Partial<AppSettings>) => void;
  onTagRuleChange: (id: string, next: Partial<TagRule>) => void;
  settings: AppSettings;
}) {
  const [section, setSection] = useState("shortcut");
  const [recording, setRecording] = useState(false);
  const sections = [
    { key: "shortcut", label: "快捷键", icon: Terminal },
    { key: "display", label: "面板显示", icon: Eye },
    { key: "content", label: "内容识别", icon: FileCode },
    { key: "storage", label: "数据存储", icon: Database },
    { key: "tags", label: "Tag 规则", icon: Tag },
  ];

  return (
    <section className="extension-panel">
      <div className="panel-heading">
        <Settings size={20} />
        <div>
          <h2>设置</h2>
          <p>{configStatus}</p>
        </div>
      </div>
      <div className="settings-shell">
        <aside className="settings-sidebar" aria-label="设置分类">
          {sections.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={section === item.key ? "active" : ""}
                key={item.key}
                onClick={() => setSection(item.key)}
                type="button"
              >
                <Icon size={15} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </aside>

        <div className="settings-list config-list">
          {section === "shortcut" ? (
            <SettingGroup title="快捷键">
              <div className="setting-card full">
                <span>快速唤起</span>
                <div className="kbd-row">
                  {formatShortcutParts(settings.globalShortcut).map((part) => (
                    <Kbd key={part}>{part}</Kbd>
                  ))}
                </div>
                <button
                  className={recording ? "primary-button" : "text-button"}
                  onClick={() => setRecording((value) => !value)}
                  onKeyDown={(event) => {
                    if (!recording) return;
                    event.preventDefault();
                    const shortcut = shortcutFromKeyboardEvent(event);
                    if (!shortcut) return;
                    onSettingsChange({ globalShortcut: shortcut });
                    setRecording(false);
                  }}
                  type="button"
                >
                  {recording ? "按下组合键" : "录入快捷键"}
                </button>
                <input
                  aria-label="全局快捷键"
                  onChange={(event) => onSettingsChange({ globalShortcut: event.currentTarget.value })}
                  value={settings.globalShortcut}
                />
              </div>
              <div className="setting-card full permission-card">
                <span>macOS 辅助功能权限</span>
                <strong>{accessibility?.canReadFocusedInput ? "已授权：可贴近输入位置" : "未授权：使用屏幕右侧兜底"}</strong>
                <p>{accessibility?.message ?? "启动时自动检查，用于读取当前输入控件位置。"}</p>
                {accessibility?.status === "missing" ? (
                  <button className="text-button" onClick={onOpenAccessibilitySettings} type="button">
                    <Settings size={14} />
                    打开系统设置
                  </button>
                ) : null}
              </div>
            </SettingGroup>
          ) : null}

          {section === "display" ? (
            <SettingGroup title="面板显示">
              <SegmentSetting
                label="面板密度 / Zoom"
                value={densityLabels[settings.panelDensity]}
                options={(["dense", "normal", "comfortable"] as PanelDensity[]).map((value) => ({
                  value,
                  label: densityLabels[value],
                }))}
                selected={settings.panelDensity}
                onChange={(panelDensity) => onSettingsChange({ panelDensity })}
              />
              <SegmentSetting
                label="内容显示"
                value={displayModeLabels[settings.contentDisplayMode]}
                options={(["summary", "middle", "raw"] as ContentDisplayMode[]).map((value) => ({
                  value,
                  label: displayModeLabels[value],
                }))}
                selected={settings.contentDisplayMode}
                onChange={(contentDisplayMode) => onSettingsChange({ contentDisplayMode })}
              />
              <NumberSetting
                label="快捷列表条数"
                value={settings.quickItemLimit}
                min={4}
                max={30}
                onChange={(quickItemLimit) => onSettingsChange({ quickItemLimit })}
              />
            </SettingGroup>
          ) : null}

          {section === "content" ? (
            <SettingGroup title="内容识别">
              <div className="setting-card toggle-card full">
                <label>
                  <input
                    checked={settings.enableMarkdownPreview}
                    onChange={(event) => onSettingsChange({ enableMarkdownPreview: event.currentTarget.checked })}
                    type="checkbox"
                  />
                  Markdown 详情预览
                </label>
              </div>
              <div className="setting-card full">
                <span>智能内容检查</span>
                <div className="content-check-grid">
                  <CheckItem icon={<ExternalLink size={15} />} title="链接" body="识别 GitHub / GitLab / 普通链接。" />
                  <CheckItem icon={<Terminal size={15} />} title="命令" body="识别 pnpm、cargo、git、curl 等命令。" />
                  <CheckItem icon={<Eye size={15} />} title="Markdown" body="详情面板预览，原文仍可复制。" />
                  <CheckItem icon={<FileCode size={15} />} title="代码" body="识别代码片段，保留等宽查看。" />
                </div>
              </div>
            </SettingGroup>
          ) : null}

          {section === "storage" ? (
            <SettingGroup title="数据存储">
              <div className="setting-card full">
                <span>JSON5 配置文件</span>
                <strong>{configPath || "Tauri 启动后生成"}</strong>
              </div>
              <div className="setting-card full">
                <span>SQLite 永久数据库</span>
                <strong>{databasePath || "Tauri 启动后生成"}</strong>
              </div>
              <NumberSetting
                label="最大存储条数"
                value={settings.maxStoredItems}
                min={50}
                max={5000}
                onChange={(maxStoredItems) => onSettingsChange({ maxStoredItems })}
              />
              <NumberSetting
                label="剪贴板检查间隔 ms"
                value={settings.clipboardPollMs}
                min={500}
                max={5000}
                onChange={(clipboardPollMs) => onSettingsChange({ clipboardPollMs })}
              />
              <div className="setting-card toggle-card full">
                <label>
                  <input
                    checked={settings.cleanupEnabled}
                    onChange={(event) => onSettingsChange({ cleanupEnabled: event.currentTarget.checked })}
                    type="checkbox"
                  />
                  启用定期清理
                </label>
              </div>
              <NumberSetting
                label="清理间隔小时"
                value={settings.cleanupIntervalHours}
                min={1}
                max={720}
                onChange={(cleanupIntervalHours) => onSettingsChange({ cleanupIntervalHours })}
              />
              <NumberSetting
                label="软删除保留天数"
                value={settings.softDeletedRetentionDays}
                min={1}
                max={365}
                onChange={(softDeletedRetentionDays) => onSettingsChange({ softDeletedRetentionDays })}
              />
            </SettingGroup>
          ) : null}

          {section === "tags" ? (
            <SettingGroup title="Tag 规则">
              <SegmentSetting
                label="Tag 生成"
                value={tagModeLabels[settings.tagMode]}
                options={(["similar", "rules", "off"] as TagMode[]).map((value) => ({
                  value,
                  label: tagModeLabels[value],
                }))}
                selected={settings.tagMode}
                onChange={(tagMode) => onSettingsChange({ tagMode })}
              />
              <div className="setting-card full">
                <span>规则配置</span>
                <strong>默认相似内容；规则模式会叠加这些关键词</strong>
                <div className="tag-rule-list">
                  {settings.tagRules.map((rule) => (
                    <div className="tag-rule" key={rule.id}>
                      <input
                        aria-label="Tag 名称"
                        onChange={(event) => onTagRuleChange(rule.id, { label: event.currentTarget.value })}
                        value={rule.label}
                      />
                      <input
                        aria-label="Tag 关键词"
                        onChange={(event) => onTagRuleChange(rule.id, { query: event.currentTarget.value })}
                        value={rule.query}
                      />
                      <button
                        aria-label="删除 Tag 规则"
                        className="icon-button subtle"
                        onClick={() => onDeleteTagRule(rule.id)}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <button className="text-button" onClick={onAddTagRule} type="button">
                  <Plus size={14} />
                  添加规则
                </button>
              </div>
            </SettingGroup>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function SettingGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="setting-group">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function SegmentSetting<T extends string>({
  label,
  onChange,
  options,
  selected,
  value,
}: {
  label: string;
  value: string;
  options: Array<{ value: T; label: string }>;
  selected: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="setting-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <div className="segmented-control">
        {options.map((option) => (
          <button
            className={selected === option.value ? "active" : ""}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NumberSetting({
  label,
  max,
  min,
  onChange,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <div className="setting-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        type="number"
        value={value}
      />
    </div>
  );
}

function CheckItem({ body, icon, title }: { body: string; icon: ReactNode; title: string }) {
  return (
    <div>
      {icon}
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

function App() {
  return (
    <AppErrorBoundary>
      <ClipForgeApp />
    </AppErrorBoundary>
  );
}

export default App;
