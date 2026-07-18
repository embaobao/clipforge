// 主面板右键上下文菜单（frontend-surface-architecture-refactor Phase B）
// 从 App.tsx 抽出：单条/多选两种模式、复制模式、AI 摘要、收藏、删除等入口。
import {
  CheckSquare,
  Clipboard,
  Copy,
  ExternalLink,
  FileJson,
  Heart,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { ClipItem } from "../../App";
import type { PasteMode } from "../../services/clipboard";
import { getShortcutModLabel } from "../clipboard-domain";
import type { TranslationKey } from "../../i18n";

export interface ClipContextMenuProps {
  /** 右键目标条目。 */
  item: ClipItem;
  /** 是否处于多选模式。 */
  multiSelectMode: boolean;
  /** 已选项数量（多选模式显示）。 */
  selectedCount: number;
  /** 菜单位置。 */
  x: number;
  /** 菜单位置。 */
  y: number;
  /** 关闭菜单。 */
  onClose: () => void;
  /** 删除当前项。 */
  onDelete: () => void;
  /** 删除已选项。 */
  onDeleteSelected: () => void;
  /** 收藏/取消收藏当前项。 */
  onFavorite: (item: ClipItem) => void;
  /** 批量收藏已选项。 */
  onFavoriteSelected: () => void;
  /** 打开聚合视图。 */
  onOpenAggregate: () => void;
  /** 粘贴当前项。 */
  onPaste: (item: ClipItem, source?: string) => void;
  /** 以指定模式复制当前项。 */
  onCopyMode: (mode: PasteMode) => void;
  /** 生成 AI 摘要。 */
  onGenerateAiSummary: (item: ClipItem) => void;
  /** 复制已选项。 */
  onCopySelected: () => void;
  /** 进入多选模式。 */
  onStartMultiSelect: (id: string) => void;
  /** 清空多选。 */
  onClearSelection: () => void;
  /** 打开当前项的工作区详情视图。 */
  onOpenDetail: () => void;
  /** 翻译函数。 */
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

/** 主面板右键菜单：单条模式与多选模式。 */
export function ClipContextMenu({
  item,
  multiSelectMode,
  selectedCount,
  x,
  y,
  onClose,
  onDelete,
  onDeleteSelected,
  onFavorite,
  onFavoriteSelected,
  onOpenAggregate,
  onPaste,
  onCopyMode,
  onGenerateAiSummary,
  onCopySelected,
  onStartMultiSelect,
  onClearSelection,
  onOpenDetail,
  tr,
}: ClipContextMenuProps) {
  const mod = getShortcutModLabel();
  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div
      aria-label={tr("main.context.clipMenu")}
      className="clip-context-menu"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      style={{ left: x, top: y }}
    >
      {multiSelectMode ? (
        <>
          <button className="clip-context-item" onClick={() => run(onOpenAggregate)} role="menuitem" type="button">
            <span className="clip-context-label">
              <CheckSquare size={13} />{tr("main.context.aggregate")}
            </span>
            <kbd>{selectedCount}</kbd>
          </button>
          <button className="clip-context-item" onClick={() => run(onCopySelected)} role="menuitem" type="button">
            <span className="clip-context-label">
              <Copy size={13} />{tr("main.context.copySelected")}
            </span>
            <kbd>{mod}+C</kbd>
          </button>
          <button className="clip-context-item" onClick={() => run(onFavoriteSelected)} role="menuitem" type="button">
            <span className="clip-context-label">
              <Heart size={13} />{tr("main.context.favoriteSelected")}
            </span>
            <kbd>{mod}+F</kbd>
          </button>
          <button className="clip-context-item danger" onClick={() => run(onDeleteSelected)} role="menuitem" type="button">
            <span className="clip-context-label">
              <Trash2 size={13} />{tr("main.context.deleteSelected")}
            </span>
            <kbd>Del</kbd>
          </button>
          <div className="clip-context-separator" role="separator" />
          <button className="clip-context-item" onClick={() => run(onClearSelection)} role="menuitem" type="button">
            <span className="clip-context-label">
              <X size={13} />{tr("main.context.exitMultiSelect")}
            </span>
            <kbd>Esc</kbd>
          </button>
        </>
      ) : (
        <>
          <button className="clip-context-item" onClick={() => run(() => onPaste(item, "context-menu"))} role="menuitem" type="button">
            <span className="clip-context-label">
              <Clipboard size={13} />{tr("main.context.paste")}
            </span>
            <kbd>Enter</kbd>
          </button>
          <button className="clip-context-item" onClick={() => run(() => onCopyMode("rich"))} role="menuitem" type="button">
            <span className="clip-context-label">
              <Copy size={13} />{tr("main.context.copyRich")}
            </span>
            <kbd>Rich</kbd>
          </button>
          <button
            className="clip-context-item"
            data-tooltip={item.payloadKind === "image" ? tr("main.context.copyPlainImageUnavailable") : tr("main.context.copyPlainTooltip")}
            disabled={item.payloadKind === "image"}
            onClick={() => run(() => onCopyMode("plain"))}
            role="menuitem"
            title={item.payloadKind === "image" ? tr("main.context.copyPlainImageUnavailable") : tr("main.context.copyPlainTitle")}
            type="button"
          >
            <span className="clip-context-label">
              <Copy size={13} />{tr("main.context.copyPlain")}
            </span>
            <kbd>Plain</kbd>
          </button>
          <button
            className="clip-context-item"
            data-tooltip={item.payloadKind !== "file" ? tr("main.context.copyPathFileOnly") : tr("main.context.copyPathTooltip")}
            disabled={item.payloadKind !== "file"}
            onClick={() => run(() => onCopyMode("filesAsPaths"))}
            role="menuitem"
            title={item.payloadKind !== "file" ? tr("main.context.copyPathFileOnly") : tr("main.context.copyPathTitle")}
            type="button"
          >
            <span className="clip-context-label">
              <Copy size={13} />{tr("main.context.copyPath")}
            </span>
            <kbd>Path</kbd>
          </button>
          <button
            className="clip-context-item"
            onClick={() => run(() => onGenerateAiSummary(item))}
            role="menuitem"
            type="button"
          >
            <span className="clip-context-label">
              <Sparkles size={13} />{tr("main.context.generateAiSummary")}
            </span>
            <kbd>AI</kbd>
          </button>
          <button
            className="clip-context-item"
            onClick={() => run(onOpenDetail)}
            role="menuitem"
            type="button"
          >
            <span className="clip-context-label">
              <FileJson size={13} />{tr("main.context.detail")}
            </span>
            <kbd>→</kbd>
          </button>
          {item.analysis.url || item.analysis.attachment ? (
            <div className="clip-context-item is-hint" role="presentation">
              <span className="clip-context-label">
                <ExternalLink size={13} />{tr("main.context.openTarget")}
              </span>
              <kbd>{mod}+J</kbd>
            </div>
          ) : null}
          <button className="clip-context-item" onClick={() => run(() => onFavorite(item))} role="menuitem" type="button">
            <span className="clip-context-label">
              <Heart size={13} />{item.favorite ? tr("main.context.unfavorite") : tr("main.context.favorite")}
            </span>
            <kbd>{mod}+F</kbd>
          </button>
          <button className="clip-context-item danger" onClick={() => run(onDelete)} role="menuitem" type="button">
            <span className="clip-context-label">
              <Trash2 size={13} />{tr("main.context.delete")}
            </span>
            <kbd>Del</kbd>
          </button>
          <div className="clip-context-separator" role="separator" />
          <button className="clip-context-item" onClick={() => run(() => onStartMultiSelect(item.id))} role="menuitem" type="button">
            <span className="clip-context-label">
              <Square size={13} />{tr("main.context.selectItem")}
            </span>
            <kbd>Space</kbd>
          </button>
        </>
      )}
    </div>
  );
}

export default ClipContextMenu;
