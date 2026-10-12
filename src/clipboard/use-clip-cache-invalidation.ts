/** 写回域缓存失效入口(panel-list-perf):所有改变条目集合/排序的写操作集中清视图快照缓存。
 *  独立成文件的原因:use-clip-writeback.ts 已近 500 行门禁,失效逻辑不叠加进去。
 *  失效后下一次视图切换重新拉取(spec「Cache invalidation after mutation」场景)。 */
import { clearViewClipCache } from "./view-clip-cache";

export function invalidateViewClipCache(): void {
  clearViewClipCache();
}
