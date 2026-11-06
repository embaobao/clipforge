# Tasks: plugin-foundation-phase1

> 状态：**提案已交付，待盟哥确认后实施（RS-54）**。基线：`rs-51-clipboard-listener-reliability`（PR #1）合并后的 main。
> 证据栏填命令输出 / 测试名 / 日志时间戳；未跑项保持 `[ ]` 并写明原因，禁止写「应该没问题」。
> 实施纪律：独立 worktree + 新分支；只 stage 本任务文件；`lib.rs` 按 hunk 隔离；先红测后实现（TDD）；新增文件 ≤500 行 + 中文注释。

## 1. 提案交付（本阶段）

- [x] 1.1 建立 `openspec/changes/plugin-foundation-phase1/` 四件套 -- 证据：本目录
- [x] 1.2 `openspec validate plugin-foundation-phase1 --strict` -- 证据：见实施前验证记录（本阶段跑通）
- [x] 1.3 向盟哥提交大白话摘要 + 决策点（六态迁移表 / 五类扩展点词汇对齐 / dogfood 范围）-- 证据：RS-54 issue 评论
- [ ] 1.4 取得盟哥「进入实施」确认 -- 提案阶段产物，待确认

## 2. 监听状态机（clipboard/listen_state.rs）

- [ ] 2.1 红测：迁移矩阵 T1-T14 + 组合语义（design §3.2，含 Reconnecting 退避期补记边界）全部先失败 -- 证据：测试名清单与首次失败输出
- [ ] 2.2 红测：`can_capture(Manual)` 与旧拼判 paused×suppressed 4 例严格等价；Background 对 alive/disabled 声明性覆盖 -- 证据：等价矩阵测试
- [ ] 2.3 实现 `ListenFacts` / `derive_phase` / `can_capture(CapturePath)` / `CaptureGate`（既有两错误码不变、不新增错误码；Manual 不拦 watcher 死亡/环境禁用）-- 证据：cargo test 绿
- [ ] 2.4 迁移日志（`listen state: seq=…, from=…, to=…, reason=…`，context=clipboard-listen-state）+ 自环（quick-exit）记录 -- 证据：单测断言日志序列
- [ ] 2.5 `LISTEN_PAUSED` / `set_listen_paused` / 两个暂停 command 迁入 listen_state.rs，`generate_handler` 改引用 -- 证据：lib.rs hunk + cargo check
- [ ] 2.6 三处调用方切换 `can_capture()`：watcher `process_current_clipboard`、`capture_current_clipboard`、open_panel 补采段（提取 `capture_before_panel_open`）-- 证据：等价矩阵测试 + grep 无旧拼判残留
- [ ] 2.7 suppress.rs 补事实读取口（deadline/seq），窗口开启/结束沿触发 recompute；dedup 不动 -- 证据：窗口迁移测试（T4/T5）

## 3. 统一时钟注入

- [ ] 3.1 `Clock` trait + `SystemClock` + 测试 `ManualClock`（进程级注入，`TEST_STATE_LOCK` 串行纪律）-- 证据：类型与注入测试
- [ ] 3.2 监听状态域全部时间读取（截止判定 / recompute / 事件时间戳）走注入时钟；`now_millis()` 其余调用点不动 -- 证据：grep 取证
- [ ] 3.3 `realtime_overlap_stays_suppressed_until_max_deadline` 迁 ManualClock 推演（断言语义不变），套件耗时 <100ms -- 证据：`cargo test --lib` 计时输出

## 4. typed 事件总线（src-tauri/src/events.rs）

- [ ] 4.1 红测：五类事件交替 emit，bus `seq` 跨类型严格单调；`changeCount == seq`；`EventSpec.reserved` 冲突自检 -- 证据：events 测试
- [ ] 4.2 实现 `EventSpec` / `EVENT_REGISTRY`（五条）/ `emit_domain_event`（additive 注入 `seq`/`kind`/`emittedAtMs`）-- 证据：cargo test 绿
- [ ] 4.3 五个发射点切换：watcher `AppCaptureSink`、`set_listen_paused`、新增 `listen-state-changed`、agent/events.rs 两处（`ClipboardChangePayload` 迁 events.rs）-- 证据：grep 无裸 `.emit(` 域事件残留（clipforge://* 除外，清单见 design §5.3）
- [ ] 4.4 前端类型同步（`ClipboardChangedEvent` 注释、`ListenPausedPayload`/agent 载荷 `seq` 字段），逻辑零改 -- 证据：`pnpm test:unit`（含 50 事件风暴闸门）通过

