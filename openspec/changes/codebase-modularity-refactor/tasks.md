# 任务：代码可维护性地基重构

> 原则见 [design.md](./design.md)。每个切片必须保持行为不变，且 `pnpm build` + `cargo check` + 全部 verify 脚本通过才算完成。

## Phase 1：规范与门禁

- [x] 立 `AGENTS.md` 开发规范：≤500 行 / 中文注释 / 组件化 / 样式拆分
- [ ] 新增 `scripts/file-size-exemptions.json`（初始豁免清单：App.tsx/settings.tsx/agent-panel.tsx/agent-chat-page.tsx/lib.rs）
- [ ] 新增 `scripts/verify-file-size.mjs`：豁免外 >500 行 fail，豁免内只 warn
- [ ] `verify-file-size.mjs` 接入 `package.json` 的 `test:unit`
- [ ] `AGENTS.md` 引用门禁脚本与豁免清单位置

## Phase 2：verify 脚本升级（拆分前置）

- [ ] `verify-agent-panel.mjs`：把依赖源码子串的断言迁移到 `data-*` marker / 导出符号（先升级会被当前拆分触碰的部分）
- [ ] 保留必要的反向断言（「某 class 不应存在」），但每条加注释说明为何脆弱
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
