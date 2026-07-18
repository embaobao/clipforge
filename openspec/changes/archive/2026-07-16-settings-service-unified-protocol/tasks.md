# 任务：统一 Settings Service 与 MCP 设置协议

## Phase 1：协议与现状确认

- [x] 审计前端所有设置读写入口：设置窗口、主面板、Agent 面板
- [x] 审计 native 设置读写入口：`read_user_settings`、`write_user_settings`、`get_clipforge_settings`、`update_clipforge_settings`
- [x] 审计 MCP 工具列表，确认新增 `clipf.settings.*` 和 `clipf.agent.*` 不破坏现有工具
- [x] 固化 `SettingsDocument`、`SettingsPatchRequest`、`SettingsChangedEvent` 类型
- [x] 明确第一阶段不迁移主面板
- [x] 固化控制面与热路径边界：Settings Service 只进设置窗口、Agent 配置面和 MCP，不进入主面板快捷键/滚动/复制链路
- [x] 明确前端设置页不通过 MCP stdio 调本机服务，而是和 MCP 共享同一 Rust Settings Service
- [x] 定义主面板保护验收：打开面板不拉 schema、不跑 provider check、不拉 models、不等待 settings patch
- [x] 固化 300ms 性能预算：主面板打开、选中、滚动、复制/粘贴反馈 P95 <= 300ms；设置页切换和本地设置操作反馈 P95 <= 300ms
- [x] 明确网络类操作不阻塞同步链路：provider check、models、updater、导出诊断包只要求 300ms 内显示状态反馈

## Phase 2：Rust Settings Service

- [x] 新增 Settings Service 模块，集中实现 get / patch / replace / reset
- [x] 实现 JSON Schema 生成或静态 schema
- [x] 实现 patch schema 校验和错误路径返回
- [x] 实现 replace/reset 显式确认校验
- [x] 实现 revision / expectedRevision 冲突检测
- [x] 实现 temp file + atomic rename 写入
- [x] 写入成功后发出 `settings_changed`
- [x] `settings_changed` 只携带 revision、changedPaths、actor、mode、updatedAt，不携带完整 schema
- [x] `get(includeSchema=false)` 支持省略 schema，供后续轻量刷新使用
- [x] Settings Service get/patch/replace/reset 记录 durationMs，超过 300ms 写入 app log
- [x] MCP settings handler 记录 durationMs，超过 300ms 返回或记录 slow-call hint

## Phase 3：Agent Provider 能力

- [x] 将 provider 解析收敛到 Settings Service
- [x] 读取兼容旧 `agentProviders`，新写入使用 `agent.providers`
- [x] 支持 `agent.defaultProviderId`
- [x] Provider 响应 redacted，不回传明文 `apiKey`
- [x] 实现 provider readiness check
- [x] 实现 OpenAI-compatible models 拉取
- [x] local CLI provider 对 models 返回 `not-supported`
- [x] readiness/models 必须按需触发，不能随主面板打开自动串行执行
- [x] readiness/models 必须有 timeout 和错误摘要，不阻塞剪贴板主流程
- [x] readiness/models 300ms 内必须有 loading/pending 状态，真实网络完成可异步返回
- [x] readiness/models 结果必须支持忽略过期请求，避免慢返回覆盖新状态

## Phase 4：Tauri 与前端服务适配

- [x] 新增 `settings_service_get`
- [x] 新增 `settings_service_patch`
- [x] 新增 `settings_service_replace`
- [x] 新增 `settings_service_reset`
- [x] 新增 `settings_service_agent_providers`
- [x] 新增 `settings_service_agent_check`
- [x] 新增 `settings_service_agent_models`
- [x] 新增 `src/services/settings.ts`
- [x] 设置窗口改用 `settingsService`
- [x] 主面板保持现状，不迁移
- [x] `src/services/settings.ts` 缓存 schema，同 revision 刷新不重复拉完整 schema
- [x] Agent 配置区改用 `settingsService.agent.*` 时保持手动测试/刷新触发，不做首屏串行网络检查
- [x] `src/services/settings.ts` 记录调用 durationMs，开发环境超过 300ms 输出 warn
- [x] 设置页 sidebar/tab 切换不等待 settings get/schema；慢刷新必须后台完成
- [x] 设置页表单操作 300ms 内给出 pending/saved/error 可见反馈
- [x] 主面板代码中禁止同步调用 `settings_service_*`、`clipf.settings.*`、provider check 或 models

