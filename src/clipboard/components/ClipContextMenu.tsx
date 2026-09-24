// 主面板右键上下文菜单（design-spec 视觉层重构）
// 使用 shadcn DropdownMenu + 虚拟触发点定位；单条/多选两种模式。
import {
  CheckSquare,
  Clipboard,
  Copy,
  ExternalLink,
  FileJson,
  Heart,
  ScanSearch,
  Square,
  Trash2,
  X,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ClipItem } from "../../App";
import type { PasteMode } from "../../services/clipboard";
import { getShortcutModLabel } from "../clipboard-domain";
import type { TranslationKey } from "../../i18n";

export interface ClipContextMenuProps {
  item: ClipItem;
  multiSelectMode: boolean;
  selectedCount: number;
  x: number;
  y: number;
  onClose: () => void;
  onDelete: () => void;
  onDeleteSelected: () => void;
  onFavorite: (item: ClipItem) => void;
  onFavoriteSelected: () => void;
  onOpenAggregate: () => void;
  onPaste: (item: ClipItem, source?: string) => void;
  onCopyMode: (mode: PasteMode) => void;
  onAnalyzeClipboard?: (item: ClipItem) => void;
  onCopySelected: () => void;
  onStartMultiSelect: (id: string) => void;
  onClearSelection: () => void;
  onOpenDetail: () => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const menuItem =
  "flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";
const menuShortcut = "mono ml-auto text-[11px] opacity-60";

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
  onAnalyzeClipboard,
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
    // 受控常开：菜单由右键事件触发挂载，Radix 触发器（1px 隐形按钮）出现在右键点之后，
    // 收不到点击事件，默认非受控模式永远不会弹出。这里挂载即打开，交给 onOpenChange/Esc/选项点击关闭。
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          className="fixed h-px w-px opacity-0"
          style={{ left: x, top: y }}
          tabIndex={-1}
          type="button"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52 rounded-xl border-black/5 p-1 dark:border-white/[0.07]"
        side="bottom"
        sideOffset={4}
      >
        {multiSelectMode ? (
          <>
            <DropdownMenuItem className={menuItem} onSelect={() => run(onOpenAggregate)}>
              <CheckSquare size={14} />
              <span>{tr("main.context.aggregate")}</span>
              <DropdownMenuShortcut className={menuShortcut}>{selectedCount}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItem} onSelect={() => run(onCopySelected)}>
              <Copy size={14} />
              <span>{tr("main.context.copySelected")}</span>
              <DropdownMenuShortcut className={menuShortcut}>{mod}+C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItem} onSelect={() => run(onFavoriteSelected)}>
              <Heart size={14} />
              <span>{tr("main.context.favoriteSelected")}</span>
              <DropdownMenuShortcut className={menuShortcut}>{mod}+F</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={`${menuItem} text-destructive focus:text-destructive focus:bg-destructive/10`}
              onSelect={() => run(onDeleteSelected)}
            >
              <Trash2 size={14} />
              <span>{tr("main.context.deleteSelected")}</span>
              <DropdownMenuShortcut className={menuShortcut}>Del</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-black/5 dark:bg-white/[0.07]" />
            <DropdownMenuItem className={menuItem} onSelect={() => run(onClearSelection)}>
              <X size={14} />
              <span>{tr("main.context.exitMultiSelect")}</span>
              <DropdownMenuShortcut className={menuShortcut}>Esc</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem className={menuItem} onSelect={() => run(() => onPaste(item, "context-menu"))}>
              <Clipboard size={14} />
              <span>{tr("main.context.paste")}</span>
              <DropdownMenuShortcut className={menuShortcut}>Enter</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItem} onSelect={() => run(() => onCopyMode("rich"))}>
              <Copy size={14} />
              <span>{tr("main.context.copyRich")}</span>
              <DropdownMenuShortcut className={menuShortcut}>Rich</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={menuItem}
              disabled={item.payloadKind === "image"}
              onSelect={() => run(() => onCopyMode("plain"))}
              title={item.payloadKind === "image" ? tr("main.context.copyPlainImageUnavailable") : tr("main.context.copyPlainTitle")}
            >
              <Copy size={14} />
              <span>{tr("main.context.copyPlain")}</span>
              <DropdownMenuShortcut className={menuShortcut}>Plain</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={menuItem}
              disabled={item.payloadKind !== "file"}
              onSelect={() => run(() => onCopyMode("filesAsPaths"))}
              title={item.payloadKind !== "file" ? tr("main.context.copyPathFileOnly") : tr("main.context.copyPathTitle")}
            >
              <Copy size={14} />
              <span>{tr("main.context.copyPath")}</span>
              <DropdownMenuShortcut className={menuShortcut}>Path</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={menuItem}
              disabled={!onAnalyzeClipboard}
              onSelect={() => run(() => onAnalyzeClipboard?.(item))}
            >
              <ScanSearch size={14} />
              <span>AI 分析</span>
              <DropdownMenuShortcut className={menuShortcut}>DSH</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItem} onSelect={() => run(onOpenDetail)}>
              <FileJson size={14} />
              <span>{tr("main.context.detail")}</span>
              <DropdownMenuShortcut className={menuShortcut}>→</DropdownMenuShortcut>
            </DropdownMenuItem>
            {item.analysis.url || item.analysis.attachment ? (
              <DropdownMenuItem className={`${menuItem} opacity-60`} disabled>
                <ExternalLink size={14} />
                <span>{tr("main.context.openTarget")}</span>
                <DropdownMenuShortcut className={menuShortcut}>{mod}+J</DropdownMenuShortcut>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem className={menuItem} onSelect={() => run(() => onFavorite(item))}>
              <Heart size={14} />
              <span>{item.favorite ? tr("main.context.unfavorite") : tr("main.context.favorite")}</span>
              <DropdownMenuShortcut className={menuShortcut}>{mod}+F</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={`${menuItem} text-destructive focus:text-destructive focus:bg-destructive/10`}
              onSelect={() => run(onDelete)}
            >
              <Trash2 size={14} />
              <span>{tr("main.context.delete")}</span>
              <DropdownMenuShortcut className={menuShortcut}>Del</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-black/5 dark:bg-white/[0.07]" />
            <DropdownMenuItem className={menuItem} onSelect={() => run(() => onStartMultiSelect(item.id))}>
              <Square size={14} />
              <span>{tr("main.context.selectItem")}</span>
              <DropdownMenuShortcut className={menuShortcut}>Space</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ClipContextMenu;
