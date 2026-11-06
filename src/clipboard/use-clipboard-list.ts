/** 剪贴板列表域 hook：列表分页加载、采集（读系统剪贴板入库）、后台变化监听（从 App.tsx 切出）。
 *  边界：不碰搜索过滤/键盘导航/写回抑制；normalizeClip 由调用方注入（避免依赖 AppSettings）。 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import type { ClipItem } from "../App";
import type { AppSettings } from "../App";
import { readClipboard } from "../services/clipboard";
import type { TranslationKey } from "../i18n";
import { logAppError } from "./panel-shared";
import { createClipboardEventGate } from "./clipboard-event-gate";
import { updateViewClipEntryData } from "./view-clip-cache";

export type QueryClipPayload = {
  items: ClipItem[];
  nextCursor?: string;
  limit: number;
};

export type CaptureClipPayload = {
  status: "created" | "promoted";
  item: ClipItem;
};

export function isQueryClipPayload(payload: unknown): payload is QueryClipPayload {
  return Boolean(payload && typeof payload === "object" && Array.isArray((payload as QueryClipPayload).items));
}

export function isCaptureClipPayload(payload: unknown): payload is CaptureClipPayload {
  const item = payload && typeof payload === "object" ? (payload as Partial<CaptureClipPayload>).item : null;
  return Boolean(item && typeof item === "object" && typeof (item as Partial<ClipItem>).content === "string");
}

/** clipboard-changed 事件载荷（Rust ClipboardChangePayload）。
 *  changeCount 是进程内单调递增事件序号（RS-51 P0 3.5），用于前端去重。 */
export type ClipboardChangedEvent = {
  changeCount: number;
  hasChange: boolean;
  preview?: string;
  previewLen?: number;
}

/** 判断当前请求是否为「纯列表」（无搜索词/类型/标签/收藏过滤，且不在回收站）：
 *  纯列表下新采集条目必然位于顶部，可以本地增量合并，无需全量刷新。 */
function isPlainListRequest(request: Record<string, unknown>): boolean {
  const bucket = typeof request.bucket === "string" ? request.bucket : "all";
  if (bucket !== "all" && bucket !== "history") return false;
  return (
    !request.text &&
    !request.favorite &&
    !Array.isArray(request.kinds) &&
    !Array.isArray(request.types) &&
    !Array.isArray(request.tags) &&
    !Array.isArray(request.fileExtensions)
  );
}

/** 视图快照缓存的 key:必须与 App.tsx 的 searchRequestKey 同源(JSON.stringify(request))。 */
function viewCacheKey(request: Record<string, unknown>): string {
  return JSON.stringify(request);
}

export type ClipboardListOptions = {
  isSettingsWindow: boolean;
  setClips: React.Dispatch<React.SetStateAction<ClipItem[]>>;
  clipsRef: { current: ClipItem[] };
  setNextCursor: (cursor: string | null) => void;
  nextCursor: string | null;
  setIsLoadingMore: (loading: boolean) => void;
  isLoadingMore: boolean;
  setSelectedId: (id: string) => void;
  /** 当前选中条目（可选注入）：后台事件刷新搜索视图时保留选中态（U2）。 */
  selectedIdRef?: { current: string | null };
  setNativeStatus: (status: string) => void;
  setIsReadingClipboard: (reading: boolean) => void;
  searchRequestRef: { current: Record<string, unknown> };
  settingsRef: { current: AppSettings };
  captureInFlightRef: { current: boolean };
  lastSeenClipboard: { current: string };
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  formatNativeError: (error: unknown) => string;
  /** 条目归一化（主体注入：依赖设置与分析域）。 */
  normalizeClip: (raw: Partial<ClipItem>, settings: AppSettings) => ClipItem | null;
  /** 归一化失败时的本地建条兜底（主体注入）。 */
  createClip: (content: string, settings: AppSettings) => ClipItem;
};

