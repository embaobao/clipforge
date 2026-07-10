# 设计：详情页富文本编辑器与 Agent/MCP 扩展桥

## 1. 前端结构

新增组件建议：

```text
src/editor/
  TiptapClipEditor.tsx          # Tiptap React 编辑器壳
  editor-context.ts             # EditorContextSnapshot 类型
  editor-variables.ts           # 变量注册与渲染
  editor-session.ts             # 前端编辑会话 helper
  markdown-codec.ts             # Markdown 导入/导出策略
```

详情页变化：

```text
ClipDetailWorkspace
  ├─ preview mode: MarkdownPreview / LinkPreview / pre
  └─ edit mode: TiptapClipEditor / PlainTextEditor
```

## 2. Tiptap 接入方式

依赖：

```json
{
  "@tiptap/react": "...",
  "@tiptap/starter-kit": "..."
}
```

基础编辑器：

```tsx
const editor = useEditor({
  extensions: [StarterKit],
  content: initialHtml,
  onUpdate({ editor }) {
    onDraftChange({
      html: editor.getHTML(),
      json: editor.getJSON(),
      text: editor.getText(),
    });
  },
});
```

设计原则：

- 编辑器组件只处理编辑交互，不直接写数据库。
- 保存动作调用上层 `onSave(draft, mode)`。
- 编辑器延迟加载，避免快速面板首屏引入大依赖。

## 3. 内容格式策略

### 文本

- 初始内容：纯文本转义后包成段落。
- 保存：默认 `editor.getText()`。
- 可选：允许用户切换“富文本保存为 HTML”。

### Markdown

阶段 1：

- 初始内容：轻量 Markdown -> HTML 转换，只覆盖标题、列表、引用、代码块、链接。
- 保存：
  - 默认保存为 Markdown 源文本模式，避免破坏原文。
  - 用户明确切到富文本模式时，保存为 HTML 或转换后的 Markdown。

阶段 2：

- 评估引入 Markdown codec（如 `tiptap-markdown` 或独立 markdown-it/turndown 管线）。
- 目标是支持 Markdown -> ProseMirror -> Markdown 的可预测往返。

### HTML

- 初始内容：使用 HTML 作为 Tiptap content。
- 保存：`editor.getHTML()`，同时更新 `analysis.summary` 与纯文本检索字段。

### 代码 / 命令

- 不强行放进富文本编辑器。
- 使用轻量纯文本编辑器，避免 Tiptap 自动规范化代码内容。
- 仍共享变量抽屉、保存回填、Agent patch 机制。

## 4. 保存与回填链路

新增服务概念：

```ts
type EditorDraft = {
  clipId: string;
  sourceFormat: "text" | "markdown" | "html" | "code" | "command";
  text: string;
  html?: string;
  json?: unknown;
  variablesVersion: number;
  editedAt: number;
};
```

保存命令：

```ts
type SaveEditorDraftInput = {
  clipId: string;
  draft: EditorDraft;
  writeToClipboard?: boolean;
  pasteAfterSave?: boolean;
};
```

保存流程：

1. 前端提交 draft。
2. Rust command / Service 层校验 clip 存在。
3. 生成新 content、payloadKind、summary、tags。
4. 更新 SQLite。
5. 更新 FTS。
6. 如 `writeToClipboard=true`，调用现有写回剪贴板路径。
7. 如 `pasteAfterSave=true`，复用现有粘贴链路。
8. 前端刷新当前 clip。

## 5. 变量机制

### EditorContextSnapshot

变量上下文按快照生成，不直接暴露可变 UI state：

```ts
type EditorContextSnapshot = {
  version: number;
  createdAt: number;
  route: {
    view: "detail";
    clipId: string;
  };
  currentClip: {
    id: string;
    kind: string;
    payloadKind: string;
    title: string;
    summary: string;
    tags: string[];
    chars: number;
    lines: number;
    createdAt: number;
    updatedAt: number;
    sourceApp?: {
      name: string;
      bundleId: string;
      executablePath?: string;
    };
  };
  editor: {
    format: "text" | "markdown" | "html" | "code" | "command";
    selectionText: string;
    text: string;
    html?: string;
    json?: unknown;
    isDirty: boolean;
  };
  runtime: {
    platform: string;
    panelPinned: boolean;
    activeView: string;
  };
  previousClipboard?: {
    id: string;
    kind: string;
    payloadKind: string;
    sourceAppName?: string;
    chars: number;
    createdAt: number;
  };
};
```

