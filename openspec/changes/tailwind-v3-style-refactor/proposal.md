# 提案：ClipForge 全面迁移 Tailwind CSS v3 + shadcn/ui 视觉重构

> 所属波次:见 [product-iteration-master-plan](../product-iteration-master-plan/proposal.md)。

## 优先级

P1。产品主线回归「打造好一个剪贴板」后，视觉层是从「能用」到「好用、好看、愿意日常用」的关键一步。本提案已完成主体实现（2026-09-07 夜间批次 1–5），当前处于收尾验收阶段。

## 背景

2026-09 早期计划是「契约 v2 八件交付物」（`tokens.css` 单源、`App.css` 冻结、Tailwind 仅限 shadcn 组件层、零 DOM 改动）。该契约已被用户决策**取代**：按 `docs/Kimi_Agent_设计系统草图.zip` 设计稿，将 ClipForge 全量迁移到 Tailwind CSS v3 + shadcn/ui（new-york / zinc / CSS variables），视觉契约固化为 `docs/DESIGN_SYSTEM.md`。

旧 CSS 架构的问题：

- `App.css`（4000+ 行）、`settings.css`、`theme/tokens.css`、`*.module.css` 多源并存，token 重复定义，无单一样式真相。
- 主面板 `App.tsx`、workspace `workspace-panels.tsx`（1831 行）等巨石文件同时承载逻辑与标记，无法按域协作。
- 跨平台中性工具风格（克制、轻量、黑白对比）在旧 CSS 下难以一致维护。

## 目标

1. 全局样式收敛为唯一的 `src/index.css`（语义 token + 少量工具类），删除全部组件级 CSS 文件，禁止恢复。
2. 所有 surface（主面板 / 设置 / 详情 / 聚合 / onboarding / DSH）使用 Tailwind 语义类（`bg-background` / `text-muted-foreground` 等映射 `hsl(var(--token))`）。
3. 界面按域拆组件：单文件 ≤500 行，公共能力中文注释，`data-surface` marker 保持不变。
4. 行为零回归：键盘导航、复制/粘贴链路、探针（`data-dev-probe`）、verify 脚本断言语义全部保留。

## 非目标

- 不重排核心工作流（信息结构、控件尺寸保持稳定，样式优化不借机重排布局）。
- 不自研设计系统库；shadcn/ui 组件按需引入，vendored 的 animate-ui 组件不改内部实现（已知 4 个 `ease-[...]` Tailwind 歧义警告无害，暂不处理）。
- 不新增 openspec spec delta：业务行为未变，视觉契约以 `docs/DESIGN_SYSTEM.md` 为准。

## 现状（2026-09-07 夜间批次 1–5 已落地）

| 批次 | 内容 | 提交 |
|---|---|---|
| 批次 1 | 基础设施 / 主面板 / 设置窗口 / 旧 CSS 删除（8 个文件）/ 文档对账 + verify-settings-surface 断言修复 | `e82cf95`…`4acc234` |
| 批次 2 | 详情页拆分：`ClipDetailWorkspace`（498 行外壳）+ 6 个子组件 | `986bf09`、`2e06530` |
| 批次 3 | 聚合页拆分（`MultiAggregateWorkspace` + `AggregateItem`，panels 缩为 re-export）+ onboarding 向导拆分（422 行旧类 → 4 个文件） | `d7fb9a5`、`5890d76` |
| 批次 4 | deepseek tasks.md 对账 + AGENTS.md 样式章节对齐 Tailwind 现实 | `a4d519b`、`8674df9` |
| 批次 5 | 全量回归自动化部分全绿 + `pnpm tauri dev` 后台冒烟通过 | `a4b923c`、`c10f7df` |

file-size 豁免清单从 7 项降至 4 项（`workspace-panels.tsx` 已拆完移出）。

## 风险与对策

- **重写样式的视觉正确性未经人眼确认**：机器验证全绿但三个 surface（详情/聚合/onboarding）的 Tailwind 类是按设计契约重写的，必须由盟哥 `pnpm tauri dev` 视觉走查（见 tasks.md Phase 5）。
- **verify 脚本断言与结构耦合**：拆分时 4 个脚本（editor-agent-bridge / runtime-boundaries / surface-boundaries / settings-surface）读取路径已随迁、断言语义不变；后续再拆文件需同步检查。
- **第三方组件样式告警**：vendored `message-scroller` / `animate-ui sidebar` 的任意值类触发 Tailwind v3 歧义警告，CSS 正常生成，不在本提案范围内修改。

## 成功标准

- `pnpm build:web` / `pnpm test:unit` / `pnpm test:boundaries` / `cargo check` 全绿（已达成）。
- 仓库内不再存在组件级 CSS 文件与 `onboarding-*`/`detail-*`/`aggregate-*` 等无主样式类（已达成）。
- 盟哥视觉走查通过，走查发现的问题清零（待完成）。
- 走查通过后本提案归档。
