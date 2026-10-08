# 任务：代码可维护性地基重构

> 原则见 [design.md](./design.md)。每个切片必须保持行为不变，且 `pnpm build` + `cargo check` + 全部 verify 脚本通过才算完成。

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

- [ ] 抽 `src-tauri/src/settings/mod.rs`：SettingsService get/patch/replace/reset + revision + emit
- [x] 抽 settings 校验域：settings_json_schema/resolve_schema_ref/validate_settings_value/settings_validation_error/validate_settings_patch 五函数（~225 行）迁入 settings_service.rs 并 pub 导出（2026-09-11，lib.rs 14284→14058；实际落位 settings_service.rs 而非新目录，避免多一层模块）
- [ ] 抽 `settings/write.rs`：原子写 + Mutex（依赖 B2 先落地）
- [ ] 抽 `settings/commands.rs`：settings_service_* Tauri command 适配层
- [ ] 抽 `settings/mcp.rs`：clipf.settings.*/clipf.agent.* dispatch（复用 service，满足 B3）
- [ ] lib.rs 只保留模块声明 + 命令注册，移除 settings 相关内联实现——进行中：schema 校验域已迁（上）；settings_service_* 七命令（~240 行）+ 辅助函数链（sync_launch_at_login/sync_global_shortcut/refresh_tray_menu/emit_settings_changed/settings_write_response/log_slow_settings_operation）与 SETTINGS_WRITE_LOCK 待迁，建议新会话满上下文执行
- [ ] `cargo check` + `cargo fmt` + verify 脚本通过

### Phase 3 评审修订项(2026-10-08 多模型论证,见 [agent-extension-seams/evaluation.md](../agent-extension-seams/evaluation.md) §4)

- [ ] 门面单入口:写路径唯一入口 = mod.rs 门面,commands.rs/mcp.rs 禁止自行取 SETTINGS_WRITE_LOCK
- [ ] 锁内规则:持锁期间不 emit、不跨 await、无网络/子进程 I/O;emit 一律在锁释放后
- [ ] poisoned 语义:SETTINGS_LOCK_POISONED + 进程级 degraded(写禁用读可用,需重启),不自动重建
- [ ] 锁层级表:持锁期间仅允许再取 DB 写连接,禁嵌套其他锁
- [ ] MCP dispatch 与错误路径 golden 用例先行(迁移前后错误码/返回结构逐字节比对)

## Phase 4：lib.rs agent / mcp 模块拆分

- [ ] 抽 `agent/`：provider 解析 + run 状态机 + agent_* command
- [ ] 抽 `mcp/`：run_mcp_stdio + call_mcp_tool + mcp_tool_specs
- [ ] lib.rs 继续收敛

## Phase 5：前端组件拆分

- [x] settings.tsx 局部抽组件：SettingsShell/SettingsStatusPanel/SettingsCodeTabs/SettingsFieldRow/controls 等已抽至 src/settings/（服务 settings-interface-redesign，2026-09 完成）
- [~] ~~agent-panel.tsx 拆 parts~~：agent-panel.tsx/agent-chat-page.tsx 已随旧 Agent 面板整体删除（2026-09 AI 运行时重构），任务作废
- [ ] App.tsx 按 surface 拆——2026-09-10 完成 4051 → 1334 行（-67%）：10 hooks + 8 子组件 + 3 域模块 + UI store；剩余 1334 行为状态粘合层，进一步压缩需状态 store 化（架构改动，待盟哥拍板）
- [x] 每个抽出的文件 ≤500 行（全部新文件 ≤498 行，file-size 门禁全程通过）
- [ ] App.tsx 剩余切片（2026-09-10 盟哥授权全量推进，当前 1692 行）：
  - [ ] 写回域接线：useClipWriteback（已建文件未接线）——注意 verify-runtime-boundaries 的 updateClip 终点锚同步改 updateClipContent
  - [ ] 写回域深链：copyClip/copyText/pasteClip/captureStandardTextClip/updateClipContent/openClipTarget → use-clip-writeback.ts 二批
  - [ ] search 域：handleSearchChange/applySearchSuggestion/closeSearchIfEmpty/removeSearchFilter 等
  - [ ] UI JSX：TopCommandBar/ModeBar/列表参数组装/Overlay 区块切展示组件

## Phase 6：收尾

- [ ] lib.rs window/log/tray 模块化，lib.rs 收敛到 setup + handler 注册
- [ ] 豁免清单逐步清空（每拆完一个文件就从清单移除）——已 7 → 3（workspace-panels/contracts/agent-panel×2 已清，剩 App.tsx/settings.tsx/lib.rs）
- [ ] 文件大小门禁对全部源文件 fail-mode 生效
- [ ] `pnpm build` + `cargo check` + `cargo fmt --check` + 全部 verify 脚本通过

### 状态记录（2026-09-10，Tailwind 重构期间的还债对账）

- Phase 5 前端拆分大幅推进：workspace-panels（1831 行）→ 5 行 re-export + 7 个子组件；settings/onboarding 向导拆分完成；App.tsx 4051 → 2355（clip-model/clip-search/panel-settings 域模块 + usePanelEnvironment/BlurHide/WindowListeners/ClipboardList/SettingsSync/CleanupScheduler/Bootstrap/FilePathStatuses/Keyboard 九个 hook）。
- contracts.ts（746 行）拆为 4 个域契约模块 + barrel。
- 豁免清单 7 → 3：剩 App.tsx（2355）/ settings.tsx（1566）/ lib.rs（14284）。
- 全程 file-size 门禁通过；verify 脚本断言随拆分同步迁移（断言语义不变）。
- 剩余：App.tsx 写回域 + UI JSX、settings.tsx section 切片、lib.rs 三域拆分（方案见 docs/HANDOFF.md）。

### 状态记录（2026-07-16）

- 已运行 `pnpm test:unit`：通过，包含 `verify-file-size.mjs`；当前 7 个豁免文件仅输出还债提醒，非豁免文件未超 500 行。
- 已局部更新 `scripts/verify-agent-panel.mjs`：将已过时的 `footer-agent-slot` 断言改为验证 top-nav 后的 `top-toolbar-action-slot` / `top-agent-button` / `onClick={onOpenAgent}` / 同步 `setActiveSurface("agent")`，并已复跑通过。
- 已继续补 Agent 稳定测试标记：`src/App.tsx` 为 top toolbar Agent 入口和 overlay 增加 `data-agent-trigger` / `data-agent-overlay` / `data-agent-overlay-panel`，`verify-agent-panel.mjs` 已优先验证这些稳定 marker，降低对 class 名称与布局槽位的耦合。
- 已复跑 `node scripts/verify-agent-panel.mjs`、`pnpm test:unit`、`pnpm exec tsc --noEmit`、`pnpm openspec validate codebase-modularity-refactor --strict`、`pnpm openspec validate clipboard-agent-panel --strict`：均通过。
- 这只是针对当前 top-nav 漂移的最小 verifier 修正，`verify-agent-panel.mjs` 仍大量依赖源码子串，未完成迁移到 data-marker / 导出符号，因此 Phase 2 迁移任务不勾选。
- 治理拆分仍按“功能触碰时顺手推进”执行；本轮不启动 lib.rs / App.tsx / settings.tsx 大拆分。
