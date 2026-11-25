# OpenSpec 提案路线图与交接计划

更新时间:2026-10-01(波次化重构,单一事实源移交 [product-iteration-master-plan](../openspec/changes/product-iteration-master-plan/proposal.md);本文件转为文档视图 + 历史决策记录);2026-11-05 归档整理 + active 实数对账。

**2026-11-05 归档整理**：按 `openspec list` 实数对账，24 个 active change 中唯一 ✓ Complete 的是 `product-iteration-master-plan`(7/7)，其余 23 个均为 N/M，剩余项集中在实机验收 / 盟哥人工走查 / 正式 .app 验证 / 待放行决策。按本文件「同步规则」(未完成的 GUI、Tauri dev、外部文档项不得勾选)，**本次不移动任何 active 提案目录、不代勾任何任务**。完成的整理动作是：① 建立归档区四类分类台账(见「归档分类台账」节)并登记隐藏 `.archive/` 11 件早期档案；② 把 total 26 件已归档提案按归档性质归位、补齐此前只列 11 行的「已归档」表；③ 更正 `openspec/project.md` 中「interaction-animation-polish 已完成待归档」的过期记录(实际 2026-10-08 已归档)；④ 给总纲加「常驻治理文档，豁免归档」声明并登记豁免判据；⑤ active 表按四类分组刷新实数。总纲豁免理由：24 条相对链接指向它，归档会静默断链且 `--skip-specs` 会让 `product-iteration-governance` 的 4 条 Requirement 不进 `openspec/specs/`。

2026-10-13 归档 `panel-list-perf`:22/22 完成归档为 `archive/2026-10-13-panel-list-perf/`,spec delta 合入新建 `openspec/specs/panel-list-performance/spec.md`(批量 JOIN 直出/SWR 视图快照/key 稳定/刷新收敛;payload 瘦身 3 项缓议降级为后续提案 design.md §4.2-4.3)。同日 active 表对账(`openspec list` 实数):补入 detail-page-information-architecture、clipboard-data-integrity、settings-status-bar-and-dead-ai-cleanup、debug-mode-performance-observability、agent-plugin-runtime、agent-extension-seams、snipaste-parity 七个 2026-10-08 后新增 change。

2026-10-10 新增 `panel-list-perf` 性能修复 change:经性能评审确认主面板列表存在 N+1 查询、2MB IPC、视图切换全量重查、列表 key 强制重挂载、开面板多次 setClips 等瓶颈,归入 W1 作为核心闭环收口支撑项,与现有 W1 四项并行推进,优先保证 `quick.scroll/select/copy/paste` P95 ≤ 300ms 退出条件达成。

2026-10-10 插件化 Agent 能力运行时立项:[agent-plugin-runtime](../openspec/changes/agent-plugin-runtime/proposal.md)(前身 agent-self-evolution 经 grilling 评审重构,已归档)。选型拍板:cordis-rs `=0.11.1` 生命周期骨架 + rquickjs 0.14 引擎(一插件一线程一 Runtime);双层工具口(宿主 specs.rs 40 条不动,插件走 `plugin.<包名>.*` 动态注册口);与 agent-extension-seams 划定边界(插件工具不消耗同源计数)。design 20 节含错误码契约/开发调试/发布分发/内存细则/全链路预演;配套 [插件开发指南](../openspec/changes/agent-plugin-runtime/docs/PLUGIN_DEV_GUIDE.md)与 [API 参考](../openspec/changes/agent-plugin-runtime/docs/API_REFERENCE.md)。入口任务:backlog TASK-3(Phase 1 桥接 spike,时间盒 1 周,失败降级门面内自研)。

2026-09-11 重大方向决策（盟哥拍板）：

1. **pi sdk 确立为 Agent 能力基础**：选定 github.com/earendil-works/pi（TS Agent 工具箱 + 可编程 SDK，npm @mariozechner/pi-coding-agent），新建 [pi-sdk-agent-foundation](../openspec/changes/pi-sdk-agent-foundation/proposal.md) 提案承接全部 Agent 能力（条目分析/智能标签/未来助手面板），validate --strict ✓。
2. **旧 AI 侧车全链废弃删除**：deepseek-harness-embedding 及两份衍生提案已标记废弃（头部声明 + 指向 pi 提案），代码删除为 pi-sdk-agent-foundation Phase 1（夜间任务首个大战役），删除完成后三提案 --skip-specs 归档。基座取舍决策就此关闭。
2. **旧 AI 侧车三提案已归档（2026-09-11）**：deepseek-harness-embedding 与两份衍生提案归入 archive/2026-09-11-*；旧 AI 侧车代码全链删除完成（前端 -528 行 + Rust -553 行 + 配置），前端零残留。
3. 顺带决策记录：CLIPFORGE_DISABLE_CAPTURE=1 双实例隔离开关已落地（2026-09-10 双实例污染事故的防再发）。

