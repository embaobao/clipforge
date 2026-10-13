# 设计：主面板列表性能修复

## 1. 核心原则

1. **最小 diff**：每处修复只改必要的调用/查询/key，不借性能之名做结构重构。
2. **行为等价**：搜索语义、视图过滤、收藏/回收站行为不变；只优化实现路径。
3. **缓存是读透层**：缓存只存 `items + nextCursor + scrollTop`，不替代 React state；状态所有权仍在 `App.tsx`。
4. **先 Rust 后前端**：payload 瘦身和 N+1 消除必须先落 Rust，前端再停止复分析。

## 2. 视图缓存（修复 #1、#4）

### 2.1 按 searchRequestKey 的 SWR 快照（实现修订）

> 修订说明：原设计「history/favorites 共享 `bucket:"all"` 缓存」不成立——`buildSearchClipsRequest` 对收藏视图下发的是服务端过滤（`favorite:true`），两视图本就是不同请求；强行合并会改变收藏语义。落地为**按 key 缓存**：`searchRequestKey = JSON.stringify(searchRequest)` 每个请求一个快照。

- 每个 key 一份快照：`{ items, nextCursor, scrollTop, selectedId }`。
- 切视图（key 变化）时：**先回放缓照**——命中即零 IPC，列表/游标/选中/滚动一次到位，消除「在途期间旧数据被新视图过滤成空态」的闪烁；**随后后台拉新校验**（SWR）。
- 拉新结果做头部守卫：服务端首条与当前列表首条一致（id+contentHash）时跳过 `setClips`——同时保住快照里已分页加载的条数（整表替换会被 limit 截断回 200）。
- 未命中（首次进视图/写操作已失效）：游标先清零，恢复滚动到顶，等待拉新。

### 2.2 缓存结构

模块级单例 `src/clipboard/view-clip-cache.ts`（非 hook 内 useRef——失效入口要与写回域解耦）：

```ts
type ViewClipCacheEntry = {
  items: ClipItem[];
  nextCursor: string | null;
  scrollTop: number;
  selectedId: string | null;
};
const entries = new Map<string, ViewClipCacheEntry>(); // MAX_ENTRIES=512，LRU 驱逐
```

- `peekViewClipEntry` / `setViewClipEntry`（重建写维持 LRU 序）/ `updateViewClipEntryData`（增量合并：只换 items/游标，保留 scrollTop/selectedId）/ `saveViewScrollTop` / `clearViewClipCache`。
- **失效纪律**：写操作（更新/收藏/复制/粘贴/软删/恢复/硬删/编辑保存）经 `use-clip-cache-invalidation.ts` 清全部快照；采集类增量合并（`mergeTopClip`/`syncCaptured`/分页 `loadMore`）走 `updateViewClipEntryData` 只同步当前 key，避免每次复制废掉全部快照。
- `clipboard-changed` 纯列表视图只调用 `mergeTopClip`；非纯列表视图全量刷新（保留已加载条数）并同步当前 key 快照。

### 2.3 滚动位置

`VirtualList` 增加 `onScrollTopChange` 回调 + `restoreScroll: { top, token }` prop：
- 滚动期间 rAF 内连续回写 `saveViewScrollTop(currentKey, top)`，快照不滞后；
- 切视图时 App 递增 token 并下发 `restoreScroll`（命中用快照 scrollTop，未命中回顶），VirtualList 以 `[restoreScroll?.token]` 为依赖 effect 执行 `behavior:"auto"` 即时定位；token 单调递增保证同 key 再进也触发。

## 3. 列表 key 与动画（修复 #2）

### 3.1 key 固定

移除 `QuickPastePanel` 的 `key={`quick:${activeView}`}`：history↔favorites 不再重挂载，滚动/多选/上下文菜单状态延续。`TrashPanel` 的 key 在三元分支内恒为 `trash:trash`（惰性），trash↔非 trash 本就因组件类型不同自然重挂载，保留不动。

### 3.2 滚动复位消除

`VirtualList` 内部滚动位置由外部 `scrollTop` prop 控制；切换视图时外部注入目标 view 的缓存 `scrollTop`，组件用 `useLayoutEffect` 同步到 DOM。

### 3.3 动画 epoch 改用 id 摘要

当前 `row-animation.ts` 的 `advanceRowAnimEpoch` 按 `items` 引用比较。改为按 items 的 id 集合摘要：

```ts
function clipsDigest(items: { id: string }[]): string {
  let hash = 0;
  for (const item of items) {
    for (let i = 0; i < item.id.length; i++) {
      hash = (hash << 5) - hash + item.id.charCodeAt(i);
      hash |= 0;
    }
  }
  return `${items.length}:${hash}`;
}
```

滚动回填不修改 items id 集合，digest 不变 → 不播 row-in。

## 4. 数据层瘦身（修复 #3）

### 4.1 Rust 批量 JOIN

`search_clip_records` 当前先 `SELECT id FROM clips ...` 再循环 `load_clip(id)`。改为单次查询：

```sql
SELECT clips.id, content, content_hash, primary_format, available_formats, representations_json,
       plain_text, search_text, sub_kind, width, height, size, file_types, thumbnail_path,
       image_file, is_sensitive, capture_context_json, metadata_json, agent_context_json,
       kind, bucket, source_label, favorite, tags, copy_count,
       created_at, updated_at, last_seen_at, last_copied_at, title, summary, url, host,
       source_app_name, source_app_bundle, source_app_executable, source_app_icon, payload_kind
FROM clips
WHERE ...
ORDER BY clips.last_seen_at DESC LIMIT ?
```

