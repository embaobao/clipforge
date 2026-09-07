import {
  Clipboard,
  Copy,
  ExternalLink,
  FileJson,
  Search,
  X,
} from "lucide-react";
import { ClipboardEmptyState } from "./clipboard/components/ClipboardEmptyState";
import { ClipboardRow } from "./clipboard/components/ClipboardRow";
import { ClipContextMenu } from "./clipboard/components/ClipContextMenu";
import { PanelStatusFeedback } from "./clipboard/components/PanelStatusFeedback";
import { TopToolbar } from "./clipboard/components/TopToolbar";
import { QuickCommandMenu } from "./clipboard/components/QuickCommandMenu";
import { QuickPreviewCard } from "./clipboard/components/QuickPreviewCard";
import { MultiSelectBottomBar } from "./clipboard/components/MultiSelectBottomBar";
import { TrashRow } from "./clipboard/components/TrashRow";
import { TrashContextMenu } from "./clipboard/components/TrashContextMenu";
import {
  getFilePathsFromClip,
  getShortcutModLabel,
  middleEllipsis,
} from "./clipboard/clipboard-domain";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { match as matchPinyin } from "pinyin-pro";
import { create } from "zustand";
import { toast } from "sonner";
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset as floatingOffset,
  shift,
  useFloating,
} from "@floating-ui/react";
import type { ErrorInfo, MouseEvent, PointerEvent, ReactNode, RefObject, UIEvent } from "react";
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
import { analyzeClipboard, openDshWindow, type DshAnalyzeResult } from "./agent/dsh-analysis";
export type PanelSurface = "clipboard" | "dsh";

// 模块级：DSH 只读快速分析入口（详情页与右键菜单共用，不在任何组件作用域内）
async function analyzeClipboardWithDsh(item: ClipItem): Promise<DshAnalyzeResult | void> {
  try {
    const result = await analyzeClipboard(item.content ?? "", {});
    return result;
  } catch (error) {
    console.warn("dsh-analysis: invoke failed", error);
    return undefined;
  }
}
import { getErrorDiagnostics, getFrontendEnvironmentSnapshot } from "./frontend-diagnostics";
import { recordNextFramePerf, startPerfSpan } from "./performance-smoke";

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
export type ViewKey = "history" | "favorites" | "trash";

type PanelArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
type PanelDensity = "dense" | "normal" | "comfortable";
type TagMode = "similar" | "rules" | "off";
type ContentDisplayMode = "summary" | "middle" | "raw";

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
  applicationContext?: Record<string, unknown> | null;
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
  onboardingShownAt?: number | null;
  launchAtLogin: boolean;
  logMaxSizeMb: number;
  logKeepRatio: number;
  logMaxLines: number;
  logRetentionDays: number;
  logAutoCleanup: boolean;
  logCleanupIntervalMin: number;
  debugLogsEnabled: boolean;
  captureTextEnabled: boolean;
  captureHtmlEnabled: boolean;
  captureRtfEnabled: boolean;
  captureImageEnabled: boolean;
  captureFileEnabled: boolean;
  captureSensitiveEnabled: boolean;
  captureApplicationContext: boolean;
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

type CaptureClipPayload = {
  status: "created" | "promoted";
  item: ClipItem;
};

type QueryClipPayload = {
  items: ClipItem[];
  nextCursor?: string;
  limit: number;
};

type CleanupClipPayload = {
  hardDeleted: number;
  retentionHardDeleted: number;
  overflowHardDeleted: number;
  ranAt: number;
};

