# 提案：固定悬浮面板能力收敛与加固（pinned-floating-panel）

> 所属波次：W1 补位（核心剪贴板交互基线），见 [product-iteration-master-plan](../product-iteration-master-plan/proposal.md)。2026-11-05 归档整理后新建，方案待盟哥确认后放行；**不阻塞 W1 现有实机验收矩阵**。

## 状态

**新建 · 待方案确认**。本提案不是从零实现 pin 功能：`panelPinned` 设置、Rust `PANEL_PINNED`、失焦不隐藏、粘贴前跳过隐藏、原生 NSPanel 全屏覆盖、位置记忆均已落地。本提案要做的是把**已有但语义漂移的实现收敛成一条可靠能力**，补齐入口、文案、状态一致性和自动化验证。

> **实现状态（2026-11-20 对账登记）**：盟哥批准「先修面板不会自动消失的问题」，Phase 1 语义收敛代码切片已落地——1.1 `src/clipboard/use-panel-keyboard.ts` Esc 分支删除 `settingsRef.current.panelPinned` 门控、显式收起无条件发 `hide_quick_panel_command`；1.2 `src/clipboard/use-panel-blur-hide.ts` `hide-quick-panel` 事件改为无条件复位 UI 态，`settingsRef` prop 随之从 `usePanelWindowListeners`/`usePanelKeyboard` 签名与 `src/App.tsx` 调用点移除；2.1 `src/App.tsx` `togglePanelPinned` 改为「Rust 确认→前端提交」事务链（失败不改状态不写盘）；1.3 `src-tauri/src/lib.rs` 新增 `panel_visible_to_user`（含 `!is_panel_fading()`），`toggle_quick_panel` 与 `toggle_quick_panel_command` 收敛同一口径。门禁：`pnpm build`、`pnpm test:unit`（含 check:i18n/verify-file-size/locate --check-index）、`cargo check` 全绿；沙箱实机（`pnpm dev:sandbox`，`panelPinned=true`）注入 Escape 后 CGWindowList 确认 600x760 面板窗口消失——固定态 Esc 收起放行验证通过。**未做**：1.2/2.1 的失焦不隐藏回归与写盘失败回滚走查、Phase 2.2 写盘 command、Phase 3 文案、Phase 4 静态断言与探针扩展、Phase 5 全量验收；checkbox 按「实机/人工项不代勾」铁律全部留空，待盟哥走查后勾选。稳定版 `/Applications/ClipForge.app` 仍是旧构建，用户侧「Esc 收不起/失焦不隐藏」症状要到重新构建部署后才消除（本回合未部署，部署需盟哥确认）。

> **pin 非默认态审计与稳定版复位（2026-11-20 盟哥指出「pin 是需要触发的功能，不是默认的」**）：代码侧核查确认 pin 已是显式触发制——前端默认 `panelPinned: false`（`src/clipboard/panel-settings.ts:33`）、Rust `PANEL_PINNED: AtomicBool::new(false)`（`src-tauri/src/lib.rs:8468`），置 true 的唯一路径是显式触发（面板快捷菜单「固定到顶部」/⌘P 快捷键/贴图窗「固定显示」），无任何自动开启逻辑；启动灌回（lib.rs:6172-6181）只是恢复用户上一次显式选择。稳定版库里的 `panelPinned: true` 是 11-09 验证会话的测试残留（`settings.json5.bak-20261109-panelpin` 佐证），非代码默认。已在运行的稳定版上经 ⌘P 显式触发解除：Rust 日志 `[panel-pin] set pinned = false (stay-in-place)`，`settings.json5` 落盘 `panelPinned: false`（改前备份 `settings.json5.bak-20261120-unpin`），稳定版恢复「失焦自动消失 + Esc 收起」；用户贴图小窗未受影响。提案原「需取消 pin 才恢复」的提示自本登记起已失效（已取消）。

## Why

AGENTS.md 明确「系统托盘、全局快捷键和快速菜单是 Clipy 等价能力的一部分，优先级高于 AI/MCP」，固定悬浮面板属于「面板显隐」这条热路径。2026-11-05 代码核查发现，pin 目前是**双权威源 + 语义不一致**的半成品：Rust `PANEL_PINNED` 只在失焦隐藏一条路径被当权威源，Esc 与 `hide-quick-panel` 事件仍读前端 `settingsRef.current.panelPinned`；`hide_panel` 已移除一刀切拦截并提交，但前端 Esc 分支残留旧逻辑，导致**固定态下 Esc 收不起面板**，而全局快捷键 toggle 却能收起。这类「同一状态两个答案」的问题会直接污染 W1 关波的显隐验收，也会让 `pnpm test:perf-panel` 的 show/hide 结论失去可解释性。

