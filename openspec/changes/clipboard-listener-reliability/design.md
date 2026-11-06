# Design：剪贴板监听可靠性修复

> 配套 `proposal.md`。所有时间戳为本地时间（GMT+8）；所有计数为 2026-11-05 时点快照，应用仍在写日志。
> 证据分级：**【证】** 日志/DB/代码可直接证明；**【验】** 需实机或额外日志验证；**【反】** 与直觉相反的证据。

## 1. 证据来源与方法

| 来源 | 路径 | 范围 |
|---|---|---|
| 稳定版日志 | `~/Library/Application Support/ClipForge/clipforge.jsonl` | 3726 行，10-29 10:38:12 → 11-05 17:20:26 |
| dev 日志 | `~/Library/Application Support/ClipForge-dev/clipforge.jsonl` | 6022 行，10-09 17:15:38 → 11-05 11:14:56 |
| 稳定版 DB | `~/Library/Application Support/ClipForge/clipforge.sqlite` | `mode=ro`，546 active（17:14 快照）/ 547（17:20） |
| dev DB | `~/Library/Application Support/ClipForge-dev/clipforge.sqlite` | `mode=ro`，用于核对 dev 窗口是否新增行 |
| 代码 | `src-tauri/src/clipboard/watcher.rs`、`src-tauri/src/lib.rs`、`src/clipboard/*.ts` | 链路排查 |

日志格式 `{tsMs, level, message, context}`；`message` 带 `[模块名]` 前缀。两路独立复核：一路重算全部计数并逐窗展开，一路做代码链路排查。tsMs 单调递增、无解析失败；稳定版有 76 条完全重复行（去重后 3650）。

## 2. 日志异常时间线

### 2.1 关键事件（稳定版）

| 时间 | 事件 | 证据等级 |
|---|---|---|
| 10-29 10:38:12 | 日志起点（晚于 08-11 备份，说明前面已被清理） | 【证】 |
| 11-02 11:32:36 | `read error (1): No string found` | 【证】 |
| 11-02 17:15 / 17:36、11-03 14:37 / 14:38 | created_at 峰值 5 条/分钟 | 【证】 |
| 11-02 19:41:47 → 11-03 10:56:56 | 915.1 min 静默（overnight） | 【证】 |
| 11-03 10:34:11/12 | `[startup]` → `watcher started, mode=macos-poll-120ms` | 【证】 |
| 11-03 10:56:57 | `Cleanup completed`（maxStoredItems=500 裁剪） | 【证】 |
| 11-03 11:47:17 → 13:04:17 / 17:52:27 → 19:01:25 | 77.0 / 69.0 min 静默 | 【证】 |
| 11-04 10:59:42 | `read error (1): No string found` | 【证】 |
| 11-04 11:11 | detected 峰值 6 次/分钟 | 【证】 |
| 11-04 11:48:50 → 14:26:22 | 157.5 min 静默 | 【证】 |
| 11-05 11:01:34/35 | `[startup]` → `watcher started` | 【证】 |
| 11-05 11:02:36 | `Cleanup completed` | 【证】 |
| **11-05 13:55:48 → 15:29:43** | **93.9 min 静默；窗内 38 行活动** | 【证】 |
| 11-05 14:29:47 | `[shortcut] pressed Control+V`（面板快捷键，非 Cmd+C）、`[panel-toggle] show`、`[paste-focus] snapshot frontmost=企业微信` | 【证】 |
| 11-05 14:29:48 | `manual capture, raw_hash=b54d6f54, hash=b54d6f54` —— 与 13:55:48 detected 的 hash **相同** | 【证·反】 |
| 11-05 17:14 / 17:20 | 取证后日志仍增长（+1 detected/+4 行），计数为时点值 | 【证】 |

### 2.2 关键事件（dev）

