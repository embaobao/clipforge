/** 设置窗口「快捷键与语言」section：引导入口、快捷键展示/录制/手填、语言切换、辅助功能与登录启动。
 *  从 settings.tsx 主体切出的展示组件；状态与动作经 props 注入，不直接持有副作用。 */
import { RefreshCw, RotateCcw, Settings, ShieldCheck } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import type { AppLanguagePreference, TranslationKey } from "../../i18n";
import { Input } from "@/components/ui/input";
import { SegmentSetting, SettingGroup } from "../controls";
import { OnboardingEntryCard } from "../components/OnboardingEntryCard";
import { SettingsStatusPanel } from "../components/SettingsStatusPanel";
import type {
  AccessibilityDiagnosticsPayload,
  AccessibilityPermissionPayload,
  AppSettings,
  LaunchAtLoginPayload,
} from "../settings-model";
import type { SettingsTabId } from "../settings-field-catalog";

export type ShortcutLanguageSectionProps = {
  state: {
    accessibility: AccessibilityPermissionPayload | null;
    accessibilityDiagnostics: AccessibilityDiagnosticsPayload | null;
    launchAtLogin: LaunchAtLoginPayload | null;
    settings: Pick<AppSettings, "onboardingCompleted" | "globalShortcut" | "language">;
  };
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  updateSettings: (next: Partial<AppSettings>) => void;
  recording: boolean;
  setRecording: (v: boolean) => void;
  manualShortcutId: string;
  dangerConfirmation: string | null;
  setDangerConfirmation: React.Dispatch<React.SetStateAction<string | null>>;
  openAccessibilitySettings: () => void | Promise<void>;
  refreshAccessibilityStatus: () => void | Promise<void>;
  resetAccessibilityPermission: () => void | Promise<void>;
  setLaunchAtLoginEnabled: (enabled: boolean) => Promise<void> | void;
  renderTabs: (panels: Partial<Record<SettingsTabId, ReactNode>>) => ReactNode;
};