## Phase 5：MCP 工具适配

- [x] 新增 `clipf.settings.get`
- [x] 新增 `clipf.settings.patch`
- [x] 新增 `clipf.settings.replace`
- [x] 新增 `clipf.settings.reset`
- [x] 新增 `clipf.agent.providers`
- [x] 新增 `clipf.agent.check`
- [x] 新增 `clipf.agent.models`
- [x] 所有 MCP 写入响应包含 revision、changedPaths、nextActions
- [x] replace/reset 缺少 confirmed 时返回明确错误和修复提示
- [x] MCP settings 工具复用 Settings Service，不直接写 settings 文件
- [x] MCP settings 工具异常不影响已有 `clipf.list`、`clipf.get`、`clipf.copy`
- [x] MCP `clipf.settings.get` 支持 `includeSchema=false`，用于 300ms 内轻量读取
- [x] MCP 写入返回包含 durationMs，便于 Agent 判断是否需要降级为后台刷新

## Phase 6：验证

- [x] `pnpm exec tsc --noEmit` 通过
- [x] `cd src-tauri && cargo check` 通过
- [x] 增加或运行性能 smoke：主面板打开路径 P95 <= 300ms
- [ ] 增加或运行性能 smoke：主面板选中、滚动、复制/粘贴反馈 P95 <= 300ms
- [x] 增加或运行性能 smoke：设置页 sidebar/tab 切换 P95 <= 300ms
- [x] 增加或运行性能 smoke：settings get(includeSchema=false) / patch 本地响应 P95 <= 300ms
- [x] MCP `tools/list` 能看到新增 schema
- [x] MCP `clipf.settings.get` 返回 settings + schema + writePolicy
- [x] MCP `clipf.settings.patch` 可局部更新设置
- [x] MCP `clipf.settings.patch` schema 错误返回路径和 hint
- [x] MCP `clipf.settings.replace` 未确认时拒绝
- [x] MCP `clipf.settings.reset` 未确认或缺 scope 时拒绝
- [x] 设置窗口写入后收到 `settings_changed`
- [ ] 主面板现有能力不受影响
- [x] 验证主面板打开路径没有新增 `settings_service_get` / schema / provider check / models 调用
- [x] 验证快速列表滚动和选中态不因 `settings_changed` 产生整页重渲染
- [x] 验证复制/粘贴回写不等待 Settings Service 或 MCP 工具
- [x] 验证 provider check/models 超过 300ms 时不阻塞面板和设置页切换，只显示 loading/pending

### Phase 6 验证记录（2026-07-15）

- 已运行 `pnpm test:perf`：通过；当前脚本证明 `window.__clipforgePerf` 收集器、主面板 `panel.open` / `quick.select` / `quick.scroll` / `quick.copy` / `quick.paste`、设置页 `settings.section` / `settings.changed` 采样点，以及 Settings Service 300ms duration/warn 埋点存在。
- 已运行 `openspec validate settings-service-unified-protocol --strict`：通过。
- 已运行 `node scripts/verify-hot-path.mjs`、`node scripts/verify-runtime-boundaries.mjs`、`pnpm exec tsc --noEmit`、`cd src-tauri && cargo check`：通过；`cargo check` 仅保留既有 unused/dead_code warnings。
- 已运行受限 `pnpm tauri dev`：Vite 与 Tauri dev build 启动成功，随后手动停止；本环境无法可靠进入运行中 WebView DevTools 执行 `window.__clipforgePerf.summary()`，因此未拿到真实 GUI P95 样本。
- 剩余未勾选项仍需真实 Tauri GUI 交互证据：主面板打开、主面板选中/滚动/复制/粘贴、设置页 sidebar/tab 切换的 P95；设置窗口写入后实际收到 `settings_changed`；主面板现有能力的端到端复制/粘贴回归。仅有静态/编译证据，不足以将这些项标记完成。

