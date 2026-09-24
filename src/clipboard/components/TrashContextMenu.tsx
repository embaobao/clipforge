// 回收站右键菜单（design-spec 视觉层重构）
// 使用 shadcn DropdownMenu + 虚拟触发点定位。
import { RotateCcw, Trash2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ClipItem } from "../../App";
import type { TranslationKey } from "../../i18n";

export interface TrashContextMenuProps {
  item: ClipItem;
  multiSelectMode: boolean;
  selectedCount: number;
  x: number;
  y: number;
  onClose: () => void;
  onDeleteSelected: () => void;
  onEmptyTrash: () => void;
  onHardDelete: (item: ClipItem) => void;
  onRestore: (item: ClipItem) => void;
  onRestoreSelected: () => void;
  onStartMultiSelect: (id: string) => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const menuItem =
  "flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";
const menuShortcut = "mono ml-auto text-[11px] opacity-60";

/** 回收站右键菜单。 */
export function TrashContextMenu({
  item,
  multiSelectMode,
  selectedCount,
  x,
  y,
  onClose,
  onDeleteSelected,
  onEmptyTrash,
  onHardDelete,
  onRestore,
  onRestoreSelected,
  onStartMultiSelect,
  tr,
}: TrashContextMenuProps) {
  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    // 受控常开：与 ClipContextMenu 同因——触发器在右键事件之后才生成，非受控永远不会弹出。
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
            <DropdownMenuItem
              className={menuItem}
              disabled={selectedCount === 0}
              onSelect={() => run(onRestoreSelected)}
            >
              <RotateCcw size={14} />
              <span>{tr("main.context.restoreSelected")}</span>
              <DropdownMenuShortcut className={menuShortcut}>{selectedCount}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={menuItem}
              disabled={selectedCount === 0}
              onSelect={() => run(onDeleteSelected)}
            >
              <Trash2 size={14} />
              <span>{tr("main.context.hardDeleteSelected")}</span>
              <DropdownMenuShortcut className={menuShortcut}>Del</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-black/5 dark:bg-white/[0.07]" />
            <DropdownMenuItem
              className={`${menuItem} text-destructive focus:text-destructive focus:bg-destructive/10`}
              onSelect={() => run(onEmptyTrash)}
            >
              <Trash2 size={14} />
              <span>{tr("main.context.emptyTrash")}</span>
              <DropdownMenuShortcut className={menuShortcut}>{tr("main.context.all")}</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem className={menuItem} onSelect={() => run(() => onRestore(item))}>
              <RotateCcw size={14} />
              <span>{tr("main.context.restore")}</span>
              <DropdownMenuShortcut className={menuShortcut}>Enter</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItem} onSelect={() => run(() => onStartMultiSelect(item.id))}>
              <Trash2 size={14} />
              <span>{tr("main.context.selectItem")}</span>
              <DropdownMenuShortcut className={menuShortcut}>Space</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-black/5 dark:bg-white/[0.07]" />
            <DropdownMenuItem
              className={`${menuItem} text-destructive focus:text-destructive focus:bg-destructive/10`}
              onSelect={() => run(() => onHardDelete(item))}
            >
              <Trash2 size={14} />
              <span>{tr("main.context.hardDelete")}</span>
              <DropdownMenuShortcut className={menuShortcut}>Del</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default TrashContextMenu;