| 时间 | 事件 | 证据等级 |
|---|---|---|
| 10-09 17:15:38 | dev 日志起点 | 【证】 |
| **10-09 18:06:23 → 18:56:20** | **`62f04eb3` 连续 8 次 detected（49.9 min）**：1 created（18:06:24, id `clip_62f04eb3…_1791540383788`）+ 7 promoted 同 id（18:14:54/18:22:20/18:25:33/18:28:16/18:52:04/18:53:34/18:56:21）；每次 promoted 前后紧跟 `watcher started` 与 `manual capture` | 【证】 |
| 10-09 17:40:45→17:44:31 / 17:50:00→18:05:29 | `49813a4d` 4 次 / `76440e23` 4 次 | 【证】 |
| **10-10 17:42:00 → 17:45:37** | **约 50 次 `manual capture`（≈1.5 s/次）+ `[dev-open] quick_probe skipped` 循环**；`0fd068c6` 5 次 detected（17:43:04→17:45:05，同分钟 4 次），3 promoted 同 id + 1 created 新 id + 1 次 detected（17:43:43）无 recorded | 【证】 |
| 10-10 17:43:43 | detected 无配对 recorded（dev 359−357=2 之一） | 【证】 |
| 10-13 10:51:21→11:01:19 | `a0246220` 3 次 | 【证】 |
| 10-22 03:06:01/03:17:37/03:32:04/03:32:44/03:36:43 | `capture disabled: CLIPFORGE_DISABLE_CAPTURE=1 (secondary instance)` ×5 | 【证·设计行为】 |
| 10-27 21:11:02 | `capture failed: unexpected end of file`（359−357 之二） | 【证】 |
| 10-27 21:18–22:06 | `watcher started` 密集（46 次总计） | 【证】 |
| 10-27 21:20:46→21:22:20 | `6ac04ef9` 3 次 | 【证】 |
| 10-27 22:06:10 → 11-05 11:01:39 | 737729 s 静默（dev 未运行） | 【证】 |

### 2.3 汇总计数

| 指标 | 稳定版 | dev |
|---|---|---|
| `[clipboard-monitor]` 行 | 1020 | 768 |
| detected / recorded | 508 / 508 | 359 / 357 |
| created / promoted | 473 / 35 | 287 / 70 |
| watcher started / stopped | 2 / 0 | 46 / 0 |
| read error / capture failed / init failed | 2 / 0 / 0 | 0 / 1 / 0 |
| capture disabled | 0 | 5 |
| manual capture（raw==processed） | 67（67/67） | 244（244/244） |
| 严格连续同 hash 段 ≥3 | 0 | 6 |
| 相同 content_hash 重复组 | 0 | — |
| 相同 content 各 2 条 | 3 组 | — |

## 3. 两类异常的触发条件与关键证据

### A 有时无法监听到剪贴板变化

**已成立事实**：静默期客观存在（最长 157.5 min）；watcher 全程无 stopped / init failed；dev 5 次被**显式**禁用；11-05 静默窗内手动读板 hash 未变。

**能解释「感觉没监听到」的已证代码路径**（不需要假设 watcher 死了）：
- `watcher.rs:91-93`：指纹相同直接 return，**重复复制相同内容既不 promote 也不 emit** → 用户复制了同一段文字，界面零反馈、条目不置顶。已有提案 `clipboard-data-integrity` 缺口 2 已记录、未实施。
- `watcher.rs:94` + `:161-167`：指纹在 capture/emit 前提交，capture 失败不回滚 → 该内容在本进程生命周期内不再被采集。
- `lib.rs:5295-5301` + `watcher.rs:84`：抑制窗口期间整体 return 且不更新指纹；若用户在窗口内复制 X、随后被写回内容 W 覆盖，X 永久丢失。
- `lib.rs:8294-8305`：`LISTEN_PAUSED` 无日志、无前端同步、重启重置；托盘暂停后用户不知情。
- `watcher.rs:12-19`：`CLIPFORGE_DISABLE_CAPTURE=1` 时整个监听不启动（dev 5 次）。

**待验证假设**：存在「剪贴板内容确已改变却无 detected」的配对事件。日志不记录 Cmd+C、不记录前后值、只有 8 位 hash 前缀，当前**无任何证据**。必须先补 P0 日志或做实机注入才能定论。

### B 有时重复产生大量剪贴板内容记录

**已成立事实**：dev 6 段连续同 hash detected；`62f04eb3` 8 次 / 50 min、`0fd068c6` 5 次 / 2 min；46 次 watcher started；244 次 manual capture；1.5 s 探针循环。

