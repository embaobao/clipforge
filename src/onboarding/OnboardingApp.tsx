import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  normalizeLanguagePreference,
  resolveAppLocale,
  setDocumentLocale,
  t,
  type AppLanguagePreference,
} from "../i18n";
import { startPerfSpan } from "../performance-smoke";
import { settingsService } from "../services/settings";
import { SettingsSectionFallback } from "../settings/components/SettingsSectionFallback";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { logOnboardingEvent } from "./onboarding-log";

type OnboardingSettings = {
  language: AppLanguagePreference;
  onboardingCompleted: boolean;
  captureTextEnabled: boolean;
  captureHtmlEnabled: boolean;
  captureRtfEnabled: boolean;
  captureImageEnabled: boolean;
  captureFileEnabled: boolean;
  captureSensitiveEnabled: boolean;
  globalShortcut: string;
};

type OnboardingAccessibility = {
  canReadFocusedInput: boolean;
  status: "granted" | "missing" | "denied" | "unsupported";
  message: string;
};

const DEFAULT_ONBOARDING_SETTINGS: OnboardingSettings = {
  language: "system",
  onboardingCompleted: false,
  captureTextEnabled: true,
  captureHtmlEnabled: true,
  captureRtfEnabled: true,
  captureImageEnabled: true,
  captureFileEnabled: true,
  captureSensitiveEnabled: false,
  globalShortcut: "Control+V",
};

function normalizeOnboardingSettings(raw: Record<string, unknown>): OnboardingSettings {
  return {
    ...DEFAULT_ONBOARDING_SETTINGS,
    ...raw,
    language: normalizeLanguagePreference(raw.language),
    onboardingCompleted:
      typeof raw.onboardingCompleted === "boolean"
        ? raw.onboardingCompleted
        : DEFAULT_ONBOARDING_SETTINGS.onboardingCompleted,
  };
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** 独立引导窗口：复用 Settings Service，不依赖设置页 tab 或 sidebar 框架。
 *  日志走 onboarding-window 模块四事件（open/step/complete/permission.check）；
 *  可重试错误（加载/权限检测/保存失败）以步骤内错误条呈现，与底部权限提示行分离。 */
export function OnboardingApp() {
  const [settings, setSettings] = useState<OnboardingSettings>(DEFAULT_ONBOARDING_SETTINGS);
  const [accessibility, setAccessibility] = useState<OnboardingAccessibility | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; retry?: () => void } | null>(null);
  const locale = resolveAppLocale(settings.language);
  const tr = (key: Parameters<typeof t>[1], params?: Record<string, string | number>) =>
    t(locale, key, params);

  useEffect(() => {
    setDocumentLocale(locale);
  }, [locale]);

  useEffect(() => {
    let alive = true;
    // onboarding.open：窗口打开 → 初始数据就绪（含权限首次检测），perf 与事件日志同点收口。
    const finishOpenPerf = startPerfSpan("onboarding.open");
    async function load() {
      try {
        const [document, permission] = await Promise.all([
          settingsService.get(false),
          invoke<OnboardingAccessibility>("check_accessibility_permission"),
        ]);
        if (!alive) return;
        setSettings(normalizeOnboardingSettings(document.settings));
        setAccessibility(permission);
        setStatus(permission.message);
        setError(null);
        logOnboardingEvent("onboarding.permission.check", { source: "initial", status: permission.status });
      } catch (error) {
        if (!alive) return;
        setError({ message: formatError(error), retry: () => void load() });
      } finally {
        if (alive) {
          setLoading(false);
          finishOpenPerf();
          logOnboardingEvent("onboarding.open");
        }
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, []);

  async function refreshAccessibilityStatus() {
    try {
      const permission = await invoke<OnboardingAccessibility>("check_accessibility_permission");
      setAccessibility(permission);
      setStatus(permission.message);
      setError(null);
      logOnboardingEvent("onboarding.permission.check", { source: "refresh", status: permission.status });
    } catch (error) {
      setError({ message: formatError(error), retry: () => void refreshAccessibilityStatus() });
    }
  }

  async function openAccessibilitySettings() {
    try {
      await invoke("open_accessibility_settings");
      await refreshAccessibilityStatus();
    } catch (error) {
      setError({ message: formatError(error), retry: () => void openAccessibilitySettings() });
    }
  }

  async function updateSettings(next: Partial<OnboardingSettings>) {
    const merged = { ...settings, ...next };
    setSettings(merged);
    try {
      const response = await settingsService.patch({
        actor: "settings-window",
        patch: next,
        reason: "onboarding-window",
      });
      setSettings(normalizeOnboardingSettings(response.settings));
      setStatus(tr("settings.status.configSynced"));
      setError(null);
      if (next.onboardingCompleted) {
        logOnboardingEvent("onboarding.complete", { mode: settings.onboardingCompleted ? "done" : "finish" });
        window.setTimeout(() => {
          void getCurrentWindow().close();
        }, 180);
      }
    } catch (error) {
      setError({ message: formatError(error), retry: () => void updateSettings(next) });
    }
  }

  if (loading) {
    return (
      <main className="flex h-dvh min-h-0 flex-col items-center justify-start overflow-x-hidden overflow-y-auto bg-background" data-surface="onboarding">
        <SettingsSectionFallback
          className="flex-1"
          title={tr("settings.status.loading")}
          tone="loading"
        />
      </main>
    );
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col items-center justify-start overflow-x-hidden overflow-y-auto bg-background" data-surface="onboarding">
      {error ? (
        <SettingsSectionFallback
          actionLabel={error.retry ? tr("settings.error.retry") : undefined}
          description={error.message}
          onAction={error.retry}
          title={tr("settings.error.pageTitle")}
          tone="error"
        />
      ) : (
        <OnboardingWizard
          accessibility={accessibility}
          onStepChange={(stepKey) => logOnboardingEvent("onboarding.step", { step: stepKey })}
          openAccessibilitySettings={openAccessibilitySettings}
          refreshAccessibilityStatus={refreshAccessibilityStatus}
          settings={settings}
          tr={tr}
          updateSettings={(next) => {
            void updateSettings(next);
          }}
        />
      )}
      {!error && status ? <p className="mono mt-4 text-[11px] text-muted-foreground">{status}</p> : null}
    </main>
  );
}
