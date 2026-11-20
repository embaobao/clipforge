# Tasks: clipboard-listener-reliability

> 状态：**方案提案阶段，代码未改**。盟哥要求「输出结构化修复提案」，本清单的 3.x 以后全部**待明确确认后执行**。
> 证据栏填日志时间戳 / 计数 / 命令输出；未跑项保持 `[ ]` 并写明原因，禁止写「应该没问题」。

## 1. 取证与复核（已完成，只读）

- [x] 1.1 解析稳定版 / dev 两份 `clipforge.jsonl`：计数、时间线、静默期、连续同 hash 段、生命周期与错误事件 -- 证据：`design.md` 第 2 节
- [x] 1.2 只读查询稳定版 / dev 两份 `clipforge.sqlite`：active 条数、相同 `content_hash` 重复组、相同 content 组、created_at 峰值、Cleanup 记录 -- 证据：`design.md` 第 2.3 节
- [x] 1.3 核验 `manual capture` 的 raw/processed 指纹：稳定版 67/67、dev 244/244 全等 -- 证据：`design.md` 第 3 节 C1 反证
- [x] 1.4 逐窗展开 dev 连续同 hash 段：`62f04eb3` = 1 created + 7 promoted 同 id；`0fd068c6` 窗 = 1.5 s 探针风暴 -- 证据：`design.md` 第 2.2 节
- [x] 1.5 核查 11-05 静默窗用户活动与 manual capture hash -- 证据：14:29:48 `b54d6f54` 与 13:55:48 detected 相同，`design.md` 第 2.1 节
- [x] 1.6 代码链路排查（缓存 / 监听状态 / 内容去重 / 更新时机）-- 证据：`design.md` 第 4 节缺陷清单
- [x] 1.7 独立复核重算全部计数并做证据分级（已验证 / 待验证 / 反证）-- 证据：`proposal.md` 三个分区
- [x] 1.8 盘点已有提案边界，避免重复造轮子 -- 证据：`design.md` 第 9 节

## 2. 提案交付（当前阶段）

- [x] 2.1 建立 `openspec/changes/clipboard-listener-reliability/` 四件套 -- 证据：本目录
- [ ] 2.2 `openspec validate clipboard-listener-reliability --strict` -- 待本轮执行
- [ ] 2.3 向盟哥提交大白话结论 + 完整结果预览图（证据链 / 修复分层）-- 待本轮交付
- [ ] 2.4 取得盟哥对「是否进入实施」的明确确认 -- **确认前不改任何产品代码**

## 3. P0 可观测性（待确认后；不改采集行为）

> **2026-11-09 实现登记（不代勾 checkbox）**：按「完成全部任务开发」授权，`src-tauri/src/clipboard/watcher.rs` 已补纯日志实现，`cargo check` 通过（4.71s），文件 407 行满足 500 行门禁。**零采集行为变更**：未改去重指纹算法、未改抑制/暂停判定、未改 capture/emit 路径、未改 DB schema。
> 逐项对账：3.1 暂停/恢复边沿 + 退出原因/运行时长已补，**重连尝试属 4.4（P1）、实例标识未做**；3.2 抑制开始/结束边沿 + `seq` 已补，**截止时间戳在 `lib.rs` 抑制位（本轮不碰共享文件）未做**；3.3 raw/processed 双指纹 + `identical` 已补；3.4 capture 失败 hash/指纹保留、read error 恢复已补，emit 失败日志原有，**hash 前 8 位用 `short_hash` 防御性截断**；3.5 `change_count` 单调序号/前端类型未做；3.6 A/B 复现需实机日志，**未做**。
> 新增可观测性载体：`ObserveState`（状态边沿 + 30 秒跳过原因聚合，抑制 120ms 轮询日志风暴）、`detected_seq`（detected 单调序号）、`short_hash()`。跳过原因码：`unchanged` / `empty-fingerprint` / `no-payload`；状态边沿：`init → paused → writeback-suppressed → active`。
> 回滚基线：`artifacts/baseline-2026-11-09/tracked.patch`（含本轮编辑前的工作区全量 diff，`git apply --check -R` 已验证可干净反向应用）。

