# ClipForge 项目说明

## 目标

建设一个跨平台剪贴板工具，第一阶段完整覆盖 Clipy 的剪贴板历史、复制回写、片段、文件夹和快速唤起；后续再提供搜索增强、归档、语义检索和 MCP 工具接口。

## 当前范围

- Tauri v2 + React + TypeScript 应用骨架
- 原生文本剪贴板读取与写入
- 快速粘贴主入口
- 即时搜索
- 历史、归档、片段视图
- 收藏、复制、归档、删除、全选当前结果删除
- 后续 MCP 标准工具接口
- 图片、文件、富文本剪贴板历史（已立项，见 [file-image-clipboard-support](./changes/file-image-clipboard-support/proposal.md)）

## 非目标

- 第一阶段优先实现 Clipy 等价能力，但快速菜单可以先用窗口内面板模拟，后续再接原生菜单/托盘。
- 不在第一阶段实现系统级粘贴模拟；复制回系统剪贴板优先，粘贴由用户或后续快捷键模块触发。
- 不在第一阶段接入远程云同步。

## 架构原则

- 快速菜单负责高频粘贴，窗口负责搜索和整理，托盘和快捷键负责唤起。
- 原生能力收敛在 Rust command 层，前端通过稳定命令调用。
- 数据层先保持轻量，后续以 SQLite 和本地向量索引替换 localStorage。
- MCP 作为标准工具接口暴露，不和 UI 状态强耦合。
- 前端 UI 按业务 surface 组织（clipboard / settings / workspace / agent / status），每个 surface 根节点带 `data-surface` 身份 marker，新增样式按 surface 归档，不再向 `src/App.css` 追加全局覆盖（由 `scripts/verify-surface-boundaries.mjs` 守护，见 [frontend-surface-architecture-refactor](./changes/frontend-surface-architecture-refactor/design.md)）。

## 活跃提案

> 2026-11-05 归档整理（2026-11-09 实数刷新）:推进顺序与波次归位仍由 [product-iteration-master-plan](./changes/product-iteration-master-plan/proposal.md) 单点解释;下表按「归档就绪度」分组,实数以 `openspec list` 为准。归档整理时点为 24 个存量 active + 本次新建 `pinned-floating-panel` 1 个 = 25 个；其后 11-05 傍晚与 11-09 新建 `clipboard-listener-reliability`、`focus-prefetch-idle-removal`、`remove-dead-snippet-tab` 三个提案,**当前 active 实数 28 个**。完整实数表与归档分类台账见 [PROPOSAL_ROADMAP](../docs/PROPOSAL_ROADMAP.md),本文件不维护第二套进度表。旧 AI 侧车三提案已归档,不再列入。

| 类别 | 判据 | 数量 | 处置 |
|------|------|------|------|
| S1 常驻治理（豁免归档） | tasks 全绿，但被 24 处相对链接引用，是五波次单一事实源 | 1 | 永久 active，禁止 `openspec archive`；头部已声明豁免 |
| S2 待验收闭环 | 编码主体已落地，剩余项全是实机矩阵 / 盟哥走查 / 正式 .app 验证 | 10 | 留 active 不归档；验收确认后随 W1 关波批量归档 |
| S3 待决策 / 待放行 / 未开工 | 待用户放行、W4 统一取舍、触发条件未满足，或仍在编码（含 `pinned-floating-panel` 及 11-05/11-09 三次对账后新建的 `clipboard-listener-reliability`、`focus-prefetch-idle-removal`、`remove-dead-snippet-tab`） | 15 | 留 active，不进近期队列 |
| S4 休眠评估稿 | `openspec list` 显示 No tasks，按提案信号表 / 判据触发 | 2 | 留 active，不计入实现队列 |

**归档铁律**：`openspec list` 未标记 ✓ Complete 的 change 一律不归档；GUI / Tauri dev / 外部文档 / 人工验收项不得代勾（依据 PROPOSAL_ROADMAP「同步规则」）。本次归档整理**没有移动任何 active 提案目录**，只做分类、登记与过期状态更正。

旧表（2026-10-01）里的 `panel-list-perf`、`interaction-animation-polish`、`frontend-surface-architecture-refactor` 等已归档件不再列入 active；`interaction-animation-polish` 实际归档于 `archive/2026-10-08-interaction-animation-polish/`，此前「已完成待归档」为过期记录，已更正。

## 常驻治理文档（豁免归档）

`product-iteration-master-plan` 的 7/7 tasks 已完成、`openspec list` 显示 ✓ Complete，是本次唯一「完成」的 change，但**不归档**。理由：① 它是五波次推进顺序的单一事实源，被 19 个 active proposal + 4 份索引 + 1 个已归档 proposal 共 24 条相对链接引用，归档会静默断链；② 归档后脱离 `openspec list` 对账口径，与「进度以实数为准」冲突；③ 若用 `--skip-specs`，其 `product-iteration-governance` delta 的 4 条 Requirement 不会进入 `openspec/specs/`，治理规约失去校验覆盖。后续 W1 关波批量归档时跳过该目录。

## 已归档提案

