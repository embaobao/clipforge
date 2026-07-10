import {
  ACTIONS,
  EVENTS,
  Joyride,
  STATUS,
  type EventData,
  type Step,
  type TooltipRenderProps,
} from "react-joyride";
import {
  Check,
  CheckSquare,
  Clipboard,
  Copy,
  ExternalLink,
  FileJson,
  Heart,
  History,
  Inbox,
  Pin,
  RotateCcw,
  Search,
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
import type { CSSProperties, ErrorInfo, MouseEvent, PointerEvent, ReactNode, RefObject, UIEvent } from "react";
import {
  WorkspaceRouterProvider,
  navigateWorkspaceAggregate,
  navigateWorkspaceDetail,
  navigateWorkspaceList,
} from "./routes/workspace-router";
import { useWorkspaceStore } from "./stores/workspace-store";
import { ClipDetailWorkspace, MultiAggregateWorkspace } from "./workspace/workspace-panels";
import { Avatar, AvatarFallback, AvatarImage } from "./components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import clipforgeAppIcon from "../src-tauri/icons/64x64.png";
import "./App.css";

type ClipKind = "text" | "code" | "link" | "markdown" | "command" | "attachment";
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
  isClosing: boolean;
  setClosing: (isClosing: boolean) => void;
};

const usePanelUiStore = create<PanelUiState>()((set) => ({
  isClosing: false,
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
  panelWidth: number;
  panelHeight: number;
  onboardingCompleted: boolean;
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
const ROW_HEIGHT = 36;
const OVERSCAN = 5;
const DEFAULT_PANEL_HEIGHT = 400;
const ONBOARDING_SAMPLE_CONTENT = [
  "ClipForge 入门样例",
  "",
  "这是初始化的演示数据，用来练习剪贴板面板的基础操作：",
  "- Ctrl+V 唤起面板",
  "- Enter 或 Cmd+数字粘贴当前项",
  "- Ctrl/Cmd+F 收藏当前项",
  "- Delete 删除当前项",
  "- 右键进入详情，Ctrl/Cmd+J 执行链接跳转或插件快速操作",
  "",
  "https://ui.shadcn.com/docs/components/base/dropdown-menu",
].join("\n");
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
  panelWidth: 420,
  panelHeight: DEFAULT_PANEL_HEIGHT,
  onboardingCompleted: false,
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

/** 把单行长文案拆成「头 + 尾」两段交给 CSS flex 布局：头部可收缩并末尾省略，尾部固定不裁。
 *  修复旧实现「JS 先拼 head...tail，再被 .quick-line 的 text-overflow:ellipsis 二次裁掉尾部」的问题。
 *  文本较短（不超过单行容量）时返回单段，走普通末尾省略。 */
function splitLineForMiddleEllipsis(text: string, tailLen = 16) {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 50) return { split: false as const, text: normalized };
  return {
    split: true as const,
    head: normalized.slice(0, Math.max(1, normalized.length - tailLen)),
    tail: normalized.slice(-tailLen),
    full: normalized,
  };
}

function extractFirstUrl(content: string) {
  const match = content.match(/https?:\/\/[^\s<>"')\]]+/i);
  return match?.[0];
}

function extractUrls(content: string) {
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
    onboardingCompleted:
      typeof next.onboardingCompleted === "boolean"
        ? next.onboardingCompleted
        : defaultSettings.onboardingCompleted,
    panelWidth: clampNumber(next.panelWidth, 320, 600, defaultSettings.panelWidth),
    panelHeight: clampNumber(
      [430, 450, 488].includes(next.panelHeight) ? DEFAULT_PANEL_HEIGHT : next.panelHeight,
      300,
      1000,
      defaultSettings.panelHeight,
    ),
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
  const firstLine = (item.content || "").split(/\r?\n/, 1)[0] ?? "";
  const line = firstLine.replace(/\s+/g, " ").trim();
  return line || item.analysis.title || "";
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

function waitForPasteTriggerRelease(source: string): Promise<number> {
  if (source !== "cmd-number") return Promise.resolve(0);
  return new Promise((resolve) => {
    const started = Date.now();
    let finished = false;
    let timer = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", finish, true);
      resolve(Date.now() - started);
    };
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Meta" || event.key === "Control" || (!event.metaKey && !event.ctrlKey)) {
        finish();
      }
    };
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", finish, true);
    // 原上限 280ms 偏长，叠加 Rust 侧粘贴路径会让 Cmd+数字 粘贴明显延迟、甚至被当成「没触发」。
    // 120ms 足以等到修饰键释放（首个 keyup 即 resolve），同时把整体延迟压下来。
    timer = window.setTimeout(finish, 120);
  });
}

function getShortcutModLabel() {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "Cmd" : "Ctrl";
}

type AppTooltipContent = {
  title: string;
  description: string;
  body: string;
};

function getItemTooltip(item: ClipItem): AppTooltipContent {
  const source = item.sourceApp?.name || item.analysis.sourceName || "剪贴板历史";
  const title = item.analysis.title || source;
  const description = item.analysis.url ? "链接内容" : item.analysis.attachment ? "附件内容" : source;
  // tooltip 每个可见行都常驻挂载在 DOM（仅 opacity:0）。把整篇大文案塞进 body，
  // 大文本条目会让打开那一帧布局/提交暴涨 200–340ms、阻塞输入。截断到预览长度即可；
  // 复制/粘贴走 item.content 本体，不受影响。
  const fullBody = item.content || getClipboardLine(item);
  const body =
    fullBody.length > 600
      ? `${fullBody.slice(0, 600)}\n…（共 ${fullBody.length} 字，已省略 ${fullBody.length - 600} 字）`
      : fullBody;
  return { title, description, body };
}

function AppTooltip({
  children,
  content,
}: {
  children: ReactNode;
  content: AppTooltipContent;
}) {
  return (
    <div className="app-tooltip">
      {children}
      <div
        className="app-tooltip-card"
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        role="tooltip"
      >
        <div className="app-tooltip-main">
          <strong>{content.title}</strong>
          <span>{content.description}</span>
        </div>
        <div className="app-tooltip-body">{content.body}</div>
      </div>
    </div>
  );
}

function ShortcutDemo({ icon, keys, label }: { icon: ReactNode; keys: string[]; label: string }) {
  return (
    <div className="onboarding-shortcut-demo">
      <span className="onboarding-action-icon">{icon}</span>
      <div className="onboarding-key-chain">
        {keys.map((key) => (
          <kbd key={key}>{key}</kbd>
        ))}
      </div>
      <span>{label}</span>
    </div>
  );
}

function OnboardingAnchors({ active }: { active: boolean }) {
  return (
    <div aria-hidden="true" className={active ? "onboarding-anchors active" : "onboarding-anchors"}>
      <span className="onboarding-anchor anchor-panel" />
      <span className="onboarding-anchor anchor-search" />
      <span className="onboarding-anchor anchor-list" />
      <span className="onboarding-anchor anchor-index" />
      <span className="onboarding-anchor anchor-row-action" />
      <span className="onboarding-anchor anchor-footer" />
      <span className="onboarding-anchor anchor-pin" />
    </div>
  );
}

function CenteredOnboardingTooltip({
  backProps,
  closeProps,
  index,
  isLastStep,
  primaryProps,
  size,
  skipProps,
  step,
  tooltipProps,
}: TooltipRenderProps) {
  return (
    <div className="centered-onboarding-tooltip" {...tooltipProps}>
      <button className="centered-onboarding-close" type="button" {...closeProps}>
        <X size={12} />
      </button>
      <div className="centered-onboarding-copy">
        {step.title ? <strong>{step.title}</strong> : null}
        <div>{step.content}</div>
      </div>
      <div className="centered-onboarding-footer">
        <span>{index + 1}/{size}</span>
        <div>
          {index > 0 ? <button className="centered-onboarding-ghost" type="button" {...backProps} /> : null}
          {!isLastStep ? <button className="centered-onboarding-ghost" type="button" {...skipProps} /> : null}
          <button className="centered-onboarding-primary" type="button" {...primaryProps} />
        </div>
      </div>
    </div>
  );
}

function makeOnboardingSteps(mod: string): Step[] {
  return [
    {
      target: ".anchor-panel",
      placement: "center",
      title: "快速唤起",
      content: (
        <div className="onboarding-step">
          <p>用默认快捷键打开面板，继续搜索、选择和粘贴。</p>
          <ShortcutDemo icon={<Clipboard size={12} />} keys={["Ctrl", "V"]} label="默认触发" />
        </div>
      ),
    },
    {
      target: ".anchor-search",
      placement: "center",
      title: "搜索",
      content: (
        <div className="onboarding-step">
          <p>面板打开后直接输入即可过滤历史内容。</p>
          <ShortcutDemo icon={<Search size={12} />} keys={["/", "输入"]} label="快速进入搜索" />
        </div>
      ),
    },
    {
      target: ".anchor-list",
      placement: "center",
      title: "选择和翻页",
      content: (
        <div className="onboarding-step">
          <p>上下键移动当前项；组合键切换 10 项分组。</p>
          <ShortcutDemo icon={<CheckSquare size={12} />} keys={["↑", "↓"]} label="移动选择" />
          <ShortcutDemo icon={<History size={12} />} keys={[mod, "↑/↓"]} label="翻页/切换 10 项分组" />
        </div>
      ),
    },
    {
      target: ".anchor-index",
      placement: "center",
      title: "数字操作",
      content: (
        <div className="onboarding-step">
          <p>当前页的 0-9 可直接触发；Space 只做选中。</p>
          <ShortcutDemo icon={<Clipboard size={12} />} keys={[mod, "0-9"]} label="粘贴当前页对应项" />
          <ShortcutDemo icon={<CheckSquare size={12} />} keys={["Space"]} label="选中该项" />
        </div>
      ),
    },
    {
      target: ".anchor-row-action",
      placement: "center",
      title: "收藏和删除",
      content: (
        <div className="onboarding-step">
          <p>当前项可直接收藏、删除；右键会进入详情，快速操作另用 Ctrl+J。</p>
          <ShortcutDemo icon={<Heart size={12} />} keys={[mod, "F"]} label="收藏/取消收藏" />
          <ShortcutDemo icon={<Trash2 size={12} />} keys={["Delete"]} label="删除到垃圾箱" />
        </div>
      ),
    },
    {
      target: ".anchor-footer",
      placement: "center",
      title: "列表切换",
      content: (
        <div className="onboarding-step">
          <p>历史、收藏、垃圾箱可用底部按钮或 Tab 切换。</p>
          <ShortcutDemo icon={<History size={12} />} keys={["Tab"]} label="切换导航" />
        </div>
      ),
    },
    {
      target: ".anchor-pin",
      placement: "center",
      title: "固定窗口",
      content: (
        <div className="onboarding-step">
          <p>需要停留时固定面板，避免失焦后隐藏。</p>
          <ShortcutDemo icon={<Pin size={12} />} keys={[mod, "P"]} label="固定/取消固定" />
        </div>
      ),
    },
  ];
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
  const [activeGroupStart, setActiveGroupStart] = useState(0);
  const [groupScrollTarget, setGroupScrollTarget] = useState<number | null>(null);
  const activeGroupStartRef = useRef(0);
  activeGroupStartRef.current = activeGroupStart;
  const handleActiveGroupChange = useCallback((groupStart: number) => {
    setActiveGroupStart(groupStart);
  }, []);
  const [isMultiPreviewOpen, setMultiPreviewOpen] = useState(false);
  const [isSearchActive, setSearchActive] = useState(false);
  const [nativeStatus, setNativeStatus] = useState("准备监听剪贴板");
  const [completionToast, setCompletionToast] = useState<string | null>(null);
  const [onboardingRun, setOnboardingRun] = useState(false);
  const [onboardingStepIndex, setOnboardingStepIndex] = useState(0);
  const completionToastTimerRef = useRef<number | null>(null);
  const showCompletionToast = useCallback((message: string) => {
    setCompletionToast(message);
    if (completionToastTimerRef.current) window.clearTimeout(completionToastTimerRef.current);
    completionToastTimerRef.current = window.setTimeout(() => setCompletionToast(null), 1200);
  }, []);
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
  const panelFocusGraceUntilRef = useRef(0);
  const blurHideInFlightRef = useRef(false);
  const focusRetryTimersRef = useRef<number[]>([]);
  const panelShowStartedAtRef = useRef(0);
  const isPanelClosing = usePanelUiStore((state) => state.isClosing);
  const setPanelClosing = usePanelUiStore((state) => state.setClosing);
  const workspaceRoute = useWorkspaceStore((state) => state.route);
  const onboardingSteps = useMemo(() => makeOnboardingSteps(getShortcutModLabel()), []);
  const markOnboardingCompleted = useCallback(() => {
    setOnboardingRun(false);
    setOnboardingStepIndex(0);
    setSettings((prev) => ({ ...prev, onboardingCompleted: true }));
    setNativeStatus("入门引导已完成");
  }, []);
  const startOnboarding = useCallback(() => {
    setOnboardingStepIndex(0);
    setOnboardingRun(true);
    setNativeStatus("正在展示快捷键入门引导");
  }, []);
  const handleOnboardingEvent = useCallback((data: EventData) => {
    const { action, index, status, type } = data;
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      markOnboardingCompleted();
      return;
    }
    if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      setOnboardingStepIndex(index + (action === ACTIONS.PREV ? -1 : 1));
    }
  }, [markOnboardingCompleted]);

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
      focusRetryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      focusRetryTimersRef.current = [];
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
          // 失焦淡出途中焦点又回来：恢复可见，避免停在透明态。
          setIsPanelEntering(true);
          blurHideInFlightRef.current = false;
          cancelHide();
          return;
        }
        if (Date.now() < panelFocusGraceUntilRef.current) {
          logAppError("info", "panel-pin: blur ignored during focus grace window");
          return;
        }
        if (blurHideInFlightRef.current) {
          logAppError("info", "panel-pin: blur ignored, hide already in flight");
          return;
        }
        cancelHide();
        blurHideInFlightRef.current = true;
        logAppError("info", "panel-pin: blur detected, scheduling hide in 60ms");
        hideTimer = window.setTimeout(async () => {
          // EcoPaste 式：隐藏决策以 Rust 的 PANEL_PINNED 为唯一权威源。
          // 前端 settingsRef 可能与 Rust 不同步（重启 / 跨窗口写入），且 appWindow.hide()
          // 直连 Tauri 绕过 Rust 守卫——故失焦隐藏前必须查 Rust 是否固定。
          let pinned = false;
          try {
            pinned = await invoke<boolean>("is_panel_pinned_command");
          } catch (error) {
            logAppError("warn", "is_panel_pinned_command failed, assume not pinned", String(error));
          }
          if (pinned) {
            blurHideInFlightRef.current = false;
            logAppError("info", "panel-pin: Rust says pinned, blur hide cancelled");
            return;
          }
          setIsPanelEntering(false);
          setPanelClosing(true);
          closeTimer = window.setTimeout(() => {
            logAppError("info", "panel-pin: hide executing now");
            invoke("hide_quick_panel_command")
              .catch((error) => logAppError("warn", "Hide quick panel failed", String(error)))
              .finally(() => setPanelClosing(false));
          }, 180);
        }, 60);
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
      .then(async (payload) => {
        if (!payload || cancelled || isSettingsWindow) return;
        let items = payload.items
          .map((item) => normalizeClip(item, settingsRef.current))
          .filter((item): item is ClipItem => Boolean(item));
        if (!items.length) {
          try {
            const seedPayload = await invoke<CaptureClipPayload>("capture_clip_record", {
              content: ONBOARDING_SAMPLE_CONTENT,
              sourceLabel: "ClipForge",
              observedAt: Date.now(),
            });
            const seedItem = normalizeClip(seedPayload.item, settingsRef.current);
            if (seedItem) {
              items = [seedItem];
              setSelectedId(seedItem.id);
              logAppError("info", "onboarding: seeded intro clip", { id: seedItem.id });
            }
          } catch (error) {
            logAppError("warn", "Seed onboarding clip failed", String(error));
          }
        }
        if (cancelled) return;
        setClips(items);
        clipsRef.current = items;
        setNextCursor(items.length === payload.items.length ? (payload.nextCursor ?? null) : null);
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
          if (!merged.onboardingCompleted) {
            window.setTimeout(() => startOnboarding(), 650);
          }
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
      blurHideInFlightRef.current = false;
      // 唤起后只在极短窗口内忽略失焦（吸收 show_and_make_key 引发的一瞬 blur→focus 抖动）。
      // 原值 2400ms 太长：唤起提速后，用户在 2.4s 内点别的窗口，那次 blur 被吞掉、之后不再有
      // blur，面板就不再自动隐藏。400ms 足以覆盖抖动，又不至于吞掉真实的「点开别处」失焦。
      panelFocusGraceUntilRef.current = Date.now() + 400;
      panelShowStartedAtRef.current = Date.now();
      focusRetryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      focusRetryTimersRef.current = [];
      // 先同步把焦点拉到搜索框（若已挂载），赶在下面 setState 引起的重渲染之前。重渲染一旦占用
      // 主线程，60ms 的 focus 定时器就会晚到——这正是「面板出来后要等一下才能打字」的体感来源。
      // 未挂载时为 no-op，后面的 [0,60] 兜底会接管。
      searchRef.current?.focus();
      setActiveView("history");
      setSelectedIds(new Set());
      setMultiSelectMode(false);
      setQuery("");
      setActiveTag(null);
      setActiveTypeFilter("all");
      setFilterFavorite(false);
      setSearchActive(true);
      setIsPanelEntering(true);
      // 唤起面板时强制拉一次最新剪贴板，避免用户在别的 app 复制后到唤起之间漏掉记录
      // 过去用 [0,30,90,180,320] 五个定时器轮询 focus，会和 Rust 侧 makeFirstResponder
      // 抢焦点，反而拖慢、干扰首次输入。改成 0ms + 60ms 两次，且仅在尚未聚焦到搜索框时再 focus。
      [0, 60].forEach((delay) => {
        const timer = window.setTimeout(() => {
          if (document.activeElement !== searchRef.current) {
            searchRef.current?.focus();
          }
          if (delay === 60) {
            logAppError("info", "panel-keyboard: search focus settle", {
              active: document.activeElement === searchRef.current,
              reason,
              // 从「面板开始唤起」到「输入框可输入」的总耗时（含打开重渲染）。
              openReadyMs: Date.now() - panelShowStartedAtRef.current,
            });
          }
        }, delay);
        focusRetryTimersRef.current.push(timer);
      });
      setNativeStatus(reason === "tray" ? "面板已聚焦，可搜索或方向键选择" : "快捷面板已聚焦");
      // 后台监听线程每 100ms 已在采集，这里只是兜底；延后到 300ms，避免与「唤起后立即输入」
      // 抢主线程——setClips 触发的重渲染会吞掉最初几个按键，造成「面板出来后要等一下才能打字」。
      window.setTimeout(() => {
        void captureClipboard("manual");
      }, 300);
    },
    [captureClipboard],
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
        if (settingsRef.current.panelPinned) {
          logAppError("info", "panel-pin: hide-quick-panel event ignored, panel pinned");
          return;
        }
        // Rust 侧隐藏（粘贴 / 托盘切换走 hide_panel）后复位 is-entering，下次唤起才能淡入。
        setIsPanelEntering(false);
        setPanelClosing(false);
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

  const togglePanelPinned = useCallback(() => {
    const nextPinned = !settingsRef.current.panelPinned;
    setSettings((prev) => ({ ...prev, panelPinned: nextPinned }));
    invoke("set_panel_pinned_command", { pinned: nextPinned }).catch((error) =>
      logAppError("warn", "Toggle panel pin failed", String(error)),
    );
  }, []);

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

  async function copyText(text: string, source = "unknown", context: Record<string, unknown> = {}) {
    logAppError("info", "copy-text: invoke start", {
      source,
      chars: text.length,
      selectedId,
      ...context,
    });
    try {
      await invoke("write_clipboard_text", { text });
      lastSeenClipboard.current = text.trim();
      setNativeStatus("已复制代码到系统剪贴板");
      showCompletionToast("已复制代码");
      logAppError("info", "copy-text: invoke success", {
        source,
        chars: text.length,
        ...context,
      });
    } catch (error) {
      logAppError("warn", "Copy text failed", { source, error: String(error), ...context });
      await navigator.clipboard.writeText(text);
      setNativeStatus("已复制代码到浏览器剪贴板");
      showCompletionToast("已复制代码");
    }
  }

  async function pasteText(text: string, source = "unknown", context: Record<string, unknown> = {}) {
    const releaseWaitMs = await waitForPasteTriggerRelease(source);
    if (releaseWaitMs > 0) {
      logAppError("info", "paste-text: shortcut release settled", {
        source,
        releaseWaitMs,
        ...context,
      });
    }
    logAppError("info", "paste-text: invoke start", {
      source,
      chars: text.length,
      selectedId,
      ...context,
    });
    try {
      await invoke("paste_clipboard_text", { text, source });
      setIsPanelEntering(false);
      lastSeenClipboard.current = text.trim();
      setNativeStatus("已粘贴代码到当前应用");
      showCompletionToast("已粘贴代码");
      logAppError("info", "paste-text: invoke success", {
        source,
        chars: text.length,
        ...context,
      });
    } catch (error) {
      logAppError("warn", "Paste text failed", { source, error: String(error), ...context });
      await copyText(text, `${source}:fallback-copy`, context);
      setNativeStatus("粘贴失败，已复制代码到剪贴板");
    }
  }

  async function pasteClip(item: ClipItem, source = "unknown") {
    const releaseWaitMs = await waitForPasteTriggerRelease(source);
    if (releaseWaitMs > 0) {
      logAppError("info", "paste-ui: shortcut release settled", {
        id: item.id,
        source,
        releaseWaitMs,
      });
    }
    logAppError("info", "paste-ui: invoke start", {
      id: item.id,
      source,
      kind: item.kind,
      chars: item.content.length,
      selectedId,
    });
    try {
      await invoke("paste_clipboard_text", { text: item.content, source });
      // 粘贴后面板已被 Rust 隐藏（hide_panel_before_paste 不发 hide-quick-panel），
      // 这里显式复位 is-entering，否则下次唤起不会淡入。
      setIsPanelEntering(false);
      lastSeenClipboard.current = item.content.trim();
      markClipCopied(item, "已粘贴到当前应用");
      logAppError("info", "paste-ui: invoke success", { id: item.id, source });
    } catch (error) {
      logAppError("warn", "Paste clip failed", String(error));
      await copyClip(item);
      setNativeStatus("粘贴失败，已复制到剪贴板");
    }
  }

  async function favoriteSelectedClips(items: ClipItem[]) {
    if (!items.length) return;
    const targetFavorite = !items.every((item) => item.favorite);
    await Promise.all(
      items.map((item) =>
        invoke("update_clip_record", { input: { id: item.id, favorite: targetFavorite } }),
      ),
    ).catch((error) => logAppError("warn", "Batch favorite failed", String(error)));
    const ids = new Set(items.map((item) => item.id));
    setClips((current) =>
      current.map((clip) => (ids.has(clip.id) ? { ...clip, favorite: targetFavorite } : clip)),
    );
    showCompletionToast(targetFavorite ? `已收藏 ${items.length} 项` : `已取消收藏 ${items.length} 项`);
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
    showCompletionToast(`已聚合复制 ${items.length} 项`);
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
      const allowListShortcutFromSearch = editable === searchRef.current && !query.trim();
      const quickItems = filteredClips;
      const key = event.key.toLowerCase();
      const currentItem = quickItems.find((clip) => clip.id === selectedId) ?? quickItems[0];

      if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const views: ViewKey[] = ["history", "favorites", "trash"];
        const currentIndex = Math.max(0, views.indexOf(activeView));
        const nextIndex = event.shiftKey
          ? (currentIndex - 1 + views.length) % views.length
          : (currentIndex + 1) % views.length;
        setActiveView(views[nextIndex]);
        setSelectedIds(new Set());
        setMultiSelectMode(false);
        setMultiPreviewOpen(false);
        void navigateWorkspaceList();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "p") {
        event.preventDefault();
        togglePanelPinned();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "f") {
        event.preventDefault();
        if (multiSelectMode && selectedInList.length > 0) {
          void favoriteSelectedClips(selectedInList);
        } else if (currentItem && activeView !== "trash") {
          updateClip(currentItem.id, { favorite: !currentItem.favorite });
          showCompletionToast(currentItem.favorite ? "已取消收藏" : "已收藏");
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "j") {
        event.preventDefault();
        if (currentItem && !multiSelectMode) {
          void runPrimaryOpenAction(currentItem, "shortcut");
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "a") {
        if (editable && !allowListShortcutFromSearch) return;
        if (!quickItems.length) return;
        event.preventDefault();
        setMultiSelectMode(true);
        setSelectedIds(new Set(quickItems.map((item) => item.id)));
        setSelectedId((current) => current ?? quickItems[0]?.id ?? null);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "c") {
        if (editable && !allowListShortcutFromSearch) return;
        if (!currentItem) return;
        event.preventDefault();
        if (multiSelectMode) {
          void copySelectedClips(selectedInList);
        } else {
          void copyClip(currentItem);
        }
        return;
      }

      // 删除选中项：Ctrl+X 或 Delete（不处于编辑态时）
      if (((event.metaKey || event.ctrlKey) && !event.altKey && key === "x") || event.key === "Delete") {
        if (editable && !allowListShortcutFromSearch) return;
        event.preventDefault();
        if (multiSelectMode && selectedInList.length > 0) {
          if (activeView === "trash") void hardDeleteClips(selectedInList.map((item) => item.id));
          else void deleteClips(selectedInList.map((item) => item.id));
        } else if (selectedClip) {
          if (activeView === "trash") void hardDeleteClips([selectedClip.id]);
          else void deleteClips([selectedClip.id]);
        }
        return;
      }

      if (event.ctrlKey || event.altKey) return;

      // 普通数字键必须保留给搜索输入；只有 Cmd+数字才作用于列表条目。
      // Cmd+0..9：触发【激活分组】内第 N 项（激活分组由滚动位置决定；切组后同一数字对应不同项）。
      if (event.metaKey && /^[0-9]$/.test(event.key)) {
        const index = activeGroupStartRef.current + Number(event.key);
        const item = quickItems[index];
        if (!item) return;
        event.preventDefault();
        setSelectedId(item.id);
        if (multiSelectMode) {
          setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
          });
          return;
        }
        if (activeView === "trash") {
          void restoreClips([item.id]);
          return;
        }
        void pasteClip(item, "cmd-number");
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        if (workspaceRoute.name !== "list") {
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
          setIsPanelEntering(false);
          invoke("hide_quick_panel_command").catch((error) => logAppError("warn", "Hide quick panel failed", String(error)));
        }
        return;
      }

      // Cmd+↑ / Cmd+↓：切到上/下一分组（每 10 项一组，平滑滚动使该组进入视口），
      // 同时把键盘焦点/选中项移到新组第一项，方便紧接着 Enter / Cmd+0 操作。
      if (event.metaKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const dir = event.key === "ArrowDown" ? 1 : -1;
        const maxGroupStart = Math.max(0, Math.floor(Math.max(0, quickItems.length - 1) / 10) * 10);
        const next = Math.min(Math.max(0, activeGroupStartRef.current + dir * 10), maxGroupStart);
        setGroupScrollTarget(next);
        const firstInGroup = quickItems[next];
        if (firstInGroup) {
          setSelectedId(firstInGroup.id);
        }
        return;
      }

      if (event.metaKey) return;

      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        if (editable && editable !== searchRef.current) return;
        event.preventDefault();
        if (event.key === "ArrowRight") {
          if (!multiSelectMode && selectedClip) {
            logAppError("info", "keyboard-detail", {
              id: selectedClip.id,
              hasUrl: Boolean(selectedClip.analysis.url),
              hasAttachment: Boolean(selectedClip.analysis.attachment),
            });
            void navigateWorkspaceDetail(selectedClip.id);
          }
        } else if (workspaceRoute.name !== "list") {
          setMultiPreviewOpen(false);
          void navigateWorkspaceList();
        } else if (isMultiPreviewOpen) {
          setMultiPreviewOpen(false);
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
        if (activeView === "trash") {
          if (multiSelectMode) void restoreClips(selectedInList.map((clip) => clip.id));
          else void restoreClips([item.id]);
        } else if (multiSelectMode) void copySelectedClips(selectedInList);
        else void pasteClip(item, "enter");
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
        return;
      }

      if ((event.key === "/" || event.key.length === 1) && !editable && !multiSelectMode) {
        event.preventDefault();
        focusSearch();
        if (event.key !== "/" && event.key.length === 1) {
          setQuery((current) => `${current}${event.key}`);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeView,
    filteredClips,
    focusSearch,
    isMultiPreviewOpen,
    isSearchActive,
    multiSelectMode,
    query,
    selectedId,
    selectedInList,
    searchSuggestions,
    showCompletionToast,
    togglePanelPinned,
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

  function canOpenClipTarget(item: ClipItem) {
    return Boolean(item.analysis.attachment || item.analysis.url);
  }

  async function runPrimaryOpenAction(item: ClipItem, source: "shortcut" | "keyboard" | "click" | "context-menu" | "detail") {
    setSelectedId(item.id);
    if (canOpenClipTarget(item)) {
      logAppError("info", "quick-action: open target", {
        id: item.id,
        source,
        targetType: item.analysis.attachment?.targetType ?? "url",
        target: item.analysis.attachment?.target ?? item.analysis.url,
      });
      await openClipTarget(item);
      return;
    }
    logAppError("info", "quick-action: open detail", { id: item.id, source });
    await navigateWorkspaceDetail(item.id);
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
  }

  async function deleteClips(ids: string[]) {
    const now = Date.now();
    // 删除后锚定到「被删项当前位置的下一项」；若已是最后一项则锚定上一项；都没有则不锚定。
    // 旧实现一律 setSelectedId(null)，导致 selectedClip 回退到 filteredClips[0] = 第一条。
    const deleteIndex = filteredClips.findIndex((item) => ids.includes(item.id));
    const remaining = filteredClips.filter((item) => !ids.includes(item.id));
    const nextSelectedId =
      deleteIndex >= 0 && remaining.length > 0
        ? (remaining[Math.min(deleteIndex, remaining.length - 1)]?.id ?? null)
        : null;
    const shouldReselect = selectedId != null && ids.includes(selectedId);
    try {
      await invoke("soft_delete_clip_records", { ids });
      setNativeStatus(`已移入垃圾箱 ${ids.length} 条`);
      showCompletionToast(`已删除 ${ids.length} 项`);
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
    if (shouldReselect) setSelectedId(nextSelectedId);
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
    const deleteIndex = filteredClips.findIndex((item) => ids.includes(item.id));
    const remaining = filteredClips.filter((item) => !ids.includes(item.id));
    const nextSelectedId =
      deleteIndex >= 0 && remaining.length > 0
        ? (remaining[Math.min(deleteIndex, remaining.length - 1)]?.id ?? null)
        : null;
    const shouldReselect = selectedId != null && ids.includes(selectedId);
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
    if (shouldReselect) setSelectedId(nextSelectedId);
  }

  async function emptyTrash() {
    const trashIds = clips.filter((item) => item.deletedAt).map((item) => item.id);
    if (!trashIds.length) {
      setNativeStatus("垃圾箱已经为空");
      return;
    }
    if (!window.confirm(`确认清空垃圾箱吗？将彻底删除 ${trashIds.length} 条记录，且无法恢复。`)) {
      return;
    }
    await hardDeleteClips(trashIds);
  }

  return (
    <main
      className={`app-shell view-${activeView} density-${settings.panelDensity}${isSearchActive || query ? " search-active" : ""}${multiSelectMode ? " multi-selecting" : ""}${isPanelEntering ? " is-entering" : ""}${isPanelClosing ? " is-closing" : ""}${isFooterHidden ? " footer-hidden" : ""}${isSearchCompact ? " search-compact" : ""}${scrollOffset > 0 ? " scrolled" : ""}`}
      ref={shellRef}
      style={{ "--cf-panel-bg-opacity": settings.panelBackgroundOpacity } as CSSProperties}
    >
      <div aria-hidden="true" className="drag-strip" data-tauri-drag-region onPointerDown={handleWindowDrag} />
      <OnboardingAnchors active={onboardingRun} />

      <section className="content-column" onScroll={handleScroll}>
        <GlassSearchBar
          inputRef={searchRef}
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
          onFocus={focusSearch}
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
            onEmptyTrash={activeView === "trash" ? emptyTrash : undefined}
            onFavorite={() => favoriteSelectedClips(selectedInList)}
            onRestore={activeView === "trash" ? () => restoreClips(selectedInList.map((item) => item.id)) : undefined}
            onToggleAll={(checked) => {
              setSelectedIds(checked ? new Set(filteredClips.map((item) => item.id)) : new Set());
            }}
            variant={activeView === "trash" ? "trash" : "default"}
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
                  onEmptyTrash={emptyTrash}
                  hasMore={Boolean(nextCursor)}
                  isLoadingMore={isLoadingMore}
                  multiSelectMode={multiSelectMode}
                  onDeleteSelected={() => hardDeleteClips(selectedInList.map((item) => item.id))}
                  onHardDelete={(item) => hardDeleteClips([item.id])}
                  onLoadMore={loadMoreClips}
                  onPointerActive={() => setKeyboardNavigating(false)}
                  onRestore={(item) => restoreClips([item.id])}
                  onRestoreSelected={() => restoreClips(selectedInList.map((item) => item.id))}
                  onSelect={(item) => {
                    setSelectedId(item.id);
                  }}
                  onStartMultiSelect={(id) => {
                    setMultiSelectMode(true);
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
                  onFavoriteSelected={() => {
                    void favoriteSelectedClips(selectedInList);
                  }}
                  onLoadMore={loadMoreClips}
                  onOpen={(item) => {
                    void runPrimaryOpenAction(item, "click");
                  }}
                  onOpenAggregate={() => {
                    setMultiPreviewOpen(true);
                    void navigateWorkspaceAggregate();
                  }}
                  onPointerActive={() => setKeyboardNavigating(false)}
                  onCopySelected={() => {
                    void copySelectedClips(selectedInList);
                  }}
                  onDelete={(item) => {
                    void deleteClips([item.id]);
                  }}
                  onDeleteSelected={() => {
                    void deleteClips(selectedInList.map((item) => item.id));
                  }}
                  onSelect={(item) => {
                    setSelectedId(item.id);
                  }}
                  onStartMultiSelect={(id) => {
                    setMultiSelectMode(true);
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
                  onClearSelection={() => {
                    setSelectedIds(new Set());
                    setMultiSelectMode(false);
                    setMultiPreviewOpen(false);
                    void navigateWorkspaceList();
                  }}
                  activeGroupStart={activeGroupStart}
                  onActiveGroupChange={handleActiveGroupChange}
                  groupScrollTarget={groupScrollTarget}
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
                    void navigateWorkspaceList();
                  }}
                  onCopy={copyClip}
                  onCopyText={copyText}
                  onOpen={openClipTarget}
                  onPasteText={pasteText}
                  quickActions={[
                    ...(clip && canOpenClipTarget(clip)
                      ? [
                          {
                            id: "open-target",
                            label: clip.analysis.attachment?.targetType === "path" ? "打开资源" : "打开链接",
                            icon: <ExternalLink size={13} />,
                            onSelect: () => {
                              void openClipTarget(clip);
                            },
                          },
                        ]
                      : []),
                    ...(clip
                      ? [
                          {
                            id: "copy",
                            label: "复制内容",
                            icon: <Copy size={13} />,
                            onSelect: () => {
                              void copyClip(clip);
                            },
                          },
                          {
                            id: "parse",
                            label: "解析",
                            icon: <FileJson size={13} />,
                            onSelect: () => {
                              setNativeStatus("解析插件接口已预留");
                            },
                          },
                        ]
                      : []),
                  ]}
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
                onCopyItem={(clip) => copyClip(clip)}
                onExportTable={() => {
                  const table = selectedInList.map((item) => [item.analysis.title, item.content.replace(/\s+/g, " ")]).map((row) => row.join("\t")).join("\n");
                  void navigator.clipboard.writeText(table);
                  setNativeStatus("已导出选中内容为 TSV 表格");
                }}
                onOpenItem={(clip) => {
                  setSelectedId(clip.id);
                  void navigateWorkspaceDetail(clip.id);
                }}
              />
            )}
          />
        </PanelContentBoundary>
      </section>

      <button
        aria-label={settings.panelPinned ? "取消固定窗体" : "固定窗体"}
        className={`panel-pin-fab${settings.panelPinned ? " active" : ""}`}
        data-tooltip="固定窗体"
        onClick={togglePanelPinned}
        title={`固定窗体 (${getShortcutModLabel()}+P)`}
        type="button"
      >
        <Pin size={12} />
      </button>
      {completionToast ? (
        <div className="completion-toast" role="status">{completionToast}</div>
      ) : null}
      <BottomDock
        activeView={activeView}
        onDrag={handleWindowDrag}
        onOpenSettings={() => {
          invoke("open_settings_window").catch((error) =>
            logAppError("warn", "Open settings window failed", String(error)),
          );
        }}
        onStartOnboarding={startOnboarding}
        onViewChange={(view) => {
          setActiveView(view);
          setSelectedIds(new Set());
          setMultiSelectMode(false);
          void navigateWorkspaceList();
        }}
        status={nativeStatus}
      />
      {!isSettingsWindow ? (
        <Joyride
          continuous
          floatingOptions={{
            hideArrow: true,
            shiftOptions: { padding: 10 },
            strategy: "fixed",
          }}
          locale={{
            back: "上一步",
            close: "关闭",
            last: "完成",
            next: "下一步",
            skip: "跳过",
          }}
          onEvent={handleOnboardingEvent}
          options={{
            backgroundColor: "oklch(0.985 0 0 / 0.96)",
            textColor: "oklch(0.22 0 0)",
            arrowColor: "oklch(0.985 0 0 / 0.96)",
            overlayColor: "oklch(0 0 0 / 0.08)",
            primaryColor: "oklch(0.2 0 0)",
            offset: 6,
            spotlightPadding: 2,
            spotlightRadius: 5,
            width: 220,
            zIndex: 200,
          }}
          run={onboardingRun}
          stepIndex={onboardingStepIndex}
          steps={onboardingSteps}
          tooltipComponent={CenteredOnboardingTooltip}
          styles={{
            tooltip: {
              maxHeight: "calc(100vh - 28px)",
              overflow: "hidden",
              padding: "8px 9px",
            },
            tooltipContainer: {
              maxHeight: "calc(100vh - 82px)",
              overflowY: "auto",
              padding: 0,
            },
            tooltipContent: {
              padding: "3px 0 0",
            },
            tooltipFooter: {
              alignItems: "center",
              marginTop: 6,
              paddingTop: 5,
            },
            tooltipFooterSpacer: {
              flex: "0 1 auto",
            },
            buttonBack: {
              color: "oklch(0.28 0 0 / 0.72)",
              fontSize: 10,
              lineHeight: "1",
              marginRight: 4,
              padding: "4px 6px",
            },
            buttonClose: {
              color: "oklch(0.28 0 0 / 0.54)",
              height: 22,
              right: 5,
              top: 5,
              width: 22,
            },
            buttonPrimary: {
              backgroundColor: "oklch(0.18 0 0)",
              borderRadius: 6,
              color: "oklch(1 0 0)",
              fontSize: 10,
              lineHeight: "1",
              minHeight: 24,
              padding: "4px 8px",
            },
            buttonSkip: {
              color: "oklch(0.28 0 0 / 0.54)",
              fontSize: 10,
              lineHeight: "1",
              padding: "4px 6px",
            },
          }}
        />
      ) : null}
    </main>
  );
}

function GlassSearchBar({
  inputRef,
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
  onApplySuggestion: (suggestion: SearchSuggestion) => void;
  onBlur: () => void;
  onChange: (value: string) => void;
  onClear: () => void;
  onFocus: () => void;
  parsedSearchCommand: ParsedSearchCommand;
  query: string;
  suggestions: SearchSuggestion[];
}) {
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
            <button aria-label="清空搜索" className="icon-button subtle" data-tooltip="清空搜索" onClick={onClear} type="button">
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

function MultiSelectToolbar({
  allSelected,
  count,
  onClose,
  onCopy,
  onDelete,
  onEmptyTrash,
  onFavorite,
  onRestore,
  onToggleAll,
  variant = "default",
}: {
  allSelected: boolean;
  count: number;
  onClose: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onEmptyTrash?: () => void;
  onFavorite: () => void;
  onRestore?: () => void;
  onToggleAll: (checked: boolean) => void;
  variant?: "default" | "trash";
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
          <label className="multi-select-all" data-tooltip="全选/取消全选" title="全选/取消全选">
            <input checked={allSelected} onChange={(event) => onToggleAll(event.currentTarget.checked)} type="checkbox" />
            <span>全选</span>
          </label>
          {variant === "trash" ? (
            <>
              <button aria-label="恢复选中" className="icon-button subtle" data-tooltip="恢复选中" disabled={count === 0} onClick={onRestore} title="恢复选中" type="button">
                <RotateCcw size={14} />
              </button>
              <button aria-label="彻底删除选中" className="icon-button subtle" data-tooltip="彻底删除选中" disabled={count === 0} onClick={onDelete} title="彻底删除选中" type="button">
                <Trash2 size={14} />
              </button>
              <button aria-label="清空垃圾箱" className="icon-button subtle danger-icon" data-tooltip="清空垃圾箱" onClick={onEmptyTrash} title="清空垃圾箱" type="button">
                <Trash2 size={14} />
              </button>
            </>
          ) : (
            <>
              <button aria-label="聚合复制" className="icon-button subtle" data-tooltip="聚合复制" disabled={count === 0} onClick={onCopy} title="聚合复制" type="button">
                <Copy size={14} />
              </button>
              <button aria-label="批量收藏" className="icon-button subtle" data-tooltip="批量收藏" disabled={count === 0} onClick={onFavorite} title="批量收藏" type="button">
                <Heart size={14} />
              </button>
              <button aria-label="删除" className="icon-button subtle" data-tooltip="删除" disabled={count === 0} onClick={onDelete} title="删除" type="button">
                <Trash2 size={14} />
              </button>
            </>
          )}
          <button aria-label="关闭多选" className="icon-button subtle" data-tooltip="关闭多选" onClick={onClose} title="关闭多选" type="button">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="multi-toolbar-hint">
        {variant === "trash" ? (
          <><kbd>Space</kbd> 选择 · <kbd>Ctrl/Cmd</kbd>+<kbd>A</kbd> 全选 · <kbd>Enter</kbd> 恢复 · <kbd>Delete</kbd> 彻底删除 · <kbd>Esc</kbd> 退出</>
        ) : (
          <><kbd>Space</kbd> 选择 · <kbd>Ctrl/Cmd</kbd>+<kbd>A</kbd> 全选 · <kbd>Ctrl/Cmd</kbd>+<kbd>F</kbd> 收藏 · <kbd>Ctrl/Cmd</kbd>+<kbd>C</kbd> 复制 · <kbd>Esc</kbd> 退出</>
        )}
      </div>
    </section>
  );
}

function BottomDock({
  activeView,
  onDrag,
  onOpenSettings,
  onStartOnboarding,
  onViewChange,
  status,
}: {
  activeView: ViewKey;
  onDrag: (event: PointerEvent<HTMLElement>) => void;
  onOpenSettings: () => void;
  onStartOnboarding: () => void;
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
          data-tooltip="历史"
          onClick={() => onViewChange("history")}
          title="历史"
          type="button"
        >
          <History size={13} />
        </button>
        <button
          aria-label="收藏"
          className={activeView === "favorites" ? "icon-button active" : "icon-button subtle"}
          data-tooltip="收藏"
          onClick={() => onViewChange("favorites")}
          title="收藏"
          type="button"
        >
          <Heart size={13} />
        </button>
        <button
          aria-label="垃圾箱"
          className={activeView === "trash" ? "icon-button active" : "icon-button subtle"}
          data-tooltip="垃圾箱"
          onClick={() => onViewChange("trash")}
          title="垃圾箱"
          type="button"
        >
          <Trash2 size={13} />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label="ClipForge 菜单" className="footer-profile-trigger" data-tooltip="菜单" title="菜单" type="button">
              <Avatar className="footer-profile-avatar">
                <AvatarImage alt="" src={clipforgeAppIcon} />
                <AvatarFallback>CF</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="footer-profile-menu" side="top" align="end" sideOffset={8}>
            <DropdownMenuLabel className="footer-profile-label">
              <span>ClipForge</span>
              <small>Ctrl+V 唤起</small>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onOpenSettings}>
                <span>设置</span>
                <kbd>,</kbd>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onStartOnboarding}>
                <span>入门引导</span>
                <kbd>?</kbd>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </footer>
  );
}

function StatusLine({ status }: { status: string }) {
  return (
    <span className="footer-status">
      {status || (
        <>
          <kbd>Tab</kbd> 导航 · <kbd>Enter</kbd> 粘贴 · <kbd>→</kbd> 详情 · <kbd>Ctrl/Cmd</kbd>+<kbd>J</kbd> 打开目标 · <kbd>Ctrl/Cmd</kbd>+<kbd>P</kbd> 固定
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
  onEmptyTrash,
  onDeleteSelected,
  onHardDelete,
  onLoadMore,
  onPointerActive,
  onRestore,
  onRestoreSelected,
  onSelect,
  onStartMultiSelect,
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
  onEmptyTrash: () => void;
  onDeleteSelected: () => void;
  onHardDelete: (item: ClipItem) => void;
  onLoadMore: () => void;
  onPointerActive: () => void;
  onRestore: (item: ClipItem) => void;
  onRestoreSelected: () => void;
  onSelect: (item: ClipItem) => void;
  onStartMultiSelect: (id: string) => void;
  onToggleSelected: (id: string) => void;
  selectedIds: Set<string>;
  settings: AppSettings;
}) {
  const selectedCount = clips.filter((item) => selectedIds.has(item.id)).length;
  const [contextMenu, setContextMenu] = useState<{ item: ClipItem; x: number; y: number } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const openContextMenu = useCallback((event: MouseEvent<HTMLElement>, item: ClipItem) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(item);
    if (multiSelectMode && !selectedIds.has(item.id)) onToggleSelected(item.id);
    const menuWidth = 204;
    const menuHeight = multiSelectMode ? 188 : 142;
    setContextMenu({
      item,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8)),
    });
  }, [multiSelectMode, onSelect, onToggleSelected, selectedIds]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".clip-context-menu")) return;
      closeContextMenu();
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [closeContextMenu, contextMenu]);

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
      <div className="quick-workspace" onPointerDown={onPointerActive}>
        <VirtualList
          activeId={activeId}
          autoScroll={autoScroll}
          className="quick-menu"
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          itemHeight={36}
          items={clips}
          onEndReached={onLoadMore}
          groupSize={10}
          renderItem={(item, index) => (
            <article
              className={[
                "quick-row",
                activeId === item.id ? "active" : "",
                selectedIds.has(item.id) ? "selected" : "",
                multiSelectMode ? "selecting" : "",
                index < 10 ? "in-active-group" : "",
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
              onRestore(item);
            }}
            onContextMenu={(event) => openContextMenu(event, item)}
            onFocus={() => onSelect(item)}
            tabIndex={0}
            >
              <button
                aria-label={selectedIds.has(item.id) ? "取消选择" : "选择此项"}
                className={selectedIds.has(item.id) ? "quick-index selected" : "quick-index"}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(item);
                  if (multiSelectMode) onToggleSelected(item.id);
                  else onStartMultiSelect(item.id);
                }}
                title="选择此项"
                type="button"
              >
              {selectedIds.has(item.id) ? (
                <Check size={12} />
              ) : index >= 0 && index <= 9 ? (
                <span className="quick-index-num">{index}</span>
              ) : (
                <Square size={12} />
              )}
              </button>
              <div className="quick-content">
                {(() => {
                  const parts = splitLineForMiddleEllipsis(getDisplayText(item, settings));
                  if (!parts.split) {
                    return (
                      <AppTooltip content={getItemTooltip(item)}>
                        <p className="quick-line" aria-label={parts.text}>{parts.text}</p>
                      </AppTooltip>
                    );
                  }
                  return (
                    <AppTooltip content={getItemTooltip(item)}>
                      <p className="quick-line quick-line-mid" aria-label={parts.full}>
                        <span className="ql-head">{parts.head}</span>
                        <span className="ql-tail">{parts.tail}</span>
                      </p>
                    </AppTooltip>
                  );
                })()}
              </div>
              <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                <button
                  className="icon-button"
                  data-tooltip="恢复"
                  onClick={() => onRestore(item)}
                  title="恢复"
                  type="button"
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  className="icon-button danger-icon"
                  data-tooltip="彻底删除"
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
        {contextMenu ? (
          <TrashContextMenu
            item={contextMenu.item}
            multiSelectMode={multiSelectMode}
            onClose={closeContextMenu}
            onDeleteSelected={onDeleteSelected}
            onEmptyTrash={onEmptyTrash}
            onHardDelete={onHardDelete}
            onRestore={onRestore}
            onRestoreSelected={onRestoreSelected}
            onStartMultiSelect={onStartMultiSelect}
            selectedCount={selectedCount}
            x={contextMenu.x}
            y={contextMenu.y}
          />
        ) : null}
      </div>
    </section>
  );
}

