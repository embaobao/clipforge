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

> **2026-10-09 会话增量**：① 面板收起丝滑化落地(原生 alpha 淡出替代 CSS panel-out,`hide_panel_with_native_fade` + `use-panel-blur-hide` 改造,cargo check/build:web/tauri dev 实测过,**未提交**);② 淡出 160ms 竞态修复(`PANEL_FADE_ACTIVE` + `PANEL_FADE_GENERATION`,淡出中再按=唤起,**未提交**);③ 「Ctrl+V 点不开」定性为 macOS 登录会话全局热键派发故障(独立 Carbon 探针回调 0 次 + 物理按键无反应,与 app 无关,**待用户注销重登/重启恢复**;恢复后需复测快捷键链路)。见 [HANDOFF](HANDOFF.md) 2026-10-09 节。

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

## 2026-07-16 active 快照（已失效）

以下内容保留为历史交接记录，其中多个 change 已归档；当前执行以本节之前的 11 个 active change 和后续开发计划为准。

| 优先级 | Change | 当前进度 | 接手建议 |
| --- | --- | --- | --- |
| P0 | `settings-service-unified-protocol` | 77/79 | 先做。统一设置服务、MCP 设置协议、Agent provider 配置和 300ms 性能边界；Settings Service 模块拆分和热路径静态边界已完成，主面板已退回 legacy 设置写入且 hot-path / runtime boundary 脚本通过；debug-only repeat probe 已取得运行中 WebView `panel.open count=30/p95=63ms/max=63ms`、设置页 `settings.section count=30/p95=127ms/max=138ms/sourceCounts.fallback=30`，以及真实 Settings Service 写入后的 `settings.changed count=2/p95=122ms/max=122ms`；主面板打开、设置页切换和设置窗口接收 `settings_changed` 已通过。已新增受控 quick probe：`CLIPFORGE_DEV_TEXTEDIT_TARGET=1` / `CLIPFORGE_DEV_PASTE_TARGET=browser` 都带前台目标校验，且发系统 `Command+V` 前会二次确认目标仍 ready；本机直接 `open -a Safari/TextEdit` 后前台仍停在 Codex/ChatGPT，因此 quick paste 会安全 skip。剩余重点仍是真实 quick 选中/滚动/复制/粘贴 P95 和端到端主面板能力验证，需要人工置前受控输入目标或专用测试目标。 |
| P1 | `settings-interface-redesign` | 49/52 | 依赖 P0 的服务语义。设置页信息架构、语义控件、Code Tabs 基线、Tooltip、Status Panel、响应式和 i18n 基本完成；真实 `pnpm tauri dev` DOM probe 已验证设置窗口、Sidebar/Tabs、Toggle/Switch/Slider/Number 保存、Code Tabs 复制、Tooltip/Escape、诊断导出、清理日志和更新状态反馈。Context7 拉取 Animate UI Radix Sidebar / Code Tabs 仍因 quota 阻塞，硬编码扫描仍有 208 个候选未逐项收敛。 |
| P1.2 | `top-nav-optimization` | 28/30 | 顶部工具栏已承接 History / Favorites、搜索、Agent、状态和 Trash / Settings 菜单；底部 Dock 渲染、滚动隐藏状态和旧 Dock 专属样式已移除，`check:i18n`、`tsc`、Agent verifier 和 OpenSpec 已复跑通过；真实 DOM probe 已确认 toolbar、drag-region 属性、History/Favorites/Trash 切换、搜索/Agent/菜单可见、列表底部不被遮挡和快捷键可用。剩余真实窗口拖拽、搜索输入和按钮点击不触发拖拽需系统级证据。 |
| P2 | `app-internationalization-en-support` | 38/38 | 已完成。设置页中英文切换、默认跟随系统、重启后语言保持、Settings Service 语言 patch 后托盘菜单刷新、设置页英文和主面板英文布局均已通过真实 `pnpm tauri dev` probe；Rust native system locale 已在 macOS 下优先读取 `AppleLanguages` / `AppleLocale`，与 WebView `navigator.language` 对齐。 |
| P3 | `detail-rich-editor-agent-bridge` | 77/81 | 已补齐详情编辑器 `保存并复制` 入口，保存成功后使用 `save_editor_draft` 返回的当前 clip 走 `onCopy(postSaveClip)` 写回系统剪贴板路径，避免重新 capture 成新历史条目；`verify-editor-agent-bridge`、`pnpm test:unit`、`check:i18n` 和 OpenSpec 校验已复跑通过；剩详情编辑、保存、复制/粘贴链路真实 Tauri 验证。 |
| P3 | `file-image-clipboard-support` | 72/79 | `cargo test parses_png_dimensions`、`cargo test clipboard::write` 和 OpenSpec 校验已复跑通过；剩文本、HTML、图片、文件复制/展示/粘贴和磁盘清理手动验证。 |
| P3 | `clipboard-multi-format-fidelity` | 22/26 | `cargo test clipboard::write` 和 OpenSpec 校验已复跑通过；剩系统剪贴板 HTML/file/image 写回与监听去重实机验证。 |
| P3 | `clipboard-agent-panel` | 169/170 | Agent verifier 已同步 top-nav 后的新入口，并补强主面板 open/hide/toggle 原生路径不含 `agent_detect` / provider check 的静态断言；`CLIPFORGE_DEV_OPEN=panel CLIPFORGE_DEV_PERF_REPEAT=3 pnpm tauri dev` 已验证真实面板打开 `panel.open p95=64ms`，detect timeout 不影响面板定位/隐藏/再次唤起。剩 OpenAI-compatible provider 标准消息流真实 provider 验证。 |
| P3 | `external-hook-plugin-runtime` | 0/67，方案评审（已精简） | **只保留 Block A 读取侧**：collector 收敛到 Hook manifest V2、4 态生命周期（enabled/disabled/error/circuit-broken）、洋葱 priority、沙盒、节流、熔断、延迟补写、单个 `clipboard.hook.run`；**Block B 写入侧冻结**（Proposal/Apply/content.write），等真实用户故事再解冻。现状 collector 实验代码是只读，不算本提案完成。 |
| P1.x | `onboarding-standalone-page` | 25/52，首期 A 实现收尾 | 已新增独立 `onboarding` 窗口、设置页 `OnboardingEntryCard` 轻入口、启动时后台权限缺失检查、`onboardingShownAt` 一次性展示记录、开机启动设置和固定窗口滚动回归门禁；仍需真实 Tauri 验证托盘/快捷键不阻塞、完成/跳过链路、P95 与日志边界。sidebar 常驻、兜底四态、标准化日志仍属后续 phase。 |
| P4.x | `mastra-agent-runtime-evaluation` | 11/25，评估提案 | Mastra 仅作为 Agent runtime 候选；不直接安装依赖，不进 WebView/主进程热路径。若进入 POC，只允许可关闭、可旁路的 sidecar/workbench runtime，并先证明 quick panel P95、内存、打包签名、离线启动、tool allowlist 和 Settings Service redaction 边界。 |
| P3 | `project-demo-gif-pipeline` | 0/30，方案评审 | 双轨功能演示动图流水线：真实录屏转 gif（ffmpeg palettegen/paletteuse + gifsicle，封装 `scripts/render-demo-gif.mjs`）为主，Remotion（`motion:render:intro` / `:onboarding`）为辅；含场景清单、`docs/demos/` 资产目录、命名规范与 README 引用。工程/文档资产，不阻塞 onboarding 或剪贴板功能。 |
| P4.x | `local-model-quick-integration` | 4/16，后置候选 | 本地模型、第三方 API Key 导入和 AI 对话面板重构候选。已补 tasks/spec delta，方向约束为 OpenAI-compatible provider、显式导入、Settings Service redaction 和不阻塞 quick panel；需要单独评审是否合并/替代 `ai-model-plugin-productization` / `vercel-ai-sdk-integration` / `mastra-agent-runtime-evaluation`。 |
| P1 | `frontend-surface-architecture-refactor` | Phase 0 完成 / Phase 1 进行中 | 作为前端整合开发基线，方案已确认。Phase 1 护栏已落地：4 个 surface 根 `data-surface` marker、`scripts/verify-surface-boundaries.mjs`（marker + App.css P-FINAL 不再增长）、App.css legacy 冻结 banner、`main-panel-functional-layout-plan/tasks.md`、3 个历史提案标记 superseded。下一步进 Phase B 主面板展示层拆分 / Phase E 设置页字段化。 |
| P4 | `ai-model-plugin-productization` | 65/76 | Phase 0 scope 已复审，Phase 2-8 文档级定义已完成：模型 provider/profile/policy、AIOutput、Tiptap 增强边界、Manifest V2、Agent capability、MCP 工具面、设置页映射和产品 capability gate 已收敛；Phase 1 仍受 Context7 quota 阻塞，Phase 9 仅完成边界/运行验证记录，不代表真实 SDK/provider/Tiptap 已接入。 |
| P4.1 | `vercel-ai-sdk-integration` | 30/38 | 已收敛为 P4.1 候选切片，proposal 中未确认版本/API 假设已降级为待 Context7 确认；`ClipAiSummary`、`ClipAiEmbedding/vectorRef`、AI job/provenance、非全量自动摘要、推荐候选范围和无 embedding store 降级策略已定义。详情页 AI 摘要区已支持 `VITE_CLIPFORGE_AI_MOCK=1` 本地 mock 摘要、pending/ready/failed 状态和重新生成；相似推荐已基于当前详情上下文候选、tags/host/format/source/关键词本地排序并复用详情跳转，不挤占主列表；摘要区现在还展示 key points、category、provider/model provenance 和 generatedAt。列表行已显示 `metadata.aiSummary` 状态图标，右键菜单已提供“生成 AI 摘要”入口并写回 metadata；AI 摘要日志已收敛为 metadata-only helper，不记录 prompt/output/正文/URL/API key。当前仍不安装或调用 Vercel AI SDK，真实 OpenAI-compatible provider 调用和 Tauri dev 验证仍未完成。 |
| P4.5 | `codebase-modularity-refactor` | 6/26 | 后置治理项，不作为近期多 Agent 功能开发主线；`test:unit` / file-size guard 已复跑通过，Agent 入口和 overlay 已补 `data-agent-*` 稳定 marker，verifier 已优先验证这些 marker，但完整 data-marker / 导出符号迁移和模块拆分仍后置。 |
`reference-projects-research` 和 `.archive` 当前没有任务，不计入实现队列。

