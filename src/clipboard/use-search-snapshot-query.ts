// 列表数据加载效果（S5 从 App.tsx 迁出）：SWR 快照回放 + search_clip_records 后台校验。
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import type { TranslationKey } from "../i18n";
import type { AppSettings } from "./app-settings";
import type { ClipItem } from "./clip-model";
import { normalizeClip } from "./clip-model";
import { peekViewClipEntry, setViewClipEntry } from "./view-clip-cache";
import { isQueryClipPayload, type QueryClipPayload } from "./use-clipboard-list";
import type { SearchClipsRequest } from "./clip-search";
import { logAppError } from "./panel-shared";

export function useSearchSnapshotQuery(options: {
  isSettingsWindow: boolean;
  searchRequestKey: string;
  settingsRef: { current: AppSettings };
  clipsRef: { current: ClipItem[] };
  selectedIdRef: { current: string | null };
  searchRequestRef: { current: SearchClipsRequest };
  setClips: React.Dispatch<React.SetStateAction<ClipItem[]>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setNextCursor: React.Dispatch<React.SetStateAction<string | null>>;
  setRestoreScroll: React.Dispatch<React.SetStateAction<{ top: number; token: string } | null>>;
  restoreScrollTokenRef: { current: number };
  setNativeStatus: (status: string) => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const o = options;
  // setter/ref 经 o 引用总是最新，deps 只需驱动重跑的 searchRequestKey/tr。
  const { searchRequestKey, tr } = o;
  useEffect(() => {
    if (o.isSettingsWindow) return;
    let cancelled = false;
    const request = JSON.parse(searchRequestKey) as SearchClipsRequest;
    o.searchRequestRef.current = request;
    // SWR(panel-list-perf):先回放缓存快照——命中即零 IPC,列表/游标/选中/滚动一次到位,
    // 消除切视图时「在途期间旧数据被新视图过滤成空态」的闪烁;随后后台拉新校验。
    const cached = peekViewClipEntry(searchRequestKey);
    if (cached) {
      o.clipsRef.current = cached.items;
      o.setClips(cached.items);
      o.setNextCursor(cached.nextCursor);
      o.setSelectedId(
        cached.selectedId && cached.items.some((item) => item.id === cached.selectedId)
          ? cached.selectedId
          : (cached.items[0]?.id ?? null),
      );
    } else {
      // 未命中(首次进视图/写操作已失效):游标先清零,防止旧视图游标冒充新视图的 hasMore。
      o.setNextCursor(null);
    }
    // 每次视图切换都驱动一次滚动恢复:命中用快照 scrollTop,未命中回顶。
    o.restoreScrollTokenRef.current += 1;
    o.setRestoreScroll({ top: cached?.scrollTop ?? 0, token: String(o.restoreScrollTokenRef.current) });
    invoke<QueryClipPayload>("search_clip_records", { input: request })
      .then((payload) => {
        if (cancelled) return;
        if (!isQueryClipPayload(payload)) throw new Error("Invalid search_clip_records payload");
        const items = payload.items
          .map((item) => normalizeClip(item, o.settingsRef.current))
          .filter((item): item is ClipItem => Boolean(item));
        // 快照守卫:服务端首条与当前列表首条一致(id+hash)时跳过 setClips——
        // 同时保住快照里已分页加载的条数(整表替换会被 limit 截断回 200)。
        const head = o.clipsRef.current[0];
        if (!head || head.id !== items[0]?.id || head.contentHash !== items[0]?.contentHash) {
          o.clipsRef.current = items;
          o.setClips(items);
        }
        o.setNextCursor(payload.nextCursor ?? null);
        o.setSelectedId((current) =>
          current && items.some((item) => item.id === current) ? current : (items[0]?.id ?? null),
        );
        // 回写快照:items 取 clipsRef(守卫跳过时保留分页态);scrollTop 沿用快照对象的最新值。
        setViewClipEntry(searchRequestKey, {
          items: o.clipsRef.current,
          nextCursor: payload.nextCursor ?? null,
          scrollTop: cached?.scrollTop ?? 0,
          selectedId: o.selectedIdRef.current,
        });
      })
      .catch((error) => {
        if (!cancelled) {
          logAppError("warn", "Search clip records failed", String(error));
          o.setNativeStatus(tr("main.status.searchFailed"));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.isSettingsWindow, searchRequestKey, tr]);
}
