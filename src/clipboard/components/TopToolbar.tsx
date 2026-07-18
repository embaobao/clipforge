// 主面板顶部工具栏（frontend-surface-architecture-refactor Phase B）
// 从 App.tsx 抽出：视图切换、搜索槽、Agent 按钮、更多菜单。
import type { PointerEvent, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, Heart, History, MoreHorizontal, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/animate-ui/components/animate/tabs";
import type { TranslationKey } from "@/i18n";
import agentAccessIcon from "../../../assets/brand/icons/256/agent-access.png";
import type { PanelSurface, ViewKey } from "../../App";
import { PanelStatusFeedback } from "./PanelStatusFeedback";

const dockButtonTransition = { type: "spring", stiffness: 430, damping: 30, mass: 0.42 } as const;
const dockTabTransition = { type: "spring", stiffness: 360, damping: 30, mass: 0.5 } as const;

export interface TopToolbarProps {
  activeSurface: PanelSurface;
  activeView: ViewKey;
  agentContextCount: number;
  onDrag: (event: PointerEvent<HTMLElement>) => void;
  onOpenAgent: () => void;
  onOpenSettings: () => void;
  onViewChange: (view: ViewKey) => void;
  searchBar: ReactNode;
  status: string;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

/** 主面板顶部工具栏：History/Favorites 切换、搜索槽、Agent 入口、系统菜单。 */
export function TopToolbar({
  activeSurface,
  activeView,
  agentContextCount,
  onDrag,
  onOpenAgent,
  onOpenSettings,
  onViewChange,
  searchBar,
  status,
  tr,
}: TopToolbarProps) {
  const reduceMotion = useReducedMotion();
  const toolbarValue = activeSurface === "agent" ? "agent" : activeView;
  const agentShortcutLabel = `${tr("main.dock.openAgent")} · Ctrl/Cmd+I`;
  const handleToolbarValueChange = (value: string) => {
    if (value === "history" || value === "favorites") {
      onViewChange(value);
    }
  };

  return (
    <header className="top-toolbar" data-dev-probe="top-toolbar" data-tauri-drag-region onPointerDown={onDrag}>
      <Tabs className="top-view-tabs" data-dev-probe="top-view-tabs" value={toolbarValue} onValueChange={handleToolbarValueChange}>
        <TabsList className="top-view-actions" data-dev-probe="top-view-actions" onPointerDown={(event) => event.stopPropagation()}>
          <TabsTrigger
            aria-label={tr("main.dock.history")}
            className={activeSurface === "clipboard" && activeView === "history" ? "icon-button active" : "icon-button subtle"}
            data-dev-probe="top-view-history"
            data-tooltip={tr("main.dock.history")}
            title={tr("main.dock.history")}
            transition={dockTabTransition}
            value="history"
            whileHover={reduceMotion ? undefined : { y: -1 }}
            whileTap={reduceMotion ? undefined : { scale: 0.94 }}
          >
            <History size={13} />
            <span>{tr("main.dock.history")}</span>
          </TabsTrigger>
          <TabsTrigger
            aria-label={tr("main.dock.favorites")}
            className={activeSurface === "clipboard" && activeView === "favorites" ? "icon-button active" : "icon-button subtle"}
            data-dev-probe="top-view-favorites"
            data-tooltip={tr("main.dock.favorites")}
            title={tr("main.dock.favorites")}
            transition={dockTabTransition}
            value="favorites"
            whileHover={reduceMotion ? undefined : { y: -1 }}
            whileTap={reduceMotion ? undefined : { scale: 0.94 }}
          >
            <Heart size={13} />
            <span>{tr("main.dock.favorites")}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="top-toolbar-search-slot" data-dev-probe="top-search-slot" onPointerDown={(event) => event.stopPropagation()}>
        {searchBar}
      </div>
      <div className="top-toolbar-action-slot" data-dev-probe="top-action-slot" onPointerDown={(event) => event.stopPropagation()}>
        <motion.button
          aria-label={tr("main.dock.openAgent")}
          className={activeSurface === "agent" ? "icon-button active top-agent-button" : "icon-button subtle top-agent-button"}
          data-agent-trigger="top-toolbar"
          data-dev-probe="top-agent-button"
          data-tooltip={agentShortcutLabel}
          onClick={onOpenAgent}
          title={agentShortcutLabel}
          transition={dockButtonTransition}
          type="button"
          whileHover={reduceMotion ? undefined : { y: -1, scale: 1.04 }}
          whileTap={reduceMotion ? undefined : { scale: 0.94 }}
        >
          <img alt="" className="agent-access-icon" src={agentAccessIcon} />
          {agentContextCount ? <em>{agentContextCount}</em> : null}
        </motion.button>
        <PanelStatusFeedback status={status} tr={tr} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <motion.button
              aria-label={tr("main.dock.menu")}
              className="top-menu-trigger"
              data-dev-probe="top-menu-trigger"
              data-tooltip={tr("main.dock.menu")}
              title={tr("main.dock.menu")}
              transition={dockButtonTransition}
              type="button"
              whileHover={reduceMotion ? undefined : { y: -1, scale: 1.04 }}
              whileTap={reduceMotion ? undefined : { scale: 0.94 }}
            >
              <MoreHorizontal size={16} />
            </motion.button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="top-toolbar-menu" side="bottom" align="end" sideOffset={8}>
            <DropdownMenuLabel className="top-toolbar-menu-header">
              <span>ClipForge</span>
              <small>{tr("main.dock.shortcutHint")}</small>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem data-dev-probe="top-menu-trash" onSelect={() => onViewChange("trash")}>
                <span className="top-toolbar-menu-label">
                  <Trash2 size={13} />
                  <span>{tr("main.dock.trash")}</span>
                </span>
                <span className="top-toolbar-menu-shortcut">
                  {activeSurface === "clipboard" && activeView === "trash" ? <Check size={12} /> : null}
                  <kbd>T</kbd>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem data-dev-probe="top-menu-settings" onSelect={onOpenSettings}>
                <span>{tr("main.dock.settings")}</span>
                <kbd>,</kbd>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export default TopToolbar;
