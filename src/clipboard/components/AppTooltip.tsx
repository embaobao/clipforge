// 行 tooltip 组件（frontend-surface-architecture-refactor Phase B）
// 从 src/App.tsx 迁出，纯展示：常驻挂载（opacity 控制可见），阻止点击/右键/双击/按下冒泡，
// 避免触发行的选中/复制。供主面板行预览组件与 App.tsx 共用。
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
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
const ESTIMATED_HEIGHT = 248;

/** portal 卡定位：优先放触发区上方（不盖下一行），高度钳制在可用空间内（超出可滚动）；left clamp 在视口内。 */
function computePortalPosition(rect: DOMRect, height: number) {
  const width = 196;
  const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
  const aboveSpace = rect.top - 8;
  const belowSpace = window.innerHeight - rect.bottom - 8;
  // 上方空间足够（至少放 72px）就贴上行底部放上方；否则贴下行顶部放下方。
  if (aboveSpace >= 72) {
    return { left, top: rect.top - 6 - Math.min(height, aboveSpace - 6), maxHeight: aboveSpace - 6 };
  }
  return { left, top: rect.bottom + 6, maxHeight: Math.max(72, belowSpace - 6) };
}

export function AppTooltip({ children, className, content, preview, portal = false }: AppTooltipProps) {
  const closeTimerRef = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const triggerRectRef = useRef<DOMRect | null>(null);
  const [portalPosition, setPortalPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  // 首帧按估计高度定位后立即用实际渲染高度校正（估计值偏大，会错误选择下方）。
  useLayoutEffect(() => {
    if (!portalPosition || !cardRef.current || !triggerRectRef.current) return;
    const actualHeight = cardRef.current.getBoundingClientRect().height;
    if (Math.abs(actualHeight - ESTIMATED_HEIGHT) > 8) {
      setPortalPosition(computePortalPosition(triggerRectRef.current, actualHeight));
    }
  }, [portalPosition]);

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
    triggerRectRef.current = rect;
    setPortalPosition(computePortalPosition(rect, ESTIMATED_HEIGHT));
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
