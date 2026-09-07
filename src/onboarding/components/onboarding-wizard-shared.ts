import type { KeyboardEvent } from "react";
import { Bot, ClipboardList, Heart, Search, Trash2 } from "lucide-react";
import type { TranslationKey } from "../../i18n";

export type OnboardingStepKey = "welcome" | "accessibility" | "capture" | "shortcut" | "tour";

export interface OnboardingSettings {
  onboardingCompleted: boolean;
  captureTextEnabled: boolean;
  captureHtmlEnabled: boolean;
  captureRtfEnabled: boolean;
  captureImageEnabled: boolean;
  captureFileEnabled: boolean;
  captureSensitiveEnabled: boolean;
  globalShortcut: string;
}

export interface OnboardingAccessibility {
  canReadFocusedInput: boolean;
  status: "granted" | "missing" | "denied" | "unsupported";
  message: string;
}

/** 设置引导组件的入参：只复用调用方已有状态与写入能力，不直接调用 Tauri 命令。 */
export interface OnboardingWizardProps {
  settings: OnboardingSettings;
  updateSettings: (next: Partial<OnboardingSettings>) => void;
  accessibility: OnboardingAccessibility | null;
  openAccessibilitySettings: () => void | Promise<void>;
  refreshAccessibilityStatus: () => void | Promise<void>;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export const STEPS: Array<{ key: OnboardingStepKey; titleKey: TranslationKey; descriptionKey: TranslationKey }> = [
  {
    key: "welcome",
    titleKey: "settings.onboarding.step.welcome.title",
    descriptionKey: "settings.onboarding.step.welcome.description",
  },
  {
    key: "accessibility",
    titleKey: "settings.onboarding.step.accessibility.title",
    descriptionKey: "settings.onboarding.step.accessibility.description",
  },
  {
    key: "capture",
    titleKey: "settings.onboarding.step.capture.title",
    descriptionKey: "settings.onboarding.step.capture.description",
  },
  {
    key: "shortcut",
    titleKey: "settings.onboarding.step.shortcut.title",
    descriptionKey: "settings.onboarding.step.shortcut.description",
  },
  {
    key: "tour",
    titleKey: "settings.onboarding.step.tour.title",
    descriptionKey: "settings.onboarding.step.tour.description",
  },
];

export const CAPTURE_FIELDS: Array<{
  key: keyof Pick<
    OnboardingSettings,
    | "captureTextEnabled"
    | "captureHtmlEnabled"
    | "captureRtfEnabled"
    | "captureImageEnabled"
    | "captureFileEnabled"
    | "captureSensitiveEnabled"
  >;
  labelKey: TranslationKey;
}> = [
  { key: "captureTextEnabled", labelKey: "settings.onboarding.capture.text" },
  { key: "captureHtmlEnabled", labelKey: "settings.onboarding.capture.html" },
  { key: "captureRtfEnabled", labelKey: "settings.onboarding.capture.rtf" },
  { key: "captureImageEnabled", labelKey: "settings.onboarding.capture.image" },
  { key: "captureFileEnabled", labelKey: "settings.onboarding.capture.file" },
  { key: "captureSensitiveEnabled", labelKey: "settings.onboarding.capture.sensitive" },
];

/** 功能速览卡片配置（tour 步渲染）。 */
export const FEATURE_CARDS: Array<{ icon: typeof ClipboardList; titleKey: TranslationKey; bodyKey: TranslationKey }> = [
  {
    icon: Search,
    titleKey: "settings.onboarding.feature.search.title",
    bodyKey: "settings.onboarding.feature.search.body",
  },
  {
    icon: Heart,
    titleKey: "settings.onboarding.feature.favorite.title",
    bodyKey: "settings.onboarding.feature.favorite.body",
  },
  {
    icon: Trash2,
    titleKey: "settings.onboarding.feature.trash.title",
    bodyKey: "settings.onboarding.feature.trash.body",
  },
  {
    icon: Bot,
    titleKey: "settings.onboarding.feature.agent.title",
    bodyKey: "settings.onboarding.feature.agent.body",
  },
];

/** 权限状态的展示文案 key：loading/授权/拒绝/不支持/未授权。 */
export function getAccessibilityStatusKey(accessibility: OnboardingAccessibility | null): TranslationKey {
  if (!accessibility) return "settings.onboarding.accessibility.status.loading";
  if (accessibility.canReadFocusedInput || accessibility.status === "granted") {
    return "settings.onboarding.accessibility.status.granted";
  }
  if (accessibility.status === "denied") return "settings.onboarding.accessibility.status.denied";
  if (accessibility.status === "unsupported") return "settings.onboarding.accessibility.status.unsupported";
  return "settings.onboarding.accessibility.status.missing";
}

/** 权限状态的视觉分级：已授权绿色、拒绝/缺失琥珀色、加载与不支持中性灰。 */
export function getAccessibilityStatusClass(accessibility: OnboardingAccessibility | null): string {
  if (!accessibility) return "border-border/60 bg-black/[0.02] text-muted-foreground dark:bg-white/[0.04]";
  if (accessibility.canReadFocusedInput || accessibility.status === "granted") {
    return "border-emerald-500/25 bg-emerald-500/[0.05] text-emerald-700 dark:text-emerald-400";
  }
  if (accessibility.status === "denied" || accessibility.status === "missing") {
    return "border-amber-500/25 bg-amber-500/[0.05] text-amber-700 dark:text-amber-400";
  }
  return "border-border/60 bg-black/[0.02] text-muted-foreground dark:bg-white/[0.04]";
}

/** 焦点是否落在可编辑控件上（用于向导容器键盘导航的避让判断）。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || target.isContentEditable;
}

/** 把按键事件格式化为快捷键字符串（如 Command+Shift+V）；单独按修饰键返回 null。 */
export function formatRecordedShortcut(event: KeyboardEvent<HTMLElement>): string | null {
  const key = event.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return null;
  const parts: string[] = [];
  if (event.metaKey) parts.push("Command");
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Option");
  if (event.shiftKey) parts.push("Shift");
  const normalizedKey =
    key === " "
      ? "Space"
      : key.length === 1
        ? key.toUpperCase()
        : key.replace(/^Arrow/, "");
  if (!parts.includes(normalizedKey)) parts.push(normalizedKey);
  return parts.join("+");
}
