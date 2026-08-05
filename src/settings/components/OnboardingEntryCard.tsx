import { ExternalLink } from "lucide-react";
import type { TranslationKey } from "@/i18n";
import { SettingsStatusPanel } from "./SettingsStatusPanel";

export type OnboardingEntryCardAccessibility = {
  canReadFocusedInput: boolean;
  status: "granted" | "missing" | "denied" | "unsupported";
  message: string;
} | null;

/** 独立引导入口参数：设置页只展示状态与打开动作，不承载完整向导流程。 */
export interface OnboardingEntryCardProps {
  accessibility: OnboardingEntryCardAccessibility;
  completed: boolean;
  onOpen: () => void | Promise<void>;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

/** 设置页轻量入口：把首次引导交给独立 onboarding 窗口，避免设置页 tab 变成嵌入式向导。 */
export function OnboardingEntryCard({ accessibility, completed, onOpen, tr }: OnboardingEntryCardProps) {
  const hasAccessibility = Boolean(accessibility?.canReadFocusedInput);
  const status = completed
    ? tr("settings.onboarding.completed.badge")
    : hasAccessibility
      ? tr("settings.accessibility.status.granted")
      : tr("settings.accessibility.status.missing");

  return (
    <SettingsStatusPanel
      actions={[
        {
          icon: ExternalLink,
          label: tr("settings.onboarding.action.open"),
          onClick: onOpen,
          probeId: "settings-open-onboarding",
          tooltip: tr("settings.onboarding.action.open"),
          variant: "primary",
        },
      ]}
      description={completed ? tr("settings.onboarding.completed.description") : tr("settings.onboarding.description")}
      items={[
        {
          label: tr("settings.accessibility.title"),
          value: hasAccessibility
            ? tr("settings.accessibility.status.granted")
            : (accessibility?.message ?? tr("settings.accessibility.status.missing")),
        },
      ]}
      probeId="settings-onboarding-entry"
      state={completed || hasAccessibility ? "good" : "warning"}
      status={status}
      title={tr("settings.onboarding.title")}
    />
  );
}
