# Tasks: clipboard-listener-reliability

> 状态：**已实施（RS-51，2026-11-06）**，分支 `rs-51-clipboard-listener-reliability`，PR：https://github.com/embaobao/clipforge/pull/1（含基线说明：本地 main 领先 origin/main 57 提交）。
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

## 2. 提案交付

- [x] 2.1 建立 `openspec/changes/clipboard-listener-reliability/` 四件套 -- 证据：本目录
- [x] 2.2 `openspec validate clipboard-listener-reliability --strict` -- 证据：2026-11-06 输出 `Change 'clipboard-listener-reliability' is valid`
- [x] 2.3 向盟哥提交大白话结论 + 完整结果预览（证据链 / 修复分层）-- 证据：RS-51 issue 描述与确认记录
- [x] 2.4 取得盟哥对「是否进入实施」的明确确认 -- 证据：2026-11-06 盟哥确认按提案实施（RS-51 issue 记载）

## 3. P0 可观测性（已实施，不改采集行为）

- [x] 3.1 监听暂停/恢复、环境变量禁用、watcher 退出原因与重连尝试补日志 -- 证据：`set_listen_paused` 统一入口落 `listen paused/resumed`；`supervise_watcher` 落 `watcher exited, uptime_ms=…, consecutive_quick_exits=…, reconnect_in=…s`（src-tauri/src/clipboard/watcher.rs、src-tauri/src/lib.rs）
- [x] 3.2 写回抑制窗口开始/结束补日志，带 `seq` 与截止时间戳 -- 证据：`clipboard/suppress.rs` `writeback suppress start: seq=…, now_ms=…, deadline_ms=…`；结束沿由首次过期判定补 `writeback suppress end: seq=…`
- [x] 3.3 `detected change` 同时打 raw 与 processed 指纹 -- 证据：watcher.rs `detected change, raw_hash=…, hash=…, ts=…`
- [x] 3.4 capture 失败 / emit 失败 / read error 恢复补日志 -- 证据：`capture failed: …, fingerprint uncommitted for retry`（带 hash 前 8 位）；`read error recovered after N errors`；`emit clipboard-changed failed`（原有，保留）
- [x] 3.5 `clipboard-changed` 的 `change_count` 改单调递增序号，同步前端类型 -- 证据：watcher.rs `CHANGE_SEQ: AtomicI64`，每 emit `fetch_add + 1`；前端 `ClipboardChangedEvent.changeCount` 注释同步（use-clipboard-list.ts）
- [ ] 3.6 用补完的日志复现 A/B 两类异常，把「待验证假设」逐条转为已验证或反证 -- 部分：机制级假设（U3/C3/C4/S5/U1）已由单测红→绿闭环证实（见 5.1/5.2）；实机运行期日志复核需应用装机后观察，本轮未跑实机，保持未勾

## 4. P1 缺陷修复（已实施，逐项可独立回滚）

- [x] 4.1 C3：指纹提交移到 capture 成功之后 -- 证据：watcher.rs `process_payload` 在 `sink.capture` Ok 分支才 `dedup::remember_fingerprint`；单测 `capture_failure_keeps_fingerprint_for_retry`（失败后下轮重试，共享指纹保持旧值）
- [x] 4.2 U3/U4：`WRITEBACK_SUPPRESS` 换截止时间戳 + 代际，去掉 spawn sleep 线程 -- 证据：`clipboard/suppress.rs`（AtomicI64 deadline 取 max + seq，无线程）；单测 `overlapping_windows_keep_later_deadline` / `later_short_window_cannot_shorten_active_one` / `realtime_overlap_stays_suppressed_until_max_deadline`
- [x] 4.3 C4：启动静默 priming -- 证据：watcher.rs `prime_fingerprint()`（只写共享指纹，不采集不 emit）；单测 `ten_startups_with_unchanged_content_yield_zero_detected`（10 次启动 detected/emit 增量 0）
- [x] 4.4 S1：`start_watch()` 退出后按退避重启 + 退出原因日志 -- 证据：watcher.rs `supervise_watcher` 指数退避（1s→60s 封顶，健康运行重置），quick_exit 连续 ≥5 次升级 error 日志
- [x] 4.5 S2/S3：暂停状态暴露 command + emit；统一采集判定 -- 证据：新增 `get_clipboard_listen_paused` / `set_clipboard_listen_paused` command（已注册 generate_handler）+ `listen-paused-changed` 事件；`capture_current_clipboard` 顶部统一判定（暂停 `CLIPBOARD_LISTEN_PAUSED` / 抑制 `CLIPBOARD_WRITEBACK_SUPPRESSED`）
- [x] 4.6 U1/U2：listener 序号去重 + in-flight 闸门；保留选中态 -- 证据：`src/clipboard/clipboard-event-gate.ts` + `use-clipboard-list.ts` `dispatchChangedEvent`；搜索视图刷新仅在选中项不在列表时回落首条（`selectedIdRef` 注入）；`scripts/verify-clipboard-listener.check.ts` 断言 50 事件风暴刷新次数 ≤2
- [x] 4.7 S5：open_panel 补采与 watcher 共享去重状态 -- 证据：`clipboard/dedup.rs` 进程级共享指纹；open_panel 补采、`capture_current_clipboard` 成功后均回写；watcher 比对同一状态