### Phase 6 验证记录（2026-07-16）

- 已修复 hot-path guard 冲突：`src/App.tsx` 不再 import / 调用 `settingsService`，主面板设置持久化退回 legacy `write_user_settings`，设置窗口继续使用统一 Settings Service。
- 已运行 `node scripts/verify-hot-path.mjs`：通过，主面板源文件不再包含 `settings_service_*`、`settingsService`、`settings_changed`、provider check 或 models 控制面 token。
- 已运行 `pnpm test:boundaries`：通过；`verify-runtime-boundaries.mjs` 已同步新的 `settings-field-catalog` 一级分类 i18n key。
- 已运行 `pnpm exec tsc --noEmit`：通过。
- 剩余未勾选项不变，仍需真实 Tauri GUI 交互证据证明 P95 和端到端主面板能力。

### Phase 6 复跑记录（2026-07-16）

- 已复跑 `pnpm test:perf`：通过；静态确认 `window.__clipforgePerf`、主面板 `panel.open` / `quick.select` / `quick.scroll` / `quick.copy` / `quick.paste`、设置页 `settings.section` / `settings.changed` 采样点和 300ms warn 埋点仍存在。
- 已复跑 `pnpm test:boundaries`：通过；hot-path guard、runtime boundary 和 file-size guard 均通过，file-size 仅输出既有豁免文件还债提醒。
- 已复跑 `pnpm exec tsc --noEmit`：通过。
- 已复跑 `cd src-tauri && cargo check`：通过；仅保留既有 unused/dead_code warnings。
- 已运行 `pnpm tauri dev`：Vite 启动成功，Tauri dev build 成功，`target/debug/clipforge` 与 `--mcp` 子进程均启动；`clipforge` 在 System Events 中为 `background=true`，无普通前台窗口。
- 已尝试通过默认 `Control+V` 全局快捷键触发快速面板；System Events 仍显示 `clipforge windows=0`，当前自动化上下文无法进入 WebView 执行 `window.__clipforgePerf.summary()`。
- 本轮仍未取得运行中 WebView 的 P95 样本，也未取得设置窗口实际接收 `settings_changed` 和主面板端到端复制/粘贴证据，因此不勾选剩余 GUI 验收项。
- 已新增仅 debug 构建启用的验收辅助入口：设置 `CLIPFORGE_DEV_OPEN=panel|settings|settings:onboarding` 后启动 `pnpm tauri dev` 会自动在主线程触发对应窗口，用于后续采样 `window.__clipforgePerf.summary()` 和设置窗口事件验证；默认启动行为不变，本项只是解锁后续 GUI 验收，不替代真实 P95 / `settings_changed` 证据。
- 已运行 `CLIPFORGE_DEV_OPEN=settings:onboarding pnpm tauri dev`：原生日志显示 `[dev-open] CLIPFORGE_DEV_OPEN=settings:onboarding triggered`，并且设置窗口复用到 `settings.html?section=onboarding`、`visible=true`；但 System Events 仍显示 `background=true windows=0`，未取得运行中 WebView 和 P95 样本。
- 已运行 `CLIPFORGE_DEV_OPEN=panel pnpm tauri dev`：原生日志显示 `open_panel: source=dev-open`、`show panel: panelVisible=true windowVisible=true`、`[dev-open] CLIPFORGE_DEV_OPEN=panel triggered`；但 System Events 仍显示 `background=true windows=0`，因此仅证明 debug trigger 和 native open path 可达，不证明 GUI/P95 验收完成。
- 已运行 `cd src-tauri && cargo check`、`pnpm openspec validate settings-service-unified-protocol --strict`：通过；`cargo check` 仅保留既有 unused/dead_code warnings。`cargo fmt --check` 当前仍会报告 `src-tauri/src/lib.rs` 既有格式差异，本轮不做全文件格式化以避免无关噪声。

