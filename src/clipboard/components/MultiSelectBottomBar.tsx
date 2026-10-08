// 主面板多选底部状态栏（design-spec 视觉层重构）
// 显示已选数量与合并粘贴/删除/取消快捷键提示。
// 32px 底栏挂载/移除会瞬时重排列表区，按 proposal 接受该幅度。
import { useEffect, useRef, useState } from "react";
import type { TrFunction } from "../clipboard-domain";

export interface MultiSelectBottomBarProps {
  count: number;
  /** 是否可见：false 时先播 100ms 退出动画（对应 --motion-instant）再卸载。 */
  visible: boolean;
  variant?: "default" | "trash";
  tr: TrFunction;
}

/** 多选底部状态栏：入场 fast 上滑，退出 instant 下滑后卸载（退出延迟状态机）。 */
export function MultiSelectBottomBar({ count, visible, variant = "default", tr }: MultiSelectBottomBarProps) {
  const isTrash = variant === "trash";
  const [exiting, setExiting] = useState(false);
  // DOM setTimeout 句柄（浏览器环境返回 number），unmount/复见时统一清理。
  const timerRef = useRef<number | null>(null);
  // 记录上一次是否可见：首挂即不可见时不播退出动画，直接卸载。
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible) {
      // 重新可见时取消未完成的退出并复位状态。
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setExiting(false);
    } else if (prevVisibleRef.current) {
      // 仅"可见→不可见"的边沿播退出动画；100ms 后真正卸载。
      setExiting(true);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setExiting(false);
      }, 100);
    }
    prevVisibleRef.current = visible;
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [visible]);

  if (!visible && !exiting) return null;

  return (
    <footer
      className={
        visible
          ? // 入场：translateY(100%)→0，fast + 减速。
            "animate-in slide-in-from-bottom-full duration-fast ease-enter flex h-8 items-center justify-between border-t border-black/5 px-3 text-[11px] dark:border-white/[0.07]"
          : // 退出：加速下滑回 100%，instant 内完成并禁点。
            "animate-out slide-out-to-bottom-full duration-instant ease-exit pointer-events-none flex h-8 items-center justify-between border-t border-black/5 px-3 text-[11px] dark:border-white/[0.07]"
      }
    >
      <span className="cursor-pointer font-medium text-foreground">
        {tr("main.multiSelect.count", { count })}
      </span>
      <span className="mono cursor-pointer text-[11px] text-muted-foreground">
        {isTrash
          ? `⏎ ${tr("main.multiSelect.restoreSelected")} · ⌫ ${tr("main.multiSelect.hardDeleteSelected")} · esc ${tr("main.multiSelect.hint.exit")}`
          : `⏎ ${tr("main.multiSelect.aggregateCopy")} · ⌫ ${tr("main.multiSelect.delete")} · esc ${tr("main.multiSelect.hint.exit")}`}
      </span>
    </footer>
  );
}

export default MultiSelectBottomBar;
