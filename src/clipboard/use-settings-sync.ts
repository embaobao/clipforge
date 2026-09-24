/** 设置同步域 hook（从 App.tsx 切出）：settings 变化的防抖持久化、窗口标题同步、启动时读取远端配置。
 *  边界：mergeSettings/retagClips 由调用方注入（它们的默认值链留在主体）；三个持久化私有 refs 随本 hook。 */
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ClipItem } from "../App";
import type { AppSettings } from "../App";
import { resolveAppLocale, setDocumentLocale, t } from "../i18n";
import { getCurrentWindowSafe, logAppError } from "./panel-shared";

type UserSettingsPayload = {
  path: string;
  settings: Partial<AppSettings>;
};

export type SettingsSyncOptions = {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  setClips: Dispatch<SetStateAction<ClipItem[]>>;
  settingsRef: { current: AppSettings };
  isSettingsWindow: boolean;
  /** URL ?lang= 固定语言（悬浮窗验证器/截图脚本）：启动读取配置后仍强制覆盖，不被持久化值冲掉。 */
  urlLanguage: AppSettings["language"] | null;
  mergeSettings: (value: Partial<AppSettings> | null | undefined) => AppSettings;
  retagClips: (clips: ClipItem[], settings: AppSettings) => ClipItem[];
};

/** 设置同步：settings 每次变化同步 settingsRef/标题并防抖写盘；挂载时 read_user_settings 一次并应用。 */
export function useSettingsSync({
  settings,
  setSettings,
  setClips,
  settingsRef,
  isSettingsWindow,
  urlLanguage,
  mergeSettings,
  retagClips,
}: SettingsSyncOptions) {
  const skipNextSettingsPersistRef = useRef(false);
  const configReadyRef = useRef(false);
  const configWriteTimerRef = useRef<number | null>(null);

  // settings 变化：同步 ref/文档标题/窗口标题；configReady 后防抖 220ms 写盘。
  useEffect(() => {
    settingsRef.current = settings;
    const locale = resolveAppLocale(settings.language);
    setDocumentLocale(locale);
    window.document.title = t(locale, "window.main.title");
    // 浏览器预览无 Tauri 窗口对象；同步 getCurrentWindow() 会抛错并触发重挂载死循环。
    const appWindow = getCurrentWindowSafe();
    if (appWindow) {
      void appWindow.setTitle(t(locale, "window.main.title")).catch((error) =>
        logAppError("warn", "Set main window title failed", String(error)),
      );
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // 挂载时读取持久化配置：标记跳过首轮写盘、同步 ref/state，并按新设置重打标签。
  useEffect(() => {
    let cancelled = false;
    invoke<UserSettingsPayload>("read_user_settings")
      .then((payload) => {
        if (cancelled) return;
        const merged = mergeSettings(payload?.settings);
        // URL ?lang= 优先：验证器固定语言时，远端配置读到 system 也不能覆盖 URL 指定值。
        const next = urlLanguage ? { ...merged, language: urlLanguage } : merged;
        skipNextSettingsPersistRef.current = true;
        configReadyRef.current = true;
        settingsRef.current = next;
        setSettings(next);
        if (!isSettingsWindow) {
          setClips((items) => retagClips(items, next).slice(0, next.maxStoredItems));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSettingsWindow]);
}
