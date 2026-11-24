# Delta: 检索匹配与关键词联想（clipboard-search-and-tag-quality）

> `search-filters` 已有基线（openspec/specs/search-filters/spec.md）。本 delta 全部为 `ADDED Requirements`，不改动既有三条 Requirement 的文本。

## ADDED Requirements

### Requirement: 汉字部分词匹配

ClipForge SHALL 让全文搜索命中汉字串内部的部分词：查询词是某行正文里连续汉字的子串时，该行 SHALL 出现在搜索结果中；查询 SHALL NOT 跨标点匹配。

#### Scenario: 两字部分词命中

- **GIVEN** 历史中有一行正文包含「插件化平台启动接线」
- **WHEN** 用户搜索「平台」
- **THEN** 该行出现在搜索结果中

#### Scenario: 标点不被跨越

- **GIVEN** 历史中有一行正文「先搜平台，再搜方案」
- **WHEN** 用户搜索「台再」
- **THEN** 该行不出现在结果中

### Requirement: 英文前缀匹配

ClipForge SHALL 让全文搜索命中英文单词前缀：查询词是某行里某个英文单词的前缀时，该行 SHALL 出现在搜索结果中。

#### Scenario: 输入未完成的单词

- **GIVEN** 历史中有一行包含「review requests」
- **WHEN** 用户搜索「reque」
- **THEN** 该行出现在搜索结果中

### Requirement: 输入时的关键词联想

ClipForge SHALL 在用户输入普通文字（不以 `@`、`#` 开头）时，在搜索框下方展示来自历史内容的关键词候选，最多 6 条，并 SHALL 支持用方向键选择、按回车用候选词替换当前输入并发起搜索。候选 SHALL NOT 包含只在一两行里出现的汉字碎片。

#### Scenario: 输入汉字前缀

- **GIVEN** 历史中至少 3 行包含「会议」
- **WHEN** 用户输入「会」
- **THEN** 联想列表包含「会议」
- **AND** 用户按回车后搜索框内容变为「会议」，列表按「会议」重新搜索

#### Scenario: 低频碎片不出现

- **GIVEN** 某个汉字片段只在 1 行历史里出现
- **WHEN** 用户输入它的前缀
- **THEN** 联想列表不包含该片段

#### Scenario: 命令输入不受影响

- **GIVEN** 用户输入以 `@` 或 `#` 开头
- **WHEN** 联想列表构建
- **THEN** 列表仍然只展示类型、收藏或标签候选，不展示关键词候选
