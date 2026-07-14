# ClipForge 剪贴板上下文字段

## 字段映射

| SQLite `clips` 字段 | 前端 `ClipItem` 字段 | 语义 |
| --- | --- | --- |
| `id` | `id` | 条目稳定标识 |
| `content` | `content` | 当前主内容或资源引用 |
| `kind` | `kind` | 面向 UI 的内容分类 |
| `bucket` | `bucket` | history / archive / snippet / trash |
| `tags_json` | `tags` | 用户 tag 与 Agent 结果 tag |
| `content_hash` | `contentHash` | 去重与写回抑制 |
| `primary_format` | `primaryFormat` | 首选写回格式 |
| `available_formats` | `availableFormats` | 当前条目可写回格式 |
| `representations_json` | `representations` | 多格式 representation |
| `plain_text` | `plainText` | 纯文本 fallback |
| `search_text` | `searchText` | FTS 与结构化检索输入 |
| `sub_kind` | `subKind` | url / email / color / path 等文本子类型 |
| `width` / `height` / `size` | `width` / `height` / `size` | 图片或文件元数据 |
| `file_types` | `fileTypes` | 文件扩展名摘要 |
| `thumbnail_path` | `thumbnailPath` | 图片缩略图相对路径 |
| `image_file` | `imageFile` | 图片原图相对路径 |
| `source_app_json` | `sourceApp` | 脱敏来源应用摘要 |
| `capture_context_json` | `captureContext` | 采集环境与 representation 摘要 |
| `agent_context_json` | `agentContext` | Agent 生成或建议 provenance |

## 字段稳定性

- 稳定采集字段：`id`、`content`、`contentHash`、`primaryFormat`、`availableFormats`、`representations`、`plainText`、`searchText`、`createdAt`、`updatedAt`、`lastSeenAt`、`captureContext`。
- 推断字段：`kind`、`payloadKind`、`subKind`、`analysis.title`、`analysis.summary`、`analysis.url`、`analysis.isMarkdown`。
- 用户字段：`tags`、`favorite`、`bucket`、`note`、`pinned`。
- 预留扩展字段：`metadata`、`agentContext`、`sourceApp.iconBase64`、未来 OCR / embedding / plugin result metadata。

## 日志边界

详情渲染、MCP snapshot、变量抽屉日志必须包含 `traceId` 与 `contextSchema`，只记录 id、类型、长度、字段名、tag 数量和脱敏来源应用摘要，不记录完整正文、HTML、图片内容或文件正文。