## 2026-07-16 推荐顺序（已失效）

1. `settings-service-unified-protocol`
   - 建立 Rust `SettingsService` 作为单一设置服务。
   - 前端设置页和 MCP 共享同一服务协议，但前端走 Tauri command，外部 Agent 走 MCP tool。
   - 第一阶段禁止迁移主面板热路径。主面板打开、滚动、选中、复制/粘贴反馈必须保持 P95 <= 300ms。
   - 现有治理门禁保持生效，但不把治理脚本升级作为本阶段独立主线。

2. `settings-interface-redesign`
   - 在 P0 的 contract 稳定后重做设置页。
   - 采用侧边栏 + tab/section 的低噪声信息结构。
   - 表单项映射到 toggle group、segmented control、select、switch、slider 等具体控件，不再粗暴展示 JSON 或堆叠输入框。

3. 前端体验整理组
   - archived `onboarding-to-settings-proposal` 已把首次引导迁入设置窗口；`onboarding-standalone-page` 在此基础上把引导拆为独立 `onboarding` 窗口。首期 A 只做独立窗口、设置页轻入口和首启动只弹一次；sidebar 全量常驻、显示兜底和标准化日志按后续 phase 验收。
   - `top-nav-optimization` 迁移底部 Dock 和菜单入口。
   - 本组都必须继承 P0 的 300ms 热路径约束，不得新增启动时阻塞读取或网络检查。

