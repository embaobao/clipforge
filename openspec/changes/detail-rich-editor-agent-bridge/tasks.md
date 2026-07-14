# 任务：详情页富文本编辑器与 Agent/MCP 扩展桥

## Phase 1：依赖与边界

- [x] 明确第一阶段以 `CompactClipEditor` 落地，不阻塞在 Tiptap 依赖上
- [x] 后续富文本阶段再添加 `@tiptap/react`、`@tiptap/starter-kit`
- [x] 将 Tiptap 编辑器组件拆成懒加载 chunk，避免影响快速面板首屏
- [x] 定义 `EditorDraft`、`EditorContextSnapshot`、`EditorPluginAction` 类型
- [x] 定义 `TagPatch`、`EditorSuggestionResult` 类型
- [x] 新增 `src/editor/` 模块目录
- [x] 明确 Markdown 第一阶段保存策略：保留源文本优先

## Phase 2：详情页紧凑编辑入口

- [x] 在 `ClipDetailWorkspace` 顶部快捷操作新增“编辑”
- [x] 增加预览态 / 编辑态切换
- [x] 文本、Markdown、代码、命令进入 `CompactClipEditor`
- [x] HTML 第一阶段提供纯文本降级编辑，富文本阶段再进入 `TiptapClipEditor`
- [x] 代码、命令进入纯文本编辑器
- [x] 支持取消编辑并恢复预览
- [x] 编辑态保留“复制 / 粘贴 / 返回列表”等核心动作
- [x] 编辑态动作条支持 `Cmd/Ctrl+S` 保存、`Cmd/Ctrl+Enter` 保存并粘贴
- [x] 有脏数据时退出编辑需要确认

## Phase 2.5：Tag 快速编辑

- [x] 新增 `TagEditor`，支持当前 tag chip 展示、删除和输入添加
- [x] tag 输入支持 `客户A`、`#客户A`、`tag:客户A` 三种输入
- [x] 正文编辑区识别 `#xxx` 并生成待确认 tag 建议 chip
- [x] 用户点击建议 chip 后才加入 draft tags
- [x] 详情页 tag 点击后可回到列表并设置搜索栏为 `#tag`
- [x] tag chip 单行横向滚动，快速面板高度不抖动
- [x] `AI` 保留 tag 规则可被用户手动移除，普通保存不自动加回

## Phase 3：保存与回填

- [x] 新增 `save_editor_draft` Tauri command
- [x] Service 层实现 clip 内容更新、tag 更新、分析重算、FTS 更新
- [x] Agent 生成或 Agent 建议应用后的保存默认追加 `AI` tag
- [x] 支持 `createNewClip`，把 Agent 生成内容另存为新粘贴项
- [x] 支持 `writeToClipboard`
- [x] 支持 `pasteAfterSave`
- [x] 保存后刷新当前详情页 clip
- [x] 失败时保留本地 draft，不丢用户编辑内容

## Phase 3.5：AI 智能建议反吐

- [x] 新增“建议”入口，读取当前 draft、selection、tags 和安全上下文
- [x] 实现 `clipboard.editor.suggest_update` 或等价前端服务调用
- [x] Agent 返回 `EditorSuggestionResult`，包含 contentPatch、tagPatch、说明和风险级别
- [x] 详情页展示内容 diff 和 tag diff
- [x] `应用到草稿` 只更新本地 draft，不保存
- [x] `应用并保存` 仍走 `save_editor_draft`
- [x] Agent 建议失败只降级建议面板，不影响当前编辑草稿

## Phase 4：变量机制

- [x] 实现 `buildEditorContextSnapshot`
- [x] 收集当前 clip 元数据：id、kind、payloadKind、title、summary、tags、sourceApp
- [x] 收集 editor 元数据：format、selectionText、text/html/json、tags、suggestedTags、dirty
- [x] 收集运行时元数据：platform、route、activeView、panelPinned
- [x] 收集 previousClipboard 元数据，但不默认暴露全文
- [x] 新增变量抽屉，展示可用变量 key、类型、示例值
- [x] 记录 `editor-variable-snapshot` 日志

## Phase 5：插件动作模型

- [x] 定义 `EditorPluginAction`
- [x] 实现 action 校验器
- [x] 支持 `replaceSelection`
- [x] 支持 `replaceDocument`
- [x] 支持 `insertText`
- [x] 支持 `setMetadata`
- [x] 支持 `updateTags`
- [x] 所有 action 先预览，不直接保存

## Phase 6：MCP/Agent 工具

- [x] 扩展 `src/services/contracts.ts`，新增 editor 工具类型
- [x] 实现 `clipboard.editor.context`
- [x] 实现 `clipboard.editor.preview_patch`
- [x] 实现 `clipboard.editor.apply_patch`
- [x] 实现 `clipboard.editor.save`
- [x] 实现 `clipboard.editor.render_template`
- [x] 实现 `clipboard.editor.suggest_update`
- [x] Agent 修改必须带 `sessionId` 与 `draftVersion`
- [x] Agent 修改 tag 必须通过 `tagPatch` 预览确认
- [x] 工具调用写入结构化日志

## Phase 7：安全与隐私

- [x] 默认不暴露完整剪贴板历史给变量上下文
- [x] 默认不暴露 sourceApp executablePath 给外部 Agent
- [x] 插件/Agent 调用前展示将发送的变量范围
- [x] 对大文本设置上下文长度上限
- [x] 对敏感内容提供过滤 hook
- [x] 日志只记录字段长度和 key，不记录完整内容

## Phase 8：验证

- [x] `pnpm build` 通过
- [x] `cd src-tauri && cargo check` 通过
- [ ] `pnpm tauri dev` 验证文本编辑保存
- [ ] `pnpm tauri dev` 验证 Markdown 编辑取消不丢预览
- [ ] `pnpm tauri dev` 验证保存并复制写回系统剪贴板
- [ ] `pnpm tauri dev` 验证保存并粘贴复用现有粘贴链路
- [x] 验证 `#xxx` 识别为 tag 建议，未确认不入库
- [x] 验证 Agent 生成/建议应用保存后自动带 `AI` tag
- [x] 验证详情页 tag 点击能在检索栏快速检索
- [x] 验证 Agent 建议失败不丢编辑草稿
- [x] 验证变量抽屉不泄露未授权历史内容
- [x] 验证 Agent preview patch 不直接写入数据库
