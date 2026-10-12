/** 视图列表快照缓存(panel-list-perf):按 searchRequestKey 缓存 items/游标/滚动位置/选中项。
 *  切换视图先回放快照再决定是否重查——命中即零 IPC,消除「在途期间旧数据被新视图过滤出空态」的闪烁。
 *  失效纪律:写操作(更新/收藏/复制/粘贴/删除/恢复)调 clearViewClipCache() 清全部;
 *  采集类增量合并走 updateViewClipEntry 同步当前 key,避免每次复制都废掉全部缓存。 */
import type { ClipItem } from "../App";

export type ViewClipCacheEntry = {
  items: ClipItem[];
  nextCursor: string | null;
  scrollTop: number;
  selectedId: string | null;
};

/** key 必须与 App.tsx 的 searchRequestKey 同源:JSON.stringify(searchRequest)。 */
const entries = new Map<string, ViewClipCacheEntry>();
/** 上限:searchRequestKey 组合有限(视图×过滤×搜索词截断后),512 足够覆盖常用组合,防长搜索词撑爆。 */
const MAX_ENTRIES = 512;

export function peekViewClipEntry(key: string): ViewClipCacheEntry | undefined {
  return entries.get(key);
}

export function setViewClipEntry(key: string, entry: ViewClipCacheEntry): void {
  // 重建写入以维持 Map 插入序(LRU 驱逐依据)。
  entries.delete(key);
  entries.set(key, entry);
  if (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (typeof oldest === "string") entries.delete(oldest);
  }
}

/** 增量合并路径(采集置顶/分页追加/过滤视图刷新)用:保留原 scrollTop/selectedId,
 *  只换数据;nextCursor 省略时保留原游标(采集置顶场景游标不变)。 */
export function updateViewClipEntryData(key: string, items: ClipItem[], nextCursor?: string | null): void {
  const current = entries.get(key);
  if (!current) return;
  current.items = items;
  if (nextCursor !== undefined) current.nextCursor = nextCursor;
}

/** 滚动位置连续回写:VirtualList onScrollTopChange → 这里,避免快照滞后一帧。 */
export function saveViewScrollTop(key: string, scrollTop: number): void {
  const current = entries.get(key);
  if (current) current.scrollTop = scrollTop;
}

export function clearViewClipCache(): void {
  entries.clear();
}
