// 主面板历史行组件（frontend-surface-architecture-refactor Phase B）
// 把 VirtualList 的 renderItem 中 article 行抽出来，保持事件顺序与原有行为一致。
// 当前仍从 App.tsx 传入全部回调，不引入新状态；拆分后便于单独做视觉验证和样式迁移。
import type { MouseEvent } from "react";
import { Check, Square } from "lucide-react";
import type { ClipItem } from "../../App";
import { recordNextFramePerf } from "../../performance-smoke";
import { getStoredClipAiSummary } from "../../services/ai-summary";
import type { FilePathStatus } from "../../services/clipboard";
import { isFileClipMissing, type TrFunction } from "../clipboard-domain";
import { ClipboardContentPreview } from "./ClipboardContentPreview";
import { ClipboardRowActions } from "./ClipboardRowActions";

export interface ClipboardRowProps {
  /** 当前行数据。 */
  item: ClipItem;
  /** 在列表中的绝对下标（用于分组数字）。 */
  index: number;
  /** 当前激活项 id。 */
  activeId: string | null;
  /** 最近被复制项 id（显示勾选）。 */
  copiedId: string | null;
  /** 多选已选集合。 */
  selectedIds: Set<string>;
  /** 是否处于多选模式。 */
  multiSelectMode: boolean;
  /** 当前激活分组起点（用于计算 0-9 快捷数字）。 */
  activeGroupStart: number;
  /** 文件路径存在性缓存。 */
  filePathStatuses: Record<string, FilePathStatus>;
  /** 选中某项。 */
  onSelect: (item: ClipItem) => void;
  /** 粘贴某项。 */
  onPaste: (item: ClipItem, source?: string) => void;
  /** 切换选中状态。 */
  onToggleSelected: (id: string) => void;
  /** 进入多选模式。 */
  onStartMultiSelect: (id: string) => void;
  /** 打开右键菜单。 */
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, item: ClipItem) => void;
  /** 收藏/取消收藏。 */
  onFavorite: (item: ClipItem) => void;
  /** 打开目标。 */
  onOpen: (item: ClipItem) => void;
  /** 翻译函数。 */
  tr: TrFunction;
}

/** 主面板单条剪贴历史行：索引按钮 + 内容预览 + 操作按钮。 */
export function ClipboardRow({
  item,
  index,
  activeId,
  copiedId,
  selectedIds,
  multiSelectMode,
  activeGroupStart,
  filePathStatuses,
  onSelect,
  onPaste,
  onToggleSelected,
  onStartMultiSelect,
  onOpenContextMenu,
  onFavorite,
  onOpen,
  tr,
}: ClipboardRowProps) {
  const fileMissing = isFileClipMissing(item, filePathStatuses);
  const aiSummary = getStoredClipAiSummary(item);
  const groupIndex = index - activeGroupStart;

  return (
    <article
      className={[
        "quick-row",
        activeId === item.id ? "active" : "",
        copiedId === item.id ? "copied" : "",
        selectedIds.has(item.id) ? "selected" : "",
        multiSelectMode ? "selecting" : "",
        fileMissing ? "file-missing" : "",
        groupIndex >= 0 && groupIndex < 10 ? "in-active-group" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      key={item.id}
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
        aria-label={selectedIds.has(item.id) ? tr("main.list.unselectItem") : tr("main.list.multiSelectItem")}
        className={selectedIds.has(item.id) ? "quick-index selected" : "quick-index"}
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
          <Check size={12} />
        ) : copiedId === item.id ? (
          <Check size={12} />
        ) : groupIndex >= 0 && groupIndex <= 9 ? (
          <span className="quick-index-num">{groupIndex}</span>
        ) : (
          <Square size={12} />
        )}
      </button>
      <ClipboardContentPreview aiSummary={aiSummary} fileMissing={fileMissing} item={item} tr={tr} />
      <ClipboardRowActions item={item} onFavorite={onFavorite} onOpen={onOpen} tr={tr} />
    </article>
  );
}

export default ClipboardRow;
