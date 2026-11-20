# 任务：固定悬浮面板能力收敛与加固

> 2026-11-05 新建，W1 补位。全部留空，按 `docs/PROPOSAL_ROADMAP.md`「同步规则」：GUI / Tauri dev / 实机 / 人工验收项不得代勾，须由盟哥走查确认后逐项勾选。

## Phase 1 语义收敛（前端）

- [ ] 1.1 去掉 `use-panel-keyboard.ts` Esc 分支的 `settingsRef.current.panelPinned` 判据，固定态下无条件发 `hide_quick_panel_command`；核对 effect deps 不变，其余键位路由不触碰。
- [ ] 1.2 `use-panel-blur-hide.ts` 的 `hide-quick-panel` 事件改为无条件复位 UI 态（不二次触发 hide）；失焦链路仍以 `is_panel_pinned_command` 为唯一权威查询，60ms 延迟与原生淡出参数不动。
- [ ] 1.3 `toggle_quick_panel_command`（`lib.rs:3444`）可见性判断补 `!is_panel_fading()`，与 `toggle_quick_panel`（`:8162`）收敛到同一判定函数；两处加中文文档注释说明口径。

## Phase 2 权威源与状态可靠性

- [ ] 2.1 `App.tsx` 的 `togglePanelPinned` 改为事务链：await `set_panel_pinned_command` → 成功后才 `setSettings`，失败保持旧值 + toast + `logAppError`；不新增全局 store，220ms 防抖写盘链不变。
- [ ] 2.2 `set_panel_pinned_command` 增加经 Settings Service 的写盘与 revision 校验，返回 `{ pinned, revision }`；写盘失败则不更新 `PANEL_PINNED`，启动恢复链（`lib.rs:5900-5917`）保留为兜底；Web mock 同步改为同一事务语义。

## Phase 3 入口、文案与去歧义

- [ ] 3.1 `QuickCommandMenu.tsx` 文案改为「固定面板 / 取消固定」，硬编码中文改走 i18n；复用 `main.aria.pinPanel` / `unpinPanel` / `main.pin.title` 等已有 key，补齐 en-US 与孤儿 key 清理，`pnpm check:i18n` 与硬编码扫描零新增。
- [ ] 3.2 `QuickPastePanel.tsx:18` 的 placeholder 文案改为「条目置顶功能开发中」，与窗口 pin 去歧义；核对托盘 / 状态栏是否需要固定态可视反馈（需要则只加展示，不加新交互）。**不实现 `clips.pinned` 条目置顶**。

## Phase 4 门禁与探针

- [ ] 4.1 新增 `scripts/verify-panel-pin.mjs` 六条静态断言（hide_panel 无 pin 拦截 / Esc 不读前端 pin / 前端复位不读前端 pin / 两处可见性口径一致 / i18n 引用与硬编码 / 返回含 revision），零依赖、失败退出码 1，挂入 `pnpm test:unit`；同步 `docs/BUSINESS_INDEX.md`「验证速查」与「面板显隐」行。
- [ ] 4.2 扩展 `scripts/perf-panel-probe.py`：新增「pin 态失焦不隐藏」「pin 态 toggle/Esc 可收起」两场景，进入前保存并退出后还原 `panelPinned`；区分 `phantom_ok` 在 pin 态下的假阳性；既有四项阈值与锁屏退出码 3 语义不变。

## Phase 5 验证与收口

- [ ] 5.1 自动门禁：`pnpm build`、`cd src-tauri && cargo check`、`pnpm test:unit`（含 check:i18n / verify-file-size / `locate --check-index` / 新增 pin 断言）、`pnpm test:boundaries`、`openspec validate pinned-floating-panel --strict` 全绿；新增源文件 ≤500 行且带中文文档注释。
- [ ] 5.2 沙箱实机（`pnpm dev:sandbox`，需机器解锁）：按 design.md §10 验证矩阵走查失焦不隐藏、toggle/Esc 收起、写盘失败回滚、重启恢复、粘贴目标焦点；`pnpm test:perf-panel -- --sandbox` 复跑四项基线 + 两个 pin 场景，show/hide ≤180ms 不回退。
- [ ] 5.3 盟哥人工验收 + 交付说明：固定态观感、状态反馈可理解性、复制粘贴焦点正确性逐项确认；锁屏 / 息屏导致的探针超时、任何本机无法完成的验证项必须在交付说明中显式写出未验证项，不得用静态断言或 skip 样本冒充实机证据。
- [ ] 5.4 验收通过后同步 `docs/PROPOSAL_ROADMAP.md` active 表实数与 `openspec/project.md` 状态，按 C1/C2 判据走 `openspec archive` 归档；归档时同步 spec delta 到 `openspec/specs/panel-pin/spec.md`，并复核 19 个 active proposal 的波次链接不受影响。
