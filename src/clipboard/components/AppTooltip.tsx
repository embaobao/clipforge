// 行 tooltip 组件（frontend-surface-architecture-refactor Phase B）
// 从 src/App.tsx 迁出，纯展示：常驻挂载（opacity 控制可见），阻止点击/右键/双击/按下冒泡，
// 避免触发行的选中/复制。供主面板行预览组件与 App.tsx 共用。
// portal 版遵循 hover 意图：停下 OPEN_DELAY_MS 才出卡，路过/滚动中不出（一路滑过全是浮卡的整治）。
import { useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AppTooltipContent } from "../clipboard-domain";
import { ListScrollingContext } from "./VirtualList";

export interface AppTooltipProps {
  children: ReactNode;
  content: AppTooltipContent;
  className?: string;
  preview?: ReactNode;
  /** 是否将浮卡挂到页面顶层，用于跨越虚拟列表的滚动裁切。 */
  portal?: boolean;
}

/** 常驻挂载的 tooltip 容器：children 是触发区，app-tooltip-card 是浮卡。 */

/** hover 意图延时时长：指针在行上停留超过该时长才弹卡；扫过/慢速划过均不出。 */
const OPEN_DELAY_MS = 500;

/** 卡片与触发行之间的间隙（px）。 */
const CARD_GAP = 6;
/** 卡片命中区域向外扩边（px）：盖住行与卡之间的间隙，指针过桥时不判定为「离开」。 */
const CARD_BRIDGE_INFLATE = 8;
/** 卡片距列表容器上下边的内缩（px）：永不盖住搜索栏/底栏。 */
const LIST_INSET = 4;
/** 上方放置所需的最小高度；不足则放下方。 */
const MIN_CARD_HEIGHT = 96;

/**
 * portal 卡定位：等宽（与行对齐，左右各留列表内边距 8px），优先放触发行上方，
 * 垂直钳制在列表容器边界内（旧版只钳视口，顶行出卡会盖住搜索栏，很丑）。
 * 上方空间不足 MIN_CARD_HEIGHT 且下方更大时放下方。高度由 maxHeight 钳制，超出截断+渐变。
 */
function computePortalPosition(rowRect: DOMRect, listRect: DOMRect | null, height: number) {
  // 等宽：列表 px-2 内边距即行区域，卡片左右与行对齐
  const bounds = listRect ?? ({ left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight } as const);
  const left = bounds.left + 8;
  const width = Math.max(120, bounds.right - bounds.left - 16);
  const topBound = bounds.top + LIST_INSET;
  const bottomBound = bounds.bottom - LIST_INSET;
  const aboveSpace = Math.max(0, rowRect.top - CARD_GAP - topBound);
  const belowSpace = Math.max(0, bottomBound - (rowRect.bottom + CARD_GAP));
  if (aboveSpace >= MIN_CARD_HEIGHT || aboveSpace >= belowSpace) {
    const maxHeight = Math.max(40, aboveSpace);
    return { left, width, top: rowRect.top - CARD_GAP - Math.min(height, maxHeight), maxHeight };
  }
  return { left, width, top: rowRect.bottom + CARD_GAP, maxHeight: Math.max(40, belowSpace) };
}