直接 `query_map` 构建 `ClipItemPayload`，不再调用 `load_clip`。

### 4.2 payload 瘦身（本轮缓议）

> 缓议说明：排查发现**列表态即详情态**——复制/聚合路径读列表 state 的 `item.content`，detail workspace 读列表 state 的 `.analysis.attachment`/`.metadata.aiSummary`，编辑保存直接 `applyNormalizedToClips` 回写。preview_only 瘦身要求详情/复制改走 `load_clip` 二次取数，改动面远超性能收益（JOIN 直出后单次载荷已从 200 次行查询降为 1 次）。降级为后续提案，依赖：详情读取路径先与列表 state 解耦。

`search_clip_records` 维持返回完整 `ClipItemPayload`（38 列 JOIN 直出）。

### 4.3 前端复分析 memo 化（实现修订）

> 修订说明：原设计 `trustAnalysis` 不成立——Rust 侧 analysis 无 `attachment` 等价列，信任 Rust 会丢字段。落地为**按 contentHash memo**：模块级 `Map<contentHash, {analysis, kind}>`（512 条 LRU），同一条目在采集合并/后台刷新/快照回放等多路径反复 normalizeClip 时命中缓存，`analyzeContent`/`detectKind` 只在首次执行。

`generateTags` 优先复用 Rust 返回的 `tags`（已存在行为，确认保留）；`size` 在 `raw.size` 存在时跳过 Blob 计算。

## 5. 刷新收敛（修复 #4、#5）

### 5.1 开面板

`showQuickPanel` 调用 `mergeTopClip` 前加守卫：

```ts
if (clipsRef.current[0]?.id !== topClip.id) {
  setClips(next);
  setSelectedId(topClip.id);
}
```

避免首条已一致时重复 setClips。

### 5.2 后台变化

`clipboard-changed` 纯列表视图只走 `mergeTopClip`（带同款头部守卫）；非纯列表视图保留后端全量刷新，但 `limit: Math.max(200, clipsRef.current.length)` 保住已分页条数，并同步当前 key 快照。同请求在途去重未做（事件频率低 + 头部守卫已收敛渲染），留作观察项。

## 6. 死代码清理（修复 #6）

移除 `App.tsx` 中：

- `const [, setScrollOffset] = useState(0);`
- `const [, setSearchCompact] = useState(false);`
- `handleScroll` 函数（或改为只转发给 `VirtualList` 的 `onUserScroll`，如果后续需要）。

`VirtualList` 已有自己的滚动处理，`App.tsx` 不需要再通过 state 监听滚动。

## 7. 与重构的接缝

| 重构切片 | 接缝 |
|---------|------|
| `codebase-modularity-refactor` search 域提取 | 等本提案缓存/请求构建落地后再提取；提取时保持 `clipsByView` 缓存接口 |
| `codebase-modularity-refactor` UI JSX 切片 | 等 `VirtualList` key/scroll/animation 变更后再切列表参数组装；新组件 props 直接复用 |
| `codebase-modularity-refactor` 写回域深链 | 缓存失效入口为独立文件 `use-clip-cache-invalidation.ts`(`use-clip-writeback.ts` 已 482 行,直接叠加易破 500 行门禁);深链迁移时失效逻辑随入口一起下沉,消费侧不变 |
| `codebase-modularity-refactor` lib.rs window/log/tray | 本提案只改 search_clip_records/load_clip，不碰 window/log/tray，顺序无关 |

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 列表态即详情态，瘦身缺字段 | §4.2 已缓议；详情读取路径与列表 state 解耦后再做 |
| 缓存导致收藏/删除后视图不同步 | 所有写操作（update/delete/restore/favorite/copy/paste/编辑）经 `use-clip-cache-invalidation.ts` 清全部快照；软删/恢复/硬删同时同步 clipsRef（守卫读的是 ref） |
| `use-clip-writeback.ts` 已 482 行，叠加失效逻辑破 500 行门禁 | 失效逻辑放独立文件 `src/clipboard/use-clip-cache-invalidation.ts`，写回 hook 仅调用；不加 file-size 豁免 |
| 滚动位置恢复造成视觉跳动 | `behavior:"auto"` 即时定位 + token 驱动单次执行；恢复触发的 onScroll 回写同值无抖动；首启无缓存自然从 0 开始 |
| N+1 改 JOIN 后复杂过滤性能下降 | 保持现有索引；FTS/path/文件扩展过滤仍用子查询/IN，只把 id 循环改为单次多列查询 |

## 9. 验证

1. `pnpm build` + `cd src-tauri && cargo check` + `pnpm test:unit` + `pnpm test:boundaries`。
2. `CLIPFORGE_DATA_DIR=$(mktemp -d) pnpm dev:sandbox` 实机：
   - 复制 10 条后切换 history/favorites/trash，观察无闪烁、滚动保持。
   - 快速滚动 200 条，确认无 row-in 整窗重放。
   - `window.__clipforgePerf.summary()` P95 ≤ 300ms。
3. 若本机无法跑 Tauri dev，在 `tasks.md` 明确标为未验证项。