## 5. 验证与回归

- [x] 5.1 A 组复现（部分实机项未跑） -- A3 重叠抑制：修复前红证 `t=550ms 断言失败`（旧 `suppress_writeback_for` 在 base 提交 7c7af6c 上复现，测试输出已归档）+ 修复后绿证 `realtime_overlap_stays_suppressed_until_max_deadline`；A4 启动 10 次：`ten_startups_with_unchanged_content_yield_zero_detected` 增量 0。A1/A2/A5/A6 需实机（真实复制时序、watcher 故障注入、Windows 事件驱动），本轮未跑，如实记录未验证
- [x] 5.2 B 组复现 -- B1 同内容重复：`content_changes_map_one_to_one_to_captures`（X→Y→Y→X 恰 2 次 capture）；B2 风暴收敛：`verify-clipboard-listener.check.ts` 50 并发事件刷新 ≤2（旧行为每事件一次）；B3 面板 10 次不额外采集：open_panel 补采共享指纹短路（机制级；实机未跑）；B4 富文本/纯文本双来源：已知行为（缺口 3 裁决），未加断言
- [x] 5.3 日志/DB 门禁 -- detected↔recorded 一一对应：watcher 单测（capture Ok 才 recorded、失败重试不丢）；同 `content_hash` 重复组 0：DB UNIQUE 索引保障 + 取证基线为 0，行为未改；启动区间 detected 增量 0：A4 单测
- [ ] 5.4 功能回归矩阵（复制/粘贴/原格式/搜索/过滤/多选/回收站/收藏/软删复活/图片文件/敏感过滤）-- 需实机，本轮未跑，如实记录未验证
- [ ] 5.5 `pnpm test:perf-panel -- --sandbox --rounds 20` -- 需机器解锁 + CGEvent 权限，本轮未跑，如实记录未验证
- [ ] 5.6 双实例隔离实机复测 -- 需稳定版与沙箱并存运行，本轮未跑；`CLIPFORGE_DISABLE_CAPTURE` 判定逻辑未改动
- [x] 5.7 工程门禁 -- `cd src-tauri && cargo check` 0 error；`cargo test --lib` 56 passed / 1 ignored（新增 7 个可靠性测试全绿）；`pnpm test:unit` 全链含新 `verify-clipboard-listener.mjs` 通过（文件行数、边界、索引防腐 81 路径全过）；`openspec validate clipboard-listener-reliability --strict` 通过；Windows/Linux target 交叉编译未跑（本机缺 MSVC SDK，按 design 7.3 不作阻断）
- [x] 5.8 `pnpm build` -- 盟哥已于 RS-51 验收标准中确认执行；在隔离 worktree 跑通（产物仅写 worktree 本地 release/，不入库），结果见 PR 描述
- [x] 5.9 新增校验脚本同步索引 -- `docs/BUSINESS_INDEX.md` 新增「剪贴板监听事件闸门」验证行 + 引擎/列表行更新；`pnpm locate --check-index` 81 路径全过（含于 pnpm test:unit）

## 6. 收尾

- [x] 6.1 回填全部证据与量化结果 -- 本文件
- [x] 6.2 把 `proposal.md` 的「待验证假设」按实测结果更新 -- proposal.md 追加「2026-11-06 实施结果」小节：U3/C4/C3/S5/U1 机制级假设已证实并修复；A 类用户侧配对证据仍待实机日志（P0 日志已具备取证能力）
- [x] 6.3 向 `clipboard-data-integrity` 回写 C2 / D2 的日志证据与 B4 回归项（不改其裁决）-- 其 tasks.md 缺口 2 / 缺口 3 节追加 RS-51 证据注记
- [x] 6.4 记录未验证项 -- 见 5.4/5.5/5.6/5.7（Windows target）；取证盲区见 design.md 第 8 节（不变）
- [ ] 6.5 盟哥验收后按 openspec 流程归档