### Phase 6 WebView 探针记录（2026-07-16）

- 已运行 `CLIPFORGE_DEV_OPEN=panel pnpm tauri dev`：debug-only 原生入口启动快速面板后，通过 `WebviewWindow::eval_with_callback` 读取到 `window.__clipforgePerf.summary()`，日志为 `[dev-open] CLIPFORGE_DEV_OPEN=panel perf_probe {"sampleCount":1,"target":"panel","summary":[{"label":"panel.open","count":1,"max":62,"p50":62,"p95":62}]}`。
- 本记录证明 WebView 采样探针已打通，且单次 `panel.open` 样本低于 300ms；但样本数只有 1，不满足主面板打开路径 P95 验收所需的稳定样本量，也未覆盖 `quick.select` / `quick.scroll` / `quick.copy` / `quick.paste`、设置页 `settings.section` / `settings.changed`，因此 Phase 6 剩余 GUI 验收项仍不勾选。
- 本次 `pnpm tauri dev` 会话已停止，并确认没有残留 `tauri dev`、`clipforge`、`cargo run` 或 `vite --host` 进程。

### Phase 6 主面板打开 P95 记录（2026-07-16）

- 已新增 debug-only `CLIPFORGE_DEV_PERF_REPEAT`，用于在 `CLIPFORGE_DEV_OPEN=panel` 后重复触发快速面板 WebView 采样；默认值为 1，仅在 debug 构建生效，不改变 release 或普通启动行为。
- 已运行 `CLIPFORGE_DEV_OPEN=panel CLIPFORGE_DEV_PERF_REPEAT=30 pnpm tauri dev`：Tauri dev build 启动成功，`window.__clipforgePerf.summary()` 日志为 `[dev-open] CLIPFORGE_DEV_OPEN=panel perf_probe {"target":"panel","sampleCount":30,"href":"http://localhost:1420/","repeatCount":30,"summary":[{"label":"panel.open","count":30,"p50":62,"p95":63,"max":63}]}`。
- 基于 30 次运行中 WebView 样本，主面板打开路径 `panel.open` P95=63ms，满足 P95 <= 300ms；已勾选主面板打开路径性能 smoke。当时剩余仍需补 `quick.select` / `quick.scroll` / `quick.copy` / `quick.paste`、设置页 `settings.section` / `settings_changed` 和主面板端到端能力证据；其中设置页 `settings.section` 与 `settings_changed` 已在后续记录补齐。

### Phase 6 设置页切换 P95 记录（2026-07-16）