4. 手动验证收尾组
   - `app-internationalization-en-support`
   - `file-image-clipboard-support`
   - `clipboard-multi-format-fidelity`
   - `detail-rich-editor-agent-bridge`
   - `clipboard-agent-panel`
   这些 change 多数已实现，优先补 Tauri dev 手动验证记录，再决定是否归档。

5. 战略扩展组
   - `ai-model-plugin-productization`
   - `vercel-ai-sdk-integration`
   需要先评估是否仍服务于“快速剪贴板工具”的主目标，避免把设置页和主面板变成 AI 控制台。

6. 外部 Hook 运行时方案组
   - `external-hook-plugin-runtime`（2026-07-30 已精简为 Block A/B）
   - **Block A**（读取侧）可推进：先确认 4 态生命周期、节流、熔断、`clipboard.hook.run`；现状 collector 实验代码是只读，可在 Block A 里收敛命名，不扩展写入。
   - **Block B**（写入侧：Proposal/Apply/`content.write`）冻结，等真实用户故事再解冻。
   - 实现必须先保护剪贴板热路径，再接入延迟上下文补写和详情页状态。

7. 演示资产组
   - `project-demo-gif-pipeline`
   - 真实功能演示优先用实录 gif，Remotion 仅作为品牌 intro / onboarding 过渡动画辅路径。
   - 该组不阻塞功能交付；等主面板和 onboarding 首期稳定后再录制最终素材。

