# 提案：剪贴板监听可靠性修复（clipboard-listener-reliability）

> 状态：**已实施（2026-11-06，RS-51）**。触发：2026-11-05 盟哥要求「结合日志确认真实根因、区分已验证结论与待验证假设、核查缓存机制/监听状态/内容去重/更新时机、完整覆盖两类异常、不引入无关改动」；2026-11-06 盟哥确认按提案实施。分支 `rs-51-clipboard-listener-reliability`，验证证据见 `tasks.md` 第 3-5 节。
> 取证：只读解析稳定版与 dev 两份 `clipforge.jsonl`，只读打开两份 `clipforge.sqlite`；代码链路与日志结论由两路独立复核（Explore 全量排查 + 推理模型重算/证伪）。
> 时点：稳定版日志 11-05 17:20:26 快照、dev 日志 11-05 11:14:56 快照、稳定版 DB 11-05 17:14 快照。应用仍在写日志，所有计数是时点值。

## Why

用户反馈两类异常：**A 有时无法监听到剪贴板变化**、**B 有时重复产生大量剪贴板内容记录**。日志与 DB 取证后，结论必须分层，不能把「感觉」写成「根因」。

### 已验证结论（日志 / DB / 代码可直接证明）

1. 稳定版 `[clipboard-monitor]` 1020 行：**detected=508 / recorded=508 一一对应**，status created=473 / promoted=35；`read error: No string found` 仅 2 次（11-02 11:32:36、11-04 10:59:42，相隔 2 天）；`watcher started` 2 次（11-03 10:34:12、11-05 11:01:35）且都配对 `[startup]`；**`watcher stopped` / `watcher init failed` / `emit failed` 均为 0**。→ 没有「监听线程死了」的证据。
2. dev 日志存在 **6 段连续相同 hash 的 detected**（`62f04eb3` 8 次 / 49.9 min、`0fd068c6` 5 次 / 2 min 且同一分钟 4 次、`49813a4d` 4 次、`76440e23` 4 次、`a0246220` 3 次、`6ac04ef9` 3 次），另有 `watcher started` **46 次**、`manual capture` 244 次。
3. 但 `62f04eb3` 窗口逐条核对是 **1 次 created + 7 次 promoted 到同一 id**（`clip_62f04eb3…_1791540383788`），每次 promoted 前后紧跟 `watcher started` 与 `manual capture`；`0fd068c6` 窗口夹着约 1.5 s 一次的 dev 自动化探针与 `[dev-open] quick_probe skipped` 循环。→ **异常 B 在当前证据下是「日志/事件风暴 + 反复 promoted」，不是 DB 里插了多行**。
4. 稳定版 DB active 546 条，**相同 `content_hash` 重复组 = 0**；相同 `content` 仅 3 组各 2 条（'WeKnora'、'Toonflow'、'Meng (the user)'，均跨小时）。`idx_clips_content_hash` 是 UNIQUE 索引，且 `maxStoredItems=500` 已裁剪过（Cleanup completed 2 次）。
5. **311/311 条 `manual capture` 日志的 `raw_hash == processed hash`**（稳定版 67/67、dev 244/244）。→ `apply_capture_settings()` 在当前设置下未改变 payload，「原始/处理后指纹漂移」机制**本次未触发**。
6. 11-05 13:55:48→15:29:43 的 93.9 min 静默窗内有 38 行用户活动（14:29:47 `Control+V` 唤起面板、panel-toggle、14:29:48 `manual capture raw_hash=b54d6f54`），而 `b54d6f54` 与 13:55:48 的 detected 完全相同 → **剪贴板内容未变，无 detected 符合「hash 变化才记录」的设计**。
7. dev 5 次 `capture disabled: CLIPFORGE_DISABLE_CAPTURE=1 (secondary instance)`（10-22 03:06:01–03:36:43）是显式双实例隔离，属设计行为。
8. 代码层多个缺陷可直接证明（`design.md` 第 4 节），其中最能解释「感觉没监听到」的是 `watcher.rs:91-93`：指纹相同直接 return，**重复复制相同内容既不 promote 也不 emit**，用户看不到任何反馈——这正是已有提案 `clipboard-data-integrity` 的「缺口 2」。

### 待验证假设（缺用户输入或复现证据，不得写成根因）

- 用户确实按了 Cmd+C / 内容确实变了，却没有 detected：日志不记录键盘与剪贴板前后值，**无任何配对证据**。
- watcher 曾内部退出但没打 `watcher stopped`：`start_watch()` 后无重连/看门狗是代码事实，是否发生过无证据。
- 写回抑制窗口吞掉真实用户复制 / 重叠抑制提前解除：竞态在代码里可证，实际发生频率无日志（当前日志不打抑制窗口）。
- 稳定版与 dev 并存互相写板干扰：dev 5 次禁用证实并存意图，但稳定版 detected 的归属无法区分。
- 3 组同 content 各 2 条是否由 `primary_format` 漂移造成：未核字段，需 DB 复核。
- 静默期是否跨日志清理边界：稳定版日志起点 10-29 晚于 08-11 备份，10-29→11-03 启动段已被清理。

#### 2026-11-06 实施结果（机制级假设的推进）

