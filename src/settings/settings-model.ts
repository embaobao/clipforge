/** 设置窗口数据模型与导航常量：AppSettings、各 payload 契约、默认值与 section/tab 导航工具（从 settings.tsx 切出）。 */
import {
  Database,
  Eye,
  FileImage,
  Tag,
  Terminal,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";
import type { AppLanguagePreference, TranslationKey } from "../i18n";
import { normalizeLanguagePreference } from "../i18n";
import {
  SETTINGS_INFORMATION_ARCHITECTURE,
  type SettingsSectionId,
  type SettingsTabId,
} from "./settings-field-catalog";

/**
 * 后端固定英文状态串 → i18n key 映射表。
 * Rust 侧返回的 message（MCP 服务状态、辅助功能、登录启动等）是英文固定串，
 * 直接透传到状态条会破坏界面语言一致性；命中映射则本地化，未命中原样返回保留诊断价值。
 */
const BACKEND_MESSAGE_I18N: Array<{ pattern: RegExp; key: TranslationKey }> = [
  { pattern: /^MCP server running$/, key: "settings.backend.mcpRunning" },
  { pattern: /^MCP server stopped/, key: "settings.backend.mcpStopped" },
  { pattern: /^MCP server (is already running|started)/, key: "settings.backend.mcpStarted" },
  { pattern: /^accessibility status unavailable$/, key: "settings.backend.accessibilityUnavailable" },
  { pattern: /^Launch at login status unavailable/, key: "settings.backend.launchAtLoginUnavailable" },
  { pattern: /^Launch at login is only available on desktop builds$/, key: "settings.backend.launchAtLoginUnsupported" },
];

/**
 * 将后端固定英文状态串映射为本地化文案。
 * 边界：只映射上方枚举的固定串；动态错误详情（如 updater 的 errorMessage）不在前端翻译，
 * 由调用方决定是否展示原文技术细节。
 */
export function localizeBackendMessage(
  message: string,
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const trimmed = message.trim();
  if (!trimmed) return "";
  for (const entry of BACKEND_MESSAGE_I18N) {
    if (entry.pattern.test(trimmed)) return tr(entry.key);
  }
  return message;
}

export interface AppSettings {
  language: AppLanguagePreference;
  globalShortcut: string;
  panelDensity: "dense" | "normal" | "comfortable";
  contentDisplayMode: "summary" | "middle" | "raw";
  quickItemLimit: number;
  maxStoredItems: number;
  clipboardPollMs: number;
  cleanupEnabled: boolean;
  cleanupIntervalHours: number;
  softDeletedRetentionDays: number;
  enableMarkdownPreview: boolean;
  fuzzySearchEnabled: boolean;
  pinyinSearchEnabled: boolean;
  tagMode: "similar" | "rules" | "off";
  tagRules: Array<{ id: string; label: string; query: string }>;
  positionStrategy: "trayCenter" | "followCursor" | "center" | "windowCenter" | "lastPosition" | "focusInput";
  panelBackgroundOpacity: number;
  enableScrollCollapse: boolean;
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
  agentProviders?: Array<Record<string, unknown>>;
  agent?: {
    providers?: Array<Record<string, unknown>>;
  };
}

export interface AccessibilityPermissionPayload {
  canReadFocusedInput: boolean;
  status: "granted" | "missing" | "denied" | "unsupported";
  message: string;
}

export interface TccAccessibilityRecordPayload {
  database: string;
  client: string;
  clientType: number;
  authValue: number;
  authLabel: string;
  csreqSummary: string;
  lastModified: string;
}

export interface AccessibilityDiagnosticsPayload {
  trusted: boolean;
  expectedBundleIdentifier: string;
  executablePath: string;
  appBundlePath: string;
  codeSignatureIdentifier: string;
  signatureKind: string;
  teamIdentifier: string;
  cdHash: string;
  designatedRequirement: string;
  tccRecords: TccAccessibilityRecordPayload[];
  tccQueryError?: string | null;
  message: string;
}

export interface PanelTriggerPayload {
  visible: boolean;
  focused: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  source: string;
  positionSource: string;
  focusedInputSource: string;
  usedFocusedInput: boolean;
  accessibilityStatus: string;
  message: string;
}

export interface McpStatusPayload {
  enabled: boolean;
  running: boolean;
  transport: string;
  command: string;
  tools: string[];
  message: string;
}

export interface LaunchAtLoginPayload {
  supported: boolean;
  enabled: boolean;
  desired: boolean;
  message: string;
}

export interface SettingsSaveFeedback {
  state: "idle" | "pending" | "saved" | "error";
  message: string;
  requestId: number;
}

export interface LogStatsPayload {
  path: string;
  sizeBytes: number;
  lineCount: number;
  oldestTsMs: number;
  maxSizeMb: number;
  keepRatio: number;
  retentionDays: number;
  autoCleanup: boolean;
  intervalMin: number;
}

export interface DiagnosticsExportPayload {
  path: string;
  createdAt: number;
  logCount: number;
  summary: string;
}

export interface BuildInfoPayload {
  productName: string;
  currentVersion: string;
  bundleIdentifier: string;
  targetOs: string;
  targetArch: string;
  updaterEndpoint: string;
}

/** 数据存储统计（get_clipforge_data_stats 返回，data tab 展示与清理决策用）。 */
export interface DataStatsPayload {
  dbBytes: number;
  settingsBytes: number;
  imagesBytes: number;
  clipCount: number;
  trashCount: number;
}

/** 应用内更新检查状态机（settings.tsx 的 safeInvokeUpdateCheck 消费）。 */
export interface UpdateCheckState {
  status: "idle" | "checking" | "available" | "latest" | "downloading" | "ready" | "failed";
  currentVersion: string;
  availableVersion?: string;
  channel: "stable" | "prerelease";
  lastCheckedAt?: number;
  ignoredVersion?: string;
  releaseNotes?: string;
  downloadProgress?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface SettingsAppState {
  accessibility: AccessibilityPermissionPayload | null;
  accessibilityDiagnostics: AccessibilityDiagnosticsPayload | null;
  configPath: string;
  configStatus: string;
  databasePath: string;
  mcp: McpStatusPayload | null;
  panel: PanelTriggerPayload | null;
  launchAtLogin: LaunchAtLoginPayload | null;
  settings: AppSettings;
  saveFeedback: SettingsSaveFeedback;
  status: string;
  logStats: LogStatsPayload | null;
  dataStats: DataStatsPayload | null;
  update: UpdateCheckState | null;
  buildInfo: BuildInfoPayload | null;
}

/** 字节数格式化（日志/导出诊断展示用）。 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const DEFAULT_SHORTCUT = "Control+V";

export const DEFAULT_SETTINGS: AppSettings = {
  language: "system",
  globalShortcut: DEFAULT_SHORTCUT,
  panelDensity: "normal",
  contentDisplayMode: "summary",
  quickItemLimit: 12,
  maxStoredItems: 500,
  clipboardPollMs: 200,
  cleanupEnabled: true,
  cleanupIntervalHours: 24,
  softDeletedRetentionDays: 30,
  enableMarkdownPreview: true,
  fuzzySearchEnabled: true,
  pinyinSearchEnabled: true,
  tagMode: "rules",
  tagRules: [
    { id: "r1", label: "GitHub", query: "github.com gh repo pull request" },
    { id: "r2", label: "GitLab", query: "gitlab.com merge request" },
    { id: "r3", label: "命令", query: "pnpm npm npx cargo git tauri brew" },
    { id: "r4", label: "文档", query: "readme openspec markdown docs md" },
  ],
  positionStrategy: "followCursor",
  panelBackgroundOpacity: 0.72,
  enableScrollCollapse: true,
  panelWidth: 420,
  panelHeight: 400,
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

/** 宽松归一化：以 DEFAULT_SETTINGS 为底合并部分字段，language 走偏好归一化。 */
export function normalizeAppSettings(settings: Partial<AppSettings> | Record<string, unknown>): AppSettings {
  const partial = settings as Partial<AppSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    language: normalizeLanguagePreference(partial.language),
  };
}

export const SECTION_ICON_BY_ID: Record<SettingsSectionId, LucideIcon> = {
  "shortcut-language": Terminal,
  "display-panel": Eye,
  "capture-content": FileImage,
  "storage-logs": Database,
  "mcp-agent": Terminal,
  "update-distribution": UploadCloud,
  "tag-rules": Tag,
};

/** 旧版 URL section 名 → 新 section/tab 映射（深链接兼容）。 */
export const SECTION_LEGACY_ALIASES: Record<string, { section: SettingsSectionId; tab: SettingsTabId }> = {
  shortcut: { section: "shortcut-language", tab: "shortcut" },
  onboarding: { section: "shortcut-language", tab: "onboarding" },
  display: { section: "display-panel", tab: "density" },
  content: { section: "capture-content", tab: "search" },
  capture: { section: "capture-content", tab: "capture-types" },
  storage: { section: "storage-logs", tab: "data" },
  integration: { section: "mcp-agent", tab: "status" },
  manual: { section: "mcp-agent", tab: "install" },
  update: { section: "update-distribution", tab: "version" },
  tags: { section: "tag-rules", tab: "tag-mode" },
};

export const DEFAULT_SECTION_TABS: Record<SettingsSectionId, SettingsTabId> = {
  "shortcut-language": "shortcut",
  "display-panel": "density",
  "capture-content": "search",
  "storage-logs": "data",
  "mcp-agent": "status",
  "update-distribution": "version",
  "tag-rules": "tag-mode",
};

export const SECTIONS = SETTINGS_INFORMATION_ARCHITECTURE.map((item) => ({
  ...item,
  key: item.id,
  icon: SECTION_ICON_BY_ID[item.id],
}));

export type SectionKey = SettingsSectionId;

export const SETTINGS_TAB_LABEL_KEYS: Record<SettingsTabId, TranslationKey> = {
  onboarding: "settings.tab.onboarding",
  shortcut: "settings.tab.shortcut",
  language: "settings.tab.language",
  permissions: "settings.tab.permissions",
  density: "settings.tab.density",
  size: "settings.tab.size",
  position: "settings.tab.position",
  test: "settings.tab.test",
  search: "settings.tab.search",
  preview: "settings.tab.preview",
  "capture-types": "settings.tab.captureTypes",
  limits: "settings.tab.limits",
  data: "settings.tab.data",
  cleanup: "settings.tab.cleanup",
  logs: "settings.tab.logs",
  diagnostics: "settings.tab.diagnostics",
  status: "settings.tab.status",
  install: "settings.tab.install",
  "json-rpc": "settings.tab.jsonRpc",
  provider: "settings.tab.provider",
  version: "settings.tab.version",
  "update-flow": "settings.tab.updateFlow",
  build: "settings.tab.build",
  "tag-mode": "settings.tab.tagMode",
  rules: "settings.tab.rules",
};

export function hasSettingsTab(tabs: readonly SettingsTabId[], requestedTab: string | null): requestedTab is SettingsTabId {
  return Boolean(requestedTab && tabs.some((tab) => tab === requestedTab));
}

/** 从 URL 解析初始导航（section/tab），支持直接 section 名与旧别名。 */
export function getInitialNavigationFromUrl(): { section: SectionKey; tab: SettingsTabId } {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("section") ?? params.get("tab");
  const requestedTab = params.get("tab");
  const directSection = SECTIONS.find((item) => item.key === requested);
  if (directSection) {
    const directTabs = [...directSection.tabs] as SettingsTabId[];
    const tab = hasSettingsTab(directTabs, requestedTab)
      ? requestedTab
      : DEFAULT_SECTION_TABS[directSection.key];
    return { section: directSection.key, tab };
  }
  if (requested && SECTION_LEGACY_ALIASES[requested]) return SECTION_LEGACY_ALIASES[requested];
  return { section: "shortcut-language", tab: "shortcut" };
}
