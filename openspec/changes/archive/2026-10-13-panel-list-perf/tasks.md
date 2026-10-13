# 任务：主面板列表性能修复

> 设计见 [design.md](./design.md)。每个任务完成后必须 `pnpm build:web` + `cd src-tauri && cargo check` + `pnpm test:unit` + `pnpm test:boundaries` 全绿。

## Phase 1：Rust 数据层（高优先级，必须先做）

- [x] `search_clip_records` 改为单次 JOIN 查询，不再循环 `load_clip`。
  - 文件：`src-tauri/src/lib.rs`（FTS/非 FTS 两分支同构 38 列直出；行映射抽取为共享 `clip_item_from_row`，`load_clip` 复用同 mapper）。
  - 边界：保持现有过滤语义（FTS、bucket、kind、type、tag、fileExtensions、favorite、cursor）。
- [~] 新增 `ClipListItemPayload`，`search_clip_records` 返回列表精简字段。
  - **缓议**：排查发现复制/聚合读列表 state 的 `item.content`、detail workspace 读列表 state 的 `analysis.attachment`/`metadata.aiSummary`——列表态即详情态，瘦身需先解耦详情读取路径。降级为后续提案（design.md §4.2）。
- [~] Rust 侧落库 `analysis` 字段（source/kind/title/summary/url/host/attachment）并随列表返回。
  - **缓议**（随上一条）：改为前端按 contentHash memo（design.md §4.3）；Rust analysis 无 attachment 等价列，「信任 Rust」方案不可行。
- [x] `cargo check` + `cargo fmt --check` 通过。

## Phase 2：前端列表缓存（中优先级，依赖 Phase 1）

- [x] 视图快照缓存落地：`src/clipboard/view-clip-cache.ts`（模块级 Map，`{items, nextCursor, scrollTop, selectedId}`，MAX 512 LRU）。
  - 〔实现修订：从原设计「use-clipboard-list 内 useRef + Map<ViewKey>」改为独立模块文件，失效入口与写回域解耦〕
- [x] App.tsx 搜索 effect 改 SWR：key 变化先回放缓照（列表/游标/选中/滚动，零 IPC）再后台拉新；拉新头部守卫（id+contentHash）可跳过 setClips 并保住分页条数。
  - 〔实现修订：不做 bucket:"all" 合并，收藏视图是服务端 favorite:true 过滤，两视图本就是不同请求〕
- [x] `clipboard-changed` 纯列表视图只走 `mergeTopClip`，非纯列表视图全量刷新（保住已加载条数）并同步当前 key 快照。
- [x] 开面板 `mergeTopClip` 加首条一致跳过守卫（id+contentHash，同样覆盖 syncCaptured 与 SWR 拉新路径）。
- [x] 移除 4 处 `clipboard-changed`/合并路径的无条件 `setActiveView("history")` yank（唤起路径 App.tsx 的复位保留）。

## Phase 3：VirtualList 稳定化（中优先级）

- [x] 移除 `QuickPastePanel` 的 `key={`quick:${activeView}`}`；`TrashPanel` 的 key 在三元分支内恒定（惰性），保留。
- [x] `VirtualList` 新增 `onScrollTopChange` 回调（rAF 内连续回写快照）+ `restoreScroll: {top, token}` prop（token 单调递增，effect 即时定位）。
- [x] App.tsx 经 QuickPastePanel/TrashPanel 透传两条 props，滚动随快照存取。
- [x] `row-animation.ts` epoch 改用 items id 序列摘要（`${length}:${hash}`），同集合新引用不再重放 row-in；`run-unit-checks.mjs` 用例同步改造并补「同集刷新静默」断言。

## Phase 4：normalizeClip 复分析收敛（高优先级）

- [x] `normalizeClip` 按 contentHash memo `analyzeContent`/`detectKind` 结果（512 条上限，FIFO 驱逐；两函数为纯函数、不依赖 settings，memo 安全）。
  - 〔实现修订：替代原「信任 Rust analysis」方案，见 design.md §4.3〕
- [x] `generateTags` 优先复用 Rust 返回的 `tags`（既有行为确认保留）；`size` 在 `raw.size` 存在时跳过 Blob 计算。
- [~] 前端消费 `QueryClipPayload` 的各处适配 `ClipListItemPayload`——**缓议**（随 Phase 1 瘦身缓议，payload 形状不变无需适配）。

## Phase 5：写回域缓存失效（中优先级）