**证据链**：
- `watcher.rs:74,27`：`last_fingerprint` 初始空 + 启动先跑 `process_current_clipboard()` → **每次进程启动强制 detected 一次**（dev 46 次 started 直接佐证）。
- `lib.rs:1382-1418`：DB 按 `content_hash` 查重，命中只 UPDATE 并 `status=promoted` → 反复 detected 不会插新行，但**每次都 emit `clipboard-changed`**（`watcher.rs:152`）。
- `use-clipboard-list.ts:289-304`：搜索/过滤视图每个事件全量 `search_clip_records(limit=max(200,已加载))` 并强制 `setSelectedId(items[0].id)` → 事件风暴放大成列表刷新与选中态跳动。
- `lib.rs:7975-7999`：open_panel 显示前补采是**第二条独立采集路径**，不与 watcher 共享 `last_fingerprint`（`:7978-7979` 注释自认「轮询线程稍后重采不会产生重复条目」，但没说不会重复 emit）。

**反证**：当前稳定版 DB 相同 `content_hash` 重复组 = 0；`62f04eb3` 窗口是 1 created + 7 promoted 复用同一 id；dev DB 里 `62f04eb3` 0 行、`0fd068c6` 1 行，且窗口内日志报 created 的新行在 DB 中查不到（dev 日志/DB 不同步）。→ **异常 B 是「日志/事件风暴」，不是「DB 重复行」**。且 UNIQUE 索引 + 500 条裁剪使得「当前无重复行」不能反推「历史上从未产生过重复事件」。

**待验证假设**：格式漂移造成同一可见文本多行（`primary_format` 不同）。稳定版 3 组同 content 各 2 条是线索，但**未核字段**，且已有提案缺口 3 已裁决缓议，本提案不改哈希口径。

## 4. 缺陷清单（按用户要求的四个维度）

标记：**【证】** 代码可直接证明；**【验】** 需日志/实机；A/B 对应异常类别。

### 缓存机制

| # | 位置 | 缺陷 | 类别 | 等级 |
|---|---|---|---|---|
| C1 | `watcher.rs:90-94` | `last_fingerprint` 存 raw 指纹、日志/入库算处理后指纹，口径不一致（机制存在）；但日志 311/311 raw==processed，当前配置未触发 | B | 【证·机制】/【反·触发】 |
| C2 | `watcher.rs:91-93` | 指纹相同直接 return，连 promote/emit 都不做 → 重复复制零反馈、不置顶 | A | 【证】（已有缺口 2） |
| C3 | `watcher.rs:94` 先于 `:136,:152` | 指纹在 capture/emit 前提交，失败（`:161-167`）或设置过滤（`:98-120`）不回滚 → 一次失败永久丢该条 | A | 【证】 |
| C4 | `watcher.rs:74,27` | 初始空指纹 + 启动即采集 → 每次启动强制 detected | B | 【证】 |
| C5 | `watcher.rs:171-184` | read error 不更新/回滚指纹；macOS 120 ms 轮询下次可自愈，Windows 事件驱动下该次变化永久漏采 | A | 【证·平台差异】/【验·发生】 |

### 监听状态

| # | 位置 | 缺陷 | 类别 | 等级 |
|---|---|---|---|---|
| S1 | `watcher.rs:47-48` | `start_watch()` 后仅一条 `watcher stopped` 日志，无重连/看门狗；`:29-38/:51-57` 初始化失败也不重试 | A | 【证·结构】/【验·发生】 |
| S2 | `lib.rs:8294-8305` | `LISTEN_PAUSED` 进程内 AtomicBool，无持久化、无 command、无 emit；仅托盘菜单文案同步 | A | 【证】 |
| S3 | `lib.rs:1253-1279` | `capture_current_clipboard`（前端 startup/manual）**不检查** `is_listen_paused()` / `should_skip_writeback()`，绕过暂停与抑制 | A/B | 【证】 |
| S4 | `watcher.rs:12-19` | `CLIPFORGE_DISABLE_CAPTURE` 仅启动时读一次，无双实例互斥/锁，不进环境快照 | A | 【证·行为】/【验·并存】 |
| S5 | `lib.rs:7975-7999` | open_panel 补采是独立路径，不共享 watcher 指纹 → 重复 promote/emit | B | 【证】 |

