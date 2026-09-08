/** 快速面板失焦自动隐藏 hook（从 App.tsx 切出）：blur 后延迟查询 Rust 固定状态，未固定则淡出并隐藏窗口。 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { logAppError } from "./panel-shared";

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
    const appWindow = getCurrentWindow();
    let hideTimer: number | null = null;
    let closeTimer: number | null = null;
    const cancelHide = () => {
      if (hideTimer) window.clearTimeout(hideTimer);
      if (closeTimer) window.clearTimeout(closeTimer);
      hideTimer = null;
      closeTimer = null;
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
          setPanelClosing(true);
          closeTimer = window.setTimeout(() => {
            logAppError("info", "panel-pin: hide executing now");
            invoke("hide_quick_panel_command")
              .catch((error) => logAppError("warn", "Hide quick panel failed", String(error)))
              .finally(() => setPanelClosing(false));
          }, 180);
        }, 60);
      })
      .catch((error) => logAppError("warn", "Register focus listener failed", String(error)));
    return cancelHide;
  }, [enabled, setPanelClosing, setIsPanelEntering, panelFocusGraceUntilRef, blurHideInFlightRef]);
}