function TrashContextMenu({
  item,
  multiSelectMode,
  onClose,
  onDeleteSelected,
  onEmptyTrash,
  onHardDelete,
  onRestore,
  onRestoreSelected,
  onStartMultiSelect,
  selectedCount,
  x,
  y,
}: {
  item: ClipItem;
  multiSelectMode: boolean;
  onClose: () => void;
  onDeleteSelected: () => void;
  onEmptyTrash: () => void;
  onHardDelete: (item: ClipItem) => void;
  onRestore: (item: ClipItem) => void;
  onRestoreSelected: () => void;
  onStartMultiSelect: (id: string) => void;
  selectedCount: number;
  x: number;
  y: number;
}) {
  const run = (action: () => void) => {
    action();
    onClose();
  };
  return (
    <div
      aria-label="垃圾箱项目菜单"
      className="clip-context-menu"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      style={{ left: x, top: y }}
    >
      {multiSelectMode ? (
        <>
          <button className="clip-context-item" disabled={selectedCount === 0} onClick={() => run(onRestoreSelected)} role="menuitem" type="button">
            <span className="clip-context-label"><RotateCcw size={13} />恢复选中</span>
            <kbd>{selectedCount}</kbd>
          </button>
          <button className="clip-context-item" disabled={selectedCount === 0} onClick={() => run(onDeleteSelected)} role="menuitem" type="button">
            <span className="clip-context-label"><Trash2 size={13} />彻底删除选中</span>
            <kbd>Del</kbd>
          </button>
          <div className="clip-context-separator" role="separator" />
          <button className="clip-context-item danger" onClick={() => run(onEmptyTrash)} role="menuitem" type="button">
            <span className="clip-context-label"><Trash2 size={13} />清空垃圾箱</span>
            <kbd>全部</kbd>
          </button>
        </>
      ) : (
        <>
          <button className="clip-context-item" onClick={() => run(() => onRestore(item))} role="menuitem" type="button">
            <span className="clip-context-label"><RotateCcw size={13} />恢复</span>
            <kbd>Enter</kbd>
          </button>
          <button className="clip-context-item" onClick={() => run(() => onStartMultiSelect(item.id))} role="menuitem" type="button">
            <span className="clip-context-label"><Square size={13} />选中该项</span>
            <kbd>Space</kbd>
          </button>
          <div className="clip-context-separator" role="separator" />
          <button className="clip-context-item danger" onClick={() => run(() => onHardDelete(item))} role="menuitem" type="button">
            <span className="clip-context-label"><Trash2 size={13} />彻底删除</span>
            <kbd>Del</kbd>
          </button>
        </>
      )}
    </div>
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
  groupSize,
  onActiveGroupChange,
  scrollToGroupStart,
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
  groupSize?: number;
  onActiveGroupChange?: (groupStart: number) => void;
  scrollToGroupStart?: number | null;
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

  // 分组：按视口中心算"激活分组"起始下标（groupSize 整数倍），上报父级（给 Cmd+0-9 用）。
  useEffect(() => {
    if (!groupSize || !onActiveGroupChange) return;
    const centerIndex = Math.floor((scrollTop + height / 2) / itemHeight);
    const groupStart = Math.max(0, Math.floor(centerIndex / groupSize) * groupSize);
    onActiveGroupChange(groupStart);
  }, [scrollTop, height, itemHeight, groupSize, onActiveGroupChange]);

  // 父级命令：滚动到某个分组起始（Cmd+↑/↓ 切组用）。
  useEffect(() => {
    if (scrollToGroupStart == null) return;
    const node = ref.current;
    if (!node) return;
    // 切组时下偏一点，避免组首行被顶部搜索/导航栏遮挡。
    const GROUP_SCROLL_TOP_OFFSET = 56;
    const top = Math.max(0, scrollToGroupStart * itemHeight - GROUP_SCROLL_TOP_OFFSET);
    setFeedback(true);
    node.scrollTo({ top, behavior: "smooth" });
  }, [scrollToGroupStart, itemHeight, setFeedback]);

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
  onFavoriteSelected,
  onLoadMore,
  onOpen,
  onOpenAggregate,
  onPointerActive,
  onPaste,
  onCopySelected,
  onDelete,
  onDeleteSelected,
  onSelect,
  onStartMultiSelect,
  onToggleSelected,
  onClearSelection,
  selectedIds,
  activeGroupStart,
  onActiveGroupChange,
  groupScrollTarget,
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
  onFavoriteSelected: () => void;
  onLoadMore: () => void;
  onOpen: (item: ClipItem) => void;
  onOpenAggregate: () => void;
  onPointerActive: () => void;
  onPaste: (item: ClipItem, source?: string) => void;
  onCopySelected: () => void;
  onDelete: (item: ClipItem) => void;
  onDeleteSelected: () => void;
  onSelect: (item: ClipItem) => void;
  onStartMultiSelect: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onClearSelection: () => void;
  activeGroupStart: number;
  onActiveGroupChange: (groupStart: number) => void;
  groupScrollTarget: number | null;
}) {
  const [contextMenu, setContextMenu] = useState<{ item: ClipItem; x: number; y: number } | null>(null);
  const [suppressTooltips, setSuppressTooltips] = useState(false);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const openContextMenu = useCallback((event: MouseEvent<HTMLElement>, item: ClipItem) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(item);
    setSuppressTooltips(true);
    window.setTimeout(() => setSuppressTooltips(false), 900);
    if (multiSelectMode && !selectedIds.has(item.id)) onToggleSelected(item.id);
    const menuWidth = 204;
    const menuHeight = multiSelectMode ? 190 : 228;
    setContextMenu({
      item,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8)),
    });
  }, [multiSelectMode, onSelect, onToggleSelected, selectedIds]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".clip-context-menu")) return;
      closeContextMenu();
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [closeContextMenu, contextMenu]);

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
    <section className={suppressTooltips ? "quick-panel suppress-tooltips" : "quick-panel"}>
      <div className="quick-workspace" onPointerDown={onPointerActive}>
        <VirtualList
          activeId={activeId}
          autoScroll={autoScroll}
          className="quick-menu"
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          itemHeight={36}
          items={clips}
          onEndReached={onLoadMore}
          groupSize={10}
          onActiveGroupChange={onActiveGroupChange}
          scrollToGroupStart={groupScrollTarget}
          renderItem={(item, index) => (
          <article
            className={[
              "quick-row",
              activeId === item.id ? "active" : "",
              copiedId === item.id ? "copied" : "",
              selectedIds.has(item.id) ? "selected" : "",
              multiSelectMode ? "selecting" : "",
              index >= activeGroupStart && index < activeGroupStart + 10 ? "in-active-group" : "",
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
              onPaste(item, "click");
            }}
            onContextMenu={(event) => {
              openContextMenu(event, item);
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
              {selectedIds.has(item.id) ? (
                <Check size={12} />
              ) : copiedId === item.id ? (
                <Check size={12} />
              ) : index - activeGroupStart >= 0 && index - activeGroupStart <= 9 ? (
                <span className="quick-index-num">{index - activeGroupStart}</span>
              ) : (
                <Square size={12} />
              )}
            </button>
            <div className="quick-content">
              {(() => {
                const parts = splitLineForMiddleEllipsis(getClipboardLine(item));
                if (!parts.split) {
                  return (
                    <AppTooltip content={getItemTooltip(item)}>
                      <p className="quick-line" aria-label={parts.text}>{parts.text}</p>
                    </AppTooltip>
                  );
                }
                return (
                  <AppTooltip content={getItemTooltip(item)}>
                    <p className="quick-line quick-line-mid" aria-label={parts.full}>
                      <span className="ql-head">{parts.head}</span>
                      <span className="ql-tail">{parts.tail}</span>
                    </p>
                  </AppTooltip>
                );
              })()}
            </div>
            <div className={item.favorite ? "row-actions has-favorite" : "row-actions"} onClick={(event) => event.stopPropagation()}>
              {item.analysis.url || item.analysis.attachment ? (
                <button className="icon-button" data-tooltip="打开链接" onClick={() => onOpen(item)} title="打开链接" type="button">
                  <ExternalLink size={14} />
                </button>
              ) : null}
              <button
                className={item.favorite ? "quick-fav faved" : "quick-fav"}
                data-tooltip={item.favorite ? "取消收藏" : "收藏"}
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
        {contextMenu ? (
          <ClipContextMenu
            item={contextMenu.item}
            multiSelectMode={multiSelectMode}
            onClose={closeContextMenu}
            onFavorite={onFavorite}
            onFavoriteSelected={onFavoriteSelected}
            onDelete={() => onDelete(contextMenu.item)}
            onDeleteSelected={onDeleteSelected}
            onOpenAggregate={onOpenAggregate}
            onPaste={onPaste}
            onCopySelected={onCopySelected}
            onStartMultiSelect={onStartMultiSelect}
            onClearSelection={onClearSelection}
            selectedCount={selectedIds.size}
            x={contextMenu.x}
            y={contextMenu.y}
          />
        ) : null}
      </div>
    </section>
  );
}

function ClipContextMenu({
  item,
  multiSelectMode,
  onClose,
  onDelete,
  onDeleteSelected,
  onFavorite,
  onFavoriteSelected,
  onOpenAggregate,
  onPaste,
  onCopySelected,
  onStartMultiSelect,
  onClearSelection,
  selectedCount,
  x,
  y,
}: {
  item: ClipItem;
  multiSelectMode: boolean;
  onClose: () => void;
  onDelete: () => void;
  onDeleteSelected: () => void;
  onFavorite: (item: ClipItem) => void;
  onFavoriteSelected: () => void;
  onOpenAggregate: () => void;
  onPaste: (item: ClipItem, source?: string) => void;
  onCopySelected: () => void;
  onStartMultiSelect: (id: string) => void;
  onClearSelection: () => void;
  selectedCount: number;
  x: number;
  y: number;
}) {
  const mod = getShortcutModLabel();
  const run = (action: () => void) => {
    action();
    onClose();
  };
  return (
    <div
      aria-label="剪贴板项目菜单"
      className="clip-context-menu"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      style={{ left: x, top: y }}
    >
      {multiSelectMode ? (
        <>
          <button className="clip-context-item" onClick={() => run(onOpenAggregate)} role="menuitem" type="button">
            <span className="clip-context-label"><CheckSquare size={13} />聚合显示</span>
            <kbd>{selectedCount}</kbd>
          </button>
          <button className="clip-context-item" onClick={() => run(onCopySelected)} role="menuitem" type="button">
            <span className="clip-context-label"><Copy size={13} />复制选中</span>
            <kbd>{mod}+C</kbd>
          </button>
          <button className="clip-context-item" onClick={() => run(onFavoriteSelected)} role="menuitem" type="button">
            <span className="clip-context-label"><Heart size={13} />收藏选中</span>
            <kbd>{mod}+F</kbd>
          </button>
          <button className="clip-context-item danger" onClick={() => run(onDeleteSelected)} role="menuitem" type="button">
            <span className="clip-context-label"><Trash2 size={13} />删除选中</span>
            <kbd>Del</kbd>
          </button>
          <div className="clip-context-separator" role="separator" />
          <button className="clip-context-item" onClick={() => run(onClearSelection)} role="menuitem" type="button">
            <span className="clip-context-label"><X size={13} />退出多选</span>
            <kbd>Esc</kbd>
          </button>
        </>
      ) : (
        <>
          <button className="clip-context-item" onClick={() => run(() => onPaste(item, "context-menu"))} role="menuitem" type="button">
            <span className="clip-context-label"><Clipboard size={13} />粘贴</span>
            <kbd>Enter</kbd>
          </button>
          <button
            className="clip-context-item"
            onClick={() => run(() => {
              logAppError("info", "context-menu-detail", {
                id: item.id,
                hasUrl: Boolean(item.analysis.url),
                hasAttachment: Boolean(item.analysis.attachment),
              });
              void navigateWorkspaceDetail(item.id);
            })}
            role="menuitem"
            type="button"
          >
            <span className="clip-context-label"><FileJson size={13} />进入详情</span>
            <kbd>→</kbd>
          </button>
          {item.analysis.url || item.analysis.attachment ? (
            <div className="clip-context-item is-hint" role="presentation">
              <span className="clip-context-label"><ExternalLink size={13} />打开目标</span>
              <kbd>{mod}+J</kbd>
            </div>
          ) : null}
          <button className="clip-context-item" onClick={() => run(() => onFavorite(item))} role="menuitem" type="button">
            <span className="clip-context-label"><Heart size={13} />{item.favorite ? "取消收藏" : "收藏"}</span>
            <kbd>{mod}+F</kbd>
          </button>
          <button className="clip-context-item danger" onClick={() => run(onDelete)} role="menuitem" type="button">
            <span className="clip-context-label"><Trash2 size={13} />删除</span>
            <kbd>Del</kbd>
          </button>
          <div className="clip-context-separator" role="separator" />
          <button className="clip-context-item" onClick={() => run(() => onStartMultiSelect(item.id))} role="menuitem" type="button">
            <span className="clip-context-label"><Square size={13} />选中该项</span>
            <kbd>Space</kbd>
          </button>
        </>
      )}
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
