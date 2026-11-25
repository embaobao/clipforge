# 任务：代码可维护性地基重构

> 原则见 [design.md](./design.md)。每个切片必须保持行为不变，且 `pnpm build` + `cargo check` + 全部 verify 脚本通过才算完成。
> 执行计划（2026-11-25，债账 + 按 TDD 切片的顺序）：[execution-plan.md](./execution-plan.md)。每片先写失败断言再平移代码，收账时只勾实测通过的项。

## Phase 1：规范与门禁

- [x] 立 `AGENTS.md` 开发规范：≤500 行 / 中文注释 / 组件化 / 样式拆分
- [x] 新增 `scripts/file-size-exemptions.json`（当前豁免清单：App.tsx/settings.tsx/agent-panel.tsx/agent-chat-page.tsx/workspace-panels.tsx/contracts.ts/lib.rs）
- [x] 新增 `scripts/verify-file-size.mjs`：豁免外 >500 行 fail，豁免内只 warn
- [x] `verify-file-size.mjs` 接入 `package.json` 的 `test:unit`
- [x] `AGENTS.md` 引用门禁脚本与豁免清单位置

## Phase 2：verify 脚本升级（拆分前置）

- [x] `verify-agent-panel.mjs`：把依赖源码子串的断言迁移到 `data-*` marker / 导出符号（先升级会被当前拆分触碰的部分）--过时收账:该脚本随旧 Agent 面板在 18afb94 删除,`package.json` 的 `test:agent` 死引用已移除;后继门禁 `verify-editor-agent-bridge.mjs`(test:unit 成员)已完成同等迁移:动作按钮挂 `data-editor-action` 标记,接线断言改 DetailQuickEditor JSX 块级正则,守卫改 token 级检查,快捷键改 handler 内结构正则;i18n 键、saveDraftContent/preview_patch 行为切片与反向断言保留(文件无关,附脆弱性注释)
- [x] 保留必要的反向断言（「某 class 不应存在」），但每条加注释说明为何脆弱
- [x] 升级前后对同一份代码各跑一次，确认「等价或更强」--迁移前基线 passed;迁移后同码 passed;负向证明注入五类破坏全部命中:删标记/外壳接线互换 copy-paste/削弱守卫去 isSaving/快捷键分支互换/preview_patch 注入 save_editor_draft(真 dispatch 臂,注意 lib.rs 有三处 preview_patch 字符串,lastIndexOf 切真臂)

## Phase 3：lib.rs settings 模块拆分（服务 settings-service B3）

- [x] 抽 `src-tauri/src/settings/mod.rs`：SettingsService get/patch/replace/reset + revision + emit（2026-10-08 实际落位 settings_service/mod.rs 门面 485 行）
- [x] 抽 settings 校验域：settings_json_schema/resolve_schema_ref/validate_settings_value/settings_validation_error/validate_settings_patch 五函数（~225 行）迁入 settings_service.rs 并 pub 导出（2026-09-11，lib.rs 14284→14058；实际落位 settings_service.rs 而非新目录，避免多一层模块）
- [x] 抽 `settings/write.rs`：原子写 + Mutex（2026-10-08，319 行，SETTINGS_WRITE_LOCK 私有化 + degraded 语义）
- [x] 抽 `settings/commands.rs`：settings_service_* Tauri command 适配层（2026-10-08，471 行，签名零变化）
- [x] 抽 `settings/mcp.rs`：clipf.settings.*/clipf.agent.* dispatch（2026-10-08，201 行，call_settings_agent_tool 七臂）
- [x] lib.rs 只保留模块声明 + 命令注册，移除 settings 相关内联实现——完成：13410→12850（净减 560≥550），lib.rs 无 SETTINGS_WRITE_LOCK 残余（2026-10-08）
- [x] `cargo check` + `cargo fmt` + verify 脚本通过（test:unit 10 项全绿，2026-10-08）

### Phase 3 评审修订项(2026-10-08 多模型论证,见 [agent-extension-seams/evaluation.md](../agent-extension-seams/evaluation.md) §4)

