import {
  Check,
  CheckSquare,
  Clipboard,
  Copy,
  ExternalLink,
  Heart,
  History,
  Inbox,
  Pin,
  RotateCcw,
  Search,
  Settings,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { match as matchPinyin } from "pinyin-pro";
import { create } from "zustand";
import type { CSSProperties, ErrorInfo, PointerEvent, ReactNode, RefObject, UIEvent } from "react";
import {
  WorkspaceRouterProvider,
  navigateWorkspaceDetail,
  navigateWorkspaceList,
} from "./routes/workspace-router";
import { useWorkspaceStore } from "./stores/workspace-store";
import { ClipDetailWorkspace, MultiAggregateWorkspace } from "./workspace/workspace-panels";
import "./App.css";

type ClipKind = "text" | "code" | "link" | "markdown" | "command" | "attachment";
type ClipboardContentKind = "text" | "link" | "image" | "file" | "table" | "chart" | "richText" | "unknown";
export type ClipPayloadKind = "text" | "link" | "markdown" | "code" | "command" | "html" | "file" | "image" | "json" | "chart" | "table";
type ClipBucket = "history" | "archive" | "snippet";

type SourceAppInfo = {
  name: string;
  bundleId: string;
  executablePath: string;
  iconBase64?: string;
};
type ViewKey = "history" | "favorites" | "trash";
type PanelDensity = "dense" | "normal" | "comfortable";
type TagMode = "similar" | "rules" | "off";
type ContentDisplayMode = "summary" | "middle" | "raw";
type SearchSuggestion =
  | { id: string; label: string; hint: string; kind: "all"; typeFilter: "all" }
  | { id: string; label: string; hint: string; kind: "favorite" }
  | { id: string; label: string; hint: string; kind: "type"; typeFilter: ClipKind }
  | { id: string; label: string; hint: string; kind: "saved"; tag: string };

type ParsedSearchCommand = {
  handled: boolean;
  queryText: string;
  typeFilter: "all" | ClipKind;
  filterFavorite: boolean;
  tag: string | null;
  label: string | null;
};

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
  sourceApp?: SourceAppInfo;
  deletedAt?: number | null;
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
  setPreviewClip: (previewClip) =>
    set((state) => {
      const current = state.previewClip;
      if (!current && !previewClip) return state;
      if (
        current &&
        previewClip &&
        current.id === previewClip.id &&
        current.updatedAt === previewClip.updatedAt &&
        current.favorite === previewClip.favorite &&
        current.bucket === previewClip.bucket
      ) {
        return state;
      }
      return { previewClip };
    }),
  setPreviewOpen: (isPreviewOpen) =>
    set((state) => (state.isPreviewOpen === isPreviewOpen ? state : { isPreviewOpen })),
  setClosing: (isClosing) => set((state) => (state.isClosing === isClosing ? state : { isClosing })),
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
  fuzzySearchEnabled: boolean;
  pinyinSearchEnabled: boolean;
  globalShortcut: string;
  copyPreviewEnabled: boolean;
  cleanupEnabled: boolean;
  cleanupIntervalHours: number;
  softDeletedRetentionDays: number;
  panelBackgroundOpacity: number;
  enableScrollCollapse: boolean;
  panelPinned: boolean;
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
  clipboardPollMs: 200,
  tagMode: "similar",
  tagRules: [],
  contentDisplayMode: "summary",
  showSourceBadges: false,
  enableMarkdownPreview: true,
  fuzzySearchEnabled: true,
  pinyinSearchEnabled: true,
  globalShortcut: DEFAULT_SHORTCUT,
  copyPreviewEnabled: true,
  cleanupEnabled: true,
  cleanupIntervalHours: 24,
  softDeletedRetentionDays: 30,
  panelBackgroundOpacity: 0.72,
  enableScrollCollapse: true,
  panelPinned: false,
};

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

function extractUrls(content: string) {
  return Array.from(new Set(content.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []));
}

function getClipboardContentKind(item: ClipItem): ClipboardContentKind {
  const payload = item.payloadKind;
  if (payload === "image" || item.analysis.attachment?.isImage) return "image";
  if (payload === "file" || item.analysis.attachment) return "file";
  if (payload === "link" || item.kind === "link") return "link";
  if (payload === "table") return "table";
  if (payload === "chart") return "chart";
  if (payload === "markdown" || item.kind === "markdown") return "richText";
  if (payload === "text" || item.kind === "text" || item.kind === "code" || item.kind === "command") return "text";
  return "unknown";
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

function fuzzyIncludes(haystack: string, needle: string) {
  if (!needle) return true;
  let offset = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, offset);
    if (found < 0) return false;
    offset = found + 1;
  }
  return true;
}

function matchesSearchTerm(item: ClipItem, rawTerm: string, settings: AppSettings) {
  const term = normalizeSearch(rawTerm);
  if (!term) return true;
  const haystack = getSearchHaystack(item);
  if (haystack.includes(term)) return true;
  if (settings.pinyinSearchEnabled && /[a-z]/i.test(term)) {
    const textFields = [
      item.content,
      item.analysis.title,
      item.analysis.summary,
      item.tags.join(" "),
    ].filter(Boolean);
    if (textFields.some((text) => matchPinyin(text, term, { precision: "any", space: "ignore" }) !== null)) {
      return true;
    }
  }
  return settings.fuzzySearchEnabled ? fuzzyIncludes(haystack, term) : false;
}

