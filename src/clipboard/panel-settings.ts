/** 面板设置域（从 App.tsx 切出）：默认设置、宽松合并归一化、本地读取与按设置重打标签。
 *  边界：AppSettings/ClipItem 类型从 App 引入（type-only）；数值钳制 clampNumber 复用 clip-model。 */
import type { ClipItem } from "../App";
import type { AppSettings } from "../App";
import { normalizeLanguagePreference } from "../i18n";
import { analyzeContent, clampNumber, detectKind, generateTags, normalizeTagList } from "./clip-model";

export const LEGACY_DEFAULT_SHORTCUT = "CommandOrControl+Shift+V";
export const DEFAULT_SHORTCUT = "Control+V";
export const DEFAULT_PANEL_HEIGHT = 400;


export const defaultSettings: AppSettings = {
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


export function loadLocalSettings(): AppSettings {
  return defaultSettings;
}


export function mergeSettings(value: Partial<AppSettings> | null | undefined): AppSettings {
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


export function retagClips(clips: ClipItem[], settings: AppSettings) {
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
