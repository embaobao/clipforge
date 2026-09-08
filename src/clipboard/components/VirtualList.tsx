/** 快速面板虚拟列表：固定行高窗口化渲染 + 选中项自动居中 + 分组滚动命令 + 滚动性能埋点。 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { recordNextFramePerf } from "../../performance-smoke";

/** 列表默认行高（density 之外的兜底值）。 */
export const ROW_HEIGHT = 40;
/** 虚拟渲染上下多渲染的行数，滚动时避免白边。 */
export const OVERSCAN = 5;

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
  const ref = useRef<HTMLDivElement | null>(null);

  const setFeedback = useCallback(
    (next: boolean) => {
      if (isScrollFeedbackRef.current !== next) {
        isScrollFeedbackRef.current = next;
        setScrollFeedback(next);
      }
      if (scrollFeedbackTimerRef.current) window.clearTimeout(scrollFeedbackTimerRef.current);
      if (next) {
        scrollFeedbackTimerRef.current = window.setTimeout(() => {
          isScrollFeedbackRef.current = false;
          setScrollFeedback(false);
        }, 420);
      }
    },
    [],
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
  return (
    <div
      className={`${className} thin-scroll relative overflow-auto px-2`}
      onTouchMove={onUserScroll}
      onWheel={onUserScroll}
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
        <div
          className="absolute left-0 right-0 top-0 will-change-transform"
          style={{ transform: `translateY(${start * itemHeight}px)` }}
        >
          {visible.map((item, index) => (
            <div key={item.id}>
              {renderItem(item, start + index)}
            </div>
          ))}
          {isLoadingMore ? (
            <div className="flex h-10 items-center justify-center text-[11px] text-muted-foreground">
              加载更多...
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
