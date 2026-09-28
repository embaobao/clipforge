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
  const [portalOpen, setPortalOpen] = useState(false);
  const [portalPosition, setPortalPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const closePortal = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setPortalOpen(false);
    setPortalPosition(null);
  };

  // 两阶段定位：先隐身挂载量真实高度（CSS max-height 232px 内），再算位置显示；
  // useLayoutEffect 在绘制前同步执行，隐身中间帧不会被画出来（旧实现按估计高度先显示
  // 再校正，第一帧会闪在错误位置）。测量值随 maxHeight 约束微调时反复校正直到收敛
  // （收敛判定是位置不再变化，返回旧对象让 React bail out，避免同值新对象死循环）。
  useLayoutEffect(() => {
    if (!portal || !portalOpen || !cardRef.current || !triggerRectRef.current) return;
    const actualHeight = cardRef.current.getBoundingClientRect().height;
    const next = computePortalPosition(triggerRectRef.current, actualHeight);
    setPortalPosition((prev) =>
      prev && Math.abs(prev.top - next.top) <= 1 && Math.abs(prev.maxHeight - next.maxHeight) <= 1 && prev.left === next.left
        ? prev
        : next,
    );
  }, [portal, portalOpen, portalPosition]);

  // 面板是 blur 驱动隐藏的后台 app：窗口失焦隐藏时 pointerleave 不会送达，浮卡会常驻卡住，
  // 失焦直接关掉。不监听 visibilitychange（自动化环境会误触发 document.hidden），
  // 也不监听 scroll（虚拟列表滚动会卸载触发行组件，portal 随之卸载，无需额外处理）。
  useEffect(() => {
    if (!portal || !portalOpen) return;
    window.addEventListener("blur", closePortal);
    return () => window.removeEventListener("blur", closePortal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portal, portalOpen]);

  const cancelClose = () => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const scheduleClose = () => {
    if (!portal) return;
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setPortalOpen(false);
      setPortalPosition(null);
    }, 80);
  };

  const showPortal = (event: PointerEvent<HTMLDivElement>) => {
    if (!portal) return;
    cancelClose();
    // 定位基准优先取整行（article）：触发区是行内文本 <p>，直接用它的 rect 会把
    // 6px 间距算在文本上，卡片下沿会盖住行的内边距区（验收按整行边界断言）。
    const anchor = event.currentTarget.closest("article") ?? event.currentTarget;
    triggerRectRef.current = anchor.getBoundingClientRect();
    setPortalPosition(null);
    setPortalOpen(true);
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
      ref={cardRef}
      role="tooltip"
      style={portal ? portalPosition ?? { left: 0, top: 0, visibility: "hidden" } : undefined}
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
        ? portalOpen && typeof document !== "undefined"
          ? createPortal(tooltipCard, document.body)
          : null
        : tooltipCard}
    </div>
  );
}

export default AppTooltip;