/** 快捷键与语言 section（onboarding/shortcut/language/permissions 四个 tab）。 */
export function ShortcutLanguageSection({
  state,
  tr,
  updateSettings,
  recording,
  setRecording,
  manualShortcutId,
  dangerConfirmation,
  setDangerConfirmation,
  openAccessibilitySettings,
  refreshAccessibilityStatus,
  resetAccessibilityPermission,
  setLaunchAtLoginEnabled,
  renderTabs,
}: ShortcutLanguageSectionProps) {
  return renderTabs({
    onboarding: (
      <OnboardingEntryCard
        accessibility={state.accessibility}
        completed={state.settings.onboardingCompleted}
        onOpen={() => invoke("open_onboarding_window")}
        tr={tr}
      />
    ),
    shortcut: (
      <SettingGroup title={tr("settings.section.shortcut")}>
        <div className="flex items-center justify-between gap-8 py-3">
          <div className="min-w-0">
            <p className="text-[13px]">{tr("settings.shortcut.quickOpen")}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="mono rounded-md bg-black/[0.05] px-2 py-1 text-[11.5px] dark:bg-white/[0.08]">
              {state.settings.globalShortcut.replace("Control", "⌃").replace("Meta", "⌘").replace("Shift", "⇧").replace("Alt", "⌥")}
            </span>
            <button
              className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
              onClick={() => setRecording(true)}
              onKeyDown={(event) => {
                if (!recording) return;
                event.preventDefault();
              }}
              type="button"
            >
              {recording ? tr("settings.shortcut.recording") : tr("settings.shortcut.startRecording")}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-8 py-3">
          <div className="min-w-0">
            <label className="text-[13px]" htmlFor={manualShortcutId}>
              {tr("settings.shortcut.manual")}
            </label>
          </div>
          <Input
            id={manualShortcutId}
            className="h-7 w-32 rounded-md text-[13px]"
            onChange={(event) =>
              updateSettings({ globalShortcut: event.currentTarget.value })
            }
            value={state.settings.globalShortcut}
          />
        </div>
      </SettingGroup>
    ),
    language: (
      <SettingGroup title={tr("settings.language.title")}>
        <div className="flex items-center justify-between gap-8 py-3">
          <span>{tr("settings.language.current")}</span>
          <SegmentSetting
            label={tr("settings.language.current")}
            options={(["system", "zh-CN", "en-US"] as AppLanguagePreference[]).map((value) => ({
              value,
              label:
                value === "system"
                  ? tr("settings.language.system")
                  : value === "zh-CN"
                    ? tr("settings.language.zh")
                    : tr("settings.language.en"),
            }))}
            selected={state.settings.language}
            onChange={(language) => updateSettings({ language })}
          />
        </div>
      </SettingGroup>
    ),
    permissions: (
      <SettingGroup title={tr("settings.accessibility.title")}>
        <SettingsStatusPanel
          actions={[
            {
              label: tr("settings.accessibility.action.request"),
              onClick: openAccessibilitySettings,
              icon: ShieldCheck,
              variant: "primary",
              tooltip: tr("settings.accessibility.action.request"),
            },
            {
              label: tr("settings.accessibility.action.refresh"),
              onClick: refreshAccessibilityStatus,
              icon: RefreshCw,
              variant: "secondary",
              tooltip: tr("settings.accessibility.action.refresh"),
            },
            {
              label:
                dangerConfirmation === "resetAccessibility"
                  ? tr("settings.confirm.again")
                  : tr("settings.accessibility.action.reset"),
              onClick: () => {
                if (dangerConfirmation === "resetAccessibility") {
                  void resetAccessibilityPermission();
                  return;
                }
                setDangerConfirmation("resetAccessibility");
              },
              icon: RotateCcw,
              variant: "destructive",
              tooltip: tr("settings.accessibility.action.reset"),
              ariaLabel:
                dangerConfirmation === "resetAccessibility"
                  ? tr("settings.confirm.actionAgain", { action: tr("settings.accessibility.action.reset") })
                  : tr("settings.accessibility.action.reset"),
            },
          ]}
          description={state.accessibility?.message ?? tr("settings.accessibility.description")}
          state={state.accessibility?.canReadFocusedInput ? "good" : "warning"}
          status={
            state.accessibility?.canReadFocusedInput
              ? tr("settings.accessibility.status.granted")
              : tr("settings.accessibility.status.missing")
          }
          title={tr("settings.accessibility.title")}
        >
          {state.accessibilityDiagnostics ? (
            <div className="space-y-2 text-[12px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{tr("settings.accessibility.currentProcess")}</span>
                <strong className="font-medium">{state.accessibilityDiagnostics.trusted ? "trusted" : "missing"}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bundle ID</span>
                <code className="mono text-[11px]">{state.accessibilityDiagnostics.expectedBundleIdentifier}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{tr("settings.accessibility.signatureId")}</span>
                <code className="mono text-[11px]">{state.accessibilityDiagnostics.codeSignatureIdentifier || "unknown"}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{tr("settings.accessibility.signatureKind")}</span>
                <code className="mono text-[11px]">{state.accessibilityDiagnostics.signatureKind || "unknown"}</code>
              </div>
              <p className="mono truncate text-[11px] text-muted-foreground">{state.accessibilityDiagnostics.appBundlePath || state.accessibilityDiagnostics.executablePath}</p>
              {state.accessibilityDiagnostics.tccRecords.length > 0 ? (
                <div className="space-y-1 border-t border-black/[0.04] pt-2 dark:border-white/[0.06]">
                  {state.accessibilityDiagnostics.tccRecords.map((record) => (
                    <p className="flex gap-2 text-[11px] text-muted-foreground" key={`${record.client}:${record.lastModified}`}>
                      <span>{record.database}</span>
                      <code className="mono">{record.client}</code>
                      <span>{record.authLabel}</span>
                      <span>{record.csreqSummary}</span>
                      <span>{record.lastModified}</span>
                    </p>
                  ))}
                </div>
              ) : (
                <p>{tr("settings.accessibility.noTccRecord")}</p>
              )}
              {state.accessibilityDiagnostics.tccQueryError ? (
                <p>{tr("settings.accessibility.tccQueryFailed", { error: state.accessibilityDiagnostics.tccQueryError })}</p>
              ) : null}
            </div>
          ) : null}
        </SettingsStatusPanel>
        <SettingsStatusPanel
          actions={[
            {
              label: state.launchAtLogin?.enabled
                ? tr("settings.system.launchAtLogin.disable")
                : tr("settings.system.launchAtLogin.enable"),
              onClick: () => void setLaunchAtLoginEnabled(!state.launchAtLogin?.enabled),
              icon: Settings,
              variant: state.launchAtLogin?.enabled ? "secondary" : "primary",
              tooltip: state.launchAtLogin?.enabled
                ? tr("settings.system.launchAtLogin.disable")
                : tr("settings.system.launchAtLogin.enable"),
            },
          ]}
          description={state.launchAtLogin?.message ?? tr("settings.system.launchAtLogin.description")}
          state={state.launchAtLogin?.enabled ? "good" : "warning"}
          status={
            state.launchAtLogin?.enabled
              ? tr("settings.system.launchAtLogin.enabled")
              : tr("settings.system.launchAtLogin.disabled")
          }
          title={tr("settings.system.launchAtLogin.title")}
        />
      </SettingGroup>
    ),
  });
}
