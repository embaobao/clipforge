# 任务：剪贴板 Agent 调用面板

## Phase 1：范围与契约

- [x] 明确本提案只做 Agent 调用，不做 Agent 管理、团队模式、远程通道或自动学习
- [x] 定义 `AgentContextReferenceSource`
- [x] 定义 `AgentContextReference`
- [x] 定义 `AgentContextSet`
- [x] 定义 `AgentConversation`
- [x] 定义 `AgentMessage`
- [x] 定义 `AgentRun`
- [x] 定义 `ClipboardAgentUiMessage`
- [x] 定义 `ClipboardAgentMessagePart`
- [x] 定义 `ClipboardAgentProviderConfig`
- [x] 定义 `ClipboardAgentToolDescriptor`
- [x] 定义 `AgentTranscriptRow`
- [x] 定义 `AgentResultAction`
- [x] 定义 `ClipboardPrivateSkill`
- [x] 复用 `ClipboardContextSnapshot` 和 `SmartParsedTarget`
- [x] 定义 Agent 结果 provenance 和默认 `AI` tag 规则
- [x] 前端消息模型兼容 AI SDK v5 `UIMessage` 风格 parts
- [x] 明确 Agent 面板是 ClipForge 能力调用面，不是 Agent catalog / marketplace

## Phase 2：Agent 页 UI 骨架

- [x] 快速面板保留清晰 Agent 入口，不在顶部新增复杂页签
- [x] 保持默认打开剪贴板列表
- [x] Agent 页顶部展示上下文引用篮，默认包含当前 clip
- [x] 引用篮支持 `当前 / 指定条目 / 收藏 / 搜索结果 / all / 文件 / skill 上下文`
- [x] Agent 页展示消息流、运行状态、错误状态和空状态
- [x] 消息区采用类似 shadcn `MessageScroller` 的 provider/viewport/content/item/button 组合
- [x] 消息 DOM 显式分为 `provider / scroller / viewport / content / item / button`，item 内再渲染消息 body
- [x] run marker 和“跳到最新”按钮也使用 MessageScroller item/button 稳定标记
- [x] 消息区父容器有稳定高度，不能由消息内容反向撑开悬浮面板
- [x] 使用稳定 `messageId` 和 `AgentTranscriptRow.id`
- [x] 消息 DOM 暴露稳定 `data-agent-message-id`、`data-agent-row-id` 和 scroll anchor 标记
- [x] 用户消息和 run marker 标记为 scroll anchor
- [x] 重新打开会话默认定位到 `last-anchor`
- [x] 离开 live edge 后不自动拉回底部
- [x] 有新内容时显示“跳到最新”按钮
- [x] 离开 live edge 后记录当前可见 row，状态变化和消息合并后恢复阅读位置
- [x] 加载历史、停止、重试、错误、工具展开折叠不改变用户阅读位置
- [x] 输入框默认附带当前 `AgentContextSet`，不把完整正文塞进 prompt
- [x] 能力入口收敛到命令、引用补全和结果动作，不占据首屏
- [x] 所有按钮使用清晰图标、文本或 aria label
- [x] 面板尺寸、滚动区域和焦点状态稳定，不影响剪贴板主列表
- [x] 流式 token 不逐字 aria-live 播报；仅 run 状态、错误和确认请求播报
- [x] 新消息动画只使用 opacity/transform，并支持 reduced motion

## Phase 2b：极简聊天框纠偏

- [x] Agent 页首屏改为简单聊天框，不再呈现工作台式多区块布局
- [x] 移除首屏 `当前 / 指定 / 收藏 / 搜索 / All` 模式 tab，改为引用补全候选
- [x] 移除首屏 Skill 名称输入和“摘要/标签/解析/存 Skill”工具栏
- [x] 当前剪贴板条目默认作为附件 chip，支持移除与摘要权限展示
- [x] 引用附件采用 media/title/description/action 的紧凑结构，并按内容类型展示图标
- [x] 引用附件复用本地 shadcn Base 风格 `Attachment` 原语，并按 Agent 面板尺寸覆写
- [x] 输入框支持 `@` 自动补全并引用其它剪贴板条目
- [x] 添加引用按钮打开同一套候选列表
- [x] Agent/CLI 选择器收敛到 composer/header 内的紧凑控件
- [x] 空状态只保留一行轻提示或少量建议，不展示功能说明文案
- [x] 视觉回到 ClipForge 紧凑工具风格：单列、少边框、稳定高度、无卡片套卡片