- [x] 门面单入口:写路径唯一入口 = mod.rs 门面,commands.rs/mcp.rs 禁止自行取 SETTINGS_WRITE_LOCK（acquire 为 pub(super),仅门面调用）
- [x] 锁内规则:持锁期间不 emit、不跨 await、无网络/子进程 I/O;emit 一律在锁释放后
- [x] poisoned 语义:SETTINGS_LOCK_POISONED + 进程级 degraded(写禁用读可用,需重启),不自动重建
- [x] 锁层级表:持锁期间仅允许再取 DB 写连接,禁嵌套其他锁
- [x] MCP dispatch 与错误路径 golden 用例先行(错误码映射/修订冲突文案/patch 合并与 changed_paths 三测冻结,src-tauri settings_service#[cfg(test)] golden_tests)

## Phase 4：lib.rs agent / mcp 模块拆分

- [x] 抽 `agent/`：provider 解析 + run 状态机 + agent_* command（2026-10-08，8 文件 362/465/242/223/376/456/57+context，run 存储锁私有化+poisoned→AGENT_RUNS_LOCK_POISONED+degraded）
- [x] 抽 `mcp/`：run_mcp_stdio + call_mcp_tool + mcp_tool_specs（2026-10-08，8 文件，specs 40 条 golden 冻结；settings_service 依赖解耦走 crate::agent::）
- [x] lib.rs 继续收敛——13004→9079（净减 3925）；cargo test --lib 30/30，test:unit 10 项全绿，pnpm build 通过（2026-10-08）

## Phase 5：前端组件拆分

- [x] settings.tsx 局部抽组件：SettingsShell/SettingsStatusPanel/SettingsCodeTabs/SettingsFieldRow/controls 等已抽至 src/settings/（服务 settings-interface-redesign，2026-09 完成）
- [~] ~~agent-panel.tsx 拆 parts~~：agent-panel.tsx/agent-chat-page.tsx 已随旧 Agent 面板整体删除（2026-09 AI 运行时重构），任务作废
- [x] App.tsx 按 surface 拆——2026-11-25 收账：1643 → 785 行；搜索/唤起/路由/回收站/聚合导出与写回复制按域抽成 hooks/components；`pnpm test:unit`、`pnpm build:web` 通过。
- [x] 每个抽出的文件 ≤500 行（全部新文件 ≤498 行，file-size 门禁全程通过）
- [x] App.tsx 剩余切片（2026-11-25 全部完成，提交 `8b8a8e5`、`46b62ff`）：
- [x] 写回域接线/深链：`use-clip-writeback.ts` 499 → 249，新增 `use-clip-copy-paste.ts` 390；A→B 单向依赖与 `updateClip` / `updateClipContent` 终点锚入 `verify-runtime-boundaries.mjs`。
- [x] search 域：`use-panel-search.ts` 213、`use-search-snapshot-query.ts` 92；`verify-keyword-suggestions.mjs` 通过。
- [x] UI JSX：`panel-top-bar.tsx`、`panel-bottom-bars.tsx`、三个 route 组件、`panel-error-boundary.tsx`；`verify-surface-boundaries.mjs` 通过。
- [x] 未引入全局 store；state/ref 保留在 App.tsx，通过 props 传递（盟哥已放宽上限至 800，S6 取消）。

### Phase 5.x：panel-list-perf 接缝注记（2026-10-10）

W1 性能修复 `panel-list-perf` 与本阶段重构存在文件重叠，需按以下顺序执行：

1. **search 域提取必须等 panel-list-perf Phase 2 落地后再做**。原因：perf 会改 `searchRequest` 构建（history/favorites 共用 `bucket:"all"`）并在 `use-clipboard-list.ts` 引入 `clipsByView` 缓存；先提取 search hook 会导致 perf 需要二次 rebase。
2. **UI JSX 列表参数组装必须等 panel-list-perf Phase 3 落地后再做**。原因：`VirtualList` key/scrollTop/row-in epoch 都会变更；列表组件 props 签名稳定后再切展示层。
3. **写回域深链迁移时把 SWR 缓存失效逻辑一起下沉**。原因：panel-list-perf Phase 5 会把缓存失效集中在 `use-clip-writeback.ts`；深链函数迁出时必须复用同一失效入口，避免散落。
4. **verify-runtime-boundaries 当前没有 updateClip/updateClipContent 终点锚**(核对过脚本实况)。panel-list-perf 只加缓存失效、不改调用命令名;若要静态保障,应新增断言验证失效逻辑不绕过 `use-clip-writeback.ts`。
5. **状态 store 化（待盟哥拍板）与 clipsByView 缓存解耦**：perf 用 `useRef`/轻量 hook 实现缓存，不为 store 化阻塞；后续 store 化只需替换缓存实现，保持 `getCachedClips(view, requestKey)` / `setCachedClips(...)` 接口。

## Phase 6：收尾

- [~] lib.rs window/log/tray 模块化（S2/S3 完成）：9787 → 8350；窗口、日志、托盘、诊断分别迁入 `window/`、`log_service.rs`、`tray.rs`、`diagnostics.rs`；剩余 command 收尾属 S7。
- [ ] 豁免清单逐步清空（每拆完一个文件就从清单移除）——已 7 → 3（workspace-panels/contracts/agent-panel×2 已清，剩 App.tsx/settings.tsx/lib.rs）
- [ ] 文件大小门禁对全部源文件 fail-mode 生效
- [ ] `pnpm build` + `cargo check` + `cargo fmt --check` + 全部 verify 脚本通过

### Phase 6.x：panel-list-perf 接缝注记（2026-10-10）

panel-list-perf 只改动 `src-tauri/src/lib.rs` 的 `search_clip_records`/`load_clip` 数据查询层（N+1 → JOIN、payload 瘦身），不碰 window/log/tray 模块拆分。两者顺序无关；但 lib.rs 数据层变更应先于或并行于 window/log/tray 拆分，避免后续重构时同时改动查询与模块边界。 

### 状态记录（2026-09-10，Tailwind 重构期间的还债对账）

- Phase 5 前端拆分大幅推进：workspace-panels（1831 行）→ 5 行 re-export + 7 个子组件；settings/onboarding 向导拆分完成；App.tsx 4051 → 2355（clip-model/clip-search/panel-settings 域模块 + usePanelEnvironment/BlurHide/WindowListeners/ClipboardList/SettingsSync/CleanupScheduler/Bootstrap/FilePathStatuses/Keyboard 九个 hook）。
- contracts.ts（746 行）拆为 4 个域契约模块 + barrel。
- 豁免清单 7 → 3：剩 App.tsx（2355）/ settings.tsx（1566）/ lib.rs（14284）。
- 全程 file-size 门禁通过；verify 脚本断言随拆分同步迁移（断言语义不变）。
- 剩余：App.tsx 写回域 + UI JSX、settings.tsx section 切片、lib.rs 三域拆分（方案见 `openspec/changes/codebase-modularity-refactor/execution-plan.md`）。

### 状态记录（2026-07-16）

- 已运行 `pnpm test:unit`：通过，包含 `verify-file-size.mjs`；当前 7 个豁免文件仅输出还债提醒，非豁免文件未超 500 行。
- 已局部更新 `scripts/verify-agent-panel.mjs`：将已过时的 `footer-agent-slot` 断言改为验证 top-nav 后的 `top-toolbar-action-slot` / `top-agent-button` / `onClick={onOpenAgent}` / 同步 `setActiveSurface("agent")`，并已复跑通过。
- 已继续补 Agent 稳定测试标记：`src/App.tsx` 为 top toolbar Agent 入口和 overlay 增加 `data-agent-trigger` / `data-agent-overlay` / `data-agent-overlay-panel`，`verify-agent-panel.mjs` 已优先验证这些稳定 marker，降低对 class 名称与布局槽位的耦合。
- 已复跑 `node scripts/verify-agent-panel.mjs`、`pnpm test:unit`、`pnpm exec tsc --noEmit`、`pnpm openspec validate codebase-modularity-refactor --strict`、`pnpm openspec validate clipboard-agent-panel --strict`：均通过。
- 这只是针对当前 top-nav 漂移的最小 verifier 修正，`verify-agent-panel.mjs` 仍大量依赖源码子串，未完成迁移到 data-marker / 导出符号，因此 Phase 2 迁移任务不勾选。
- 治理拆分仍按“功能触碰时顺手推进”执行；本轮不启动 lib.rs / App.tsx / settings.tsx 大拆分。
### 状态记录（2026-11-25，TDD 切片 S1–S5 收账）

- 红→绿证据：S1 `verify-settings-surface` 先失败后通过；S2/S3 `scripts/verify-runtime-boundaries.mjs`、`scripts/verify-log-tray-boundaries.mjs` 先加导出符号断言再平移；S4 `updateClip` / `updateClipContent` 终点锚先失败后通过；S5 `verify-surface-boundaries.mjs` 新增 marker 断言。每片复审结论均为「可合入」，should-fix 已修。
- 行数：`settings.tsx` 830 → 542、`lib.rs` 9787 → 8350、`App.tsx` 1643 → 785；豁免目标 800，settings/App 达标，lib.rs 仍超标 350 行。
- 门禁（提交 46b62ff 后实测）：`pnpm build:web` exit 0；`pnpm test:unit` exit 0（18 步、108 索引路径、41 MCP 工具、322 source files）；`cargo check` exit 0；`cargo test --lib` 86 passed；`openspec validate --all --strict` 43 passed。
- 未完成：S7（lib.rs ≤800、豁免清单 3 → 0、普通文件 500 硬失败）；面板走查需解锁且空闲 ≥45 s；`cargo fmt --check` 仍有两处历史 diff（`clipboard/watcher.rs:287`、`clipboard/write_tests.rs:1`），非本轮引入。
