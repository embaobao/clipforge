# 任务：剪贴板 Agent 调用面板

## Phase 1：范围与契约

- [ ] 明确本提案只做 Agent 调用，不做 Agent 管理、团队模式、远程通道或自动学习
- [ ] 定义 `AgentContextReferenceSource`
- [ ] 定义 `AgentContextReference`
- [ ] 定义 `AgentContextSet`
- [ ] 定义 `AgentConversation`
- [ ] 定义 `AgentMessage`
- [ ] 定义 `AgentRun`
- [ ] 定义 `ClipboardAgentUiMessage`
- [ ] 定义 `ClipboardAgentMessagePart`
- [ ] 定义 `ClipboardAgentProviderConfig`
- [ ] 定义 `ClipboardAgentToolDescriptor`
- [ ] 定义 `AgentTranscriptRow`
- [ ] 定义 `AgentResultAction`
- [ ] 定义 `ClipboardPrivateSkill`
- [ ] 复用 `ClipboardContextSnapshot` 和 `SmartParsedTarget`
- [ ] 定义 Agent 结果 provenance 和默认 `AI` tag 规则
- [ ] 前端消息模型兼容 AI SDK v5 `UIMessage` 风格 parts
- [ ] 明确 Agent 面板是 ClipForge 能力调用面，不是 Agent catalog / marketplace

## Phase 2：Agent 页 UI 骨架

- [ ] 快速面板新增 `剪贴板 / Agent` 页签
- [ ] 保持默认打开剪贴板列表
- [ ] Agent 页顶部展示上下文引用篮，默认包含当前 clip
- [ ] 引用篮支持 `当前 / 指定条目 / 收藏 / 搜索结果 / all / 文件 / skill 上下文`
- [ ] Agent 页展示消息流、运行状态、错误状态和空状态
- [ ] 消息区采用类似 shadcn `MessageScroller` 的 provider/viewport/content/item/button 组合
- [ ] 消息区父容器有稳定高度，不能由消息内容反向撑开悬浮面板
- [ ] 使用稳定 `messageId` 和 `AgentTranscriptRow.id`
- [ ] 用户消息和 run marker 标记为 scroll anchor
- [ ] 重新打开会话默认定位到 `last-anchor`
- [ ] 离开 live edge 后不自动拉回底部
- [ ] 有新内容时显示“跳到最新”按钮
- [ ] 加载历史、停止、重试、错误、工具展开折叠不改变用户阅读位置
- [ ] 输入框默认附带当前 `AgentContextSet`，不把完整正文塞进 prompt
- [ ] 能力入口提供标准 skill、私域 skill、MCP tool、标签管理、收藏/归档、结果回填
- [ ] 所有按钮使用清晰图标、文本或 aria label
- [ ] 面板尺寸、滚动区域和焦点状态稳定，不影响剪贴板主列表
- [ ] 流式 token 不逐字 aria-live 播报；仅 run 状态、错误和确认请求播报
- [ ] 新消息动画只使用 opacity/transform，并支持 reduced motion

## Phase 3：上下文集合注入

- [ ] 从当前条目构造默认 `AgentContextSet`
- [ ] 从指定条目、收藏、搜索结果、all 范围构造 `AgentContextReference[]`
- [ ] 文件和 skill 上下文只生成引用元数据，读取正文需要单次授权
- [ ] 接入 `clipboard.content.parse` 生成 `SmartParsedTarget` 候选
- [ ] URL、文件路径、JSON 字段、代码块、错误日志、Markdown 链接候选可展示
- [ ] 默认只提供摘要、URL、短预览、来源应用摘要和 tags
- [ ] 完整正文授权状态可见
- [ ] 引用篮支持刷新当前剪贴板上下文
- [ ] 引用篮支持移除引用、切换范围和查看数量上限

## Phase 4：本地 CLI Agent Adapter MVP

- [ ] 定义 `ClipboardAgentAdapter`
- [ ] 定义 `AgentInvocationConfig`
- [ ] 定义 `AgentDetectCandidate`
- [ ] 实现 `agent_get_config`
- [ ] 实现 `agent_list_providers`，只返回脱敏 provider 摘要
- [ ] 实现 `agent_check_provider`
- [ ] 实现 `agent_detect`
- [ ] Agent 后台 detect 只能在悬浮面板 ready 后异步启动
- [ ] React app bootstrap 不 await Agent detect
- [ ] `show_panel/hide_panel/position_panel_window_fast` 不 await 任何 Agent command
- [ ] 检测时合并 macOS GUI app 常见 PATH
- [ ] 支持检测一个已配置本地命令模板
- [ ] 无配置时按少量候选检测 `claude`、`codex`、`qwen`
- [ ] 缓存 `lastReadiness`，进入 Agent 页优先复用缓存
- [ ] 发送前执行快速健康检查
- [ ] 失败原因区分 `not-configured/not-found/permission-denied/auth-required/health-timeout`
- [ ] 启动后后台 detect 超过 1500ms 直接降级为 `health-timeout`
- [ ] 支持命令预览与首次执行确认
- [ ] 实现 `agent_prepare_run`，只构造 prompt 和命令预览，不启动进程
- [ ] 实现 `agent_start_run`
- [ ] 支持启动 run 并流式接收 stdout/stderr
- [ ] stdout/stderr 输出限流合并后发送给前端
- [ ] 支持取消 run
- [ ] 实现 `agent_cancel_run`
- [ ] 实现 `agent_get_run`
- [ ] 实现 `agent_get_transcript`
- [ ] 支持记录退出码、错误摘要和运行耗时
- [ ] 应用退出时清理未结束子进程

