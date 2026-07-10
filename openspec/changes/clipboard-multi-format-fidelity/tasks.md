# 任务：剪贴板多格式复制与回写保真

## Phase 1：模型验收

- [x] 确认 `file-image-clipboard-support` 已定义 `ClipboardRepresentation`
- [x] 确认 `clips.representations_json`、`primary_format`、`plain_text` 已完成 schema v2 重建
- [x] 确认前端类型已暴露 `primaryFormat`、`availableFormats`、`plainText`
- [ ] 增加模型兼容测试：旧纯文本条目可作为 text/plain representation 读取

## Phase 2：采集保真验收

- [ ] HTML 同时保存 html + plain
- [ ] RTF 同时保存 rtf + plain
- [ ] 图片保存 image/png + 可选来源路径
- [ ] 文件保存 file-list + plain paths
- [ ] 当平台缺失某个格式时写入诊断日志，避免把能力缺失误判成数据丢失

## Phase 3：写回

- [x] 确认 `PasteMode = Rich | Plain | FilesAsPaths` 已由基础提案暴露给前端命令
- [ ] 实现 rich 写回格式组合
- [ ] 实现 plain 写回
- [ ] 实现 files-as-paths 写回
- [ ] 写回前后接入 WritebackGuard
- [ ] 写回日志包含 writtenFormats

## Phase 4：前端动作

- [ ] 详情页展示可用格式
- [ ] 右键菜单增加复制原格式/复制为纯文本/文件复制为路径
- [ ] 不可用动作禁用并显示原因
- [x] 快速面板默认动作保持“复制原格式”

## Phase 5：验证

- [x] `pnpm build` 通过
- [x] `cd src-tauri && cargo check` 通过
- [ ] 验证 HTML rich/plain 写回
- [ ] 验证文件 rich/path 写回
- [ ] 验证图片 rich 写回
- [ ] 验证写回后不会重复入库
