// 行 tooltip 组件（frontend-surface-architecture-refactor Phase B）
// 从 src/App.tsx 迁出，纯展示：常驻挂载（opacity 控制可见），阻止点击/右键/双击/按下冒泡，
// 避免触发行的选中/复制。供主面板行预览组件与 App.tsx 共用。
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AppTooltipContent } from "../clipboard-domain";

export interface AppTooltipProps {
  children: ReactNode;
  content: AppTooltipContent;
  className?: string;
  preview?: ReactNode;
  /** 是否将浮卡挂到页面顶层，用于跨越虚拟列表的滚动裁切。 */
  portal?: boolean;
}

/** 常驻挂载的 tooltip 容器：children 是触发区，app-tooltip-card 是浮卡。 */
export function AppTooltip({ children, className, content, preview, portal = false }: AppTooltipProps) {
  const closeTimerRef = useRef<number | null>(null);
  const [portalPosition, setPortalPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const cancelClose = () => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const scheduleClose = () => {
    if (!portal) return;
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setPortalPosition(null), 80);
  };

  const showPortal = (event: PointerEvent<HTMLDivElement>) => {
    if (!portal) return;
    cancelClose();
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 196;
    const height = 248;
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    const below = rect.bottom + 6;
    const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - height - 6);
    setPortalPosition({ left, top });
  };

  const tooltipCard = (
    <div
      className={[
        "app-tooltip-card",
        preview ? "has-preview" : "",
        portal ? "quick-panel-tooltip-card" : "",
      ].filter(Boolean).join(" ")}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerEnter={portal ? cancelClose : undefined}
      onPointerLeave={portal ? scheduleClose : undefined}
      role="tooltip"
      style={portalPosition ?? undefined}
    >
      <div className="app-tooltip-main">
        <strong>{content.title}</strong>
        <span>{content.description}</span>
      </div>
      {preview ? <div className="app-tooltip-preview">{preview}</div> : null}
      <div className="app-tooltip-body">{content.body}</div>
    </div>
  );

  return (
    <div
      className={className ? `app-tooltip ${className}` : "app-tooltip"}
      onPointerEnter={portal ? showPortal : undefined}
      onPointerLeave={portal ? scheduleClose : undefined}
    >
      {children}
      {portal
        ? portalPosition && typeof document !== "undefined" ? createPortal(tooltipCard, document.body) : null
        : tooltipCard}
    </div>
  );
}

export default AppTooltip;
