# 任务：DeepSeek Harness 常驻守护进程 + 悬浮对话

> 状态（2026-09-02）：产品主线回归剪贴板工具本体，本提案整体后置。DSH 面板定位为**实验性 iframe 集成**——
> 仅保留「独立悬浮窗 + iframe 嵌 DSH 官方 Web UI」形态作为尝试（2026-08-17 拍板，2026-09-02 确认继续保留），
> 不再投入自研对话 UI；运行时基座后续可能切换 pi 等候选，基座取舍前不向 DSH runtime 深投。
> v1 一次性 sidecar 链路（Phase 0–5）已端到端跑通，`cargo check` + `pnpm build:web` 通过。
> 2026-08-17 已提前落地 Phase 6 守护进程骨架与 Phase 7 悬浮窗 iframe 集成，以下清单已按实际代码与最新方向对齐。

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
- [x] 详情页 / 右键入口 / 历史复用 UI 展示（详情页 `DetailDshPanel` AI 分析按钮+结果面板+最近历史、右键菜单「AI 分析」均已落地；实机视觉验收随 HANDOFF 全量回归待办）
- [ ] （后置）Tauri sidecar 打包 Node + dsh；DSH → ClipForge 回调写回经 tool handler / MCP

---

## Phase 6：常驻守护进程（Host-Service Separation）🟡 骨架已落地，剩余后置

> 2026-08-17 已落地：守护进程 spawn、常驻 web carrier、健康探活、localhost-only、env 注入、退出清理。
> 实现并入 `src-tauri/src/dsh.rs`（未拆独立 `dsh-daemon.rs`，随 modularity 治理再抽）。

- [x] `DshDaemonState` + `spawn_dsh_daemon`：setup 中常驻拉起 node sidecar（`--serve`），web carrier @ `127.0.0.1:3080`；实现位于 `dsh.rs`，独立 `dsh-daemon.rs` 拆分后置
- [x] sidecar 常驻改造（第一步）：`sidecar.mjs --serve` 启动 DSH web carrier 常驻，不 `process.exit`，事件循环由 carrier 持有
- [x] 健康探活：Rust 侧 `dsh_daemon_healthy` 端口探活 + 前端 `dsh-panel` 500ms×30 轮询兜底；`emit("dsh-ready")` 事件化与指数退避后置
- [x] 状态与控制命令：`get_dsh_status` / `start_dsh_daemon` / `stop_dsh_daemon` / `kill_dsh_daemon` 已注册；组合式 `restart_dsh_daemon` 后置（stop+start 可替代）
- [x] 退出清理：`RunEvent::ExitRequested` → `kill_dsh_daemon`，防孤儿进程占用端口
- [x] localhost-only 硬约束：host 固定 `127.0.0.1`（`dsh.rs` 安全边界注释），拒绝局域网暴露
- [x] 环境变量注入 `DEEPSEEK_API_KEY` / `DSH_HOME`（不落盘前端）
- [ ] （后置）`POST /chat` 会话 API：按 `conversationId` 缓存 agent session、流式回传；iframe 实验形态不依赖，待自研 UI / 基座（pi 等）取舍后再定
- [ ] （后置）日志重定向：`CommandEvent::Stdout/Stderr` → `emit("dsh-log")`；`Terminated` → `ready=false` + `emit("dsh-terminated")`
- [ ] （后置）端口覆盖与集成验证：`CLIPFORGE_DSH_PORT` 覆盖 + 启动失败重试相邻端口；守护进程拉起/健康/重启/退出清理实机确认

## Phase 7：悬浮对话 UI + 快速唤起 + 剪贴板打通 🟡 路线已转向 iframe 兼容模式

> 2026-08-17 路线转向（盟哥拍板）：不自研对话 UI，悬浮窗 iframe 直接嵌 DSH 官方 Web UI。
> 2026-09-02 确认：iframe 形态保留为实验终态候选，自研对话 UI 后置；剪贴板打通整体移交
> `dsh-file-context-conversation`，随 DSH 链后置。

