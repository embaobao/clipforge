# 提案：智能解析代码、JSON 与常用解码格式

## 优先级

P3。该提案定位为智能解析小功能，排在分发、格式支持、搜索增强之后。JSON 格式化/补齐和常用解码可以做成小步内置工具，但不应提前扩大成重型智能分析系统，也不应阻塞剪贴板采集、格式写回或搜索主路径。

## 背景

ClipForge 已能对文本做基础展示，详情页也已有 Markdown、链接、代码块预览方向。但开发者常复制的内容不只是普通文本：

- 半截 JSON、缺引号/尾逗号/转义后的 JSON 字符串。
- URL 编码、Base64、JWT、Unicode escape、HTML entity 等编码文本。
- 命令行、SQL、日志、代码片段。

如果 ClipForge 能在详情页自动识别并提供“格式化/补齐/解码/复制结果”，它会更像一个高频剪贴板工具，而不是只存历史的列表。

## 目标

1. 自动识别代码、JSON、命令、URL、Base64、JWT、Unicode escape、HTML entity 等常见格式。
2. JSON 支持格式化、压缩、容错补齐建议和错误定位。
3. 常用解码支持预览，不自动覆盖原内容。
4. 解析结果写入条目的 `analysis` 或派生字段，供搜索筛选 `kind:json` / `kind:code` 使用。
5. 详情页提供明确动作：格式化、复制格式化结果、复制解码结果、保存为新条目。

## 非目标

- 不执行代码。
- 不联网调用 AI 做解析。
- 不在剪贴板监听同步路径中做重解析。
- 不默认改写用户原始剪贴板内容。
- 不做完整 IDE 语法服务。

## 用户价值

- 复制一段乱 JSON 后，可以快速补齐/格式化再粘贴。
- 复制 URL 编码、Base64、JWT 后，可以直接看到可读内容。
- 搜索时可以用 `kind:json`、`kind:code` 找到相关历史。
- 原始内容和解析结果分离，避免误改。

## 依赖关系

- 前置依赖：`search-filter-tags-filetypes` 的筛选模型已稳定后，再把 `kind:json` / `kind:code` 等解析结果接入搜索。
- 可小步启动：先实现纯文本 JSON 格式化、JSON 压缩、URL/Base64/JWT/Unicode/HTML entity 解码动作。
- 关联：`detail-rich-editor-agent-bridge` 后续可把格式化/解码结果应用到编辑器 draft。

## 成功标准

- JSON 合法时能稳定格式化和压缩。
- JSON 不合法时能给出错误位置和有限补齐建议。
- Base64 / URL decode / Unicode escape / HTML entity / JWT 能识别并预览。
- 大文本不会卡住快速面板。
- 所有转换结果都需要用户确认复制或保存。
