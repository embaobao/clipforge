# 任务：详情页富文本编辑器与 Agent/MCP 扩展桥

## Phase 1：依赖与边界

- [ ] 添加 `@tiptap/react`、`@tiptap/starter-kit`
- [ ] 将编辑器组件拆成懒加载 chunk，避免影响快速面板首屏
- [ ] 定义 `EditorDraft`、`EditorContextSnapshot`、`EditorPluginAction` 类型
- [ ] 新增 `src/editor/` 模块目录
- [ ] 明确 Markdown 第一阶段保存策略：保留源文本优先

## Phase 2：详情页编辑入口

- [ ] 在 `ClipDetailWorkspace` 顶部快捷操作新增“编辑”
- [ ] 增加预览态 / 编辑态切换
- [ ] 文本、Markdown、HTML 进入 `TiptapClipEditor`
- [ ] 代码、命令进入纯文本编辑器
- [ ] 支持取消编辑并恢复预览
- [ ] 编辑态保留“复制 / 粘贴 / 返回列表”等核心动作

## Phase 3：保存与回填

- [ ] 新增 `save_editor_draft` Tauri command
- [ ] Service 层实现 clip 内容更新、分析重算、FTS 更新
- [ ] 支持 `writeToClipboard`
- [ ] 支持 `pasteAfterSave`
- [ ] 保存后刷新当前详情页 clip
- [ ] 失败时保留本地 draft，不丢用户编辑内容

## Phase 4：变量机制

- [ ] 实现 `buildEditorContextSnapshot`
- [ ] 收集当前 clip 元数据：id、kind、payloadKind、title、summary、tags、sourceApp
- [ ] 收集 editor 元数据：format、selectionText、text/html/json、dirty
- [ ] 收集运行时元数据：platform、route、activeView、panelPinned
- [ ] 收集 previousClipboard 元数据，但不默认暴露全文
- [ ] 新增变量抽屉，展示可用变量 key、类型、示例值
- [ ] 记录 `editor-variable-snapshot` 日志

## Phase 5：插件动作模型

- [ ] 定义 `EditorPluginAction`
- [ ] 实现 action 校验器
- [ ] 支持 `replaceSelection`
- [ ] 支持 `replaceDocument`
- [ ] 支持 `insertText`
- [ ] 支持 `setMetadata`
- [ ] 所有 action 先预览，不直接保存

## Phase 6：MCP/Agent 工具

- [ ] 扩展 `src/services/contracts.ts`，新增 editor 工具类型
- [ ] 实现 `clipboard.editor.context`
- [ ] 实现 `clipboard.editor.preview_patch`
- [ ] 实现 `clipboard.editor.apply_patch`
- [ ] 实现 `clipboard.editor.save`
- [ ] 实现 `clipboard.editor.render_template`
- [ ] Agent 修改必须带 `sessionId` 与 `draftVersion`
- [ ] 工具调用写入结构化日志

## Phase 7：安全与隐私

- [ ] 默认不暴露完整剪贴板历史给变量上下文
- [ ] 默认不暴露 sourceApp executablePath 给外部 Agent
- [ ] 插件/Agent 调用前展示将发送的变量范围
- [ ] 对大文本设置上下文长度上限
- [ ] 对敏感内容提供过滤 hook
- [ ] 日志只记录字段长度和 key，不记录完整内容

## Phase 8：验证

- [ ] `pnpm build` 通过
- [ ] `cd src-tauri && cargo check` 通过
- [ ] `pnpm tauri dev` 验证文本编辑保存
- [ ] `pnpm tauri dev` 验证 Markdown 编辑取消不丢预览
- [ ] `pnpm tauri dev` 验证保存并复制写回系统剪贴板
- [ ] `pnpm tauri dev` 验证保存并粘贴复用现有粘贴链路
- [ ] 验证变量抽屉不泄露未授权历史内容
- [ ] 验证 Agent preview patch 不直接写入数据库

