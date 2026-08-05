import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Loader2 } from "lucide-react";
import {
  normalizeLanguagePreference,
  resolveAppLocale,
  setDocumentLocale,
  t,
  type AppLanguagePreference,
} from "../i18n";
import { settingsService } from "../services/settings";
import { OnboardingWizard } from "../settings/onboarding-wizard";

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

/** 独立引导窗口：复用 Settings Service，不依赖设置页 tab 或 sidebar 框架。 */
export function OnboardingApp() {
  const [settings, setSettings] = useState<OnboardingSettings>(DEFAULT_ONBOARDING_SETTINGS);
  const [accessibility, setAccessibility] = useState<OnboardingAccessibility | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const locale = resolveAppLocale(settings.language);
  const tr = (key: Parameters<typeof t>[1], params?: Record<string, string | number>) =>
    t(locale, key, params);

  useEffect(() => {
    setDocumentLocale(locale);
  }, [locale]);

  useEffect(() => {
    let alive = true;
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
      } catch (error) {
        if (!alive) return;
        setStatus(formatError(error));
      } finally {
        if (alive) setLoading(false);
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
    } catch (error) {
      setStatus(formatError(error));
    }
  }

  async function openAccessibilitySettings() {
    try {
      await invoke("open_accessibility_settings");
      await refreshAccessibilityStatus();
    } catch (error) {
      setStatus(formatError(error));
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
      if (next.onboardingCompleted) {
        window.setTimeout(() => {
          void getCurrentWindow().close();
        }, 180);
      }
    } catch (error) {
      setStatus(formatError(error));
    }
  }

  if (loading) {
    return (
      <main className="onboarding-standalone-shell" data-surface="onboarding">
        <div className="onboarding-loading" role="status">
          <Loader2 size={18} />
          <span>{tr("settings.status.loading")}</span>
        </div>
      </main>
    );
  }

  return (
    <main className="onboarding-standalone-shell" data-surface="onboarding">
      <OnboardingWizard
        accessibility={accessibility}
        openAccessibilitySettings={openAccessibilitySettings}
        refreshAccessibilityStatus={refreshAccessibilityStatus}
        settings={settings}
        tr={tr}
        updateSettings={(next) => {
          void updateSettings(next);
        }}
      />
      {status ? <p className="onboarding-standalone-status">{status}</p> : null}
    </main>
  );
}