function matchesSavedSearch(item: ClipItem, rule: TagRule, settings: AppSettings) {
  const terms = rule.query
    .split(/[\s,，]+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (!rule.label.trim() || !terms.length) return false;
  return terms.some((term) => matchesSearchTerm(item, term, settings));
}

function getSearchSuggestionToken(suggestion: SearchSuggestion) {
  if (suggestion.kind === "all") return "@全部";
  if (suggestion.kind === "favorite") return "@收藏";
  if (suggestion.kind === "saved") return `@${suggestion.label}`;
  const tokenMap: Record<ClipKind, string> = {
    text: "@文本",
    code: "@代码",
    link: "@链接",
    markdown: "@Markdown",
    command: "@命令",
    attachment: "@文件",
  };
  return tokenMap[suggestion.typeFilter];
}

function getSearchSuggestionAliases(suggestion: SearchSuggestion) {
  const label = suggestion.label.toLowerCase();
  if (suggestion.kind === "all") return [label, "all", "全部", "全部内容"];
  if (suggestion.kind === "favorite") return [label, "fav", "favorite", "favorites", "star", "收藏"];
  if (suggestion.kind === "saved") return [label, suggestion.tag.toLowerCase()];
  const aliasMap: Record<ClipKind, string[]> = {
    text: ["text", "txt", "文本"],
    code: ["code", "代码"],
    link: ["link", "url", "links", "链接"],
    markdown: ["md", "markdown"],
    command: ["cmd", "command", "shell", "命令"],
    attachment: ["file", "files", "attachment", "image", "img", "文件", "图片", "资源"],
  };
  return [label, ...aliasMap[suggestion.typeFilter]];
}

function matchesSearchSuggestionToken(suggestion: SearchSuggestion, rawToken: string) {
  const term = normalizeSearch(rawToken.replace(/^@/, ""));
  if (!term) return true;
  const aliases = getSearchSuggestionAliases(suggestion);
  return (
    aliases.some((alias) => alias.includes(term)) ||
    matchPinyin(suggestion.label, term, { precision: "any", space: "ignore" }) !== null
  );
}

function parseSearchCommand(rawQuery: string, suggestions: SearchSuggestion[]): ParsedSearchCommand {
  const fallback: ParsedSearchCommand = {
    handled: false,
    queryText: rawQuery,
    typeFilter: "all",
    filterFavorite: false,
    tag: null,
    label: null,
  };
  const trimmedStart = rawQuery.trimStart();
  if (!trimmedStart.startsWith("@")) return fallback;

  const body = trimmedStart.slice(1);
  const [, token = "", rest = ""] = body.match(/^([^\s]*)\s*(.*)$/) ?? [];
  const normalizedToken = normalizeSearch(token);
  const matched = suggestions.find((suggestion) =>
    getSearchSuggestionAliases(suggestion).some((alias) => alias === normalizedToken),
  );

  if (!matched) {
    return {
      handled: true,
      queryText: rest,
      typeFilter: "all",
      filterFavorite: false,
      tag: null,
      label: normalizedToken ? `@${token}` : null,
    };
  }

  return {
    handled: true,
    queryText: rest,
    typeFilter: matched.kind === "type" ? matched.typeFilter : "all",
    filterFavorite: matched.kind === "favorite",
    tag: matched.kind === "saved" ? matched.tag : null,
    label: getSearchSuggestionToken(matched),
  };
}

function createClip(content: string, settings: AppSettings): ClipItem {
  const now = Date.now();
  const analysis = analyzeContent(content);
  const kind = detectKind(content);
  return {
    id: makeId(),
    content,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    source: analysis.sourceName,
    kind,
    bucket: "history",
    favorite: false,
    tags: generateTags(content, settings),
    copyCount: 0,
    analysis,
    payloadKind: kind === "attachment" ? (analysis.attachment?.isImage ? "image" : "file") : (kind as ClipPayloadKind),
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
    panelBackgroundOpacity: clampNumber(
      next.panelBackgroundOpacity,
      0.2,
      1,
      defaultSettings.panelBackgroundOpacity,
    ),
    enableScrollCollapse:
      typeof next.enableScrollCollapse === "boolean"
        ? next.enableScrollCollapse
        : defaultSettings.enableScrollCollapse,
    panelPinned:
      typeof next.panelPinned === "boolean"
        ? next.panelPinned
        : defaultSettings.panelPinned,
    tagRules: Array.isArray(next.tagRules) ? next.tagRules : defaultSettings.tagRules,
    fuzzySearchEnabled:
      typeof next.fuzzySearchEnabled === "boolean"
        ? next.fuzzySearchEnabled
        : defaultSettings.fuzzySearchEnabled,
    pinyinSearchEnabled:
      typeof next.pinyinSearchEnabled === "boolean"
        ? next.pinyinSearchEnabled
        : defaultSettings.pinyinSearchEnabled,
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
  const kind = detectKind(raw.content);
  const payloadKind =
    typeof raw.payloadKind === "string"
      ? (raw.payloadKind as ClipPayloadKind)
      : kind === "attachment"
        ? (analysis.attachment?.isImage ? "image" : "file")
        : (kind as ClipPayloadKind);
  return {
    id: typeof raw.id === "string" ? raw.id : makeId(),
    content: raw.content,
    createdAt,
    updatedAt,
    lastSeenAt,
    lastCopiedAt: typeof raw.lastCopiedAt === "number" ? raw.lastCopiedAt : undefined,
    source: analysis.sourceName,
    kind,
    bucket:
      raw.bucket === "archive" || raw.bucket === "snippet" || raw.bucket === "history"
        ? raw.bucket
        : "history",
    favorite: Boolean(raw.favorite),
    tags: generateTags(raw.content, settings),
    copyCount: typeof raw.copyCount === "number" ? raw.copyCount : 0,
    analysis,
    payloadKind,
    sourceApp: raw.sourceApp,
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

function getBucketForView(view: ViewKey): ClipBucket | "trash" | null {
  if (view === "history") return "history";
  if (view === "trash") return "trash";
  if (view === "favorites") return null;
  return null;
}

function isFavoriteView(view: ViewKey): boolean {
  return view === "favorites";
}

function getDisplayText(item: ClipItem, settings: AppSettings) {
  if (settings.contentDisplayMode === "raw") return item.content.replace(/\s+/g, " ").trim();
  if (settings.contentDisplayMode === "middle") return middleEllipsis(item.content);
  return item.analysis.summary || middleEllipsis(item.content);
}

function getClipboardLine(item: ClipItem) {
  return middleEllipsis(item.content, 44, 18) || item.analysis.title;
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

function logAppError(level: "info" | "warn" | "error", message: string, context?: unknown) {
  const contextText =
    typeof context === "string" ? context : context ? JSON.stringify(context).slice(0, 2000) : "";
  invoke("append_app_log", { level, message, context: contextText }).catch(() => {
    if (level === "error") console.error(message, context);
  });
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { errorMessage: string | null; resetKey: number }> {
  state = { errorMessage: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error) {
    return { errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError("error", error.message, info.componentStack);
  }

  render() {
    return (
      <>
        <div key={this.state.resetKey}>{this.props.children}</div>
        {this.state.errorMessage ? (
          <div className="runtime-error-toast" role="status">
            <Clipboard size={16} />
            <span>界面异常已记录，剪贴板服务仍在运行。</span>
            <button
              className="text-button"
              onClick={() => this.setState((state) => ({ errorMessage: null, resetKey: state.resetKey + 1 }))}
              type="button"
            >
              恢复界面
            </button>
          </div>
        ) : null}
      </>
    );
  }
}

class PanelContentBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError("error", `Panel content failed: ${error.message}`, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="panel-fallback">
          <Clipboard size={22} />
          <strong>当前内容渲染失败</strong>
          <span>错误已写入日志，切换列表或重新触发面板可恢复。</span>
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
  const [activeTypeFilter, setActiveTypeFilter] = useState<"all" | ClipKind>("all");
  const [filterFavorite, setFilterFavorite] = useState(false);
  const [activeView, setActiveView] = useState<ViewKey>("history");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [isMultiPreviewOpen, setMultiPreviewOpen] = useState(false);
  const [isSearchActive, setSearchActive] = useState(false);
  const [nativeStatus, setNativeStatus] = useState("准备监听剪贴板");
  const [lastCopiedId, setLastCopiedId] = useState<string | null>(null);
  const [keyboardNavigating, setKeyboardNavigating] = useState(false);
  const [, setIsReadingClipboard] = useState(false);
  const [isPanelEntering, setIsPanelEntering] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isFooterHidden, setFooterHidden] = useState(false);
  const [isSearchCompact, setSearchCompact] = useState(false);
  const lastScrollRef = useRef(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 120);
  const clipsRef = useRef<ClipItem[]>(clips);
  const shellRef = useRef<HTMLElement | null>(null);
  const settingsRef = useRef<AppSettings>(settings);
  const configReadyRef = useRef(false);
  const configWriteTimerRef = useRef<number | null>(null);
  const captureInFlightRef = useRef(false);
  const lastSeenClipboard = useRef("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const scrollAccelRef = useRef<number | null>(null);
  const isPanelClosing = usePanelUiStore((state) => state.isClosing);
  const setPanelClosing = usePanelUiStore((state) => state.setClosing);
  const previewClip = usePanelUiStore((state) => state.previewClip);
  const setPreviewClip = usePanelUiStore((state) => state.setPreviewClip);
  const isPreviewOpen = usePanelUiStore((state) => state.isPreviewOpen);
  const setPreviewOpen = usePanelUiStore((state) => state.setPreviewOpen);
  const workspaceRoute = useWorkspaceStore((state) => state.route);

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

  const handleScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      if (!settings.enableScrollCollapse) return;
      const node = event.currentTarget;
      const top = node.scrollTop;
      const delta = top - lastScrollRef.current;
      lastScrollRef.current = top;
      setScrollOffset(top);
      setSearchCompact(top > 18);
      if (delta > 6 && top > 40) {
        setFooterHidden(true);
      } else if (delta < -6 || top <= 10) {
        setFooterHidden(false);
      }
    },
    [settings.enableScrollCollapse],
  );

  useEffect(() => {
    settingsRef.current = settings;
    if (configReadyRef.current) {
      if (configWriteTimerRef.current) window.clearTimeout(configWriteTimerRef.current);
      configWriteTimerRef.current = window.setTimeout(() => {
        invoke("write_user_settings", { settings }).catch((error) =>
          logAppError("warn", "Sync user settings failed", String(error)),
        );
      }, 220);
    }
    return () => {
      if (configWriteTimerRef.current) window.clearTimeout(configWriteTimerRef.current);
    };
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_VIEW_KEY, activeView);
  }, [activeView]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (scrollAccelRef.current) window.clearInterval(scrollAccelRef.current);
    };
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
        if (settingsRef.current.panelPinned) return;
        hideTimer = window.setTimeout(() => {
          setPanelClosing(true);
          closeTimer = window.setTimeout(() => {
            appWindow.hide().catch((error) => logAppError("warn", "Hide quick panel failed", String(error)));
            setPanelClosing(false);
          }, 180);
        }, 180);
      })
      .catch((error) => logAppError("warn", "Register focus listener failed", String(error)));
    return cancelHide;
  }, [isSettingsWindow, setPanelClosing]);

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
        if (!payload.canReadFocusedInput) {
          setNativeStatus("辅助功能未授权，面板会贴到鼠标所在屏幕右侧");
        }
      })
      .catch((error) => logAppError("warn", "Check accessibility permission failed", String(error)));
    invoke<DbInitPayload>("init_clip_database")
      .then((payload) => {
        if (cancelled) return;
        logAppError("info", `Clip database ready at ${payload.path}`);
        if (isSettingsWindow) return null;
        return invoke<QueryClipPayload>("query_clip_records", {
          text: "",
          bucket: "all",
          limit: 200,
        });
      })
      .then((payload) => {
        if (!payload || cancelled || isSettingsWindow) return;
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
        configReadyRef.current = true;
        settingsRef.current = merged;
        setSettings(merged);
        if (!isSettingsWindow) {
          setClips((items) => retagClips(items, merged).slice(0, merged.maxStoredItems));
        }
      })
      .catch(() => {
        if (cancelled) return;
        configReadyRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [isSettingsWindow]);

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
      // poll 之间允许并发：去重由 lastSeenClipboard + changeCount 负责
      if (reason !== "poll" && captureInFlightRef.current) return;
      if (reason !== "poll") captureInFlightRef.current = true;
      if (reason === "manual") {
        setIsReadingClipboard(true);
        setNativeStatus("正在读取系统剪贴板");
      }
      try {
        const response = await invoke<NativeClipboard>("read_clipboard_text");
        const text = response.text?.trim();
        if (!text) {
          if (reason !== "poll") setNativeStatus("剪贴板为空或不是文本");
          return;
        }
        // 任何来源都需要做一次去重，避免 startup 阶段把同一个文本再写一遍
        if (text === lastSeenClipboard.current) {
          return;
        }
        lastSeenClipboard.current = text;
        const result = await promoteClipboardText(text);
        if (result === "created") {
          setNativeStatus(
            reason === "startup"
              ? "启动已捕获系统剪贴板"
              : reason === "manual"
                ? "已记录当前系统剪贴板"
                : reason === "shortcut"
                  ? "已通过快捷键记录新复制"
                  : "已捕获新复制",
          );
        } else {
          setNativeStatus("当前系统剪贴板已置顶");
        }
      } catch {
        if (reason !== "poll") setNativeStatus("浏览器预览模式：原生剪贴板在 Tauri 中启用");
      } finally {
        if (reason !== "poll") captureInFlightRef.current = false;
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
      setActiveTypeFilter("all");
      setFilterFavorite(false);
      setSearchActive(true);
      setPreviewOpen(false);
      setIsPanelEntering(true);
      // 唤起面板时强制拉一次最新剪贴板，避免用户在别的 app 复制后到唤起之间漏掉记录
      window.setTimeout(() => setIsPanelEntering(false), 180);
      window.setTimeout(() => {
        searchRef.current?.focus();
        setNativeStatus(reason === "tray" ? "面板已聚焦，可搜索或方向键选择" : "快捷面板已聚焦");
      }, 20);
      window.setTimeout(() => {
        void captureClipboard("manual");
      }, 40);
    },
    [captureClipboard, setPreviewOpen],
  );

  const handleWindowDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, textarea, select, a, [role='menuitem']")) return;
    getCurrentWindow()
      .startDragging()
      .catch((error) => logAppError("warn", "Start window dragging failed", String(error)));
  }, []);

  // 后台剪贴板监听：Rust 线程每 100ms 读 pbpaste，变化时推 event
  // 前端只需 listen，不依赖 WebView timer，隐藏时也能工作
  useEffect(() => {
    if (isSettingsWindow) return;
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      unlisten = await listen<{ changeCount: number; hasChange: boolean; preview?: string; previewLen?: number }>("clipboard-changed", async (event) => {
        const payload = event.payload;
        console.log("[CLIPBOARD] frontend received change:", payload);
        if (!payload.hasChange) return;
        // 后端已入库，前端直接从数据库刷新列表
        try {
          const result = await invoke<QueryClipPayload>("query_clip_records", {
            text: "",
            bucket: "all",
            limit: 200,
          });
          const items = result.items
            .map((item) => normalizeClip(item, settingsRef.current))
            .filter((item): item is ClipItem => Boolean(item));
          clipsRef.current = items;
          setClips(items);
          setNextCursor(result.nextCursor ?? null);
          if (items.length > 0) {
            setSelectedId(items[0].id);
            setActiveView("history");
          }
          if (payload.preview) {
            lastSeenClipboard.current = payload.preview.trim();
          }
          setNativeStatus("已捕获新复制");
        } catch (error) {
          console.error("[CLIPBOARD] refresh failed:", error);
        }
      });
      console.log("[CLIPBOARD] frontend listener registered");
      setNativeStatus("后台剪贴板监听已启动");
    };
    void setup();
    void captureClipboard("startup");
    return () => {
      if (unlisten) unlisten();
    };
  }, [captureClipboard, isSettingsWindow]);

  useEffect(() => {
    if (isSettingsWindow) return;
    if (!settings.cleanupEnabled) return;
    const runCleanup = () => {
      invoke("cleanup_clip_records", { retentionDays: settings.softDeletedRetentionDays })
        .then(() => logAppError("info", "Cleanup completed"))
        .catch((error) => logAppError("warn", "Cleanup failed", String(error)));
    };
    const timer = window.setInterval(runCleanup, settings.cleanupIntervalHours * 60 * 60 * 1000);
    runCleanup();
    return () => window.clearInterval(timer);
  }, [isSettingsWindow, settings.cleanupEnabled, settings.cleanupIntervalHours, settings.softDeletedRetentionDays]);

  useEffect(() => {
    if (isSettingsWindow) return;
    const appWindow = getCurrentWindow();
    const unlisteners: Array<() => void> = [];
    appWindow
      .listen<string>("clipforge://show-quick-panel", ({ payload }) => {
        showQuickPanel(payload === "tray" ? "tray" : "shortcut");
      })
      .then((unlisten) => unlisteners.push(unlisten))
      .catch((error) => logAppError("warn", "Register tray listener failed", String(error)));
    appWindow
      .listen<string>("clipforge://hide-quick-panel", () => {
        setPanelClosing(true);
        window.setTimeout(() => {
          appWindow.hide().catch((error) => logAppError("warn", "Hide quick panel failed", String(error)));
          setPanelClosing(false);
        }, 160);
      })
      .then((unlisten) => unlisteners.push(unlisten))
      .catch((error) => logAppError("warn", "Register quick panel hide listener failed", String(error)));
    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [isSettingsWindow, setPanelClosing, showQuickPanel]);

  const baseSearchSuggestions = useMemo<SearchSuggestion[]>(() => {
    const visible = clips.filter((item) => !item.deletedAt);
    const countKind = (kind: ClipKind) => visible.filter((item) => item.kind === kind).length;
    const base: SearchSuggestion[] = [
      { id: "all", label: "全部内容", hint: `${visible.length}`, kind: "all", typeFilter: "all" },
      { id: "favorite", label: "收藏", hint: `${visible.filter((item) => item.favorite).length}`, kind: "favorite" },
      { id: "link", label: "链接", hint: `${countKind("link")}`, kind: "type", typeFilter: "link" },
      { id: "attachment", label: "文件", hint: `${countKind("attachment")}`, kind: "type", typeFilter: "attachment" },
      { id: "code", label: "代码", hint: `${countKind("code")}`, kind: "type", typeFilter: "code" },
      { id: "command", label: "命令", hint: `${countKind("command")}`, kind: "type", typeFilter: "command" },
      { id: "markdown", label: "Markdown", hint: `${countKind("markdown")}`, kind: "type", typeFilter: "markdown" },
    ];
    const saved = settings.tagRules
      .map((rule) => rule.label.trim())
      .filter(Boolean)
      .slice(0, 4)
      .map<SearchSuggestion>((tag) => ({ id: `saved:${tag}`, label: tag, hint: "规则", kind: "saved", tag }));
    return [...base, ...saved].filter((item) => item.kind === "all" || item.hint !== "0");
  }, [clips, settings.tagRules]);

  const parsedSearchCommand = useMemo(
    () => parseSearchCommand(debouncedQuery, baseSearchSuggestions),
    [baseSearchSuggestions, debouncedQuery],
  );

  const effectiveQuery = parsedSearchCommand.handled ? parsedSearchCommand.queryText : debouncedQuery;
  const effectiveTypeFilter =
    activeTypeFilter !== "all" ? activeTypeFilter : parsedSearchCommand.typeFilter;
  const effectiveFilterFavorite = filterFavorite || parsedSearchCommand.filterFavorite;
  const effectiveActiveTag = activeTag ?? parsedSearchCommand.tag;

  const filteredClips = useMemo(() => {
    const bucket = getBucketForView(activeView);
    let bucketSource = clips;
    if (activeView === "trash") {
      bucketSource = clips.filter((item) => item.deletedAt);
    } else {
      bucketSource = clips.filter((item) => !item.deletedAt);
      if (isFavoriteView(activeView)) {
        bucketSource = bucketSource.filter((item) => item.favorite);
      } else if (bucket) {
        bucketSource = bucketSource.filter((item) => item.bucket === bucket);
      }
    }
    const activeSavedSearch = effectiveActiveTag
      ? settings.tagRules.find((rule) => rule.label.trim() === effectiveActiveTag)
      : undefined;
    return bucketSource.filter((item) => {
      if (effectiveTypeFilter !== "all" && item.kind !== effectiveTypeFilter) return false;
      if (effectiveFilterFavorite && !item.favorite && !isFavoriteView(activeView)) return false;
      const matchesQuery = effectiveQuery.trim() ? matchesSearchTerm(item, effectiveQuery, settings) : true;
      const matchesTag = effectiveActiveTag
        ? item.tags.includes(effectiveActiveTag) || Boolean(activeSavedSearch && matchesSavedSearch(item, activeSavedSearch, settings))
        : true;
      return matchesQuery && matchesTag;
    });
  }, [
    activeView,
    clips,
    effectiveActiveTag,
    effectiveFilterFavorite,
    effectiveQuery,
    effectiveTypeFilter,
    settings,
  ]);

  const selectedClip = useMemo(() => {
    if (selectedId) {
      const found = clips.find((item) => item.id === selectedId);
      if (found) return found;
    }
    return filteredClips[0] ?? null;
  }, [clips, filteredClips, selectedId]);

  useEffect(() => {
    if (!selectedClip) {
      if (previewClip) setPreviewClip(null);
      return;
    }
    if (!previewClip || previewClip.id !== selectedClip.id) {
      setPreviewClip(selectedClip);
    }
  }, [clips, previewClip, selectedClip, setPreviewClip]);

  const selectedInList = useMemo(() => {
    return filteredClips.filter((item) => selectedIds.has(item.id));
  }, [filteredClips, selectedIds]);

  const searchSuggestions = useMemo<SearchSuggestion[]>(() => {
    const token = query.trim();
    if (!isSearchActive) return [];
    if (!token || !token.startsWith("@")) return baseSearchSuggestions.slice(0, 6);
    const commandToken = token.slice(0, token.search(/\s/) > -1 ? token.search(/\s/) : token.length);
    return baseSearchSuggestions
      .filter((item) => matchesSearchSuggestionToken(item, commandToken))
      .slice(0, 8);
  }, [baseSearchSuggestions, isSearchActive, query]);

  const aggregatePreview = useMemo(() => {
    return selectedInList.map((item) => item.content.trim()).filter(Boolean).join("\n\n");
  }, [selectedInList]);

  const previewLinks = useMemo(() => (previewClip ? extractUrls(previewClip.content) : []), [previewClip]);

  const focusSearch = useCallback(() => {
    setSearchActive(true);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setQuery(value);
    if (!value.trimStart().startsWith("@")) {
      setActiveTag(null);
      setFilterFavorite(false);
      setActiveTypeFilter("all");
    }
  }, []);

  const closeSearchIfEmpty = useCallback(() => {
    if (!query.trim()) setSearchActive(false);
  }, [query]);

  function applySearchSuggestion(suggestion: SearchSuggestion) {
    setActiveTag(null);
    setFilterFavorite(false);
    setActiveTypeFilter("all");
    if (suggestion.kind === "all") {
      setQuery("");
    } else {
      setQuery(`${getSearchSuggestionToken(suggestion)} `);
    }
    setSearchActive(true);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }

  function markClipCopied(item: ClipItem, status: string) {
    const now = Date.now();
    setLastCopiedId(item.id);
    setNativeStatus(status);
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

  async function copyClip(item: ClipItem) {
    try {
      await invoke("write_clipboard_text", { text: item.content });
      lastSeenClipboard.current = item.content.trim();
      markClipCopied(item, "已复制到系统剪贴板");
    } catch {
      await navigator.clipboard.writeText(item.content);
      markClipCopied(item, "已复制到浏览器剪贴板");
    }
  }

  async function pasteClip(item: ClipItem) {
    try {
      await invoke("paste_clipboard_text", { text: item.content });
      lastSeenClipboard.current = item.content.trim();
      markClipCopied(item, "已粘贴到当前应用");
    } catch (error) {
      logAppError("warn", "Paste clip failed", String(error));
      await copyClip(item);
      setNativeStatus("粘贴失败，已复制到剪贴板");
    }
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
    setSelectedIds(new Set());
    setMultiSelectMode(false);
    setMultiPreviewOpen(false);
  }

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.isComposing) return;

      const target = event.target as HTMLElement | null;
      const editable = target?.closest("input, textarea, select, [contenteditable='true']");
      const quickItems = filteredClips;

      // 删除选中项：Ctrl+X 或 Delete（不处于编辑态时）
      if ((event.ctrlKey && event.key.toLowerCase() === "x") || event.key === "Delete") {
        if (editable) return;
        event.preventDefault();
        if (multiSelectMode && selectedInList.length > 0) {
          void deleteClips(selectedInList.map((item) => item.id));
        } else if (selectedClip) {
          void deleteClips([selectedClip.id]);
        }
        return;
      }

      if (event.ctrlKey || event.altKey) return;

      // 普通数字键必须保留给搜索输入；只有 Cmd+数字才作用于列表条目。
      if (event.metaKey && /^[1-9]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        const item = quickItems.slice(0, settingsRef.current.quickItemLimit)[index];
        if (!item) return;
        event.preventDefault();
        setSelectedId(item.id);
        setPreviewClip(item);
        if (multiSelectMode) {
          setPreviewOpen(false);
          setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
          });
          return;
        }
        void pasteClip(item);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        if (workspaceRoute.name !== "list") {
          setPreviewOpen(false);
          setMultiPreviewOpen(false);
          void navigateWorkspaceList();
          return;
        }
        if (isMultiPreviewOpen) {
          setMultiPreviewOpen(false);
          void navigateWorkspaceList();
          return;
        }
        if (multiSelectMode) {
          setSelectedIds(new Set());
          setMultiSelectMode(false);
          void navigateWorkspaceList();
          return;
        }
        if (isPreviewOpen) {
          setPreviewOpen(false);
          void navigateWorkspaceList();
          return;
        }
        if (query.trim()) {
          setQuery("");
          setActiveTag(null);
          setFilterFavorite(false);
          setActiveTypeFilter("all");
          focusSearch();
          return;
        }
        if (isSearchActive) {
          setSearchActive(false);
          searchRef.current?.blur();
          return;
        }
        if (!settingsRef.current.panelPinned) {
          getCurrentWindow().hide().catch((error) => logAppError("warn", "Hide quick panel failed", String(error)));
        }
        return;
      }

      if (event.metaKey) return;

      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        if (editable && editable !== searchRef.current) return;
        event.preventDefault();
        if (event.key === "ArrowRight") {
          if (!multiSelectMode && selectedClip) {
            void navigateWorkspaceDetail(selectedClip.id);
          }
        } else if (workspaceRoute.name !== "list") {
          setPreviewOpen(false);
          setMultiPreviewOpen(false);
          void navigateWorkspaceList();
        } else if (isMultiPreviewOpen) {
          setMultiPreviewOpen(false);
          void navigateWorkspaceList();
        } else if (isPreviewOpen) {
          setPreviewOpen(false);
          void navigateWorkspaceList();
        } else if (multiSelectMode) {
          setSelectedIds(new Set());
          setMultiSelectMode(false);
        }
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (editable && editable !== searchRef.current) return;
        event.preventDefault();
        setKeyboardNavigating(true);
        const currentIndex = Math.max(
          0,
          quickItems.findIndex((item) => item.id === selectedId),
        );
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const offset = direction * (event.repeat ? 4 : 1);
        const nextIndex = Math.min(Math.max(currentIndex + offset, 0), quickItems.length - 1);
        const nextItem = quickItems[nextIndex];
        if (nextItem) {
          setSelectedId(nextItem.id);
          setPreviewClip(nextItem);
        }
        return;
      }

      if (event.key === "Enter") {
        if (editable === searchRef.current && query.trimStart().startsWith("@") && searchSuggestions.length > 0) {
          event.preventDefault();
          applySearchSuggestion(searchSuggestions[0]);
          return;
        }
        if (editable && editable !== searchRef.current) return;
        const item = quickItems.find((clip) => clip.id === selectedId) ?? quickItems[0];
        if (!item) return;
        event.preventDefault();
        if (multiSelectMode) void copySelectedClips(selectedInList);
        else void pasteClip(item);
        return;
      }

      if (event.key === " ") {
        const item = quickItems.find((clip) => clip.id === selectedId) ?? quickItems[0];
        if (!item || editable) return;
        event.preventDefault();
        setKeyboardNavigating(true);
        setSelectedIds((current) => {
          const next = new Set(current);
          if (next.has(item.id)) next.delete(item.id);
          else next.add(item.id);
          return next;
        });
        if (!multiSelectMode) {
          setMultiSelectMode(true);
        }
        setPreviewClip(item);
        setPreviewOpen(true);
        return;
      }

      if ((event.key === "/" || event.key.length === 1) && !editable && !multiSelectMode) {
        focusSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    filteredClips,
    focusSearch,
    isPreviewOpen,
    isMultiPreviewOpen,
    isSearchActive,
    multiSelectMode,
    previewClip,
    query,
    selectedId,
    selectedInList,
    searchSuggestions,
    setPreviewClip,
    setPreviewOpen,
    workspaceRoute.name,
  ]);

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
    const updatedAt = Date.now();
    invoke("update_clip_record", {
      input: {
        id,
        bucket: next.bucket,
        favorite: typeof next.favorite === "boolean" ? next.favorite : undefined,
      },
    }).catch((error) => logAppError("warn", "Update clip failed", String(error)));
    setClips((current) => {
      const updated = current.map((item) =>
        item.id === id ? { ...item, ...next, updatedAt } : item,
      );
      clipsRef.current = updated;
      return updated;
    });
    if (previewClip?.id === id) {
      setPreviewClip({ ...previewClip, ...next, updatedAt });
    }
  }

  async function deleteClips(ids: string[]) {
    const now = Date.now();
    try {
      await invoke("soft_delete_clip_records", { ids });
      setNativeStatus(`已移入垃圾箱 ${ids.length} 条`);
    } catch (error) {
      logAppError("warn", "Soft delete failed", String(error));
      setNativeStatus("软删除失败，查看日志");
      return;
    }
    // 软删除后保留在 clips 中以支持垃圾箱视图，仅设置 deletedAt 标记
    setClips((current) =>
      current.map((item) => (ids.includes(item.id) ? { ...item, deletedAt: now } : item)),
    );
    setSelectedIds(new Set());
    setMultiSelectMode(false);
    if (selectedId && ids.includes(selectedId)) setSelectedId(null);
  }

  async function restoreClips(ids: string[]) {
    try {
      await invoke("restore_clip_records", { ids });
      setNativeStatus(`已恢复 ${ids.length} 条`);
    } catch (error) {
      logAppError("warn", "Restore failed", String(error));
      setNativeStatus("恢复失败，查看日志");
      return;
    }
    setClips((current) =>
      current.map((item) =>
        ids.includes(item.id) ? { ...item, deletedAt: null, bucket: "history" } : item,
      ),
    );
    setSelectedIds(new Set());
    setMultiSelectMode(false);
  }

  async function hardDeleteClips(ids: string[]) {
    try {
      await invoke("hard_delete_clip_records", { ids });
      setNativeStatus(`已彻底删除 ${ids.length} 条`);
    } catch (error) {
      logAppError("warn", "Hard delete failed", String(error));
      setNativeStatus("彻底删除失败，查看日志");
      return;
    }
    setClips((current) => current.filter((item) => !ids.includes(item.id)));
    setSelectedIds(new Set());
    setMultiSelectMode(false);
  }

  return (
    <main
      className={`app-shell view-${activeView} density-${settings.panelDensity}${isSearchActive || query ? " search-active" : ""}${isPreviewOpen && previewClip && !multiSelectMode ? " preview-active" : ""}${multiSelectMode ? " multi-selecting" : ""}${isPanelEntering ? " is-entering" : ""}${isPanelClosing ? " is-closing" : ""}${isFooterHidden ? " footer-hidden" : ""}${isSearchCompact ? " search-compact" : ""}${scrollOffset > 0 ? " scrolled" : ""}`}
      ref={shellRef}
      style={{ "--cf-panel-bg-opacity": settings.panelBackgroundOpacity } as CSSProperties}
    >
      <div aria-hidden="true" className="drag-strip" data-tauri-drag-region onPointerDown={handleWindowDrag} />

      <section className="content-column" onScroll={handleScroll}>
        <GlassSearchBar
          inputRef={searchRef}
          isActive={isSearchActive || query.length > 0}
          onApplySuggestion={applySearchSuggestion}
          onBlur={closeSearchIfEmpty}
          onChange={handleSearchChange}
          onClear={() => {
            setQuery("");
            setActiveTag(null);
            setFilterFavorite(false);
            setActiveTypeFilter("all");
            searchRef.current?.focus();
          }}
          onFocus={() => setSearchActive(true)}
          parsedSearchCommand={parsedSearchCommand}
          query={query}
          suggestions={searchSuggestions}
        />

        {multiSelectMode ? (
          <MultiSelectToolbar
            allSelected={selectedInList.length > 0 && selectedInList.length === filteredClips.length}
            count={selectedInList.length}
            onClose={() => {
              setSelectedIds(new Set());
              setMultiPreviewOpen(false);
              setMultiSelectMode(false);
              void navigateWorkspaceList();
            }}
            onCopy={() => copySelectedClips(selectedInList)}
            onDelete={() => deleteClips(selectedInList.map((item) => item.id))}
            onToggleAll={(checked) => {
              setSelectedIds(checked ? new Set(filteredClips.map((item) => item.id)) : new Set());
            }}
          />
        ) : null}

        {isPreviewOpen && previewClip && !multiSelectMode ? (
          <PreviewBand
            clip={previewClip}
            links={previewLinks}
            onClose={() => setPreviewOpen(false)}
            onCopy={copyClip}
            onOpen={openClipTarget}
          />
        ) : null}

        <PanelContentBoundary resetKey={`workspace:${activeView}:${selectedId ?? "none"}:${filteredClips.length}:${selectedInList.length}`}>
          <WorkspaceRouterProvider
            renderList={() =>
              activeView === "trash" ? (
                <TrashPanel
                  activeId={selectedClip?.id ?? null}
                  autoScroll={keyboardNavigating}
                  clips={filteredClips}
                  hasMore={Boolean(nextCursor)}
                  isLoadingMore={isLoadingMore}
                  multiSelectMode={multiSelectMode}
                  onCopy={copyClip}
                  onDeleteSelected={() => hardDeleteClips(selectedInList.map((item) => item.id))}
                  onHardDelete={(item) => hardDeleteClips([item.id])}
                  onLoadMore={loadMoreClips}
                  onPointerActive={() => setKeyboardNavigating(false)}
                  onRestore={(item) => restoreClips([item.id])}
                  onRestoreSelected={() => restoreClips(selectedInList.map((item) => item.id))}
                  onSelect={(item) => {
                    setSelectedId(item.id);
                  }}
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
              ) : (
                <QuickPastePanel
                  activeId={selectedClip?.id ?? null}
                  autoScroll={keyboardNavigating}
                  clips={filteredClips}
                  copiedId={lastCopiedId}
                  hasMore={Boolean(nextCursor)}
                  isLoadingMore={isLoadingMore}
                  limit={settings.quickItemLimit}
                  multiSelectMode={multiSelectMode}
                  selectedIds={selectedIds}
                  onPaste={pasteClip}
                  onFavorite={(item) => updateClip(item.id, { favorite: !item.favorite })}
                  onLoadMore={loadMoreClips}
                  onOpen={openClipTarget}
                  onOpenDetail={(item) => {
                    setPreviewOpen(true);
                    void navigateWorkspaceDetail(item.id);
                  }}
                  onPointerActive={() => setKeyboardNavigating(false)}
                  onSelect={(item) => {
                    setSelectedId(item.id);
                  }}
                  onStartMultiSelect={(id) => {
                    setMultiSelectMode(true);
                    setPreviewOpen(false);
                    setMultiPreviewOpen(false);
                    setSelectedIds(new Set([id]));
                  }}
                  onToggleSelected={(id) =>
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                />
              )
            }
            renderDetail={(clipId) => {
              const clip = clips.find((item) => item.id === clipId) ?? selectedClip;
              return (
                <ClipDetailWorkspace
                  clip={clip}
                  links={clip ? extractUrls(clip.content) : []}
                  onBack={() => {
                    setPreviewOpen(false);
                    void navigateWorkspaceList();
                  }}
                  onCopy={copyClip}
                  onOpen={openClipTarget}
                />
              );
            }}
            renderAggregate={() => (
              <MultiAggregateWorkspace
                aggregatePreview={aggregatePreview}
                items={selectedInList}
                onBack={() => {
                  setMultiPreviewOpen(false);
                  void navigateWorkspaceList();
                }}
                onCopy={() => copySelectedClips(selectedInList)}
                onExportTable={() => {
                  const table = selectedInList.map((item) => [item.analysis.title, item.content.replace(/\s+/g, " ")]).map((row) => row.join("\t")).join("\n");
                  void navigator.clipboard.writeText(table);
                  setNativeStatus("已导出选中内容为 TSV 表格");
                }}
              />
            )}
          />
        </PanelContentBoundary>
      </section>

      <button
        aria-label={settings.panelPinned ? "取消固定窗体" : "固定窗体"}
        className={`panel-pin-fab${settings.panelPinned ? " active" : ""}`}
        onClick={() => {
          const nextPinned = !settings.panelPinned;
          setSettings((prev) => ({ ...prev, panelPinned: nextPinned }));
          invoke("set_panel_pinned_command", { pinned: nextPinned }).catch((error) =>
            logAppError("warn", "Toggle panel pin failed", String(error)),
          );
        }}
        title="固定窗体"
        type="button"
      >
        <Pin size={12} />
      </button>
      <BottomDock
        activeView={activeView}
        onDrag={handleWindowDrag}
        onOpenSettings={() => {
          invoke("open_settings_window").catch((error) =>
            logAppError("warn", "Open settings window failed", String(error)),
          );
        }}
        onViewChange={(view) => {
          setActiveView(view);
          setSelectedIds(new Set());
          setMultiSelectMode(false);
          setPreviewOpen(false);
          void navigateWorkspaceList();
        }}
        status={nativeStatus}
      />
    </main>
  );
}