/** 剪贴板列表域：返回四个操作与后台监听的挂载。 */
export function useClipboardList({
  isSettingsWindow,
  setClips,
  clipsRef,
  setNextCursor,
  nextCursor,
  setIsLoadingMore,
  isLoadingMore,
  setSelectedId,
  selectedIdRef,
  setNativeStatus,
  setIsReadingClipboard,
  searchRequestRef,
  settingsRef,
  captureInFlightRef,
  lastSeenClipboard,
  tr,
  formatNativeError,
  normalizeClip,
  createClip,
}: ClipboardListOptions) {
  /** 追加已加载条目：按 id 去重、截断到 maxStoredItems。 */
  const appendLoadedClips = (items: ClipItem[], cursor?: string | null) => {
    setClips((current) => {
      const seen = new Set(current.map((item) => item.id));
      const next = [
        ...current,
        ...items.filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        }),
      ].slice(0, settingsRef.current.maxStoredItems);
      clipsRef.current = next;
      return next;
    });
    setNextCursor(cursor ?? null);
  };

  /** 游标分页加载更多（列表滚动到底触发）。 */
  const loadMoreClips = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const payload = await invoke<QueryClipPayload>("search_clip_records", {
        input: { ...searchRequestRef.current, cursor: nextCursor },
      });
      if (!isQueryClipPayload(payload)) throw new Error("Invalid search_clip_records payload");
      const items = payload.items
        .map((item) => normalizeClip(item, settingsRef.current))
        .filter((item): item is ClipItem => Boolean(item));
      appendLoadedClips(items, payload.nextCursor ?? null);
      // 分页结果同步进视图快照(游标前进,items 全量替换)。
      updateViewClipEntryData(viewCacheKey(searchRequestRef.current), clipsRef.current, payload.nextCursor ?? null);
      setNativeStatus(
        payload.nextCursor
          ? tr("main.status.loadMoreComplete", { count: clipsRef.current.length })
          : tr("main.status.loadAllComplete", { count: clipsRef.current.length }),
      );
    } catch (error) {
      logAppError("warn", "Load more clip records failed", String(error));
      setNativeStatus(tr("main.status.loadMoreFailed"));
    } finally {
      setIsLoadingMore(false);
    }
  };

  /** 采集入库后的列表同步：优先全量刷新，失败降级为本地前插合并。 */
  const syncCapturedClipboardPayload = async (payload: CaptureClipPayload) => {
    if (!isCaptureClipPayload(payload)) throw new Error("Invalid capture payload");
    const nextClip = normalizeClip(payload.item, settingsRef.current) ?? createClip(payload.item.content, settingsRef.current);
    // 纯列表视图：本地增量合并（新条目必在顶部，按 id 去重提升）。
    // 原因：① 每次复制都全量刷新 200 行 ≈ Rust 70ms + 2MB IPC + 全列表重渲染，是复制卡顿尖峰；
    // ② 全量刷新 limit=200 会把用户已分页加载的列表截断回 200 条（「丢数据」根因）。
    if (isPlainListRequest(searchRequestRef.current)) {
      // 快照守卫:库内最新条目与列表首条一致(id+hash)时跳过 setClips——
      // 开面板 500ms 内 mergeTopClip/manual 采集/视图 effect 至多三次刷新,此守卫收敛后两次。
      const head = clipsRef.current[0];
      if (head && head.id === nextClip.id && head.contentHash === nextClip.contentHash) {
        setSelectedId(nextClip.id);
        return payload.status;
      }
      const current = clipsRef.current.filter((item) => item.id !== nextClip.id);
      const next = [nextClip, ...current].slice(0, settingsRef.current.maxStoredItems);
      clipsRef.current = next;
      setClips(next);
      updateViewClipEntryData(viewCacheKey(searchRequestRef.current), next);
      logAppError("info", "clipboard-promote: local merge", {
        promotedId: nextClip.id,
        status: payload.status,
        itemCount: next.length,
      });
      setSelectedId(nextClip.id);
      return payload.status;
    }
    try {
      const result = await invoke<QueryClipPayload>("search_clip_records", {
        input: {
          ...searchRequestRef.current,
          // 保留用户已分页加载的条数，刷新不截断列表（丢数据回归防护）。
          limit: Math.max(200, clipsRef.current.length),
          cursor: null,
        },
      });
      if (!isQueryClipPayload(result)) throw new Error("Invalid search_clip_records payload");
      const items = result.items
        .map((item) => normalizeClip(item, settingsRef.current))
        .filter((item): item is ClipItem => Boolean(item));
      clipsRef.current = items;
      setClips(items);
      setNextCursor(result.nextCursor ?? null);
      updateViewClipEntryData(viewCacheKey(searchRequestRef.current), items, result.nextCursor ?? null);
      logAppError("info", "clipboard-promote: refreshed full list", {
        promotedId: nextClip.id,
        status: payload.status,
        itemCount: items.length,
      });
    } catch (error) {
      logAppError("warn", "clipboard-promote: refresh full list failed, using local merge", String(error));
      const current = clipsRef.current.filter((item) => item.id !== nextClip.id);
      const next = [nextClip, ...current].slice(0, settingsRef.current.maxStoredItems);
      clipsRef.current = next;
      setClips(next);
    }
    setSelectedId(nextClip.id);
    return payload.status;
  };

  /** 取库内最新 1 条做增量合并（置顶/按 id 去重）。唤起时与 clipboard-changed 事件共用：
   * 唤起路径必须首帧即最终列表态，不能等 +300ms manual 采集才把新条目顶到首行。 */
  const mergeTopClip = async (): Promise<void> => {
    const request = searchRequestRef.current;
    try {
      const result = await invoke<QueryClipPayload>("search_clip_records", {
        input: { bucket: typeof request.bucket === "string" ? request.bucket : "all", limit: 1 },
      });
      if (!isQueryClipPayload(result)) throw new Error("Invalid search_clip_records payload");
      const topClip = result.items
        .map((item) => normalizeClip(item, settingsRef.current))
        .find((item): item is ClipItem => Boolean(item));
      if (!topClip) return;
      // 快照守卫:首条未变(id+hash)时零 setClips——开面板路径三连刷新的收敛点。
      const head = clipsRef.current[0];
      if (head && head.id === topClip.id && head.contentHash === topClip.contentHash) return;
      const current = clipsRef.current.filter((item) => item.id !== topClip.id);
      const next = [topClip, ...current].slice(0, settingsRef.current.maxStoredItems);
      clipsRef.current = next;
      setClips(next);
      updateViewClipEntryData(viewCacheKey(searchRequestRef.current), next);
      setSelectedId(topClip.id);
    } catch (error) {
      console.error("[CLIPBOARD] incremental refresh failed:", error);
    }
  };

  /** 读取系统剪贴板并入库（startup/manual/shortcut 三种触发来源）。 */
  const captureClipboard = async (reason: "startup" | "manual" | "shortcut") => {
    if (captureInFlightRef.current) return;
    captureInFlightRef.current = true;
    if (reason === "manual") {
      setIsReadingClipboard(true);
      setNativeStatus(tr("main.status.clipboardReading"));
    }
    try {
      const payload = await readClipboard<ClipItem>({ sourceLabel: "Clipboard" });
      if (!isCaptureClipPayload(payload)) throw new Error("Invalid capture_current_clipboard payload");
      const capturedText = (payload.item.plainText || payload.item.content || "").trim();
      if (capturedText) {
        lastSeenClipboard.current = capturedText;
      }
      const result = await syncCapturedClipboardPayload(payload);
      if (result === "created") {
        setNativeStatus(
          reason === "startup"
            ? tr("main.status.clipboardCapturedStartup")
            : reason === "manual"
              ? tr("main.status.clipboardCapturedManual")
              : reason === "shortcut"
                ? tr("main.status.clipboardCapturedShortcut")
                : tr("main.status.clipboardCapturedNew"),
        );
      } else {
        setNativeStatus(tr("main.status.clipboardPromoted"));
      }
    } catch (error) {
      setNativeStatus(formatNativeError(error));
    } finally {
      captureInFlightRef.current = false;
      if (reason === "manual") setIsReadingClipboard(false);
    }
  };

  // 后台剪贴板监听：Rust 线程每 100ms 读 pbpaste，变化时推 event；
  // 前端只需 listen，不依赖 WebView timer，隐藏时也能工作。挂载时顺带做一次 startup 采集兜底。
  useEffect(() => {
    if (isSettingsWindow) return;
    let unlisten: (() => void) | null = null;
    // U1（RS-51 P1 4.6）：changeCount 已是 Rust 端单调递增序号。闸门按序号丢
    // 乱序/重复事件；处理中的并发事件只保留最新一条排队补跑——事件风暴下
    // search_clip_records 调用收敛，不再每个事件一次全量刷新。
    const gate = createClipboardEventGate<ClipboardChangedEvent>();
    const handleChangedEvent = async (payload: ClipboardChangedEvent) => {
      const request = searchRequestRef.current;
      // 纯列表视图：只取最新 1 条做增量合并（置顶/按 id 去重），不全量刷新 200 行。
      // 解决「每次复制一次 70ms+2MB IPC 的卡顿尖峰」和「分页后列表被截断回 200 条」。
      if (isPlainListRequest(request)) {
        await mergeTopClip();
        if (payload.preview) {
          lastSeenClipboard.current = payload.preview.trim();
        }
        setNativeStatus(tr("main.status.clipboardCapturedNew"));
        return;
      }
      // 搜索/过滤/回收站视图：后端已入库，按当前请求全量刷新（保留已加载条数，不截断）。
      try {
        const result = await invoke<QueryClipPayload>("search_clip_records", {
          input: { ...request, limit: Math.max(200, clipsRef.current.length), cursor: null },
        });
        if (!isQueryClipPayload(result)) throw new Error("Invalid search_clip_records payload");
        const items = result.items
          .map((item) => normalizeClip(item, settingsRef.current))
          .filter((item): item is ClipItem => Boolean(item));
        clipsRef.current = items;
        setClips(items);
        setNextCursor(result.nextCursor ?? null);
        updateViewClipEntryData(viewCacheKey(request), items, result.nextCursor ?? null);
        // U2：后台事件刷新不劫持选中态——当前选中仍在列表内时保留；
        // 列表为空或选中项已被过滤掉时才回落到首条。
        const keepId = selectedIdRef?.current ?? null;
        if (!(keepId && items.some((item) => item.id === keepId)) && items.length > 0) {
          setSelectedId(items[0].id);
        }
        if (payload.preview) {
          lastSeenClipboard.current = payload.preview.trim();
        }
        setNativeStatus(tr("main.status.clipboardCapturedNew"));
      } catch (error) {
        console.error("[CLIPBOARD] refresh failed:", error);
      }
    };
    const dispatchChangedEvent = (payload: ClipboardChangedEvent) => {
      const decision = gate.submit(payload.changeCount, payload);
      // queued 的事件由正在跑的处理循环经 finish() 接管，这里不得再起一个循环
      if (decision !== "run") return;
      let current = payload;
      void (async () => {
        for (;;) {
          try {
            await handleChangedEvent(current);
          } catch (error) {
            console.error("[CLIPBOARD] change event handling failed:", error);
          }
          const next = gate.finish();
          if (!next) return;
          current = next.data;
        }
      })();
    };
    const setup = async () => {
      unlisten = await listen<ClipboardChangedEvent>("clipboard-changed", (event) => {
        if (!event.payload.hasChange) return;
        dispatchChangedEvent(event.payload);
      });
      setNativeStatus(tr("main.status.clipboardWatcherStarted"));
    };
    void setup();
    void captureClipboard("startup");
    return () => {
      if (unlisten) unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSettingsWindow, tr]);

  return { appendLoadedClips, loadMoreClips, syncCapturedClipboardPayload, captureClipboard, mergeTopClip };
}
