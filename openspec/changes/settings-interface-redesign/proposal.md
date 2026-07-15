# 提案：设置页信息架构与交互组件重构

## 优先级

P0.7。该能力应跟随 `app-internationalization-en-support` 之后推进，优先服务公开分发前的可用性和可信度。设置页是用户首次配置快捷键、权限、采集范围、MCP 接入和更新能力的主要入口，当前混乱程度会直接影响 ClipForge 作为剪贴板工具的第一印象。

## 背景

当前 `src/settings.tsx` 把设置页渲染集中在一个大型组件里，侧边栏、配置项、状态卡片、代码示例、导出排查包、MCP 安装提示和 Agent provider 模板混排在同一套 `setting-row` / `permission-card` 样式中。

主要问题：

- 侧边栏只是粗粒度按钮列表，视觉重量偏重，分组层级和当前页状态不够明确。
- 表单项大多是原始行渲染，布尔、枚举、数值、路径、代码示例和危险动作没有对应的交互控件映射。
- 设置分类内缺少二级组织，用户需要在长页面里寻找具体配置。
- MCP / Agent / JSON-RPC 示例直接用 `<pre>` 堆叠，不利于比较、复制和阅读。
- Tooltip 内容和展示策略需要保留，但底层实现应统一到 Animate UI Tooltip，避免多套提示样式。
- 导出、复制、更新、清理等动作语义需要重新归类，不能呈现为打印式或杂项按钮集合。

## 目标

1. 重构设置页信息架构，使用 Animate UI Radix Sidebar 作为设置窗口主导航骨架，让侧边栏更轻、更清晰、更适合桌面工具。
2. 在每个设置分类内部使用 Animate UI Tabs 承载子项，减少长滚动和混乱卡片堆叠。
3. 将全部表单项映射到语义控件，而不是粗暴显示：
   - 枚举项使用 Animate UI Radix Toggle Group 或 Tabs。
   - 布尔项使用 Switch 或 Toggle Group 的二选一表达。
   - 数值项使用 Slider、Stepper 或 Number Input，并展示单位和边界。
   - 路径和只读状态使用只读 Field、Copy Button 和 Tooltip。
   - 代码、JSON、命令和 MCP 示例使用 Animate UI Code Tabs。
4. 将项目现有 Tooltip 内容和显示策略迁移到 Animate UI Tooltip，保留文案、延迟、位置和触发语义。
5. 梳理导出、复制、更新、清理等动作命名和位置：
   - `导出排查包` 归入诊断动作，不和普通配置保存混在一起。
   - `复制 JSON 模板`、`复制给 Agent 的安装提示` 归入接入示例动作。
   - 更新检查、下载、安装、忽略保持更新流程语义，不表现为打印或杂项导出。
6. 保持 ClipForge 的工具型风格：中性、克制、高密度但不拥挤，优先清晰层级和稳定交互。

## 实现策略决议（彻底重构，非增量）

本提案确立为**一次性彻底重构**，而不是在现有 `src/settings.tsx` 上做增量贴补。权威组件来源（实现前以这两份文档为准刷新 API）：

- 侧边栏**整体替换**为 Animate UI Radix Sidebar：`https://animate-ui.com/docs/components/radix/sidebar`
- 每个一级分类内部**整体替换**为 Animate UI Tabs：`https://animate-ui.com/docs/components/animate/tabs`

彻底重构的三个"整换"：

- 侧边栏不再是当前的粗按钮列表 + motion 指示条，而是完整的 Radix Sidebar 骨架。
- 每个分类内部不再是长滚动卡片堆叠，而是 Tabs 承载子项。
- 全部表单控件重建为语义化表单项（Toggle Group / Switch / Slider / Number Field / Readonly Field / Code Tabs / Status Panel），不再统一塞进 `setting-row`。

**作废声明**：前期为降风险做的增量试探（`src/settings/controls.tsx` 里的 ToggleGroup 控件、侧边栏 `motion.layoutId` 活跃指示条，对应提交 `4e54f24`/`28f2e39`/`f69c703`）只是过渡产物，方向上已被本提案的彻底方案取代。彻底重构落地时，这些增量产物会被替换或删除，不作为长期基线保留。

