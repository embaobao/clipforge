// 主面板底部状态栏（design-spec 视觉层重构）
// 常态显示数量、命令菜单入口与导航提示；有自定义状态时优先展示状态。
import type { ReactNode } from "react";
import type { TrFunction } from "../clipboard-domain";

export interface PanelStatusFeedbackProps {
  /** 自定义状态文案；为空时显示默认底部栏。 */
  status: string;
  /** 命令菜单触发节点（包裹 ⌘K 全部操作）。 */
  commandMenu: ReactNode;
  tr: TrFunction;
}

/** 主面板底部状态提示。 */
export function PanelStatusFeedback({ status, commandMenu, tr }: PanelStatusFeedbackProps) {
  return (
    <footer className="flex h-9 items-center justify-between border-t border-black/[0.05] px-3.5 text-[11px] dark:border-white/[0.07]">
      <div className="min-w-0 truncate">
        {status ? (
          <span className="text-muted-foreground">{status}</span>
        ) : (
          commandMenu
        )}
      </div>
      <span className="mono flex-shrink-0 text-[10.5px] text-muted-foreground">
        ↑↓ {tr("main.statusLine.navigate")} · ⏎ {tr("main.statusLine.paste")} · 空格 预览 · / {tr("main.search.aria")}
      </span>
    </footer>
  );
}

export default PanelStatusFeedback;
