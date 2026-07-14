# 任务：智能解析代码、JSON 与常用解码格式

## Phase 1：模型与快速分类

- [x] 定义 `SmartFormatAnalysis`
- [x] 实现快速分类器：json/url/base64/jwt/unicode/html_entity/code
- [x] 将分类结果写入 clip analysis
- [x] `kind` 字段接入 json/code/url/command
- [x] 补单元测试覆盖常见样例

## Phase 2：JSON 能力

- [x] 合法 JSON 格式化
- [x] 合法 JSON 压缩
- [x] JSON parse 错误位置展示
- [x] 尾逗号修复建议
- [x] 单引号和未引号 key 修复建议
- [x] 转义 JSON 字符串反转义后再 parse

## Phase 3：常用解码

- [x] URL decode
- [x] Base64 decode
- [x] Base64URL decode
- [x] JWT header/payload decode
- [x] Unicode escape decode
- [x] HTML entity decode

## Phase 4：详情页动作

- [x] 根据 analysis 展示可用动作
- [x] 结果预览面板
- [x] 复制结果
- [x] 保存结果为新条目
- [x] 错误状态显示明确原因

## Phase 5：搜索衔接

- [x] `search-filter-tags-filetypes` 接入 `kind:json`
- [x] 接入 `kind:code`
- [x] 接入 `kind:url`
- [x] 空结果/筛选 chip 展示解析类型

## Phase 6：验证

- [x] `pnpm build` 通过
- [x] `cd src-tauri && cargo check` 通过
- [x] 验证合法 JSON 格式化/压缩
- [x] 验证非法 JSON 修复建议不覆盖原文
- [x] 验证常用解码结果可复制
- [x] 验证大文本不会阻塞快速面板