同时，固定态是 Snipaste 式常驻工作流的前置能力；`.archive/nspanel-floating-panel`（非抢焦点 / 全屏覆盖）、`.archive/window-positioning`（Remember 归一化坐标）、`archive/2026-07-14-panel-interaction-upgrade`（pin 原始定义：仅标志位、保持位置、不移动面板）已经把技术前史铺好，**复用结论即可，不需要重做窗口层**。

## What Changes

1. **语义收敛**：pin 只抑制「自动隐藏」（失焦、外部点击、幻影 blur 自愈），显式收起（全局快捷键 toggle、Esc、`hide_quick_panel_command`、托盘 / 菜单收起）一律放行。
2. **单一权威源**：Rust `PANEL_PINNED` 为唯一判定源；前端 `settingsRef.current.panelPinned` 降级为展示态与设置持久化值，不再参与隐藏决策。
3. **状态可靠性**：`togglePanelPinned` 改为「Rust 确认 → 前端提交」的事务链，失败回滚且不写盘；`set_panel_pinned_command` 增加经 Settings Service 的写盘确认，消除重启后三方漂移。
4. **入口与文案**：菜单文案从「固定到顶部」改为准确的「固定面板 / 取消固定」，硬编码中文改走 i18n（复用已有孤儿 key），补齐托盘或状态可视反馈。
5. **验证固化**：新增 pin 静态断言 + 扩展 `pnpm test:perf-panel` 探针的 pin 场景；实机项与自动化项明确分界。

## 现状证据（已由代码证实，非推测）

| # | 问题 | 证据 |
| --- | --- | --- |
| A1 | 固定态下 Esc 收不起面板，与 toggle 行为不一致，且与 Rust「显式 hide 不应被拦」注释冲突 | `src/clipboard/use-panel-keyboard.ts:276-279` vs `src-tauri/src/lib.rs:8121-8123`、`settings_service/commands.rs:394-397` → `lib.rs:8185` |
| A2 | 双权威源：仅失焦隐藏查 Rust，Esc 与 `hide-quick-panel` 事件读前端 settingsRef | `use-panel-blur-hide.ts:77` / `:147` vs `use-panel-keyboard.ts:276`；`lib.rs:8284-8285` 注释本已声明收敛目标 |
| A3 | toggle 先改前端 state 再 fire-and-forget invoke，失败无回滚；错误态会被 220ms 防抖写盘并在重启时灌回 Rust | `src/App.tsx:817-823` + `use-settings-sync.ts:43-71` + `lib.rs:5900-5917` |
| A4 | `set_panel_pinned_command` 只改内存不写盘；Web mock 另用 localStorage，语义与真机不同 | `lib.rs:8273-8282`、`src/services/tauri-web-mock.ts:137-141` |
| A5 | 菜单文案「固定到顶部」实为窗口 pin；硬编码中文未走 i18n | `src/clipboard/components/QuickCommandMenu.tsx:61-65` |
| A6 | 一批 pin i18n key 全库无引用（孤儿文案） | `src/i18n/locales/zh-CN.json:142-144,311-313,328`（en-US 同号） |
| A7 | 行级「固定到顶部」占位与窗口 pin 同名混淆；后端 `clips.pinned` 已实现、UI 仍是 toast placeholder | `QuickPastePanel.tsx:18`、`ClipboardRowActions.tsx:20-21,72-78`、`lib.rs:4712` |
| A8 | `toggle_quick_panel_command` 可见性判断不含 `!is_panel_fading()`，与 `toggle_quick_panel` 口径不一致（淡出在途 110ms 会误判） | `lib.rs:3444` vs `:8162` |
| A9 | 宽限窗两套值：唤起 400ms（App.tsx:380）与幻影 blur 自愈 600ms（blur-hide.ts:45） | 见对应文件 |

> **更正一条过期记录**：`docs/PROPOSAL_ROADMAP.md` 曾记「工作区 `lib.rs` pin 语义修复待提交」。2026-11-05 核实 `lib.rs` 与 HEAD 一致，一刀切拦截已在 `2258b51` 移除并提交；残留只在前端 Esc 分支（A1）。该行已在 ROADMAP 更正。

## 目标

- 固定态下：失焦 / 点击面板外 / 幻影 blur 不隐藏；全局快捷键 toggle、Esc、显式 hide 命令都能收起；收起后位置按现有 `save_panel_position` 记忆。
- 固定状态在前端、Rust、设置文件三者间一致；切换失败不产生脏状态，应用重启后状态可恢复。
- 固定能力有准确文案、可发现入口、可观测状态，且不新增热路径 IPC。
- 固定态不改变 show/hide ≤180ms 的性能基线；`pnpm test:perf-panel` 的既有四项探针不回退。

## 非目标

