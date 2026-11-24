# Delta: 剪贴板标签质量（clipboard-search-and-tag-quality）

> 本仓 `openspec/specs/` 没有标签自动生成的基线（`detail-editor` 只约束详情页手动编辑），纯 `ADDED Requirements`。

## ADDED Requirements

### Requirement: 自动标签只收合法话题标签

ClipForge SHALL 只在复制内容含合法话题标记时自动添加对应标签：`#` 后接 2–32 个字母、数字、汉字、`_` 或 `-`，至少含一个字母或汉字，且不是 3/4/6/8 位十六进制色值形态。数字编号、色值片段、含标点的句子片段 SHALL NOT 成为标签。

#### Scenario: 井号编号不入库

- **GIVEN** 用户复制「渠道 #13 状态正常」
- **WHEN** 该内容被采集
- **THEN** 该行的标签不包含「13」

#### Scenario: 合法话题入库

- **GIVEN** 用户复制「周会 #工作 安排」
- **WHEN** 该内容被采集
- **THEN** 该行带有标签「工作」

### Requirement: 类型标签默认不写入标签列

ClipForge SHALL 默认不把「链接」「Markdown」这类内容类型写入标签列；类型筛选 SHALL 继续通过 `@` 类型候选提供。用户在设置中显式打开对应内置规则时除外。

#### Scenario: 含链接的文本

- **GIVEN** 内置规则保持默认
- **WHEN** 用户复制一段含 URL 的文本
- **THEN** 该行的标签列为空
- **AND** `@链接` 筛选能找到该行

### Requirement: 存量垃圾标签一次性清理且可恢复

ClipForge SHALL 在升级时一次性移除不满足上一条规则的已存标签，以及行内容满足内置规则条件的自动类型标签「链接」「Markdown」，并 SHALL 把移除的标签记录在该行元数据中以便恢复；其余标签 SHALL 保持不变。

#### Scenario: 清理范围

- **GIVEN** 升级前某行标签为「链接,5423,token」且该行含 URL
- **WHEN** 升级后首次启动完成迁移
- **THEN** 该行标签为「token」
- **AND** 该行元数据记录了被移除的「链接」「5423」

#### Scenario: 手打标签不受影响

- **GIVEN** 升级前某行标签为「工作」
- **WHEN** 迁移完成
- **THEN** 该行标签仍为「工作」