**节奏**：彻底重构的实现可以往后放（不阻塞当前功能开发），但**本提案是设置页改版的唯一方向源**。后续动工时按本提案一次性完成侧边栏、内部 Tabs 与全部表单控件，不再走 design.md 早期"先在主文件局部抽组件、避免一次性迁移"的增量路径（该路径已被本节否决）。

## 非目标

- 不改变设置项背后的 Rust command、配置字段或持久化语义。
- 不在本提案内实现新的 Agent provider 管理平台。
- 不扩大 MCP 能力面，不改变 `clipf.*` 工具命名。
- 不在本提案内收敛设置读写协议；统一服务协议拆到 `settings-service-unified-protocol`。
- 不重排快速面板主工作流，不调整剪贴板列表、详情页或搜索结果交互。
- 不引入大型设计系统或与当前 shadcn 风格冲突的全局主题。

## 用户价值

- 新用户能更快完成快捷键、辅助功能、采集范围和更新配置。
- 高级用户能在 MCP / Agent 接入区清楚区分命令、JSON-RPC、provider 模板和当前工具状态。
- 设置页不再像调试面板，而像稳定的桌面工具偏好设置。
- 表单控件能表达设置本身的交互含义，减少误操作和阅读成本。

## 参考组件

实现阶段需要基于当前 Animate UI 文档刷新 API，Context7 在 2026-07-14 查询时返回月度额度已用完，后续开发前需通过 `npx ctx7@latest login` 或 `CONTEXT7_API_KEY` 重新拉取文档。

本提案的组件方向（已标注本地 vendored 状态，截至 2026-07-15）：

- Animate UI Tabs: `https://animate-ui.com/docs/components/animate/tabs` —— ✅ 已 vendored（`src/components/animate-ui/components/animate/tabs.tsx`）
- Animate UI Code Tabs: `https://animate-ui.com/docs/components/animate/code-tabs` —— ❌ 待 vendor
- Animate UI Tooltip: `https://animate-ui.com/docs/components/animate/tooltip` —— ✅ 已 vendored（`src/components/animate-ui/primitives/animate/tooltip.tsx`）
- Animate UI Radix Sidebar: `https://animate-ui.com/docs/components/radix/sidebar` —— ❌ 待 vendor（彻底重构的主导航骨架）
- Animate UI Radix Toggle Group: `https://animate-ui.com/docs/components/radix/toggle-group` —— ✅ 已 vendored（`src/components/animate-ui/components/animate/toggle-group.tsx`）

## 依赖关系

- 依赖 `app-internationalization-en-support` 的设置页文案 key 收口，新增 visible copy 必须接入 i18n。
- 可复用当前已存在的 `motion`、`radix-ui`、`@floating-ui/react`、`lucide-react` 和本地 `src/components/animate-ui/primitives/animate/tooltip.tsx`。
- 需要补齐本地 Animate UI 组件：**Radix Sidebar、Code Tabs**（Tabs / Tooltip / Toggle Group 已 vendored），并按项目路径归档到 `src/components/animate-ui/`。
- 与 `settings-service-unified-protocol` 并行推进：本提案只定义界面如何消费统一服务，不定义服务协议本身。
- 不阻塞 `github-release-update-distribution`，但应覆盖更新设置区的展示质量。

## 成功标准

- 设置页主导航由 Sidebar 承载，分类、当前态、可滚动区域和焦点状态清楚。
- 每个设置分类内部至少按 `基础`、`高级`、`状态`、`示例` 或同等语义拆分 Tabs。
- 全部配置项都有语义控件映射，不再把枚举、布尔、数值、路径、代码示例全部塞进同一种行样式。
- MCP、Agent provider、JSON-RPC 等代码示例使用 Code Tabs 展示，支持复制并保留可读换行。
- Tooltip 内容和触发策略保持不变，但底层统一使用 Animate UI Tooltip。
- 导出、复制、更新、清理动作在视觉和文案上区分主要动作、辅助动作、诊断动作和危险动作。
- `pnpm build`、`cd src-tauri && cargo check` 通过；若涉及桌面窗口交互，还需补 `pnpm tauri dev` 手动验证记录。
