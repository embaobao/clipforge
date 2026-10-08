// 回收站行组件（design-spec 视觉层重构）
// 与历史行视觉一致，右侧悬停显示还原/彻底删除/更多。
import type { MouseEvent } from "react";
import { MoreHorizontal, RotateCcw, Trash2, Trash } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ClipItem } from "../../App";
import { getDisplayText, getItemTooltip, splitLineForMiddleEllipsis, type TrFunction } from "../clipboard-domain";
import { AppTooltip } from "./AppTooltip";

export interface TrashRowProps {
  item: ClipItem;
  index: number;
  activeId: string | null;
  selectedIds: Set<string>;
  multiSelectMode: boolean;
  activeGroupStart: number;
  density?: "dense" | "normal" | "comfortable";
  settings: { panelDensity: "dense" | "normal" | "comfortable"; contentDisplayMode: "summary" | "middle" | "raw" };
  onSelect: (item: ClipItem) => void;
  onRestore: (item: ClipItem) => void;
  onHardDelete: (item: ClipItem) => void;
  onToggleSelected: (id: string) => void;
  onStartMultiSelect: (id: string) => void;
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, item: ClipItem) => void;
  tr: TrFunction;
}

const actionButton =
  "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 active:scale-90 dark:hover:bg-white/[0.07]";

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  const rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || "zh-CN", { numeric: "auto" });
  if (seconds < 60) return rtf.format(-Math.max(1, seconds), "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return rtf.format(-days, "day");
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** 回收站单行。 */
export function TrashRow({
  item,
  index,
  activeId,
  selectedIds,
  multiSelectMode,
  activeGroupStart,
  density,
  settings,
  onSelect,
  onRestore,
  onHardDelete,
  onToggleSelected,
  onStartMultiSelect,
  onOpenContextMenu,
  tr,
}: TrashRowProps) {
  const groupIndex = index - activeGroupStart;
  const isSelected = activeId === item.id;
  const showIndex = !isSelected && groupIndex >= 0 && groupIndex <= 8;
  const heightClass =
    density === "comfortable" ? "h-11" : density === "dense" ? "h-[34px]" : "h-10";
  const parts = splitLineForMiddleEllipsis(getDisplayText(item, settings));
  const meta = [item.source || item.analysis.sourceName, formatRelativeTime(item.createdAt)].join(" · ");
  const showMeta = density !== "dense";

  return (
    <article
      className={cn(
        "group grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_80px] items-center gap-3 rounded-lg px-2 transition-[color,background-color,border-color,transform] duration-instant active:scale-[0.99]",
        heightClass,
        // 轻悬停底色仅作用于未选中行：与历史行一致，选中语义底色优先于 hover。
        !isSelected && !selectedIds.has(item.id) && "hover:bg-accent/50",
        isSelected && "bg-black/[0.045] dark:bg-white/[0.07]",
        selectedIds.has(item.id) && "bg-black/[0.03] dark:bg-white/[0.05]",
      )}
      onClick={() => {
        if (multiSelectMode) {
          onToggleSelected(item.id);
          return;
        }
        onSelect(item);
        onRestore(item);
      }}
      onContextMenu={(event) => onOpenContextMenu(event, item)}
      onFocus={() => onSelect(item)}
      tabIndex={0}
    >
      <button
        aria-label={multiSelectMode ? tr("main.list.toggleSelection") : tr("main.list.enterMultiSelect")}
        className={cn(
          "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[7px] bg-black/[0.04] text-muted-foreground transition-colors hover:bg-black/5 dark:bg-white/[0.07] dark:hover:bg-white/[0.1]",
          selectedIds.has(item.id) && "text-foreground",
        )}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(item);
          if (multiSelectMode) onToggleSelected(item.id);
          else onStartMultiSelect(item.id);
        }}
        title={multiSelectMode ? tr("main.list.toggleSelection") : tr("main.list.enterMultiSelect")}
        type="button"
      >
        <Trash size={14} />
      </button>

      <div className="flex min-w-0 flex-col justify-center leading-tight">
        {parts.split ? (
          <AppTooltip content={getItemTooltip(item, tr)} portal>
            <p className="truncate text-[13px] text-foreground" aria-label={parts.full}>
              <span>{parts.head}</span>
              <span className="text-muted-foreground">{parts.tail}</span>
            </p>
          </AppTooltip>
        ) : (
          <AppTooltip content={getItemTooltip(item, tr)} portal>
            <p className="truncate text-[13px] text-foreground" aria-label={parts.text}>
              {parts.text}
            </p>
          </AppTooltip>
        )}
        {showMeta ? (
          <p className="truncate text-[11px] text-muted-foreground" aria-label={meta}>
            {meta}
          </p>
        ) : null}
      </div>

      <div
        className="relative flex w-20 flex-shrink-0 items-center justify-end"
        onClick={(event) => event.stopPropagation()}
      >
        <span
          className={cn(
            "mono text-[11px] text-muted-foreground transition-opacity",
            showIndex ? "opacity-100 group-hover:opacity-0" : "opacity-0",
          )}
          aria-hidden={!showIndex}
        >
          {isSelected ? "⏎" : showIndex ? groupIndex + 1 : null}
        </span>
        <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            aria-label={tr("main.list.restore")}
            className={actionButton}
            onClick={() => onRestore(item)}
            title={tr("main.list.restore")}
            type="button"
          >
            <RotateCcw size={13} />
          </button>
          <button
            aria-label={tr("main.list.hardDelete")}
            className={`${actionButton} text-destructive hover:text-destructive hover:bg-destructive/10`}
            onClick={() => onHardDelete(item)}
            title={tr("main.list.hardDelete")}
            type="button"
          >
            <Trash2 size={13} />
          </button>
          <button
            aria-label={tr("main.context.trashMenu")}
            className={actionButton}
            onClick={(event) => onOpenContextMenu(event, item)}
            title={tr("main.context.trashMenu")}
            type="button"
          >
            <MoreHorizontal size={13} />
          </button>
        </div>
      </div>
    </article>
  );
}

export default TrashRow;
