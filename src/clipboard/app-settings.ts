// AppSettings/TagRule 类型（S5 从 App.tsx 迁出）：主窗与各拆分模块共用的设置契约。
import type { AppLanguagePreference } from "../i18n";
import type { ContentDisplayMode, PanelDensity, TagMode } from "./clip-model";

export type TagRule = {
  id: string;
  label: string;
  query: string;
};

export type AppSettings = {
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
  /** Agent provider 配置（legacy 顶层 agentProviders[] 与新结构 agent.providers[]；主窗只读展示用）。 */
  agentProviders?: Array<Record<string, unknown>>;
  agent?: { providers?: Array<Record<string, unknown>> };
};
