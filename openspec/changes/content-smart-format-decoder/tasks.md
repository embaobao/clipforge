# 任务：智能解析代码、JSON 与常用解码格式

## Phase 1：模型与快速分类

- [ ] 定义 `SmartFormatAnalysis`
- [ ] 实现快速分类器：json/url/base64/jwt/unicode/html_entity/code
- [ ] 将分类结果写入 clip analysis
- [ ] `kind` 字段接入 json/code/url/command
- [ ] 补单元测试覆盖常见样例

## Phase 2：JSON 能力

- [ ] 合法 JSON 格式化
- [ ] 合法 JSON 压缩
- [ ] JSON parse 错误位置展示
- [ ] 尾逗号修复建议
- [ ] 单引号和未引号 key 修复建议
- [ ] 转义 JSON 字符串反转义后再 parse

## Phase 3：常用解码

- [ ] URL decode
- [ ] Base64 decode
- [ ] Base64URL decode
- [ ] JWT header/payload decode
- [ ] Unicode escape decode
- [ ] HTML entity decode

## Phase 4：详情页动作

- [ ] 根据 analysis 展示可用动作
- [ ] 结果预览面板
- [ ] 复制结果
- [ ] 保存结果为新条目
- [ ] 错误状态显示明确原因

## Phase 5：搜索衔接

- [ ] `search-filter-tags-filetypes` 接入 `kind:json`
- [ ] 接入 `kind:code`
- [ ] 接入 `kind:url`
- [ ] 空结果/筛选 chip 展示解析类型

## Phase 6：验证

- [ ] `pnpm build` 通过
- [ ] `cd src-tauri && cargo check` 通过
- [ ] 验证合法 JSON 格式化/压缩
- [ ] 验证非法 JSON 修复建议不覆盖原文
- [ ] 验证常用解码结果可复制
- [ ] 验证大文本不会阻塞快速面板
