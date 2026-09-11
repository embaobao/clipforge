/** 快速面板共享桥接：模块级日志与 DSH 分析入口（主体与子组件共用，不挂在组件作用域内）。 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { create } from "zustand";

/** 结构化前端日志：写 Tauri append_app_log（截断 8KB），error 级别同时落 console。 */
export function logAppError(level: "info" | "warn" | "error", message: string, context?: unknown) {
  const contextText =
    typeof context === "string" ? context : context ? JSON.stringify(context).slice(0, 8000) : "";
  invoke("append_app_log", { level, message, context: contextText }).catch(() => {
    if (level === "error") console.error(message, context);
  });
}


/** 等待 Cmd/Ctrl 修饰键释放（Cmd+数字 粘贴场景）：首个修饰键 keyup 即 resolve，
 *  返回等待耗时 ms；非 cmd-number 来源直接返回 0。上限 120ms 防止整体延迟过长。 */
export function waitForPasteTriggerRelease(source: string): Promise<number> {
  if (source !== "cmd-number") return Promise.resolve(0);
  return new Promise((resolve) => {
    const started = Date.now();
    let finished = false;
    let timer = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", finish, true);
      resolve(Date.now() - started);
    };
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Meta" || event.key === "Control" || (!event.metaKey && !event.ctrlKey)) {
        finish();
      }
    };
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", finish, true);
    timer = window.setTimeout(finish, 120);
  });
}

/** 防抖值 hook：delayMs 内的连续更新只在静默后落一次（搜索输入等场景）。 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

/** 面板空白处拖拽移动窗口（排除按钮/输入/链接等交互元素）。 */
export function createWindowDragHandler() {
  return (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, input, textarea, select, a, [role='menuitem']")) {
      return;
    }
    getCurrentWindow()
      .startDragging()
      .catch((error) => logAppError("warn", "Start window dragging failed", String(error)));
  };
}

// ===== 面板 UI 全局状态（从 App.tsx 迁入）=====

export type PanelUiState = {
  isClosing: boolean;
  setClosing: (isClosing: boolean) => void;
};

export const usePanelUiStore = create<PanelUiState>()((set) => ({
  isClosing: false,
  setClosing: (isClosing) => set((state) => (state.isClosing === isClosing ? state : { isClosing })),
}));