8. AI/Agent 后置候选组
   - `local-model-quick-integration`
   - 当前只作为后置候选记录：先评估它与 `ai-model-plugin-productization`、`vercel-ai-sdk-integration` 的边界，再决定是否拆 tasks/spec。
   - 不得因为本地模型、第三方 API Key 导入或 AI 对话面板影响剪贴板捕获、快速面板、搜索、复制回写等核心路径。

9. 后置治理组
   - `codebase-modularity-refactor`
   治理任务只在功能开发触碰对应文件时顺手推进；不单独占用近期多 Agent 功能开发资源。后续校验脚本和结构化 verifier 的规划放在功能主线稳定之后。

## 2026-07-16 Agent 分工（已失效）

| Agent | 范围 | 验收 |
| --- | --- | --- |
| Agent A | `settings-service-unified-protocol` Rust service + Tauri commands | `openspec validate settings-service-unified-protocol --strict`、`cargo check`、主面板不新增 settings/provider 同步调用 |
| Agent B | `settings-interface-redesign` 前端设置页 | `pnpm build`、设置页交互 P95 <= 300ms、tooltip 文案策略不变 |
| Agent C | 剪贴板多格式和详情页手动验证 | Tauri dev 手动验证清单补齐，确认可归档项 |
| Agent D | i18n 收尾 | 中英文切换、系统默认、重启持久化、长文案不溢出 |
| Agent E | AI/plugin 产品化复审 | 先拆 `local-model-quick-integration` 与 P4/P4.1 的边界，不直接实现模型调用 |

多 Agent 执行规则：每个 Agent 完成后必须更新对应 `openspec/changes/<change>/tasks.md`，并同步 `docs/PROPOSAL_ROADMAP.md` / `openspec/project.md` 中的进度或阻塞状态；未完成的 GUI、Tauri dev、外部文档项不得勾选。

## 2026-07-16 多 Agent 计划（已失效）

本计划按功能交付优先，不把治理脚本作为近期独立开发 lane。所有 Agent 可以在独立 worktree 或子任务环境中开发，但最终必须由主协调者复核后合入 `main`，不得绕过当前主分支的脏树安全检查。