2026-09-07 进展（夜间批次 1–4，Tailwind v3 视觉重构收尾）：

1. 视觉重构全部入库：基线分批提交 → 详情页/聚合页/onboarding 拆分完成（`workspace-panels.tsx` 1831 行 → 纯 re-export，全部子组件 ≤500 行 Tailwind 语义类）；file-size 豁免清单剩 4 项（App.tsx / settings.tsx / contracts.ts / lib.rs）。
2. 全量回归可自动化部分已覆盖：`build:web` / `test:unit` / `test:boundaries` / `cargo check` 全绿；`pnpm tauri dev` 后台冒烟通过（编译+启动+运行 70 秒无 error/panic，dev 实例已清理）。
3. 已知待人工项：三个 surface（详情/聚合/onboarding）重写样式的**视觉走查**、`file-image-clipboard-support` × `clipboard-multi-format-fidelity` 的 **7 场景实机验收矩阵**（需真实系统剪贴板证据，无法自动化勾选）。
4. 已知无害告警：`message-scroller.tsx` / `animate-ui/radix/sidebar.tsx` 中 4 个 `ease-[cubic-bezier(...)]` 类触发 Tailwind v3 歧义警告（vendored 第三方组件，CSS 正常生成），暂不修改。
5. 新增 [`tailwind-v3-style-refactor`](../openspec/changes/tailwind-v3-style-refactor/proposal.md)（2026-09-07 补档）：为批次 1–5 的样式重构补立正式提案，含 `styling-architecture` spec delta（全局单源 / surface marker / 500 行门禁），主体 24/27 完成，剩余视觉走查与收尾。

2026-09-02 清账与方向调整：**产品主线回归「打造好一个剪贴板」**。决策记录：

1. `deepseek-harness-embedding` 整体后置：旧 AI 悬浮面板仅保留 **iframe 嵌官方 Web UI 实验形态**（2026-08-17 落地：守护进程骨架状态/启停/localhost-only/env 注入/退出清理 + iframe 面板），自研对话 UI、`POST /chat` 会话 API、快速唤起、i18n 全部后置，「后面看看需不需要自研」。tasks.md 已按实际代码对账（13/31 → 22/31）。
2. 运行时基座存在切换候选（pi 等），基座取舍结论前不向旧 AI 侧车 runtime 深投；`clipboard_analyze` 一次性链路（Phase 0–5）保持可用。剪贴板打通场景由「文件上下文对话」提案承接、同步后置。
3. 清账动作：`file-size-exemptions.json` 移除 2 个失效条目（`src/agent-panel.tsx`、`src/agent-chat-page.tsx` 已随旧 Agent 面板删除，7 → 5），门禁复跑通过；`cargo check` 复跑通过。
4. 待办：`file-image-clipboard-support`（8 项）与 `clipboard-multi-format-fidelity`（4 项）剩余任务为同一张实机验收矩阵（7 个场景，见两提案 tasks.md），完成后归档两提案。
5. AI 四案（`ai-model-plugin-productization` / `vercel-ai-sdk-integration` / `local-model-quick-integration` / `mastra-agent-runtime-evaluation`）维持后置，取舍结论不阻塞剪贴板主线；在旧 AI 侧车实验结论与 pi 评估出来前不合并、不废弃、不新增依赖。

2026-08-05 归档 `settings-sidebar-component-library-recovery`：任务 14/14 已完成，delta 已合入 `openspec/specs/settings-interface/spec.md`，归档路径为 `openspec/changes/archive/2026-08-05-settings-sidebar-component-library-recovery/`。

2026-08-05 归档 `main-panel-functional-layout-plan`（11/37）和 `quick-panel-visual-regression-recovery`（22/30）：两者的有效方向与剩余工作已由 `frontend-surface-architecture-refactor` 接管，使用 `--skip-specs` 归档，避免旧布局和视觉 delta 重新进入当前规范。归档路径分别为 `openspec/changes/archive/2026-08-05-main-panel-functional-layout-plan/` 和 `openspec/changes/archive/2026-08-05-quick-panel-visual-regression-recovery/`。

2026-08-05 更新 [`onboarding-standalone-page`](../openspec/changes/onboarding-standalone-page/proposal.md)：首期 A 已进入实现收尾，新增独立 `onboarding` 窗口入口、设置页轻入口、启动时后台权限缺失检查、`onboardingShownAt` 一次性展示记录和 `launchAtLogin` 设置能力；已修复固定 `640x560` 窗口内内容截断且无法滚动的问题并新增回归门禁，当前进度 25/52。Phase 4 sidebar 常驻、Phase 5 兜底、Phase 6 标准化日志和真实 Tauri 权限/快捷键验证仍未完成。

