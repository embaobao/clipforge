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

export type ClipboardListOptions = {
  isSettingsWindow: boolean;
  setClips: React.Dispatch<React.SetStateAction<ClipItem[]>>;
  clipsRef: { current: ClipItem[] };
  setNextCursor: (cursor: string | null) => void;
  nextCursor: string | null;
  setIsLoadingMore: (loading: boolean) => void;
  isLoadingMore: boolean;
  setSelectedId: (id: string) => void;
  setActiveView: (view: "history" | "favorites" | "trash") => void;
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
  setActiveView,
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
    try {
      const result = await invoke<QueryClipPayload>("search_clip_records", {
        input: {
          bucket: "all",
          limit: 200,
        },
      });
      if (!isQueryClipPayload(result)) throw new Error("Invalid search_clip_records payload");
      const items = result.items
        .map((item) => normalizeClip(item, settingsRef.current))
        .filter((item): item is ClipItem => Boolean(item));
      clipsRef.current = items;
      setClips(items);
      setNextCursor(result.nextCursor ?? null);
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
    setActiveView("history");
    return payload.status;
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
    const setup = async () => {
      unlisten = await listen<{ changeCount: number; hasChange: boolean; preview?: string; previewLen?: number }>("clipboard-changed", async (event) => {
        const payload = event.payload;
        console.log("[CLIPBOARD] frontend received change:", payload);
        if (!payload.hasChange) return;
        // 后端已入库，前端直接从数据库刷新列表
        try {
          const result = await invoke<QueryClipPayload>("search_clip_records", {
            input: searchRequestRef.current,
          });
          if (!isQueryClipPayload(result)) throw new Error("Invalid search_clip_records payload");
          const items = result.items
            .map((item) => normalizeClip(item, settingsRef.current))
            .filter((item): item is ClipItem => Boolean(item));
          clipsRef.current = items;
          setClips(items);
          setNextCursor(result.nextCursor ?? null);
          if (items.length > 0) {
            setSelectedId(items[0].id);
            setActiveView("history");
          }
          if (payload.preview) {
            lastSeenClipboard.current = payload.preview.trim();
          }
          setNativeStatus(tr("main.status.clipboardCapturedNew"));
        } catch (error) {
          console.error("[CLIPBOARD] refresh failed:", error);
        }
      });
      console.log("[CLIPBOARD] frontend listener registered");
      setNativeStatus(tr("main.status.clipboardWatcherStarted"));
    };
    void setup();
    void captureClipboard("startup");
    return () => {
      if (unlisten) unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSettingsWindow, tr]);

  return { appendLoadedClips, loadMoreClips, syncCapturedClipboardPayload, captureClipboard };
}
