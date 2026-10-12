# 提案：主面板列表性能修复

> 所属波次：[product-iteration-master-plan](../product-iteration-master-plan/proposal.md) W1 核心闭环收口。

## 优先级

P0（W1 支撑项）。不抢占实机验收矩阵，但与 `file-image-clipboard-support`、`clipboard-multi-format-fidelity`、`tailwind-v3-style-refactor` 并行推进，目标是把 `quick.scroll/select/copy/paste` P95 压到 ≤ 300ms。

## 背景

性能评审确认主面板列表存在六处瓶颈：

1. 切视图（history/favorites/trash）触发全量 `search_clip_records` IPC，在途返回前列表清空闪烁。
2. `QuickPastePanel`/`TrashPanel` 的 `key` 含 `activeView`，切换视图强制重挂载 → 滚动复位 + 整窗 row-in 动画重放。
3. Rust 侧 `search_clip_records` 先查 id 再逐条 `load_clip`(每条一次,200 条即 200 次;全仓另有 13 处同模式调用点,本提案只先改此热路径),且返回全字段(约 2MB IPC);前端 `normalizeClip` 又对每条重新跑 `analyzeContent`/`detectKind`。
4. `clipboard-changed` 事件无条件 `setActiveView("history")` + 过滤视图全量刷新。
5. 开面板时 `mergeTopClip` + `captureClipboard("manual")` + 视图 effect 多次 `setClips`，500ms 内三次重渲染。
6. `App.tsx` 中 `handleScroll` 只写不读 `scrollOffset`/`searchCompact`，是死代码。

## 目标

1. 视图切换走缓存：按 `searchRequestKey` 缓存 items + cursor + scrollTop + selectedId（SWR：先回放缓照零 IPC，再后台拉新校验）。〔实现修订：原「history/favorites 共用 bucket:"all"」不成立——收藏视图是服务端过滤（favorite:true），两视图本就是不同请求，见 design.md §2.1〕
2. 列表渲染稳定：`QuickPastePanel` 移除 activeView key；滚动位置按 key 存取；row-in 动画 epoch 改用 id 摘要判定数据集变化。
3. 数据层瘦身：`search_clip_records` 改为单次 38 列 JOIN 直出（消 N+1）；payload 瘦身**缓议**（列表态即详情态，复制/详情都读列表 state，见 design.md §4.2）；`normalizeClip` 按 contentHash memo 分析结果，不复跑分析器。〔实现修订：不用「信任 Rust analysis」——Rust 无 attachment 等价列，见 design.md §4.3〕
4. 刷新收敛：`clipboard-changed` 纯列表视图只增量合并首条，不切换视图、不全量刷新；搜索/过滤/回收站视图保留后端刷新（保住已分页条数）。
5. 开面板去重：`mergeTopClip`/采集合并/视图拉新加首条一致（id+contentHash）跳过守卫，避免重复 setClips。
6. 清理死代码：移除 `handleScroll` 及无消费的状态。

## 非目标

- 不引入新状态管理库；SWR 缓存用 `useRef` / 轻量 hook 实现，为后续 Zustand store 化留接口。
- 不改搜索语义、命令名、配置字段、外部行为。
- 不重构 UI JSX 或写回域深链；只做性能修复，把结构重构留给 `codebase-modularity-refactor`。
- 不迁移持久化层；继续用现有 SQLite schema，仅优化查询方式。

## 用户价值

- 主面板切换 history/favorites/trash 不再闪白、滚动位置保持。
- 复制后列表顶部更新更轻，不再出现 2MB IPC 尖峰和整窗动画重放。
- 为 W1 性能基线 P95 ≤ 300ms 提供数据层保障。

## 成功标准

- `pnpm build` + `cd src-tauri && cargo check` + `pnpm test:unit` + `pnpm test:boundaries` 全绿。
- `window.__clipforgePerf.summary()` 中 `quick.scroll/select/copy/paste` P95 ≤ 300ms（沙箱探针）。
- 视图切换无空态闪烁、滚动位置保持、row-in 动画只在数据变化时播放。
- `search_clip_records` 不再对 200 条结果做 N+1 `load_clip`。

## 与现有提案的关系

| 提案 | 关系 |
|------|------|
| product-iteration-master-plan | W1 支撑项；性能基线退出条件依赖本提案 |
| codebase-modularity-refactor | 本提案只改行为/数据流，不动结构；搜索域/UI JSX/写回域深链等重构切片需在本提案后 rebase |
| tailwind-v3-style-refactor | 不动样式；列表动画由 `row-animation.ts` epoch 控制，与 Tailwind 类无冲突 |
| clipboard-data-integrity | 写回后缓存失效策略由本提案统一，不破坏数据一致性 |