2026-08-05 新增 [`mastra-agent-runtime-evaluation`](../openspec/changes/mastra-agent-runtime-evaluation/proposal.md)：评估 Mastra 作为 Agent runtime 是否合理。结论边界先固定为评估提案，不直接安装依赖；Mastra 只能作为可选 sidecar / workbench runtime 候选，不得进入 quick panel 打开、滚动、选中、复制、粘贴热路径。当前进度 11/25。

2026-07-30 新增 [`external-hook-plugin-runtime`](../openspec/changes/external-hook-plugin-runtime/proposal.md)：将应用上下文 collector 收敛为外部 Hook capability。2026-07-30 精简为 **Block A**（读取侧收敛，可推进：统一 manifest V2、4 态生命周期、洋葱 priority、沙盒、节流、熔断、延迟补写、单个 MCP `clipboard.hook.run`）与 **Block B**（写入侧冻结：Proposal Store / Host Apply / `content.propose` / `clipboard.hook.apply` / `clipboard.content.write`，等真实用户故事再解冻）。工作树中的 collector 实验代码是只读现状，不算本提案实现。

2026-07-30 新增 [`onboarding-standalone-page`](../openspec/changes/onboarding-standalone-page/proposal.md)：把引导从设置页 tab 拆为独立 `onboarding` 窗口（Eco 模式），设置页只留“打开引导”触发按钮，首启动自动判断打开引导且不阻塞托盘/快捷键等功能界面；同时把设置页 sidebar 改为全量常驻展开，补齐显示兜底（loading/error/permission-missing/empty）与标准化 JSONL 日志。2026-08-05 已落地首期 A 代码，待完整桌面验证。

2026-07-30 新增 [`project-demo-gif-pipeline`](../openspec/changes/project-demo-gif-pipeline/proposal.md)：建立双轨功能演示动图流水线——真实录屏转 gif（主，ffmpeg 调色板两步法 + gifsicle）+ 复用 Remotion workbench（辅，`motion:render:intro` / `:onboarding`）；含场景清单、命名规范、`docs/demos/` 资产目录与 README 引用；与 `onboarding-standalone-page` tour 步骤联动。当前仅方案评审。

2026-07-30 发现 [`local-model-quick-integration`](../openspec/changes/local-model-quick-integration/proposal.md)：本地模型、第三方 API Key 导入和 AI 对话面板重构候选。2026-08-05 已补 `tasks.md` 和 `agent-provider` spec delta，当前进度 4/16；仍属 AI/Agent 后置候选，不纳入本轮 onboarding / demo / hook 收敛执行队列。

本文件用于把当前已归档提案、仍在推进的 active change、以及后续 Agent 的接手顺序分开管理。当前仓库状态以 `openspec list`、各 change 的 `tasks.md` 和主文档为准，不用历史聊天记录判断完成度。

## 前端架构基线

2026-07-16 新增 [`frontend-surface-architecture-refactor`](../openspec/changes/frontend-surface-architecture-refactor/proposal.md)，作为后续主面板、设置页、详情页、Agent 面板、路由拆分和样式系统重整的统一基线。

后续前端改动默认先对齐该提案：

- 业务功能区固定为快速剪贴板区、内容详情区、设置管理区、Agent 辅助区、系统状态区。
- 交互优先级固定为：剪贴板热路径 > 管理动作 > 详情辅助 > Agent 增强 > 设置诊断。
- 主面板布局固定为 `TopCommandBar / ModeBar / ClipboardList / StatusFeedback / OverlayLayer`。
- 设置页采用 Sidebar + Tabs + catalog-driven SettingsField + complex panel 插槽。
- 路由统一基于现有 `@tanstack/react-router`；路由用于 page/surface 边界和懒加载，不接管列表选中、滚动、复制等热路径状态。
- 样式按 `theme tokens` 和 surface scoped styles 拆分；禁止继续在 `src/App.css` 追加新的全局 `P-FINAL` 覆盖。
- 成熟组件优先使用 shadcn/Radix/Animate UI/lucide/floating-ui，不再手写并行基础控件。
- 项目默认组件参考知识库为 [`docs/COMPONENT_REFERENCE.md`](./COMPONENT_REFERENCE.md)，组件选型、shadcn CLI 使用、已安装组件和业务区映射默认以该文档为准。

### 已吸收并归档

以下 change 的布局、交互和样式方向已由 `frontend-surface-architecture-refactor` 统一吸收并归档。历史任务语境仍可在 archive 中查阅，但不得作为新实现依据：

| Change | 状态 | 被吸收方 |
| --- | --- | --- |
| `main-panel-functional-layout-plan` | archived | `frontend-surface-architecture-refactor`（主面板区域契约 -> 组件/目录拆分；旧任务 11/37） |
| `quick-panel-visual-regression-recovery` | archived | `frontend-surface-architecture-refactor`（视觉回归修复 -> 样式分层、交互验收与 App.css 冻结；旧任务 22/30） |
| `settings-sidebar-component-library-recovery` | archived | 2026-08-05 已归档；设置页 Sidebar 组件库壳层 delta 已合入 `openspec/specs/settings-interface/spec.md` |