### 内容去重

| # | 位置 | 缺陷 | 类别 | 等级 |
|---|---|---|---|---|
| D1 | `lib.rs:1382-1418` | DB 按 `content_hash` 查重、命中 UPDATE 返回 promoted —— **主体健全**，无需改动 | — | 【证·无需改】 |
| D2 | `lib.rs:1493-1511` + `clipboard/ingest.rs:89-112,156` | Text 优先 html>rtf>plain，同一可见文本格式不同 → 两个 content_hash → 两条独立记录 | B | 【证】（已有缺口 3，缓议） |
| D3 | `watcher.rs:152` | promoted 也 emit `clipboard-changed` → 内容未新增但前端照常刷新 | B | 【证】 |
| D4 | `use-clip-writeback.ts:199,314,394,476` + `App.tsx:300` | `lastSeenClipboard` 只写不读、赋值时机不统一（invoke 前/后混用）→ 前端「去重」形同虚设 | — | 【证】 |

### 更新时机

| # | 位置 | 缺陷 | 类别 | 等级 |
|---|---|---|---|---|
| U1 | `use-clipboard-list.ts:274-312` | listener 无节流、无 in-flight 闸门；`change_count`（Rust 填的是毫秒时间戳、非递增序号）与 `preview_len` 完全未用 → 无序号可去重 | B | 【证】 |
| U2 | `use-clipboard-list.ts:289-304` | 搜索/过滤视图每事件全量刷新 200+ 行且 `:303` 强制选中首条，多个并发 refresh 会互相覆盖 | B | 【证】/【验·频率】 |
| U3 | `lib.rs:5295-5301` | `suppress_writeback_for` 全局 bool + 每次 spawn 线程无条件清 false；450 ms(A) 与 700 ms(B) 重叠时 A 在 t450 提前解除 B 的保护 | A/B | 【证·机制】/【验·频率】 |
| U4 | 调用点 `lib.rs:793`(450ms)、`:834`(700ms)、`mcp/dispatch_write.rs:41`(450ms) | 固定窗口在写剪贴板**之前**开启，不覆盖写操作实际完成时刻；超时即回环 | A/B | 【证】 |

## 5. 缺陷影响范围

| 面 | 受影响 | 不受影响 |
|---|---|---|
| 数据采集 | watcher 轮询入库、启动补采、面板显示前补采、manual capture | 剪贴板读取 API 本身、图片/文件落盘 |
| 数据一致性 | `last_seen_at`/`updated_at`/`deleted_at` 复活、promoted 频次、`clipboard-changed` 事件数 | DB schema、`content_hash` UNIQUE、FTS 索引、软删复活语义 |
| 前端 | 主面板列表刷新、搜索/过滤视图选中态、状态栏提示 | 设置窗口、虚拟滚动、复制/粘贴命令本身 |
| 跨平台 | macOS/unix 120 ms 轮询；Windows 事件驱动的 read error 恢复差异 | `CLIPFORGE_DISABLE_CAPTURE` 三平台一致 |
| 不在范围 | — | 内存/WebView、焦点预取、MCP 工具、i18n、UI 视觉、lib.rs 模块化 |

## 6. 修复方案详细设计

### P0 可观测性（不改采集行为，先把假设变成可证）

| 项 | 做法 | 边界 |
|---|---|---|
| 监听状态日志 | 暂停/恢复、环境变量禁用、watcher 启动/退出原因、重连尝试各打一条 info/warn，带实例标识 | 只加日志，不改判定 |
| 抑制窗口日志 | 开始/结束各一条，带 `seq` 与截止时间戳；解决「重叠窗口被谁清掉」不可查 | 不加常驻采样线程 |
| 指纹双值 | `detected change` 同时打 raw 与 processed 指纹，直接验证 C1 | 已有 `manual capture` 打双值，复用格式 |
| 失败与回滚 | capture 失败、emit 失败、read error 恢复各打一条，带 hash 前 8 位 | 不改错误语义 |
| 事件序号 | `clipboard-changed` 的 `change_count` 改成**单调递增序号**（或使用独立 `event_id`），前端可去重 | 需同步前端类型；不改 DB |

