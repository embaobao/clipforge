# 提案：剪贴板多格式复制与回写保真

## 优先级

P1。该提案属于“格式支持”的保真验收层，应紧跟 `file-image-clipboard-support` 推进。`ClipboardRepresentation`、`representations_json`、`primaryFormat`、`plainText` 等基础模型已前移到 `file-image-clipboard-support`，本提案不再另起数据模型，只负责把多 representation 的写回策略、降级路径、动作可用性和跨应用验证矩阵补齐。

## 背景

`file-image-clipboard-support` 已经规划 text / html / rtf / image / files 的读取、存储和写回。但“支持多格式”不只是能读取某一种 payload，还要解决同一次复制中同时存在多个格式的问题：

- 浏览器复制内容通常同时包含 `text/plain`、`text/html`、URL、图片等格式。
- 办公软件可能同时包含 RTF、HTML、纯文本和自定义格式。
- 用户希望普通粘贴保留原格式，纯文本粘贴只写纯文本。
- 回写时如果只写一种格式，目标应用可能丢样式、丢图片或粘贴失败。

因此需要在基础格式支持之上，独立定义“写回、降级、禁用状态、日志、验证”的保真策略。

## 目标

1. 在 `file-image-clipboard-support` 已落地的 representation 模型上，补齐 Rich / Plain / FilesAsPaths 三种写回模式。
2. 普通复制/粘贴按目标能力写回最合适的格式组合。
3. 纯文本模式明确只写 `text/plain`。
4. 文件、图片、富文本各自有可解释的降级路径和不可用状态。
5. 写回后监听不重复入库，且不会丢失原始条目的多格式信息。

## 非目标

- 不实现 Office 私有格式的完整解析。
- 不做图片编辑或 OCR。
- 不做跨应用粘贴目标能力探测的复杂自动化。
- 不要求所有应用都 100% 保留样式，只保证 ClipForge 写回了可用的格式组合。

## 用户价值

- 从浏览器复制富文本后，之后仍可按 HTML 样式粘贴。
- 从 Finder/资源管理器复制文件后，之后仍能作为文件粘贴，而不是只粘贴路径字符串。
- 从设计工具或截图工具复制图片后，之后仍能作为图片粘贴。
- 需要纯文本时，可以稳定降级，不被隐藏格式干扰。

## 依赖关系

- 强依赖：`file-image-clipboard-support` 的 `ClipboardRepresentation`、`representations_json`、payload、ImageStore、文件列表和 HTML/RTF 读取。
- 关联：`content-smart-format-decoder` 可以为 plain/html/json/code 提供更好的 `kind` 分析，但不是本提案前置条件。

## 成功标准

- 同一条 clip 能保存并展示主要格式组合。
- HTML 条目写回时同时写 `text/html` 和 `text/plain`。
- RTF 条目写回时同时写 RTF 和 `text/plain`。
- 文件条目普通模式写文件剪贴板，纯文本模式写路径列表。
- 图片条目普通模式写图片剪贴板，纯文本模式给出不可用状态或显式降级为文件路径。
