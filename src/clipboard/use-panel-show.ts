// 面板唤起流程（S5 从 App.tsx 迁出）：showQuickPanel 的状态重置、动画门控与聚焦兜底。
import { useCallback } from "react";
import { startPerfSpan } from "../performance-smoke";
import { checkAnimFreeze } from "./anim-freeze-guard";
import { logAppError } from "./panel-shared";

export function usePanelShow(options: {
  tr: (key: "main.status.panelFocusedTray" | "main.status.panelFocusedShortcut", params?: Record<string, string | number>) => string;
  mergeTopClip: () => Promise<unknown>;
  captureClipboard: (source: "startup" | "manual" | "shortcut") => Promise<unknown>;
  searchRef: { current: HTMLInputElement | null };
  blurHideInFlightRef: { current: boolean };
  panelFocusGraceUntilRef: { current: number };
  panelShowStartedAtRef: { current: number };
  focusRetryTimersRef: { current: number[] };
  setActiveView: (view: "history") => void;
  setActiveSurface: (surface: "clipboard") => void;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setMultiSelectMode: React.Dispatch<React.SetStateAction<boolean>>;
  setQuery: (value: string) => void;
  setActiveTag: (value: string | null) => void;
  setActiveTypeFilter: (value: "all") => void;
  setFilterFavorite: (value: boolean) => void;
  setSearchActive: (value: boolean) => void;
  setIsPanelEntering: React.Dispatch<React.SetStateAction<boolean>>;
  setNativeStatus: (status: string) => void;
}) {
  const o = options;
  return useCallback(
    async (reason: "shortcut" | "tray") => {
      const finishPanelOpenPerf = startPerfSpan("panel.open", { reason });
      o.blurHideInFlightRef.current = false;
      // 唤起后只在极短窗口内忽略失焦（吸收 show_and_make_key 引发的一瞬 blur→focus 抖动）。
      // 原值 2400ms 太长：唤起提速后，用户在 2.4s 内点别的窗口，那次 blur 被吞掉、之后不再有
      // blur，面板就不再自动隐藏。400ms 足以覆盖抖动，又不至于吞掉真实的「点开别处」失焦。
      o.panelFocusGraceUntilRef.current = Date.now() + 400;
      o.panelShowStartedAtRef.current = Date.now();
      o.focusRetryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      o.focusRetryTimersRef.current = [];
      o.setActiveView("history");
      o.setActiveSurface("clipboard");
      o.setSelectedIds(new Set());
      o.setMultiSelectMode(false);
      o.setQuery("");
      o.setActiveTag(null);
      o.setActiveTypeFilter("all");
      o.setFilterFavorite(false);
      o.setSearchActive(true);
      o.setIsPanelEntering(true);
      // 唤起时复检动画冻结：用户激活 app 后时间轴可能已解冻，摘守卫恢复动效；仍冻结则继续压制。
      checkAnimFreeze();
      // 动画退出保险：后台 app 的 WKWebView 可能冻结 CSS 动画时间轴（面板停在 from{opacity:0}）。
      // 500ms 后无条件摘掉 panel-in，让面板回到天然可见态——时间轴正常时动画已播完
      // （时长见 --motion-panel-in），冻结时也能保证面板可见；隐藏路径已会复位 entering，不影响下次唤起重播。
      window.setTimeout(() => o.setIsPanelEntering(false), 500);
      // 非激活面板不能依赖第一下普通字符来“唤醒”搜索；打开后立即渲染并聚焦输入框。
      [0, 80, 180].forEach((delay) => {
        const timer = window.setTimeout(() => {
          if (document.activeElement !== o.searchRef.current) {
            o.searchRef.current?.focus();
          }
          if (delay === 180) {
            finishPanelOpenPerf({
              searchActive: true,
              searchFocused: document.activeElement === o.searchRef.current,
            });
            logAppError("info", "panel-keyboard: search focus settle", {
              active: document.activeElement === o.searchRef.current,
              reason,
              openReadyMs: Date.now() - o.panelShowStartedAtRef.current,
            });
          }
        }, delay);
        o.focusRetryTimersRef.current.push(timer);
      });
      o.setNativeStatus(reason === "tray" ? o.tr("main.status.panelFocusedTray") : o.tr("main.status.panelFocusedShortcut"));
      // 唤起即合并最新 1 条：快速复制后立刻唤起时，Rust 侧已在显示前同步入库（open_panel
      // 预采集），这里立刻把它并进列表，首帧即最终态。不能等 +300ms 的 manual 采集——
      // 那会让首行在用户手指落下后才突然变化（用户反馈「每次唤起后第一条改变」）。
      void o.mergeTopClip();
      // 后台监听线程每 100ms 已在采集，这里只是兜底；延后到 300ms，避免与「唤起后立即输入」
      // 抢主线程——setClips 触发的重渲染会吞掉最初几个按键，造成「面板出来后要等一下才能打字」。
      window.setTimeout(() => {
        void o.captureClipboard("manual");
      }, 300);
    },
    [o.mergeTopClip, o.captureClipboard, o.tr],
  );
}
