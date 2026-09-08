/** 快速面板环境副作用 hook：全局错误上报、辅助功能提示监听、activeView 本地持久化（从 App.tsx 叶子 effect 切出）。 */
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { getErrorDiagnostics, getFrontendEnvironmentSnapshot } from "../frontend-diagnostics";
import type { TranslationKey } from "../i18n";
import { logAppError } from "./panel-shared";

/** activeView 的 localStorage 键（跨启动恢复上次视图）。 */
export const ACTIVE_VIEW_STORAGE_KEY = "clipforge.active-view.v1";

interface AccessibilityFirstPromptPayload {
  status: "granted" | "missing" | "unsupported" | "error";
  message: string;
  prompted: boolean;
  createdAt: number;
}

export type PanelEnvironmentOptions = {
  /** 当前视图（history/favorites/trash），变化时写 localStorage。 */
  activeView: string;
  /** 状态栏文案写入器（复用主体的 nativeStatus state）。 */
  setNativeStatus: (status: string) => void;
  /** 翻译函数（i18n）。 */
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

/**
 * 面板环境副作用集合：
 * - window.error / unhandledrejection 全量上报（含前端环境快照）
 * - clipforge://accessibility-first-prompt 事件 → 状态栏文案
 * - activeView 变化写 localStorage
 * 边界：只做「监听 + 记录 + 持久化」，不触碰剪贴板采集/写回热路径。
 */
export function usePanelEnvironmentEffects({ activeView, setNativeStatus, tr }: PanelEnvironmentOptions) {
  // 全局错误监听：挂载即注册，与组件状态无依赖。
  useEffect(() => {
    logAppError("info", "frontend-environment", getFrontendEnvironmentSnapshot());

    const onError = (event: ErrorEvent) => {
      logAppError("error", event.message, {
        event: "window.error",
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        ...getErrorDiagnostics(event.error ?? event.message),
        frontend: getFrontendEnvironmentSnapshot(),
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      logAppError("error", "Unhandled promise rejection", {
        event: "window.unhandledrejection",
        ...getErrorDiagnostics(event.reason),
        frontend: getFrontendEnvironmentSnapshot(),
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  // 首次启动权限提示事件：把 Rust 侧的辅助功能状态映射到状态栏文案。
  useEffect(() => {
    let disposed = false;
    const promise = listen<AccessibilityFirstPromptPayload>("clipforge://accessibility-first-prompt", ({ payload }) => {
      if (disposed) return;
      logAppError("info", "accessibility-first-prompt", payload);
      if (payload.status === "granted") {
        setNativeStatus(tr("main.status.accessibilityGranted"));
      } else if (payload.prompted) {
        setNativeStatus(tr("main.status.accessibilityPrompted"));
      } else {
        setNativeStatus(payload.message || tr("main.status.accessibilityRecorded"));
      }
    });
    promise.catch((error) => logAppError("warn", "Register accessibility prompt listener failed", String(error)));
    return () => {
      disposed = true;
      void promise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [setNativeStatus, tr]);

  // activeView 持久化。
  useEffect(() => {
    localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, activeView);
  }, [activeView]);
}