以下 change 已归档，后续只看归档 spec 或 archive 记录，不再当作 active backlog。2026-11-05 归档整理建立四类分类（完成归档 / 收口归档 / 吸收重构归档 / 废弃调研归档）与早期档案登记，完整台账见 [PROPOSAL_ROADMAP](../docs/PROPOSAL_ROADMAP.md)「归档分类台账」节；本清单只保留历史决策记录，不重复维护分类。

- `github-release-update-distribution`
- `settings-field-refactor`
- `search-filter-tags-filetypes`
- `content-smart-format-decoder`
- `panel-interaction-upgrade`
- `context-plugin-agent-runtime`
- `remotion-animation-workbench`
- `2026-07-16-app-internationalization-en-support` — 归档时 38/38（全完成）；国际化与英文支持，spec 并入 `specs/internationalization`
- `2026-07-16-settings-service-unified-protocol` — 归档时 77/79；统一 Settings Service，spec 并入 `specs/settings-service`；剩余 2 项（主面板性能 smoke P95、主面板回归）移出 backlog
- `2026-07-16-settings-interface-redesign` — 归档时 50/52；设置页信息架构重写，spec 并入 `specs/settings-ui`；剩余 2 项（Context7 拉 Radix Sidebar / Code Tabs 文档、硬编码文案白名单 208 候选）移出 backlog
- `2026-07-16-onboarding-to-settings-proposal` — 归档时 41/44；引导迁设置窗，spec 并入 `specs/onboarding`；剩余 3 项（系统权限授权、重启门禁、主面板历史/搜索/复制实机验证）移出 backlog
- `2026-07-16-top-nav-optimization` — 归档时 28/30；顶部工具栏，spec 并入 `specs/panel-navigation`；剩余 2 项（窗口拖拽、搜索/按钮点击不触发拖拽系统级证据）移出 backlog
- `2026-07-16-clipboard-agent-panel` — 归档时 169/170；面板内 Agent 工作页，spec 并入 `specs/agent-panel`；剩余 1 项（真实 OpenAI-compatible provider 标准消息流验证）移出 backlog
- `2026-07-16-detail-rich-editor-agent-bridge` — 归档时 77/81；详情页紧凑编辑器，spec 并入 `specs/detail-editor`；剩余 4 项（文本编辑保存、Markdown 取消不丢预览、保存并复制写回、保存并粘贴复用链路实机验证）移出 backlog
- `2026-08-05-settings-sidebar-component-library-recovery` — 归档时 14/14；设置页 Sidebar 组件库恢复，spec 并入 `specs/settings-interface`
- `2026-08-05-main-panel-functional-layout-plan` — 归档时 11/37；被统一前端架构吸收，使用 `--skip-specs`，剩余拆分与验收任务转入 `frontend-surface-architecture-refactor`
- `2026-08-05-quick-panel-visual-regression-recovery` — 归档时 22/30；被统一前端架构吸收，使用 `--skip-specs`，剩余选中/滚动/复制/粘贴交互与性能验收转入 `frontend-surface-architecture-refactor`

## 建议推进顺序

> 2026-09-02 方向调整：产品主线回归「打造好一个剪贴板」。近期只推进剪贴板核心体验（格式闭环实机验收、归档）、首次引导和实机验收；旧 AI 面板仅保留 iframe 实验形态、全链后置；AI/Agent 运行时四案维持统一评估，不直接进入产品热路径，取舍结论前不新增依赖。

> **口径说明（2026-11-09）**：本节 P0–P4 是 2026-09-02 的历史排期口径，保留作决策记录；**当前执行顺序以 [product-iteration-master-plan](./changes/product-iteration-master-plan/proposal.md) 五波次 + [PROPOSAL_ROADMAP](../docs/PROPOSAL_ROADMAP.md) active 表为准**。其中 `frontend-surface-architecture-refactor` 已于 2026-10-08 归档，不再是 active P0 项，下方链接已改指归档件。

1. P0（历史口径）：联合收尾 [onboarding-standalone-page](./changes/onboarding-standalone-page/proposal.md) 与已归档的 [frontend-surface-architecture-refactor](./changes/archive/2026-10-08-frontend-surface-architecture-refactor/proposal.md)，验证正式应用的开机启动、权限引导、虚线选中态、滚动跟随和复制/粘贴 P95。
2. P1：完成 [file-image-clipboard-support](./changes/file-image-clipboard-support/proposal.md) 与 [clipboard-multi-format-fidelity](./changes/clipboard-multi-format-fidelity/proposal.md) 的文本、HTML、图片、文件实机矩阵。
3. P2：交互基线固定后继续前端 surface 拆分；`external-hook-plugin-runtime` 只推进读取侧 Block A，写入侧继续冻结。
4. P4：统一复审 `ai-model-plugin-productization`、`vercel-ai-sdk-integration`、`local-model-quick-integration` 和 `mastra-agent-runtime-evaluation`，先形成 runtime 取舍结论，再决定是否进入 POC 或实现。
5. P3/P4.5：核心体验稳定后再推进演示 GIF；模块化治理随触碰文件渐进完成，不单独阻塞功能交付。
