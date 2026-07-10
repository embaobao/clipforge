# 设计：剪贴板多格式复制与回写保真

## 模型边界

`ClipboardRepresentation`、`primaryFormat`、`availableFormats`、`plainText`、`representations_json` 属于 `file-image-clipboard-support` 的基础模型。本提案不再重复定义 schema，只规定这些字段落地后的保真写回策略、降级路径、UI 动作状态和验证矩阵。

基础模型约束：

```ts
export type ClipboardRepresentation = {
  format: "text/plain" | "text/html" | "text/rtf" | "image/png" | "application/file-list" | "text/uri-list";
  storage: "inline" | "file" | "derived";
  content?: string;
  fileName?: string;
  size?: number;
  hash?: string;
  preferred?: boolean;
};

export type ClipItemRepresentations = {
  primaryFormat: ClipboardRepresentation["format"];
  availableFormats: ClipboardRepresentation[];
  plainText: string;
};
```

Rust 侧对应结构需要可序列化，并能落入 SQLite：

- 简化方案：`representations_json TEXT`。
- 后续方案：拆分 `clip_representations` 表。

第一阶段优先使用 JSON 字段，减少迁移复杂度；该迁移由 `file-image-clipboard-support` 实现。

## 采集策略

采集策略由 `file-image-clipboard-support` 实现，本提案只补充验收要求。同一次 clipboard read 必须尽量读取所有可用格式：

1. 读取 `text/plain` 作为搜索和纯文本 fallback。
2. 若存在 HTML，保存 HTML representation，并从 HTML 提取纯文本。
3. 若存在 RTF，保存 RTF representation，并保存纯文本 fallback。
4. 若存在图片，保存 PNG 文件 representation。
5. 若存在文件列表，保存 file-list representation。

`primaryFormat` 决定列表展示类型，但 `availableFormats` 保留完整写回能力。若实现中只能读取到单一格式，日志必须说明 missing formats 的平台原因。

## 回写策略

```ts
type PasteMode = "rich" | "plain" | "files-as-paths";
```

| 条目 | rich | plain | files-as-paths |
|------|------|-------|----------------|
| HTML | html + plain | plain | plain |
| RTF | rtf + plain | plain | plain |
| Image | image/png | 不支持或来源文件路径 | 不支持 |
| Files | file-list | plain paths | plain paths |
| Text | plain | plain | plain |

写回前调用 writeback guard，抑制监听回环。

## UI 展示

- 列表显示 primary format。
- 详情页显示“可用格式”：纯文本、HTML、RTF、图片、文件。
- 右键菜单增加：
  - 复制原格式
  - 复制为纯文本
  - 文件复制为路径
- 当某个模式不可用时禁用按钮并给 tooltip。
- 快速面板默认动作保持 Rich，不把不可用模式暴露成失败点击；例如图片条目的“复制为纯文本”第一阶段直接禁用。

## 验证矩阵

必须覆盖来源和目标：

- 浏览器 HTML → 富文本编辑器
- 浏览器 HTML → 纯文本编辑器
- Finder 文件 → Finder/文件选择目标
- Finder 文件 → 文本编辑器路径模式
- 截图图片 → 图片支持目标
- 截图图片 → 纯文本目标

## 日志

写回日志必须包含：

- `clipId`
- `primaryFormat`
- `availableFormats`
- `pasteMode`
- `writtenFormats`
- `guardHash`
- `targetApp`（若当前平台能取得）
