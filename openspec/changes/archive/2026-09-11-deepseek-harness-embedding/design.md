# 设计：DeepSeek Harness 常驻守护进程 + 悬浮对话

> 本文档在既有「一次性 sidecar」设计（§1–§7，已落地）之上，**新增 §8–§10 的常驻守护进程架构转向**（2026-08-17 后续方向）。参考 `anywhere-labs/deepseek-harness-desktop` 的 Host-Service Separation。

## 1. 内嵌形态（v1 一次性 sidecar，已落地）

| 方案 | 做法 | 取舍 |
|---|---|---|
| A. 进程内 `boot()`（已采用） | Node sidecar `import { boot } from "@deepseek-ai/dsh-app-boot"`，加载 clipforge profile，创建 agent、投递任务、监听 `clipboard_analyze` tool 调用取结构化结果 | 干净、可捕获原生结构化事件；需 sidecar 打包 Node 运行时 |
| B. CLI spawn（过渡） | Rust 拉起 `node <dsh> --profile clipforge "<task>"` | 简单但进程外、task 字符串拼接 |

localhost-only 与 DSH 设计一致（CLI 拒绝 `--host 0.0.0.0`）。

## 2. 通过插件扩展（核心，已落地）

- 插件 `@clipforge/dsh-plugin`：`defineTool({ name:"clipboard_analyze", output:{schema: fourClassSchema} })`，四类结果由 `output.schema` 强校验。
- Skill `clipboard-analysis/SKILL.md`：约束模型只做基于给定内容的只读分析、必须调用 `clipboard_analyze`。

## 3. Profile（应用，已落地）

- `clipforge` profile bundles = `[@deepseek-ai/dsh-base, @deepseek-ai/dsh-headless, @clipforge/dsh-plugin]`。
- 目录 `dsh/profiles/clipforge/`：`package.json` / `cordis.patch.yml`(禁用 hmr) / `pnpm-workspace.yaml` / `cordis.yml`(空 `[]`) / `skills/clipboard-analysis/SKILL.md`。
- headless bundle 已禁用 fs-write / shell / `danger-full-access`，只读红线天然成立。

## 4. 四类结果对齐（不变）

DSH 返回结构化结果映射到 `ai-model-plugin-productization` 四类：`previewPatch` / `newClipDraft` / `copyResult` / `renderPanel`。写回前走 preview/confirm（WritebackGuard）。

## 5. 管理（AI 操作历史 + 审计）

- `boot()` 路径可读 `agent.session.events` 取轨迹；前端 localStorage 历史兜底（`recordDshHistory` / `getDshHistory`）。
- **常驻会话下**：会话轨迹由 DSH 守护进程持有（按 `conversationId`），前端仅缓存展示层，不再靠「重发历史」模拟多轮。

## 6. 降级与依赖更新策略（不变）

- 缺 node / dsh / key / 超时 → 禁用 AI 入口，基础剪贴板功能不受影响（降级 `degraded=true` + `errorCode`）。
- 锁 `@deepseek-ai/dsh@0.1.0-rc.x`；rc 阶段破坏性变更预期 → 定期 `pnpm update` 回归。
- 安全红线：分析 profile 绝不开放 shell / 写文件。

## 7. 参考项目印证（anywhere-labs/deepseek-harness-desktop，已研究）

- 插件式扩展是 DSH 官方意图用法；固定版本原样运行是社区验证策略。
- 他们跑完整 DSH（Web UI + Host）；我们仅取 headless 只读分析 host（localhost API，不渲染 Web UI），更轻、契合 AGENTS.md。
- 他们用 Electron；我们用 **Tauri v2**，Node 以 sidecar（externalBin / resources）随包分发。

---

## 8. 常驻守护进程架构（Host-Service Separation，2026-08-17 转向）

### 8.1 总览