后续新实现一律以 active change 为准；快速面板选中、滚动、复制/粘贴反馈和 P95 验收已转入 `frontend-surface-architecture-refactor`，不会因旧提案归档而丢失。

## 归档分类台账

> 2026-11-05 建立，作为归档区的单一分类视图。归档区 `openspec/changes/archive/` 共 **26 件**，另有隐藏 `openspec/changes/.archive/` **11 件**早期档案。实数取各件 `tasks.md` 的 `- [x]` / `- [ ]`；分类依据是**归档性质（为什么归档）**，与 `archive/YYYY-MM-DD-*` 的日期前缀解耦。归档件一律不再作为 active backlog。

**判据**

| 类 | 判据 | 数量 |
|---|---|---|
| C1 完成归档 | tasks 全绿、无遗留项；spec delta 已合入 `openspec/specs/`，或明确 `--skip-specs` | 11 |
| C2 收口归档 | 主体实现完成，少量实机 / 外部文档项经决策「移出 backlog」；spec delta 已合入 | 6 |
| C3 吸收 / 重构归档 | 方向被后继提案接管或经评审重构，用 `--skip-specs` 防旧 delta 回流；剩余任务有明确接手方 | 4 |
| C4 废弃 / 调研归档 | 方向经用户裁决废弃，或本身只有调研报告、无实现任务 | 5 |
| C5 早期档案（登记，非 openspec 归档件） | `.archive/` 11 件，2026-07 之前产物、无日期前缀、已被 git 跟踪 | 11 |

### C1 完成归档（11 件）

| Change | 实数 | spec 去向 / 备注 |
| --- | --- | --- |
| `2026-07-14-content-smart-format-decoder` | 32/32 | 无 delta，按完成任务归档 |
| `2026-07-14-github-release-update-distribution` | 24/24 | 无 delta，按完成任务归档 |
| `2026-07-14-panel-interaction-upgrade` | 40/40 | 无 delta；**窗口 pin 原始定义出处**（`PANEL_PINNED` 仅标志位、保持位置不移动） |
| `2026-07-14-search-filter-tags-filetypes` | 34/34 | `specs/search-filters` |
| `2026-07-15-context-plugin-agent-runtime` | 68/68 | `specs/agent-runtime`；delta 提前合入故 `--skip-specs` |
| `2026-07-15-remotion-animation-workbench` | 10/10 | `specs/animation-workbench`；双 composition + README 完成 |
| `2026-07-15-settings-field-refactor` | 15/15 | `specs/settings-registry`；收敛为最小 `SettingFieldConfig` catalog |
| `2026-07-16-app-internationalization-en-support` | 38/38 | `specs/internationalization`；中英切换 / 系统默认 / 重启保持全绿 |
| `2026-08-05-settings-sidebar-component-library-recovery` | 14/14 | `specs/settings-interface` |
| `2026-10-08-interaction-animation-polish` | 25/25 | `--skip-specs`；motion token 契约随交付落地，`verification.md` 随归档保留。**此前 project.md 的「已完成待归档」为过期记录，已更正** |
| `2026-10-13-panel-list-perf` | 22/22 | 新建 `specs/panel-list-performance`；692 条实机 `quick.scroll` P95=1ms；payload 瘦身 3 项降级后续提案 |

### C2 收口归档（6 件，剩余项经决策移出 backlog）

| Change | 实数 | spec 去向 / 移出项 |
| --- | --- | --- |
| `2026-07-16-clipboard-agent-panel` | 169/170 | `specs/agent-panel`；剩真实 provider 消息流验证 |
| `2026-07-16-detail-rich-editor-agent-bridge` | 77/81 | `specs/detail-editor`；剩编辑 / 保存 / 复制粘贴实机链路 |
| `2026-07-16-onboarding-to-settings-proposal` | 41/44 | `specs/onboarding`；剩系统权限授权 / 重启门禁 / 主面板实机验证；后续由 `onboarding-standalone-page` 拆独立窗口 |
| `2026-07-16-settings-interface-redesign` | 50/52 | `specs/settings-ui`；剩 Context7 文档拉取 + 硬编码文案白名单 |
| `2026-07-16-settings-service-unified-protocol` | 77/79 | `specs/settings-service`；剩主面板性能 smoke P95 + 回归 |
| `2026-07-16-top-nav-optimization` | 28/30 | `specs/panel-navigation`；剩窗口拖拽 / 搜索点击的系统级证据 |

### C3 吸收 / 重构归档（4 件，`--skip-specs`，剩余工作有接手方）

