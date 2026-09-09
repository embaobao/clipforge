/** 剪贴板保留策略清理调度 hook（从 App.tsx 切出）：启动延迟 60s 后首跑，此后按 cleanupIntervalHours 循环。
 *  边界：仅调度与调用 cleanup_clip_records，不处理清理结果对列表的影响（列表刷新由事件驱动）。 */
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import type { AppSettings } from "../App";
import { logAppError } from "./panel-shared";

/** 浏览器定时器最大安全延时（超长间隔分段调度）。 */
export const MAX_BROWSER_TIMER_DELAY_MS = 2_147_000_000;
/** 启动后首跑清理的延迟。 */
export const CLEANUP_STARTUP_DELAY_MS = 60_000;

type CleanupClipPayload = {
  hardDeleted: number;
  retentionHardDeleted: number;
  overflowHardDeleted: number;
  ranAt: number;
};

export type CleanupSchedulerOptions = {
  isSettingsWindow: boolean;
  settings: Pick<AppSettings, "cleanupEnabled" | "cleanupIntervalHours" | "maxStoredItems" | "softDeletedRetentionDays">;
};

export function useCleanupScheduler({ isSettingsWindow, settings }: CleanupSchedulerOptions) {
  useEffect(() => {
    if (isSettingsWindow) return;
    if (!settings.cleanupEnabled) return;
    let timer = 0;
    let disposed = false;
    let cleanupRunning = false;
    const intervalMs = Math.max(1, settings.cleanupIntervalHours) * 60 * 60 * 1000;
    const scheduleNext = (delayMs: number) => {
      if (disposed) return;
      const safeDelayMs = Math.min(Math.max(0, delayMs), MAX_BROWSER_TIMER_DELAY_MS);
      timer = window.setTimeout(() => {
        if (delayMs > MAX_BROWSER_TIMER_DELAY_MS) {
          scheduleNext(delayMs - MAX_BROWSER_TIMER_DELAY_MS);
          return;
        }
        runCleanup();
      }, safeDelayMs);
    };
    const runCleanup = () => {
      if (disposed || cleanupRunning) return;
      cleanupRunning = true;
      invoke<CleanupClipPayload>("cleanup_clip_records", {
        retentionDays: settings.softDeletedRetentionDays,
        maxActiveItems: settings.maxStoredItems,
      })
        .then((payload) => {
          if (payload.hardDeleted > 0) {
            logAppError("info", "Cleanup completed", payload);
          }
        })
        .catch((error) => logAppError("warn", "Cleanup failed", String(error)))
        .finally(() => {
          cleanupRunning = false;
          scheduleNext(intervalMs);
        });
    };
    scheduleNext(CLEANUP_STARTUP_DELAY_MS);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [isSettingsWindow, settings.cleanupEnabled, settings.cleanupIntervalHours, settings.maxStoredItems, settings.softDeletedRetentionDays]);
}