- 已扩展 debug-only perf probe：`CLIPFORGE_DEV_OPEN=settings CLIPFORGE_DEV_PERF_REPEAT=30` 会在设置窗口中重复点击一级 sidebar 导航，并通过 `window.__clipforgePerf.summary()` 读取 `settings.section` 样本；默认 repeat 仍为 1，仅 debug 构建生效。
- 已修复 `recordNextFramePerf` 在非 key/background Tauri WebView 中因 `requestAnimationFrame` 暂停而丢样本的问题：保留 next-frame 采样，同时增加 120ms 去重 fallback timer，并在样本 meta 中记录 `sampleSource=raf|fallback`。
- 已修复设置页首屏阻塞点：初始化 `Promise.all` 不再 await `safeInvokeUpdateCheck()`；更新检查改为设置页首屏渲染后的后台回填，手动“检查更新”仍执行真实 `check_update`。
- 已运行 `CLIPFORGE_DEV_OPEN=settings CLIPFORGE_DEV_PERF_REPEAT=30 pnpm tauri dev`：Tauri dev build 启动成功，日志为 `[dev-open] CLIPFORGE_DEV_OPEN=settings perf_probe {"target":"settings","summary":[{"label":"settings.section","count":30,"p50":122,"max":138,"p95":127}],"repeatCount":30,"sourceCounts":{"fallback":30},"href":"http://localhost:1420/settings.html","sampleCount":30,"settingsButtonCount":7,"hasPerfCollector":true}`。
- 基于 30 次运行中 WebView 样本，设置页 sidebar/tab 切换 `settings.section` P95=127ms，满足 P95 <= 300ms；当前设置窗口非 key 状态下样本来源为 fallback，证明切换反馈在 300ms 内落入采样窗口，但不把它夸大为 `settings_changed` 或主面板端到端证据。已勾选设置页 sidebar/tab 切换性能 smoke。剩余仍需补 `quick.select` / `quick.scroll` / `quick.copy` / `quick.paste`、设置窗口实际收到 `settings_changed` 和主面板端到端能力证据。
- 已新增仅 debug 构建且显式环境变量启用的 `settings_changed` 探针：`CLIPFORGE_DEV_OPEN=settings CLIPFORGE_DEV_SETTINGS_CHANGED_PROBE=1 pnpm tauri dev` 会通过真实 `settings_service_patch` 将既有 `logMaxLines` 临时从 20000 改为 20001，再恢复为 20000；默认启动和 release 不执行该探针。
- 已运行 `CLIPFORGE_DEV_OPEN=settings CLIPFORGE_DEV_SETTINGS_CHANGED_PROBE=1 pnpm tauri dev`：日志显示 `[settings-service] patch actor=dev-open reason=settings-changed-probe changed=$.logMaxLines`、`settings_changed probe patched logMaxLines 20000 -> 20001`、`settings_changed probe restored logMaxLines=20000`，最终 WebView summary 为 `settings.changed count=2/p50=120ms/p95=122ms/max=122ms`、`sourceCounts={"fallback":3}`。
- 已核对用户设置文件 `/Users/embaobao/Library/Application Support/ClipForge/settings.json5`，`logMaxLines` 已恢复为 20000；基于真实 Settings Service 写入和设置窗口订阅采样，设置窗口写入后收到 `settings_changed` 验收通过。剩余仍需补 `quick.select` / `quick.scroll` / `quick.copy` / `quick.paste` 运行中 P95，以及主面板端到端能力证据。
- 已新增显式启用的 debug-only `CLIPFORGE_DEV_QUICK_PROBE=1` 主面板 quick 探针，并增加 `CLIPFORGE_DEV_TEXTEDIT_TARGET=1` 受控粘贴目标保护；在同时设置 `CLIPFORGE_DEV_TEXTEDIT_TARGET=1` 的受控模式下，只有 macOS TextEdit 临时文档准备成功后才会触发真实 `quick.paste`，否则记录 skip，避免把系统级 `Command+V` 打到当前前台应用。
- 已运行小样本 `CLIPFORGE_DEV_OPEN=panel CLIPFORGE_DEV_PERF_REPEAT=2 CLIPFORGE_DEV_QUICK_PROBE=1 CLIPFORGE_DEV_TEXTEDIT_TARGET=1 pnpm tauri dev`：本机 AppleScript/TextEdit 目标准备失败，日志显示 `quick probe TextEdit target spawn failed: osascript timed out after 3000ms`、`quick_probe skipped: controlled paste target is not ready`，最终 summary 只包含 `panel.open count=3/p95=62ms`；本次仅证明保护逻辑生效，不证明 `quick.select` / `quick.scroll` / `quick.copy` / `quick.paste` P95，因此不勾选剩余 quick 性能项或主面板端到端项。

### Phase 6 quick 探针安全加固记录（2026-07-16）