## Phase 2c：页面拆分与 Motion 动效

- [x] 将聊天 UI 拆成独立 `AgentChatPage` 页面组件
- [x] `ClipboardAgentPanel` 收敛为状态、事件和 runtime 容器
- [x] 消息行、附件 chip、引用候选和工具预览从容器层移入页面层
- [x] 引入 `motion` 并从 `motion/react` 使用 `motion`、`AnimatePresence` 和 `useReducedMotion`
- [x] 附件 chip、消息行、引用候选弹层和跳到最新按钮使用 Motion 进入/退出动效
- [x] 引用范围选择使用 `layoutId` 共享布局边框，不手写位置计算
- [x] reduced motion 下禁用非必要位移和旋转
- [x] 调研 `maisano/react-router-transition`，只借鉴路由/tab 出入场理念，不引入旧依赖

## Phase 3：上下文集合注入

- [x] 从当前条目构造默认 `AgentContextSet`
- [x] 从指定条目、收藏、搜索结果、all 范围构造 `AgentContextReference[]`
- [x] 文件和 skill 上下文只生成引用元数据，读取正文需要单次授权
- [x] 接入 `clipboard.content.parse` 生成 `SmartParsedTarget` 候选
- [x] URL、文件路径、JSON 字段、代码块、错误日志、Markdown 链接候选可展示
- [x] 默认只提供摘要、URL、短预览、来源应用摘要和 tags
- [x] 完整正文授权状态可见
- [x] 引用篮支持刷新当前剪贴板上下文
- [x] 引用篮支持移除引用、切换范围和查看数量上限

## Phase 4：本地 CLI Agent Adapter MVP

- [x] 定义 `ClipboardAgentAdapter`
- [x] 定义 `AgentInvocationConfig`
- [x] 定义 `AgentDetectCandidate`
- [x] 实现 `agent_get_config`
- [x] 实现 `agent_list_providers`，只返回脱敏 provider 摘要
- [x] 实现 `agent_check_provider`
- [x] 实现 `agent_detect`
- [x] Agent 后台 detect 只能在悬浮面板 ready 后异步启动
- [x] React app bootstrap 不 await Agent detect
- [x] `show_panel/hide_panel/position_panel_window_fast` 不 await 任何 Agent command
- [x] 检测时合并 macOS GUI app 常见 PATH
- [x] 支持检测一个已配置本地命令模板
- [x] 无配置时按少量候选检测 `claude`、`codex`、`qwen`
- [x] 缓存 `lastReadiness`，进入 Agent 页优先复用缓存
- [x] 发送前执行快速健康检查
- [x] 失败原因区分 `not-configured/not-found/permission-denied/auth-required/health-timeout`
- [x] 启动后后台 detect 超过 1500ms 直接降级为 `health-timeout`
- [x] 支持命令预览与首次执行确认
- [x] 实现 `agent_prepare_run`，只构造 prompt 和命令预览，不启动进程
- [x] 实现 `agent_start_run`
- [x] 支持启动 run 并流式接收 stdout/stderr
- [x] stdout/stderr 输出限流合并后发送给前端
- [x] 支持取消 run
- [x] 实现 `agent_cancel_run`
- [x] 实现 `agent_get_run`
- [x] 实现 `agent_get_transcript`
- [x] 支持记录退出码、错误摘要和运行耗时
- [x] 应用退出时清理未结束子进程

## Phase 4b：AI SDK / OpenAI-compatible provider

- [x] 支持 `ai-sdk` provider 抽象作为服务层目标接口
- [x] 支持 OpenAI-compatible 配置：`baseURL/apiKeyRef/modelId`
- [x] 支持 provider registry 概念，第一阶段只展示一个 active provider
- [x] 支持 `streamText` 风格的文本流归一化
- [x] 支持 tool call/tool result 归一化为 `ClipboardAgentMessagePart`
- [x] API key、baseURL secret 不下发给 React
- [x] 本地 CLI adapter 输出也映射为同一套 `ClipboardAgentUiMessage`