| Change | 实数 | 接手方 |
| --- | --- | --- |
| `2026-08-05-main-panel-functional-layout-plan` | 11/37 | `frontend-surface-architecture-refactor`（布局契约 → 组件/目录拆分） |
| `2026-08-05-quick-panel-visual-regression-recovery` | 22/30 | 同上（交互与性能验收 → 样式分层） |
| `2026-10-08-frontend-surface-architecture-refactor` | 36/84 | W1/W5 随功能触碰渐进；组件知识库见 `docs/COMPONENT_REFERENCE.md` |
| `2026-10-10-agent-self-evolution` | 0/11 | `agent-plugin-runtime`（经 grilling 评审重构） |

### C4 废弃 / 调研归档（5 件）

| Change | 实数 | 性质 |
| --- | --- | --- |
| `2026-07-14-reference-projects-research` | 无任务 | 调研报告，无实现 |
| `2026-07-15-pi-runtime-evaluation` | 无任务 | 调研报告；结论被 `pi-sdk-agent-foundation` 承接 |
| `2026-09-11-deepseek-harness-embedding` | 23/31 | `a020068` 裁决废弃，旧 AI 侧车全链删除，pi 接管 |
| `2026-09-11-dsh-file-context-conversation` | 1/22 | 同上，衍生案废弃 |
| `2026-09-11-dsh-system-context-menu` | 0/14 | 同上，衍生案废弃 |

### C5 早期档案登记（`.archive/`，11 件，非 active）

`agent-mcp-service`、`build-cross-platform-clipboard-workbench`、`clipboard-listener-upgrade`、`design-style-upgrade`、`nspanel-floating-panel`、`numeric-shortcut-paste`、`simplify-floating-clipboard-panel`、`sqlite-persistence`、`stabilize-monochrome-panel`、`window-positioning`、`wire-startup-clipboard-capture`。

- 处置：**只登记，不迁移**。理由：36 个文件已被 git 跟踪、无丢失风险；物理迁移会产生无收益 diff，且 `archive/2026-07-15-pi-runtime-evaluation/report.md:262` 已用相对路径引用 `.archive/sqlite-persistence/proposal.md`，迁移即断链；与 `archive/` 既有 26 个日期目录也需逐一核对撞名。
- 已知噪声：`openspec list` 会把 `.archive` 误列为 `No tasks` 的 active 项，因此「24 个 active」口径不含它；`openspec validate --all --strict` 也不计入它。两命令对点目录处理不一致，属工具行为，不在本次修复范围。
- 历史参考价值：其中 `nspanel-floating-panel`（NSPanel 全屏覆盖 / 非抢焦点）、`window-positioning`（Remember 归一化坐标）、`simplify-floating-clipboard-panel` 与 `stabilize-monochrome-panel`（主面板高密度轻量约束）是 2026-11-05 新提案 `pinned-floating-panel` 的技术前史，只复用结论、不复活提案。

## 当前 active change

> **2026-11-09 对账**（数据源 `openspec list` 实数，共 **28 个** active change）。11-05 对账时点实数 25 个（含当时新建 `pinned-floating-panel`），之后 11-05 傍晚与 11-09 又新建 3 个提案并完成本表补登记：`clipboard-listener-reliability`、`focus-prefetch-idle-removal`、`remove-dead-snippet-tab`。三者均为「对账后新建」，不是漏登；其中 `remove-dead-snippet-tab/tasks.md` 第 5 节已自列台账同步待办，本次一并回写。口径提醒：`openspec list` 会额外把点目录 `.archive` 误列为 `No tasks` 的 active 项，因此原始输出是 29 行，**有效 active change 是 28 个**（详见下方「C5 早期档案登记」的工具行为说明）。推进顺序仍由 [product-iteration-master-plan](../changes/product-iteration-master-plan/proposal.md) 五波次表单点解释，本表是其文档视图。「类别」列即归档就绪度四类，判据见 `openspec/project.md`「活跃提案」。上一条 2026-10-13 对账已被本表取代，历史决策记录保留在下方各节。

> **2026-10-09 会话增量（历史）**：历史交接记录已移除，当前事实以 `docs/BUSINESS_INDEX.md` / `docs/AGENT_MAP.md` / OpenSpec 提案为准；面板显隐命令用 `pnpm locate` 定位。

