// 主面板历史行右侧动作（design-spec 视觉层重构）
// 默认显示序号 / 选中态显示 ⏎ / 复制反馈显示 ✓ 已复制 / 悬停显示收藏/固定/更多。
import type { MouseEvent } from "react";
import { Check, Heart, MoreHorizontal, Pin } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ClipItem } from "../../App";
import type { TrFunction } from "../clipboard-domain";

export interface ClipboardRowActionsProps {
  item: ClipItem;
  /** 当前在激活分组内的序号，用于显示 1-9。 */
  groupIndex: number;
  /** 是否为当前键盘选中行。 */
  isSelected: boolean;
  /** 是否刚被复制（显示复制反馈）。 */
  isCopied: boolean;
  /** 切换收藏。 */
  onFavorite: (item: ClipItem) => void;
  /** 固定到顶部（占位，待业务层实现）。 */
  onPin?: (item: ClipItem) => void;
  /** 打开右键菜单。 */
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, item: ClipItem) => void;
  tr: TrFunction;
}

const actionButton =
  "grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-[transform,background-color,border-color] duration-instant hover:bg-black/[0.06] hover:text-foreground active:scale-90 dark:hover:bg-white/[0.1]";

/** 历史行右侧动作区。 */
export function ClipboardRowActions({
  item,
  groupIndex,
  isSelected,
  isCopied,
  onFavorite,
  onPin,
  onOpenContextMenu,
  tr,
}: ClipboardRowActionsProps) {
  const showIndex = !isCopied && !isSelected && groupIndex >= 0 && groupIndex <= 8;
  const indexLabel = groupIndex + 1;

  return (
    <div
      className="relative flex w-20 flex-shrink-0 items-center justify-end"
      onClick={(event) => event.stopPropagation()}
    >
      {isCopied ? (
        <span className="row-in flex items-center gap-1 text-[11px] text-muted-foreground">
          <Check className="h-3.5 w-3.5" strokeWidth={2.2} /> 已复制
        </span>
      ) : (
        <>
          <span className="mono text-[11px] text-muted-foreground/50 transition-opacity duration-instant group-hover:opacity-0">
            {isSelected ? "⏎" : showIndex ? indexLabel : null}
          </span>
          <span className="absolute inset-y-0 right-0 flex items-center gap-0.5 invisible opacity-0 transition-opacity duration-instant group-hover:visible group-hover:opacity-100">
            <button
              aria-label={item.favorite ? tr("main.list.unfavorite") : tr("main.list.favorite")}
              className={cn(actionButton, item.favorite && "fill-current text-foreground")}
              onClick={(event) => {
                event.stopPropagation();
                onFavorite(item);
              }}
              title={item.favorite ? tr("main.list.unfavorite") : tr("main.list.favorite")}
              type="button"
            >
              <Heart size={13} className={cn(item.favorite && "fill-current")} />
            </button>
            <button
              aria-label="固定到顶部"
              className={actionButton}
              onClick={(event) => {
                event.stopPropagation();
                onPin?.(item);
              }}
              title="固定到顶部"
              type="button"
            >
              <Pin size={13} />
            </button>
            <button
              aria-label={tr("main.context.clipMenu")}
              className={actionButton}
              onClick={(event) => {
                event.stopPropagation();
                onOpenContextMenu(event, item);
              }}
              title={tr("main.context.clipMenu")}
              type="button"
            >
              <MoreHorizontal size={13} />
            </button>
          </span>
        </>
      )}
    </div>
  );
}

export default ClipboardRowActions;
