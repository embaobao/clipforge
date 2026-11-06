# 任务：提示词优化快捷工具（prompt-optimizer-quickflow）

> 2026-11-06 新建（RS-53 第一阶段产出）。按 `docs/PROPOSAL_ROADMAP.md`「同步规则」：GUI / Tauri dev / 实机 / 人工验收项不得代勾，须由盟哥走查确认后逐项勾选。TDD：每个 Phase 的红测先于对应实现提交。

## Phase 1 红测先行（编排与出口纯函数）

- [ ] 1.1 新建 `src/prompt-optimizer/` 域目录与 `optimize-flow.ts` 状态机纯函数（idle→capturing→optimizing→diff→writing / error / empty / unconfigured / no-change），先写 T1-T4 红测：空剪贴板、provider 缺位、优化抛错、无差异、正常出 diff、通道标注。
- [ ] 1.2 通道解析纯函数红测：`promptOptimizerProviderId` 命中 / 失效回退默认 / 为空走默认（本地优先策略，design §4）。
- [ ] 1.3 出口动作纯函数红测：copy-back 产出 `copyText(text, "prompt-optimizer", …)` 调用描述；save-snippet 产出 capture + `update_clip_record(bucket="snippet")` 描述；不接触真剪贴板。

## Phase 2 快捷键与唤起（Rust + 路由）

- [ ] 2.1 `settings-model.ts` / `settings_service` 校验白名单加 `promptOptimizerShortcut`（默认 `CommandOrControl+Shift+P`，空=关闭）与 `promptOptimizerProviderId`（空=跟随默认），走既有 Settings Service 事务。
- [ ] 2.2 `settings_service/commands.rs`：`registered_global_shortcuts()` 纳入新键（normalize + 与主键去重，同值保主键），handler 命中后 show main + emit `prompt-optimizer-quickflow`；T6 红测先行（去重逻辑抽纯函数，`cargo test --lib`）。
- [ ] 2.3 `workspace-router.tsx` 加 `/optimizer` 路由 + 前端监听事件切路由；Esc 返回列表路由（不隐藏面板），T5 静态断言先行。

## Phase 3 优化视图与自动优化（前端）

- [ ] 3.1 `QuickOptimizerView.tsx`：原文区（最新文本条目快照，优化期间锁定）、运行态、diff 结果区（复用/同形 `draft-diff`）、错误条 + 重试。
- [ ] 3.2 `use-quick-optimize.ts`：路由进入自动触发；单飞去重；本地 baseUrl 通道先 `agent_check_provider` 探测（超时回退默认通道并标注）。
- [ ] 3.3 i18n：`zh-CN` / `en-US` 新 key 双语齐备，`pnpm check:i18n` 零新增问题。

## Phase 4 出口动作（回写 / 片段）

- [ ] 4.1 「回写剪贴板」接 `copyText`（唯一写出口，RS-51 抑制链复用）；完成后 toast + 状态反馈。
- [ ] 4.2 「保存为片段」：显式入库 + `update_clip_record(bucket="snippet")`。
- [ ] 4.3 T5 静态断言脚本（挂 `pnpm test:unit`）：`src/prompt-optimizer/` 无 `navigator.clipboard` / 直调 `write_clipboard_item`；默认快捷键 ≠ 主键/legacy；回写后无重复条目断言。

## Phase 5 设置页通道控件

- [ ] 5.1 Agent 分区加「提示词优化通道」Select（`agentProviders` 选项 + 「跟随默认」）与快捷键录入（复用既有 shortcut 控件）；不加新配置面板。

## Phase 6 门禁、实机与收口

- [ ] 6.1 自动门禁全绿：`pnpm test:unit`、`pnpm build:web`、`cd src-tauri && cargo check`、`cargo test --lib`、`pnpm check:i18n`、`pnpm locate --check-index`、`openspec validate prompt-optimizer-quickflow --strict`；新增文件 ≤500 行、公共导出中文注释。
- [ ] 6.2 沙箱实机（`pnpm dev:sandbox`，需机器解锁）：复制→快捷键→diff→回写全链走查；回写后列表无重复条目；本地端点停机回退走查；`pnpm test:perf-panel -- --sandbox` 唤起 ≤180ms 不回退；结果延迟实测（本地/云端 p50）记录进交付说明。
- [ ] 6.3 盟哥人工验收：快捷键手感与第三方全局键冲突实测、diff 可读性、错误反馈；锁屏/息屏等无法完成的项在交付说明显式记录，不代勾。
- [ ] 6.4 收口同步：`docs/BUSINESS_INDEX.md` 新增「提示词快捷优化」行 + 验证速查；`docs/PROPOSAL_ROADMAP.md` active 表登记实数（该文件 TASK-8 未提交改动落地后操作，避免冲突）；验收后按归档判据处理。