| 类别 | 波次 | Change | 实数 | 剩余项 / 下一动作 |
| --- | --- | --- | --- | --- |
| **S1 常驻治理** | 全波次 | `product-iteration-master-plan` | ✓ Complete (7/7) | 唯一完成项，**豁免归档**；持续维护波次表与交互区域矩阵，W1 关波批量归档时跳过 |
| S2 待验收闭环 | W1 | `file-image-clipboard-support` | 82/83 | 仅剩真人目检「图片 hover 预览不遮挡列表」 |
| S2 | W1 | `clipboard-multi-format-fidelity` | 22/26 | HTML / 文件 / 图片写回 + 写回不重复入库实机矩阵 |
| S2 | W1 | `onboarding-standalone-page` | 43/48 | 托盘/快捷键不阻塞、五步链路、Eco 视觉截图、`onboarding.open` P95 ≤300ms；Phase 4 侧栏常驻已裁决作废 |
| S2 | W1 | `tailwind-v3-style-refactor` | 21/25 | 盟哥三 surface(详情/聚合/onboarding)人工走查 + 修复 + 归档 |
| S2 | W1 | `clipboard-data-integrity` | 4/11 | 条目复活实机 + watcher 指纹开销 + 门禁 + 盟哥确认后归档 |
| S2 | W1 | `detail-page-information-architecture` | 24/31 | 六类条目×三态×键盘动线沙箱走查 + 终验门禁 |
| S2 | W1/W5 | `settings-status-bar-and-dead-ai-cleanup` | 9/15 | multiSelect 待定决策 + 沙箱实测 + 盟哥验收 |
| S2 | W5 | `debug-mode-performance-observability` | 12/16 | 调研结论汇总 + 诊断包形态确认 + 解锁后沙箱实测 + 验收 |
| S2 | W3 | `pi-sdk-agent-foundation` | 25/30 | 自动门禁 + 沙箱功能验证 + 冒烟 + 盟哥验收 + L2 承载面形态结论写入 tasks |
| S2 | W3 | `ai-model-plugin-productization` | 73/76 | 3 项降级/权限/企业策略验证；scope 复审后按 L1/L2 归位并入 pi 线 |
| S3 待放行 / 未开工 | W1 补位 | `pinned-floating-panel` | 0/13（2026-11-05 新建） | **新增优化提案**：固定悬浮面板语义收敛；待方案确认后排入 W1，不阻塞 W1 实机验收。2026-11-20 盟哥批准「先修面板不会自动消失」：Phase 1 语义收敛代码切片（1.1/1.2/1.3/2.1）已落地并过全门禁，沙箱实机验证 pin 态 Esc 收起放行通过；checkbox 不代勾，验收与部署待走查，详见提案「实现状态」登记 |
| S3 | W1 插队 | `clipboard-interaction-repair` | 0/10 | 今日新建；详情/多选八项交互修复 + 门禁 + 沙箱走查 |
| S3 | W1 | `ocr-image-text-extraction` | 11/28 | P3，评估已实测通过；2026-11-06 完成 Phase 0（schema/端点红线/缓存/sourceImageId/测试）与 Phase 4（`src-tauri/src/ocr/` 五文件目录化 714 行、19 passed）；Phase 5 已构建 TDD 提案（4 个新 Scenario、seams 清单、红→绿切片），待确认后实施，不阻塞主线 |
| S3 | W5 | `codebase-modularity-refactor` | 25/31 | 随功能触碰渐进；App.tsx / lib.rs 剩余切片，豁免清单只减不增 |
| S3 | W4 | `vercel-ai-sdk-integration` | 30/38 | 与 mastra/local-model 三案统一取舍，结论前不动 |
| S3 | W4 | `mastra-agent-runtime-evaluation` | 11/25 | 同上 |
| S3 | W4 | `local-model-quick-integration` | 4/16 | 同上 |
| S3 | W4 | `external-hook-plugin-runtime` | 0/67 | 只推进 Block A 读取侧；Block B 写入侧维持冻结 |
| S3 | W3 | `agent-plugin-runtime` | 4/23 | Phase 1 桥接 spike 待排期（backlog TASK-3） |
| S3 | W3 | `agent-extension-seams` | 1/12 | 同源工具第 3 处重复实现触发实施（计数规则见 AGENTS.md） |
| S3 | 插队 | `snipaste-parity` | 0/27 | 方案已评审**待用户放行**；前置 = W1 关波，四阶段逐段放行，不碰热路径 |
| S3 | W5 | `project-demo-gif-pipeline` | 0/30 | W1 稳定后录制 |
| S3 | 性能治理横切 | `focus-prefetch-idle-removal` | 39/46 | **11-09 补登记**：方案 A 净删 3 处已在工作区落地、两轮 review 完成；剩 `pnpm build` 重签授权与 GUI 实机点头。头部仍写「代码未改」，与 tasks 实数不一致，待口径合并 |
| S3 | 监听可靠性（W1 关联） | `clipboard-listener-reliability` | 9/39 | **11-09 补登记**：取证与四件套完成；P0 可观测性可零风险放行，P1 缺陷修复会改写 `clipboard-data-integrity` 缺口 2 的评估前提，须排在 W1 关波后 |
| S3 | 待放行（11-09 新建） | `remove-dead-snippet-tab` | 0/24 | **11-09 补登记**：纯前端删 7 文件；需盟哥同时裁决「片段功能是否保留为产品方向」，确认前不改产品代码 |
| S4 休眠评估稿 | W5 | `framer-motion-adoption-eval` | No tasks | 按信号表触发，四信号均未出现 |
| S4 | W3 后置 | `automated-tagging-eval` | No tasks | 待「真实批量回填诉求 + MCP 集成方」三判据齐后转实施 |
| S4 | 性能治理横切 | `rust-anything-adoption-eval` | No tasks | **11-19 补登记**：前端热路径移植工具链评估；按信号表触发（搜索过滤 profile 证据）；CLI 已装未接 agent 配置 |

