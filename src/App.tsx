import {
  Check,
  CheckSquare,
  Bot,
  Clipboard,
  Copy,
  ExternalLink,
  FileJson,
  Heart,
  History,
  Image as ImageIcon,
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
import { motion, useReducedMotion } from "motion/react";
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { match as matchPinyin } from "pinyin-pro";
import { create } from "zustand";
import type { CSSProperties, ErrorInfo, MouseEvent, PointerEvent, ReactNode, RefObject, UIEvent } from "react";
import {
  formatCommandError,
  normalizeLanguagePreference,
  resolveAppLocale,
  setDocumentLocale,
  t,
  type AppLanguagePreference,
  type TranslationKey,
} from "./i18n";
import { checkFilePaths, pasteClipboard, readClipboard, writeClipboard, type FilePathStatus } from "./services/clipboard";
import { resolvePrimaryPluginAction } from "./plugin-actions";
import {
  getSearchSuggestionToken,
  matchesSearchSuggestionToken,
  normalizeSearch,
  normalizeTagName,
  parseSearchCommand,
  type ParsedSearchCommand,
  type SearchQueryAst,
  type SearchSuggestion,
} from "./search-query";
import {
  WorkspaceRouterProvider,
  navigateWorkspaceAggregate,
  navigateWorkspaceDetail,
  navigateWorkspaceList,
} from "./routes/workspace-router";
import { useWorkspaceStore } from "./stores/workspace-store";
import { ClipDetailWorkspace, MultiAggregateWorkspace } from "./workspace/workspace-panels";
import { ClipboardAgentPanel } from "./agent-panel";
import type { AgentContextReference } from "./services/contracts";
import { getErrorDiagnostics, getFrontendEnvironmentSnapshot } from "./frontend-diagnostics";
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
import { Tabs, TabsList, TabsTrigger } from "./components/animate-ui/components/animate/tabs";
import agentAccessIcon from "../assets/brand/icons/256/agent-access.png";
import clipforgeAppIcon from "../src-tauri/icons/64x64.png";
import "./App.css";

type ClipKind = "text" | "code" | "link" | "markdown" | "command" | "attachment" | "json" | "chart" | "table";
export type ClipPayloadKind = "text" | "link" | "markdown" | "code" | "command" | "html" | "rtf" | "file" | "image" | "json" | "chart" | "table";
type ClipTypeFilter = "all" | ClipPayloadKind;
type ClipBucket = "history" | "archive" | "snippet";
type PasteMode = "rich" | "plain" | "filesAsPaths";

type SourceAppInfo = {
  name: string;
  bundleId: string;
  executablePath: string;
  iconBase64?: string;
};
type ViewKey = "history" | "favorites" | "trash";
type PanelSurface = "clipboard" | "agent";
type PanelDensity = "dense" | "normal" | "comfortable";
type TagMode = "similar" | "rules" | "off";
type ContentDisplayMode = "summary" | "middle" | "raw";

const dockButtonTransition = { type: "spring", stiffness: 430, damping: 30, mass: 0.42 } as const;
const dockTabTransition = { type: "spring", stiffness: 360, damping: 30, mass: 0.5 } as const;
export type ClipboardRepresentation = {
  format: "text/plain" | "text/html" | "text/rtf" | "image/png" | "application/file-list" | "text/uri-list" | string;
  storage: "inline" | "file" | "derived" | string;
  content?: string | null;
  fileName?: string | null;
  size?: number | null;
  hash?: string | null;
  preferred?: boolean;
};

export type ClipCaptureContext = {
  schemaVersion: number;
  surface: string;
  sourceLabel: string;
  sourceApp?: Record<string, unknown> | null;
  observedAt: number;
  primaryFormat: string;
  availableFormats: string[];
  environment: Record<string, unknown>;
};

type ContentSource =
  | "github"
  | "gitlab"
  | "command"
  | "markdown"
  | "code"
  | "json"
  | "table"
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
  contentHash: string;
  primaryFormat: string;
  availableFormats: string[];
  representations: ClipboardRepresentation[];
  plainText: string;
  searchText?: string | null;
  subKind?: string | null;
  width?: number | null;
  height?: number | null;
  size?: number | null;
  fileTypes?: string | null;
  thumbnailPath?: string | null;
  imageFile?: string | null;
  isSensitive?: boolean;
  captureContext: ClipCaptureContext;
  metadata: Record<string, unknown>;
  agentContext: Record<string, unknown>;
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

type TagRule = {
  id: string;
  label: string;
  query: string;
};

type AppSettings = {
  language: AppLanguagePreference;
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
  logMaxSizeMb: number;
  logKeepRatio: number;
  logMaxLines: number;
  logRetentionDays: number;
  logAutoCleanup: boolean;
  logCleanupIntervalMin: number;
  captureTextEnabled: boolean;
  captureHtmlEnabled: boolean;
  captureRtfEnabled: boolean;
  captureImageEnabled: boolean;
  captureFileEnabled: boolean;
  captureSensitiveEnabled: boolean;
  imageMaxSizeMb: number;
  textMaxSizeMb: number;
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

type AccessibilityFirstPromptPayload = {
  status: "granted" | "missing" | "unsupported" | "error";
  message: string;
  prompted: boolean;
  createdAt: number;
};

type McpStatusPayload = {
  command: string;
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

type SearchClipsRequest = {
  text?: string;
  bucket?: "all" | ClipBucket | "trash";
  kinds?: string[];
  types?: ClipPayloadKind[];
  tags?: string[];
  fileExtensions?: string[];
  favorite?: boolean;
  limit?: number;
  cursor?: string | null;
};

function isQueryClipPayload(payload: unknown): payload is QueryClipPayload {
  return Boolean(payload && typeof payload === "object" && Array.isArray((payload as QueryClipPayload).items));
}

function isCaptureClipPayload(payload: unknown): payload is CaptureClipPayload {
  const item = payload && typeof payload === "object" ? (payload as Partial<CaptureClipPayload>).item : null;
  return Boolean(item && typeof item === "object" && typeof (item as Partial<ClipItem>).content === "string");
}

const ACTIVE_VIEW_KEY = "clipforge.active-view.v1";
const LEGACY_DEFAULT_SHORTCUT = "CommandOrControl+Shift+V";
const DEFAULT_SHORTCUT = "Control+V";
const ROW_HEIGHT = 36;
const OVERSCAN = 5;
const DEFAULT_PANEL_HEIGHT = 400;
function getOnboardingSampleContent(tr: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  return [
    tr("main.sample.title"),
    "",
    tr("main.sample.description"),
    tr("main.sample.shortcut.open"),
    tr("main.sample.shortcut.paste"),
    tr("main.sample.shortcut.favorite"),
    tr("main.sample.shortcut.delete"),
    tr("main.sample.shortcut.detail"),
    "",
    "https://ui.shadcn.com/docs/components/base/dropdown-menu",
  ].join("\n");
}
const defaultSettings: AppSettings = {
  language: "system",
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
  logMaxSizeMb: 10,
  logKeepRatio: 0.6,
  logMaxLines: 20000,
  logRetentionDays: 0,
  logAutoCleanup: true,
  logCleanupIntervalMin: 10,
  captureTextEnabled: true,
  captureHtmlEnabled: true,
  captureRtfEnabled: true,
  captureImageEnabled: true,
  captureFileEnabled: true,
  captureSensitiveEnabled: false,
  imageMaxSizeMb: 25,
  textMaxSizeMb: 5,
};

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeTagList(values: string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  values.forEach((value) => {
    const tag = normalizeTagName(value);
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(tag);
  });
  return tags.slice(0, 12);
}

export function extractHashTags(content: string): string[] {
  return normalizeTagList(
    Array.from(content.matchAll(/(^|[\s([{])#([\p{L}\p{N}_-]{1,32})/gu)).map((match) => match[2]),
  );
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

function isJsonLike(content: string) {
  const trimmed = content.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
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
  if (isJsonLike(content)) {
    const isArray = content.trimStart().startsWith("[");
    return {
      source: "json",
      sourceName: "JSON",
      badge: "JSON",
      title: isArray ? "JSON Array" : "JSON Object",
      summary: middleEllipsis(normalized, 56, 12),
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
  if (analysis.source === "json") return "json";
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
  if (analysis.source === "json") return ["JSON"];
  if (analysis.source === "markdown") return ["Markdown"];
  if (analysis.source === "code") return ["代码"];
  return ["文本"];
}

function getPayloadKindFromFormat(primaryFormat: string, fallback: ClipPayloadKind): ClipPayloadKind {
  if (primaryFormat === "image/png") return "image";
  if (primaryFormat === "application/file-list") return "file";
  if (primaryFormat === "text/html") return "html";
  if (primaryFormat === "text/rtf") return "rtf";
  if (primaryFormat === "text/uri-list") return "link";
  return fallback;
}

function getPrimaryFormatForPayload(payloadKind: ClipPayloadKind) {
  if (payloadKind === "image") return "image/png";
  if (payloadKind === "file") return "application/file-list";
  if (payloadKind === "html") return "text/html";
  if (payloadKind === "rtf") return "text/rtf";
  return "text/plain";
}

function createTextRepresentation(content: string, payloadKind: ClipPayloadKind): ClipboardRepresentation[] {
  return [
    {
      format: getPrimaryFormatForPayload(payloadKind),
      storage: "inline",
      content,
      size: new Blob([content]).size,
      preferred: true,
    },
    ...(payloadKind === "html"
      ? [{ format: "text/plain", storage: "derived", content: content.replace(/<[^>]+>/g, " "), preferred: false }]
      : []),
  ];
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

function removeSearchFilterToken(rawQuery: string, label: string) {
  const normalizedLabel = normalizeSearch(label);
  const labelValue = label.replace(/^#/, "").replace(/^[^:]+:/, "");
  const normalizedValue = normalizeSearch(labelValue);
  return rawQuery
    .trim()
    .split(/\s+/)
    .filter((token) => {
      const normalizedToken = normalizeSearch(token);
      if (normalizedToken === normalizedLabel) return false;
      if (normalizedLabel.startsWith("#")) {
        return normalizedToken !== `#${normalizedValue}` && normalizedToken !== `tag:${normalizedValue}`;
      }
      if (normalizedLabel.startsWith("type:")) {
        return normalizedToken !== normalizedLabel && normalizedToken !== `@${normalizedValue}`;
      }
      if (normalizedLabel.startsWith("@") && normalizedLabel.endsWith(":")) {
        return normalizedToken !== normalizedLabel;
      }
      if (normalizedLabel.startsWith("kind:") || normalizedLabel.startsWith("file:") || normalizedLabel.startsWith("bucket:")) {
        return normalizedToken !== normalizedLabel;
      }
      return true;
    })
    .join(" ");
}

function createClip(content: string, settings: AppSettings): ClipItem {
  const now = Date.now();
  const analysis = analyzeContent(content);
  const kind = detectKind(content);
  const payloadKind = kind === "attachment" ? (analysis.attachment?.isImage ? "image" : "file") : (kind as ClipPayloadKind);
  const primaryFormat = getPrimaryFormatForPayload(payloadKind);
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
    payloadKind,
    contentHash: `${payloadKind}:${now}`,
    primaryFormat,
    availableFormats: [primaryFormat],
    representations: createTextRepresentation(content, payloadKind),
    plainText: content,
    searchText: content,
    subKind: payloadKind === "html" ? "html" : null,
    size: new Blob([content]).size,
    fileTypes: null,
    thumbnailPath: null,
    imageFile: null,
    isSensitive: false,
    captureContext: {
      schemaVersion: 1,
      surface: "frontend",
      sourceLabel: analysis.sourceName,
      sourceApp: null,
      observedAt: now,
      primaryFormat,
      availableFormats: [primaryFormat],
      environment: {},
    },
    metadata: {},
    agentContext: {},
  };
}

function mergeSettings(value: Partial<AppSettings> | null | undefined): AppSettings {
  const next = { ...defaultSettings, ...(value ?? {}) };
  const globalShortcut = next.globalShortcut?.trim();
  return {
    ...next,
    language: normalizeLanguagePreference(next.language),
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
    captureTextEnabled: typeof next.captureTextEnabled === "boolean" ? next.captureTextEnabled : defaultSettings.captureTextEnabled,
    captureHtmlEnabled: typeof next.captureHtmlEnabled === "boolean" ? next.captureHtmlEnabled : defaultSettings.captureHtmlEnabled,
    captureRtfEnabled: typeof next.captureRtfEnabled === "boolean" ? next.captureRtfEnabled : defaultSettings.captureRtfEnabled,
    captureImageEnabled: typeof next.captureImageEnabled === "boolean" ? next.captureImageEnabled : defaultSettings.captureImageEnabled,
    captureFileEnabled: typeof next.captureFileEnabled === "boolean" ? next.captureFileEnabled : defaultSettings.captureFileEnabled,
    captureSensitiveEnabled:
      typeof next.captureSensitiveEnabled === "boolean"
        ? next.captureSensitiveEnabled
        : defaultSettings.captureSensitiveEnabled,
    imageMaxSizeMb: clampNumber(next.imageMaxSizeMb, 1, 1024, defaultSettings.imageMaxSizeMb),
    textMaxSizeMb: clampNumber(next.textMaxSizeMb, 1, 100, defaultSettings.textMaxSizeMb),
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
  const detectedKind = detectKind(raw.content);
  const validKinds: ClipKind[] = ["text", "code", "link", "markdown", "command", "attachment", "json", "chart", "table"];
  const kind = validKinds.includes(raw.kind as ClipKind) ? (raw.kind as ClipKind) : detectedKind;
  const payloadKind =
    typeof raw.payloadKind === "string"
      ? getPayloadKindFromFormat(raw.primaryFormat ?? "", raw.payloadKind as ClipPayloadKind)
      : kind === "attachment"
        ? (analysis.attachment?.isImage ? "image" : "file")
        : (kind as ClipPayloadKind);
  const primaryFormat =
    typeof raw.primaryFormat === "string" && raw.primaryFormat
      ? raw.primaryFormat
      : getPrimaryFormatForPayload(payloadKind);
  const availableFormats = Array.isArray(raw.availableFormats) && raw.availableFormats.length
    ? raw.availableFormats.filter((format): format is string => typeof format === "string")
    : [primaryFormat];
  const representations = Array.isArray(raw.representations) && raw.representations.length
    ? raw.representations
    : createTextRepresentation(raw.content, payloadKind);
  const tags = Array.isArray(raw.tags) ? normalizeTagList(raw.tags) : normalizeTagList(generateTags(raw.content, settings));
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
    tags,
    copyCount: typeof raw.copyCount === "number" ? raw.copyCount : 0,
    analysis,
    payloadKind,
    contentHash: typeof raw.contentHash === "string" ? raw.contentHash : `${payloadKind}:${raw.id ?? createdAt}`,
    primaryFormat,
    availableFormats,
    representations,
    plainText: typeof raw.plainText === "string" ? raw.plainText : raw.content,
    searchText: typeof raw.searchText === "string" ? raw.searchText : raw.content,
    subKind: typeof raw.subKind === "string" ? raw.subKind : null,
    width: typeof raw.width === "number" ? raw.width : null,
    height: typeof raw.height === "number" ? raw.height : null,
    size: typeof raw.size === "number" ? raw.size : new Blob([raw.content]).size,
    fileTypes: typeof raw.fileTypes === "string" ? raw.fileTypes : null,
    thumbnailPath: typeof raw.thumbnailPath === "string" ? raw.thumbnailPath : null,
    imageFile: typeof raw.imageFile === "string" ? raw.imageFile : null,
    isSensitive: Boolean(raw.isSensitive),
    captureContext: raw.captureContext ?? {
      schemaVersion: 1,
      surface: "clipboard",
      sourceLabel: raw.source ?? analysis.sourceName,
      sourceApp: null,
      observedAt: lastSeenAt,
      primaryFormat,
      availableFormats,
      environment: {},
    },
    metadata: raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {},
    agentContext: raw.agentContext && typeof raw.agentContext === "object" ? raw.agentContext : {},
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
      tags: normalizeTagList(clip.tags.length ? clip.tags : generateTags(clip.content, settings)),
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

function buildSearchClipsRequest({
  activeTag,
  activeTypeFilter,
  activeView,
  ast,
  cursor,
  filterFavorite,
  limit,
}: {
  activeTag: string | null;
  activeTypeFilter: ClipTypeFilter;
  activeView: ViewKey;
  ast: SearchQueryAst;
  cursor?: string | null;
  filterFavorite: boolean;
  limit: number;
}): SearchClipsRequest {
  const bucket = ast.bucket !== "all" ? ast.bucket : (getBucketForView(activeView) ?? "all");
  const tags = normalizeTagList([...(activeTag ? [activeTag] : []), ...ast.tags]);
  const types = activeTypeFilter !== "all" ? [activeTypeFilter] : ast.types;
  return {
    text: ast.text.trim() || undefined,
    bucket,
    kinds: ast.kinds.length ? ast.kinds : undefined,
    types: types.length ? types : undefined,
    tags: tags.length ? tags : undefined,
    fileExtensions: ast.fileExtensions.length ? ast.fileExtensions : undefined,
    favorite: isFavoriteView(activeView) || filterFavorite || ast.favorite ? true : undefined,
    limit,
    cursor,
  };
}

function getDisplayText(item: ClipItem, settings: AppSettings) {
  if (settings.contentDisplayMode === "raw") return item.content.replace(/\s+/g, " ").trim();
  if (settings.contentDisplayMode === "middle") return middleEllipsis(item.content);
  return item.analysis.summary || middleEllipsis(item.content);
}

function getClipboardLine(item: ClipItem) {
  if (item.payloadKind === "image") {
    return item.imageFile || item.analysis.attachment?.name || item.content || item.analysis.title || "Image";
  }
  if (item.payloadKind === "file") {
    const files = getFilePathsFromClip(item);
    const first = files[0]?.split(/[\\/]/).filter(Boolean).at(-1);
    return first ? `${first}${files.length > 1 ? ` +${files.length - 1}` : ""}` : item.analysis.title || item.content;
  }
  const firstLine = (item.content || "").split(/\r?\n/, 1)[0] ?? "";
  const line = firstLine.replace(/\s+/g, " ").trim();
  return line || item.analysis.title || "";
}

function getFilePathsFromClip(item: ClipItem) {
  if (item.payloadKind !== "file") return [];
  return item.content
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
}

function isFileClipMissing(item: ClipItem, statuses: Record<string, FilePathStatus>) {
  const paths = getFilePathsFromClip(item);
  if (!paths.length) return false;
  return paths.some((path) => statuses[path]?.exists === false);
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
    typeof context === "string" ? context : context ? JSON.stringify(context).slice(0, 8000) : "";
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

type OnboardingStep = {
  title: string;
  content: ReactNode;
};

function getItemTooltip(item: ClipItem, tr: (key: TranslationKey, params?: Record<string, string | number>) => string): AppTooltipContent {
  const source = item.sourceApp?.name || item.analysis.sourceName || tr("main.tooltip.clipboardHistory");
  const title = item.analysis.title || source;
  const description = item.analysis.url ? tr("main.tooltip.linkContent") : item.analysis.attachment ? tr("main.tooltip.attachmentContent") : source;
  // tooltip 每个可见行都常驻挂载在 DOM（仅 opacity:0）。把整篇大文案塞进 body，
  // 大文本条目会让打开那一帧布局/提交暴涨 200–340ms、阻塞输入。截断到预览长度即可；
  // 复制/粘贴走 item.content 本体，不受影响。
  const fullBody = item.content || getClipboardLine(item);
  const body =
    fullBody.length > 600
      ? `${fullBody.slice(0, 600)}\n${tr("main.tooltip.omitted", { total: fullBody.length, omitted: fullBody.length - 600 })}`
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

function OnboardingInlineAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="onboarding-inline-action" onClick={onClick} type="button">
      <Copy size={12} />
      {label}
    </button>
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

function ScenarioOnboardingLayer({
  index,
  run,
  steps,
  tr,
  onBack,
  onClose,
  onNext,
}: {
  index: number;
  run: boolean;
  steps: OnboardingStep[];
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  onBack: () => void;
  onClose: () => void;
  onNext: () => void;
}) {
  if (!run) return null;
  const step = steps[Math.min(index, Math.max(0, steps.length - 1))];
  if (!step) return null;
  const isLastStep = index >= steps.length - 1;
  return (
    <div className="scenario-onboarding-layer" role="dialog" aria-modal="true" aria-label={step.title}>
      <button className="scenario-onboarding-scrim" aria-label={tr("main.joyride.close")} onClick={onClose} type="button" />
      <section className="scenario-onboarding-card">
        <button className="centered-onboarding-close" type="button" onClick={onClose} aria-label={tr("main.joyride.close")}>
          <X size={12} />
        </button>
        <div className="centered-onboarding-copy">
          <strong>{step.title}</strong>
          <div>{step.content}</div>
        </div>
        <div className="scenario-onboarding-stepper" aria-label={`${index + 1}/${steps.length}`}>
          {steps.map((item, itemIndex) => (
            <span className={itemIndex === index ? "active" : ""} key={item.title} />
          ))}
        </div>
        <div className="centered-onboarding-footer">
          <span>{index + 1}/{steps.length}</span>
          <div>
            {index > 0 ? (
              <button className="centered-onboarding-ghost" type="button" onClick={onBack}>
                {tr("main.joyride.back")}
              </button>
            ) : null}
            <button className="centered-onboarding-ghost" type="button" onClick={onClose}>
              {tr("main.joyride.skip")}
            </button>
            <button className="centered-onboarding-primary" type="button" onClick={onNext}>
              {isLastStep ? tr("main.joyride.last") : tr("main.joyride.next")}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function makeOnboardingSteps(
  mod: string,
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string,
  onCopyMcpInstallPrompt: () => void,
): OnboardingStep[] {
  return [
    {
      title: tr("main.onboarding.sceneSelect.title"),
      content: (
        <div className="onboarding-step">
          <p>{tr("main.onboarding.sceneSelect.body")}</p>
          <ShortcutDemo icon={<CheckSquare size={12} />} keys={["↑", "↓"]} label={tr("main.onboarding.selection.move")} />
          <ShortcutDemo icon={<Clipboard size={12} />} keys={[mod, "0-9"]} label={tr("main.onboarding.number.paste")} />
        </div>
      ),
    },
    {
      title: tr("main.onboarding.scenePreview.title"),
      content: (
        <div className="onboarding-step">
          <p>{tr("main.onboarding.scenePreview.body")}</p>
          <ShortcutDemo icon={<History size={12} />} keys={[mod, "↑/↓"]} label={tr("main.onboarding.selection.page")} />
          <ShortcutDemo icon={<ExternalLink size={12} />} keys={["→"]} label={tr("main.onboarding.scenePreview.drill")} />
        </div>
      ),
    },
    {
      title: tr("main.onboarding.sceneAi.title"),
      content: (
        <div className="onboarding-step">
          <p>{tr("main.onboarding.sceneAi.body")}</p>
          <ShortcutDemo icon={<Bot size={12} />} keys={[mod, "I"]} label={tr("main.onboarding.agent.shortcut")} />
          <ShortcutDemo icon={<Bot size={12} />} keys={["@"]} label={tr("main.onboarding.agent.reference")} />
          <OnboardingInlineAction label={tr("main.onboarding.agent.copyMcp")} onClick={onCopyMcpInstallPrompt} />
        </div>
      ),
    },
  ];
}

type ErrorBoundaryCopy = {
  toastMessage: string;
  recoverLabel: string;
  panelTitle: string;
  panelMessage: string;
  agentTitle: string;
  agentMessage: string;
  backToClipboard: string;
};

class AppErrorBoundary extends Component<{ children: ReactNode; copy: Pick<ErrorBoundaryCopy, "toastMessage" | "recoverLabel"> }, { errorMessage: string | null; resetKey: number }> {
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
            <span>{this.props.copy.toastMessage}</span>
            <button
              className="text-button"
              onClick={() => this.setState((state) => ({ errorMessage: null, resetKey: state.resetKey + 1 }))}
              type="button"
            >
              {this.props.copy.recoverLabel}
            </button>
          </div>
        ) : null}
      </>
    );
  }
}

class PanelContentBoundary extends Component<
  { children: ReactNode; copy: Pick<ErrorBoundaryCopy, "panelTitle" | "panelMessage">; resetKey: string },
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
          <strong>{this.props.copy.panelTitle}</strong>
          <span>{this.props.copy.panelMessage}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

class AgentPanelBoundary extends Component<
  { children: ReactNode; copy: Pick<ErrorBoundaryCopy, "agentTitle" | "agentMessage" | "backToClipboard">; resetKey: string; onClose: () => void },
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
    logAppError("error", `Agent panel failed: ${error.message}`, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="panel-fallback agent-panel-fallback">
          <Bot size={22} />
          <strong>{this.props.copy.agentTitle}</strong>
          <span>{this.props.copy.agentMessage}</span>
          <button className="text-button" onClick={this.props.onClose} type="button">
            {this.props.copy.backToClipboard}
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
  const initialLocale = resolveAppLocale(initialSettings.language);
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const locale = resolveAppLocale(settings.language);
  const tr = useCallback((key: TranslationKey, params?: Record<string, string | number>) => t(locale, key, params), [locale]);
  const formatNativeError = useCallback((error: unknown) => formatCommandError(tr, error), [tr]);
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeTypeFilter, setActiveTypeFilter] = useState<ClipTypeFilter>("all");
  const [filterFavorite, setFilterFavorite] = useState(false);
  const [activeView, setActiveView] = useState<ViewKey>("history");
  const [activeSurface, setActiveSurface] = useState<PanelSurface>("clipboard");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [activeGroupStart, setActiveGroupStart] = useState(0);
  const [groupScrollTarget, setGroupScrollTarget] = useState<number | null>(null);
  const activeGroupStartRef = useRef(0);
  activeGroupStartRef.current = activeGroupStart;
  // 程序化翻页（Cmd+↑/↓）窗口期内屏蔽视口中心驱动的分组检测，避免 smooth scroll 中间值导致 activeGroupStart 闪烁/回弹。
  const programmaticGroupUntilRef = useRef(0);
  const handleActiveGroupChange = useCallback((groupStart: number) => {
    if (Date.now() < programmaticGroupUntilRef.current) return;
    setActiveGroupStart(groupStart);
  }, []);
  const [isMultiPreviewOpen, setMultiPreviewOpen] = useState(false);
  const [isSearchActive, setSearchActive] = useState(false);
  const [nativeStatus, setNativeStatus] = useState(() => t(initialLocale, "main.status.clipboardReady"));
  const [completionToast, setCompletionToast] = useState<string | null>(null);
  const [filePathStatuses, setFilePathStatuses] = useState<Record<string, FilePathStatus>>({});
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
  const searchRequestRef = useRef<SearchClipsRequest>({ bucket: "all", limit: 200 });
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
  const errorBoundaryCopy = useMemo<ErrorBoundaryCopy>(
    () => ({
      toastMessage: tr("main.errorBoundary.toast"),
      recoverLabel: tr("main.errorBoundary.recover"),
      panelTitle: tr("main.errorBoundary.panelTitle"),
      panelMessage: tr("main.errorBoundary.panelMessage"),
      agentTitle: tr("main.errorBoundary.agentTitle"),
      agentMessage: tr("main.errorBoundary.agentMessage"),
      backToClipboard: tr("main.errorBoundary.backToClipboard"),
    }),
    [tr],
  );
  const copyMcpInstallPrompt = useCallback(async () => {
    const fallbackCommand = "/Applications/ClipForge.app/Contents/MacOS/clipforge --mcp";
    let command = fallbackCommand;
    try {
      const mcp = await invoke<McpStatusPayload>("get_mcp_status");
      command = mcp.command || fallbackCommand;
    } catch {
      command = fallbackCommand;
    }
    await navigator.clipboard.writeText(
      [
        "请帮我安装 ClipForge MCP 接入。",
        "使用 stdio transport，server command 如下：",
        command,
        "安装后优先使用 clipf.list / clipf.get / clipf.copy / clipf.search 工具读取和操作剪贴板。",
      ].join("\n"),
    );
    setNativeStatus(tr("main.status.mcpInstallPromptCopied"));
  }, [tr]);
  const onboardingSteps = useMemo(() => makeOnboardingSteps(getShortcutModLabel(), tr, copyMcpInstallPrompt), [copyMcpInstallPrompt, tr]);
  const markOnboardingCompleted = useCallback(() => {
    setOnboardingRun(false);
    setOnboardingStepIndex(0);
    setSettings((prev) => ({ ...prev, onboardingCompleted: true }));
    setNativeStatus(tr("main.status.onboardingCompleted"));
  }, [tr]);
  const startOnboarding = useCallback(() => {
    setOnboardingStepIndex(0);
    setOnboardingRun(true);
    setNativeStatus(tr("main.status.onboardingShowing"));
  }, [tr]);
  const showPreviousOnboardingStep = useCallback(() => {
    setOnboardingStepIndex((current) => Math.max(0, current - 1));
  }, []);
  const showNextOnboardingStep = useCallback(() => {
    setOnboardingStepIndex((current) => {
      if (current >= onboardingSteps.length - 1) {
        window.setTimeout(markOnboardingCompleted, 0);
        return current;
      }
      return current + 1;
    });
  }, [markOnboardingCompleted, onboardingSteps.length]);

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
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const payload = await invoke<QueryClipPayload>("search_clip_records", {
        input: { ...searchRequestRef.current, cursor: nextCursor },
      });
      if (!isQueryClipPayload(payload)) throw new Error("Invalid search_clip_records payload");
      const items = payload.items
        .map((item) => normalizeClip(item, settingsRef.current))
        .filter((item): item is ClipItem => Boolean(item));
      appendLoadedClips(items, payload.nextCursor ?? null);
      setNativeStatus(
        payload.nextCursor
          ? tr("main.status.loadMoreComplete", { count: clipsRef.current.length })
          : tr("main.status.loadAllComplete", { count: clipsRef.current.length }),
      );
    } catch (error) {
      logAppError("warn", "Load more clip records failed", String(error));
      setNativeStatus(tr("main.status.loadMoreFailed"));
    } finally {
      setIsLoadingMore(false);
    }
  }, [appendLoadedClips, isLoadingMore, nextCursor, tr]);

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
    const locale = resolveAppLocale(settings.language);
    setDocumentLocale(locale);
    void getCurrentWindow().setTitle(t(locale, "window.main.title")).catch((error) =>
      logAppError("warn", "Set main window title failed", String(error)),
    );
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
    logAppError("info", "frontend-environment", getFrontendEnvironmentSnapshot());

    const onError = (event: ErrorEvent) => {
      logAppError("error", event.message, {
        event: "window.error",
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        ...getErrorDiagnostics(event.error ?? event.message),
        frontend: getFrontendEnvironmentSnapshot(),
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      logAppError("error", "Unhandled promise rejection", {
        event: "window.unhandledrejection",
        ...getErrorDiagnostics(event.reason),
        frontend: getFrontendEnvironmentSnapshot(),
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    if (isSettingsWindow) return;
    let disposed = false;
    listen<AccessibilityFirstPromptPayload>("clipforge://accessibility-first-prompt", ({ payload }) => {
      if (disposed) return;
      logAppError("info", "accessibility-first-prompt", payload);
      if (payload.status === "granted") {
        setNativeStatus(tr("main.status.accessibilityGranted"));
      } else if (payload.prompted) {
        setNativeStatus(tr("main.status.accessibilityPrompted"));
      } else {
        setNativeStatus(payload.message || tr("main.status.accessibilityRecorded"));
      }
    }).catch((error) => logAppError("warn", "Register accessibility prompt listener failed", String(error)));
    return () => {
      disposed = true;
    };
  }, [isSettingsWindow, tr]);

  useEffect(() => {
    let cancelled = false;
    invoke<AccessibilityPermissionPayload>("check_accessibility_permission")
      .then((payload) => {
        if (cancelled) return;
        if (!payload.canReadFocusedInput) {
          setNativeStatus(tr("main.status.accessibilityMissing"));
        }
      })
      .catch((error) => logAppError("warn", "Check accessibility permission failed", String(error)));
    invoke<DbInitPayload>("init_clip_database")
      .then((payload) => {
        if (cancelled) return;
        logAppError("info", `Clip database ready at ${payload.path}`);
        if (isSettingsWindow) return null;
        return invoke<QueryClipPayload>("search_clip_records", {
          input: {
            bucket: "all",
            limit: 200,
          },
        });
      })
      .then(async (payload) => {
        if (!payload || cancelled || isSettingsWindow) return;
        if (!isQueryClipPayload(payload)) throw new Error("Invalid search_clip_records payload");
        let items = payload.items
          .map((item) => normalizeClip(item, settingsRef.current))
          .filter((item): item is ClipItem => Boolean(item));
        if (!items.length) {
          try {
            const seedPayload = await invoke<CaptureClipPayload>("capture_clip_record", {
              content: getOnboardingSampleContent(tr),
              sourceLabel: "ClipForge",
              observedAt: Date.now(),
            });
            if (!isCaptureClipPayload(seedPayload)) throw new Error("Invalid capture_clip_record payload");
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
        logAppError("info", "clip-list: initialized from database", {
          itemCount: items.length,
          rawCount: payload.items.length,
          hasMore: Boolean(payload.nextCursor),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        logAppError("error", "Initialize clip database failed", String(error));
        setNativeStatus(tr("main.status.databaseInitFailed"));
      });
    invoke<UserSettingsPayload>("read_user_settings")
      .then((payload) => {
        if (cancelled) return;
        const merged = mergeSettings(payload?.settings);
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
  }, [isSettingsWindow, startOnboarding, tr]);

  const syncCapturedClipboardPayload = useCallback(async (payload: CaptureClipPayload) => {
    if (!isCaptureClipPayload(payload)) throw new Error("Invalid capture payload");
    const nextClip = normalizeClip(payload.item, settingsRef.current) ?? createClip(payload.item.content, settingsRef.current);
    try {
      const result = await invoke<QueryClipPayload>("search_clip_records", {
        input: {
          bucket: "all",
          limit: 200,
        },
      });
      if (!isQueryClipPayload(result)) throw new Error("Invalid search_clip_records payload");
      const items = result.items
        .map((item) => normalizeClip(item, settingsRef.current))
        .filter((item): item is ClipItem => Boolean(item));
      clipsRef.current = items;
      setClips(items);
      setNextCursor(result.nextCursor ?? null);
      logAppError("info", "clipboard-promote: refreshed full list", {
        promotedId: nextClip.id,
        status: payload.status,
        itemCount: items.length,
      });
    } catch (error) {
      logAppError("warn", "clipboard-promote: refresh full list failed, using local merge", String(error));
      const current = clipsRef.current.filter((item) => item.id !== nextClip.id);
      const next = [nextClip, ...current].slice(0, settingsRef.current.maxStoredItems);
      clipsRef.current = next;
      setClips(next);
    }
    setSelectedId(nextClip.id);
    setActiveView("history");
    return payload.status;
  }, []);

  const captureClipboard = useCallback(
    async (reason: "startup" | "manual" | "shortcut") => {
      if (captureInFlightRef.current) return;
      captureInFlightRef.current = true;
      if (reason === "manual") {
        setIsReadingClipboard(true);
        setNativeStatus(tr("main.status.clipboardReading"));
      }
      try {
        const payload = await readClipboard<ClipItem>({ sourceLabel: "Clipboard" });
        if (!isCaptureClipPayload(payload)) throw new Error("Invalid capture_current_clipboard payload");
        const capturedText = (payload.item.plainText || payload.item.content || "").trim();
        if (capturedText) {
          lastSeenClipboard.current = capturedText;
        }
        const result = await syncCapturedClipboardPayload(payload);
        if (result === "created") {
          setNativeStatus(
            reason === "startup"
              ? tr("main.status.clipboardCapturedStartup")
              : reason === "manual"
                ? tr("main.status.clipboardCapturedManual")
                : reason === "shortcut"
                  ? tr("main.status.clipboardCapturedShortcut")
                  : tr("main.status.clipboardCapturedNew"),
          );
        } else {
          setNativeStatus(tr("main.status.clipboardPromoted"));
        }
      } catch (error) {
        setNativeStatus(formatNativeError(error));
      } finally {
        captureInFlightRef.current = false;
        if (reason === "manual") setIsReadingClipboard(false);
      }
    },
    [formatNativeError, syncCapturedClipboardPayload, tr],
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
      setActiveSurface("clipboard");
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
      setNativeStatus(reason === "tray" ? tr("main.status.panelFocusedTray") : tr("main.status.panelFocusedShortcut"));
      // 后台监听线程每 100ms 已在采集，这里只是兜底；延后到 300ms，避免与「唤起后立即输入」
      // 抢主线程——setClips 触发的重渲染会吞掉最初几个按键，造成「面板出来后要等一下才能打字」。
      window.setTimeout(() => {
        void captureClipboard("manual");
      }, 300);
    },
    [captureClipboard, tr],
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
          const result = await invoke<QueryClipPayload>("search_clip_records", {
            input: searchRequestRef.current,
          });
          if (!isQueryClipPayload(result)) throw new Error("Invalid search_clip_records payload");
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
          setNativeStatus(tr("main.status.clipboardCapturedNew"));
        } catch (error) {
          console.error("[CLIPBOARD] refresh failed:", error);
        }
      });
      console.log("[CLIPBOARD] frontend listener registered");
      setNativeStatus(tr("main.status.clipboardWatcherStarted"));
    };
    void setup();
    void captureClipboard("startup");
    return () => {
      if (unlisten) unlisten();
    };
  }, [captureClipboard, isSettingsWindow, tr]);

  useEffect(() => {
    if (isSettingsWindow) return;
    if (!settings.cleanupEnabled) return;
    const runCleanup = () => {
      invoke("cleanup_clip_records", {
        retentionDays: settings.softDeletedRetentionDays,
        maxActiveItems: settings.maxStoredItems,
      })
        .then((payload) => logAppError("info", "Cleanup completed", payload))
        .catch((error) => logAppError("warn", "Cleanup failed", String(error)));
    };
    const timer = window.setInterval(runCleanup, settings.cleanupIntervalHours * 60 * 60 * 1000);
    runCleanup();
    return () => window.clearInterval(timer);
  }, [
    isSettingsWindow,
    settings.cleanupEnabled,
    settings.cleanupIntervalHours,
    settings.maxStoredItems,
    settings.softDeletedRetentionDays,
  ]);

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
    const countKind = (kind: ClipPayloadKind) => visible.filter((item) => item.payloadKind === kind).length;
    const base: SearchSuggestion[] = [
      { id: "all", label: tr("main.searchSuggestion.all"), hint: `${visible.length}`, kind: "all", typeFilter: "all" },
      { id: "favorite", label: tr("main.searchSuggestion.favorite"), hint: `${visible.filter((item) => item.favorite).length}`, kind: "favorite" },
      { id: "link", label: tr("main.searchSuggestion.link"), hint: `${countKind("link")}`, kind: "type", typeFilter: "link" },
      { id: "file", label: tr("main.searchSuggestion.file"), hint: `${countKind("file")}`, kind: "type", typeFilter: "file" },
      { id: "image", label: tr("main.searchSuggestion.image"), hint: `${countKind("image")}`, kind: "type", typeFilter: "image" },
      { id: "html", label: "HTML", hint: `${countKind("html")}`, kind: "type", typeFilter: "html" },
      { id: "rtf", label: "RTF", hint: `${countKind("rtf")}`, kind: "type", typeFilter: "rtf" },
      { id: "code", label: tr("main.searchSuggestion.code"), hint: `${countKind("code")}`, kind: "type", typeFilter: "code" },
      { id: "json", label: "JSON", hint: `${countKind("json")}`, kind: "type", typeFilter: "json" },
      { id: "command", label: tr("main.searchSuggestion.command"), hint: `${countKind("command")}`, kind: "type", typeFilter: "command" },
      { id: "markdown", label: "Markdown", hint: `${countKind("markdown")}`, kind: "type", typeFilter: "markdown" },
      { id: "table", label: tr("main.searchSuggestion.table"), hint: `${countKind("table")}`, kind: "type", typeFilter: "table" },
      { id: "chart", label: tr("main.searchSuggestion.chart"), hint: `${countKind("chart")}`, kind: "type", typeFilter: "chart" },
    ];
    const saved = settings.tagRules
      .map((rule) => rule.label.trim())
      .filter(Boolean)
      .slice(0, 4)
      .map<SearchSuggestion>((tag) => ({ id: `saved:${tag}`, label: tag, hint: tr("main.searchSuggestion.rule"), kind: "saved", tag }));
    return [...base, ...saved];
  }, [clips, settings.tagRules, tr]);

  const parsedSearchCommand = useMemo(
    () => parseSearchCommand(debouncedQuery, baseSearchSuggestions),
    [baseSearchSuggestions, debouncedQuery],
  );

  const effectiveQuery = parsedSearchCommand.handled ? parsedSearchCommand.queryText : debouncedQuery;
  const effectiveTypeFilters =
    activeTypeFilter !== "all" ? [activeTypeFilter] : parsedSearchCommand.ast.types;
  const effectiveFilterFavorite = filterFavorite || parsedSearchCommand.filterFavorite;
  const effectiveActiveTags = normalizeTagList([...(activeTag ? [activeTag] : []), ...parsedSearchCommand.ast.tags]);
  const searchRequest = useMemo(
    () =>
      buildSearchClipsRequest({
        activeTag,
        activeTypeFilter,
        activeView,
        ast: parsedSearchCommand.ast,
        filterFavorite,
        limit: 200,
      }),
    [activeTag, activeTypeFilter, activeView, filterFavorite, parsedSearchCommand.ast],
  );
  const searchRequestKey = useMemo(() => JSON.stringify(searchRequest), [searchRequest]);

  useEffect(() => {
    searchRequestRef.current = searchRequest;
  }, [searchRequestKey, searchRequest]);

  useEffect(() => {
    if (isSettingsWindow) return;
    let cancelled = false;
    const request = JSON.parse(searchRequestKey) as SearchClipsRequest;
    searchRequestRef.current = request;
    invoke<QueryClipPayload>("search_clip_records", { input: request })
      .then((payload) => {
        if (cancelled) return;
        if (!isQueryClipPayload(payload)) throw new Error("Invalid search_clip_records payload");
        const items = payload.items
          .map((item) => normalizeClip(item, settingsRef.current))
          .filter((item): item is ClipItem => Boolean(item));
        clipsRef.current = items;
        setClips(items);
        setNextCursor(payload.nextCursor ?? null);
        setSelectedId((current) => (current && items.some((item) => item.id === current) ? current : (items[0]?.id ?? null)));
      })
      .catch((error) => {
        if (!cancelled) {
          logAppError("warn", "Search clip records failed", String(error));
          setNativeStatus(tr("main.status.searchFailed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isSettingsWindow, searchRequestKey, tr]);

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
    return bucketSource.filter((item) => {
      if (effectiveTypeFilters.length && !effectiveTypeFilters.includes(item.payloadKind)) return false;
      if (effectiveFilterFavorite && !item.favorite && !isFavoriteView(activeView)) return false;
      const matchesQuery = effectiveQuery.trim() ? matchesSearchTerm(item, effectiveQuery, settings) : true;
      const matchesTag = effectiveActiveTags.length
        ? effectiveActiveTags.every((activeTagValue) => {
            const activeSavedSearch = settings.tagRules.find((rule) => rule.label.trim() === activeTagValue);
            return (
              item.tags.some((tag) => tag.toLowerCase() === activeTagValue.toLowerCase()) ||
              Boolean(activeSavedSearch && matchesSavedSearch(item, activeSavedSearch, settings))
            );
          })
        : true;
      return matchesQuery && matchesTag;
    });
  }, [
    activeView,
    clips,
    effectiveActiveTags,
    effectiveFilterFavorite,
    effectiveQuery,
    effectiveTypeFilters,
    settings,
  ]);

  useEffect(() => {
    if (isSettingsWindow) return;
    const paths = Array.from(
      new Set(
        filteredClips
          .flatMap(getFilePathsFromClip)
          .filter((path) => filePathStatuses[path] === undefined)
          .slice(0, 200),
      ),
    );
    if (!paths.length) return;
    let cancelled = false;
    checkFilePaths(paths)
      .then((items) => {
        if (cancelled || !items.length) return;
        setFilePathStatuses((current) => {
          const next = { ...current };
          items.forEach((item) => {
            next[item.path] = item;
          });
          return next;
        });
      })
      .catch((error) => logAppError("warn", "Check file paths failed", String(error)));
    return () => {
      cancelled = true;
    };
  }, [filePathStatuses, filteredClips, isSettingsWindow]);

  const activeSearchSummary = useMemo(() => {
    const parts = [
      ...parsedSearchCommand.ast.labels,
      ...parsedSearchCommand.ast.invalidTokens,
      effectiveQuery.trim() ? `text:${effectiveQuery.trim()}` : "",
    ].filter(Boolean);
    return parts.length ? tr("main.search.activeSummary", { filters: parts.join(" · ") }) : null;
  }, [effectiveQuery, parsedSearchCommand.ast.invalidTokens, parsedSearchCommand.ast.labels, tr]);

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
    const commandToken = token.split(/\s+/).at(-1) ?? "";
    if (!token || (!commandToken.startsWith("@") && !commandToken.startsWith("#"))) return baseSearchSuggestions.slice(0, 6);
    if (commandToken.startsWith("#")) {
      const tagToken = normalizeSearch(commandToken.slice(1));
      const tagCounts = new Map<string, { label: string; count: number }>();
      clips.forEach((clip) => {
        if (clip.deletedAt) return;
        clip.tags.forEach((tag) => {
          const key = tag.toLowerCase();
          const current = tagCounts.get(key) ?? { label: tag, count: 0 };
          current.count += 1;
          tagCounts.set(key, current);
        });
      });
      return Array.from(tagCounts.entries())
        .filter(([key]) => !tagToken || key.includes(tagToken))
        .slice(0, 8)
        .map(([, value]) => ({ id: `tag:${value.label}`, label: value.label, hint: `${value.count}`, kind: "saved", tag: value.label }));
    }
    return baseSearchSuggestions
      .filter((item) =>
        matchesSearchSuggestionToken(
          item,
          commandToken,
          (label, term) => matchPinyin(label, term, { precision: "any", space: "ignore" }) !== null,
        ),
      )
      .slice(0, 8);
  }, [baseSearchSuggestions, clips, isSearchActive, query]);

  const aggregatePreview = useMemo(() => {
    return selectedInList.map((item) => item.content.trim()).filter(Boolean).join("\n\n");
  }, [selectedInList]);

  const focusSearch = useCallback(() => {
    setSearchActive(true);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setQuery(value);
    const token = value.trimStart();
    if (!token.startsWith("@") && !token.startsWith("#")) {
      setActiveTag(null);
      setFilterFavorite(false);
      setActiveTypeFilter("all");
    }
  }, []);

  const closeSearchIfEmpty = useCallback(() => {
    if (!query.trim()) setSearchActive(false);
  }, [query]);

  function replaceTrailingSearchToken(current: string, nextToken: string) {
    if (!current.trim()) return `${nextToken} `;
    if (!/(^|\s)[@#][^\s]*$/.test(current)) return `${nextToken} `;
    return current.replace(/(^|\s)[@#][^\s]*$/, `$1${nextToken} `);
  }

  function applySearchSuggestion(suggestion: SearchSuggestion) {
    setActiveTag(null);
    setFilterFavorite(false);
    setActiveTypeFilter("all");
    const nextToken =
      suggestion.kind === "all"
        ? ""
        : suggestion.kind === "saved"
          ? `#${suggestion.tag}`
          : getSearchSuggestionToken(suggestion);
    if (suggestion.kind === "all") {
      setQuery("");
    } else {
      setQuery((current) => replaceTrailingSearchToken(current, nextToken));
    }
    setSearchActive(true);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }

  const removeSearchFilter = (label: string) => {
    setQuery((current) => removeSearchFilterToken(current, label));
    setActiveTag((current) => (current && label.toLowerCase() === `#${current.toLowerCase()}` ? null : current));
    setFilterFavorite((current) => (label === "@favorite" || label === "@收藏" ? false : current));
    setActiveTypeFilter((current) => {
      if (current === "all") return current;
      const currentToken = getSearchSuggestionToken({
        id: current,
        label: current,
        hint: "",
        kind: "type",
        typeFilter: current,
      });
      return label.toLowerCase() === `type:${current}` || label === currentToken ? "all" : current;
    });
    setSearchActive(true);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  };

  const searchByTag = (tag: string) => {
    const normalized = normalizeTagName(tag);
    if (!normalized) return;
    setQuery(`#${normalized} `);
    setActiveTag(null);
    setFilterFavorite(false);
    setActiveTypeFilter("all");
    setSearchActive(true);
    void navigateWorkspaceList();
    window.setTimeout(() => searchRef.current?.focus(), 0);
  };

  function markClipCopied(item: ClipItem, status: string) {
    const now = Date.now();
    setLastCopiedId(item.id);
    setNativeStatus(status);
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

  async function copyClip(item: ClipItem, pasteMode: PasteMode = "rich") {
    try {
      const payload = await writeClipboard<ClipItem>({ id: item.id, pasteMode, source: "ui" });
      const normalized = normalizeClip(payload, settingsRef.current);
      lastSeenClipboard.current = item.content.trim();
      if (normalized) {
        setClips((current) => {
          const next = current.map((clip) => (clip.id === normalized.id ? normalized : clip));
          clipsRef.current = next;
          return next;
        });
      }
      markClipCopied(
        normalized ?? item,
        pasteMode === "plain"
          ? tr("main.status.copiedPlain")
          : pasteMode === "filesAsPaths"
            ? tr("main.status.copiedFilePaths")
            : tr("main.status.copiedRich"),
      );
    } catch {
      await navigator.clipboard.writeText(item.content);
      markClipCopied(item, tr("main.status.copiedBrowser"));
    }
  }

  async function captureStandardTextClip(
    text: string,
    source: string,
    context: Record<string, unknown> = {},
    extraTags: string[] = [],
  ) {
    const payload = await invoke<CaptureClipPayload>("capture_clip_record", {
      content: text,
      sourceLabel: source,
      observedAt: Date.now(),
    });
    if (!isCaptureClipPayload(payload)) throw new Error("Invalid capture_clip_record payload");
    let normalized = normalizeClip(payload.item, settingsRef.current);
    if (!normalized) {
      throw new Error("capture returned an empty item");
    }

    const inferredTags = /(^|[\s:_-])(ai|agent|mcp|assistant)([\s:_-]|$)/i.test(source)
      ? ["AI"]
      : [];
    const nextTags = normalizeTagList([
      ...normalized.tags,
      ...extractHashTags(text),
      ...extraTags,
      ...inferredTags,
    ]);
    const metadata = {
      ...normalized.metadata,
      clipforgeContext: {
        source,
        ...context,
      },
    };
    if (
      nextTags.join("\n").toLowerCase() !== normalized.tags.join("\n").toLowerCase() ||
      Object.keys(context).length > 0
    ) {
      const updated = await invoke<Partial<ClipItem>>("update_clip_record", {
        input: { id: normalized.id, tags: nextTags, metadata },
      });
      normalized = normalizeClip(updated, settingsRef.current) ?? { ...normalized, tags: nextTags, metadata };
    }

    setClips((current) => {
      const existing = current.some((clip) => clip.id === normalized.id);
      const next = existing
        ? current.map((clip) => (clip.id === normalized.id ? normalized : clip))
        : [normalized, ...current].slice(0, settingsRef.current.maxStoredItems);
      clipsRef.current = next;
      return next;
    });
    return normalized;
  }

  async function copyText(text: string, source = "unknown", context: Record<string, unknown> = {}) {
    logAppError("info", "copy-text: invoke start", {
      source,
      chars: text.length,
      selectedId,
      ...context,
    });
    try {
      const item = await captureStandardTextClip(text, source, context);
      const payload = await writeClipboard<ClipItem>({ id: item.id, pasteMode: "rich", source });
      const normalized = normalizeClip(payload, settingsRef.current);
      if (normalized) {
        setClips((current) => {
          const next = current.map((clip) => (clip.id === normalized.id ? normalized : clip));
          clipsRef.current = next;
          return next;
        });
      }
      lastSeenClipboard.current = text.trim();
      setNativeStatus(tr("main.status.copiedCodeSystem"));
      showCompletionToast(tr("main.toast.copiedCode"));
      logAppError("info", "copy-text: invoke success", {
        source,
        chars: text.length,
        ...context,
      });
    } catch (error) {
      logAppError("warn", "Copy text failed", { source, error: String(error), ...context });
      await navigator.clipboard.writeText(text);
      setNativeStatus(tr("main.status.copiedCodeBrowser"));
      showCompletionToast(tr("main.toast.copiedCode"));
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
      const item = await captureStandardTextClip(text, source, context);
      const payload = await pasteClipboard<ClipItem>({ id: item.id, pasteMode: "rich", source });
      const normalized = normalizeClip(payload, settingsRef.current);
      if (normalized) {
        setClips((current) => {
          const next = current.map((clip) => (clip.id === normalized.id ? normalized : clip));
          clipsRef.current = next;
          return next;
        });
      }
      setIsPanelEntering(false);
      lastSeenClipboard.current = text.trim();
      setNativeStatus(tr("main.status.pastedCode"));
      showCompletionToast(tr("main.toast.pastedCode"));
      logAppError("info", "paste-text: invoke success", {
        source,
        chars: text.length,
        ...context,
      });
    } catch (error) {
      logAppError("warn", "Paste text failed", { source, error: String(error), ...context });
      await copyText(text, `${source}:fallback-copy`, context);
      setNativeStatus(tr("main.status.pasteCodeFallback"));
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
      const payload = await pasteClipboard<ClipItem>({ id: item.id, pasteMode: "rich", source });
      const normalized = normalizeClip(payload, settingsRef.current);
      // 粘贴后面板已被 Rust 隐藏（hide_panel_before_paste 不发 hide-quick-panel），
      // 这里显式复位 is-entering，否则下次唤起不会淡入。
      setIsPanelEntering(false);
      lastSeenClipboard.current = item.content.trim();
      if (normalized) {
        setClips((current) => {
          const next = current.map((clip) => (clip.id === normalized.id ? normalized : clip));
          clipsRef.current = next;
          return next;
        });
      }
      markClipCopied(normalized ?? item, tr("main.status.pastedToApp"));
      logAppError("info", "paste-ui: invoke success", { id: item.id, source });
    } catch (error) {
      logAppError("warn", "Paste clip failed", String(error));
      await copyClip(item);
      setNativeStatus(formatNativeError(error));
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
    showCompletionToast(
      targetFavorite
        ? tr("main.toast.favoritedCount", { count: items.length })
        : tr("main.toast.unfavoritedCount", { count: items.length }),
    );
  }

  async function copySelectedClips(items: ClipItem[]) {
    if (!items.length) {
      setNativeStatus(tr("main.status.selectBeforeAggregate"));
      return;
    }
    const text = items.map((item) => item.content).join("\n\n");
    try {
      const aggregate = await captureStandardTextClip(
        text,
        "ui:multi-select-aggregate",
        { itemIds: items.map((item) => item.id), itemCount: items.length },
        [tr("main.tag.aggregate")],
      );
      const payload = await writeClipboard<ClipItem>({
        id: aggregate.id,
        pasteMode: "rich",
        source: "ui:multi-select-aggregate",
      });
      const normalized = normalizeClip(payload, settingsRef.current);
      if (normalized) {
        setClips((current) => {
          const next = current.map((clip) => (clip.id === normalized.id ? normalized : clip));
          clipsRef.current = next;
          return next;
        });
      }
      lastSeenClipboard.current = text.trim();
      setNativeStatus(tr("main.status.aggregateCopied", { count: items.length }));
    } catch {
      await navigator.clipboard.writeText(text);
      setNativeStatus(tr("main.status.aggregateCopiedBrowser", { count: items.length }));
    }
    showCompletionToast(tr("main.toast.aggregateCopied", { count: items.length }));
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

      if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "i") {
        event.preventDefault();
        setActiveSurface("agent");
        return;
      }

      if (activeSurface === "agent") {
        if (event.key === "Escape" && !editable) {
          event.preventDefault();
          setActiveSurface("clipboard");
          window.setTimeout(() => searchRef.current?.focus(), 0);
        }
        return;
      }

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
          showCompletionToast(currentItem.favorite ? tr("main.toast.unfavorited") : tr("main.toast.favorited"));
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
        // 同步更新激活分组起点（含 ref，使同一 tick 内连按也能叠加）+ 屏蔽滚动回调一小段窗口，
        // 让快速连按 Cmd+↑/↓ 确定性地逐页叠加（0→10→20），不再因 activeGroupStart 异步滞后导致翻页不叠加/错位跳项。
        activeGroupStartRef.current = next;
        setActiveGroupStart(next);
        programmaticGroupUntilRef.current = Date.now() + 450;
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
        if (workspaceRoute.name === "detail") {
          const routeClipId = workspaceRoute.clipId ?? selectedId;
          const currentIndex = Math.max(
            0,
            quickItems.findIndex((item) => item.id === routeClipId),
          );
          const direction = event.key === "ArrowDown" ? 1 : -1;
          const nextIndex = Math.min(Math.max(currentIndex + direction, 0), quickItems.length - 1);
          const nextItem = quickItems[nextIndex];
          if (nextItem && nextItem.id !== routeClipId) {
            setSelectedId(nextItem.id);
            void navigateWorkspaceDetail(nextItem.id);
          }
          return;
        }
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
    activeSurface,
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
    workspaceRoute.clipId,
    workspaceRoute.name,
  ]);

  async function openClipTarget(item: ClipItem, targetUrlOverride?: string) {
    const attachment = item.analysis.attachment;
    if (!targetUrlOverride && attachment?.targetType === "path") {
      try {
        await openPath(attachment.target.replace(/^file:\/\//, ""));
        setNativeStatus(tr("main.status.openedTarget", { target: attachment.name }));
      } catch (error) {
        logAppError("warn", "Open path failed", { target: attachment.target, error: String(error) });
        setNativeStatus(tr("main.status.openPathFailed"));
      }
      return;
    }
    const targetUrl = targetUrlOverride ?? (attachment?.targetType === "url" ? attachment.target : item.analysis.url);
    if (!targetUrl) return;
    try {
      await openUrl(targetUrl);
      setNativeStatus(tr("main.status.openedTarget", { target: item.analysis.sourceName }));
    } catch (error) {
      logAppError("warn", "Open URL failed", { target: targetUrl, error: String(error) });
      window.open(targetUrl, "_blank", "noopener,noreferrer");
      setNativeStatus(tr("main.status.openedInBrowser"));
    }
  }

  async function openSystemPath(path: string) {
    if (!path) return;
    try {
      await openPath(path.replace(/^file:\/\//, ""));
      setNativeStatus(tr("main.status.openedTarget", { target: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path }));
    } catch (error) {
      logAppError("warn", "Open detail file path failed", { target: path, error: String(error) });
      setNativeStatus(tr("main.status.openPathFailed"));
    }
  }

  function canOpenClipTarget(item: ClipItem) {
    return Boolean(item.analysis.attachment || item.analysis.url);
  }

  async function runPrimaryOpenAction(item: ClipItem, source: "shortcut" | "keyboard" | "click" | "context-menu" | "detail") {
    try {
      setSelectedId(item.id);
      const resolution = resolvePrimaryPluginAction(item, {
        surface: source === "detail" ? "detail" : "quick-action",
        shortcut: source === "shortcut" ? "Mod+J" : undefined,
      });
      logAppError("info", "quick-action: resolved", {
        id: item.id,
        source,
        traceId: resolution.traceId,
        pluginId: resolution.selected.pluginId,
        actionId: resolution.selected.actionId,
        parsedTargets: resolution.parsedTargets.map((target) => ({ id: target.id, kind: target.kind, label: target.label })),
        candidates: resolution.candidates,
      });
      if (resolution.selected.pluginId === "builtin.open-link" && resolution.selected.targetValue) {
        await openClipTarget(item, resolution.selected.targetValue);
        return;
      }
      if (resolution.selected.pluginId === "builtin.open-link" && canOpenClipTarget(item)) {
        await openClipTarget(item);
        return;
      }
      await navigateWorkspaceDetail(item.id);
    } catch (error) {
      logAppError("warn", "quick-action: plugin action failed", {
        id: item.id,
        source,
        error: String(error),
      });
      setNativeStatus(tr("main.status.pluginActionUnavailable"));
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
  }

  async function saveAgentResultAsClip(
    content: string,
    context: { sourceClipId?: string; conversationId: string },
  ) {
    if (!content.trim()) {
      setNativeStatus(tr("main.status.agentEmptyResult"));
      return;
    }
    try {
      const payload = await invoke<CaptureClipPayload>("capture_clip_record", {
        content,
        sourceLabel: "ClipForge Agent",
        observedAt: Date.now(),
      });
      if (!isCaptureClipPayload(payload)) throw new Error("Invalid capture_clip_record payload");
      let normalized = normalizeClip(payload.item, settingsRef.current);
      if (normalized) {
        const tags = normalizeTagList([...normalized.tags, "AI"]);
        const metadata = {
          ...normalized.metadata,
          provenance: {
            generatedBy: "agent",
            sourceClipId: context.sourceClipId ?? null,
            conversationId: context.conversationId,
            createdAt: Date.now(),
          },
        };
        try {
          const updatedPayload = await invoke<Partial<ClipItem>>("update_clip_record", {
            input: {
              id: normalized.id,
              tags,
              metadata,
              agentContext: {
                generatedBy: "agent",
                sourceClipId: context.sourceClipId ?? null,
                conversationId: context.conversationId,
              },
            },
          });
          normalized = normalizeClip(updatedPayload, settingsRef.current) ?? { ...normalized, tags, metadata };
        } catch (error) {
          logAppError("warn", "agent-result: metadata update failed", String(error));
          normalized = { ...normalized, tags, metadata };
        }
        const savedItem = normalized;
        setClips((current) => {
          const next = [savedItem, ...current.filter((clip) => clip.id !== savedItem.id)].slice(
            0,
            settingsRef.current.maxStoredItems,
          );
          clipsRef.current = next;
          return next;
        });
        setSelectedId(savedItem.id);
      }
      setActiveSurface("clipboard");
      setActiveView("history");
      setNativeStatus(tr("main.status.agentResultSaved"));
      showCompletionToast(tr("main.toast.agentResultSaved"));
    } catch (error) {
      logAppError("warn", "agent-result: save failed", String(error));
      setNativeStatus(formatNativeError(error));
    }
  }

  async function updateClipContent(
    item: ClipItem,
    content: string,
    tags?: string[],
    context?: { sessionId: string; draftVersion: number },
  ) {
    const payload = await invoke<Partial<ClipItem>>("save_editor_draft", {
      input: {
        id: item.id,
        sessionId: context?.sessionId ?? `editor_${item.id}`,
        draftVersion: context?.draftVersion ?? 1,
        content,
        tags: tags ? normalizeTagList(tags) : normalizeTagList(item.tags),
        metadata: {
          source: "detail-compact-editor",
          payloadKind: item.payloadKind,
        },
      },
    });
    const normalized = normalizeClip(payload, settingsRef.current);
    if (!normalized) throw new Error(tr("main.error.emptySavedClip"));
    setClips((current) => {
      const next = current.map((clip) => (clip.id === normalized.id ? normalized : clip));
      clipsRef.current = next;
      return next;
    });
    setSelectedId(normalized.id);
    setNativeStatus(tr("main.status.detailSaved"));
    logAppError("info", "clip-detail-edit: saved", {
      id: normalized.id,
      payloadKind: normalized.payloadKind,
      chars: normalized.content.length,
      tags: normalized.tags,
      sessionId: context?.sessionId,
      draftVersion: context?.draftVersion,
    });
    return normalized;
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
      setNativeStatus(tr("main.status.movedToTrash", { count: ids.length }));
      showCompletionToast(tr("main.toast.deletedCount", { count: ids.length }));
    } catch (error) {
      logAppError("warn", "Soft delete failed", String(error));
      setNativeStatus(formatNativeError(error));
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
      setNativeStatus(tr("main.status.restoredCount", { count: ids.length }));
    } catch (error) {
      logAppError("warn", "Restore failed", String(error));
      setNativeStatus(formatNativeError(error));
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
      setNativeStatus(tr("main.status.hardDeletedCount", { count: ids.length }));
    } catch (error) {
      logAppError("warn", "Hard delete failed", String(error));
      setNativeStatus(formatNativeError(error));
      return;
    }
    setClips((current) => current.filter((item) => !ids.includes(item.id)));
    setSelectedIds(new Set());
    setMultiSelectMode(false);
    if (shouldReselect) setSelectedId(nextSelectedId);
  }

  async function archiveAgentSourceClip(item: ClipItem) {
    updateClip(item.id, { bucket: "archive" });
    setNativeStatus(tr("main.status.agentArchiveSource"));
    showCompletionToast(tr("main.toast.agentArchiveSource"));
  }

  async function favoriteAgentSourceClip(item: ClipItem) {
    if (!item.favorite) {
      updateClip(item.id, { favorite: true });
    }
    setNativeStatus(tr("main.status.agentFavoriteSource"));
    showCompletionToast(tr("main.toast.agentFavoriteSource"));
  }

  async function appendAgentTagToSourceClip(item: ClipItem, tag: string) {
    const tags = normalizeTagList([...item.tags, tag]);
    updateClip(item.id, { tags });
    setNativeStatus(tr("main.status.agentTagSource", { tag }));
    showCompletionToast(tr("main.toast.agentTagSource"));
  }

  function openAgentReference(reference: AgentContextReference) {
    if (!reference.clipId) return;
    const item = clipsRef.current.find((clip) => clip.id === reference.clipId && !clip.deletedAt);
    if (!item) {
      setNativeStatus(tr("main.status.clipMissing"));
      return;
    }
    setSelectedId(item.id);
    setSelectedIds(new Set());
    setMultiSelectMode(false);
    setMultiPreviewOpen(false);
    setActiveSurface("clipboard");
    setActiveView(item.bucket === "archive" ? "history" : activeView === "trash" ? "history" : activeView);
    void navigateWorkspaceDetail(item.id);
  }

  async function emptyTrash() {
    const trashIds = clips.filter((item) => item.deletedAt).map((item) => item.id);
    if (!trashIds.length) {
      setNativeStatus(tr("main.status.trashEmpty"));
      return;
    }
    if (!window.confirm(tr("main.confirm.emptyTrash", { count: trashIds.length }))) {
      return;
    }
    await hardDeleteClips(trashIds);
  }

  const showSearchBar = activeSurface === "clipboard" && workspaceRoute.name === "list";

  return (
    <main
      className={`app-shell view-${activeView} route-${workspaceRoute.name} surface-${activeSurface} density-${settings.panelDensity}${showSearchBar && (isSearchActive || query) ? " search-active" : ""}${multiSelectMode ? " multi-selecting" : ""}${isPanelEntering ? " is-entering" : ""}${isPanelClosing ? " is-closing" : ""}${isFooterHidden ? " footer-hidden" : ""}${isSearchCompact ? " search-compact" : ""}${scrollOffset > 0 ? " scrolled" : ""}`}
      ref={shellRef}
      style={{ "--cf-panel-bg-opacity": settings.panelBackgroundOpacity } as CSSProperties}
    >
      <div aria-hidden="true" className="drag-strip" data-tauri-drag-region onPointerDown={handleWindowDrag} />
      <OnboardingAnchors active={onboardingRun} />

      <section className="content-column" onScroll={handleScroll}>
        {showSearchBar ? (
        <GlassSearchBar
          activeFilterLabels={parsedSearchCommand.ast.labels}
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
          onRemoveFilter={removeSearchFilter}
          parsedSearchCommand={parsedSearchCommand}
          query={query}
          suggestions={searchSuggestions}
          tr={tr}
        />
        ) : null}

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
          tr={tr}
          variant={activeView === "trash" ? "trash" : "default"}
        />
        ) : null}

        <PanelContentBoundary
          copy={errorBoundaryCopy}
          resetKey={`workspace:${activeView}:${selectedId ?? "none"}:${filteredClips.length}:${selectedInList.length}`}
        >
          <WorkspaceRouterProvider
            fallbackCopy={{
              routeTitle: tr("main.workspace.routeErrorTitle"),
              routeMessage: tr("main.workspace.routeErrorMessage"),
              providerTitle: tr("main.workspace.providerErrorTitle"),
              providerMessage: tr("main.workspace.providerErrorMessage"),
              backToList: tr("main.workspace.backToList"),
              retry: tr("main.workspace.retry"),
            }}
            renderList={() =>
              activeView === "trash" ? (
                <TrashPanel
                  key={`trash:${activeView}`}
                  activeId={selectedClip?.id ?? null}
                  autoScroll={keyboardNavigating}
                  clips={filteredClips}
                  emptySummary={activeSearchSummary}
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
                  tr={tr}
                />
              ) : (
                <QuickPastePanel
                  key={`quick:${activeView}`}
                  activeId={selectedClip?.id ?? null}
                  autoScroll={keyboardNavigating}
                  clips={filteredClips}
                  copiedId={lastCopiedId}
                  emptySummary={activeSearchSummary}
                  filePathStatuses={filePathStatuses}
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
                  onCopyMode={(item, mode) => {
                    void copyClip(item, mode);
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
                  tr={tr}
                />
              )
            }
            renderDetail={(clipId) => {
              const clip = clips.find((item) => item.id === clipId) ?? selectedClip;
              const detailItems = filteredClips;
              const detailIndex = clip ? detailItems.findIndex((item) => item.id === clip.id) : -1;
              const previousClip = detailIndex > 0 ? detailItems[detailIndex - 1] : null;
              const nextClip = detailIndex >= 0 && detailIndex < detailItems.length - 1 ? detailItems[detailIndex + 1] : null;
              const navigateDetailClip = (item: ClipItem | null) => {
                if (!item) return;
                setSelectedId(item.id);
                void navigateWorkspaceDetail(item.id);
              };
              return (
                <ClipDetailWorkspace
                  clip={clip}
                  filePathStatuses={filePathStatuses}
                  links={clip ? extractUrls(clip.content) : []}
                  tr={tr}
                  onBack={() => {
                    void navigateWorkspaceList();
                  }}
                  onCopy={copyClip}
                  onCopyText={copyText}
                  onOpen={openClipTarget}
                  onOpenPath={openSystemPath}
                  onPasteText={pasteText}
                  onPrevious={previousClip ? () => navigateDetailClip(previousClip) : undefined}
                  onNext={nextClip ? () => navigateDetailClip(nextClip) : undefined}
                  onSearchTag={searchByTag}
                  onUpdateContent={updateClipContent}
                  quickActions={[
                    ...(clip && canOpenClipTarget(clip)
                      ? [
                          {
                            id: "open-target",
                            label: clip.analysis.attachment?.targetType === "path" ? tr("main.detailAction.openResource") : tr("main.detailAction.openLink"),
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
                            id: "ask-agent",
                            label: tr("main.detailAction.askAgent"),
                            icon: <Bot size={13} />,
                            onSelect: () => {
                              setSelectedId(clip.id);
                              setActiveSurface("agent");
                            },
                          },
                          {
                            id: "copy",
                            label: tr("main.detailAction.copyContent"),
                            icon: <Copy size={13} />,
                            onSelect: () => {
                              void copyClip(clip);
                            },
                          },
                          {
                            id: "parse",
                            label: tr("main.detailAction.parse"),
                            icon: <FileJson size={13} />,
                            onSelect: () => {
                              setNativeStatus(tr("main.status.parsePluginReserved"));
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
                tr={tr}
                onBack={() => {
                  setMultiPreviewOpen(false);
                  void navigateWorkspaceList();
                }}
                onCopy={() => copySelectedClips(selectedInList)}
                onCopyItem={(clip) => copyClip(clip)}
                onExportTable={() => {
                  const table = selectedInList.map((item) => [item.analysis.title, item.content.replace(/\s+/g, " ")]).map((row) => row.join("\t")).join("\n");
                  void navigator.clipboard.writeText(table);
                  setNativeStatus(tr("main.status.exportedTsv"));
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

      <div
        aria-hidden={activeSurface !== "agent"}
        className={activeSurface === "agent" ? "agent-overlay open" : "agent-overlay"}
      >
        <div className="agent-overlay-scrim" />
        <div className="agent-overlay-panel" role="dialog" aria-label={tr("agent.aria.panel")} aria-modal={activeSurface === "agent"}>
          {activeSurface === "agent" ? (
            <AgentPanelBoundary
              copy={errorBoundaryCopy}
              resetKey={`agent:${selectedClip?.id ?? "none"}:${clips.length}:${settings.language}`}
              onClose={() => {
                setActiveSurface("clipboard");
                window.setTimeout(() => searchRef.current?.focus(), 0);
              }}
            >
              <ClipboardAgentPanel
                activeClip={selectedClip}
                allClips={clips}
                filteredClips={filteredClips}
                selectedClips={selectedInList}
                onArchiveClip={archiveAgentSourceClip}
                onAppendTagToSource={appendAgentTagToSourceClip}
                onBackToClipboard={() => {
                  setActiveSurface("clipboard");
                  window.setTimeout(() => searchRef.current?.focus(), 0);
                }}
                onCopyResult={(text) => copyText(text, "agent-result", { sourceClipId: selectedClip?.id })}
                onPasteResult={(text) => pasteText(text, "agent-result", { sourceClipId: selectedClip?.id })}
                onFavoriteClip={favoriteAgentSourceClip}
                language={settings.language}
                onOpenReference={openAgentReference}
                onSaveResult={saveAgentResultAsClip}
              />
            </AgentPanelBoundary>
          ) : null}
        </div>
      </div>

      <button
        aria-label={settings.panelPinned ? tr("main.aria.unpinPanel") : tr("main.aria.pinPanel")}
        className={`panel-pin-fab${settings.panelPinned ? " active" : ""}`}
        data-tooltip={settings.panelPinned ? tr("main.aria.unpinPanel") : tr("main.aria.pinPanel")}
        onClick={togglePanelPinned}
        title={tr("main.pin.title", { shortcut: `${getShortcutModLabel()}+P` })}
        type="button"
      >
        <Pin size={12} />
      </button>
      {completionToast ? (
        <div className="completion-toast" role="status">{completionToast}</div>
      ) : null}
      <BottomDock
        activeSurface={activeSurface}
        activeView={activeView}
        agentContextCount={selectedClip ? 1 : 0}
        onDrag={handleWindowDrag}
        onOpenAgent={() => {
          setActiveSurface("agent");
          setSelectedIds(new Set());
          setMultiSelectMode(false);
          setMultiPreviewOpen(false);
        }}
        onOpenSettings={() => {
          invoke("open_settings_window").catch((error) =>
            logAppError("warn", "Open settings window failed", String(error)),
          );
        }}
        onStartOnboarding={startOnboarding}
        tr={tr}
        onViewChange={(view) => {
          setActiveSurface("clipboard");
          setActiveView(view);
          setSelectedIds(new Set());
          setMultiSelectMode(false);
          void navigateWorkspaceList();
        }}
        status={nativeStatus}
      />
      {!isSettingsWindow ? (
        <ScenarioOnboardingLayer
          index={onboardingStepIndex}
          onBack={showPreviousOnboardingStep}
          onClose={markOnboardingCompleted}
          onNext={showNextOnboardingStep}
          run={onboardingRun}
          steps={onboardingSteps}
          tr={tr}
        />
      ) : null}
    </main>
  );
}

function GlassSearchBar({
  activeFilterLabels,
  inputRef,
  onApplySuggestion,
  onBlur,
  onChange,
  onClear,
  onFocus,
  onRemoveFilter,
  parsedSearchCommand,
  query,
  suggestions,
  tr,
}: {
  activeFilterLabels: string[];
  inputRef: RefObject<HTMLInputElement | null>;
  onApplySuggestion: (suggestion: SearchSuggestion) => void;
  onBlur: () => void;
  onChange: (value: string) => void;
  onClear: () => void;
  onFocus: () => void;
  onRemoveFilter: (label: string) => void;
  parsedSearchCommand: ParsedSearchCommand;
  query: string;
  suggestions: SearchSuggestion[];
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  return (
    <header className="toolbar">
      <div className="floating-search-surface">
        <div className="search-wrap input-group">
          <span className="input-addon input-addon-start">
            <Search size={14} />
          </span>
          <input
            aria-label={tr("main.search.aria")}
            autoComplete="off"
            onBlur={onBlur}
            onFocus={onFocus}
            onChange={(event) => onChange(event.currentTarget.value)}
            placeholder={tr("main.search.placeholder")}
            ref={inputRef}
            spellCheck={false}
            value={query}
          />
          {query ? (
            <button aria-label={tr("main.search.clear")} className="icon-button subtle" data-tooltip={tr("main.search.clear")} onClick={onClear} type="button">
              <X size={14} />
            </button>
          ) : null}
        </div>
        {activeFilterLabels.length ? (
          <div className="active-filter-chips" aria-label={tr("main.search.activeFilters")}>
            {activeFilterLabels.map((label) => (
              <button
                aria-label={tr("main.search.removeFilter", { label })}
                className="active-filter-chip"
                key={label}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onRemoveFilter(label)}
                type="button"
              >
                <span>{label}</span>
                <X size={11} />
              </button>
            ))}
          </div>
        ) : null}
        {suggestions.length ? (
          <FilterChips
            onApplySuggestion={onApplySuggestion}
            parsedSearchCommand={parsedSearchCommand}
            suggestions={suggestions}
            tr={tr}
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
  tr,
}: {
  onApplySuggestion: (suggestion: SearchSuggestion) => void;
  parsedSearchCommand: ParsedSearchCommand;
  suggestions: SearchSuggestion[];
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  return (
    <div className="search-suggestions" role="listbox" aria-label={tr("main.search.suggestions")}>
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
  tr,
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
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  variant?: "default" | "trash";
}) {
  return (
    <section className="multi-select-toolbar" aria-label={tr("main.multiSelect.aria")}>
      <div className="multi-drawer-handle" aria-hidden="true">
        <span />
      </div>
      <div className="multi-toolbar-head">
        <div className="multi-toolbar-title-group">
          <span className="multi-toolbar-title">{tr("main.multiSelect.title")}</span>
          <span className="multi-toolbar-count">{count > 0 ? tr("main.multiSelect.count", { count }) : tr("main.multiSelect.empty")}</span>
        </div>
        <div className="multi-toolbar-actions">
          <label className="multi-select-all" data-tooltip={tr("main.multiSelect.toggleAll")} title={tr("main.multiSelect.toggleAll")}>
            <input checked={allSelected} onChange={(event) => onToggleAll(event.currentTarget.checked)} type="checkbox" />
            <span>{tr("main.multiSelect.selectAll")}</span>
          </label>
          {variant === "trash" ? (
            <>
              <button aria-label={tr("main.multiSelect.restoreSelected")} className="icon-button subtle" data-tooltip={tr("main.multiSelect.restoreSelected")} disabled={count === 0} onClick={onRestore} title={tr("main.multiSelect.restoreSelected")} type="button">
                <RotateCcw size={14} />
              </button>
              <button aria-label={tr("main.multiSelect.hardDeleteSelected")} className="icon-button subtle" data-tooltip={tr("main.multiSelect.hardDeleteSelected")} disabled={count === 0} onClick={onDelete} title={tr("main.multiSelect.hardDeleteSelected")} type="button">
                <Trash2 size={14} />
              </button>
              <button aria-label={tr("main.multiSelect.emptyTrash")} className="icon-button subtle danger-icon" data-tooltip={tr("main.multiSelect.emptyTrash")} onClick={onEmptyTrash} title={tr("main.multiSelect.emptyTrash")} type="button">
                <Trash2 size={14} />
              </button>
            </>
          ) : (
            <>
              <button aria-label={tr("main.multiSelect.aggregateCopy")} className="icon-button subtle" data-tooltip={tr("main.multiSelect.aggregateCopy")} disabled={count === 0} onClick={onCopy} title={tr("main.multiSelect.aggregateCopy")} type="button">
                <Copy size={14} />
              </button>
              <button aria-label={tr("main.multiSelect.batchFavorite")} className="icon-button subtle" data-tooltip={tr("main.multiSelect.batchFavorite")} disabled={count === 0} onClick={onFavorite} title={tr("main.multiSelect.batchFavorite")} type="button">
                <Heart size={14} />
              </button>
              <button aria-label={tr("main.multiSelect.delete")} className="icon-button subtle" data-tooltip={tr("main.multiSelect.delete")} disabled={count === 0} onClick={onDelete} title={tr("main.multiSelect.delete")} type="button">
                <Trash2 size={14} />
              </button>
            </>
          )}
          <button aria-label={tr("main.multiSelect.close")} className="icon-button subtle" data-tooltip={tr("main.multiSelect.close")} onClick={onClose} title={tr("main.multiSelect.close")} type="button">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="multi-toolbar-hint">
        {variant === "trash" ? (
          <><kbd>Space</kbd> {tr("main.multiSelect.hint.select")} · <kbd>Ctrl/Cmd</kbd>+<kbd>A</kbd> {tr("main.multiSelect.hint.selectAll")} · <kbd>Enter</kbd> {tr("main.multiSelect.hint.restore")} · <kbd>Delete</kbd> {tr("main.multiSelect.hint.hardDelete")} · <kbd>Esc</kbd> {tr("main.multiSelect.hint.exit")}</>
        ) : (
          <><kbd>Space</kbd> {tr("main.multiSelect.hint.select")} · <kbd>Ctrl/Cmd</kbd>+<kbd>A</kbd> {tr("main.multiSelect.hint.selectAll")} · <kbd>Ctrl/Cmd</kbd>+<kbd>F</kbd> {tr("main.multiSelect.hint.favorite")} · <kbd>Ctrl/Cmd</kbd>+<kbd>C</kbd> {tr("main.multiSelect.hint.copy")} · <kbd>Esc</kbd> {tr("main.multiSelect.hint.exit")}</>
        )}
      </div>
    </section>
  );
}

function BottomDock({
  activeSurface,
  activeView,
  agentContextCount,
  onDrag,
  onOpenAgent,
  onOpenSettings,
  onStartOnboarding,
  onViewChange,
  status,
  tr,
}: {
  activeSurface: PanelSurface;
  activeView: ViewKey;
  agentContextCount: number;
  onDrag: (event: PointerEvent<HTMLElement>) => void;
  onOpenAgent: () => void;
  onOpenSettings: () => void;
  onStartOnboarding: () => void;
  onViewChange: (view: ViewKey) => void;
  status: string;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const reduceMotion = useReducedMotion();
  const dockValue = activeSurface === "agent" ? "agent" : activeView;
  const handleDockValueChange = (value: string) => {
    if (value === "history" || value === "favorites" || value === "trash") {
      onViewChange(value);
    }
  };

  return (
    <footer className="list-footer" data-tauri-drag-region onPointerDown={onDrag}>
      <div className="footer-agent-slot" onPointerDown={(event) => event.stopPropagation()}>
        <motion.button
          aria-label={tr("main.dock.openAgent")}
          className={activeSurface === "agent" ? "icon-button active" : "icon-button subtle"}
          data-tooltip="Agent · Ctrl/Cmd+I"
          onClick={onOpenAgent}
          title="Agent · Ctrl/Cmd+I"
          transition={dockButtonTransition}
          type="button"
          whileHover={reduceMotion ? undefined : { y: -1, scale: 1.04 }}
          whileTap={reduceMotion ? undefined : { scale: 0.94 }}
        >
          <img alt="" className="agent-access-icon" src={agentAccessIcon} />
          {agentContextCount ? <em>{agentContextCount}</em> : null}
        </motion.button>
      </div>
      <StatusLine status={status} tr={tr} />
      <Tabs className="footer-view-tabs" value={dockValue} onValueChange={handleDockValueChange}>
        <TabsList className="footer-actions" onPointerDown={(event) => event.stopPropagation()}>
        <TabsTrigger
          aria-label={tr("main.dock.history")}
          className={activeSurface === "clipboard" && activeView === "history" ? "icon-button active" : "icon-button subtle"}
          data-tooltip={tr("main.dock.history")}
          title={tr("main.dock.history")}
          transition={dockTabTransition}
          value="history"
          whileHover={reduceMotion ? undefined : { y: -1 }}
          whileTap={reduceMotion ? undefined : { scale: 0.94 }}
        >
          <History size={13} />
        </TabsTrigger>
        <TabsTrigger
          aria-label={tr("main.dock.favorites")}
          className={activeSurface === "clipboard" && activeView === "favorites" ? "icon-button active" : "icon-button subtle"}
          data-tooltip={tr("main.dock.favorites")}
          title={tr("main.dock.favorites")}
          transition={dockTabTransition}
          value="favorites"
          whileHover={reduceMotion ? undefined : { y: -1 }}
          whileTap={reduceMotion ? undefined : { scale: 0.94 }}
        >
          <Heart size={13} />
        </TabsTrigger>
        <TabsTrigger
          aria-label={tr("main.dock.trash")}
          className={activeSurface === "clipboard" && activeView === "trash" ? "icon-button active" : "icon-button subtle"}
          data-tooltip={tr("main.dock.trash")}
          title={tr("main.dock.trash")}
          transition={dockTabTransition}
          value="trash"
          whileHover={reduceMotion ? undefined : { y: -1 }}
          whileTap={reduceMotion ? undefined : { scale: 0.94 }}
        >
          <Trash2 size={13} />
        </TabsTrigger>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <motion.button
              aria-label={tr("main.dock.menu")}
              className="footer-profile-trigger"
              data-tooltip={tr("main.dock.menu")}
              title={tr("main.dock.menu")}
              transition={dockButtonTransition}
              type="button"
              whileHover={reduceMotion ? undefined : { y: -1, scale: 1.04 }}
              whileTap={reduceMotion ? undefined : { scale: 0.94 }}
            >
              <Avatar className="footer-profile-avatar">
                <AvatarImage alt="" src={clipforgeAppIcon} />
                <AvatarFallback>CF</AvatarFallback>
              </Avatar>
            </motion.button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="footer-profile-menu" side="top" align="end" sideOffset={8}>
            <DropdownMenuLabel className="footer-profile-label">
              <span>ClipForge</span>
              <small>{tr("main.dock.shortcutHint")}</small>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onOpenSettings}>
                <span>{tr("main.dock.settings")}</span>
                <kbd>,</kbd>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onStartOnboarding}>
                <span>{tr("main.dock.onboarding")}</span>
                <kbd>?</kbd>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        </TabsList>
      </Tabs>
    </footer>
  );
}

function StatusLine({ status, tr }: { status: string; tr: (key: TranslationKey, params?: Record<string, string | number>) => string }) {
  return (
    <span className="footer-status">
      {status || (
        <>
          <kbd>Tab</kbd> {tr("main.statusLine.navigate")} · <kbd>Enter</kbd> {tr("main.statusLine.paste")} · <kbd>→</kbd> {tr("main.statusLine.detail")} · <kbd>Ctrl/Cmd</kbd>+<kbd>J</kbd> {tr("main.statusLine.openTarget")} · <kbd>Ctrl/Cmd</kbd>+<kbd>P</kbd> {tr("main.statusLine.pin")}
        </>
      )}
    </span>
  );
}

function TrashPanel({
  activeId,
  autoScroll,
  clips,
  emptySummary,
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
  tr,
}: {
  activeId: string | null;
  autoScroll: boolean;
  clips: ClipItem[];
  emptySummary: string | null;
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
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
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
        <h2>{tr("main.empty.trashTitle")}</h2>
        <p>{emptySummary ?? tr("main.empty.trashBody")}</p>
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
                aria-label={selectedIds.has(item.id) ? tr("main.list.unselectItem") : tr("main.list.selectItem")}
                className={selectedIds.has(item.id) ? "quick-index selected" : "quick-index"}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(item);
                  if (multiSelectMode) onToggleSelected(item.id);
                  else onStartMultiSelect(item.id);
                }}
                title={tr("main.list.selectItem")}
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
                      <AppTooltip content={getItemTooltip(item, tr)}>
                        <p className="quick-line" aria-label={parts.text}>{parts.text}</p>
                      </AppTooltip>
                    );
                  }
                  return (
                    <AppTooltip content={getItemTooltip(item, tr)}>
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
                  data-tooltip={tr("main.list.restore")}
                  onClick={() => onRestore(item)}
                  title={tr("main.list.restore")}
                  type="button"
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  className="icon-button danger-icon"
                  data-tooltip={tr("main.list.hardDelete")}
                  onClick={() => onHardDelete(item)}
                  title={tr("main.list.hardDelete")}
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
            tr={tr}
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
  tr,
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
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  x: number;
  y: number;
}) {
  const run = (action: () => void) => {
    action();
    onClose();
  };
  return (
    <div
      aria-label={tr("main.context.trashMenu")}
      className="clip-context-menu"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      style={{ left: x, top: y }}
    >
      {multiSelectMode ? (
        <>
          <button className="clip-context-item" disabled={selectedCount === 0} onClick={() => run(onRestoreSelected)} role="menuitem" type="button">
            <span className="clip-context-label"><RotateCcw size={13} />{tr("main.context.restoreSelected")}</span>
            <kbd>{selectedCount}</kbd>
          </button>
          <button className="clip-context-item" disabled={selectedCount === 0} onClick={() => run(onDeleteSelected)} role="menuitem" type="button">
            <span className="clip-context-label"><Trash2 size={13} />{tr("main.context.hardDeleteSelected")}</span>
            <kbd>Del</kbd>
          </button>
          <div className="clip-context-separator" role="separator" />
          <button className="clip-context-item danger" onClick={() => run(onEmptyTrash)} role="menuitem" type="button">
            <span className="clip-context-label"><Trash2 size={13} />{tr("main.context.emptyTrash")}</span>
            <kbd>{tr("main.context.all")}</kbd>
          </button>
        </>
      ) : (
        <>
          <button className="clip-context-item" onClick={() => run(() => onRestore(item))} role="menuitem" type="button">
            <span className="clip-context-label"><RotateCcw size={13} />{tr("main.context.restore")}</span>
            <kbd>Enter</kbd>
          </button>
          <button className="clip-context-item" onClick={() => run(() => onStartMultiSelect(item.id))} role="menuitem" type="button">
            <span className="clip-context-label"><Square size={13} />{tr("main.context.selectItem")}</span>
            <kbd>Space</kbd>
          </button>
          <div className="clip-context-separator" role="separator" />
          <button className="clip-context-item danger" onClick={() => run(() => onHardDelete(item))} role="menuitem" type="button">
            <span className="clip-context-label"><Trash2 size={13} />{tr("main.context.hardDelete")}</span>
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
  const lastAutoScrollActiveIdRef = useRef<string | null>(null);
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
    if (typeof ResizeObserver === "undefined") {
      const syncHeight = () => setHeight(node.getBoundingClientRect().height || 420);
      syncHeight();
      window.addEventListener("resize", syncHeight);
      return () => window.removeEventListener("resize", syncHeight);
    }
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
    if (!activeId || !autoScroll) {
      lastAutoScrollActiveIdRef.current = null;
      return;
    }
    if (lastAutoScrollActiveIdRef.current === activeId) return;
    lastAutoScrollActiveIdRef.current = activeId;
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
  }, [activeId, autoScroll, itemHeight, setFeedback]);

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
  emptySummary,
  filePathStatuses,
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
  onCopyMode,
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
  tr,
}: {
  activeId: string | null;
  autoScroll: boolean;
  clips: ClipItem[];
  copiedId: string | null;
  emptySummary: string | null;
  filePathStatuses: Record<string, FilePathStatus>;
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
  onCopyMode: (item: ClipItem, mode: PasteMode) => void;
  onDelete: (item: ClipItem) => void;
  onDeleteSelected: () => void;
  onSelect: (item: ClipItem) => void;
  onStartMultiSelect: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onClearSelection: () => void;
  activeGroupStart: number;
  onActiveGroupChange: (groupStart: number) => void;
  groupScrollTarget: number | null;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
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
    const menuHeight = multiSelectMode ? 190 : 332;
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
        <h2>{emptySummary ? tr("main.empty.noMatchesTitle") : tr("main.empty.noClipboardTitle")}</h2>
        <p>{emptySummary ?? tr("main.empty.noClipboardBody")}</p>
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
          renderItem={(item, index) => {
            const fileMissing = isFileClipMissing(item, filePathStatuses);
            return (
          <article
            className={[
              "quick-row",
              activeId === item.id ? "active" : "",
              copiedId === item.id ? "copied" : "",
              selectedIds.has(item.id) ? "selected" : "",
              multiSelectMode ? "selecting" : "",
              fileMissing ? "file-missing" : "",
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
              aria-label={selectedIds.has(item.id) ? tr("main.list.unselectItem") : tr("main.list.multiSelectItem")}
              className={selectedIds.has(item.id) ? "quick-index selected" : "quick-index"}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(item);
                if (multiSelectMode) onToggleSelected(item.id);
                else onStartMultiSelect(item.id);
              }}
              title={multiSelectMode ? tr("main.list.toggleSelection") : tr("main.list.enterMultiSelect")}
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
              {item.payloadKind === "image" ? (
                <span className="quick-media-thumb" title={item.imageFile ?? tr("main.searchSuggestion.image")}>
                  <ImageIcon size={13} />
                </span>
              ) : item.payloadKind === "file" ? (
                <span className="quick-media-file" title={fileMissing ? tr("main.list.fileMissing") : (item.fileTypes ?? tr("main.searchSuggestion.file"))}>
                  <FileJson size={13} />
                  <em>{Math.max(1, item.content.split(/\r?\n/).filter(Boolean).length)}</em>
                </span>
              ) : null}
              {(() => {
                const parts = splitLineForMiddleEllipsis(getClipboardLine(item));
                if (!parts.split) {
                  return (
                      <AppTooltip content={getItemTooltip(item, tr)}>
                      <p className="quick-line" aria-label={parts.text}>{parts.text}</p>
                    </AppTooltip>
                  );
                }
                return (
                  <AppTooltip content={getItemTooltip(item, tr)}>
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
                <button className="icon-button" data-tooltip={tr("main.list.openTarget")} onClick={() => onOpen(item)} title={tr("main.list.openTarget")} type="button">
                  <ExternalLink size={14} />
                </button>
              ) : null}
              <button
                className={item.favorite ? "quick-fav faved" : "quick-fav"}
                data-tooltip={item.favorite ? tr("main.list.unfavorite") : tr("main.list.favorite")}
                onClick={(event) => {
                  event.stopPropagation();
                  onFavorite(item);
                }}
                title={item.favorite ? tr("main.list.unfavorite") : tr("main.list.favorite")}
                type="button"
              >
                <Heart size={13} />
              </button>
            </div>
          </article>
          );
          }}
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
            onCopyMode={(mode) => onCopyMode(contextMenu.item, mode)}
            onCopySelected={onCopySelected}
            onStartMultiSelect={onStartMultiSelect}
            onClearSelection={onClearSelection}
            selectedCount={selectedIds.size}
            tr={tr}
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
  onCopyMode,
  onCopySelected,
  onStartMultiSelect,
  onClearSelection,
  selectedCount,
  tr,
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
  onCopyMode: (mode: PasteMode) => void;
  onCopySelected: () => void;
  onStartMultiSelect: (id: string) => void;
  onClearSelection: () => void;
  selectedCount: number;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
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
      aria-label={tr("main.context.clipMenu")}
      className="clip-context-menu"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      style={{ left: x, top: y }}
    >
      {multiSelectMode ? (
        <>
          <button className="clip-context-item" onClick={() => run(onOpenAggregate)} role="menuitem" type="button">
            <span className="clip-context-label"><CheckSquare size={13} />{tr("main.context.aggregate")}</span>
            <kbd>{selectedCount}</kbd>
          </button>
          <button className="clip-context-item" onClick={() => run(onCopySelected)} role="menuitem" type="button">
            <span className="clip-context-label"><Copy size={13} />{tr("main.context.copySelected")}</span>
            <kbd>{mod}+C</kbd>
          </button>
          <button className="clip-context-item" onClick={() => run(onFavoriteSelected)} role="menuitem" type="button">
            <span className="clip-context-label"><Heart size={13} />{tr("main.context.favoriteSelected")}</span>
            <kbd>{mod}+F</kbd>
          </button>
          <button className="clip-context-item danger" onClick={() => run(onDeleteSelected)} role="menuitem" type="button">
            <span className="clip-context-label"><Trash2 size={13} />{tr("main.context.deleteSelected")}</span>
            <kbd>Del</kbd>
          </button>
          <div className="clip-context-separator" role="separator" />
          <button className="clip-context-item" onClick={() => run(onClearSelection)} role="menuitem" type="button">
            <span className="clip-context-label"><X size={13} />{tr("main.context.exitMultiSelect")}</span>
            <kbd>Esc</kbd>
          </button>
        </>
      ) : (
        <>
          <button className="clip-context-item" onClick={() => run(() => onPaste(item, "context-menu"))} role="menuitem" type="button">
            <span className="clip-context-label"><Clipboard size={13} />{tr("main.context.paste")}</span>
            <kbd>Enter</kbd>
          </button>
          <button className="clip-context-item" onClick={() => run(() => onCopyMode("rich"))} role="menuitem" type="button">
            <span className="clip-context-label"><Copy size={13} />{tr("main.context.copyRich")}</span>
            <kbd>Rich</kbd>
          </button>
          <button
            className="clip-context-item"
            data-tooltip={item.payloadKind === "image" ? tr("main.context.copyPlainImageUnavailable") : tr("main.context.copyPlainTooltip")}
            disabled={item.payloadKind === "image"}
            onClick={() => run(() => onCopyMode("plain"))}
            role="menuitem"
            title={item.payloadKind === "image" ? tr("main.context.copyPlainImageUnavailable") : tr("main.context.copyPlainTitle")}
            type="button"
          >
            <span className="clip-context-label"><Copy size={13} />{tr("main.context.copyPlain")}</span>
            <kbd>Plain</kbd>
          </button>
          <button
            className="clip-context-item"
            data-tooltip={item.payloadKind !== "file" ? tr("main.context.copyPathFileOnly") : tr("main.context.copyPathTooltip")}
            disabled={item.payloadKind !== "file"}
            onClick={() => run(() => onCopyMode("filesAsPaths"))}
            role="menuitem"
            title={item.payloadKind !== "file" ? tr("main.context.copyPathFileOnly") : tr("main.context.copyPathTitle")}
            type="button"
          >
            <span className="clip-context-label"><Copy size={13} />{tr("main.context.copyPath")}</span>
            <kbd>Path</kbd>
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
            <span className="clip-context-label"><FileJson size={13} />{tr("main.context.detail")}</span>
            <kbd>→</kbd>
          </button>
          {item.analysis.url || item.analysis.attachment ? (
            <div className="clip-context-item is-hint" role="presentation">
              <span className="clip-context-label"><ExternalLink size={13} />{tr("main.context.openTarget")}</span>
              <kbd>{mod}+J</kbd>
            </div>
          ) : null}
          <button className="clip-context-item" onClick={() => run(() => onFavorite(item))} role="menuitem" type="button">
            <span className="clip-context-label"><Heart size={13} />{item.favorite ? tr("main.context.unfavorite") : tr("main.context.favorite")}</span>
            <kbd>{mod}+F</kbd>
          </button>
          <button className="clip-context-item danger" onClick={() => run(onDelete)} role="menuitem" type="button">
            <span className="clip-context-label"><Trash2 size={13} />{tr("main.context.delete")}</span>
            <kbd>Del</kbd>
          </button>
          <div className="clip-context-separator" role="separator" />
          <button className="clip-context-item" onClick={() => run(() => onStartMultiSelect(item.id))} role="menuitem" type="button">
            <span className="clip-context-label"><Square size={13} />{tr("main.context.selectItem")}</span>
            <kbd>Space</kbd>
          </button>
        </>
      )}
    </div>
  );
}

function App() {
  const locale = resolveAppLocale(loadLocalSettings().language);
  return (
    <AppErrorBoundary
      copy={{
        toastMessage: t(locale, "main.errorBoundary.toast"),
        recoverLabel: t(locale, "main.errorBoundary.recover"),
      }}
    >
      <ClipForgeApp />
    </AppErrorBoundary>
  );
}

export default App;
