/** 快速面板失焦自动隐藏 hook（从 App.tsx 切出）：blur 后延迟查询 Rust 固定状态，未固定则淡出并隐藏窗口。 */
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { getCurrentWindowSafe, logAppError } from "./panel-shared";

export type PanelBlurHideOptions = {
  /** 设置窗口实例不注册失焦隐藏（settings 复用同一组件树时为 false）。 */
  enabled: boolean;
  /** 面板关闭淡出状态写入器（zustand usePanelUiStore）。 */
  setPanelClosing: (closing: boolean) => void;
  /** 面板进入动画状态写入器（主体 state，仅写不读）。 */
  setIsPanelEntering: (entering: boolean) => void;
  /** 唤起宽限窗口截止时间戳（showQuickPanel 设置，吸收唤起瞬间的 blur→focus 抖动）。 */
  panelFocusGraceUntilRef: { current: number };
  /** 隐藏流程互斥标记（showQuickPanel / 本 hook 共用）。 */
  blurHideInFlightRef: { current: boolean };
};

/** 失焦自动隐藏：blur → 60ms 延迟 → 查 Rust PANEL_PINNED → 未固定则 180ms 淡出后 hide。
 *  边界：固定判定以 Rust 为唯一权威源（前端 settingsRef 可能与 Rust 不同步）。 */
export function usePanelBlurHide({
  enabled,
  setPanelClosing,
  setIsPanelEntering,
  panelFocusGraceUntilRef,
  blurHideInFlightRef,
}: PanelBlurHideOptions) {
  useEffect(() => {
    if (!enabled) return;
    // 浏览器预览无 Tauri 窗口对象；getCurrentWindow() 同步抛错会触发重挂载死循环。
    const appWindow = getCurrentWindowSafe();
    if (!appWindow) return;
    let hideTimer: number | null = null;
    const cancelHide = () => {
      if (hideTimer) window.clearTimeout(hideTimer);
      hideTimer = null;
      setPanelClosing(false);
    };
    appWindow
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          // 失焦淡出途中焦点又回来：恢复可见，避免停在透明态。
          setIsPanelEntering(true);
          blurHideInFlightRef.current = false;
          cancelHide();
          return;
        }
        if (Date.now() < panelFocusGraceUntilRef.current) {
          logAppError("info", "panel-pin: blur ignored during focus grace window");
          return;
        }
        if (blurHideInFlightRef.current) {
          logAppError("info", "panel-pin: blur ignored, hide already in flight");
          return;
        }
        cancelHide();
        blurHideInFlightRef.current = true;
        logAppError("info", "panel-pin: blur detected, scheduling hide in 60ms");
        hideTimer = window.setTimeout(async () => {
          // EcoPaste 式：隐藏决策以 Rust 的 PANEL_PINNED 为唯一权威源。
          // 前端 settingsRef 可能与 Rust 不同步（重启 / 跨窗口写入），且 appWindow.hide()
          // 直连 Tauri 绕过 Rust 守卫——故失焦隐藏前必须查 Rust 是否固定。
          let pinned = false;
          try {
            pinned = await invoke<boolean>("is_panel_pinned_command");
          } catch (error) {
            logAppError("warn", "is_panel_pinned_command failed, assume not pinned", String(error));
          }
          if (pinned) {
            blurHideInFlightRef.current = false;
            logAppError("info", "panel-pin: Rust says pinned, blur hide cancelled");
            return;
          }
          setIsPanelEntering(false);
          // 收起动画走 Rust 原生 NSWindow alpha 淡出（hide_panel 内部）：合成器线程插值,
          // 不触发 WKWebView 重绘,backdrop-filter 不再逐帧重采样（CSS panel-out 方案卡顿根源）。
          // 60ms 延迟保留:吸收「点到面板外又快速点回」的假失焦,避免闪隐。
          logAppError("info", "panel-pin: native fade hide dispatched");
          invoke("hide_quick_panel_command")
            .catch((error) => logAppError("warn", "Hide quick panel failed", String(error)))
            .finally(() => {
              blurHideInFlightRef.current = false;
              setPanelClosing(false);
            });
        }, 60);
      })
      .catch((error) => logAppError("warn", "Register focus listener failed", String(error)));
    return cancelHide;
  }, [enabled, setPanelClosing, setIsPanelEntering, panelFocusGraceUntilRef, blurHideInFlightRef]);
}

/** 托盘/快捷键唤起与隐藏事件监听（clipforge://show-quick-panel / hide-quick-panel）。
 * 回调经 ref 间接调用：showQuickPanel 依赖链含非稳定引用（captureClipboard 等普通函数），
 * 若直接进 deps，每次唤起引发的连续 setState 会让本 effect 反复重建；cleanup 时 listen
 * promise 若尚未 resolve，unlisten 不会被压入旧数组 → 旧监听泄漏一份。表现为同一次唤起
 * mergeTopClip/manual capture 被执行 N 次（每次都过 osascript 慢路径），列表延迟跳动。 */
export function usePanelWindowListeners({
  enabled,
  setPanelClosing,
  setIsPanelEntering,
  settingsRef,
  showQuickPanel,
}: {
  enabled: boolean;
  setPanelClosing: (closing: boolean) => void;
  setIsPanelEntering: (entering: boolean) => void;
  settingsRef: { current: { panelPinned: boolean } };
  showQuickPanel: (reason: "shortcut" | "tray") => void;
}) {
  const showQuickPanelRef = useRef(showQuickPanel);
  useEffect(() => {
    showQuickPanelRef.current = showQuickPanel;
  });
  useEffect(() => {
    if (!enabled) return;
    // 浏览器预览无 Tauri 窗口对象；getCurrentWindow() 同步抛错会触发重挂载死循环。
    const appWindow = getCurrentWindowSafe();
    if (!appWindow) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    appWindow
      .listen<string>("clipforge://show-quick-panel", ({ payload }) => {
        showQuickPanelRef.current(payload === "tray" ? "tray" : "shortcut");
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlisteners.push(unlisten);
      })
      .catch((error) => logAppError("warn", "Register tray listener failed", String(error)));
    appWindow
      .listen<string>("clipforge://hide-quick-panel", () => {
        if (settingsRef.current.panelPinned) {
          logAppError("info", "panel-pin: hide-quick-panel event ignored, panel pinned");
          return;
        }
        // Rust 侧隐藏（粘贴 / 托盘切换走 hide_panel）后复位 is-entering，下次唤起才能淡入。
        setIsPanelEntering(false);
        setPanelClosing(false);
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlisteners.push(unlisten);
      })
      .catch((error) => logAppError("warn", "Register quick panel hide listener failed", String(error)));
    return () => {
      // disposed 防竞态：cleanup 先于 listen resolve 时，迟到的 unlisten 自行解绑。
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
    // 回调走 ref，effect 只注册一次；额外 deps 均为 setState/store 稳定引用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, setPanelClosing, setIsPanelEntering, settingsRef]);
}