- **不做条目置顶**（`clips.pinned` / `QuickPastePanel.tsx` 的 pinPlaceholder）——那是另一个功能域，本提案只澄清命名，不实现。
- **不扩展到贴图窗**：`snipaste-parity` 的 `paster/` 窗口池有独立生命周期与置顶/穿透语义，本提案不碰 `paster/`、`screenshot/`，不改其热键表。
- **不重做窗口层**：不改 NSPanel 属性 / level / `can_join_all_spaces` / `fullScreenAuxiliary`，不改 Windows/Linux 分支，不改定位策略、防抖与 Remember 存储格式。
- **不新增 MCP / L3 或 pi 侧 L2 工具**（因此不触发 AGENTS.md 的同源实现计数登记）；不做设置页新分区、不引入新运行时或状态管理库。
- **不把 paste 路径行为重写**：`lib.rs:5481/5538/5583` 三处 pin 拦截（跳过等待焦点释放、跳过粘贴前隐藏）保留，只在实机验证中确认目标焦点是否正确，如有问题单列修复项。

## Capabilities

### Added Capabilities

- `panel-pin`：固定悬浮面板的状态语义、权威源、显式收起、切换可靠性、文案与验证契约。

### Modified Capabilities

无。既有 `panel-list-performance`、`settings-service` 等 capability 不改动；本提案只消费其既有接口。

## Impact

- 前端：`src/clipboard/use-panel-keyboard.ts`、`use-panel-blur-hide.ts`、`components/QuickCommandMenu.tsx`、`src/App.tsx`、`src/clipboard/panel-settings.ts`、`src/i18n/locales/*.json`。
- Rust：`src-tauri/src/lib.rs`（`set_panel_pinned_command` / `toggle_quick_panel_command` 可见性口径）、可能与 `settings_service/` 的写盘链对接；新增 command 域文件须 ≤500 行并带中文文档注释。
- 脚本：新增 pin 静态断言（挂 `pnpm test:unit`）、扩展 `scripts/perf-panel-probe.py` 的 pin 场景；按 AGENTS.md「索引维护义务」同步 `docs/BUSINESS_INDEX.md`。
- 数据：`panelPinned` 是既有设置键，不改 schema；不新增表、不新增迁移。

## 验证策略

| 层 | 手段 | 判据 |
| --- | --- | --- |
| 静态断言（本机可跑） | `pnpm test:unit` 新增 pin 断言 | `hide_panel` 不含 pin 拦截；Esc 分支不读 `settingsRef.current.panelPinned`；toggle 两处可见性口径一致；i18n key 引用计数 + 硬编码中文扫描 |
| 编译门禁 | `pnpm build`、`cd src-tauri && cargo check`、`pnpm test:boundaries`、`pnpm check:i18n` | 全绿；`pnpm locate --check-index` 通过 |
| 自动探针 | `pnpm test:perf-panel` / `-- --sandbox` | show/hide ≤180ms、幻影 blur 自愈、动画可打断、透明鬼影四项不回退；新增「pin 态 toggle/Esc 可收起」与「pin 态失焦不隐藏」两场景 |
| 实机（`pnpm dev:sandbox`） | 焦点、观感、位置记忆、跨窗口 settings 同步 | 需机器解锁；CGEvent 注入在锁屏/息屏必然超时，跑前确认解锁 |
| 人工 | 盟哥走查 | 固定态下复制 / 粘贴目标焦点是否正确、点击面板外是否不隐藏、状态反馈是否可理解 |

按 AGENTS.md，本机无法完成的验证必须在交付说明中显式写出未验证项，不得用静态断言或 skip 样本冒充实机证据。

## 风险与对策

- **热路径回归**：新增 Rust 权威查询若在失焦链路里再加一次 IPC，会拉长 hide 延迟 → 复用已有 `is_panel_pinned_command`，不新增调用；把判定结果缓存进既有事件，不引入轮询。
- **粘贴目标焦点**：pin 态跳过「粘贴前隐藏」可能让 Cmd+V 打到面板自身 → 不先改代码，列实机验证项；确认有问题再单独切片。
- **设置写入与 redaction**：pin 写盘必须走既有 Settings Service 事务（带 revision），不新建旁路写；避免与 `settings_changed` 事件产生回环。
- **探针锁屏假失败**：`scripts/perf-panel-probe.py` 锁屏返回码 3，属环境而非回归；记录为未验证项，不重试凑数。
- **与 W1 关波争资源**：本提案以 W1 补位排队，不占用实机走查窗口；W1 七提案验收优先。

## 成功标准

- 固定态下四类显式收起全部可用、三类自动隐藏全部被抑制，且与 Rust 权威源一致；切换失败可回滚、重启可恢复。
- 静态断言 + 编译门禁 + 扩展探针全绿；`pnpm test:perf-panel` 原有四项不回退。
- 菜单文案、i18n、状态反馈无歧义；`docs/BUSINESS_INDEX.md` 与 `docs/PROPOSAL_ROADMAP.md` 已同步。
- 实机 / 人工未验证项如实列在交付说明，不代勾。
