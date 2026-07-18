import type { TranslationKey } from "@/i18n";

export type SettingFieldType =
  | "toggle"
  | "segment"
  | "switch"
  | "number"
  | "slider"
  | "readonly"
  | "code"
  | "action";

export type SettingsSectionId =
  | "shortcut-language"
  | "display-panel"
  | "capture-content"
  | "storage-logs"
  | "mcp-agent"
  | "update-distribution"
  | "tag-rules";

export type SettingsTabId =
  | "onboarding"
  | "shortcut"
  | "language"
  | "permissions"
  | "density"
  | "size"
  | "position"
  | "test"
  | "search"
  | "preview"
  | "capture-types"
  | "limits"
  | "data"
  | "cleanup"
  | "logs"
  | "diagnostics"
  | "status"
  | "install"
  | "json-rpc"
  | "provider"
  | "version"
  | "update-flow"
  | "build"
  | "tag-mode"
  | "rules";

/** 设置页最小字段目录：只描述 UI 放置、控件类型、文案 key 和排序，不承载 schema 或写入策略。
 *  `settingsKey` 显式声明该字段对应的 AppSettings key；缺省时回退到 `id`。
 *  action / code / readonly 等派生字段不写回设置，不带 settingsKey。 */
export type SettingFieldConfig = {
  id: string;
  section: SettingsSectionId;
  tab: SettingsTabId;
  type: SettingFieldType;
  labelKey: TranslationKey;
  descriptionKey?: TranslationKey;
  order: number;
  /** 对应 AppSettings 的写入 key；缺省回退 id。仅 switch/segment/number/slider 等可写字段需要。 */
  settingsKey?: string;
};

/** 设置页一级信息架构，作为彻底重构时替换旧 SECTIONS 的稳定目标。 */
export const SETTINGS_INFORMATION_ARCHITECTURE = [
  {
    id: "shortcut-language",
    labelKey: "settings.section.shortcutLanguage",
    tabs: ["onboarding", "shortcut", "language", "permissions"],
  },
  {
    id: "display-panel",
    labelKey: "settings.section.displayPanel",
    tabs: ["density", "size", "position", "test"],
  },
  {
    id: "capture-content",
    labelKey: "settings.section.captureContent",
    tabs: ["search", "preview", "capture-types", "limits"],
  },
  {
    id: "storage-logs",
    labelKey: "settings.section.storageLogs",
    tabs: ["data", "cleanup", "logs", "diagnostics"],
  },
  {
    id: "mcp-agent",
    labelKey: "settings.section.mcpAgent",
    tabs: ["status", "install", "json-rpc", "provider"],
  },
  {
    id: "update-distribution",
    labelKey: "settings.section.updateDistribution",
    tabs: ["version", "update-flow", "build"],
  },
  {
    id: "tag-rules",
    labelKey: "settings.section.tags",
    tabs: ["tag-mode", "rules"],
  },
] as const satisfies ReadonlyArray<{
  id: SettingsSectionId;
  labelKey: TranslationKey;
  tabs: readonly SettingsTabId[];
}>;