- 已新增 debug-only `CLIPFORGE_DEV_PASTE_TARGET=browser` 受控目标：探针会创建临时本地 HTML `textarea`，默认用 Safari 打开，并在确认目标浏览器确实成为前台应用后才允许 `quick.paste`；可用 `CLIPFORGE_DEV_BROWSER_TARGET_APP` 指定其它浏览器。若目标未成为前台，探针保持 skip，避免真实 `Command+V` 粘贴到当前工作应用。
- 已加固 paste-time 二次确认：debug quick probe 开启时，原生粘贴路径在 `simulate_platform_paste()` 前会再次确认受控目标仍 ready 且仍是预期前台应用；若目标丢失、过期或被其它应用抢前台，则返回错误并不发送系统 `Command+V`。
- 已把 macOS 粘贴目标恢复从 AppleScript `tell application id ... to activate` 改为 `open -b <bundleId>`，用于降低 `restore_paste_target_focus()` 的进程调用延迟；正式复制/粘贴的数据路径不变。
- 已补主面板全局 keydown / drag handler 的 DOM target 保护：当程序化事件 target 不是 `Element` 时不再调用 `closest()` 抛错，避免探针或其它合成事件导致面板级异常。
- 已运行 `pnpm exec tsc --noEmit`、`cd src-tauri && cargo fmt --check && cargo check`、`pnpm openspec validate settings-service-unified-protocol --strict`：通过；`cargo check` 仅保留既有 unused/dead_code warnings。
- 已运行 `CLIPFORGE_DEV_OPEN=panel CLIPFORGE_DEV_PERF_REPEAT=4 CLIPFORGE_DEV_QUICK_PROBE=1 CLIPFORGE_DEV_PASTE_TARGET=browser pnpm tauri dev`：Tauri dev build 启动成功，但 Safari 未能在当前桌面自动成为前台，日志显示 `quick probe browser target failed: target app is not frontmost expected=Safari actual=ChatGPT|com.openai.codex`，随后 `quick_probe skipped: controlled paste target is not ready`，未执行真实 paste；本次证明安全 guard 生效，但仍未取得可信 quick P95。
- 已修正 debug-only 受控目标缓存：浏览器/TextEdit 目标准备成功后会保存目标 app bundle，并在每次 quick probe 触发前把 paste restore 目标重写回受控目标，避免 `open_panel` 的 paste target snapshot 被当前 Codex/ChatGPT 前台应用覆盖；正式 release 和普通粘贴路径不受影响。
- 已尝试 `CLIPFORGE_DEV_OPEN=panel CLIPFORGE_DEV_PERF_REPEAT=6 CLIPFORGE_DEV_QUICK_PROBE=1 CLIPFORGE_DEV_PASTE_TARGET=browser CLIPFORGE_DEV_BROWSER_TARGET_APP="Google Chrome" pnpm tauri dev`：日志显示 `quick probe browser target failed: target app is not frontmost expected=Google Chrome actual=ChatGPT|com.openai.codex`，随后 6 次 `quick_probe skipped: controlled paste target is not ready`，summary 只有 `panel.open count=6/p95=63ms/max=63ms`；本次不能作为 quick P95 或端到端主面板能力证据。
- 已复跑默认 Safari 受控目标：日志显示 `quick probe browser target failed: target app is not frontmost expected=Safari actual=ChatGPT|com.openai.codex`，随后 6 次 skip，summary 只有 `panel.open count=6/p95=63ms/max=63ms`。
- 已用外部最小实验直接 `open -a Safari <textarea.html>` 和 `open -a TextEdit <txt>` 后等待 4 秒再查 `System Events` frontmost，结果均仍为 `ChatGPT|com.openai.codex`；当前运行环境不能自动把 Safari/TextEdit 置为前台，因此真实 `quick.copy` / `quick.paste` P95 仍需要人工置前受控输入目标或提供可自动前台化的专用测试目标。
- 中间诊断曾在未校验前台目标时采到 `panel.open p95=63ms`、`quick.select p95=122ms`、`quick.scroll p95=122ms`、`quick.copy p95=29ms`、`quick.paste p95=2294ms`，但日志显示当时粘贴目标快照仍指向 `com.openai.codex`，不能作为 P0 验收证据。剩余两项继续保持未勾选，后续需要人工把 Safari/TextEdit/其它受控输入目标置前台，或提供可自动前台化的专用测试目标后再复跑。