### P1 缺陷修复（按证据优先级，逐项可独立回滚）

1. **C3 指纹提交时机**：把 `self.last_fingerprint = raw_fingerprint` 从 `:94` 移到 capture **成功后**（`:137` 之后）；设置过滤 `Ok(None)` 与 capture 失败时不提交。失败可自愈重试。
2. **U3/U4 抑制机制**：`WRITEBACK_SUPPRESS: AtomicBool` 换成 `AtomicI64` 截止时间戳 + 代际序号，`should_skip_writeback()` 比较 `now < deadline`；不再为每次调用 spawn 线程（消除提前解除与线程累积）。窗口结束时不主动补采，靠下一轮 120 ms 轮询自然读到当前内容。
3. **C4 启动 priming**：启动时读取当前指纹写入 `last_fingerprint` 但**不 emit、不 capture**（或仅在 DB 无该 hash 时才 capture），消除「每次启动强制 detected」。
4. **S1 看门狗**：`start_watch()` 返回后记录退出原因，按指数退避（上限可配置）重启 watcher；连续失败达阈值时打 error 并暴露状态，避免无限静默。
5. **S2/S3 暂停语义**：`set_listen_paused` 暴露 command + emit 状态给前端；`capture_current_clipboard` 与 open_panel 补采统一走同一个「是否允许采集」判定（含暂停与抑制）。
6. **U1/U2 前端事件治理**：listener 用单调序号丢弃乱序/重复事件 + 60–100 ms 节流 + in-flight 闸门；搜索视图刷新保留当前 `selectedId`，不强制跳到首条。
7. **S5 采集路径收敛**：open_panel 补采与 watcher 共享同一指纹/去重状态（可放在 `clipboard/` 模块的一个 `Arc<Mutex<...>>`），避免两条路径各 promote 一次。

### P2 复用已有裁决

- C2「重复复制不置顶」→ `clipboard-data-integrity` 缺口 2；本提案提供日志证据与回归项，不改其裁决。
- D2「格式漂移多行」→ 同提案缺口 3/4，3.2 已明确缓议；**不改哈希口径**。
- D4 `lastSeenClipboard` 死状态：本提案只登记，是否在前端修复由 `clipboard-data-integrity` 或前端重构决定。

## 7. 验证标准与回归检查项

### 7.1 复现与量化标准（A/B 各一组）

| 编号 | 场景 | 通过标准 |
|---|---|---|
| A1 | 复制内容 X → 再复制**不同**内容 Y → 立即复制回 X | 三次都有 detected；X 第二次出现时 promoted 且不新增行；无静默丢失 |
| A2 | 复制 X → 在 450 ms 抑制窗口内复制 Y → 窗口结束后检查 | Y 不丢（当前机制可能吞掉）；无回环额外条目 |
| A3 | 连续触发两次写回（450 ms + 700 ms 重叠） | 不出现「自己写回的内容被当新内容采集」；抑制截止时间可查 |
| A4 | 启动应用 10 次，剪贴板内容不变 | detected 增量 0（当前每次启动 +1） |
| A5 | 人为让 watcher 退出（测试钩子/故障注入） | 有退出原因日志 + 自动重连，监听在 N 秒内恢复 |
| A6 | Windows 事件驱动下模拟一次 read error | 该次变化不永久丢失 |
| B1 | 同一内容连续复制 10 次 | 最多 1 次 created，promoted 次数可解释；`clipboard-changed` 事件数不随复制次数线性放大 |
| B2 | dev 探针每 1.5 s 触发 manual capture，持续 5 min | 前端 `search_clip_records` 调用次数下降（相对基线有量化对比）；选中态不跳 |
| B3 | 打开面板 10 次，内容不变 | 不因 open_panel 补采产生额外 emit |
| B4 | 同一可见文本分别从富文本/纯文本来源复制 | 记录为「已知行为」（缺口 3），本提案不改哈希、不加断言 |