/** 设置页字段目录首批覆盖当前 AppSettings 字段，供后续 SettingField 组件按类型分派。 */
export const SETTINGS_FIELD_CATALOG = [
  { id: "onboarding", section: "shortcut-language", tab: "onboarding", type: "action", labelKey: "settings.onboarding.title", order: 5 },
  { id: "globalShortcut", section: "shortcut-language", tab: "shortcut", type: "readonly", labelKey: "settings.shortcut.quickOpen", order: 10 },
  { id: "language", section: "shortcut-language", tab: "language", type: "segment", labelKey: "settings.language.current", order: 20 },
  { id: "accessibility", section: "shortcut-language", tab: "permissions", type: "action", labelKey: "settings.accessibility.title", order: 30 },
  { id: "panelDensity", section: "display-panel", tab: "density", type: "segment", labelKey: "settings.display.density", order: 10 },
  { id: "contentDisplayMode", section: "display-panel", tab: "density", type: "segment", labelKey: "settings.display.contentMode", order: 20 },
  { id: "quickItemLimit", section: "display-panel", tab: "density", type: "number", labelKey: "settings.display.quickItemLimit", order: 30 },
  { id: "panelWidth", section: "display-panel", tab: "size", type: "number", labelKey: "settings.display.panelWidth", order: 10 },
  { id: "panelHeight", section: "display-panel", tab: "size", type: "number", labelKey: "settings.display.panelHeight", order: 20 },
  { id: "panelBackgroundOpacity", section: "display-panel", tab: "size", type: "slider", labelKey: "settings.display.backgroundOpacity", order: 30 },
  { id: "positionStrategy", section: "display-panel", tab: "position", type: "segment", labelKey: "settings.display.positionStrategy", order: 10 },
  { id: "enableScrollCollapse", section: "display-panel", tab: "test", type: "switch", labelKey: "settings.display.autoHideDock", order: 10 },
  { id: "fuzzySearchEnabled", section: "capture-content", tab: "search", type: "switch", labelKey: "settings.content.fuzzySearch", order: 10 },
  { id: "pinyinSearchEnabled", section: "capture-content", tab: "search", type: "switch", labelKey: "settings.content.pinyinSearch", order: 20 },
  { id: "enableMarkdownPreview", section: "capture-content", tab: "preview", type: "switch", labelKey: "settings.content.markdownPreview", order: 10 },
  { id: "captureTextEnabled", section: "capture-content", tab: "capture-types", type: "switch", labelKey: "settings.onboarding.capture.text", order: 10 },
  { id: "captureHtmlEnabled", section: "capture-content", tab: "capture-types", type: "switch", labelKey: "settings.onboarding.capture.html", order: 20 },
  { id: "captureRtfEnabled", section: "capture-content", tab: "capture-types", type: "switch", labelKey: "settings.onboarding.capture.rtf", order: 30 },
  { id: "captureImageEnabled", section: "capture-content", tab: "capture-types", type: "switch", labelKey: "settings.onboarding.capture.image", order: 40 },
  { id: "captureFileEnabled", section: "capture-content", tab: "capture-types", type: "switch", labelKey: "settings.onboarding.capture.file", order: 50 },
  { id: "captureSensitiveEnabled", section: "capture-content", tab: "capture-types", type: "switch", labelKey: "settings.onboarding.capture.sensitive", order: 60 },
  { id: "textMaxSizeMb", section: "capture-content", tab: "limits", type: "number", labelKey: "settings.capture.textMaxSize", order: 10 },
  { id: "imageMaxSizeMb", section: "capture-content", tab: "limits", type: "number", labelKey: "settings.capture.imageMaxSize", order: 20 },
  { id: "maxStoredItems", section: "storage-logs", tab: "data", type: "number", labelKey: "settings.storage.maxItems", order: 10 },
  { id: "cleanupEnabled", section: "storage-logs", tab: "cleanup", type: "switch", labelKey: "settings.storage.cleanupEnabled", order: 10 },
  { id: "cleanupIntervalHours", section: "storage-logs", tab: "cleanup", type: "number", labelKey: "settings.storage.cleanupInterval", order: 20 },
  { id: "softDeletedRetentionDays", section: "storage-logs", tab: "cleanup", type: "number", labelKey: "settings.storage.retentionDays", order: 30 },
  { id: "logMaxSizeMb", section: "storage-logs", tab: "logs", type: "number", labelKey: "settings.logs.maxSize", order: 10 },
  { id: "logKeepRatio", section: "storage-logs", tab: "logs", type: "slider", labelKey: "settings.logs.keepRatio", order: 20 },
  { id: "logMaxLines", section: "storage-logs", tab: "logs", type: "number", labelKey: "settings.logs.maxLines", order: 30 },
  { id: "logRetentionDays", section: "storage-logs", tab: "logs", type: "number", labelKey: "settings.logs.retentionDays", order: 40 },
  { id: "logAutoCleanup", section: "storage-logs", tab: "logs", type: "switch", labelKey: "settings.logs.autoCleanup", order: 50 },
  { id: "logCleanupIntervalMin", section: "storage-logs", tab: "logs", type: "number", labelKey: "settings.logs.cleanupInterval", order: 60 },
  { id: "diagnosticsBundle", section: "storage-logs", tab: "diagnostics", type: "action", labelKey: "settings.diagnostics.exportBundle", order: 10 },
  { id: "mcpStatus", section: "mcp-agent", tab: "status", type: "action", labelKey: "settings.mcp.status", order: 10 },
  { id: "agentInstallPrompt", section: "mcp-agent", tab: "install", type: "code", labelKey: "settings.mcp.agentInstallPrompt", order: 10 },
  { id: "jsonRpcExample", section: "mcp-agent", tab: "json-rpc", type: "code", labelKey: "settings.mcp.jsonRpc", order: 10 },
  { id: "agentProviders", section: "mcp-agent", tab: "provider", type: "code", labelKey: "settings.agent.providerTemplate", order: 10 },
  { id: "updateStatus", section: "update-distribution", tab: "version", type: "action", labelKey: "settings.update.title", order: 10 },
  { id: "updateActions", section: "update-distribution", tab: "update-flow", type: "action", labelKey: "settings.update.actions", order: 10 },
  { id: "buildInfo", section: "update-distribution", tab: "build", type: "readonly", labelKey: "settings.update.buildInfo", order: 10 },
  { id: "tagMode", section: "tag-rules", tab: "tag-mode", type: "segment", labelKey: "settings.tags.mode", order: 10 },
  { id: "tagRules", section: "tag-rules", tab: "rules", type: "action", labelKey: "settings.tags.rules", order: 10 },
] as const satisfies readonly SettingFieldConfig[];
