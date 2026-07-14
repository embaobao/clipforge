# 任务：上下文驱动的插件与 Agent 运行时边界

## Phase 1：上下文字段确定性

- [x] 统一后台监听和显式 capture 的 `kind/payloadKind` 分类逻辑
- [x] 梳理当前 SQLite `clips` 字段与前端 `ClipItem` 字段映射
- [x] 明确哪些字段是稳定采集，哪些字段是推断，哪些字段是预留
- [x] 为来源应用字段增加脱敏策略
- [x] 明确 Agent 生成内容 provenance 字段和默认 `AI` tag 规则
- [x] 为详情页渲染日志补齐 `traceId/contextSchema`

## Phase 2：Context Snapshot Contract

- [x] 新增 `ClipboardContextSnapshot` 类型
- [x] 新增 `ContextPermissionSnapshot` 类型
- [x] 实现详情页只读 snapshot builder
- [x] 实现字段脱敏与长度裁剪
- [x] 增加 snapshot 结构化日志，但不记录完整正文
- [x] 添加单元测试覆盖来源应用、链接、Markdown、文件路径、长文本
- [x] snapshot 中包含 `clip.tags` 和安全的 `provenance` 摘要

## Phase 3：插件 manifest 与动作模型

- [x] 定义 `ClipForgePluginManifest`
- [x] 定义插件 runtime：`builtin/script/mcp/rpc/panel`
- [x] 定义插件 action：`renderPanel/previewPatch/replaceSelection/replaceDocument/copyResult/openUrl/openApp/runCommand/callAgent`
- [x] 定义 `SmartParsedTarget` 与智能内容解析器
- [x] 支持从 URL、文件路径、命令、JSON 字段、代码块、错误日志、Markdown 链接/标题中提取候选
- [x] 将现有 `Ctrl/Cmd+J` 改为调用 Action Resolver，再由 resolver 选择 `builtin.open-link`、`builtin.open-detail` 或插件 action
- [x] 定义 `suggestUpdate/updateTags` 动作边界
- [x] 实现 manifest 校验器
- [x] 实现权限扩大检测
- [x] 实现插件调用 trace 与错误隔离

## Phase 4：Editor Session 边界

- [x] 定义 `EditorSessionSnapshot`
- [x] 编辑态创建 `sessionId/draftVersion`
- [x] snapshot 中按权限暴露 `selection/text/html/json`
- [x] Agent 和插件修改必须先生成 preview patch
- [x] 用户确认后才能 apply patch 或 save
- [x] Agent 修改 tag 必须以 `tagPatch` 预览展示，不能直接写入

## Phase 5：MCP Surface

- [x] 新增 `clipboard.context.get`
- [x] 新增 `clipboard.plugin.list`
- [x] 新增 `clipboard.content.parse`
- [x] 新增 `clipboard.plugin.call`
- [x] 新增 `clipboard.editor.context`
- [x] 新增 `clipboard.editor.preview_patch`
- [x] 新增 `clipboard.editor.apply_patch`
- [x] 新增 `clipboard.editor.suggest_update`
- [x] 新增 `clipboard.agent.run`
- [x] 所有 MCP tool 返回 `traceId/businessChain/redactedFields/permissionDecision`
- [x] MCP 返回值包含安全的 `provenance/defaultTags` 摘要

## Phase 6：AG-UI Agent Panel Bridge

- [x] 定义 `AgentProvider` 接口
- [x] 定义本地 Agent provider adapter
- [x] 定义远程 Agent provider adapter
- [x] 预留 ACP adapter
- [x] 将 provider 输出统一转为 AG-UI events
- [x] 支持 `CUSTOM` event 渲染沙盒面板和 patch preview
- [x] 支持 `CUSTOM` event 渲染智能建议反吐和 tag patch preview
- [x] Agent 面板错误不能影响详情页主内容

## Phase 7：自动升级能力

- [x] 定义 `CapabilityVersionRecord`
- [x] 区分应用更新、内置 manifest 更新、插件更新、Agent adapter 更新
- [x] 设计 Tauri updater 配置与签名发布流程
- [x] 设计插件 manifest 兼容性检查
- [x] 设计权限扩大时的用户确认
- [x] 设计 kill switch、本地禁用记录、回滚记录
- [x] 升级检查只能在后台空闲执行，不能阻塞快速面板
- [x] 所有升级事件写入结构化日志

## Phase 8：验证

- [x] `pnpm build`
- [x] `cd src-tauri && cargo check`
- [x] 验证快速面板启动不加载插件和 Agent 面板
- [x] 验证 `Ctrl/Cmd+J` 链接默认走 `builtin.open-link`
- [x] 验证 `Ctrl/Cmd+J` 普通文本默认走 `builtin.open-detail`
- [x] 验证智能解析能为 JSON/命令/Markdown/错误日志生成候选但不自动执行
- [x] 验证插件错误只降级插件按钮或插件面板
- [x] 验证 Agent 错误只降级 Agent 面板
- [x] 验证 Agent 生成内容保存后默认带 `AI` tag
- [x] 验证用户手动移除 `AI` tag 后普通保存不会自动加回
- [x] 验证 tab 层兜底不导致应用面板崩溃
- [x] 验证升级检查失败不影响剪贴板监听和详情页打开