```
┌─ ClipForge 主进程 (Tauri v2, Rust) ───────────────────────────────────┐
│  ├─ 剪贴板监听 (既有)                                                  │
│  ├─ 托盘 main-tray (既有) + 全局快捷键 (既有) + 快捷面板 (既有)        │
│  ├─ DSH 守护进程管理器 (新增 src-tauri/src/dsh-daemon.rs)             │
│  │    ├─ setup: spawn node sidecar 加载 clipforge profile             │
│  │    │         → boot headless host，常驻监听 127.0.0.1:PORT          │
│  │    ├─ 健康检查轮询 GET /health → emit("dsh-ready")                 │
│  │    ├─ 日志重定向 stdout/stderr → emit("dsh-log")                   │
│  │    ├─ ExitRequested: kill child 防孤儿进程                        │
│  │    └─ command: get_dsh_status / restart_dsh_daemon                │
│  └─ 悬浮窗口 (既有 WebviewWindow, 多 surface)                         │
└──────────────────────────────────────────────────────────────────────┘
        │  IPC: invoke("dsh_chat", {...}) / listen("dsh-event","dsh-ready","dsh-log")
        ▼
┌─ DSH 守护进程 (node sidecar, 常驻) ───────────────────────────────────┐
│  Cordis 内核 + @clipforge/dsh-plugin (clipboard_analyze)              │
│  + 文件上下文工具 (file_read / file_meta, 只读)                       │
│  + 常驻 HTTP 服务 @ 127.0.0.1:PORT (localhost-only)                  │
│      GET  /health            → { ok:true }                           │
│      POST /chat              → { conversationId, messages } → 流式/JSON│
│  会话态由 DSH 持有 (conversationId 复用 agent.session)               │
└──────────────────────────────────────────────────────────────────────┘
        ▲ HTTP (localhost-only)
        │
┌─ 悬浮 DSH 面板 (前端 dsh-panel.tsx, dsh surface) ────────────────────┐
│  对话式 UI: 消息流 + 输入框 + 流式结果 + 四类卡片 + 写回 + 历史      │
│  快速唤起: 全局快捷键跳 dsh surface / 托盘「打开 DSH」/ 快捷面板入口  │
│  剪贴板打通: selectedClip 上下文注入 / 写回标签·分组                 │
└──────────────────────────────────────────────────────────────────────┘
```

### 8.2 Rust 侧：`dsh-daemon.rs`（新增模块，替代 `dsh.rs` 的一次性 spawn）