- **重叠抑制提前解除：已证实并修复。** base 提交 7c7af6c 上以旧 `suppress_writeback_for` 公共 API 复现：450ms+700ms 重叠，t≈550ms 时 `should_skip_writeback() == false`（红证）；新截止时间戳实现下同场景为 true（绿证，`realtime_overlap_stays_suppressed_until_max_deadline`）。
- **启动强制 detected：已证实并修复。** `ten_startups_with_unchanged_content_yield_zero_detected`：priming 后 10 次启动 detected/emit 增量 0。
- **capture 失败永久漏采：已证实并修复。** `capture_failure_keeps_fingerprint_for_retry`：失败不提交指纹，下轮重试成功。
- **两路径不共享指纹导致重复 promote/emit：已证实并修复。** dev 日志「每次 promoted 前后紧跟 manual capture」与共享指纹收敛（`clipboard/dedup.rs`）；前端事件风暴 50 并发 → 刷新 ≤2 次。
- **A 类「用户复制了却无 detected」的实机配对证据：仍未取得。** P0 日志（抑制窗口起止、双指纹、重连、read error 恢复）已具备取证能力，待装机运行期观察；「重复复制不置顶」仍归 `clipboard-data-integrity` 缺口 2 裁决。

### 反证（与直觉相反，提案必须写明）

- 「DB 里重复产生大量记录」：当前快照无重复 `content_hash`；dev 窗口是复用同一 id 的 promoted。
- 「监听挂了」：无 stopped / init failed，2 次 started 配对 startup。
- 「指纹漂移导致重复 detected」：311/311 raw==processed。
- 「静默期就是漏监听」：11-05 窗手动读板 hash 未变。

## What（建议修复范围）

**P0 先补可观测性（不改采集行为，零风险）** —— 当前日志无法区分「内容没变」与「没采到」，任何根因定论都缺证据：监听暂停/恢复、抑制窗口起止（带序号）、watcher 退出原因与重连、detected 时同时打 raw/processed 指纹、capture 失败与回滚、read error 恢复。补完日志才能把 A/B 从假设变成可证。

**P1 修代码可证缺陷（按证据优先级）**
1. `watcher.rs:94` 指纹在 capture/emit **之前**提交，失败不回滚 → 一次失败永久丢该条。改为成功后提交。
2. `lib.rs:5295-5301` 全局 bool + 每次 spawn 线程无条件 `store(false)` → 450 ms/700 ms 重叠时提前解除；`watcher.rs:84` 抑制期间整体 return 且不更新指纹 → 可能吞掉真实复制。改为带截止时间/代际的单一守护。
3. `watcher.rs:74,27` `last_fingerprint` 初始空 + 启动即采集 → 每次启动强制 detected（dev 46 次 started 佐证）。改为启动时静默 priming。
4. `watcher.rs:47-48` `start_watch()` 后无重连/看门狗 → 一旦返回监听永久停止。加带退避的重启与退出原因日志。
5. `lib.rs:8294-8305` `LISTEN_PAUSED` 无持久化/无 command/无 emit；`lib.rs:1253-1279` `capture_current_clipboard` 绕过暂停与抑制 → 暂停语义不一致。统一入口判定并暴露状态。
6. `use-clipboard-list.ts:274-312` listener 无节流、无 in-flight、`change_count` 完全未用；搜索/过滤视图每个事件全量 `search_clip_records` 并 `:303` 强制选中首条 → 事件风暴放大成列表抖动。加单调序号去重 + 节流 + 保留选中态。
7. `lib.rs:7975-7999` open_panel 补采与 watcher 两条独立路径不共享指纹 → 重复 promote/emit。统一去重状态。

**P2 复用已有裁决，不另立方案**
- 「重复复制相同内容不置顶」（缺口 2）、「富文本格式漂移多行」（缺口 3/4）由 `openspec/changes/clipboard-data-integrity/` 记录，其中 3.2「同 plain_text 多格式合并」已裁决缓议。本提案只补日志证据与回归检查项，**不改哈希口径、不重复造轮子**。

## Impact

- 改动面：`src-tauri/src/clipboard/watcher.rs`、`src-tauri/src/lib.rs` 采集/抑制/暂停/补采相关函数、`src/clipboard/use-clipboard-list.ts`、日志字段；必要时 `docs/BUSINESS_INDEX.md` 同步（若实施期新增校验脚本）。
- 不改 DB schema、不动 `content_hash` / `clipboard_payload_fingerprint` 算法、不改设置项默认值。
- 与 `focus-prefetch-idle-removal`、`pinned-floating-panel`、`codebase-modularity-refactor` 无文件级冲突（lib.rs 是共享文件，需按 hunk 隔离提交）。

## 不做（明确边界，防范围蔓延）

- 不做 `lib.rs` 模块化拆分（9557 行是 `codebase-modularity-refactor` Phase 6 的债，见本轮对话答复）。
- 不动内存/窗口/WebView、焦点预取、MCP 工具、i18n 文案、UI 视觉。
- 不改已有提案已裁决的哈希口径与软删复活语义。
- 不删 dev 自动化探针、不清理旧日志、不做数据迁移。
- ~~本提案阶段不实施代码，先取得盟哥确认~~：盟哥已确认（2026-11-06），实施完成，证据见 tasks.md。

## 验证标准（详见 `design.md` 第 7 节）

- 复现闭环：A 类需构造「内容确实改变却无 detected」的配对证据；B 类需构造「同一内容反复 detected/promoted」并量化事件数。
- 量化门禁：detected/recorded 一一对应、同 `content_hash` 重复组 0、启动 10 次内容未变时 detected 增量 0、重叠抑制不回环、事件风暴下 `search_clip_records` 调用次数下降。
- 回归：`pnpm build` / `cargo check` / `cargo test --lib` / `pnpm test:unit` / `pnpm test:perf-panel -- --sandbox --rounds 20`（需机器解锁）+ 复制/粘贴/搜索/多选/回收站/软删复活/双实例隔离实机矩阵。
