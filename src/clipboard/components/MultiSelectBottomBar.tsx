// 主面板多选底部状态栏（design-spec 视觉层重构）
// 显示已选数量与合并粘贴/删除/取消快捷键提示。
import type { TrFunction } from "../clipboard-domain";

export interface MultiSelectBottomBarProps {
  count: number;
  variant?: "default" | "trash";
  tr: TrFunction;
}

/** 多选底部状态栏。 */
export function MultiSelectBottomBar({ count, variant = "default", tr }: MultiSelectBottomBarProps) {
  const isTrash = variant === "trash";
  return (
    <footer className="flex h-8 items-center justify-between border-t border-black/5 px-3 text-[11px] dark:border-white/[0.07]">
      <span className="font-medium text-foreground">
        {tr("main.multiSelect.count", { count })}
      </span>
      <span className="mono text-[11px] text-muted-foreground">
        {isTrash
          ? `⏎ ${tr("main.multiSelect.restoreSelected")} · ⌫ ${tr("main.multiSelect.hardDeleteSelected")} · esc ${tr("main.multiSelect.hint.exit")}`
          : `⏎ ${tr("main.multiSelect.aggregateCopy")} · ⌫ ${tr("main.multiSelect.delete")} · esc ${tr("main.multiSelect.hint.exit")}`}
      </span>
    </footer>
  );
}

export default MultiSelectBottomBar;