- **状态**：`DshDaemonState { child: Arc<Mutex<Option<CommandChild>>>, port: u16, ready: Arc<AtomicBool> }`，在 `manage()` 注册。
- **拉起**：`setup` 中 `app.shell().sidecar("node")?.args([sidecar, "--port", PORT, "--profile", "clipforge"]).spawn()`；与现有 `resolve_node` / `resolve_sidecar` 复用，环境变量注入 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` / `DSH_HOME`（不落盘前端）。
- **健康检查**：tokio 定时 `reqwest::get("http://127.0.0.1:{PORT}/health")`，成功置 `ready=true` 并 `emit("dsh-ready")`；失败重试（指数退避，上限 N 次后标记 degraded）。
- **日志重定向**：消费 `CommandEvent::Stdout/Stderr` → `emit("dsh-log", line)`；`Terminated` → 置 `ready=false` + `emit("dsh-terminated")`。
- **重启**：`restart_dsh_daemon` command：kill 旧 child → respawn → 重置健康检查。
- **退出清理**：`RunEvent::ExitRequested` 中 `child.kill()`，防孤儿进程（参考项目同样做法）。
- **端口**：默认 `3080`，可被 `CLIPFORGE_DSH_PORT` 覆盖；避免与系统服务冲突；localhost-only 硬约束（sidecar 启动时 `--host 127.0.0.1`）。

### 8.3 前端侧：`dsh-client.ts`（新增，替代面板内直接 `analyze_clipboard` invoke）

- `dshChat({ conversationId, messages, fileContext? })` → `invoke("dsh_chat", payload)` → Rust 转发守护进程 `/chat` → 返回流式/结构化结果。
- `getDshStatus()` → `invoke("get_dsh_status")`；订阅 `dsh-ready` / `dsh-log` / `dsh-terminated` 事件。
- 守护进程未就绪时：面板显示「DSH 未就绪，重试中…」降级态，不阻断剪贴板。
- 保留 `analyze_clipboard`（一次性）作为离线兜底，待守护进程稳定后可选移除。

### 8.4 sidecar 改造：`sidecar.mjs` 由「一次性」改为「常驻 HTTP 服务」

- 当前：`boot()` → runner `followup(task)` → `whenIdle` → 打印 `DSH_RESULT::<json>` → `process.exit(0)`。
- 改为：`boot()` 后**启动常驻 node http 服务**（`127.0.0.1:PORT`）：
  - `GET /health` → `{ ok:true }`（供 Rust 健康检查）。
  - `POST /chat` body `{ conversationId, messages }` → 持 `conversationId` 调 `agents.followup`（复用同一 agent session）→ 流式/SSE 回传四类结果或 `degraded`。
  - 服务常驻，事件循环不退出（移除 `process.exit` 看门狗，或仅保留崩溃兜底）。
- 仍加载 clipforge profile + `@clipforge/dsh-plugin` + `clipboard-analysis` skill；文件上下文工具在 §9 / `dsh-file-context-conversation` 扩展。

## 9. 悬浮对话 UI + 快速唤起 + 剪贴板打通

### 9.1 悬浮对话 UI（`dsh-panel.tsx` 重构）

- 由「单轮分析」改为「对话」：消息列表（user/assistant）+ 输入框 + 流式展示 + 四类结果卡片 + 写回 + 历史。
- 持 `conversationId`；多轮由守护进程原生支持（§8.3），不再「重发历史」模拟。

### 9.2 快速唤起（复用既有基座，零从零搭建）

- **全局快捷键**：既有 `sync_global_shortcut_registration`（lib.rs:8564）已管理快捷键；新增一条 DSH 专用快捷键（如 `CommandOrControl+Shift+J`，原 `⌘I` 在删除 Agent 面板后已空出），触发 `setActiveSurface("dsh")`。
- **托盘**：既有 `build_tray_menu`（lib.rs:8645）新增「打开 DSH 助手」项 → `show_quick_panel(app, "tray")` 并聚焦 dsh，或直达 `setActiveSurface("dsh")`。
- **快捷面板**：既有 `show_quick_panel` 可挂一个迷你 DSH 输入入口（Raycast 式极简唤起），回车后展开完整 dsh surface。

### 9.3 剪贴板打通（surface 间桥接）

- **剪贴板 → DSH**：列表/详情/右键「AI 分析」「在此文件开始对话」→ `setActiveSurface("dsh")` + 把选中条目（文本 `content` 或文件 `fileContext`）注入为新对话首条上下文。
- **DSH → 剪贴板**：面板内「发送当前选中剪贴板」按钮注入 `selectedClip.content`；结果写回 `onApplyTags` / `onApplyFolder` 到 `selectedClip`（既有链路）。

## 10. 系统级文件管理器右键（指向独立提案）

在 Finder / 资源管理器内直接出菜单（「复制地址」「在此文件开始对话」）需 Finder Sync Extension（macOS）/ Shell 扩展（Windows）等重原生工作，跨平台成本高、与「悬浮剪贴板工具」定位有张力 → **不在本提案**，见独立提案 [`dsh-system-context-menu`](./dsh-system-context-menu/proposal.md)。应用内右键（ClipContextMenu）已覆盖等效能力。

---

## 11. 借鉴 `anywhere-labs/deepseek-harness-desktop` 的代码级改造（已读源码 2026-08-17）

> 已下载参考项目到 `~/workspace/open-source/deepseek-harness-desktop` 并通读关键文件。它是 **Electron 壳**（非 Tauri），DSH 以 **submodule** `deepseek-harness` 形式存在（未 checkout，故上游 web carrier 内部端点不可见）。但桌面壳 `dsh-plugin-desktop` 的实现给出可直接复用的模式。

### 11.1 参考项目关键事实（文件:行）

| 借鉴点 | 参考文件 | 做法 |
|---|---|---|
| DSH 绑定 loopback 临时端口 | `dsh-plugin-desktop/src/main.ts:276-279` | `boot(BIN_NAME, rootConfig, patches, hostCtx => { ...; provideCmdline(hostCtx, { args: ['--host','127.0.0.1','--port','0'], exit }) })` |
| 通信 = loopback HTTP+WS（非 Electron IPC） | `dsh-plugin-desktop/README.md:202` | "The shared carrier is loopback HTTP and WebSocket, not Electron IPC." |
| 关窗=隐藏，Host 继续跑 | `dsh-plugin-desktop/src/electron-runtime.ts:498-502` | `window.on('close', e => { e.preventDefault(); window.hide() })` |
| 托盘：Open / 工具组 / 模式切换 / Quit | `dsh-plugin-desktop/src/electron-runtime.ts:449-479` | `rebuildTrayMenu()` 按 group(tools/profiles/status) 注册项 |
| 健康检查同步 | `dsh-plugin-desktop/src/client/boot-health.ts` | 渲染进程 loaded 后 `POST RENDERER_BOOT_REPORT_PATH` 汇报健康 |
| web carrier 入口 | `dsh-plugin-desktop/src/desktop-cli.ts:9-11` | `DSH_ENTRY_URL = @deepseek-ai/dsh/lib/bin.js` + `provideCmdline` 的 `--host/--port` |
| Profile 层叠 | `dsh-plugin-desktop/cordis.patch.yml` | `insert:` desktop-shell 等插件叠到 `dsh-base`+`dsh-web-app` 之后 |
| 重启边界（不热插拔） | `dsh-plugin-desktop/src/main.ts:150-159` | `current?.fiber.dispose()` 后再 relaunch |
| 桌面壳本身是 Cordis 插件 | `dsh-plugin-desktop/README.md:9` | `desktop-shell` Host 插件拥有 BrowserWindow，与 upstream 共用同一 Cordis 组合 |

### 11.2 与我们的实现对照（已读 `dsh/profiles/clipforge/sidecar.mjs` 与 `dsh/plugins/clipforge-dsh-plugin/lib/index.js`）

- 我们的 `sidecar.mjs` 与参考项目 `boot()` 调用**同构**：都用 `@deepseek-ai/dsh-app-boot` 的 `boot(name, configPath, patches)`（参考用 `loadProfile`+`boot`，我们用 `loadProfile`+`boot`，一致）。
- 我们的 runner（`lib/index.js:run`）用 `agents.create({ sessionId })` + `agent.followup(createUserMessage)` + `agent.whenIdle()` —— **证明有会话态，多轮只需复用同一 sessionId**，是常驻对话的直接基础。
- 关键差异：**参考项目把对话端点交给上游 web carrier（内部协议不可见），我们控制 `@clipforge/dsh-plugin`，因此自起 node HTTP/SSE 服务是唯一可行且更可控路径**（不依赖上游未公开端点）。

### 11.3 具体改造（伪代码级，Phase 6/7 落地点）

**A. `dsh/plugins/clipforge-dsh-plugin/lib/index.js` —— 新增常驻对话服务（对齐"桌面壳是插件"哲学）**

```ts
// apply() 内保留一次性工具，新增常驻模式：
function apply(ctx, config) {
  ctx.tools.register(analyzeTool)            // 保留一次性 clipboard_analyze（降级/兼容）
  if (config.serve) startDaemon(ctx, config.port)   // 新增：常驻 agent + HTTP/SSE
}