- [ ] 3.1 监听暂停/恢复、环境变量禁用、watcher 退出原因与重连尝试补日志，带实例标识 -- 证据：
- [ ] 3.2 写回抑制窗口开始/结束补日志，带 `seq` 与截止时间戳 -- 证据：
- [ ] 3.3 `detected change` 同时打 raw 与 processed 指纹（复用 `manual capture` 的双值格式） -- 证据：
- [ ] 3.4 capture 失败 / emit 失败 / read error 恢复补日志，带 hash 前 8 位 -- 证据：
- [ ] 3.5 `clipboard-changed` 的 `change_count` 改单调递增序号（或新增 `event_id`），同步前端类型 -- 证据：
- [ ] 3.6 用补完的日志复现 A/B 两类异常，把「待验证假设」逐条转为已验证或反证 -- 证据：

## 4. P1 缺陷修复（待确认后；逐项可独立回滚）

- [ ] 4.1 C3：指纹提交移到 capture 成功之后，失败/设置过滤不提交（`watcher.rs:94`） -- 证据：
- [ ] 4.2 U3/U4：`WRITEBACK_SUPPRESS` 换截止时间戳 + 代际，去掉每次 spawn 的 sleep 线程（`lib.rs:5295-5301`） -- 证据：
- [ ] 4.3 C4：启动静默 priming，内容未变不 detected/emit（`watcher.rs:74,27`） -- 证据：
- [ ] 4.4 S1：`start_watch()` 退出后按退避重启 + 退出原因日志（`watcher.rs:47-48`） -- 证据：
- [ ] 4.5 S2/S3：暂停状态暴露 command + emit；`capture_current_clipboard` 与 open_panel 补采统一判定 -- 证据：
- [ ] 4.6 U1/U2：listener 单调序号去重 + 节流 + in-flight 闸门；搜索视图保留 `selectedId`（`use-clipboard-list.ts:274-312`） -- 证据：
- [ ] 4.7 S5：open_panel 补采与 watcher 共享去重状态（`lib.rs:7975-7999`） -- 证据：

## 5. 验证与回归（待确认后）

- [ ] 5.1 A1–A6 六组复现（含抑制窗口内真实复制、重叠抑制、启动 10 次、watcher 故障注入、Windows read error） -- 证据：
- [ ] 5.2 B1–B4 四组复现（含 dev 探针风暴下前端刷新次数对比、面板 10 次不额外 emit） -- 证据：
- [ ] 5.3 日志/DB 门禁：detected↔recorded 一一对应、同 `content_hash` 重复组 0、启动区间 detected 增量 0 -- 证据：
- [ ] 5.4 功能回归：复制/粘贴/原格式粘贴/搜索/过滤/多选/回收站/收藏/软删复活/图片文件/敏感过滤 -- 证据：
- [ ] 5.5 `pnpm test:perf-panel -- --sandbox --rounds 20`（需机器解锁，锁屏必然超时；判据 `max(values) ≤180ms`，不产 p95） -- 证据：
- [ ] 5.6 双实例隔离：`CLIPFORGE_DISABLE_CAPTURE=1` 与稳定版并存，稳定版 detected 不翻倍 -- 证据：
- [ ] 5.7 工程门禁：`cargo check`、`cargo test --lib`、`pnpm test:unit`、`openspec validate ... --strict`；跨 target 失败如实记录 -- 证据：
- [ ] 5.8 `pnpm build` -- **执行前需盟哥点头**（重签并覆盖 release/*.dmg 与发布元数据） -- 证据：
- [ ] 5.9 若新增 `scripts/` 校验脚本，同步 `docs/BUSINESS_INDEX.md` 索引行并跑 `pnpm locate --check-index` -- 证据：

## 6. 收尾

- [ ] 6.1 回填全部证据与量化结果 -- 证据：
- [ ] 6.2 把 `proposal.md` 的「待验证假设」按实测结果更新为已验证或反证 -- 证据：
- [ ] 6.3 向 `clipboard-data-integrity` 回写 C2 / D2 的日志证据与 B4 回归项（不改其裁决） -- 证据：
- [ ] 6.4 记录未验证项（`design.md` 第 8 节取证盲区） -- 证据：
- [ ] 6.5 盟哥验收后按 openspec 流程归档