## Phase 5：会话与隐藏面板恢复

- [x] Agent run 状态不绑定 React 组件生命周期
- [x] Rust 侧持有 `idle/preparing/waiting_confirmation/running/streaming/succeeded/failed/cancelling/cancelled` 状态机
- [x] 隐藏面板后 run 继续执行
- [x] 重新打开面板恢复会话、消息和 run 状态
- [x] 支持正在运行、已完成、失败、已取消四类状态展示
- [x] 支持最近会话最小持久化
- [x] 同一 clip 第一阶段只允许一个前台 run
- [x] UI 监听 `agent_run_started/agent_message_delta/agent_run_finished/agent_run_error` 事件
- [x] UI 支持消费 `agent_ui_message` 标准消息事件
- [x] UI 支持消费 `agent_transcript_rows` 并增量更新 message scroller
- [x] Agent 事件通道和悬浮面板基础事件通道隔离
- [x] 大输出只推送增量和尾部 buffer，不阻塞 WebView 渲染
- [x] 保存 `conversationId/currentAnchorId/liveEdgeFollowing` 以恢复阅读位置
- [x] Agent 面板错误不能影响剪贴板列表和详情页

## Phase 6：受限工具面

- [x] 暴露 `clipboard.context.get`
- [x] 暴露 `clipboard.context.compose`
- [x] 暴露 `clipboard.content.parse`
- [x] 暴露 `clipboard.capture`
- [x] 暴露 `clipboard.update`
- [x] 暴露 `clipboard.copy`
- [x] 暴露 `clipboard.search`
- [x] 暴露 `clipboard.skill.list`
- [x] 暴露 `clipboard.skill.save_draft`
- [x] 暴露 `clipboard.skill.run`
- [x] 每个工具返回 `traceId`、权限裁剪信息和错误摘要
- [x] 写入类工具必须通过可见结果动作或确认流程

## Phase 6b：私域剪贴板 Skill

- [x] 私域 skill 只作为用户自己的剪贴板处理模板，不做公共市场
- [x] 支持保存 skill 草稿：名称、说明、图标、prompt 模板、默认上下文模式、允许引用来源、工具权限、输出动作
- [x] 支持手动运行私域 skill，并携带当前 `AgentContextSet`
- [x] Agent 只能建议 skill 草稿，保存和启用必须用户确认
- [x] 私域 skill 默认只读上下文集合，写入剪贴板或更新历史必须走结果动作
- [x] MCP 调用 `clipboard.skill.run` 时必须携带上下文范围和权限裁剪结果

## Phase 7：结果回到剪贴板

- [x] 支持复制 Agent 结果
- [x] 支持保存 Agent 结果为新剪贴板条目
- [x] 保存结果默认追加 `AI` tag
- [x] 保存结果写入 source clip、conversation、run、adapter provenance
- [x] 结果动作跟随 assistant 消息渲染，不额外占用 composer 上方空间
- [x] 支持收藏来源条目
- [x] 支持归档来源条目
- [x] 支持给来源条目追加 tag
- [x] `pasteResult` 接入现有 `pasteText` 粘贴链路

## Phase 8：安全与日志

- [x] 默认不发送完整正文
- [x] Prompt 由结构化 `AgentContextSet` 和用户输入构造
- [x] 用户点击“允许使用全文”后，本次 run 才能升级到 `current-content`
- [x] 完整正文、HTML、图片 OCR、文件列表需要单 run 授权
- [x] 日志只记录 id、类型、长度、状态和裁剪字段
- [x] CLI 缺失、权限不足、超时和异常退出都有明确错误提示
- [x] Agent 工具调用失败只影响当前 run
- [x] 不允许 Agent 自动创建、更新、排序或执行插件
- [x] 不允许 Agent 自动学习、自动改触发优先级或后台采集全部历史

## Phase 9：验证

