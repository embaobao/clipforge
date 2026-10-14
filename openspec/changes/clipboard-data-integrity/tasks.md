# Tasks:clipboard-data-integrity

## 1. Bug 1：软删条目重采撞 UNIQUE 索引丢数据（必修）

- [x] 1.1 lib.rs:1366-1375 查重 SELECT 去掉 `AND deleted_at IS NULL`（含中文注释：为什么必须查软删行）
- [x] 1.2 lib.rs:1376-1387 命中行 UPDATE 增加 `deleted_at = NULL`（复活语义，注释对齐 import 路径 lib.rs:5153-5156）
- [ ] 1.3 实机验证：复制文本 → 删除条目 → 再复制同文本 → 条目复活 + 日志 `status=promoted` + 无 CLIP_CAPTURE 报错（沙箱 `pnpm dev:sandbox`）
- [x] 1.4 回归：活行重复复制仍 promote 不新增行；轮询重复复制不新增行；不同内容正常 INSERT

## 2. 缺口 2：watcher 短路导致重复复制不置顶（评估后定）

- [ ] 2.1 实测 watcher 指纹命中也走 promote 的写库开销（单次 UPDATE 耗时）
- [ ] 2.2 若开销可接受（<2ms）：指纹命中时补一次 promote（仅刷 last_seen_at）；否则记录为已知行为

## 3. 缺口 3/4：感知重复（先文档化，不改哈希口径）

- [x] 3.1 在 docs/BUSINESS_INDEX.md 或设置页「采集与内容」说明区记录：富文本格式漂移/HTML vs plain/文件按路径 三类已知重复行为 --2026-10-13:BUSINESS_INDEX 新增「采集去重语义」行（promote 实现在 lib.rs capture 路径,content_hash 指纹;三类行为+合并缓议注记）
- [ ] 3.2 「同 plain_text 多格式合并」单独立项评估（哈希口径变更，需单独提案+回归矩阵，本期不做）

## 4. 收尾

- [ ] 4.1 门禁：`cd src-tauri && cargo check` + `pnpm build`
- [ ] 4.2 与 file-image-clipboard-support / clipboard-multi-format-fidelity 实机矩阵合并验证时附带本提案场景
- [ ] 4.3 盟哥确认后按 openspec 流程归档
