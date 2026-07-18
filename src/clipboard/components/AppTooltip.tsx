// 行 tooltip 组件（frontend-surface-architecture-refactor Phase B）
// 从 src/App.tsx 迁出，纯展示：常驻挂载（opacity 控制可见），阻止点击/右键/双击/按下冒泡，
// 避免触发行的选中/复制。供主面板行预览组件与 App.tsx 共用。
import type { ReactNode } from "react";
import type { AppTooltipContent } from "../clipboard-domain";

export interface AppTooltipProps {
  children: ReactNode;
  content: AppTooltipContent;
}

/** 常驻挂载的 tooltip 容器：children 是触发区，app-tooltip-card 是浮卡。 */
export function AppTooltip({ children, content }: AppTooltipProps) {
  return (
    <div className="app-tooltip">
      {children}
      <div
        className="app-tooltip-card"
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        role="tooltip"
      >
        <div className="app-tooltip-main">
          <strong>{content.title}</strong>
          <span>{content.description}</span>
        </div>
        <div className="app-tooltip-body">{content.body}</div>
      </div>
    </div>
  );
}

export default AppTooltip;
