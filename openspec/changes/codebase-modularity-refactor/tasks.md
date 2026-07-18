# 任务：代码可维护性地基重构

> 原则见 [design.md](./design.md)。每个切片必须保持行为不变，且 `pnpm build` + `cargo check` + 全部 verify 脚本通过才算完成。

## Phase 1：规范与门禁

- [x] 立 `AGENTS.md` 开发规范：≤500 行 / 中文注释 / 组件化 / 样式拆分
- [x] 新增 `scripts/file-size-exemptions.json`（当前豁免清单：App.tsx/settings.tsx/agent-panel.tsx/agent-chat-page.tsx/workspace-panels.tsx/contracts.ts/lib.rs）
- [x] 新增 `scripts/verify-file-size.mjs`：豁免外 >500 行 fail，豁免内只 warn
- [x] `verify-file-size.mjs` 接入 `package.json` 的 `test:unit`
- [x] `AGENTS.md` 引用门禁脚本与豁免清单位置

## Phase 2：verify 脚本升级（拆分前置）

- [ ] `verify-agent-panel.mjs`：把依赖源码子串的断言迁移到 `data-*` marker / 导出符号（先升级会被当前拆分触碰的部分）
- [x] 保留必要的反向断言（「某 class 不应存在」），但每条加注释说明为何脆弱
- [ ] 升级前后对同一份代码各跑一次，确认「等价或更强」

## Phase 3：lib.rs settings 模块拆分（服务 settings-service B3）

- [ ] 抽 `src-tauri/src/settings/mod.rs`：SettingsService get/patch/replace/reset + revision + emit
- [ ] 抽 `settings/schema.rs`：settings_json_schema + 校验
- [ ] 抽 `settings/write.rs`：原子写 + Mutex（依赖 B2 先落地）
- [ ] 抽 `settings/commands.rs`：settings_service_* Tauri command 适配层
- [ ] 抽 `settings/mcp.rs`：clipf.settings.*/clipf.agent.* dispatch（复用 service，满足 B3）
- [ ] lib.rs 只保留模块声明 + 命令注册，移除 settings 相关内联实现
- [ ] `cargo check` + `cargo fmt` + verify 脚本通过

## Phase 4：lib.rs agent / mcp 模块拆分

- [ ] 抽 `agent/`：provider 解析 + run 状态机 + agent_* command
- [ ] 抽 `mcp/`：run_mcp_stdio + call_mcp_tool + mcp_tool_specs
- [ ] lib.rs 继续收敛

## Phase 5：前端组件拆分

- [ ] settings.tsx 局部抽组件（SettingField/StatusPanel/CodeTabs 等，服务 settings-interface-redesign）
- [ ] agent-panel.tsx 拆 parts（MessageScroller/Attachment/ToolPreview/ReferencePicker）
- [ ] App.tsx 按 surface 拆（clipboard panel / detail / agent overlay）
- [ ] 每个抽出的文件 ≤500 行

## Phase 6：收尾

- [ ] lib.rs window/log/tray 模块化，lib.rs 收敛到 setup + handler 注册
- [ ] 豁免清单逐步清空（每拆完一个文件就从清单移除）
- [ ] 文件大小门禁对全部源文件 fail-mode 生效
- [ ] `pnpm build` + `cargo check` + `cargo fmt --check` + 全部 verify 脚本通过

### 状态记录（2026-07-16）

- 已运行 `pnpm test:unit`：通过，包含 `verify-file-size.mjs`；当前 7 个豁免文件仅输出还债提醒，非豁免文件未超 500 行。
- 已局部更新 `scripts/verify-agent-panel.mjs`：将已过时的 `footer-agent-slot` 断言改为验证 top-nav 后的 `top-toolbar-action-slot` / `top-agent-button` / `onClick={onOpenAgent}` / 同步 `setActiveSurface("agent")`，并已复跑通过。
- 已继续补 Agent 稳定测试标记：`src/App.tsx` 为 top toolbar Agent 入口和 overlay 增加 `data-agent-trigger` / `data-agent-overlay` / `data-agent-overlay-panel`，`verify-agent-panel.mjs` 已优先验证这些稳定 marker，降低对 class 名称与布局槽位的耦合。
- 已复跑 `node scripts/verify-agent-panel.mjs`、`pnpm test:unit`、`pnpm exec tsc --noEmit`、`pnpm openspec validate codebase-modularity-refactor --strict`、`pnpm openspec validate clipboard-agent-panel --strict`：均通过。
- 这只是针对当前 top-nav 漂移的最小 verifier 修正，`verify-agent-panel.mjs` 仍大量依赖源码子串，未完成迁移到 data-marker / 导出符号，因此 Phase 2 迁移任务不勾选。
- 治理拆分仍按“功能触碰时顺手推进”执行；本轮不启动 lib.rs / App.tsx / settings.tsx 大拆分。
