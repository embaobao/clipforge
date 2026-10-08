/** 快速面板虚拟列表：固定行高窗口化渲染 + 选中项自动居中 + 分组滚动命令 + 滚动性能埋点。 */
import { createContext, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { recordNextFramePerf } from "../../performance-smoke";
import { advanceRowAnimEpoch, initialRowAnimEpoch } from "../row-animation";

/** 列表默认行高（density 之外的兜底值）。 */
export const ROW_HEIGHT = 40;
/** 虚拟渲染上下多渲染的行数，滚动时避免白边。
 *  8 行 ≈ 320px 缓冲：图片行挂载即解码，overscan 太小会在快速滚动时露白（「滚动白屏」）。 */
export const OVERSCAN = 8;

/** 行入场动画意图：本 render 是否数据集变化帧（true=新挂载的行播 row-in stagger）。
 *  滚动回填帧为 false——挂载动画只表达「新数据到来」，不表达「虚拟窗口回填」。
 *  行侧用 useState 在挂载帧定格，已挂载行不受后续帧变化影响。 */
export const RowAnimationContext = createContext(false);

/**
 * 滚动中判定（供行 tooltip 的 hover 意图抑制用）：滚动反馈窗口（约 420ms）内返回 true。
 * 默认返回 false，非列表场景（详情页等）不抑制。
 */
export const ListScrollingContext = createContext<() => boolean>(() => false);

export type VirtualListProps<T extends { id: string }> = {
  activeId?: string | null;
  className: string;
  hasMore?: boolean;
  items: T[];
  isLoadingMore?: boolean;
  itemHeight?: number;
  onEndReached?: () => void;
  onUserScroll?: () => void;
  renderItem: (item: T, index: number) => ReactNode;
  autoScroll?: boolean;
  groupSize?: number;
  onActiveGroupChange?: (groupStart: number) => void;
  scrollToGroupStart?: number | null;
};

export function VirtualList<T extends { id: string }>({
  activeId,
  className,
  hasMore = false,
  items,
  isLoadingMore = false,
  itemHeight = ROW_HEIGHT,
  onEndReached,
  onUserScroll,
  renderItem,
  autoScroll = true,
  groupSize,
  onActiveGroupChange,
  scrollToGroupStart,
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(420);
  const [, setScrollFeedback] = useState(false);
  const isScrollFeedbackRef = useRef(false);
  const scrollFeedbackTimerRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const lastScrollPerfAtRef = useRef(0);
  const lastAutoScrollActiveIdRef = useRef<string | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  // WKWebView 的怪癖：列表滚动、指针原地不动时，滚动停下后不会对新位置的行重新发
  // pointerenter（Chrome 会重发）。这会让「滚动→停下→hover 预览」完全失灵（滑不进去）。
  // 在滚动反馈窗口结束时，用最后记录的指针位置做一次命中测试并补发 pointerover
  // （React 的 onPointerEnter 经 pointerover/out 委托实现，补发后正常进入 hover 意图计时）。
  // 仅滚轮/触摸驱动的滚动补发：键盘居中滚动时指针只是停在列表上，出卡是噪音。
  const hadWheelGestureRef = useRef(false);
  const reemitHoverAtLastPointer = useCallback(() => {
    if (!hadWheelGestureRef.current) return;
    hadWheelGestureRef.current = false;
    const point = lastPointerRef.current;
    const node = ref.current;
    if (!point || !node || document.hidden) return;
    const bounds = node.getBoundingClientRect();
    if (point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom) return;
    const target = document.elementFromPoint(point.x, point.y);
    target?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, clientX: point.x, clientY: point.y }));
  }, []);

  const setFeedback = useCallback(
    (next: boolean) => {
      // 滚动开始沿：广播列表滚动事件，打开的 hover 浮卡随之关闭（锚定行已移位）。
      if (next && !isScrollFeedbackRef.current) {
        document.dispatchEvent(new CustomEvent("clipforge:list-scroll-start"));
      }
      if (isScrollFeedbackRef.current !== next) {
        isScrollFeedbackRef.current = next;
        setScrollFeedback(next);
      }
      if (scrollFeedbackTimerRef.current) window.clearTimeout(scrollFeedbackTimerRef.current);
      if (next) {
        scrollFeedbackTimerRef.current = window.setTimeout(() => {
          isScrollFeedbackRef.current = false;
          setScrollFeedback(false);
          reemitHoverAtLastPointer();
        }, 420);
      }
    },
    [reemitHoverAtLastPointer],
  );

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof ResizeObserver === "undefined") {
      const syncHeight = () => setHeight(node.getBoundingClientRect().height || 420);
      syncHeight();
      window.addEventListener("resize", syncHeight);
      return () => window.removeEventListener("resize", syncHeight);
    }
    const resizeObserver = new ResizeObserver(([entry]) => {
      setHeight(entry.contentRect.height);
    });
    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (scrollFeedbackTimerRef.current) window.clearTimeout(scrollFeedbackTimerRef.current);
      if (scrollRafRef.current) window.cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  // 选中项变化时把它滚到视口垂直居中（macOS 切换器手感）。
  // 不做「已可见就跳过」的守卫：贴边跟随会显得选中行不居中；首尾由 max(0,…) 自然截停。
  // 用 behavior:"auto" 即时定位而非 smooth：连续按方向键时 smooth 动画会追着按键跑，拖沓不跟手。
  useEffect(() => {
    if (!activeId || !autoScroll) {
      lastAutoScrollActiveIdRef.current = null;
      return;
    }
    if (lastAutoScrollActiveIdRef.current === activeId) return;
    lastAutoScrollActiveIdRef.current = activeId;
    const node = ref.current;
    if (!node) return;
    const index = items.findIndex((item) => item.id === activeId);
    if (index < 0) return;
    const itemTop = index * itemHeight;
    const targetTop = Math.max(0, itemTop - node.clientHeight / 2 + itemHeight / 2);
    setFeedback(true);
    node.scrollTo({ top: targetTop, behavior: "auto" });
  }, [activeId, autoScroll, itemHeight, setFeedback]);

  // 分组：按视口中心算"激活分组"起始下标（groupSize 整数倍），上报父级（给 Cmd+0-9 用）。
  useEffect(() => {
    if (!groupSize || !onActiveGroupChange) return;
    const centerIndex = Math.floor((scrollTop + height / 2) / itemHeight);
    const groupStart = Math.max(0, Math.floor(centerIndex / groupSize) * groupSize);
    onActiveGroupChange(groupStart);
  }, [scrollTop, height, itemHeight, groupSize, onActiveGroupChange]);

  // 父级命令：滚动到某个分组起始（Cmd+↑/↓ 切组用）。
  useEffect(() => {
    if (scrollToGroupStart == null) return;
    const node = ref.current;
    if (!node) return;
    // 切组时下偏一点，避免组首行被顶部搜索/导航栏遮挡。
    const GROUP_SCROLL_TOP_OFFSET = 56;
    const top = Math.max(0, scrollToGroupStart * itemHeight - GROUP_SCROLL_TOP_OFFSET);
    setFeedback(true);
    node.scrollTo({ top, behavior: "smooth" });
  }, [scrollToGroupStart, itemHeight, setFeedback]);

  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - OVERSCAN);
  const visibleCount = Math.ceil(height / itemHeight) + OVERSCAN * 2;
  const visible = items.slice(start, start + visibleCount);
  // 滚动回填静默：row-in 挂载动画只在数据集变化帧播放（items 引用比较，见 row-animation.ts）。
  // render 期只读 ref 比较（double render 结果一致），commit 后 layout effect 同步写回，
  // 消除 StrictMode 重放与滚动 render 交错时的竞态窗口。
  const rowAnimRef = useRef(initialRowAnimEpoch);
  const animateRows = advanceRowAnimEpoch(rowAnimRef.current, items).animate;
  useLayoutEffect(() => {
    rowAnimRef.current = advanceRowAnimEpoch(rowAnimRef.current, items).state;
  });
  // 稳定引用：滚动反馈窗口内返回 true，行 tooltip 据此在滚动中抑制弹卡。
  const isListScrolling = useCallback(() => isScrollFeedbackRef.current, []);
  // 行渲染结果按窗口起点 memo：滚动每帧 setScrollTop 触发重渲染，但 start 不变时
  // 窗口内容与 translateY 都不变，跳过全部行的 reconcile（滚动帧耗时的主要来源）。
  // renderItem 在滚动期间引用稳定（App 不因滚动重渲染），App 状态变化时自然失效重渲。
  const renderedRows = useMemo(
    () =>
      visible.map((item, index) => (
        <div key={item.id}>{renderItem(item, start + index)}</div>
      )),
    // visible 由 items/start/visibleCount 派生，展开为基本依赖避免数组引用抖动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, start, visibleCount, renderItem],
  );
  return (
    <div
      className={`${className} thin-scroll relative overflow-auto px-2`}
      onTouchMove={() => {
        hadWheelGestureRef.current = true;
        onUserScroll?.();
      }}
      onWheel={() => {
        hadWheelGestureRef.current = true;
        onUserScroll?.();
      }}
      onPointerMove={(event) => {
        lastPointerRef.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerLeave={() => {
        lastPointerRef.current = null;
      }}
      onScroll={(event) => {
        const node = event.currentTarget;
        const now = performance.now();
        if (now - lastScrollPerfAtRef.current > 160) {
          lastScrollPerfAtRef.current = now;
          recordNextFramePerf("quick.scroll", { className });
        }
        pendingScrollTopRef.current = node.scrollTop;
        if (!scrollRafRef.current) {
          scrollRafRef.current = window.requestAnimationFrame(() => {
            scrollRafRef.current = null;
            setScrollTop(pendingScrollTopRef.current);
          });
        }
        setFeedback(true);
        if (hasMore && !isLoadingMore && node.scrollHeight - node.scrollTop - node.clientHeight < itemHeight * 6) {
          onEndReached?.();
        }
      }}
      ref={ref}
    >
        <div className="relative" style={{ height: items.length * itemHeight }}>
          <ListScrollingContext.Provider value={isListScrolling}>
            <RowAnimationContext.Provider value={animateRows}>
              <div
                className="absolute left-0 right-0 top-0 will-change-transform"
                style={{ transform: `translateY(${start * itemHeight}px)` }}
              >
                {renderedRows}
                {isLoadingMore ? (
                  <div className="flex h-10 items-center justify-center text-[11px] text-muted-foreground">
                    加载更多...
                  </div>
                ) : null}
              </div>
            </RowAnimationContext.Provider>
          </ListScrollingContext.Provider>
        </div>
    </div>
  );
}
