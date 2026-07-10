# 设计：详情页富文本编辑器与 Agent/MCP 扩展桥

## 1. 前端结构

新增组件建议：

```text
src/editor/
  CompactClipEditor.tsx         # 第一阶段紧凑编辑器，textarea + tag 行 + 动作条
  TiptapClipEditor.tsx          # 后续 Tiptap React 编辑器壳
  TagEditor.tsx                 # 详情页 tag chip 与 #tag 输入
  editor-suggestions.ts         # AI 智能建议反吐类型与应用 helper
  editor-context.ts             # EditorContextSnapshot 类型
  editor-variables.ts           # 变量注册与渲染
  editor-session.ts             # 前端编辑会话 helper
  markdown-codec.ts             # Markdown 导入/导出策略
```

详情页变化：

```text
ClipDetailWorkspace
  ├─ preview mode: MarkdownPreview / LinkPreview / pre
  └─ edit mode:
      ├─ CompactClipEditor: 第一阶段默认
      ├─ TagEditor: 始终可用
      └─ TiptapClipEditor: 后续富文本模式懒加载
```

## 2. 紧凑编辑实现

第一阶段默认不引入完整富文本工具栏，避免快速面板变重。紧凑编辑态由三块组成：

1. 顶部动作条：`保存`、`保存并复制`、`保存并粘贴`、`建议`、`取消`。
2. tag 行：当前 tag chip、输入框、正文识别出的 `#xxx` 建议 chip。
3. 正文编辑区：textarea 或轻量 code textarea，保持内容原文优先。

UI 要求：

- 编辑器最小高度固定，长内容内部滚动，避免详情页动作条跳动。
- tag chip 单行横向滚动，不能撑高快速面板。
- 所有按钮使用现有 `lucide-react` 图标体系，保持当前项目图标一致。
- 保存中禁用保存按钮并显示轻量状态，不阻塞取消和复制原文。
- `Esc` 在无脏数据时退出编辑，有脏数据时提示确认。
- `Cmd/Ctrl+S` 保存，`Cmd/Ctrl+Enter` 保存并粘贴。

## 3. Tiptap 接入方式

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
- Tiptap 是富文本增强，不阻塞紧凑纯文本编辑先落地。

## 4. 内容格式策略

### 文本

- 第一阶段：紧凑编辑器直接编辑源文本。
- 富文本阶段：纯文本转义后包成段落。
- 保存：默认保存源文本或 `editor.getText()`。
- 可选：允许用户切换“富文本保存为 HTML”。

### Markdown

阶段 1：

- 紧凑编辑器直接编辑 Markdown 源文本。
- 预览区仍使用现有 MarkdownPreview。
- 保存默认保持 Markdown 源文本，避免破坏原文。

阶段 2：

- 初始内容：轻量 Markdown -> HTML 转换，只覆盖标题、列表、引用、代码块、链接。
- 用户明确切到富文本模式时，保存为 HTML 或转换后的 Markdown。
- 评估引入 Markdown codec（如 `tiptap-markdown` 或独立 markdown-it/turndown 管线）。
- 目标是支持 Markdown -> ProseMirror -> Markdown 的可预测往返。

### HTML

- 第一阶段可以显示原文和纯文本降级编辑，不承诺 HTML 高保真往返。
- 富文本阶段使用 HTML 作为 Tiptap content。
- 保存：`editor.getHTML()`，同时更新 `analysis.summary` 与纯文本检索字段。

### 代码 / 命令

- 不强行放进富文本编辑器。
- 使用轻量纯文本编辑器，避免 Tiptap 自动规范化代码内容。
- 仍共享 tag 行、变量抽屉、保存回填、Agent patch 机制。

## 5. 保存与回填链路

新增服务概念：

```ts
type EditorDraft = {
  clipId: string;
  sourceFormat: "text" | "markdown" | "html" | "code" | "command";
  text: string;
  html?: string;
  json?: unknown;
  tags: string[];
  suggestedTags: string[];
  actor: "user" | "agent" | "plugin";
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
  createNewClip?: boolean;
};
```

保存流程：

1. 前端提交 draft。
2. Rust command / Service 层校验 clip 存在。
3. 生成新 content、payloadKind、summary、tags。
4. 更新 SQLite。
5. 更新 FTS 和 tag 索引。
6. 如 `writeToClipboard=true`，调用现有写回剪贴板路径。
7. 如 `pasteAfterSave=true`，复用现有粘贴链路。
8. 前端刷新当前 clip。

### Agent 生成内容保存规则

- 当 `draft.actor="agent"` 或保存来源是 Agent 建议应用时，默认追加 `AI` tag。
- 如果用户选择“另存为新条目”，新条目的 `source` 记录为 `external` 或后续专用 `agent` 来源，metadata 记录 `agentGenerated=true`。
- 如果用户只是把 Agent 建议应用到现有条目，现有条目增加 `AI` tag 和 `metadata.lastAgentSuggestionAt`。
- 用户手动移除 `AI` tag 后，普通保存不能自动加回。
- 日志只记录 tag 数量和 tag key，不记录完整正文。

## 6. Tag 编辑与 #tag 识别

tag patch：

```ts
type TagPatch = {
  add: string[];
  remove: string[];
  replace?: string[];
  source: "manual" | "inline-hashtag" | "agent-suggestion" | "system";
};
```

规则：

