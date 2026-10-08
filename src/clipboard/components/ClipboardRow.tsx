// 主面板历史行组件（design-spec 视觉层重构）
// 左侧类型图标 + 内容预览 + 右侧动态动作；保持事件顺序与原有行为一致。
import { memo, useContext, useState } from "react";
import type { MouseEvent } from "react";
import { FileText, Image as ImageIcon, Link2, Table2, Type } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ClipItem } from "../../App";
import type { FilePathStatus } from "../../services/clipboard";
import { isFileClipMissing, type TrFunction } from "../clipboard-domain";
import { recordNextFramePerf } from "../../performance-smoke";
import { RowAnimationContext } from "./VirtualList";
import { ClipboardContentPreview } from "./ClipboardContentPreview";
import { ClipboardRowActions } from "./ClipboardRowActions";

export interface ClipboardRowProps {
  item: ClipItem;
  index: number;
  activeId: string | null;
  copiedId: string | null;
  selectedIds: Set<string>;
  multiSelectMode: boolean;
  activeGroupStart: number;
  filePathStatuses: Record<string, FilePathStatus>;
  density?: "dense" | "normal" | "comfortable";
  onSelect: (item: ClipItem) => void;
  onPaste: (item: ClipItem, source?: string) => void;
  onToggleSelected: (id: string) => void;
  onStartMultiSelect: (id: string) => void;
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, item: ClipItem) => void;
  onFavorite: (item: ClipItem) => void;
  /** 占位：固定到顶部。 */
  onPin?: (item: ClipItem) => void;
  /** 保留兼容性，视觉层不再使用。 */
  onOpen?: (item: ClipItem) => void;
  tr: TrFunction;
}

function KindIcon({ kind, className }: { kind: ClipItem["payloadKind"]; className?: string }) {
  switch (kind) {
    case "image":
      return <ImageIcon className={className} size={14} />;
    case "link":
      return <Link2 className={className} size={14} />;
    case "file":
      return <FileText className={className} size={14} />;
    case "table":
    case "chart":
      return <Table2 className={className} size={14} />;
    case "text":
      return <Type className={className} size={14} />;
    default:
      return <FileText className={className} size={14} />;
  }
}

/** 主面板单条剪贴历史行。
 *  memo：props 全为 primitives/稳定引用（App 侧回调 useCallback、selectedIds/filePathStatuses
 *  为 state、tr 模块级）时跳过行重渲染；配合 VirtualList 窗口 memo 把滚动帧成本压在行 reconcile 之外。 */
export const ClipboardRow = memo(function ClipboardRow({
  item,
  index,
  activeId,
  copiedId,
  selectedIds,
  multiSelectMode,
  activeGroupStart,
  filePathStatuses,
  density = "normal",
  onSelect,
  onPaste,
  onToggleSelected,
  onStartMultiSelect,
  onOpenContextMenu,
  onFavorite,
  onPin,
  onOpen: _onOpen,
  tr,
}: ClipboardRowProps) {
  const fileMissing = isFileClipMissing(item, filePathStatuses);
  const groupIndex = index - activeGroupStart;
  const isSelected = activeId === item.id;
  const isCopied = copiedId === item.id;
  // row-in 是挂载动画：只在挂载帧处于数据集变化帧时播放（VirtualList 的
  // RowAnimationContext）。useState 定格 mount 值——滚动回填的行保持静默，
  // 已挂载行在后续粘贴帧也不会重播。
  const [playRowIn] = useState(useContext(RowAnimationContext));

  const heightClass =
    density === "comfortable" ? "h-11" : density === "dense" ? "h-[34px]" : "h-10";

  return (
    <article
      className={cn(
        "group relative grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_80px] items-center gap-3 rounded-lg px-2 transition-[color,background-color,border-color,transform] duration-instant active:scale-[0.99]",
        playRowIn && "row-in",
        heightClass,
        // 轻悬停底色仅作用于未选中行：选中/多选语义底色优先级必须高于 hover。
        !isSelected && !selectedIds.has(item.id) && "hover:bg-accent/50",
        isSelected && "bg-black/[0.045] dark:bg-white/[0.07]",
        selectedIds.has(item.id) && "bg-black/[0.03] dark:bg-white/[0.05]",
      )}
      key={item.id}
      style={playRowIn ? { animationDelay: `${Math.max(groupIndex, 0) * 20}ms` } : undefined}
      onClick={() => {
        recordNextFramePerf("quick.select", { source: "click" });
        if (multiSelectMode) {
          onToggleSelected(item.id);
          return;
        }
        onSelect(item);
        onPaste(item, "click");
      }}
      onContextMenu={(event) => {
        onOpenContextMenu(event, item);
      }}
      onFocus={() => {
        recordNextFramePerf("quick.select", { source: "focus" });
        onSelect(item);
      }}
      tabIndex={0}
    >
      <button
        aria-label={
          multiSelectMode ? tr("main.list.toggleSelection") : tr("main.list.enterMultiSelect")
        }
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
        {selectedIds.has(item.id) ? (
          <KindIcon kind={item.payloadKind} className="opacity-60" />
        ) : (
          <KindIcon kind={item.payloadKind} />
        )}
      </button>

      <ClipboardContentPreview density={density} fileMissing={fileMissing} item={item} tr={tr} />

      <ClipboardRowActions
        groupIndex={groupIndex}
        isCopied={isCopied}
        isSelected={isSelected}
        item={item}
        onFavorite={onFavorite}
        onOpenContextMenu={onOpenContextMenu}
        onPin={onPin}
        tr={tr}
      />
    </article>
  );
});

export default ClipboardRow;