### 变量命名

变量 registry 对外提供点路径：

```text
clip.id
clip.kind
clip.payloadKind
clip.sourceApp.name
clip.sourceApp.bundleId
editor.selectionText
editor.text
runtime.platform
previousClipboard.sourceAppName
```

### 安全默认值

- 默认变量不包含完整历史列表。
- 默认不暴露 `sourceApp.executablePath` 给外部 Agent，除非本地插件明确需要。
- `editor.text` 只在用户打开编辑器且显式调用插件/Agent 时提供。
- 插件日志只记录变量 key 和长度，不记录完整内容。

## 6. 插件脚本边界

后续插件脚本不直接执行任意本机代码，第一阶段只支持声明式 transform：

```ts
type EditorPluginAction =
  | { type: "replaceSelection"; text: string }
  | { type: "replaceDocument"; text: string; format: "text" | "markdown" | "html" }
  | { type: "insertText"; text: string }
  | { type: "setMetadata"; title?: string; tags?: string[] };
```

插件执行流程：

1. 插件读取 `EditorContextSnapshot`。
2. 插件返回 `EditorPluginAction[]`。
3. 前端展示 diff/预览。
4. 用户确认后应用到编辑器。
5. 保存时才写入数据库与系统剪贴板。

## 7. MCP/Agent 对接

在现有 `clipboard.*` 工具外新增 editor 命名空间：

```text
clipboard.editor.context
clipboard.editor.preview_patch
clipboard.editor.apply_patch
clipboard.editor.save
clipboard.editor.render_template
```

### 工具语义

| 工具 | 说明 |
|------|------|
| `clipboard.editor.context` | 返回当前编辑会话的安全变量快照 |
| `clipboard.editor.preview_patch` | Agent 提交修改建议，返回 diff，不写入 |
| `clipboard.editor.apply_patch` | 用户确认后把 patch 应用到编辑器 draft |
| `clipboard.editor.save` | 保存 draft 到 clip，可选写回剪贴板 |
| `clipboard.editor.render_template` | 使用变量 registry 渲染模板 |

### Agent 调用边界

- Agent 不能直接调用 `clipboard.update` 改当前编辑内容，必须通过 `preview_patch`。
- `apply_patch` 只能应用到活跃 editor session。
- `save` 必须带 `sessionId` 与 `draftVersion`，避免旧 patch 覆盖新编辑。
- 所有工具调用写入本地日志：tool、sessionId、clipId、input 字段长度、结果状态。

## 8. 数据模型补充

短期可以复用现有 `clips.content` 字段。

后续可加编辑历史表：

```sql
CREATE TABLE clip_edit_sessions (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  saved_at INTEGER,
  source_format TEXT NOT NULL,
  draft_hash TEXT NOT NULL,
  variables_version INTEGER NOT NULL,
  actor TEXT NOT NULL DEFAULT 'user'
);
```

编辑历史只记录 hash 和元数据，不默认保存每个 draft 的全文，避免扩大隐私面。

## 9. 日志与排查

新增日志 key：

```text
editor-session-start
editor-draft-change
editor-save-start
editor-save-success
editor-save-failed
editor-variable-snapshot
editor-agent-preview-patch
editor-agent-apply-patch
editor-agent-save
```

日志字段：

- `businessChain`
- `sessionId`
- `clipId`
- `sourceFormat`
- `payloadKind`
- `sourceAppName`
- `chars`
- `lines`
- `dirty`
- `actor=user|plugin|agent`
- `tool`

## 10. 开放问题

- Markdown 保存默认应该保持原始 Markdown，还是允许转换为 HTML？
- 是否需要在第一阶段支持“变量插入”按钮，还是只展示变量抽屉？
- Agent patch 的 diff 格式采用统一文本 diff，还是 ProseMirror JSON patch？
- 编辑历史是否需要全文版本恢复？如果需要，应提供清理策略和隐私提示。

