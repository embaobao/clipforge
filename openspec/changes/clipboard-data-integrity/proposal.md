# 提案：剪贴板数据完整性修复——去重软删碰撞与重复条目缺口（clipboard-data-integrity）

> 所属波次：W1 剪贴板核心闭环收口，见 [product-iteration-master-plan](../product-iteration-master-plan/proposal.md)。

## 状态

缺陷修复提案（2026-10-09 调查发现，用户要求先提案后实施）。去重机制主体健全（blake3 content_hash 全局查重 + DB UNIQUE 索引 + import 复活语义），但采集主路径存在一个真实数据丢失 bug 和四个用户可感知的重复条目缺口。

## 调查结论（证据）

**现有机制**（无需改动）：
- 哈希：`blake3(primary_format + ":" + 主 representation 原始字节)`（lib.rs:4719-4724）；文本取 HTML>RTF>plain 最高优先 representation（clipboard/ingest.rs:156），图片取 PNG 二进制（:43），文件取路径 join（:205）
- 查重：`SELECT ... WHERE content_hash = ?1 AND deleted_at IS NULL`（lib.rs:1366-1375），命中 promote（UPDATE last_seen_at/updated_at/source_app，不新增行），未命中 INSERT；DB 层 `UNIQUE INDEX idx_clips_content_hash`（lib.rs:4679）兜底
- 轮询前置短路：watcher 指纹相同直接 return（clipboard/watcher.rs:90-94）

**Bug 1（数据丢失，必修）**：软删行的 content_hash 仍占唯一索引。用户删除条目后再次复制相同内容 → SELECT 带 `deleted_at IS NULL` 查不到 → 走 INSERT → 撞 UNIQUE 索引 → `CLIP_CAPTURE` 报错、条目丢失（lib.rs:1429 map_err 分支）。import 路径已有正确示范：`ON CONFLICT(content_hash) DO UPDATE SET ... deleted_at = NULL`（lib.rs:5153-5156）复活语义，采集路径漏了。

**缺口 2（UX 直觉悖逆）**：watcher 指纹短路（watcher.rs:90-94）导致面板关闭时重复复制相同内容**不 promote**——条目不置顶、last_seen_at 不更新，与「刚复制的应在最上面」的直觉相悖。

**缺口 3（感知重复）**：富文本格式漂移——同一可见文本，Word 与 Safari 写出的 HTML/RTF 源码不同 → 主 representation 字节不同 → 两条。同内容一次带富文本一次纯文本复制 → primary_format 不同 → 两条。

**缺口 4（文件按路径）**：文件剪贴板按路径列表哈希（ingest.rs:196-205）：路径相同内容变化不更新；路径顺序不同算两条。

**缺口 5（无开关）**：settings 无去重/合并相关配置项（仅采集过滤开关）。

## What（修复范围）

1. **Bug 1 修复**（采集路径对齐 import 复活语义）：SELECT 去掉 `deleted_at IS NULL` 过滤；命中行的 UPDATE 增加 `deleted_at = NULL`。活行行为不变（deleted_at 本就是 NULL）；软删行被再次采集时复活并刷新时间戳/source_app。已备好 diff，实施即应用。
2. **缺口 2**：评估 watcher 短路时是否补一次 promote（改动小但影响每次重复复制的写库频率，需实测轮询开销后定）。
3. **缺口 3/4**：先记录为已知行为写入文档（BUSINESS_INDEX 或设置页说明），是否做「同 plain_text 多格式合并」另立小提案（涉及哈希口径变更，风险高于收益的初判）。
4. **缺口 5**：本期不做（无用户需求信号）。

## Impact

- 仅动 `src-tauri/src/lib.rs` capture 路径约 3 行；无 schema 变更；无前端改动。
- 行为变化面：删除条目后重采同内容 → 条目复活回历史（用户重新复制即意图收回，与 import 一致）。
- 与 file-image-clipboard-support / clipboard-multi-format-fidelity 的实机矩阵可合并验证。

## 验证

- 构造场景：复制文本 A → 删除该条目 → 再次复制 A → 期望：条目复活在列表、日志 `status=promoted`、无 CLIP_CAPTURE 报错。
- 回归：活行重复复制仍 promote 不新增；不同内容正常 INSERT。
