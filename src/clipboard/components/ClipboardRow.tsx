// 主面板历史行组件（design-spec 视觉层重构）
// 左侧类型图标 + 内容预览 + 右侧动态动作；保持事件顺序与原有行为一致。
import type { MouseEvent } from "react";
import { FileText, Image as ImageIcon, Link2, Table2, Type } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ClipItem } from "../../App";
import type { FilePathStatus } from "../../services/clipboard";
import { isFileClipMissing, type TrFunction } from "../clipboard-domain";
import { recordNextFramePerf } from "../../performance-smoke";
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

/** 主面板单条剪贴历史行。 */
export function ClipboardRow({
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

  const heightClass =
    density === "comfortable" ? "h-11" : density === "dense" ? "h-[34px]" : "h-10";

  return (
    <article
      className={cn(
        "group row-in relative grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_80px] items-center gap-3 rounded-lg px-2 transition-colors duration-100 active:scale-[0.99]",
        heightClass,
        isSelected && "bg-black/[0.045] dark:bg-white/[0.07]",
        selectedIds.has(item.id) && "bg-black/[0.03] dark:bg-white/[0.05]",
      )}
      key={item.id}
      style={{ animationDelay: `${Math.max(index - activeGroupStart, 0) * 20}ms` }}
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
}

export default ClipboardRow;