## Phase 4b：AI SDK / OpenAI-compatible provider

- [ ] 支持 `ai-sdk` provider 抽象作为服务层目标接口
- [ ] 支持 OpenAI-compatible 配置：`baseURL/apiKeyRef/modelId`
- [ ] 支持 provider registry 概念，第一阶段只展示一个 active provider
- [ ] 支持 `streamText` 风格的文本流归一化
- [ ] 支持 tool call/tool result 归一化为 `ClipboardAgentMessagePart`
- [ ] API key、baseURL secret 不下发给 React
- [ ] 本地 CLI adapter 输出也映射为同一套 `ClipboardAgentUiMessage`

## Phase 5：会话与隐藏面板恢复

- [ ] Agent run 状态不绑定 React 组件生命周期
- [ ] Rust 侧持有 `idle/preparing/waiting_confirmation/running/streaming/succeeded/failed/cancelling/cancelled` 状态机
- [ ] 隐藏面板后 run 继续执行
- [ ] 重新打开面板恢复会话、消息和 run 状态
- [ ] 支持正在运行、已完成、失败、已取消四类状态展示
- [ ] 支持最近会话最小持久化
- [ ] 同一 clip 第一阶段只允许一个前台 run
- [ ] UI 监听 `agent_run_started/agent_message_delta/agent_run_finished/agent_run_error` 事件
- [ ] UI 支持消费 `agent_ui_message` 标准消息事件
- [ ] UI 支持消费 `agent_transcript_rows` 并增量更新 message scroller
- [ ] Agent 事件通道和悬浮面板基础事件通道隔离
- [ ] 大输出只推送增量和尾部 buffer，不阻塞 WebView 渲染
- [ ] 保存 `conversationId/currentAnchorId/liveEdgeFollowing` 以恢复阅读位置
- [ ] Agent 面板错误不能影响剪贴板列表和详情页

## Phase 6：受限工具面

- [ ] 暴露 `clipboard.context.get`
- [ ] 暴露 `clipboard.context.compose`
- [ ] 暴露 `clipboard.content.parse`
- [ ] 暴露 `clipboard.capture`
- [ ] 暴露 `clipboard.update`
- [ ] 暴露 `clipboard.copy`
- [ ] 暴露 `clipboard.search`
- [ ] 暴露 `clipboard.skill.list`
- [ ] 暴露 `clipboard.skill.save_draft`
- [ ] 暴露 `clipboard.skill.run`
- [ ] 每个工具返回 `traceId`、权限裁剪信息和错误摘要
- [ ] 写入类工具必须通过可见结果动作或确认流程

## Phase 6b：私域剪贴板 Skill

- [ ] 私域 skill 只作为用户自己的剪贴板处理模板，不做公共市场
- [ ] 支持保存 skill 草稿：名称、说明、图标、prompt 模板、默认上下文模式、允许引用来源、工具权限、输出动作
- [ ] 支持手动运行私域 skill，并携带当前 `AgentContextSet`
- [ ] Agent 只能建议 skill 草稿，保存和启用必须用户确认
- [ ] 私域 skill 默认只读上下文集合，写入剪贴板或更新历史必须走结果动作
- [ ] MCP 调用 `clipboard.skill.run` 时必须携带上下文范围和权限裁剪结果

## Phase 7：结果回到剪贴板

- [ ] 支持复制 Agent 结果
- [ ] 支持保存 Agent 结果为新剪贴板条目
- [ ] 保存结果默认追加 `AI` tag
- [ ] 保存结果写入 source clip、conversation、run、adapter provenance
- [ ] 支持收藏来源条目
- [ ] 支持归档来源条目
- [ ] 支持给来源条目追加 tag
- [ ] `pasteResult` 等现有粘贴链路稳定后再接入

## Phase 8：安全与日志

- [ ] 默认不发送完整正文
- [ ] Prompt 由结构化 `AgentContextSet` 和用户输入构造
- [ ] 用户点击“允许使用全文”后，本次 run 才能升级到 `current-content`
- [ ] 完整正文、HTML、图片 OCR、文件列表需要单 run 授权
- [ ] 日志只记录 id、类型、长度、状态和裁剪字段
- [ ] CLI 缺失、权限不足、超时和异常退出都有明确错误提示
- [ ] Agent 工具调用失败只影响当前 run
- [ ] 不允许 Agent 自动创建、更新、排序或执行插件
- [ ] 不允许 Agent 自动学习、自动改触发优先级或后台采集全部历史

## Phase 9：验证

- [ ] `pnpm build`
- [ ] `cd src-tauri && cargo check`
- [ ] 验证 Agent detect 未完成时悬浮面板仍能立即打开
- [ ] 验证 Agent detect 超时不影响面板定位、隐藏和再次唤起
- [ ] 验证默认仍进入剪贴板列表
- [ ] 验证复制链接后进入 Agent 页能看到当前链接引用
- [ ] 验证复制普通文本后默认引用为摘要和短预览
- [ ] 验证隐藏面板后 run 不取消，重新打开能恢复状态
- [ ] 验证取消 run 能结束本地子进程
- [ ] 验证保存 Agent 结果后带 `AI` tag 和 provenance
- [ ] 验证 OpenAI-compatible provider 可用时能返回标准消息流
- [ ] 验证 CLI provider 和 OpenAI-compatible provider 在前端使用同一消息渲染器
- [ ] 验证用户滚动离开最新消息后，流式输出不会强制拉回底部
- [ ] 验证重新打开隐藏面板后定位到最近用户 turn
- [ ] 验证加载旧消息不改变当前可见行
- [ ] 验证 Agent 面板失败不影响采集、搜索、复制和详情页