> 实数口径：S1 1 + S2 10 + S3 15 + S4 2 = **28 个**（11-05 的 25 个 + 三次对账后新建 3 个）。S2 十项的编码主体均已收口，剩余全部是实机 / 人工 / 正式 .app 验证，**不代勾、不归档**；盟哥验收通过后再按 C1/C2 判据批量归档并关 W1。W2 语义检索仍未立项，见总纲。已归档的旧 AI 侧车三提案、`settings-service-unified-protocol` 等见上节「归档分类台账」。**2026-11-19 补登记**：新建 S4 休眠评估稿 `rust-anything-adoption-eval`（No tasks，按信号表触发），实数 S1 1 + S2 10 + S3 15 + S4 3 = **29 个**。
>
> **2026-11-09 状态校准**：工作区 `git status` 有 60 项改动（其中 24 个未跟踪文件），已包含 `clipboard-interaction-repair` 八项交互修复、`focus-prefetch-idle-removal` 方案 A 净删 3 处、OCR 目录化与 5 个新门禁脚本的**代码实现**，但全部**未提交、未勾选 checkbox、未跑完整门禁**。因此「编码侧已完成」只适用于 S2 十项的既有实现；`clipboard-interaction-repair`(0/10) 与 `pinned-floating-panel`(0/13) 的实机验收必须在这些未提交改动形成可回滚基线之后才有效。门禁结果与验收证据以本轮实际执行记录为准。

## 后续开发计划

> 已并入 [product-iteration-master-plan](../changes/product-iteration-master-plan/proposal.md) 五波次(W1 核心收口 → W2 搜索语义 → W3 Agent 补全 → W4 运行时决策 → W5 治理演示),以该提案为单一事实源。下方原迭代 A-E(2026-09-07)保留作历史语境,与波次表的映射:A≈W1(onboarding/交互基线),B≈W1(格式闭环),C≈W5(架构拆分随触),D≈W4(runtime 取舍),E≈W5(演示资产)。原 C 提到的 `frontend-surface-architecture-refactor`(36/84)已于 2026-10-08 归档(见上节),其剩余样式拆分任务随 W1/W5 功能触碰渐进执行。

### 2026-10-13 推进计划(当前有效)

**里程碑 M1:W1 关波(唯一关键路径)。** 2026-11-09 校准：S2 十项的编码主体已收口，剩余以实机验收/走查为主；但 `clipboard-interaction-repair`(0/10) 的八项交互修复代码已在工作区（未提交未勾），改到 `App.tsx` 选区/导出、`use-panel-keyboard.ts` 键位与 `lib.rs` 保存事务，**必须在实机矩阵开跑前形成可回滚基线**，否则验收结论作废。四批顺序相应调整为：先立基线 → 编码批 → 放行窗口 → 实机验收。按依赖分四批:

1. **自动门禁批(本机即可,无外部依赖)**:`clipboard-data-integrity` 4.1 门禁、`detail-page-information-architecture` 各阶段验证(1.6/2.4/4.4/6.5,build+cargo+test:unit+test:boundaries+沙箱走查)、`settings-status-bar` 5.1 门禁、`tailwind-v3-style-refactor` 走查前自查。
2. **沙箱实测批(`pnpm dev:sandbox`)**:`clipboard-data-integrity` 1.3 条目复活场景 + 2.1/2.2 watcher 指纹开销实测、`detail-page` 2.4/3.4/5.4 沙箱实测、`settings-status-bar` 1.5/2.2/5.2 沙箱实测。
3. **盟哥配合批(预约一次走查窗口集中清)**:`tailwind` 三 surface 走查+修复、`pi-sdk-agent-foundation` 全量回归+视觉/功能验收、`settings-status-bar` 5.3、`clipboard-data-integrity` 4.3、`detail-page` 7.4 终验;file-image × multi-format 两张实机验收矩阵(7 场景)同窗口附带过。
4. **正式 .app 批**:`onboarding-standalone-page` 剩余 5 项(开机启动/AX 权限只弹一次/托盘不阻塞/五步链路/Eco 视觉)——依赖 `pnpm tauri build` 部署新版本后实测。注意该脚本会删 `release/*.dmg|zip`、完整 release 编译、`codesign` 重签、`hdiutil` 覆盖 DMG 并重写发布元数据，多个新提案已明确「不跑 `pnpm build`」，**需盟哥单独授权**，不可由自动门禁代跑。

全绿后批量归档 W1 七提案 → W1 关波,复核性能退出条件(`quick.scroll/select/copy/paste` P95 ≤ 300ms)。