type ExportTextFilesPayload = {
  directory: string;
  count: number;
  files: string[];
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
const ROW_HEIGHT = 40;
const OVERSCAN = 5;
const DEFAULT_PANEL_HEIGHT = 400;
const MAX_BROWSER_TIMER_DELAY_MS = 2_147_000_000;
const CLEANUP_STARTUP_DELAY_MS = 60_000;
function getStarterSampleContent(tr: (key: TranslationKey, params?: Record<string, string | number>) => string) {
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
  onboardingShownAt: null,
  launchAtLogin: true,
  logMaxSizeMb: 10,
  logKeepRatio: 0.6,
  logMaxLines: 20000,
  logRetentionDays: 0,
  logAutoCleanup: true,
  logCleanupIntervalMin: 1440,
  debugLogsEnabled: false,
  captureTextEnabled: true,
  captureHtmlEnabled: true,
  captureRtfEnabled: true,
  captureImageEnabled: true,
  captureFileEnabled: true,
  captureSensitiveEnabled: false,
  captureApplicationContext: true,
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
  const applicationContext = item.captureContext?.applicationContext;
  return [
    item.content,
    item.source,
    item.kind,
    item.bucket,
    item.analysis.title,
    item.analysis.summary,
    item.analysis.host,
    item.tags.join(" "),
    item.sourceApp?.name,
    applicationContext && typeof applicationContext === "object" ? JSON.stringify(applicationContext) : "",
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
      applicationContext: null,
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
    onboardingShownAt:
      typeof next.onboardingShownAt === "number" || next.onboardingShownAt === null
        ? next.onboardingShownAt
        : defaultSettings.onboardingShownAt,
    launchAtLogin:
      typeof next.launchAtLogin === "boolean"
        ? next.launchAtLogin
        : defaultSettings.launchAtLogin,
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
    captureApplicationContext:
      typeof next.captureApplicationContext === "boolean"
        ? next.captureApplicationContext
        : defaultSettings.captureApplicationContext,
    imageMaxSizeMb: clampNumber(next.imageMaxSizeMb, 1, 1024, defaultSettings.imageMaxSizeMb),
    textMaxSizeMb: clampNumber(next.textMaxSizeMb, 1, 100, defaultSettings.textMaxSizeMb),
    globalShortcut: !globalShortcut || globalShortcut === LEGACY_DEFAULT_SHORTCUT ? DEFAULT_SHORTCUT : globalShortcut,
  };
}

function clampNumber(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
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
    deletedAt: typeof raw.deletedAt === "number" ? raw.deletedAt : null,
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
      applicationContext: null,
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

type ErrorBoundaryCopy = {
  toastMessage: string;
  recoverLabel: string;
  panelTitle: string;
  panelMessage: string;
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
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <Clipboard size={22} />
          <strong className="text-[13px] font-medium">{this.props.copy.panelTitle}</strong>
          <span className="text-[12px] text-muted-foreground">{this.props.copy.panelMessage}</span>
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
  const [keyboardNavigating, setKeyboardNavigating] = useState(false);
  const [activeGroupStart, setActiveGroupStart] = useState(0);
  const [groupScrollTarget, setGroupScrollTarget] = useState<number | null>(null);
  const filteredClipsRef = useRef<ClipItem[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const multiSelectModeRef = useRef(false);
  const keyboardNavigatingRef = useRef(false);
  const activeGroupStartRef = useRef(0);
  activeGroupStartRef.current = activeGroupStart;
  selectedIdRef.current = selectedId;
  multiSelectModeRef.current = multiSelectMode;
  keyboardNavigatingRef.current = keyboardNavigating;
  // 程序化翻页（Cmd+↑/↓）窗口期内屏蔽视口中心驱动的分组检测，避免 smooth scroll 中间值导致 activeGroupStart 闪烁/回弹。
  const programmaticGroupUntilRef = useRef(0);
  const handleActiveGroupChange = useCallback((groupStart: number) => {
    if (Date.now() < programmaticGroupUntilRef.current) return;
    activeGroupStartRef.current = groupStart;
    setActiveGroupStart((current) => (current === groupStart ? current : groupStart));
    if (keyboardNavigatingRef.current || multiSelectModeRef.current) return;
    const firstVisibleGroupItem = filteredClipsRef.current[groupStart];
    if (firstVisibleGroupItem && selectedIdRef.current !== firstVisibleGroupItem.id) {
      setSelectedId(firstVisibleGroupItem.id);
    }
  }, []);
  const [isMultiPreviewOpen, setMultiPreviewOpen] = useState(false);
  const [quickPreviewOpen, setQuickPreviewOpen] = useState(false);
  const [isSearchActive, setSearchActive] = useState(false);
  const [nativeStatus, setNativeStatus] = useState(() => t(initialLocale, "main.status.clipboardReady"));
  const [filePathStatuses, setFilePathStatuses] = useState<Record<string, FilePathStatus>>({});
  const [lastCopiedId, setLastCopiedId] = useState<string | null>(null);
  const [, setIsReadingClipboard] = useState(false);
  const [, setIsPanelEntering] = useState(false);
  const [, setScrollOffset] = useState(0);
  const [, setSearchCompact] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 120);
  const clipsRef = useRef<ClipItem[]>(clips);
  const searchRequestRef = useRef<SearchClipsRequest>({ bucket: "all", limit: 200 });
  const shellRef = useRef<HTMLElement | null>(null);
  const settingsRef = useRef<AppSettings>(settings);
  const skipNextSettingsPersistRef = useRef(false);
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
    }),
    [tr],
  );
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

  const handleScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const top = event.currentTarget.scrollTop;
    setScrollOffset(top);
    setSearchCompact(top > 18);
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    const locale = resolveAppLocale(settings.language);
    setDocumentLocale(locale);
    window.document.title = t(locale, "window.main.title");
    void getCurrentWindow().setTitle(t(locale, "window.main.title")).catch((error) =>
      logAppError("warn", "Set main window title failed", String(error)),
    );
    if (skipNextSettingsPersistRef.current) {
      skipNextSettingsPersistRef.current = false;
      return;
    }
    if (configReadyRef.current) {
      if (configWriteTimerRef.current) window.clearTimeout(configWriteTimerRef.current);
      configWriteTimerRef.current = window.setTimeout(() => {
        invoke<void>("write_user_settings", { settings })
          .catch((error) => logAppError("warn", "Sync user settings failed", String(error)));
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
              content: getStarterSampleContent(tr),
              sourceLabel: "ClipForge",
              observedAt: Date.now(),
            });
            if (!isCaptureClipPayload(seedPayload)) throw new Error("Invalid capture_clip_record payload");
            const seedItem = normalizeClip(seedPayload.item, settingsRef.current);
            if (seedItem) {
              items = [seedItem];
              setSelectedId(seedItem.id);
              logAppError("info", "starter-sample: seeded intro clip", { id: seedItem.id });
            }
          } catch (error) {
            logAppError("warn", "Seed starter sample clip failed", String(error));
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
        skipNextSettingsPersistRef.current = true;
        configReadyRef.current = true;
        settingsRef.current = merged;
        setSettings(merged);
        if (!isSettingsWindow) {
          setClips((items) => retagClips(items, merged).slice(0, merged.maxStoredItems));
          logAppError("info", "onboarding: startup settings loaded", {
            onboardingCompleted: merged.onboardingCompleted,
            onboardingShownAt: merged.onboardingShownAt,
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        configReadyRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [isSettingsWindow, tr]);

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
      const finishPanelOpenPerf = startPerfSpan("panel.open", { reason });
      blurHideInFlightRef.current = false;
      // 唤起后只在极短窗口内忽略失焦（吸收 show_and_make_key 引发的一瞬 blur→focus 抖动）。
      // 原值 2400ms 太长：唤起提速后，用户在 2.4s 内点别的窗口，那次 blur 被吞掉、之后不再有
      // blur，面板就不再自动隐藏。400ms 足以覆盖抖动，又不至于吞掉真实的「点开别处」失焦。
      panelFocusGraceUntilRef.current = Date.now() + 400;
      panelShowStartedAtRef.current = Date.now();
      focusRetryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      focusRetryTimersRef.current = [];
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
      // 非激活面板不能依赖第一下普通字符来“唤醒”搜索；打开后立即渲染并聚焦输入框。
      [0, 80, 180].forEach((delay) => {
        const timer = window.setTimeout(() => {
          if (document.activeElement !== searchRef.current) {
            searchRef.current?.focus();
          }
          if (delay === 180) {
            finishPanelOpenPerf({
              searchActive: true,
              searchFocused: document.activeElement === searchRef.current,
            });
            logAppError("info", "panel-keyboard: search focus settle", {
              active: document.activeElement === searchRef.current,
              reason,
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
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("button, input, textarea, select, a, [role='menuitem']")
    ) {
      return;
    }
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
    let timer = 0;
    let disposed = false;
    let cleanupRunning = false;
    const intervalMs = Math.max(1, settings.cleanupIntervalHours) * 60 * 60 * 1000;
    const scheduleNext = (delayMs: number) => {
      if (disposed) return;
      const safeDelayMs = Math.min(Math.max(0, delayMs), MAX_BROWSER_TIMER_DELAY_MS);
      timer = window.setTimeout(() => {
        if (delayMs > MAX_BROWSER_TIMER_DELAY_MS) {
          scheduleNext(delayMs - MAX_BROWSER_TIMER_DELAY_MS);
          return;
        }
        runCleanup();
      }, safeDelayMs);
    };
    const runCleanup = () => {
      if (disposed || cleanupRunning) return;
      cleanupRunning = true;
      invoke<CleanupClipPayload>("cleanup_clip_records", {
        retentionDays: settings.softDeletedRetentionDays,
        maxActiveItems: settings.maxStoredItems,
      })
        .then((payload) => {
          if (payload.hardDeleted > 0) {
            logAppError("info", "Cleanup completed", payload);
          }
        })
        .catch((error) => logAppError("warn", "Cleanup failed", String(error)))
        .finally(() => {
          cleanupRunning = false;
          scheduleNext(intervalMs);
        });
    };
    scheduleNext(CLEANUP_STARTUP_DELAY_MS);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
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
  filteredClipsRef.current = filteredClips;

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
    const itemsById = new Map(filteredClips.map((item) => [item.id, item]));
    return Array.from(selectedIds)
      .map((id) => itemsById.get(id))
      .filter((item): item is ClipItem => Boolean(item));
  }, [filteredClips, selectedIds]);

  const searchSuggestions = useMemo<SearchSuggestion[]>(() => {
    const token = query.trim();
    const commandToken = token.split(/\s+/).at(-1) ?? "";
    // autocomplete 仅在「尾部 token 以 @ 或 # 开头」时触发：输入 @ 立即给出类型筛选下拉（@file: @img: …），
    // 输入 # 给出标签下拉；普通文本搜索不再常驻类型条，避免噪声（reui 式 combobox 触发模型）。
    if (!commandToken.startsWith("@") && !commandToken.startsWith("#")) return [];
    // 已补全的过滤器（如选中 @file: / @收藏 后 query 里的完整 token）不再弹下拉，避免选中后残留单条建议。
    const lowerToken = commandToken.toLowerCase();
    if (baseSearchSuggestions.some((s) => getSearchSuggestionToken(s).toLowerCase() === lowerToken)) return [];
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

  // autocomplete 下拉的高亮项索引；建议列表变化（输入/过滤）时重置到首项，使 Enter 默认应用第一项。
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [searchSuggestions]);

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

  const clearClipboardFilters = useCallback(() => {
    setQuery("");
    setActiveTag(null);
    setFilterFavorite(false);
    setActiveTypeFilter("all");
  }, []);

  const switchClipboardView = useCallback((view: ViewKey) => {
    setActiveSurface("clipboard");
    setActiveView(view);
    setSelectedIds(new Set());
    setMultiSelectMode(false);
    setMultiPreviewOpen(false);
    if (view === "trash" || activeView === "trash") {
      clearClipboardFilters();
      setSearchActive(false);
    }
    void navigateWorkspaceList();
  }, [activeView, clearClipboardFilters]);

  const movePanelSelection = useCallback((key: "ArrowUp" | "ArrowDown", repeat = false) => {
    if (!filteredClips.length) return;
    setKeyboardNavigating(true);
    const direction = key === "ArrowDown" ? 1 : -1;
    if (workspaceRoute.name === "detail") {
      const routeClipId = workspaceRoute.clipId ?? selectedId;
      const currentIndex = Math.max(
        0,
        filteredClips.findIndex((item) => item.id === routeClipId),
      );
      const nextIndex = Math.min(Math.max(currentIndex + direction, 0), filteredClips.length - 1);
      const nextItem = filteredClips[nextIndex];
      if (nextItem && nextItem.id !== routeClipId) {
        setSelectedId(nextItem.id);
        void navigateWorkspaceDetail(nextItem.id);
      }
      return;
    }
    const currentIndex = Math.max(
      0,
      filteredClips.findIndex((item) => item.id === selectedId),
    );
    const offset = direction * (repeat ? 4 : 1);
    const nextIndex = Math.min(Math.max(currentIndex + offset, 0), filteredClips.length - 1);
    const nextItem = filteredClips[nextIndex];
    if (nextItem) {
      setSelectedId(nextItem.id);
    }
  }, [filteredClips, selectedId, workspaceRoute.clipId, workspaceRoute.name]);

  const handlePanelArrowNavigation = useCallback((key: PanelArrowKey, repeat = false) => {
    if (key === "ArrowDown" || key === "ArrowUp") {
      movePanelSelection(key, repeat);
      return;
    }
    if (key === "ArrowRight") {
      if (!multiSelectMode && selectedClip) {
        logAppError("info", "keyboard-detail", {
          id: selectedClip.id,
          hasUrl: Boolean(selectedClip.analysis.url),
          hasAttachment: Boolean(selectedClip.analysis.attachment),
        });
        void navigateWorkspaceDetail(selectedClip.id);
      }
      return;
    }
    if (workspaceRoute.name !== "list") {
      setMultiPreviewOpen(false);
      void navigateWorkspaceList();
    } else if (isMultiPreviewOpen) {
      setMultiPreviewOpen(false);
      void navigateWorkspaceList();
    } else if (multiSelectMode) {
      setSelectedIds(new Set());
      setMultiSelectMode(false);
    }
  }, [isMultiPreviewOpen, movePanelSelection, multiSelectMode, selectedClip, workspaceRoute.name]);

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
    window.setTimeout(() => setLastCopiedId(null), 1400);
  }

  const togglePanelPinned = useCallback(() => {
    const nextPinned = !settingsRef.current.panelPinned;
    setSettings((prev) => ({ ...prev, panelPinned: nextPinned }));
    invoke("set_panel_pinned_command", { pinned: nextPinned }).catch((error) =>
      logAppError("warn", "Toggle panel pin failed", String(error)),
    );
  }, []);

  async function copyClip(item: ClipItem, pasteMode: PasteMode = "rich") {
    const finishCopyPerf = startPerfSpan("quick.copy", { source: "ui", pasteMode });
    let perfStatus = "ok";
    const optimisticStatus =
      pasteMode === "plain"
        ? tr("main.status.copiedPlain")
        : pasteMode === "filesAsPaths"
          ? tr("main.status.copiedFilePaths")
          : tr("main.status.copiedRich");
    lastSeenClipboard.current = item.content.trim();
    markClipCopied(item, optimisticStatus);
    try {
      const payload = await writeClipboard<ClipItem>({ id: item.id, pasteMode, source: "ui" });
      const normalized = normalizeClip(payload, settingsRef.current);
      if (normalized) {
        setClips((current) => {
          const next = current.map((clip) => (clip.id === normalized.id ? normalized : clip));
          clipsRef.current = next;
          return next;
        });
      }
    } catch {
      perfStatus = "fallback";
      await navigator.clipboard.writeText(item.content);
      setNativeStatus(tr("main.status.copiedBrowser"));
    } finally {
      toast.success("已复制到剪贴板", { description: truncateText(item.plainText || item.content, 42) });
      finishCopyPerf({ status: perfStatus });
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
    const finishCopyPerf = startPerfSpan("quick.copy", { source });
    let perfStatus = "ok";
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
      toast.success("已复制到剪贴板", { description: truncateText(text, 42) });
      logAppError("info", "copy-text: invoke success", {
        source,
        chars: text.length,
        ...context,
      });
    } catch (error) {
      perfStatus = "fallback";
      logAppError("warn", "Copy text failed", { source, error: String(error), ...context });
      await navigator.clipboard.writeText(text);
      setNativeStatus(tr("main.status.copiedCodeBrowser"));
      toast.success("已复制到剪贴板", { description: truncateText(text, 42) });
    } finally {
      finishCopyPerf({ status: perfStatus });
    }
  }

  async function pasteText(text: string, source = "unknown", context: Record<string, unknown> = {}) {
    const finishPastePerf = startPerfSpan("quick.paste", { source });
    let perfStatus = "ok";
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
      toast.success(tr("main.toast.pastedCode"));
      logAppError("info", "paste-text: invoke success", {
        source,
        chars: text.length,
        ...context,
      });
    } catch (error) {
      perfStatus = "fallback-copy";
      logAppError("warn", "Paste text failed", { source, error: String(error), ...context });
      await copyText(text, `${source}:fallback-copy`, context);
      setNativeStatus(tr("main.status.pasteCodeFallback"));
    } finally {
      finishPastePerf({ status: perfStatus });
    }
  }

  async function pasteClip(item: ClipItem, source = "unknown") {
    const finishPastePerf = startPerfSpan("quick.paste", { source });
    let perfStatus = "ok";
    setIsPanelEntering(false);
    lastSeenClipboard.current = item.content.trim();
    markClipCopied(item, tr("main.status.pastingToApp"));
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
      if (normalized) {
        setClips((current) => {
          const next = current.map((clip) => (clip.id === normalized.id ? normalized : clip));
          clipsRef.current = next;
          return next;
        });
      }
      setNativeStatus(tr("main.status.pastedToApp"));
      logAppError("info", "paste-ui: invoke success", { id: item.id, source });
    } catch (error) {
      perfStatus = "fallback-copy";
      logAppError("warn", "Paste clip failed", String(error));
      try {
        const payload = await writeClipboard<ClipItem>({
          id: item.id,
          pasteMode: "rich",
          source: `${source}:fallback-copy`,
        });
        const normalized = normalizeClip(payload, settingsRef.current);
        if (normalized) {
          setClips((current) => {
            const next = current.map((clip) => (clip.id === normalized.id ? normalized : clip));
            clipsRef.current = next;
            return next;
          });
        }
      } catch {
        await navigator.clipboard.writeText(item.content);
      }
      setNativeStatus(formatNativeError(error));
    } finally {
      finishPastePerf({ status: perfStatus });
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
    toast.success(
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
    toast.success(tr("main.toast.aggregateCopied", { count: items.length }), {
      description: truncateText(text, 42),
    });
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
    window.setTimeout(() => setLastCopiedId(null), 1400);
    setSelectedIds(new Set());
    setMultiSelectMode(false);
    setMultiPreviewOpen(false);
  }

  async function exportSelectedTextFiles(items: ClipItem[]) {
    if (!items.length) {
      setNativeStatus(tr("main.status.selectBeforeExportTextFiles"));
      return;
    }
    try {
      const result = await invoke<ExportTextFilesPayload>("export_clip_text_files", {
        items: items.map((item) => ({
          title: item.analysis.title || item.analysis.sourceName || item.payloadKind,
          content: item.content,
        })),
      });
      setNativeStatus(
        tr("main.status.exportedTextFiles", {
          count: result.count,
          directory: result.directory,
        }),
      );
      toast.success(tr("main.toast.exportedTextFiles", { count: result.count }));
    } catch (error) {
      logAppError("warn", "Export selected text files failed", String(error));
      setNativeStatus(formatNativeError(error));
    }
  }

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.isComposing) return;

      const target = event.target;
      const editable =
        target instanceof Element
          ? target.closest("input, textarea, select, [contenteditable='true']")
          : null;
      const allowListShortcutFromSearch = editable === searchRef.current && !query.trim();
      const quickItems = filteredClips;
      const key = event.key.toLowerCase();
      const currentItem = quickItems.find((clip) => clip.id === selectedId) ?? quickItems[0];

      if ((event.metaKey || event.ctrlKey) && !event.altKey && key === ",") {
        event.preventDefault();
        invoke("open_settings_window").catch((error) =>
          logAppError("warn", "Open settings window failed", String(error)),
        );
        return;
      }

      if (!editable && !event.ctrlKey && !event.metaKey && !event.altKey && key === "t") {
        event.preventDefault();
        switchClipboardView("trash");
        return;
      }

      if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const views: ViewKey[] = ["history", "favorites"];
        const currentIndex = Math.max(0, views.indexOf(activeView));
        const nextIndex = event.shiftKey
          ? (currentIndex - 1 + views.length) % views.length
          : (currentIndex + 1) % views.length;
        switchClipboardView(views[nextIndex]);
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
          toast.success(currentItem.favorite ? tr("main.toast.unfavorited") : tr("main.toast.favorited"));
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
        if (quickPreviewOpen) {
          setQuickPreviewOpen(false);
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
        handlePanelArrowNavigation(event.key);
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        // 搜索聚焦且有建议时：↑/↓ 在 autocomplete 下拉里移动高亮，不再穿透去翻背后列表。
        if (editable === searchRef.current && searchSuggestions.length > 0) {
          event.preventDefault();
          const dir = event.key === "ArrowDown" ? 1 : -1;
          setActiveSuggestionIndex((i) => (i + dir + searchSuggestions.length) % searchSuggestions.length);
          return;
        }
        if (editable && editable !== searchRef.current) return;
        event.preventDefault();
        handlePanelArrowNavigation(event.key, event.repeat);
        return;
      }

      if (event.key === "Enter") {
        if (editable === searchRef.current && searchSuggestions.length > 0) {
          event.preventDefault();
          const idx = Math.min(Math.max(activeSuggestionIndex, 0), searchSuggestions.length - 1);
          applySearchSuggestion(searchSuggestions[idx]);
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
        if (multiSelectMode) {
          // 多选模式下空格继续切换当前项选中状态
          setKeyboardNavigating(true);
          setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
          });
          return;
        }
        // 非多选模式下空格开关快速预览
        setQuickPreviewOpen((open) => !open);
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
    activeSuggestionIndex,
    handlePanelArrowNavigation,
    toast,
    switchClipboardView,
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
      toast.success(tr("main.toast.deletedCount", { count: ids.length }));
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
  const shouldRenderSearchBar = showSearchBar && (isSearchActive || Boolean(query));

  const modLabel = getShortcutModLabel();

  return (
    <main
      data-surface="clipboard"
      className={`relative mx-auto grid h-fit max-h-[640px] w-[480px] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[14px] material panel-shadow panel-in${isPanelClosing ? " pointer-events-none" : ""}`}
      ref={shellRef}
    >
      {workspaceRoute.name !== "detail" && (
        <TopToolbar
          activeView={activeView}
          onDrag={handleWindowDrag}
          onOpenDsh={() => {
            void openDshWindow();
          }}
          onOpenSettings={() => {
            invoke("open_settings_window").catch((error) =>
              logAppError("warn", "Open settings window failed", String(error)),
            );
          }}
          onPanelArrowKey={handlePanelArrowNavigation}
          onViewChange={switchClipboardView}
          searchBar={shouldRenderSearchBar ? (
            <GlassSearchBar
              activeFilterLabels={parsedSearchCommand.ast.labels}
              inputRef={searchRef}
              onApplySuggestion={applySearchSuggestion}
              activeSuggestionIndex={activeSuggestionIndex}
              onSelectSuggestionIndex={setActiveSuggestionIndex}
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
          tr={tr}
        />
      )}

      <section className="min-w-0 overflow-hidden" onScroll={handleScroll}>
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
                  density={settings.panelDensity}
                  onCreateSnippet={() => toast.info("新建片段功能开发中")}
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
                    setMultiSelectMode(false);
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
                  quickPreviewOpen={quickPreviewOpen}
                  onToggleQuickPreview={() => setQuickPreviewOpen((open) => !open)}
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
                  onCopyPlain={(item) => copyClip(item, "plain")}
                  onCopyText={copyText}
                  onOpen={openClipTarget}
                  onOpenPath={openSystemPath}
                  onPasteText={pasteText}
                  onPrevious={previousClip ? () => navigateDetailClip(previousClip) : undefined}
                  onNext={nextClip ? () => navigateDetailClip(nextClip) : undefined}
                  onSearchTag={searchByTag}
                  onUpdateContent={updateClipContent}
                  onAnalyzeClipboard={analyzeClipboardWithDsh}
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
                  setMultiSelectMode(selectedInList.length > 0);
                  void navigateWorkspaceList();
                }}
                onCopy={() => {
                  void copySelectedClips(selectedInList).then(() => navigateWorkspaceList());
                }}
                onCopyItem={(clip) => copyClip(clip)}
                onExportTextFiles={() => exportSelectedTextFiles(selectedInList)}
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

      {workspaceRoute.name === "list" ? (
        multiSelectMode ? (
          <MultiSelectBottomBar
            count={selectedInList.length}
            tr={tr}
            variant={activeView === "trash" ? "trash" : "default"}
          />
        ) : (
          <PanelStatusFeedback
            commandMenu={
              <QuickCommandMenu
                mod={modLabel}
                onCopyMode={(item, mode) => {
                  void copyClip(item, mode);
                }}
                onDelete={(item) => {
                  void deleteClips([item.id]);
                }}
                onFavorite={(item) => updateClip(item.id, { favorite: !item.favorite })}
                onCreateSnippet={() => toast.info("新建片段功能开发中")}
                onTogglePanelPinned={togglePanelPinned}
                selectedItem={selectedClip}
              >
                <button
                  className="mono flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                  type="button"
                >
                  <span>{filteredClips.length} 条</span>
                  <span>·</span>
                  <span>⌘K 全部操作</span>
                </button>
              </QuickCommandMenu>
            }
            status={nativeStatus}
            tr={tr}
          />
        )
      ) : null}
    </main>
  );
}

function GlassSearchBar({
  activeFilterLabels,
  inputRef,
  onApplySuggestion,
  activeSuggestionIndex,
  onBlur,
  onChange,
  onClear,
  onFocus,
  onRemoveFilter,
  onSelectSuggestionIndex,
  parsedSearchCommand,
  query,
  suggestions,
  tr,
}: {
  activeFilterLabels: string[];
  inputRef: RefObject<HTMLInputElement | null>;
  onApplySuggestion: (suggestion: SearchSuggestion) => void;
  activeSuggestionIndex: number;
  onBlur: () => void;
  onChange: (value: string) => void;
  onClear: () => void;
  onFocus: () => void;
  onRemoveFilter: (label: string) => void;
  onSelectSuggestionIndex: (index: number) => void;
  parsedSearchCommand: ParsedSearchCommand;
  query: string;
  suggestions: SearchSuggestion[];
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  return (
    <div className="flex w-full flex-col">
      <div className="flex h-[52px] items-center gap-3 px-4">
        <Search size={15} className="flex-shrink-0 text-muted-foreground" />
        <input
          aria-label={tr("main.search.aria")}
          autoComplete="off"
          className="h-full w-full bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          onBlur={onBlur}
          onChange={(event) => onChange(event.currentTarget.value)}
          onFocus={onFocus}
          placeholder={tr("main.search.placeholder")}
          ref={inputRef}
          spellCheck={false}
          value={query}
        />
        {query ? (
          <button
            aria-label={tr("main.search.clear")}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/5 active:scale-90 dark:hover:bg-white/[0.07]"
            onClick={onClear}
            type="button"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      {activeFilterLabels.length ? (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2" aria-label={tr("main.search.activeFilters")}>
          {activeFilterLabels.map((label) => (
            <button
              aria-label={tr("main.search.removeFilter", { label })}
              className="inline-flex items-center gap-1 rounded-md border border-black/10 bg-black/[0.03] px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-black/5 dark:border-white/[0.12] dark:bg-white/[0.05]"
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
        <SearchAutocomplete
          activeIndex={activeSuggestionIndex}
          inputRef={inputRef}
          onApplySuggestion={onApplySuggestion}
          onSelectIndex={onSelectSuggestionIndex}
          parsedSearchCommand={parsedSearchCommand}
          suggestions={suggestions}
          tr={tr}
        />
      ) : null}
    </div>
  );
}

// reui 式 autocomplete 下拉：以 @ / # 触发，floating-ui 把浮层 portal 到 body 层，
// 绕开搜索栏祖先的 overflow/层叠，保证下拉一定可见；↑/↓/Enter 由外层 keydown 驱动 activeIndex。
function SearchAutocomplete({
  activeIndex,
  inputRef,
  onApplySuggestion,
  onSelectIndex,
  parsedSearchCommand,
  suggestions,
  tr,
}: {
  activeIndex: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onApplySuggestion: (suggestion: SearchSuggestion) => void;
  onSelectIndex: (index: number) => void;
  parsedSearchCommand: ParsedSearchCommand;
  suggestions: SearchSuggestion[];
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const { refs, x, y, strategy } = useFloating({
    open: suggestions.length > 0,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [floatingOffset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const listRef = useRef<HTMLDivElement | null>(null);

  // 把浮层锚定到搜索输入框（输入框由外层 inputRef 持有，挂载后绑定）。
  useLayoutEffect(() => {
    if (inputRef.current) refs.setReference(inputRef.current);
  }, [inputRef, refs]);

  // 键盘移动高亮时，把当前项滚进下拉视口。
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, suggestions]);

  const ready = x != null && y != null;

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        className="z-[60] w-56 rounded-xl border border-black/5 bg-popover p-1 shadow-lg dark:border-white/[0.07]"
        role="listbox"
        aria-label={tr("main.search.suggestions")}
        style={{
          position: strategy,
          top: 0,
          left: 0,
          visibility: ready ? "visible" : "hidden",
          transform: `translate3d(${x ?? 0}px, ${y ?? 0}px, 0)`,
        }}
      >
        <div className="max-h-60 overflow-auto py-0.5" ref={listRef}>
          {suggestions.map((suggestion, index) => {
            const token = getSearchSuggestionToken(suggestion);
            const isActive =
              (suggestion.kind === "favorite" && parsedSearchCommand.filterFavorite) ||
              (suggestion.kind === "type" && parsedSearchCommand.typeFilter === suggestion.typeFilter) ||
              (suggestion.kind === "saved" && parsedSearchCommand.tag === suggestion.tag);
            return (
              <button
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] outline-none transition-colors${index === activeIndex ? " bg-black/[0.045] dark:bg-white/[0.07]" : ""}${isActive ? " text-foreground" : " text-muted-foreground"}`}
                data-idx={index}
                key={suggestion.id}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => onSelectIndex(index)}
                onClick={() => onApplySuggestion(suggestion)}
                role="option"
                aria-selected={index === activeIndex}
                type="button"
              >
                <span className="mono flex-shrink-0 rounded bg-black/[0.04] px-1 py-0.5 text-[11px] dark:bg-white/[0.07]">
                  {token}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">{suggestion.label}</span>
                <span className="flex-shrink-0 text-[11px] opacity-60">{suggestion.hint}</span>
              </button>
            );
          })}
        </div>
      </div>
    </FloatingPortal>
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

  if (!clips.length) {
    return <ClipboardEmptyState variant="trash" emptySummary={emptySummary} tr={tr} />;
  }
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col" onPointerDown={onPointerActive}>
        <VirtualList
          activeId={activeId}
          autoScroll={autoScroll}
          className="flex-1"
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          itemHeight={settings.panelDensity === "comfortable" ? 44 : settings.panelDensity === "dense" ? 34 : 40}
          items={clips}
          onEndReached={onLoadMore}
          onUserScroll={onPointerActive}
          groupSize={10}
          renderItem={(item, index) => (
            <TrashRow
              key={item.id}
              item={item}
              index={index}
              activeId={activeId}
              selectedIds={selectedIds}
              multiSelectMode={multiSelectMode}
              activeGroupStart={0}
              density={settings.panelDensity}
              settings={settings}
              onSelect={onSelect}
              onRestore={onRestore}
              onHardDelete={onHardDelete}
              onToggleSelected={onToggleSelected}
              onStartMultiSelect={onStartMultiSelect}
              onOpenContextMenu={openContextMenu}
              tr={tr}
            />
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

function VirtualList<T extends { id: string }>({
  activeId,
  className,
  hasMore = false,
  items,
  isLoadingMore = false,
  itemHeight = ROW_HEIGHT,
  onEndReached,
  onUserScroll,
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
  onUserScroll?: () => void;
  renderItem: (item: T, index: number) => ReactNode;
  autoScroll?: boolean;
  groupSize?: number;
  onActiveGroupChange?: (groupStart: number) => void;
  scrollToGroupStart?: number | null;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(420);
  const [, setScrollFeedback] = useState(false);
  const isScrollFeedbackRef = useRef(false);
  const scrollFeedbackTimerRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const lastScrollPerfAtRef = useRef(0);
  const lastAutoScrollActiveIdRef = useRef<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const setFeedback = useCallback(
    (next: boolean) => {
      if (isScrollFeedbackRef.current !== next) {
        isScrollFeedbackRef.current = next;
        setScrollFeedback(next);
      }
      if (scrollFeedbackTimerRef.current) window.clearTimeout(scrollFeedbackTimerRef.current);
      if (next) {
        scrollFeedbackTimerRef.current = window.setTimeout(() => {
          isScrollFeedbackRef.current = false;
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
      if (scrollRafRef.current) window.cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  // 选中项变化时把它滚到视口垂直居中（macOS 切换器手感）。
  // 不做「已可见就跳过」的守卫：贴边跟随会显得选中行不居中；首尾由 max(0,…) 自然截停。
  // 用 behavior:"auto" 即时定位而非 smooth：连续按方向键时 smooth 动画会追着按键跑，拖沓不跟手。
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
    const targetTop = Math.max(0, itemTop - node.clientHeight / 2 + itemHeight / 2);
    setFeedback(true);
    node.scrollTo({ top: targetTop, behavior: "auto" });
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
  return (
    <div
      className={`${className} thin-scroll relative overflow-auto px-2`}
      onTouchMove={onUserScroll}
      onWheel={onUserScroll}
      onScroll={(event) => {
        const node = event.currentTarget;
        const now = performance.now();
        if (now - lastScrollPerfAtRef.current > 160) {
          lastScrollPerfAtRef.current = now;
          recordNextFramePerf("quick.scroll", { className });
        }
        pendingScrollTopRef.current = node.scrollTop;
        if (!scrollRafRef.current) {
          scrollRafRef.current = window.requestAnimationFrame(() => {
            scrollRafRef.current = null;
            setScrollTop(pendingScrollTopRef.current);
          });
        }
        setFeedback(true);
        if (hasMore && !isLoadingMore && node.scrollHeight - node.scrollTop - node.clientHeight < itemHeight * 6) {
          onEndReached?.();
        }
      }}
      ref={ref}
    >
      <div className="relative" style={{ height: items.length * itemHeight }}>
        <div
          className="absolute left-0 right-0 top-0 will-change-transform"
          style={{ transform: `translateY(${start * itemHeight}px)` }}
        >
          {visible.map((item, index) => (
            <div key={item.id}>
              {renderItem(item, start + index)}
            </div>
          ))}
          {isLoadingMore ? (
            <div className="flex h-10 items-center justify-center text-[11px] text-muted-foreground">
              加载更多...
            </div>
          ) : null}
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
  density,
  onCreateSnippet,
  quickPreviewOpen,
  onToggleQuickPreview,
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
  density?: PanelDensity;
  onCreateSnippet?: () => void;
  quickPreviewOpen: boolean;
  onToggleQuickPreview: () => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const [contextMenu, setContextMenu] = useState<{ item: ClipItem; x: number; y: number } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const openContextMenu = useCallback((event: MouseEvent<HTMLElement>, item: ClipItem) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(item);
    if (multiSelectMode && !selectedIds.has(item.id)) onToggleSelected(item.id);
    const menuWidth = 204;
    const menuHeight = multiSelectMode ? 190 : 332;
    setContextMenu({
      item,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8)),
    });
  }, [multiSelectMode, onSelect, onToggleSelected, selectedIds]);

  if (!clips.length) {
    return (
      <ClipboardEmptyState
        emptySummary={emptySummary}
        onCreateSnippet={onCreateSnippet}
        tr={tr}
        variant="history"
      />
    );
  }

  const selectedItem = clips.find((clip) => clip.id === activeId) ?? clips[0];

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col" onPointerDown={onPointerActive}>
        {quickPreviewOpen && selectedItem ? (
          <QuickPreviewCard
            item={selectedItem}
            onClose={onToggleQuickPreview}
            onCopyPlain={(item) => onCopyMode(item, "plain")}
            onFavorite={onFavorite}
            onPaste={onPaste}
          />
        ) : null}
        <VirtualList
          activeId={activeId}
          autoScroll={autoScroll}
          className="flex-1"
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          itemHeight={density === "comfortable" ? 44 : density === "dense" ? 34 : 40}
          items={clips}
          onEndReached={onLoadMore}
          groupSize={10}
          onActiveGroupChange={onActiveGroupChange}
          scrollToGroupStart={groupScrollTarget}
          renderItem={(item, index) => (
            <ClipboardRow
              activeGroupStart={activeGroupStart}
              activeId={activeId}
              copiedId={copiedId}
              density={density}
              filePathStatuses={filePathStatuses}
              index={index}
              item={item}
              key={item.id}
              multiSelectMode={multiSelectMode}
              onFavorite={onFavorite}
              onOpen={onOpen}
              onOpenContextMenu={openContextMenu}
              onPaste={onPaste}
              onPin={() => toast.info("固定到顶部功能开发中")}
              onSelect={onSelect}
              onStartMultiSelect={onStartMultiSelect}
              onToggleSelected={onToggleSelected}
              selectedIds={selectedIds}
              tr={tr}
            />
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
            onCopyMode={(mode) => onCopyMode(contextMenu.item, mode)}
            onAnalyzeClipboard={analyzeClipboardWithDsh}
            onCopySelected={onCopySelected}
            onStartMultiSelect={onStartMultiSelect}
            onClearSelection={onClearSelection}
            onOpenDetail={() => {
              logAppError("info", "context-menu-detail", {
                id: contextMenu.item.id,
                hasUrl: Boolean(contextMenu.item.analysis.url),
                hasAttachment: Boolean(contextMenu.item.analysis.attachment),
              });
              void navigateWorkspaceDetail(contextMenu.item.id);
            }}
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
