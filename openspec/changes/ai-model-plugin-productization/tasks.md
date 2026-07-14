# 任务：模型配置、AI 能力增强与插件标品化

## Phase 0：方案评审

- [ ] 评审本提案是否应该作为 P4.5 / P5，还是拆成多个提案
- [ ] 确认“Agent 是插件 capability”是否作为长期架构原则
- [ ] 确认第一版标品包：Core、AI Edit Pack、Agent Clip Pack、Plugin Builder Pack、Team Governance Pack
- [ ] 确认第一版模型接入范围：本地 CLI、OpenAI-compatible、AI SDK provider、本地模型、Tiptap AI provider
- [ ] 确认 Tiptap AI Toolkit 是必选依赖、可选依赖还是仅作为后续增强
- [ ] 确认第一版隐私默认值：是否默认只发送 summary/metadata，不发送全文

## Phase 1：文档与调研补齐

- [ ] Context7 额度恢复后，重新执行 `npx ctx7@latest library Tiptap "<完整问题>"`
- [ ] 拉取 Tiptap Content AI / AI Toolkit 当前 install、provider、tool calling、React integration 文档
- [ ] 拉取 AI SDK provider registry / tool calling / UIMessage 当前文档
- [ ] 拉取 Tauri secure storage / plugin / updater 当前文档
- [ ] 拉取 MCP tools schema / authorization 当前文档
- [ ] 更新本提案的“调研依据”，删除任何未确认的版本假设

## Phase 2：模型配置契约

- [ ] 定义 `ModelProviderConfig`
- [ ] 定义 `AIModelProfile`
- [ ] 定义 `CapabilityPolicy`
- [ ] 定义 provider health check 状态
- [ ] 定义 secret 存储边界：前端只拿 provider/profile 摘要
- [ ] 定义默认模型用途路由：summary、editor、extract、agent、local-private、vision
- [ ] 定义 provider 失败降级策略
- [ ] 定义模型配置日志字段，禁止记录 prompt/output 全文

## Phase 3：AI 默认能力包

- [ ] 定义 `AIOutput`
- [ ] 定义 `previewPatch`
- [ ] 定义 `newClipDraft`
- [ ] 定义 `copyResult`
- [ ] 定义 `renderPanel`
- [ ] 梳理摘要、改写、翻译、标签建议、结构化提取、格式修复、模板生成的输入输出
- [ ] 规定所有写入必须经 preview/confirm
- [ ] 规定 AI 保存内容 provenance 和默认 `AI` tag

## Phase 4：详情页与 Tiptap 集成边界

- [ ] 明确 `CompactClipEditor` 永远是基础能力
- [ ] 明确 `TiptapClipEditor` 是懒加载增强能力
- [ ] 定义 `EditorAIToolBridge`
- [ ] 定义 Tiptap selection -> `EditorContextSnapshot` 的读取边界
- [ ] 定义 Tiptap tool call -> `clipboard.editor.preview_patch` 的映射
- [ ] 定义 Markdown 源码编辑和富文本编辑的切换策略
- [ ] 定义 Tiptap 失败降级到紧凑编辑的 UI 状态

## Phase 5：插件体系 V2

- [ ] 在现有 `ClipForgePluginManifest` 上扩展 `ClipForgePluginManifestV2`
- [ ] 增加 runtime：`agent`
- [ ] 增加 runtime：`editor-tool`
- [ ] 增加 runtime：`model-provider`
- [ ] 定义 `ai.requiredProfiles/preferredPurpose/outputKinds`
- [ ] 定义 `agent.runMode/inputSchema/allowedTools`
- [ ] 定义 `editorTool.surfaces/selectionRequired/patchMode`
- [ ] 定义 `product.tier/defaultEnabled/userConfigurable/enterpriseControllable`
- [ ] 更新权限扩大检测，覆盖 Agent 和模型 provider

## Phase 6：Agent 插件化

- [ ] 定义 `AgentPluginCapability`
- [ ] 将 Agent 页建模为调用 Agent plugin 的 UI surface
- [ ] 将详情页“建议”建模为调用 Agent plugin 后返回 patch preview
- [ ] 将“生成插件草稿”建模为 Agent plugin 输出 `pluginDraft`
- [ ] 规定 Agent plugin 不能静默启用新插件
- [ ] 规定 Agent run 失败只降级对应插件，不影响剪贴板主路径

## Phase 7：MCP 工具面规划

- [ ] 规划 `clipboard.ai.run`
- [ ] 规划 `clipboard.agent.run`
- [ ] 规划 `clipboard.plugin.draft.create`
- [ ] 规划 `clipboard.model.list`
- [ ] 规划 `clipboard.policy.explain`
- [ ] 明确哪些工具只读、哪些工具需要确认、哪些工具必须拒绝后台调用
- [ ] 所有 MCP 工具返回 `traceId/businessChain/redactedFields/permissionDecision`

## Phase 8：设置页与标品化

- [ ] 将模型 provider/profile 配置映射到 `settings-interface-redesign`
- [ ] 定义产品能力开关 `ProductCapabilityGate`
- [ ] 定义 Core Clipboard 能力边界
- [ ] 定义 AI Edit Pack 能力边界
- [ ] 定义 Agent Clip Pack 能力边界
- [ ] 定义 Plugin Builder Pack 能力边界
- [ ] 定义 Local Privacy Pack 能力边界
- [ ] 定义 Team Governance Pack 能力边界
- [ ] 明确第一版只做 capability gate，不做计费系统

## Phase 9：验证计划

- [ ] `pnpm build`
- [ ] `cd src-tauri && cargo check`
- [ ] 验证未配置模型时基础剪贴板、搜索、详情页、紧凑编辑仍可用
- [ ] 验证 provider health check 不阻塞快速面板打开
- [ ] 验证网络模型默认不读取全文，除非用户授权
- [ ] 验证 AI 输出只进入 preview/newClip/copy/renderPanel 四类结果
- [ ] 验证 Agent plugin 无法绕过 preview 直接写数据库
- [ ] 验证 Tiptap AI 失败时降级到紧凑编辑
- [ ] 验证插件权限扩大需要用户确认
- [ ] 验证企业策略能禁用 network model、script plugin、command execution

