# 任务：DeepSeek Harness 常驻守护进程 + 悬浮对话

> 状态（2026-08-17）：v1 一次性 sidecar 链路（Phase 0–5）已端到端跑通，`cargo check` + `pnpm build:web` 通过。
> 本任务在 v1 之上新增 **Phase 6（常驻守护进程）** 与 **Phase 7（悬浮对话 UI + 快速唤起 + 剪贴板打通）**，转向参考项目 Host-Service Separation。

## Phase 0：Spike 验证 ✅

- [x] 隔离 workspace 安装 `@deepseek-ai/dsh@0.1.0-rc.6`，`--profile headless` 跑通
- [x] 确认 DSH 是 Cordis 插件系统；profile = bundle 堆叠；有进程内 `boot()` API；skill 为 Markdown；tool `output.schema` 强制结构化

## Phase 1：依赖直引（去 vendor）✅

- [x] `dsh/profiles/clipforge/package.json` 声明 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-app-boot`（锁 `0.1.0-rc.6`），`@clipforge/dsh-plugin` 用 `file:` 本地依赖
- [x] 不 vendor 源码；`pnpm-workspace.yaml` 用 `autoInstallPeers: true`

## Phase 2：插件 + 技能 ✅

- [x] 写 `@clipforge/dsh-plugin`：`export default { name, inject, Config, apply }`；`apply` 注册 `clipboard_analyze` tool（`output.schema` 强校验四类）
- [x] `clipboard-analysis/SKILL.md` 约束模型只读分析、必须调用 `clipboard_analyze`

## Phase 3：Profile 定义与安装 ✅

- [x] 建 `dsh/profiles/clipforge/`：`package.json`(dsh.profile.bundles) / `cordis.patch.yml`(禁用 hmr) / `pnpm-workspace.yaml` / `cordis.yml`(空 `[]`) / `skills/clipboard-analysis/SKILL.md`
- [x] headless 只读红线确认（不挂 bash/fs/web 执行能力）

## Phase 4：运行时桥接重构（一次性 sidecar）✅

- [x] `src-tauri/src/dsh.rs`：薄桥接（拉起 Node sidecar / 超时 / 降级 `errorCode`），读 `DSH_RESULT::<json>`
- [x] `dsh/profiles/clipforge/sidecar.mjs`：`boot()` → runner → `whenIdle` 打印 `DSH_RESULT::<json>` → `process.exit`
- [x] 降级：无 key / 配额 / 网络 / 未调用工具 → `DSH_RESULT::{degraded:true,...}`

## Phase 5：前端对接 + 标品化收口 🟡

- [x] `dsh-analysis.ts`：消费 DSH 原生结构化输出
- [x] 验证：`pnpm build:web` ✅、`cargo check` ✅（仅预存 dead_code 警告）
- [ ] 详情页 / 右键入口 / 历史复用 UI 展示（前端消费层已就位，待盟哥验收）
- [ ] （后置）Tauri sidecar 打包 Node + dsh；DSH → ClipForge 回调写回经 tool handler / MCP

---

## Phase 6：常驻守护进程（Host-Service Separation）🟡

- [ ] 新增 `src-tauri/src/dsh-daemon.rs`：`DshDaemonState { child, port, ready }`；`setup` 中 spawn node sidecar 加载 clipforge profile，常驻 host 服务 @ `127.0.0.1:PORT`（默认 3080，可 `CLIPFORGE_DSH_PORT` 覆盖）。
- [ ] sidecar 改造 `sidecar.mjs`：由「一次性 boot+exit」改为「boot 后常驻 node http 服务」——`GET /health` → `{ok:true}`；`POST /chat` → `{conversationId, messages}` → 复用 agent session 流式/SSE 回传四类；移除 `process.exit` 看门狗（仅留崩溃兜底）。
- [ ] 健康检查：tokio 定时 `reqwest` 轮询 `/health`，成功 `emit("dsh-ready")` + `ready=true`；失败指数退避重试，超限标记 degraded。
- [ ] 日志重定向：消费 `CommandEvent::Stdout/Stderr` → `emit("dsh-log")`；`Terminated` → `ready=false` + `emit("dsh-terminated")`。
- [ ] 新增 command `get_dsh_status`（轮询 `/health`）+ `restart_dsh_daemon`（kill+respawn+重置健康检查）。
- [ ] 退出清理：`RunEvent::ExitRequested` 中 `child.kill()` 防孤儿进程。
- [ ] localhost-only 硬约束：sidecar 启动 `--host 127.0.0.1`，拒绝 `0.0.0.0`。
- [ ] 环境变量注入 `DEEPSEEK_API_KEY/BASE_URL/MODEL`/`DSH_HOME`（不落盘前端）；复用 `resolve_node`/`resolve_sidecar`。
- [ ] `cargo check` + 单元/集成验证守护进程拉起、健康检查、重启、退出清理。

## Phase 7：悬浮对话 UI + 快速唤起 + 剪贴板打通 🟡

- [ ] 新增 `src/agent/dsh-client.ts`：`dshChat({conversationId, messages, fileContext?})` → `invoke("dsh_chat")`；`getDshStatus()`；订阅 `dsh-ready`/`dsh-log`/`dsh-terminated`。
- [ ] 新增 Rust command `dsh_chat`：转发守护进程 `/chat`，持 `conversationId`；守护进程未就绪 → 降级（保留 `analyze_clipboard` 一次性兜底）。
- [ ] 重构 `dsh-panel.tsx`：对话式（消息流 + 输入框 + 流式 + 四类卡片 + 写回 + 历史），持 `conversationId`，多轮由守护进程原生支持。
- [ ] 快速唤起：① 全局快捷键新增 DSH 专用键（如 `Cmd/Ctrl+Shift+J`，原 `⌘I` 已空出）→ `setActiveSurface("dsh")`；② 托盘菜单新增「打开 DSH 助手」→ `show_quick_panel` 聚焦 dsh；③ 快捷面板挂迷你 DSH 输入入口。
- [ ] 剪贴板打通：列表/详情/右键「AI 分析」「在此文件开始对话」→ `setActiveSurface("dsh")` + 注入选中条目（文本 content 或文件 fileContext）为新对话首条；面板内「发送当前选中剪贴板」注入 `selectedClip.content`；结果写回 `onApplyTags`/`onApplyFolder`。
- [ ] i18n：新增/核对 `main.dsh.*` / `main.quick.*` / `tray.openDsh` 等键（中/英）；门禁脚本补稳定 DOM marker（如 `data-dev-probe="dsh-surface"`）。
- [ ] 验证：`pnpm build:web` + `cargo check`；手动验收快速唤起 + 多轮对话 + 剪贴板注入/写回。

---

## 关键技术坑（落地中实测，后续维护必读）

1. **bundle 必须声明 `dsh.bundle.patch`**：插件 `package.json` 缺 `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}` 时 `boot()` 不识别它为 bundle，`apply` 永不触发。
2. **`boot()` 不自动加载 bundle**：bundle patch 由 launcher 先 `loadProfile` 取出、拼成「扁平 patch 列表」再作 `patches` 传入；**不要传 `composeEntries(...)`**（返回合成树而非 patch 列表，会导致整棵树为空）。
3. **hmr 需 `--expose-internals`**：一次性 sidecar 在 profile 用户层 `cordis.patch.yml` 用 `- id: hmr / disabled: true` 禁用即可免去该 flag；**常驻服务同样禁用 hmr**。
4. **Cordis 插件要 `export default`**；`defineTool` 的 `parameters` 是「属性映射对象」（JSON-Schema 形态值 schema），非 `z.object(...)`；对象类型必须显式 `additionalProperties`。
5. **一次性 sidecar 不能在 `boot()` 返回后立即 `process.exit`**：runner 异步，应让事件循环转、由 runner 自行退出；`DSH_RESULT::` 用 `process.stdout.write(..., () => process.exit(0))` 保证 flush。
6. **常驻改造新增坑**：sidecar 改为 http 服务后，`POST /chat` 必须**复用同一 agent session**（按 `conversationId` 缓存 agent 实例），否则多轮丢失上下文；服务进程不可因单次请求失败而退出；健康检查 `/health` 必须早于首轮 `/chat` 返回 200，否则 Rust 侧会误判未就绪。
7. **端口冲突**：默认 3080 可能被占用，需 `CLIPFORGE_DSH_PORT` 覆盖 + 启动失败重试相邻端口；localhost-only 硬约束不变。
8. **退出清理**：`ExitRequested` 必须 `child.kill()`，否则开发期反复 `tauri dev` 会残留孤儿 node 进程占用端口。