| Lane | 负责范围 | 可并行性 | 写入边界 | 完成定义 |
| --- | --- | --- | --- | --- |
| 主协调者 | 依赖排序、冲突复核、主分支集成、最终验证 | 常驻 | `docs/PROPOSAL_ROADMAP.md`、`openspec/project.md`、必要的集成修正 | 每轮合入前 `git status` / `openspec list` 清楚，合入后更新所有相关提案状态 |
| Agent A | `settings-service-unified-protocol` 剩余 GUI 验证和小修 | 第一优先，阻塞 P1 | `openspec/changes/settings-service-unified-protocol/tasks.md`，必要时 `src-tauri/src/settings_service.rs`、`src/services/settings.ts`、`src/settings.tsx` | 剩余 quick 选中/滚动/复制/粘贴 P95、主面板端到端能力能用 Tauri dev 证据证明；不能证明则记录阻塞，不勾选 |
| Agent B | `settings-interface-redesign` 设置页重构 | 依赖 Agent A 服务语义；Context7 恢复前只做不依赖外部 API 的信息架构准备 | `src/settings/`、`src/settings.tsx`、`src/settings.css`、对应 i18n key 和 tasks | 设置页结构、控件映射、状态反馈完成；`pnpm build` 和 OpenSpec validate 通过 |
| Agent C | `onboarding-standalone-page` 与 `top-nav-optimization` | Agent B 之后；两者同一 Agent 串行更安全 | onboarding 首期写 `src/onboarding/`、`onboarding.html`、`open_onboarding_window` 命令、设置页触发按钮；top-nav 写 `src/App.tsx` / panel styles | 首期 A 只要求独立窗口、设置页轻入口、首启动只弹一次且不阻塞功能界面；sidebar/兜底/日志按后续 phase 单独验收；顶部导航不破坏搜索、复制、拖拽和快捷键 |
| Agent D | P2/P3 已实现能力收尾：i18n、file/image、多格式、详情桥、Agent panel | 可与 Agent B/C 并行，主要做验证和小修 | 对应 `tasks.md`、少量 bugfix 文件；不得重构主流程 | Tauri dev 手动验证补齐，能归档的提案归档，不能归档的列明缺口 |
| Agent E | AI/plugin 产品化复审 | 后置，不阻塞剪贴板主线 | `local-model-quick-integration` 仅限 proposal 评审；`src/services/ai-summary.ts`、`src/workspace/ai-summary-panel.*` 等实现文件暂不触碰 | 先判定 local-model 是否合并/替代 P4/P4.1，并补 tasks/spec；不得直接把本地模型、第三方 API Key 导入或真实摘要调用接进详情页或主路径 |

执行节奏：

1. 先由 Agent A 收敛 P0；主协调者只在 P0 验证证据足够时更新状态。
   - hot-path guard 冲突已修复并复跑通过；设置窗口 `settings_changed` 已通过真实 Settings Service 写入探针验证。quick probe 已有 TextEdit / browser 两类受控目标保护，目标未 ready 时必须 skip；当前环境无法自动把 Safari/TextEdit 置前，归档 P0 前仍需补齐可信 quick 选中/滚动/复制/粘贴 P95 和主面板端到端能力证据，不能仅靠静态自动化、skip 样本或不安全前台目标采样归档。
2. Agent D 可并行处理 P2/P3 手动验证，不触碰 Agent B/C 的设置页和主导航写入范围。
3. Agent B 在 P0 语义稳定后进入设置页重构；如果 Context7 仍阻塞 Animate UI 文档，只推进信息架构和本地已 vendored 组件可验证部分。
4. Agent C 必须先做引导独立窗口（`onboarding-standalone-page`），再做 top-nav；引导拆出设置页 tab 后设置页只留触发按钮，避免引导无归宿。
5. 每个 Agent 的提交或补丁进入 `main` 前，必须完成两段复核：先对照对应 OpenSpec spec/tasks 做 spec compliance review，再做代码质量 review；有未解决 review 问题不得合入。
6. 每个 Agent 完成后必须更新：对应 `tasks.md`、`docs/PROPOSAL_ROADMAP.md`、`openspec/project.md`。若完成到可归档状态，主协调者负责 archive 和 `openspec validate --specs --strict`。

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