- [x] `use-clip-writeback.ts` 接线失效：`applyNormalizedToClips`（单点覆盖 copy/paste/aggregate/edit-saved）、`markClipCopied`、`updateClip`、`favoriteSelectedClips`、`copySelectedClips`。
- [x] `deleteClips`/`restoreClips`/`hardDeleteClips`（`emptyTrash` 委托 hardDelete）在 App.tsx 原地接失效；三处同步补 `clipsRef` 回写（守卫读 ref，不同步会复活已删条目）。
- [x] 与 `verify-runtime-boundaries` 对齐：不改命令名无冲突；未新增断言（该脚本锚点为命令序列，不感知缓存层）。
- [x] 失效入口独立文件 `src/clipboard/use-clip-cache-invalidation.ts`（writeback 主文件 492/500 行，不破门禁）。

## Phase 6：死代码清理（低优先级）

- [x] 移除 `setScrollOffset`/`setSearchCompact`/`handleScroll`/section `onScroll`（连 `UIEvent` 类型导入一并清）。

## Phase 7：验证与收口

- [x] `pnpm build:web` + `cargo check` + `cargo fmt --check` + `pnpm test:unit` + `pnpm test:boundaries` 全绿。
- [x] 静态自审替代对抗 review workflow：Rust 38 列与 `row.get` 索引逐列核对；全部 `setClips` 调用点 vs `clipsRef` 同步审计（补 favoriteSelected/copySelected 两处）；memo 纯函数性核对；`setActiveView` 残留调用审计（仅唤起复位 + tab 切换两处合法）。
  - 注：原计划 5 维对抗 review workflow 因账号 5h 配额耗尽全部 403，改为本人逐点自审；配额恢复后可补跑。
- [~] 沙箱实机验证（自动部分已过，视觉部分待人工）：
  - ✅ 数据链路：692 条真实数据（生产库拷贝进沙箱）加载正常；`clipboard-promote: local merge` 守卫路径实机打点命中。
  - ✅ `quick.scroll` P95 = 1ms（200 行挂载、raf 采样，预算 300ms）；16 条库对照 15ms/31ms worst（样本被 open 帧污染，仍远低预算）。
  - ✅ `panel.open` P95 = 182ms，16 条与 692 条库完全一致 → 固定开销，与数据量/JOIN 无关（旧 N+1 在 200 条下只会更差）。
  - ⚠️ 窗口级 `perf-panel-probe`：hide 5ms ✓；show 超时/幻影 blur 判 FAIL 系环境因素——lib.rs 改动触发重编译，新 adhoc 签名 cdHash 丢失 TCC Accessibility 信任，`universalAccessAuthWarn` 窗口反复抢焦点（日志显示 toggle 决策与 phantom-blur reclaim 逻辑本身均正确）。需用户为重编译的二进制重新授权后复测。
  - ❌ 未验证（需人工眼睛）：切视图无闪烁/滚动保持/row-in 不整窗重放；quick.copy/paste span（探针粘贴目标因同一权限问题 skip）。
  - ⏳ 视觉走查自动化进展（.work/panel_visual_probe.py，截图驱动）：合成滚轮滚动/截图已跑通（01/02 帧真实反映滚动）；Tab 切视图被环境阻断——NSPanel 是 nonactivating panel（show 不改 frontmost），keyWindow 被 Ghostty/UserNotificationCenter 反复抢走，合成 Tab/t 打进前台终端；脚本已加 rekey（点搜索框重新置 key）待 dev 实例重启复跑。走查判定标准：04-history-back.png 的滚动位置应等于 02-history-scrolled.png。
- [x] 探针基建修复：`dev_quick_probe_script` DOM 选择器随 tailwind-v3 重构已烂尾（`.quick-menu/.quick-row` 不存在），更新为 `.thin-scroll`/`article`；新增 `CLIPFORGE_DEV_QUICK_PROBE=scroll` 纯滚动模式（无需受控粘贴目标——重编译丢 TCC 信任时前台识别失败会连坐滚动采样）。
- [x] 更新 `docs/PROPOSAL_ROADMAP.md` 中 `panel-list-perf` 进度。

## 状态记录

- 2026-10-10：提案/设计/任务三件套建立；归入 W1；与 `codebase-modularity-refactor` 接缝写入该提案 tasks.md。
- 2026-10-10：全部编码任务完成（Phase 1-6 + 7 的静态部分）；payload 瘦身与分析落库两条缓议（design.md §4.2/§4.3 修订说明）。
- 2026-10-10：沙箱自动验收（692 条真实数据）：quick.scroll P95=1ms / panel.open P95=182ms（与数据量无关）均达标；探针基建修复（选择器 + scroll 模式）；剩视觉项（切换闪烁/滚动保持/row-in）与 copy/paste span 需 TCC 重新授权后人工/复测。
- 2026-10-10（晚）：视觉走查改截图驱动半自动推进；确认面板 hide/show/blur-keep 逻辑实机正确（pinned 后多次 blur hide cancelled）；keyWindow 抢占是纯环境干扰。dev 实例退出后待重启复跑 rekey 版脚本。对抗 review workflow 待配额恢复补跑。