- [x] 悬浮窗 surface：`open/hide/toggle_dsh_window` 独立悬浮窗（复用剪贴板窗体悬浮逻辑，label="dsh"）+ `src/dsh/dsh-panel.tsx` iframe 嵌官方 Web UI、守护进程就绪轮询与兜底拉起
- [x] 服务层消费：`DSH_WEB_URL` / `getDshStatus` / `startDshDaemon` 并入 `src/agent/dsh-analysis.ts`（原计划的独立 `dsh-client.ts` 不再单列，随 iframe 形态收敛）
- [ ] （后置）快速唤起：全局快捷键 DSH 专用键（原 `⌘I` 已空出）→ dsh surface；托盘菜单「打开 DSH 助手」；快捷面板迷你 DSH 入口
- [ ] （后置）剪贴板打通：列表/详情/右键注入条目、结果写回 `onApplyTags`/`onApplyFolder` —— 移交 `dsh-file-context-conversation`
- [ ] （后置）i18n：`dsh-panel` 内硬编码中文（标题/提示）收敛为 `main.dsh.*` 键（中/英）
- [ ] （后置）实机验收：悬浮窗打开、iframe 加载、守护进程未就绪提示、关闭回到 clipboard surface

---

## 2026-09-02 方向调整（清账决策记录）

1. 产品主线回归「打造好一个剪贴板」：DSH 全链后置，不阻塞剪贴板格式闭环、onboarding 与前端架构收尾。
2. DSH 面板仅保留 iframe 实验形态；自研对话 UI、`POST /chat` 会话 API、快速唤起、i18n 等全部后置，「后面看看需不需要自研」。
3. 运行时基座存在切换候选（pi 等），基座取舍结论前不向 DSH runtime 深投；`clipboard_analyze` 一次性链路（Phase 0–5）保持可用。
4. 剪贴板打通场景由 `dsh-file-context-conversation` 承接，排期同步后置。

## 2026-09-07 对账核验（夜间批次 4）

逐项 grep 核验代码：Phase 6 守护进程（`DshDaemonState`/`spawn_dsh_daemon`/健康探活/四命令注册/`ExitRequested` 清理/localhost-only/env 注入）与 Phase 7 iframe 形态（`DSH_WEB_URL`/`getDshStatus`/`startDshDaemon`/`dsh-panel` iframe+轮询）均与上述清单一致；Phase 5 三个 UI 入口已确认落地并勾选。未勾项全部为（后置），与 2026-09-02 方向决策一致，本提案无可立即推进项（后续动 DSH 须先过基座取舍决策）。

## 关键技术坑（落地中实测，后续维护必读）

1. **bundle 必须声明 `dsh.bundle.patch`**：插件 `package.json` 缺 `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}` 时 `boot()` 不识别它为 bundle，`apply` 永不触发。
2. **`boot()` 不自动加载 bundle**：bundle patch 由 launcher 先 `loadProfile` 取出、拼成「扁平 patch 列表」再作 `patches` 传入；**不要传 `composeEntries(...)`**（返回合成树而非 patch 列表，会导致整棵树为空）。
3. **hmr 需 `--expose-internals`**：一次性 sidecar 在 profile 用户层 `cordis.patch.yml` 用 `- id: hmr / disabled: true` 禁用即可免去该 flag；**常驻服务同样禁用 hmr**。
4. **Cordis 插件要 `export default`**；`defineTool` 的 `parameters` 是「属性映射对象」（JSON-Schema 形态值 schema），非 `z.object(...)`；对象类型必须显式 `additionalProperties`。
5. **一次性 sidecar 不能在 `boot()` 返回后立即 `process.exit`**：runner 异步，应让事件循环转、由 runner 自行退出；`DSH_RESULT::` 用 `process.stdout.write(..., () => process.exit(0))` 保证 flush。
6. **常驻改造新增坑**：sidecar 改为 http 服务后，`POST /chat` 必须**复用同一 agent session**（按 `conversationId` 缓存 agent 实例），否则多轮丢失上下文；服务进程不可因单次请求失败而退出；健康检查 `/health` 必须早于首轮 `/chat` 返回 200，否则 Rust 侧会误判未就绪。
7. **端口冲突**：默认 3080 可能被占用，需 `CLIPFORGE_DSH_PORT` 覆盖 + 启动失败重试相邻端口；localhost-only 硬约束不变。
8. **退出清理**：`ExitRequested` 必须 `child.kill()`，否则开发期反复 `tauri dev` 会残留孤儿 node 进程占用端口。