export function AppTooltip({ children, className, content, preview, portal = false }: AppTooltipProps) {
  const closeTimerRef = useRef<number | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const triggerRectRef = useRef<DOMRect | null>(null);
  const triggerAnchorRef = useRef<Element | null>(null);
  const listRectRef = useRef<DOMRect | null>(null);
  const [portalOpen, setPortalOpen] = useState(false);
  const [portalPosition, setPortalPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  // 列表滚动反馈：滚动中（含停轮后 420ms 余量）抑制弹卡，避免滚动逐行挂载浮卡的抖动。
  const isListScrolling = useContext(ListScrollingContext);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
  }, []);

  const closePortal = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    setPortalOpen(false);
    setPortalPosition(null);
  };

  // 两阶段定位：先隐身挂载量真实高度（受 inline maxHeight 约束），再算位置显示；
  // useLayoutEffect 在绘制前同步执行，隐身中间帧不会被画出来（旧实现按估计高度先显示
  // 再校正，第一帧会闪在错误位置）。测量值随 maxHeight 约束微调时反复校正直到收敛
  // （收敛判定是位置不再变化，返回旧对象让 React bail out，避免同值新对象死循环）。
  useLayoutEffect(() => {
    if (!portal || !portalOpen || !cardRef.current || !triggerRectRef.current) return;
    const actualHeight = cardRef.current.getBoundingClientRect().height;
    const next = computePortalPosition(triggerRectRef.current, listRectRef.current, actualHeight);
    setPortalPosition((prev) =>
      prev && Math.abs(prev.top - next.top) <= 1 && Math.abs(prev.maxHeight - next.maxHeight) <= 1 && prev.left === next.left
        ? prev
        : next,
    );
  }, [portal, portalOpen, portalPosition]);

  // 面板是 blur 驱动隐藏的后台 app：窗口失焦隐藏时 pointerleave 不会送达，浮卡会常驻卡住，
  // 失焦直接关掉。列表滚动开始时也关掉（浮卡锚定的行已移位/即将卸载）。
  // 不监听 visibilitychange（自动化环境会误触发 document.hidden）。
  useEffect(() => {
    if (!portal || !portalOpen) return;
    const onListScroll = () => closePortal();
    document.addEventListener("clipforge:list-scroll-start", onListScroll);
    window.addEventListener("blur", closePortal);
    return () => {
      document.removeEventListener("clipforge:list-scroll-start", onListScroll);
      window.removeEventListener("blur", closePortal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portal, portalOpen]);

  const cancelOpen = () => {
    if (openTimerRef.current === null) return;
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
  };

  const cancelClose = () => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  // 预览里的图片加载完成后卡片高度才准确：load 不冒泡，用捕获阶段监听，
  // 重走两阶段定位（回到测量帧→按真实高度重算），否则按未加载高度算出的
  // 上方放置会在图片撑高后向下盖住触发行。健康时间线下 layout effect 同步
  // 完成，测量帧不会被画出，无闪烁。
  const handlePreviewLoad = () => {
    if (!portal || !portalOpen) return;
    setPortalPosition(null);
  };

  // 移出触发区：取消待弹出的延时卡；已打开的卡延时关闭——280ms 是移进卡片的搭桥窗口。
  // 真正的可靠关闭由打开期间的 document 级命中测试接管（见下），这里是兜底。
  const scheduleClose = () => {
    if (!portal) return;
    cancelOpen();
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setPortalOpen(false);
      setPortalPosition(null);
    }, 280);
  };

  // 打开期间用 document 级 pointermove 做命中测试：指针在卡片或触发行（含扩边）内则取消
  // 关闭，在外则启动延时关闭。比 enter/leave 事件链可靠——WKWebView 里指针从行滑向卡片
  // 要经过行内边距 + 6px 间隙 + 相邻行，leave→enter 时序不稳，短搭桥窗口经常在到达卡片
  // 前就把卡关了（「滑不进去」）；命中测试不依赖事件到达顺序。
  useEffect(() => {
    if (!portal || !portalOpen) return;
    const onPointerMove = (event: globalThis.PointerEvent) => {
      const card = cardRef.current;
      if (!card) return;
      const anchor = triggerAnchorRef.current;
      const x = event.clientX;
      const y = event.clientY;
      const inside = (rect: DOMRect) =>
        x >= rect.left - CARD_BRIDGE_INFLATE &&
        x <= rect.right + CARD_BRIDGE_INFLATE &&
        y >= rect.top - CARD_BRIDGE_INFLATE &&
        y <= rect.bottom + CARD_BRIDGE_INFLATE;
      if (inside(card.getBoundingClientRect()) || (anchor && anchor.isConnected && inside(anchor.getBoundingClientRect()))) {
        cancelClose();
      } else if (closeTimerRef.current === null) {
        scheduleClose();
      }
    };
    document.addEventListener("pointermove", onPointerMove, true);
    return () => document.removeEventListener("pointermove", onPointerMove, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portal, portalOpen]);

  // hover 意图：进入触发区不立即出卡，先记锚点并启动延时；停留满 OPEN_DELAY_MS、
  // 且不在滚动中才真正挂载浮卡。路过（短暂停留后移出）会在 scheduleClose 里被 cancelOpen 拦下。
  const showPortal = (event: PointerEvent<HTMLDivElement>) => {
    if (!portal) return;
    cancelClose();
    cancelOpen();
    // 定位基准优先取整行（article）：触发区是行内文本 <p>，直接用它的 rect 会把
    // 6px 间距算在文本上，卡片下沿会盖住行的内边距区（验收按整行边界断言）。
    const anchor = event.currentTarget.closest("article") ?? event.currentTarget;
    triggerAnchorRef.current = anchor;
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      // 虚拟列表滚动/键盘居中会卸载触发行；滚动中也直接抑制，等停下后浏览器会对
      // 新行重新发 pointerenter（WKWebView 由 VirtualList 在滚动结束时补发），自然重新计时。
      if (!anchor.isConnected || isListScrolling()) return;
      triggerRectRef.current = anchor.getBoundingClientRect();
      // 垂直钳制基准：列表容器边界（浮卡永不盖住搜索栏/底栏）
      listRectRef.current = anchor.closest(".thin-scroll")?.getBoundingClientRect() ?? null;
      setPortalPosition(null);
      setPortalOpen(true);
    }, OPEN_DELAY_MS);
  };

  const tooltipCard = (
    <div
      className={[
        "app-tooltip-card",
        preview ? "has-preview" : "",
        portal ? "quick-panel-tooltip-card thin-scroll" : "",
      ].filter(Boolean).join(" ")}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      // 卡片本身可交互（长内容预览/滚动/选中）：滑进卡片取消关闭，滑出卡片延时关闭。
      onPointerEnter={portal ? cancelClose : undefined}
      onPointerLeave={portal ? scheduleClose : undefined}
      ref={cardRef}
      role="tooltip"
      style={portal ? portalPosition ?? { left: 0, top: 0, visibility: "hidden" } : undefined}
    >
      {/* 头部：标题 + 来源元信息（mono muted，按设计系统 meta 规范） */}
      <div className="app-tooltip-main">
        <strong>{content.title}</strong>
        <span className="mono">{content.description}</span>
      </div>
      {preview ? <div className="app-tooltip-preview" onLoadCapture={handlePreviewLoad}>{preview}</div> : null}
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