async function startDaemon(ctx, port) {
  const agents = ctx.get("agents")
  const selection = ctx.get("agentDefaultModel").currentSelection()
  // 常驻 agent：固定 sessionId，跨请求复用 → 原生多轮
  const { agent } = await agents.create({
    sessionId: SessionId("clipforge-floating"),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: a => installModelSelection(a, { current: selection, assembled: void 0 }),
  })
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health") { res.end(JSON.stringify({ ok: true })); return }
    if (req.method === "POST" && req.url === "/chat") {
      const body = await readJson(req)            // { message, context? }
      // 流式：SSE
      res.writeHead(200, { "content-type": "text/event-stream" })
      agent.followup(createUserMessage({ content: [{ type:"text", text: body.message }], source:{kind:"user"} }))
      // 订阅 agent 事件流 → res.write(`data: ${token}\n\n`)；whenIdle 后 res.end()
      await agent.whenIdle()
      res.end()
      return
    }
    res.statusCode = 404; res.end()
  })
  await listenOnLoopback(server, port)           // --host 127.0.0.1 硬约束
  process.stdout.write(`DSH_LISTEN::${port}\n`)  // 让 Rust 侧拿到端口（替代 DSH_RESULT::）
  ctx.effect(() => server.close(), "clipforge-dsh: daemon http server")  // 释放
}
```

**B. `dsh/profiles/clipforge/sidecar.mjs` —— 加 `--serve` 模式**

```js
const SERVE = process.argv.includes("--serve")
const port = Number(process.env.CLIPFORGE_DSH_PORT ?? "3080")
if (SERVE) {
  await boot(BIN_NAME, configPath, patches)     // apply 内 config.serve=true 启动常驻服务
  // 不再 process.exit；保留崩溃兜底看门狗
} else {
  await boot(BIN_NAME, configPath, patches)     // 一次性 runner（现状，保留为降级）
}
```
配置注入：`cordis.patch.yml` 的 `config` 增加 `serve: !!js process.env.CLIPFORGE_DSH_SERVE === "1"`（或直接 argv 透传）。

**C. `src-tauri/src/dsh-daemon.rs`（新增，替代 `dsh.rs` 一次性 spawn）**

- `setup`：`app.shell().sidecar("node")?.args([sidecar, "--serve", "--port", "0"]).spawn()`；读 stdout 的 `DSH_LISTEN::<port>` 捕获真实端口存 `DshDaemonState { child, port, ready }`。
- `get_dsh_status`：`reqwest::get("http://127.0.0.1:{port}/health")`。
- `dsh_chat { message, context }`：Rust `reqwest` POST `/chat`（或转发 SSE 流 → `emit("dsh-chunk", token)` 给前端）。
- `ExitRequested`：`child.kill()`（对齐参考 `electron-runtime` 生命周期）。
- 保留 `analyze_clipboard` 作为无 daemon 时的降级旁路。

**D. 前端 `dsh-client.ts` + `dsh-panel.tsx`**

- `dsh-client.ts`：`dshChat({message,context})` → `invoke("dsh_chat")` + `listen("dsh-chunk")` 流式渲染；`getDshStatus()` + 订阅 `dsh-ready`/`dsh-terminated`。
- `dsh-panel.tsx`：消息列表 + 输入框 + 流式 + 四类卡片 + 写回（`onApplyTags`/`onApplyFolder` 既有链路）；快速唤起复用 `sync_global_shortcut_registration` + `main-tray` + `show_quick_panel`（见 §9.2）。

### 11.4 决策结论（与参考项目对齐/差异）

- **对齐**：loopback HTTP/WS 通信、关窗隐藏常驻 Host、Profile 层叠、健康检查同步、重启即整体 dispose。
- **差异（受 Tauri 架构约束，功能等价）**：参考在 Electron 主进程**内** `boot()`；我们因 Rust 不能跑 TS Cordis，改为 **Rust 常驻管理 node sidecar 子进程**，前端经 Tauri invoke/event 桥接（比参考多一层，但更契合 Tauri 安全模型，且端口发现用 `DSH_LISTEN::` 协议）。
- **不可复用**：上游 web carrier 内部对话端点（submodule 未公开），因此自起 node HTTP/SSE 是确定路径。

---

## 12. 实现状态（2026-08-17 第二阶段：兼容模式已落地）

盟哥决策：**先不造自定义对话 UI，直接嵌入 DSH 官方 Web UI（兼容模式）验证集成能力**，后续再做剪贴板链接/写回。本阶段已完成并验证。

### 12.1 实际落地（取代 §11.3 的"自托管 HTTP"方案）

- **sidecar 常驻模式**：`dsh/profiles/clipforge/sidecar.mjs` 新增 `--serve`，通过 `boot()` 的 `prepare` 回调 `provideCmdline(ctx,{args:['--host','127.0.0.1','--port','3080']})` 注入命令行，让 `dsh-web-app` 的 `web-startup` 解析出 `webStartup`（host/port），`dsh-host-webserver` 在 loopback 绑端口、直接服务 DSH 官方 Web UI。`--host`/`--port` 也可用环境变量 `CLIPFORGE_DSH_HOST`/`CLIPFORGE_DSH_PORT` 覆盖。一次性 `--analyze` 路径保留为 `analyze_clipboard` 降级旁路。
- **profile 接入 web carrier**：`dsh/profiles/clipforge/package.json` 的 `bundles` 顺序为 `dsh-base` → `dsh-web-app` → `@clipforge/dsh-plugin`（web-app 必须在 base 之后、我们的插件之前）；并安装 `@deepseek-ai/dsh-web-app@0.1.0-rc.6`。
- **Rust 常驻守护进程**：`src-tauri/src/dsh.rs` 新增 `DshDaemonState`（`Arc<Mutex<Option<Child>>>`）+ `start_dsh_daemon`/`stop_dsh_daemon`/`get_dsh_status` 三命令；`lib.rs` 在 `setup_app` 自动拉起、`RunEvent::ExitRequested` 杀子进程防孤儿。`get_dsh_status` 用 TCP 探 127.0.0.1:3080 判定就绪。
- **面板嵌入**：`src/dsh/dsh-panel.tsx` 改为兼容模式——轮询 `get_dsh_status` 就绪后 `<iframe src="http://127.0.0.1:3080">` 嵌入官方 Web UI；未就绪显示「启动中/未就绪」；关闭按钮回 clipboard surface。`src/agent/dsh-analysis.ts` 新增 `DSH_WEB_URL`/`startDshDaemon`/`stopDshDaemon`/`getDshStatus` 封装。
- **快速唤起**：复用现有工具栏 `ScanSearch` 按钮 + 下拉「DSH」菜单（`onOpenDsh → setActiveSurface("dsh")`）。全局快捷键/托盘「打开 DSH」留作后续。

### 12.2 验证结果

- headless：`node sidecar.mjs --serve` 启动后 `curl http://127.0.0.1:3080` 返回 `HTTP 200` + DSH 官方 UI（`window.__DSH_BOOT__` + `/plugins/.../client.js`），`/health` 亦 200 → **web carrier 起服确认**。
- `pnpm build:web` ✅、`cargo check` ✅（仅预存 dead_code/unused 警告）。

### 12.3 与 §11.3 的差异与结论

- 原 §11.3 计划「自起 node HTTP/SSE + `agent.followup` + `DSH_LISTEN::` 端口发现」**被本兼容模式取代**：盟哥明确要求「直接使用他的 web 页面、不改动」，嵌入官方 web carrier 更直接、零自研对话 UI、功能对等。
- 后续未做（见对应提案）：剪贴板选中条目写回/文件上下文链接（`dsh-file-context-conversation`）、系统级文件管理器右键（`dsh-system-context-menu`）、provider key 注入时机（当前 spawn 时透传 env，用户也可在 DSH Web UI 内配置）、release 打包 sidecar 为 Tauri 资源（dev 期靠 cwd 祖先目录探测 `dsh/profiles/clipforge/sidecar.mjs`）。
