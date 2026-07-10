# 任务：搜索框支持 Tag 与文件类型筛选

## Phase 0：依赖确认

- [x] 确认 `file-image-clipboard-support` 已提供基础 `type/kind/fileTypes` 字段
- [x] 确认 `clipboard-multi-format-fidelity` 已提供 `availableFormats` 或等价格式字段
- [x] 明确哪些筛选可先用现有字段铺垫，哪些必须等待格式支持落地

## Phase 1：查询模型

- [x] 定义 `SearchQueryAst`
- [x] 实现前端查询 token parser
- [x] 支持 `#tag` 快捷语法，与 `tag:tag` 进入同一 `filters.tags`
- [x] 实现 Rust 侧请求结构 `SearchClipsRequest`
- [ ] 补 parser 单元测试：tag/#tag/type/kind/file/bucket/favorite
- [x] 明确异常 token 的展示和忽略策略
- [x] 明确 tag normalize、去重、长度上限和中英文支持策略

## Phase 2：搜索服务

- [x] 升级 `ClipboardService.search` 参数
- [x] 将全文关键词和结构化筛选组合成参数化 SQL
- [x] 支持 tags 过滤
- [x] 支持 type/kind/bucket/favorite 过滤
- [x] 支持第一版 file extension 过滤

## Phase 3：前端交互

- [x] 搜索框展示 filter chip
- [x] chip 可删除并即时刷新结果
- [x] 列表 tag 点击后追加筛选
- [x] 详情页 tag 点击后返回列表并设置搜索栏为 `#tag`
- [x] 输入 `#AI` 后展示 `AI` tag chip
- [x] 空结果状态显示当前筛选摘要
- [x] 快速面板尺寸保持稳定，不因 chip 换行抖动

## Phase 4：多格式衔接

- [x] `file-image-clipboard-support` 落地后接入真实 `fileTypes/fileExtensions`
- [x] 图片条目支持 `type:image`
- [x] HTML 条目支持 `type:html`，RTF 等待真实多 representation 读取落地
- [x] 智能解析落地后接入 `kind:json` / `kind:code`

## Phase 5：验证

- [x] `pnpm build` 通过
- [x] `cd src-tauri && cargo check` 通过
- [x] 验证纯文本搜索保持原行为
- [x] 验证 tag/type/file 组合筛选
- [x] 验证 `#tag` 与 `tag:tag` 结果一致
- [ ] 验证 `#AI` 能命中 Agent 生成或建议应用保存后的条目
- [ ] 验证详情页 tag 点击能进入对应搜索结果
- [x] 验证删除 chip 后结果恢复
