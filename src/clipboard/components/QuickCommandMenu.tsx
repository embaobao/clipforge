// 主面板底部 ⌘K 命令菜单（design-spec 视觉层重构）
// 使用 shadcn DropdownMenu，从底部状态栏触发。
import type { ReactNode } from "react";
import { Copy, FolderInput, Pin, Plus, Star, Trash2 } from "lucide-react";

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

export interface QuickCommandMenuProps {
  selectedItem: ClipItem | null;
  mod: string;
  onCopyMode: (item: ClipItem, mode: PasteMode) => void;
  onTogglePanelPinned: () => void;
  onFavorite: (item: ClipItem) => void;
  onDelete: (item: ClipItem) => void;
  onCreateSnippet?: () => void;
  children: ReactNode;
}

const menuItem =
  "flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";
const menuShortcut = "mono ml-auto text-[11px] opacity-60";

/** 底部 ⌘K 命令菜单。 */
export function QuickCommandMenu({
  selectedItem,
  mod,
  onCopyMode,
  onTogglePanelPinned,
  onFavorite,
  onDelete,
  onCreateSnippet,
  children,
}: QuickCommandMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52 rounded-xl border-black/5 p-1 dark:border-white/[0.07]"
        side="top"
        sideOffset={6}
      >
        <DropdownMenuItem
          className={menuItem}
          disabled={!selectedItem}
          onSelect={() => selectedItem && onCopyMode(selectedItem, "plain")}
        >
          <Copy size={14} />
          <span>粘贴为纯文本</span>
          <DropdownMenuShortcut className={menuShortcut}>⇧⏎</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem className={menuItem} onSelect={onTogglePanelPinned}>
          <Pin size={14} />
          <span>固定到顶部</span>
          <DropdownMenuShortcut className={menuShortcut}>{mod}+P</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={menuItem}
          disabled={!selectedItem}
          onSelect={() => selectedItem && onFavorite(selectedItem)}
        >
          <Star size={14} />
          <span>收藏</span>
          <DropdownMenuShortcut className={menuShortcut}>{mod}+D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-black/5 dark:bg-white/[0.07]" />
        <DropdownMenuItem
          className={menuItem}
          disabled={!onCreateSnippet}
          onSelect={onCreateSnippet}
        >
          <Plus size={14} />
          <span>新建片段</span>
          <DropdownMenuShortcut className={menuShortcut}>{mod}+N</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem className={menuItem} disabled>
          <FolderInput size={14} />
          <span>移到文件夹…</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-black/5 dark:bg-white/[0.07]" />
        <DropdownMenuItem
          className={`${menuItem} text-destructive focus:text-destructive focus:bg-destructive/10`}
          disabled={!selectedItem}
          onSelect={() => selectedItem && onDelete(selectedItem)}
        >
          <Trash2 size={14} />
          <span>删除</span>
          <DropdownMenuShortcut className={menuShortcut}>⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default QuickCommandMenu;
