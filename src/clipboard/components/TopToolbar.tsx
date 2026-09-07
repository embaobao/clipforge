// 主面板顶部工具栏（design-spec 视觉层重构）
// 搜索槽 + 视图范围按钮（History/Favorites/片段/更多），保持业务 handler 不变。
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { Clock, MoreHorizontal, ScanSearch, Scissors, Settings2, Star, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { getShortcutModLabel } from "../clipboard-domain";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TranslationKey } from "@/i18n";
import type { ViewKey } from "../../App";

type PanelArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/** 顶部工具栏 props：搜索槽、视图切换、更多菜单入口。 */
export interface TopToolbarProps {
  activeView: ViewKey;
  /** 面板级方向键导航；用于避免顶部栏按钮抢占列表下钻/返回快捷键。 */
  onPanelArrowKey?: (key: PanelArrowKey) => void;
  onDrag: (event: PointerEvent<HTMLElement>) => void;
  onOpenDsh: () => void;
  onOpenSettings: () => void;
  onViewChange: (view: ViewKey) => void;
  searchBar: ReactNode;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const scopeBase =
  "flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors active:scale-90";
const scopeInactive = "hover:bg-black/5 dark:hover:bg-white/[0.07]";
const scopeActive = "bg-foreground text-background hover:bg-foreground/90";
const scopeDisabled = "opacity-40 cursor-not-allowed";

/** 主面板顶部工具栏：搜索槽、范围按钮、更多菜单。 */
export function TopToolbar({
  activeView,
  onPanelArrowKey,
  onDrag,
  onOpenDsh,
  onOpenSettings,
  onViewChange,
  searchBar,
  tr,
}: TopToolbarProps) {
  const handleToolbarKeyDownCapture = (event: KeyboardEvent<HTMLElement>) => {
    if (!onPanelArrowKey) return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown"
    )
      return;
    if (
      event.target instanceof Element &&
      event.target.closest("input, textarea, select, [contenteditable='true']")
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    onPanelArrowKey(event.key);
  };

  return (
    <header
      className="grid h-[52px] grid-cols-[1fr_auto] items-center gap-2 px-3"
      data-dev-probe="top-toolbar"
      data-tauri-drag-region
      onKeyDownCapture={handleToolbarKeyDownCapture}
      onPointerDown={onDrag}
    >
      <div
        className="flex min-w-0 items-center gap-2"
        data-dev-probe="top-search-slot"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {searchBar}
      </div>

      <div
        className="flex items-center gap-1"
        data-dev-probe="top-action-slot"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={tr("main.dock.history")}
              className={cn(scopeBase, activeView === "history" ? scopeActive : scopeInactive)}
              data-dev-probe="top-scope-history"
              onClick={() => onViewChange("history")}
              type="button"
            >
              <Clock size={15} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <span>{tr("main.dock.history")}</span>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={tr("main.dock.favorites")}
              className={cn(scopeBase, activeView === "favorites" ? scopeActive : scopeInactive)}
              data-dev-probe="top-scope-favorites"
              onClick={() => onViewChange("favorites")}
              type="button"
            >
              <Star size={15} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <span>{tr("main.dock.favorites")}</span>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="片段"
              className={cn(scopeBase, scopeDisabled)}
              data-dev-probe="top-scope-snippets"
              disabled
              type="button"
            >
              <Scissors size={15} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <span>片段</span>
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={tr("main.dock.menu")}
              className={cn(scopeBase, scopeInactive)}
              data-dev-probe="top-menu-trigger"
              type="button"
            >
              <MoreHorizontal size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-52 rounded-xl border-black/5 p-1 dark:border-white/[0.07]"
            data-surface="clipboard"
            side="bottom"
            align="end"
            sideOffset={8}
          >
            <DropdownMenuItem
              className="rounded-lg px-2 py-1.5 text-[12.5px]"
              data-dev-probe="top-menu-dsh"
              onSelect={onOpenDsh}
            >
              <ScanSearch size={14} />
              <span>AI 分析</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="rounded-lg px-2 py-1.5 text-[12.5px]"
              data-dev-probe="top-menu-trash"
              onSelect={() => onViewChange("trash")}
            >
              <Trash2 size={14} />
              <span>{tr("main.dock.trash")}</span>
              <DropdownMenuShortcut className="mono">T</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-black/5 dark:bg-white/[0.07]" />
            <DropdownMenuItem
              className="rounded-lg px-2 py-1.5 text-[12.5px]"
              data-dev-probe="top-menu-settings"
              onSelect={onOpenSettings}
            >
              <Settings2 size={14} />
              <span>{tr("main.dock.settings")}</span>
              <DropdownMenuShortcut className="mono">
                {getShortcutModLabel()}+
                <span aria-hidden="true">,</span>
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export default TopToolbar;
