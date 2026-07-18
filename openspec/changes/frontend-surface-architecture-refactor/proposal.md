# 提案：前端 Surface 架构、路由拆分与样式系统重整

## 优先级

P1。当前主面板、设置页、详情页和 Agent 面板的功能已经扩展到多个 surface，但代码和样式仍集中在少数超长文件里。继续在 `src/App.tsx`、`src/App.css`、`src/settings.tsx` 末尾追加局部修复，会继续放大回归风险，尤其是主列表选中、顶部菜单、设置页组件库样式和 Agent 覆层。

本提案是整合开发前的结构方案：先确定页面布局、路由边界、组件系统、业务分层、样式与主题分层，再按可验证阶段迁移。

## 背景

当前前端已经具备一些正确方向：

- `src/components/ui/` 有 shadcn 风格基础组件。
- `src/components/animate-ui/` 已接入 Animate UI / Radix 组合组件。
- `src/routes/workspace-router.tsx` 已使用 `@tanstack/react-router` 为 workspace detail / aggregate 建立内存路由。
- `src/settings/settings-field-catalog.ts` 已建立设置页字段目录和信息架构雏形。
- `openspec/changes/main-panel-functional-layout-plan/design.md` 已定义主面板 `TopCommandBar / ModeBar / ClipboardList / OverlayLayer` 布局。

但这些方向还没有形成统一架构：

- `src/App.tsx` 同时承载主面板状态、搜索、列表、虚拟滚动、上下文菜单、Agent overlay、workspace 渲染和设置窗口入口。
- `src/App.css` 多轮 `P-FINAL` 覆盖堆叠，同一类名被多次重写，样式来源不可追踪。
- `src/settings.tsx` 虽然接入 Sidebar / Tabs，但仍手写大量 section/tab 内容，字段目录没有驱动渲染层。
- Agent、workspace detail、AI 摘要、设置页和主列表样式混在全局 CSS 中，surface 边界不清。
- 现有 `codebase-modularity-refactor` 负责文件规模和门禁，但没有完整定义路由、页面布局、主题 token 和组件分层。

## 目标

1. 建立前端分层契约：基础组件、组合组件、业务组件、surface 页面、业务服务、状态 hooks 各自有边界。
2. 引入统一的路由拆分策略：使用现有 `@tanstack/react-router` 作为页面/surface 路由边界，支持设置页、workspace、Agent 独立切分。
3. 重整主面板布局：按 `TopCommandBar / ModeBar / ClipboardList / StatusFeedback / OverlayLayer` 拆出组件，保护复制、选中、滚动、搜索热路径。
4. 重整设置页：让字段目录驱动常规字段渲染，复杂面板保留专用组件，减少 `settings.tsx` 手写分支。
5. 重整样式系统：主题 token、组件样式、surface 样式、状态样式分层，停止在 `App.css` 追加全局覆盖。
6. 优先依赖成熟组件库：shadcn/Radix/Animate UI/Tailwind token，避免自写重复的 Sidebar、Tabs、Tooltip、Dropdown、Button、Input、Switch 等基础控件。
7. 明确定义业务功能区、主要页面布局、入口关系、交互优先级和状态反馈，避免后续反复改版。
8. 输出可执行拆分阶段和验收标准，后续开发按阶段整合，不做一次性大重写。

## 非目标

- 不在本提案内直接实现所有拆分代码。
- 不改变剪贴板采集、复制回写、删除、收藏、搜索、文件检查等业务语义。
- 不把主面板改成 AI 工作台或营销首页。
- 不引入第二套路由框架、第二套状态管理库或重型 UI runtime。
- 不要求一次性删除 `App.tsx` / `App.css`，但新增和触碰代码必须逐步迁出。
- 不在 Context7 quota 恢复前声明外部库最新 API 细节；路由方案先基于当前仓库已安装的 `@tanstack/react-router` 和现有实现。

## 用户价值

- 主面板继续保持剪贴板工具的高密度热路径，不被 Agent、设置或详情页污染布局。
- 设置页更像稳定的工具配置界面，字段和复杂动作各自内聚。
- 后续新增功能能落到明确 surface，不再把所有功能塞进 `App.tsx`。
- 样式回归更容易定位：哪个 surface 出问题就看哪个 CSS module 或 surface CSS。
- 新接手者能通过目录结构理解产品结构，而不是靠全文搜索。