function GlassSearchBar({
  inputRef,
  isActive,
  onApplySuggestion,
  onBlur,
  onChange,
  onClear,
  onFocus,
  parsedSearchCommand,
  query,
  suggestions,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  isActive: boolean;
  onApplySuggestion: (suggestion: SearchSuggestion) => void;
  onBlur: () => void;
  onChange: (value: string) => void;
  onClear: () => void;
  onFocus: () => void;
  parsedSearchCommand: ParsedSearchCommand;
  query: string;
  suggestions: SearchSuggestion[];
}) {
  if (!isActive) {
    return (
      <header className="toolbar">
        <button
          aria-label="开始搜索"
          className="floating-search-pill"
          onClick={onFocus}
          onFocus={onFocus}
          type="button"
        >
          <Search size={13} />
          <span>搜索剪贴板</span>
          <kbd>/</kbd>
        </button>
      </header>
    );
  }

  return (
    <header className="toolbar">
      <div className="floating-search-surface">
        <div className="search-wrap input-group">
          <span className="input-addon input-addon-start">
            <Search size={14} />
          </span>
          <input
            aria-label="搜索剪贴板"
            autoComplete="off"
            onBlur={onBlur}
            onFocus={onFocus}
            onChange={(event) => onChange(event.currentTarget.value)}
            placeholder="按 / 搜索剪贴板历史"
            ref={inputRef}
            spellCheck={false}
            value={query}
          />
          {query ? (
            <button aria-label="清空搜索" className="icon-button subtle" onClick={onClear} type="button">
              <X size={14} />
            </button>
          ) : null}
        </div>
        {suggestions.length ? (
          <FilterChips
            onApplySuggestion={onApplySuggestion}
            parsedSearchCommand={parsedSearchCommand}
            suggestions={suggestions}
          />
        ) : null}
      </div>
    </header>
  );
}

