import { Clipboard, ExternalLink, Image, MoreHorizontal } from "lucide-react";
import type { ClipItem } from "../../App";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { appendWorkspacePanelLog, clipImageSrc, type DetailQuickAction, type WorkspaceTr } from "./workspace-detail-shared";

export type DetailOverflowMenuProps = {
  clip: ClipItem;
  hasImageActions: boolean;
  imageActualSize: boolean;
  imageOpenPath: string;
  menuActions: DetailQuickAction[];
  tr: WorkspaceTr;
  onCopyText: (text: string, source: string, context?: Record<string, unknown>) => void;
  onOpen: (clip: ClipItem) => void;
  onOpenPath?: (path: string) => void;
  onToggleImageActualSize: () => void;
  onOpenImagePreview: () => void;
};

/** 与 ClipContextMenu 一致的菜单项统一样式：圆角、字号、焦点态，保证全局菜单视觉统一。 */
const menuItem =
  "flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";
/** 详情页溢出菜单：MCP 命令复制、打开内容、图片动作组与插件注入动作组。
 *  边界：插件动作执行包 try/catch，失败只记日志不中断菜单（verify-runtime-boundaries 锁定该行为）。 */
export function DetailOverflowMenu({
  clip,
  hasImageActions,
  imageActualSize,
  imageOpenPath,
  menuActions,
  tr,
  onCopyText,
  onOpen,
  onOpenPath,
  onToggleImageActualSize,
  onOpenImagePreview,
}: DetailOverflowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={tr("main.detail.moreActions")}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
          title={tr("main.detail.moreActions")}
          type="button"
        >
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px] text-[12px]" side="bottom" sideOffset={8}>
        <DropdownMenuLabel>{tr("main.detail.quickActions")}</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem
            className={menuItem}
            onSelect={() =>
              onCopyText(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  method: "tools/call",
                  params: { name: "clipf.get", arguments: { id: clip.id } },
                }),
                "detail:copy-mcp-command",
                { clipId: clip.id },
              )
            }
          >
            <Clipboard size={13} />
            <span>{tr("main.detail.copyMcp")}</span>
          </DropdownMenuItem>
          {clip.analysis.url || clip.analysis.attachment ? (
            <DropdownMenuItem className={menuItem} onSelect={() => onOpen(clip)}>
              <ExternalLink size={13} />
              <span>{tr("main.detail.openContent")}</span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        {hasImageActions || menuActions.length ? <DropdownMenuSeparator /> : null}
        {hasImageActions ? (
          <DropdownMenuGroup>
            <DropdownMenuItem className={menuItem} disabled={!clipImageSrc(clip)} onSelect={onOpenImagePreview}>
              <Image size={13} />
              <span>{tr("main.detail.imagePreview")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItem} disabled={!clipImageSrc(clip)} onSelect={onToggleImageActualSize}>
              <Image size={13} />
              <span>{imageActualSize ? tr("main.detail.imageFit") : tr("main.detail.imageActual")}</span>
            </DropdownMenuItem>
            {imageOpenPath && onOpenPath ? (
              <DropdownMenuItem className={menuItem} onSelect={() => onOpenPath(imageOpenPath)}>
                <ExternalLink size={13} />
                <span>{tr("main.detail.openSystem")}</span>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        ) : null}
        {hasImageActions && menuActions.length ? <DropdownMenuSeparator /> : null}
        {menuActions.length ? (
          <DropdownMenuGroup>
            {menuActions.map((action) => (
              <DropdownMenuItem
                className={menuItem}
                disabled={action.disabled}
                key={action.id}
                onSelect={() => {
                  try {
                    action.onSelect();
                  } catch (error) {
                    appendWorkspacePanelLog("warn", "workspace-plugin-action-failed", {
                      actionId: action.id,
                      error: String(error),
                    });
                  }
                }}
              >
                {action.icon}
                <span>{action.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