- `#xxx` 只识别为 tag token，不从正文里删除。
- tag 名去掉开头 `#`，trim 空白，保留中英文、数字、下划线和短横线。
- 同一个 clip 内 tag 去重，大小写归一策略第一阶段采用原样展示、lowercase 比较。
- 输入 `#客户A`、`客户A`、`tag:客户A` 都可以在 tag 输入框里添加同一个 tag。
- 详情页 tag 点击后可以回到列表并把搜索栏设置为 `#客户A`。

正文内联识别：

- 编辑时防抖扫描 `/(^|\s)#([\p{L}\p{N}_-]{1,32})/u`。
- 扫描结果展示为“建议添加”的 chip。
- 用户点击建议 chip 后才加入 draft tags。
- 保存时未确认的建议 tag 不自动加入，除非来源为 Agent 生成内容并命中 `AI` 保留 tag。

## 7. AI 智能建议反吐

Agent 不直接写内容，只返回建议结果：

```ts
type EditorSuggestionResult = {
  suggestionId: string;
  sessionId: string;
  draftVersion: number;
  actor: "agent";
  contentPatch?: {
    format: "text" | "markdown" | "html" | "code" | "command";
    beforeHash: string;
    afterText: string;
    summary: string;
  };
  tagPatch?: TagPatch;
  explanation: string;
  riskLevel: "low" | "medium" | "high";
  saveIntent: "apply-to-draft" | "save-copy" | "save-and-copy" | "save-and-paste";
};
```

交互：

- 点击 `建议` 后，详情页将当前 draft、选区、tags 和安全上下文发给 Agent。
- Agent 返回后展示内容 diff、tag diff、说明和风险级别。
- `应用到草稿` 只更新本地 draft，不保存。
- `应用并保存` 仍走 `save_editor_draft`，并把 actor 记录为 `agent`。
- Agent 建议失败只展示错误行，不影响当前编辑草稿。

## 8. 变量机制

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
    tags: string[];
    suggestedTags: string[];
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
clip.tags
clip.sourceApp.name
clip.sourceApp.bundleId
editor.selectionText
editor.text
editor.tags
editor.suggestedTags
runtime.platform
previousClipboard.sourceAppName
```

### 安全默认值

- 默认变量不包含完整历史列表。
- 默认不暴露 `sourceApp.executablePath` 给外部 Agent，除非本地插件明确需要。
- `editor.text` 只在用户打开编辑器且显式调用插件/Agent 时提供。
- 插件日志只记录变量 key 和长度，不记录完整内容。

## 9. 插件脚本边界

后续插件脚本不直接执行任意本机代码，第一阶段只支持声明式 transform：

```ts
type EditorPluginAction =
  | { type: "replaceSelection"; text: string }
  | { type: "replaceDocument"; text: string; format: "text" | "markdown" | "html" }
  | { type: "insertText"; text: string }
  | { type: "setMetadata"; title?: string; tags?: string[] }
  | { type: "updateTags"; patch: TagPatch };
```

插件执行流程：

1. 插件读取 `EditorContextSnapshot`。
2. 插件返回 `EditorPluginAction[]`。
3. 前端展示 diff/预览。
4. 用户确认后应用到编辑器。
5. 保存时才写入数据库与系统剪贴板。

## 10. MCP/Agent 对接

在现有 `clipboard.*` 工具外新增 editor 命名空间：

```text
clipboard.editor.context
clipboard.editor.preview_patch
clipboard.editor.apply_patch
clipboard.editor.save
clipboard.editor.render_template
clipboard.editor.suggest_update
```

### 工具语义

| 工具 | 说明 |
|------|------|
| `clipboard.editor.context` | 返回当前编辑会话的安全变量快照 |
| `clipboard.editor.preview_patch` | Agent 提交修改建议，返回 diff，不写入 |
| `clipboard.editor.apply_patch` | 用户确认后把 patch 应用到编辑器 draft |
| `clipboard.editor.save` | 保存 draft 到 clip，可选写回剪贴板 |
| `clipboard.editor.render_template` | 使用变量 registry 渲染模板 |
| `clipboard.editor.suggest_update` | Agent 返回智能建议反吐，不写入 |

### Agent 调用边界

- Agent 不能直接调用 `clipboard.update` 改当前编辑内容，必须通过 `preview_patch`。
- Agent 不能直接调用 `clipboard.update` 改 tag，必须返回 `tagPatch` 并由用户确认。
- `apply_patch` 只能应用到活跃 editor session。
- `save` 必须带 `sessionId` 与 `draftVersion`，避免旧 patch 覆盖新编辑。
- 所有工具调用写入本地日志：tool、sessionId、clipId、input 字段长度、结果状态。

## 11. 数据模型补充

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
  tag_patch_json TEXT,
  variables_version INTEGER NOT NULL,
  actor TEXT NOT NULL DEFAULT 'user'
);
```

编辑历史只记录 hash 和元数据，不默认保存每个 draft 的全文，避免扩大隐私面。

## 12. 日志与排查

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
editor-suggest-update-start
editor-suggest-update-result
editor-tag-change
editor-inline-hashtag-detected
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
- `tagCount`
- `suggestedTagCount`
- `actor=user|plugin|agent`
- `tool`

## 13. 开放问题

- Markdown 保存默认应该保持原始 Markdown，还是允许转换为 HTML？
- 是否需要在第一阶段支持“变量插入”按钮，还是只展示变量抽屉？
- Agent patch 的 diff 格式采用统一文本 diff，还是 ProseMirror JSON patch？
- 编辑历史是否需要全文版本恢复？如果需要，应提供清理策略和隐私提示。
- `AI` tag 是否允许用户重命名为本地语言显示，例如界面展示“AI”但内部 tag 固定为 `AI`？