function FilterChips({
  onApplySuggestion,
  parsedSearchCommand,
  suggestions,
}: {
  onApplySuggestion: (suggestion: SearchSuggestion) => void;
  parsedSearchCommand: ParsedSearchCommand;
  suggestions: SearchSuggestion[];
}) {
  return (
    <div className="search-suggestions" role="listbox" aria-label="搜索建议">
      {suggestions.map((suggestion) => (
        <button
          className={[
            "search-suggestion",
            suggestion.kind === "favorite" && parsedSearchCommand.filterFavorite ? "active" : "",
            suggestion.kind === "type" && parsedSearchCommand.typeFilter === suggestion.typeFilter ? "active" : "",
            suggestion.kind === "saved" && parsedSearchCommand.tag === suggestion.tag ? "active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          key={suggestion.id}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onApplySuggestion(suggestion)}
          role="option"
          type="button"
        >
          <span>{getSearchSuggestionToken(suggestion)}</span>
          <em>{suggestion.hint}</em>
        </button>
      ))}
    </div>
  );
}

function getPreviewBodyText(clip: ClipItem) {
  const text = clip.content.trim();
  if (!text) return clip.analysis.title;
  return text;
}

function PreviewBand({
  clip,
  links,
  onClose,
  onCopy,
  onOpen,
}: {
  clip: ClipItem;
  links: string[];
  onClose: () => void;
  onCopy: (clip: ClipItem) => void;
  onOpen: (clip: ClipItem) => void;
}) {
  return (
    <section className="inline-preview-band quick-preview-band" aria-label="快速预览">
      <div className="quick-preview-card">
        <div className="quick-preview-actions">
          {clip.analysis.url || clip.analysis.attachment ? (
            <button className="icon-button subtle" onClick={() => onOpen(clip)} title="打开" type="button">
              <ExternalLink size={13} />
            </button>
          ) : null}
          <button className="icon-button subtle" onClick={() => onCopy(clip)} title="复制" type="button">
            <Copy size={13} />
          </button>
          <button className="icon-button subtle" onClick={onClose} title="关闭预览" type="button">
            <X size={13} />
          </button>
        </div>
        <div className="quick-preview-body">
          <p>{getPreviewBodyText(clip)}</p>
          {links.length ? (
            <div className="preview-link-row" aria-label="内容链接">
              {links.slice(0, 4).map((url) => (
                <button className="preview-link-chip" key={url} onClick={() => openUrl(url)} type="button">
                  <ExternalLink size={11} />
                  <span>{new URL(url).hostname.replace(/^www\./, "")}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="quick-preview-footer">
          <span className={`kind-pill ${clip.kind}`}>{getClipboardContentKind(clip)}</span>
          <span className="quick-preview-hint">Space 关闭 · → 详情</span>
        </div>
      </div>
    </section>
  );
}

function MultiSelectToolbar({
  allSelected,
  count,
  onClose,
  onCopy,
  onDelete,
  onToggleAll,
}: {
  allSelected: boolean;
  count: number;
  onClose: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onToggleAll: (checked: boolean) => void;
}) {
  return (
    <section className="multi-select-toolbar" aria-label="多选操作台">
      <div className="multi-drawer-handle" aria-hidden="true">
        <span />
      </div>
      <div className="multi-toolbar-head">
        <div className="multi-toolbar-title-group">
          <span className="multi-toolbar-title">多选</span>
          <span className="multi-toolbar-count">{count > 0 ? `${count} 项` : "点击项目选择"}</span>
        </div>
        <div className="multi-toolbar-actions">
          <label className="multi-select-all">
            <input checked={allSelected} onChange={(event) => onToggleAll(event.currentTarget.checked)} type="checkbox" />
            <span>全选</span>
          </label>
          <button className="primary-button" disabled={count === 0} onClick={onCopy} type="button">
            <Copy size={13} />
            复制
          </button>
          <button className="danger-button" disabled={count === 0} onClick={onDelete} type="button">
            <Trash2 size={13} />
            删除
          </button>
          <button aria-label="关闭多选" className="icon-button subtle" onClick={onClose} type="button">
            <X size={13} />
          </button>
        </div>
      </div>
      <div className="multi-toolbar-hint">
        <kbd>Space</kbd> 选择 · <kbd>Ctrl</kbd>+<kbd>X</kbd> 删除 · <kbd>Esc</kbd> 退出
      </div>
    </section>
  );
}

function BottomDock({
  activeView,
  onDrag,
  onOpenSettings,
  onViewChange,
  status,
}: {
  activeView: ViewKey;
  onDrag: (event: PointerEvent<HTMLElement>) => void;
  onOpenSettings: () => void;
  onViewChange: (view: ViewKey) => void;
  status: string;
}) {
  return (
    <footer className="list-footer" data-tauri-drag-region onPointerDown={onDrag}>
      <StatusLine status={status} />
      <div className="footer-actions" onPointerDown={(event) => event.stopPropagation()}>
        <button
          aria-label="历史"
          className={activeView === "history" ? "icon-button active" : "icon-button subtle"}
          onClick={() => onViewChange("history")}
          title="历史"
          type="button"
        >
          <History size={13} />
        </button>
        <button
          aria-label="收藏"
          className={activeView === "favorites" ? "icon-button active" : "icon-button subtle"}
          onClick={() => onViewChange("favorites")}
          title="收藏"
          type="button"
        >
          <Heart size={13} />
        </button>
        <button
          aria-label="垃圾箱"
          className={activeView === "trash" ? "icon-button active" : "icon-button subtle"}
          onClick={() => onViewChange("trash")}
          title="垃圾箱"
          type="button"
        >
          <Trash2 size={13} />
        </button>
        <button aria-label="设置" className="icon-button subtle" onClick={onOpenSettings} title="设置" type="button">
          <Settings size={13} />
        </button>
      </div>
    </footer>
  );
}

function StatusLine({ status }: { status: string }) {
  return (
    <span className="footer-status">
      {status || (
        <>
          <kbd>Space</kbd> 预览 · <kbd>Enter</kbd> 粘贴 · <kbd>/</kbd> 搜索
        </>
      )}
    </span>
  );
}

function TrashPanel({
  activeId,
  autoScroll,
  clips,
  hasMore,
  isLoadingMore,
  multiSelectMode,
  onCopy,
  onDeleteSelected,
  onHardDelete,
  onLoadMore,
  onPointerActive,
  onRestore,
  onRestoreSelected,
  onSelect,
  onToggleSelected,
  selectedIds,
  settings,
}: {
  activeId: string | null;
  autoScroll: boolean;
  clips: ClipItem[];
  hasMore: boolean;
  isLoadingMore: boolean;
  multiSelectMode: boolean;
  onCopy: (item: ClipItem) => void;
  onDeleteSelected: () => void;
  onHardDelete: (item: ClipItem) => void;
  onLoadMore: () => void;
  onPointerActive: () => void;
  onRestore: (item: ClipItem) => void;
  onRestoreSelected: () => void;
  onSelect: (item: ClipItem) => void;
  onToggleSelected: (id: string) => void;
  selectedIds: Set<string>;
  settings: AppSettings;
}) {
  const selectedCount = clips.filter((item) => selectedIds.has(item.id)).length;
  if (!clips.length) {
    return (
      <div className="empty-list">
        <Trash2 size={30} />
        <h2>垃圾箱为空</h2>
        <p>软删除的内容会在这里显示，可恢复或彻底删除。</p>
      </div>
    );
  }
  return (
    <section className="quick-panel">
      <div className="quick-control-row">
        <div />
        <div className="quick-bulk-actions" aria-label="垃圾箱批量操作">
          {multiSelectMode ? (
            <>
              <button
                aria-label="恢复选中"
                className="icon-button"
                disabled={selectedCount === 0}
                onClick={onRestoreSelected}
                title="恢复选中"
                type="button"
              >
                <RotateCcw size={14} />
              </button>
              <button
                aria-label="彻底删除选中"
                className="icon-button danger-icon"
                disabled={selectedCount === 0}
                onClick={onDeleteSelected}
                title="彻底删除选中"
                type="button"
              >
                <Trash2 size={14} />
              </button>
              <span>{selectedCount}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="quick-workspace" onPointerDown={onPointerActive}>
        <VirtualList
          activeId={activeId}
          autoScroll={autoScroll}
          className="quick-menu"
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          itemHeight={56}
          items={clips}
          onEndReached={onLoadMore}
          renderItem={(item) => (
            <article
              className={[
                "quick-row",
                activeId === item.id ? "active" : "",
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
                onSelect(item);
              }}
              onFocus={() => onSelect(item)}
              onMouseEnter={() => {
                if (activeId !== item.id) onSelect(item);
              }}
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
                <kbd>
                  <Trash2 size={12} />
                </kbd>
              )}
              <div>
                <strong>
                  {item.analysis.title}
                  <span>{formatTime(item.lastSeenAt)}</span>
                </strong>
                <p aria-label={getDisplayText(item, settings)}>{getDisplayText(item, settings)}</p>
              </div>
              <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                <button
                  className="icon-button"
                  onClick={() => onRestore(item)}
                  title="恢复"
                  type="button"
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  className="icon-button"
                  onClick={() => onCopy(item)}
                  title="复制"
                  type="button"
                >
                  <Copy size={14} />
                </button>
                <button
                  className="icon-button danger-icon"
                  onClick={() => onHardDelete(item)}
                  title="彻底删除"
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          )}
        />
      </div>
    </section>
  );
}

function VirtualList<T extends { id: string }>({
  activeId,
  className,
  hasMore = false,
  items,
  isLoadingMore = false,
  itemHeight = ROW_HEIGHT,
  onEndReached,
  renderItem,
  autoScroll = true,
}: {
  activeId?: string | null;
  className: string;
  hasMore?: boolean;
  items: T[];
  isLoadingMore?: boolean;
  itemHeight?: number;
  onEndReached?: () => void;
  renderItem: (item: T, index: number) => ReactNode;
  autoScroll?: boolean;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(420);
  const [isScrollFeedback, setScrollFeedback] = useState(false);
  const scrollFeedbackTimerRef = useRef<number | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const setFeedback = useCallback(
    (next: boolean) => {
      setScrollFeedback(next);
      if (scrollFeedbackTimerRef.current) window.clearTimeout(scrollFeedbackTimerRef.current);
      if (next) {
        scrollFeedbackTimerRef.current = window.setTimeout(() => {
          setScrollFeedback(false);
        }, 420);
      }
    },
    [],
  );

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      setHeight(entry.contentRect.height);
    });
    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (scrollFeedbackTimerRef.current) window.clearTimeout(scrollFeedbackTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!activeId || !autoScroll) return;
    const node = ref.current;
    if (!node) return;
    const index = items.findIndex((item) => item.id === activeId);
    if (index < 0) return;
    const itemTop = index * itemHeight;
    const itemBottom = itemTop + itemHeight;
    const visibleTop = node.scrollTop;
    const visibleBottom = visibleTop + node.clientHeight;
    if (itemTop >= visibleTop && itemBottom <= visibleBottom) {
      return;
    }
    const targetTop = Math.max(0, itemTop - node.clientHeight / 2 + itemHeight / 2);
    setFeedback(true);
    node.scrollTo({ top: targetTop, behavior: "smooth" });
  }, [activeId, autoScroll, itemHeight, items, setFeedback]);

  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - OVERSCAN);
  const visibleCount = Math.ceil(height / itemHeight) + OVERSCAN * 2;
  const visible = items.slice(start, start + visibleCount);
  const activeIndex = activeId ? items.findIndex((item) => item.id === activeId) : -1;

  return (
    <div
      className={`${className} virtual-list${isScrollFeedback ? " is-scroll-feedback" : ""}`}
      onScroll={(event) => {
        const node = event.currentTarget;
        setScrollTop(node.scrollTop);
        setFeedback(true);
        if (hasMore && !isLoadingMore && node.scrollHeight - node.scrollTop - node.clientHeight < itemHeight * 6) {
          onEndReached?.();
        }
      }}
      ref={ref}
    >
      <div className="virtual-spacer" style={{ height: items.length * itemHeight }}>
        {activeIndex >= 0 ? (
          <div
            aria-hidden="true"
            className="target-focus-ring"
            style={{
              "--target-row-height": `${itemHeight}px`,
              transform: `translate3d(0, ${activeIndex * itemHeight}px, 0)`,
            } as CSSProperties}
          />
        ) : null}
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
  autoScroll,
  clips,
  copiedId,
  hasMore,
  isLoadingMore,
  multiSelectMode,
  onFavorite,
  onLoadMore,
  onOpen,
  onOpenDetail,
  onPointerActive,
  onPaste,
  onSelect,
  onStartMultiSelect,
  onToggleSelected,
  selectedIds,
}: {
  activeId: string | null;
  autoScroll: boolean;
  clips: ClipItem[];
  copiedId: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  limit: number;
  multiSelectMode: boolean;
  selectedIds: Set<string>;
  onFavorite: (item: ClipItem) => void;
  onLoadMore: () => void;
  onOpen: (item: ClipItem) => void;
  onOpenDetail: (item: ClipItem) => void;
  onPointerActive: () => void;
  onPaste: (item: ClipItem) => void;
  onSelect: (item: ClipItem) => void;
  onStartMultiSelect: (id: string) => void;
  onToggleSelected: (id: string) => void;
}) {
  if (!clips.length) {
    return (
      <div className="empty-list">
        <Inbox size={30} />
        <h2>还没有剪贴板内容</h2>
        <p>复制文本后，这里会显示最近项目。</p>
      </div>
    );
  }

  return (
    <section className="quick-panel">
      <div className="quick-workspace" onPointerDown={onPointerActive}>
        <VirtualList
          activeId={activeId}
          autoScroll={autoScroll}
          className="quick-menu"
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          itemHeight={40}
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
              onSelect(item);
              onPaste(item);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onSelect(item);
              if (multiSelectMode) {
                onOpenDetail(item);
              } else {
                onStartMultiSelect(item.id);
              }
            }}
            onFocus={() => onSelect(item)}
            tabIndex={0}
          >
            <button
              aria-label={selectedIds.has(item.id) ? "取消选择" : "多选此项"}
              className={selectedIds.has(item.id) ? "quick-index selected" : "quick-index"}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(item);
                if (multiSelectMode) onToggleSelected(item.id);
                else onStartMultiSelect(item.id);
              }}
              title={multiSelectMode ? "切换选择" : "进入多选"}
              type="button"
            >
              {selectedIds.has(item.id) ? <Check size={12} /> : copiedId === item.id ? <Check size={12} /> : index < 9 ? <span className="quick-index-num">{index + 1}</span> : null}
            </button>
            <div className="quick-content">
              <p className="quick-line" aria-label={getClipboardLine(item)}>{getClipboardLine(item)}</p>
            </div>
            <div className={item.favorite ? "row-actions has-favorite" : "row-actions"} onClick={(event) => event.stopPropagation()}>
              {item.analysis.url || item.analysis.attachment ? (
                <button className="icon-button" onClick={() => onOpen(item)} title="打开链接" type="button">
                  <ExternalLink size={14} />
                </button>
              ) : null}
              <button
                className={item.favorite ? "quick-fav faved" : "quick-fav"}
                onClick={(event) => {
                  event.stopPropagation();
                  onFavorite(item);
                }}
                title={item.favorite ? "取消收藏" : "收藏"}
                type="button"
              >
                <Heart size={13} />
              </button>
            </div>
          </article>
          )}
        />
      </div>
    </section>
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