**并行卫生项(不阻塞 M1)**：~~工作区 `lib.rs` pin 语义修复待提交~~ — 2026-11-05 核实已失效：`lib.rs` 与 HEAD 一致，`hide_panel` 的 pin 一刀切拦截已在 `2258b51` 移除并提交，**残留问题在前端 Esc 分支**（`use-panel-keyboard.ts` pin 态仍不发 `hide_quick_panel_command`），已转由新建提案 `pinned-floating-panel` 承接；本地提交推送状态另按 `git status` 复核。

**M1 关波后放行点(按序)**:

1. `snipaste-parity` Phase 1 放行决策(截屏+取色;提案前置=主链路收口,逐阶段放行,不碰热路径)。
2. W2 语义检索立项(基于 `clip_semantic_index`,local-keyword 已建;先服务 pi/MCP 工具面)。
3. `ai-model-plugin-productization` scope 复审(65/76,按 L1/L2 归位并入 pi 线)。
4. W4 三案取舍文档(`vercel-ai-sdk-integration`/`mastra`/`local-model`):产出引入/裁剪/归档结论,结论前不新增重型依赖。
5. W5 `project-demo-gif-pipeline` 启动录制;`codebase-modularity-refactor`/`debug-mode` 随功能触碰渐进。

## 统一设置服务边界

设置页、MCP 设置工具和 Agent provider 配置必须收敛到同一个 Settings Service：

```text
Settings window ── Tauri command ┐
Agent config UI ── Tauri command ├── SettingsService ── settings file / schema / validation
External Agent ── MCP tools ─────┘
```

统一的是 Settings Service、JSON schema、revision、redaction、错误码、事件和写入策略。前端设置页不通过 MCP stdio 调本机服务；MCP 是外部 Agent 的协议入口。

主面板首批不迁移。以下路径不能同步等待 Settings Service、MCP、provider check 或 models：

- 全局快捷键触发到面板可交互。
- 快速列表滚动和选中态。
- 搜索和过滤当前面板内容。
- 复制、粘贴、写回和自动隐藏。

## 性能与校验要求

- 可见交互必须在 300ms 内给出反馈。网络 provider check、models、updater、诊断导出等异步任务不要求 300ms 完成，但必须在 300ms 内显示 pending/loading/error 状态。
- GUI 性能验收已补 `window.__clipforgePerf` 采样入口；在 `pnpm tauri dev` 中采样 `panel.open`、`quick.select`、`quick.scroll`、`quick.copy`、`quick.paste`、`settings.section`、`settings.changed` 后，用 `window.__clipforgePerf.summary()` 取 P95。
- 设置写入默认使用 patch。replace/reset 需要 `confirmed: true`，MCP 返回值必须包含修复提示。
- 所有设置写入必须带 revision 或返回新 revision，避免多个 Agent 同时写入时互相覆盖。
- MCP settings tools 默认推荐局部更新；全量 replace 只用于迁移、导入或用户明确确认。
- JSON schema 是设置协议的一部分，供 MCP 和前端表单生成/校验复用。

## 交接注意

- `settings-service-unified-protocol` 已抽出 `src-tauri/src/settings_service.rs`，后续 Agent 接手 P0 时可用 `CLIPFORGE_DEV_OPEN=panel|settings|settings:onboarding pnpm tauri dev` 直接打开目标窗口做 GUI/P95 采样；当前 `panel` 已通过 `CLIPFORGE_DEV_PERF_REPEAT=30` 取得 `panel.open count=30/p95=63ms/max=63ms`，`settings` 已取得 `settings.section count=30/p95=127ms/max=138ms/sourceCounts.fallback=30`，并通过 `CLIPFORGE_DEV_SETTINGS_CHANGED_PROBE=1` 取得真实写入后的 `settings.changed count=2/p95=122ms/max=122ms`。`CLIPFORGE_DEV_QUICK_PROBE=1` 必须配合受控粘贴目标：`CLIPFORGE_DEV_TEXTEDIT_TARGET=1` 需要 TextEdit 临时文档 ready；`CLIPFORGE_DEV_PASTE_TARGET=browser` 默认打开 Safari 临时 `textarea`；原生 paste 在发 `Command+V` 前会二次确认目标仍 ready 且仍是预期前台应用。当前本机 TextEdit 超时、Safari 未能自动置前台，均已安全 skip；不可把不安全前台目标或 skip 样本当作 quick P95 / 端到端完成证据。
- `detail-rich-editor-agent-bridge` 已补 `保存并复制` UI，并复用保存后的当前 clip 走 `onCopy(postSaveClip)` 写回路径，后续只差真实系统剪贴板证据，不要再把该项误判为缺入口或误接到 `copyText` 新建历史路径。
- `src/App.css` 已包含快速列表选中态双边框修复，后续不要再用额外 animated pseudo-frame 叠加选中边框。
- 仓库中存在品牌图标、Agent 面板和 workbench 相关改动；提交前必须用 `git status --short` 复核当前树，不要误删用户已有产物。
