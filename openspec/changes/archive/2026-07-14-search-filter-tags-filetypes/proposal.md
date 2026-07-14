# 提案：搜索框支持 Tag 与文件类型筛选

## 优先级

P2。搜索增强依托前面的格式支持实现，不抢在多格式字段之前做半套筛选。第一阶段可以先复用现有 `tags`、`bucket` 和文本类型字段，但正式验收应以 `file-image-clipboard-support` / `clipboard-multi-format-fidelity` 提供的 `type`、`fileTypes`、`availableFormats` 等结构化字段为基础。

## 背景

当前 ClipForge 已有即时搜索、历史/归档/片段视图、收藏和标签字段，但搜索框主要承担全文检索，缺少结构化筛选能力。用户历史变多后，只靠关键词会出现两个问题：

- 想找某个 tag 下的内容，需要额外入口或手工翻找。
- 图片、文件、代码、JSON、URL 等类型无法通过搜索框快速收敛。

项目架构文档已经明确“搜索和类型 Tag 直接作用于主列表”，本提案把这条产品方向落成可交互、可解析、可测试的查询模型。

## 目标

1. 搜索框支持结构化 token：`tag:工作`、`#工作`、`type:image`、`file:pdf`、`kind:code`、`bucket:archive`。
2. 搜索框下方或输入内展示可移除的筛选 chip。
3. 主列表搜索结果直接更新，不进入文件夹或二级面板。
4. 支持从当前结果和详情页 tag chip 快速添加/移除 tag 筛选。
5. Agent 生成或 Agent 建议应用保存后的条目默认带 `AI` tag，并可用 `#AI` 快速检索。
6. 查询解析逻辑前后端共享同一语义，避免 UI 显示和数据库搜索不一致。

## 非目标

- 不实现复杂自然语言搜索。
- 不引入远程语义检索。
- 不改变快速面板的信息结构。
- 不要求第一阶段对文件内容做全文索引。

## 用户价值

- 用户可以输入 `tag:工作 json` 快速找到工作标签下的 JSON 文案。
- 用户可以输入 `#工作 json` 使用更短的 tag 语法快速过滤。
- 用户可以输入 `#AI` 快速找到 Agent 生成或 Agent 改写保存的粘贴项。
- 用户可以输入 `type:file file:pdf` 快速找到复制过的 PDF 文件。
- 用户可以用 chip 组合筛选历史、收藏、归档和片段。

## 依赖关系

- 前置主依赖：`file-image-clipboard-support` 提供图片、文件、HTML/RTF 和基础类型字段。
- 前置增强依赖：`clipboard-multi-format-fidelity` 提供 `availableFormats`、文件路径/扩展名和保真格式信息。
- 可提前铺垫：现有 `tags`、`bucket`、`payloadKind/kind` 的 parser 与 chip UI。
- 后续关联：`content-smart-format-decoder` 会补充 `kind:json`、`kind:code` 等轻量解析类型。
- 后续关联：`detail-rich-editor-agent-bridge` 会提供详情页 tag 编辑、`#xxx` tag 建议、Agent 保存时默认追加 `AI` tag。

## 成功标准

- 搜索框解析出的 filter token 与普通全文关键词分离。
- 支持 tag、类型、文件扩展名、bucket、favorite 的组合筛选。
- `tag:工作` 与 `#工作` 解析为同一 tag filter。
- `#AI` 能稳定命中 Agent 生成或 Agent 建议应用保存后的条目。
- 删除 chip 后结果立即恢复。
- 空结果状态能显示当前筛选条件。
- 输入异常 token 不导致搜索崩溃。