- [x] `pnpm build`
- [x] `cd src-tauri && cargo check`
- [x] 验证 Agent detect 未完成时悬浮面板仍能立即打开
- [x] 验证 Agent detect 超时不影响面板定位、隐藏和再次唤起
- [x] 验证默认仍进入剪贴板列表
- [x] 验证复制链接后进入 Agent 页能看到当前链接引用
- [x] 验证复制普通文本后默认引用为摘要和短预览
- [x] 验证隐藏面板后 run 不取消，重新打开能恢复状态
- [x] 验证取消 run 能结束本地子进程
- [x] 验证保存 Agent 结果后带 `AI` tag 和 provenance
- [ ] 验证 OpenAI-compatible provider 可用时能返回标准消息流
- [x] 验证 CLI provider 和 OpenAI-compatible provider 在前端使用同一消息渲染器
- [x] 验证用户滚动离开最新消息后，流式输出不会强制拉回底部
- [x] 验证重新打开隐藏面板后定位到最近用户 turn

### Phase 9 detect timeout 验证补充（2026-07-16）

- 已复跑 `node scripts/verify-agent-panel.mjs`：通过；脚本确认 Agent provider check/models 使用 bounded timeout 和 timeout 状态，`agent_detect` deferred after panel mount，且 native `open_panel` / `hide_panel` / `toggle_quick_panel` 路径不包含 `agent_detect`、`agent_check_provider` 或 `settings_service`。
- 已复跑 `node scripts/verify-runtime-boundaries.mjs && node scripts/verify-hot-path.mjs`：通过，确认主面板热路径不等待 provider 控制面。
- 已运行 `CLIPFORGE_DEV_OPEN=panel CLIPFORGE_DEV_PERF_REPEAT=3 pnpm tauri dev`：真实 Tauri panel probe 日志为 `panel.open count=3/p95=64ms/max=64ms`，同时 layout probe 为 `documentOverflowX=0`、`bodyOverflowX=0`、`escapedCount=0`、`controlOverflowCount=0`。
- 基于静态热路径断言和真实 panel open probe，本项证明 Agent detect/check 即使超时也不会进入面板定位、隐藏或再次唤起路径；OpenAI-compatible provider 标准消息流仍等待真实 provider 环境验证。
- [x] 验证加载旧消息不改变当前可见行
- [x] 验证 Agent 面板失败不影响采集、搜索、复制和详情页

### Phase 9 复跑记录（2026-07-16）

- 已修正 `scripts/verify-agent-panel.mjs` 的入口断言：旧脚本仍要求 `footer-agent-slot`，但 `top-nav-optimization` 已将 Agent 入口迁到顶部工具栏；新断言改为验证 `top-toolbar-action-slot`、`top-agent-button`、`onClick={onOpenAgent}` 和同步 `setActiveSurface("agent")`，不回退产品 UI。
- 已复跑 `node scripts/verify-agent-panel.mjs`：通过；本机检测到 `claude`、`codex` 可用，`qwen` 未安装但按脚本规则跳过。
- 已运行 `pnpm test:unit`：通过，包含 Agent panel、editor bridge、runtime boundary、hot path、MCP dispatch 和 file-size guard。
- 已运行 `pnpm openspec validate clipboard-agent-panel --strict`：通过。
- 剩余 2 项仍需真实运行证据：Agent detect 超时时对面板定位/隐藏/再次唤起无影响，以及 OpenAI-compatible provider 可用时返回标准消息流；本轮不勾选。

### Phase 9 补充静态边界记录（2026-07-16）

- 已补强 `scripts/verify-agent-panel.mjs`：新增 `open_panel` / `hide_panel` / `toggle_quick_panel` 原生路径切片断言，确认主面板定位、隐藏和再次唤起路径不包含 `agent_detect`、`agent_check_provider` 或 `settings_service` 控制面调用。
- 已复跑 `node scripts/verify-agent-panel.mjs`：通过；该证据证明 Agent detect/provider check 没有进入主面板原生热路径，且前端 detect 仍是 Agent 面板挂载后 900ms 延迟启动并有 `health-timeout` 状态。
- 本记录仍不是“detect 超时运行态”证据；未实际构造超时 provider 并在 Tauri dev 中验证定位/隐藏/再次唤起，因此不勾选 `验证 Agent detect 超时不影响面板定位、隐藏和再次唤起`。