### 7.2 日志/DB 门禁

- detected 与 recorded 一一对应（差值为 0，或每条差值都能用明确日志解释）。
- `SELECT content_hash, COUNT(*) ... HAVING COUNT(*)>1` 结果为 0。
- 单次启动区间内，内容未变时 detected 增量 = 0。
- 事件风暴窗口内 `clipboard-changed` 事件数与 `promoted` 次数可一一对应，且前端刷新次数 ≤ 事件数（有节流）。

### 7.3 回归检查项（不得遗漏）

- 功能：复制 / 粘贴 / 原格式粘贴 / 搜索 / 过滤 / 多选 / 回收站 / 收藏 / 软删后重采复活 / 图片与文件剪贴板 / 敏感内容过滤。
- 性能：`pnpm test:perf-panel -- --sandbox --rounds 20` show/hide 最差轮次 ≤180 ms（脚本判据 `max(values)`，不产 p95；需机器解锁，锁屏必然超时）。
- 双实例：`CLIPFORGE_DISABLE_CAPTURE=1` 与稳定版并存时，稳定版 detected 不出现双倍；快捷键 Control+V / Control+N 不冲突。
- 跨平台：macOS / Linux / Windows 分别 `cargo check`（Windows target 本机缺 MSVC SDK，如实记录不作阻断）。
- 工程门禁：`pnpm build`（**执行前需盟哥点头**：会重签覆盖 release/*.dmg 与发布元数据）、`cd src-tauri && cargo check`、`cargo test --lib`、`pnpm test:unit`、`openspec validate clipboard-listener-reliability --strict`。
- 若实施期新增 `scripts/` 校验脚本，按 AGENTS.md:101 同步 `docs/BUSINESS_INDEX.md` 索引行，并跑 `pnpm locate --check-index`。

## 8. 取证盲区与残留风险

1. 日志轮转：`logAutoCleanup=true / logMaxLines=20000 / logMaxSizeMb=10 / keepRatio=0.6`；稳定版起点 10-29 晚于 08-11 备份，10-29→11-03 启动段已被清理，`log cleaned 0 次` 说明清理发生在现行文件之前 → 静默期若跨清理边界会失真。
2. `debugLogsEnabled` 默认 false，但两份 settings 实际为 true → 结论不可外推到默认配置。
3. 稳定版与 dev 并存（dev 5 次 `(secondary instance)` 证实），两实例快捷键/DB/日志分离但会互相写剪贴板；稳定版 detected 归属无法排除 dev 干扰。
4. 日志只有 8 位 hash 前缀、不含剪贴板实际内容，detected 不记变化前后值；无键盘/系统级事件 → **无法知道用户是否按过 Cmd+C**，这是 A 类无法定论的根本原因。
5. DB 有 UNIQUE 索引且被 500 条上限裁剪过 → 「当前无重复行」不等于「历史无重复事件」。
6. dev 日志与 dev DB 不同步（窗口内日志报 created 但 DB 查不到行）→ dev 侧结论只作机制佐证，不作数据结论。
7. 只读打开 WAL 库会生成 `-shm` 文件；所有计数为时点快照，应用在持续写日志。

## 9. 与已有提案的边界

| 提案 | 已有裁决 | 本提案处理 |
|---|---|---|
| `clipboard-data-integrity`（ROADMAP 4/11，未归档） | 缺口 2（短路不置顶）、缺口 3/4（格式/文件哈希）、3.2 缓议、Bug 1 已修 | **复用不改**；只补日志证据与 B4 回归项 |
| `clipboard-multi-format-fidelity`（22/26） | tasks「验证写回后不会重复入库」未勾 | 本提案 A3/U3 提供机制与复现，不重复立 spec |
| `file-image-clipboard-support`（82/83） | 监听去重、采集类型配置 | 不碰 |
| `clipboard-interaction-repair`（0/10，11-05 新建） | 详情页/多选八项 | 与监听无关，不重叠 |
| `codebase-modularity-refactor`（25/31） | Phase 6 lib.rs window/log/tray 拆分未完成 | **不纳入本提案**（盟哥本轮问及，已单独答复） |