## 5. 服务注册表雏形（src-tauri/src/service_registry.rs）

- [ ] 5.1 红测：契约测试模板四步（`validate` 拒非法 → `register` 成功 → `introspect` 可见且 capabilities 保留 → 句柄 Drop 消失）；五类内置 KindDef 清单稳定 -- 证据：registry 测试
- [ ] 5.2 实现 `ServiceKindDef`（开放类别注册 `declare_kind`）/ `ServiceDef`（含 `capabilities`）/ `validate` / `register` / `list` / `introspect`（快照只读；KindDef 契约注释对齐 EXTENSION_MODEL 词汇表）-- 证据：cargo test 绿
- [ ] 5.3 dogfood A：内置采集源 `capture.clipboard.poll` 随 watcher init 注册（Disabled 不注册；capabilities 声明轮询周期/支持格式），注册/注销日志 -- 证据：契约模板测试 + 日志
- [ ] 5.4 dogfood B：内建粘贴动作只读清单注册（源自 `src/plugin-actions.ts` builtin 档动作清单；MCP 暴露口 `clipboard.plugin.list/call` 为 mcp/specs.rs 既有工具，不动）-- 证据：`introspect()` 快照测试
- [ ] 5.5 McpTool adapter 签名记录 + 只读清单挂接（`list(mcp-tool)` 数 = 41，capabilities 带 `host-specs` 来源标记；不改 mcp/mod.rs 路由 / golden / dispatch / seams 计数）-- 证据：adapter 测试
- [ ] 5.6 红线测试：listen_state/events/service_registry 不得 import cordis（grep 断言挂 test:unit）-- 证据：verify 脚本输出
- [ ] 5.7 红测+实现 additive command `list_services`（返回 `introspect()` JSON；能力面单一事实源，供设置页/RS-55~57/powerpack.scaffold 消费）-- 证据：command 契约测试 + generate_handler 注册

## 6. lib.rs 拆分与索引

- [ ] 6.1 按 design §7.1 清单迁移（仅采集/暂停/事件段），lib.rs 净减 ≥100 行（含声明/引用增行净口径）且只减不增 -- 证据：`git diff --stat` + 行数对比
- [ ] 6.2 「不拆」清单复核（design §7.2：零拆分迁移，仅允许 Impact 声明的最小调用点改动）-- 证据：`git diff --name-only` 对账
- [ ] 6.3 新增文件全部 ≤500 行 + 公共能力中文注释；`verify-file-size` fail=0 -- 证据：脚本输出
- [ ] 6.4 `docs/BUSINESS_INDEX.md` 新增三模块行；`pnpm locate --check-index` 通过 -- 证据：test:unit 输出

## 7. 验证与回归

- [ ] 7.1 RS-51 七项可靠性测试全绿（位置允许迁移，断言语义不得删改）-- 证据：测试名 + 结果
- [ ] 7.2 `cd src-tauri && cargo check` 0 error -- 证据：输出
- [ ] 7.3 `cargo test --lib` ≥56 passed / 0 failed -- 证据：输出
- [ ] 7.4 `pnpm test:unit` 全链通过 -- 证据：输出
- [ ] 7.5 `pnpm build` 通过 -- 证据：输出
- [ ] 7.6 `openspec validate plugin-foundation-phase1 --strict` -- 证据：输出
- [ ] 7.7 实机冒烟（`pnpm dev:sandbox`）：面板显示监听状态事件流、暂停/恢复、复制/粘贴不回环 -- 需实机，未跑则如实记录

## 8. 收尾

- [ ] 8.1 回填全部证据与本文件状态；proposal.md 状态改「已实施」
- [ ] 8.2 PR 提交（一 issue 一 PR，基线=PR #1 合并后 main，描述注明领先提交数事实），链接回 RS-54
- [ ] 8.3 向 RS-55/56/57（父 issue RS-52）发契约定稿通知：五类扩展点 kind + 注册表接口可消费
- [ ] 8.4 盟哥验收后按 openspec 流程归档