## 业务功能区基线

本提案确认以下业务功能区作为后续开发基线。后续新增页面或功能必须先归入其中一个 surface；如果无法归类，需要先更新本提案或新增 OpenSpec，而不是直接塞进 `App.tsx`。

| 功能区 | 定位 | 主要入口 | 交互优先级 |
| --- | --- | --- | --- |
| 快速剪贴板区 | Clipy 等价热路径；历史、收藏、搜索、回收站、复制/粘贴、多选 | 全局快捷键、托盘、主面板默认 route | P0，必须最轻、最快、首屏可用 |
| 内容详情区 | 单条 clipboard item 的二级查看、预览、编辑、来源、标签和 AI 摘要 | 列表 `ArrowRight`、进入详情、详情按钮 | P1，辅助主列表，不反向影响列表 |
| 设置管理区 | 配置、权限、显示、采集、存储、MCP/Agent、更新和诊断 | 顶部菜单 Settings、设置窗口 route | P1，独立窗口/route，不进入主面板热路径 |
| Agent 辅助区 | 基于当前 clip 或多选上下文的辅助处理、引用、工具调用和结果写回 | 顶部 Agent 按钮、快捷键、详情辅助入口 | P2，增强层，不是主入口 |
| 系统状态区 | 复制、删除、恢复、保存、权限、文件缺失、provider 缺失等反馈 | 各 surface 内部统一 feedback shell | P0/P1，短反馈、不遮挡、不改变列表滚动 |

## 交互体验基线

- 主面板打开后，焦点优先落在搜索框或当前选中行；键盘和鼠标路径必须等价可达。
- 搜索结果直接替换主列表内容，不进入二级页面。
- `Enter` 执行复制/粘贴热路径；`ArrowRight` 只进入详情；`Ctrl/Cmd+J` 才打开 URL/path。
- 多选只展示稳定 ModeBar 或等价动作区，不改变行高、不重置滚动位置。
- 详情和 Agent 使用 overlay/route surface，关闭后恢复主列表焦点和选中上下文。
- 设置页必须独立承载配置和诊断，不把复杂表单、provider 状态或更新检查塞进主面板。
- 所有状态反馈必须短、小、可恢复；错误文案说明下一步动作，不做模糊失败提示。
- 组件和样式优先复用成熟组件库和主题 token，禁止为单个功能新增一套并行基础控件。

## 成功标准

1. 新增前端架构 spec，明确组件分层、路由边界、样式分层和主功能页面布局。
2. 后续实现中，新增前端源文件默认 <= 500 行，触碰豁免文件时必须同步迁出相关职责。
3. 主面板拆分后仍满足：搜索可输入、列表可选中、滚动稳定、Enter/点击复制、右键菜单、详情进入、Agent overlay 可打开和关闭。
4. 设置页拆分后仍满足：Sidebar 折叠、Tabs 切换、字段保存反馈、MCP/Agent code tabs、诊断/危险动作反馈。
5. 样式拆分后，设置页样式不影响主面板 dropdown / quick-row，主面板样式不影响 Agent chat / workspace detail。
6. 历史视觉/布局提案被本提案吸收后，先在路线图中标记为 superseded；确认无引用后再删除或归档遗留文档。
7. `pnpm exec tsc --noEmit`、相关 verifier、`pnpm openspec validate frontend-surface-architecture-refactor --strict` 通过。

## 与现有提案关系

| 提案 | 关系 |
| --- | --- |
| `codebase-modularity-refactor` | 本提案复用其 500 行门禁和中文注释规范，但补充路由、surface 布局和样式系统方案。 |
| `main-panel-functional-layout-plan` | 本提案把其主面板区域规划转成组件和目录拆分策略。 |
| `quick-panel-visual-regression-recovery` | 该提案仍优先处理现有视觉回归；本提案避免后续继续用全局覆盖制造新回归。 |
| `settings-sidebar-component-library-recovery` | 已完成设置页 Sidebar 组件库壳层；本提案继续推进字段渲染和样式层收口。 |
| `vercel-ai-sdk-integration` / `ai-model-plugin-productization` | AI 能力只能进入 Agent/Detail 辅助 surface，不得侵占主列表热路径。 |
