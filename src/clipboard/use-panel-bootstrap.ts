/** 面板启动引导 hook（从 App.tsx 切出）：权限检查、数据库初始化、首屏列表加载与新手示例种子。
 *  边界：read_user_settings 由 useSettingsSync 负责；本 hook 只管「库就绪 → 拉首屏 → 空库播种」。 */
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import type { ClipItem } from "../App";
import type { AppSettings } from "../App";
import type { TranslationKey } from "../i18n";
import { isCaptureClipPayload, isQueryClipPayload, type CaptureClipPayload, type QueryClipPayload } from "./use-clipboard-list";
import { logAppError } from "./panel-shared";

interface AccessibilityPermissionPayload {
  canReadFocusedInput: boolean;
  status: "granted" | "missing" | "denied" | "unsupported";
  message: string;
}

interface DbInitPayload {
  path: string;
  schemaVersion: number;
}

/** 新手示例内容（空库首次启动播种用）。 */
export function getStarterSampleContent(tr: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  return [
    tr("main.sample.title"),
    "",
    tr("main.sample.description"),
    tr("main.sample.shortcut.open"),
    tr("main.sample.shortcut.paste"),
    tr("main.sample.shortcut.favorite"),
    tr("main.sample.shortcut.delete"),
    tr("main.sample.shortcut.detail"),
    "",
    "https://ui.shadcn.com/docs/components/base/dropdown-menu",
  ].join("\n");
}

export type PanelBootstrapOptions = {
  isSettingsWindow: boolean;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  settingsRef: { current: AppSettings };
  setClips: React.Dispatch<React.SetStateAction<ClipItem[]>>;
  clipsRef: { current: ClipItem[] };
  setSelectedId: (id: string) => void;
  setNextCursor: (cursor: string | null) => void;
  setNativeStatus: (status: string) => void;
  normalizeClip: (raw: Partial<ClipItem>, settings: AppSettings) => ClipItem | null;
};

/** 启动引导：check_accessibility_permission 提示 + init_clip_database 后加载首屏（空库播种示例条目）。 */
export function usePanelBootstrap({
  isSettingsWindow,
  tr,
  settingsRef,
  setClips,
  clipsRef,
  setSelectedId,
  setNextCursor,
  setNativeStatus,
  normalizeClip,
}: PanelBootstrapOptions) {
  useEffect(() => {
    let cancelled = false;
    invoke<AccessibilityPermissionPayload>("check_accessibility_permission")
      .then((payload) => {
        if (cancelled) return;
        if (!payload.canReadFocusedInput) {
          setNativeStatus(tr("main.status.accessibilityMissing"));
        }
      })
      .catch((error) => logAppError("warn", "Check accessibility permission failed", String(error)));
    invoke<DbInitPayload>("init_clip_database")
      .then((payload) => {
        if (cancelled) return;
        logAppError("info", `Clip database ready at ${payload.path}`);
        if (isSettingsWindow) return null;
        return invoke<QueryClipPayload>("search_clip_records", {
          input: {
            bucket: "all",
            limit: 200,
          },
        });
      })
      .then(async (payload) => {
        if (!payload || cancelled || isSettingsWindow) return;
        if (!isQueryClipPayload(payload)) throw new Error("Invalid search_clip_records payload");
        let items = payload.items
          .map((item) => normalizeClip(item, settingsRef.current))
          .filter((item): item is ClipItem => Boolean(item));
        if (!items.length) {
          try {
            const seedPayload = await invoke<CaptureClipPayload>("capture_clip_record", {
              content: getStarterSampleContent(tr),
              sourceLabel: "ClipForge",
              observedAt: Date.now(),
            });
            if (!isCaptureClipPayload(seedPayload)) throw new Error("Invalid capture_clip_record payload");
            const seedItem = normalizeClip(seedPayload.item, settingsRef.current);
            if (seedItem) {
              items = [seedItem];
              setSelectedId(seedItem.id);
              logAppError("info", "starter-sample: seeded intro clip", { id: seedItem.id });
            }
          } catch (error) {
            logAppError("warn", "Seed starter sample clip failed", String(error));
          }
        }
        if (cancelled) return;
        setClips(items);
        clipsRef.current = items;
        setNextCursor(items.length === payload.items.length ? (payload.nextCursor ?? null) : null);
        logAppError("info", "clip-list: initialized from database", {
          itemCount: items.length,
          rawCount: payload.items.length,
          hasMore: Boolean(payload.nextCursor),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        logAppError("error", "Initialize clip database failed", String(error));
        setNativeStatus(tr("main.status.databaseInitFailed"));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSettingsWindow, tr]);
}
