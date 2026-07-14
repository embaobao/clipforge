# 设计：搜索框支持 Tag 与文件类型筛选

## 查询语法

第一阶段支持以下 token：

| 语法 | 示例 | 含义 |
|------|------|------|
| `tag:<name>` | `tag:工作` | 匹配标签 |
| `#<name>` | `#工作` | `tag:<name>` 的快捷写法 |
| `type:<type>` | `type:image` | 匹配内容大类：text/image/file/html/rtf |
| `kind:<kind>` | `kind:json` | 匹配分析类型：code/json/url/command 等 |
| `file:<ext>` | `file:pdf` | 匹配文件扩展名 |
| `bucket:<name>` | `bucket:archive` | 匹配历史/归档/片段 |
| `is:favorite` | `is:favorite` | 只看收藏 |

普通文本继续进入全文搜索：

```text
#工作 kind:json api key
```

解析结果：

```ts
type SearchQueryAst = {
  text: string;
  filters: {
    tags: string[];
    types: string[];
    kinds: string[];
    fileExtensions: string[];
    buckets: string[];
    favorite?: boolean;
  };
  invalidTokens: string[];
};
```

### Tag 规范

- `#工作` 与 `tag:工作` 进入同一个 `filters.tags` 数组。
- `#AI` 是普通查询语法，但数据来源由详情编辑和 Agent 提案保证：Agent 生成或建议应用保存后的条目默认带 `AI` tag。
- tag 解析保留中英文、数字、下划线、短横线，最大长度第一阶段限制为 32 个字符。
- 重复 tag 去重，展示保留用户输入原文，比较时使用 lowercase。
- `#` 后为空、只有标点、或超过长度时进入 `invalidTokens`，不阻断普通搜索。

## UI 交互

- 输入 token 后按空格或回车固化为 chip。
- chip 显示在搜索框下方的单行可横向滚动区域，避免撑高快速面板。
- chip 使用紧凑样式，带关闭图标。
- 输入框保留原始文本编辑体验，不强制用户学习语法。
- 列表行和详情页上已有 tag 可点击追加筛选。
- 点击详情页 tag 时回到列表并把搜索栏设置为 `#tag`。
- 输入 `#AI` 后显示 `AI` tag chip，结果只保留 Agent 生成或 Agent 建议应用保存后的条目。

## 数据查询

前端将 `SearchQueryAst` 传给 Rust command：

```ts
export type SearchClipsRequest = {
  text?: string;
  tags?: string[];
  types?: string[];
  kinds?: string[];
  fileExtensions?: string[];
  buckets?: string[];
  favorite?: boolean;
  limit: number;
  cursor?: string;
};
```

Rust 侧构造参数化 SQL：

- `text` 走 FTS5。
- `tags` 使用 JSON 字段或 tag join 表，按现有 schema 决定。
- `types/kinds/buckets/favorite` 走普通列过滤。
- `fileExtensions` 第一阶段可从 `content/search_text/file_types` 中匹配；多格式提案落地后走结构化 `file_types` 或 `file_extensions` 字段。

## 解析位置

- 前端负责即时解析和 chip 展示。
- Rust 侧保留同等解析或校验能力，用于 MCP/命令行调用。
- 解析器测试用例必须覆盖中英文 tag、空 token、重复 token、引号包裹值。
- `#tag` 快捷语法必须在前后端 parser 中保持一致，不能只做 UI 语法糖。

## 性能边界

- 输入防抖 80-120ms。
- 解析器必须纯同步、无 IO。
- 查询限制默认沿用现有分页/limit。
- 文件扩展名过滤不在第一阶段扫描磁盘。
