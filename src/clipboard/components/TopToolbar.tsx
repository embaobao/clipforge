// 主面板顶部工具栏（design-spec 视觉层重构）
// 搜索槽 + 视图范围按钮（History/Favorites/片段/更多），保持业务 handler 不变。
import type {
  ButtonHTMLAttributes,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from "react";
import { forwardRef } from "react";
import { Clock, MoreHorizontal, Scissors, Settings2, Star, Trash2 } from "lucide-react";

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
  onOpenSettings: () => void;
  onViewChange: (view: ViewKey) => void;
  searchBar: ReactNode;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

// 顶栏圆形图标按钮：交互效果——hover 时灰色底从图标中心「长出来」（scale 0→100），
// 配合图标提亮；按下时图标即时缩到 90% 给触达反馈；当前视图按钮底色常驻以示选中。
// 底色用独立图层做 transform 动画（GPU 合成、可中断回弹），图标颜色用颜色过渡，
// 两者时长一致但曲线独立：底 150ms ease-out 浮现，图标按下 100ms 即时缩放。
const iconButtonBase =
  "group relative flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground";

/** 顶栏图标按钮：hover 底色从中心浮现、按下图标缩小、选中视图底色常驻。 */
const ToolbarIconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { /** 是否为当前选中视图（底色常驻）。 */ active?: boolean }
>(function ToolbarIconButton({ active, children, className, type, ...rest }, ref) {
  return (
    <button
      className={cn(iconButtonBase, className)}
      ref={ref}
      type={type ?? "button"}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 rounded-full bg-black/[0.07] transition-transform duration-150 ease-out dark:bg-white/[0.12]",
          active ? "scale-100" : "scale-0 group-hover:scale-100",
        )}
      />
      <span className="relative flex items-center justify-center transition-transform duration-100 ease-out group-active:scale-90">
        {children}
      </span>
    </button>
  );
});

/** 主面板顶部工具栏：搜索槽、范围按钮、更多菜单。 */
export function TopToolbar({
  activeView,
  onPanelArrowKey,
  onDrag,
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
      className="grid h-11 min-w-0 cursor-grab grid-cols-[1fr_auto] items-center gap-2 px-3 active:cursor-grabbing"
      data-dev-probe="top-toolbar"
      data-tauri-drag-region
      onKeyDownCapture={handleToolbarKeyDownCapture}
      onPointerDown={onDrag}
    >
      <div
        className="flex min-w-0 cursor-default items-center gap-2"
        data-dev-probe="top-search-slot"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {searchBar}
      </div>

      <div
        className="flex cursor-default items-center gap-1.5"
        data-dev-probe="top-action-slot"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <ToolbarIconButton
              active={activeView === "history"}
              aria-label={tr("main.dock.history")}
              data-dev-probe="top-scope-history"
              onClick={() => onViewChange("history")}
            >
              <Clock size={16} />
            </ToolbarIconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <span>{tr("main.dock.history")}</span>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <ToolbarIconButton
              active={activeView === "favorites"}
              aria-label={tr("main.dock.favorites")}
              data-dev-probe="top-scope-favorites"
              onClick={() => onViewChange("favorites")}
            >
              <Star size={16} />
            </ToolbarIconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <span>{tr("main.dock.favorites")}</span>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <ToolbarIconButton
              aria-label={tr("main.dock.snippets")}
              className="cursor-not-allowed opacity-40"
              data-dev-probe="top-scope-snippets"
              disabled
            >
              <Scissors size={16} />
            </ToolbarIconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            <span>{tr("main.dock.snippets")}</span>
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ToolbarIconButton
              aria-label={tr("main.dock.menu")}
              className="ml-0.5"
              data-dev-probe="top-menu-trigger"
            >
              <MoreHorizontal size={16} />
            </ToolbarIconButton>
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
