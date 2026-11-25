# App 面板状态 Store 化授权提案

## 状态

- 阶段：dormant。方案已细化，但未获授权实施；本提案不授权任何代码变更。
- 关联任务：`backlog/tasks/task-11 - 还债拆分：App.tsx-settings.tsx-lib.rs-按-TDD-切片清零.md` 验收项 6。
- 关联变更：`codebase-modularity-refactor`。该变更的 S6 已取消，原因是 800 行目标已达成；本提案只用于重新评估“是否值得为状态订阅粒度再付一次迁移成本”。
- 审核结论：复审确认保留细化方案作为后续候选，继续保持 dormant；先实施其他功能提案。
- 当前结论：未授权实施。只有用户后续明确选择授权，才可添加任务并开始编码。

## 背景

`src/App.tsx` 已从 1643 行降到 783 行，低于 TASK-11 放宽后的 800 行上限。剩余状态粘合层由约 20 个 `useState` 和 20 个 `useRef` 组成，负责面板视图、选中、多选、键盘导航、预览、滚动恢复以及事件期同步。

现有拆分没有引入新的状态库：

- `src/stores/workspace-store.ts` 只保存当前路由（`list` / `detail` / `aggregate`）。
- `src/clipboard/panel-shared.ts` 的 `usePanelUiStore` 只保存 `isClosing`，且面板淡出已迁到 Rust，该状态已不再驱动 UI。
- 其余状态仍留在 `src/App.tsx`，通过 props 传给 hooks 和组件。

`AGENTS.md` 当前规定：Zustand 仅用于跨组件 UI 状态；业务数据仍由 Tauri command 驱动。TASK-11 验收项 6 明确要求“App.tsx 状态 store 化须经盟哥明确授权；未授权则保持未勾选并说明只能拆到约 800 行”。

## 问题

当前状态粘合层有三个真实成本：

1. **props 传递面大**：`src/App.tsx` 把视图、选中、多选、键盘、预览、滚动状态传给多个 hooks 和路由组件；新增字段会扩大多处接口。
2. **事件顺序敏感**：`selectedIdRef`、`keyboardNavigatingRef`、`activeGroupStartRef` 等引用与 React state 双写，键盘导航、分组滚动、写回抑制依赖同一轮事件中的最新值。
3. **性能归因困难**：面板是热路径，show/hide、焦点和列表渲染都经过这些状态；任何订阅粒度变化都可能造成额外重渲染，必须做真机验证，静态门禁覆盖不足。

但这些问题尚未阻止 TASK-11 达成 800 行目标，也没有证据表明当前 props 方案已经造成用户可见故障。

## 收益

这次 store 化不是把 `useState` 换个位置，而是给面板会话状态建立明确的读写边界。收益有三项：

1. **降低状态双写故障面**：`selectedId` / `selectedIdRef`、`multiSelectMode` / `multiSelectModeRef`、`keyboardNavigating` / `keyboardNavigatingRef` 等成对状态目前靠人工保证同步；store 用动作统一写入，同步 getter 保留事件期即时读取，减少“state 已更新但 ref 还是旧值”的竞态。
2. **缩短 props 传递链**：视图、选择、预览、滚动目标等状态不再经 `App.tsx` 逐层传给 hooks 和路由组件；组件按字段订阅，新增字段不再要求多处接口同步修改。
3. **给性能归因建立边界**：TASK-7 的 show/hide 延迟尚未闭环。迁移前后的探针数据若发生变化，可以按 store 域定位，而不是在几十个 props 和 refs 中排查。

不承诺仅凭 store 化就降低 show/hide 延迟；收益来自状态边界与可维护性，性能必须靠迁移前后实测证明没有回归。

## 目标

若获授权，本提案只解决跨组件 UI 状态的订阅与写入边界：

- 把被多个组件或 hooks 共同读写的面板会话状态集中到一个窄接口 store。
- 保持事件顺序不变；需要同步读取的状态提供 store getter，避免把事件期引用误改成会触发重渲染的 state。
- 保持 `src/App.tsx` ≤ 800 行，并让状态字段有明确归属，不再新增“只传一层”的 props。
- 不把性能回归转嫁给后续任务：迁移前后必须有可比的面板探针结果。

## 非目标

- 不迁移剪贴板业务数据：`clips`、`settings`、`searchRequest`、`nextCursor`、`filePathStatuses`、`aggregateFormat` 保持现状。
- 不迁移纯事件期引用：`captureInFlightRef`、`lastSeenClipboard`、`scrollAccelRef`、`panelFocusGraceUntilRef`、`blurHideInFlightRef`、`focusRetryTimersRef`、`panelShowStartedAtRef` 保持现状。
- 不把全量 `useState` / `useRef` 机械搬进全局 store；约 30 个字段不是迁移清单，而是分类依据。
- 不新增依赖，不引入持久化，不改变 Tauri command，不改变 UI 文案或视觉。
- 不进入 MCP、agent、插件、搜索或标签能力范围。
- 不在 TASK-7 的面板性能基线稳定前开始实施，否则无法区分 store 迁移和既有 show 延迟的回归来源。

## 状态分类

### 保持本地

| 字段 | 原因 |
|---|---|
| `settings` / `settingsRef` | 业务设置，由 Tauri command 与设置页同步。 |
| `clips` / `clipsRef` | 剪贴板业务数据。 |
| `nextCursor` / `isLoadingMore` | 列表分页与业务加载状态，服务 `useClipboardList`。 |
| `filePathStatuses` | 多选导出路径复核的业务派生状态。 |
| `searchRequestRef` / `filteredClipsRef` | 搜索请求与派生列表引用。 |
| `captureInFlightRef` / `lastSeenClipboard` | 采集去重与在途标记。 |
| `shellRef` / `focusRetryTimersRef` | DOM 句柄与计时器资源。 |
| `panelFocusGraceUntilRef` / `blurHideInFlightRef` / `panelShowStartedAtRef` | 面板显隐事件期同步，必须即时读写，不应触发订阅。 |
| `programmaticGroupUntilRef` / `restoreScrollTokenRef` / `scrollAccelRef` | 程序化滚动的短时窗口，生命周期属于交互 hook。 |

### Store 候选

| 字段 | 归属 | 理由 |
|---|---|---|
| `activeView` / `activeSurface` | 面板会话 store | 多处决定列表、详情、聚合与顶部工具栏行为。 |
| `selectedId` / `selectedIds` | 面板会话 store | 列表、详情、多选导出共同读写；需要原子选择动作。 |
| `multiSelectMode` | 面板会话 store | 影响行操作、快捷键、详情入口；与 `selectedIds` 同事务。 |
| `keyboardNavigating` | 面板会话 store | 键盘 hook 与列表滚动共同读写。 |
| `activeGroupStart` / `groupScrollTarget` | 面板会话 store | 分组滚动的会话状态，避免多处 props 同步。 |
| `isMultiPreviewOpen` / `quickPreviewOpen` | 面板会话 store | 浮层打开状态由多处动作触发。 |
| `isPanelEntering` | 面板会话 store | 唤起事件决定动画门控，面板根节点消费。 |
| `nativeStatus` | 保持本地 state；审核选择“不纳入，保持本地 state”，且状态栏写入点分散，迁移收益不足。 |

`selectedIdRef`、`multiSelectModeRef`、`keyboardNavigatingRef`、`activeGroupStartRef` 不单独作为字段迁移，而由 store 的同步 getter 替代。迁移必须逐项证明事件顺序不回退。

## 模块设计

### interface

新增 `src/clipboard/panel-session-store.ts`，导出一个 Zustand store。公共类型使用中文文档注释，说明用途、边界和同步/异步语义。

接口只暴露会话动作，不暴露原始 setter：

- `setSurface(surface: PanelSurface)`：切换主功能面。
- `setView(view: ViewKey)`：切换历史/片段等视图。
- `selectOne(id: string | null)`：单选并退出多选。
- `toggleSelected(id: string)`：多选切换；维持 `selectedIds` 与 `multiSelectMode` 一致。
- `clearSelection()`：清空选择和多选模式。
- `setKeyboardNavigating(active: boolean)`：标记键盘导航窗口。
- `setActiveGroupStart(start: number)`：更新当前分组起点。
- `setGroupScrollTarget(target: number | null)`：设置程序化滚动目标。
- `openMultiPreview()` / `closeMultiPreview()`：管理多内容预览。
- `openQuickPreview()` / `closeQuickPreview()`：管理快速预览。
- `markPanelEntering(entering: boolean)`：设置入场动画门控。
- `nativeStatus` 不进入 store；状态栏仍由现有本地 state 管理。
- 同步 getter：`getSessionSnapshot()`，返回当前会话只读快照，供键盘和滚动事件读取。

### implementation

- 使用已安装 Zustand；不引入 middleware、persist 或 immer。
- store 内不持有任何 `ClipItem`、`AppSettings`、`SearchClipsRequest` 或 Tauri 返回对象。
- `selectedIds` 使用 `Set<string>`；每次动作返回新 Set，避免订阅者漏更新。
- 动作负责不变量：`multiSelectMode` 为真时 `selectedIds` 至少一项；`selectOne` 清空多选集合；`clearSelection` 同时复位键盘导航临时标志。
- getter 只返回快照，不提供可变引用。事件期需要同步读值，不允许用 React state 的异步值替代。

### seam / adapter

- 第一阶段只让 `src/App.tsx` 订阅 store 并通过现有 props 下传，组件接口不变，便于回滚。
- 第二阶段逐个把 hooks/组件改为直接订阅所需字段，并删除对应 props；一次只迁移一个域。
- `usePanelUiStore` 的 `isClosing` 保持原样，不并入新 store；它属于遗留关闭动画状态，合并会增加无收益改动。
- 若审查认为必须合并，则先完成本提案再单独开变更；不在实施中顺手改。

## 分期计划

### 阶段 0：前置条件

- 修复 TASK-7 的 show/hide 探针基线，确认机器解锁且稳定版/沙箱口径明确。
- 保持 `nativeStatus` 为本地 state，不收敛其异步写入点。
- 固定 TASK-7 探针口径：同一台解锁机器、同一构建、同一数据目录；先测基线，再逐阶段测量。

### 阶段 1：建立 store 与静态契约

- 新增 store 文件与类型导出。
- 加一个静态门禁：禁止 store 文件出现 `ClipItem`、`AppSettings`、`SearchClipsRequest` 等业务类型。
- 保持 `src/App.tsx` 行为不变；只切换 store 的内部读写适配器。

### 阶段 2：选择与会话域迁移

- 先迁移 `selectedId`、`selectedIds`、`multiSelectMode`，这是最容易因双写产生故障的一组。
- 再迁移 `keyboardNavigating`、`activeGroupStart`、`groupScrollTarget`，验证键盘导航和分组滚动。
- 最后迁移预览、视图、surface 与 `isPanelEntering`。

### 阶段 2.5：静态边界门禁

- 新增静态检查，确认 `panel-session-store.ts` 不导入业务类型，不暴露原始 setter，`nativeStatus` 不在 store 中。
- 确认 `usePanelUiStore.isClosing` 不被并入新 store；它属于淡出动画遗留状态，合并无收益。
- 门禁只验证边界，不替代交互与性能真机验证。

### 阶段 3：清理 props 与旧引用

- 删除已由 store 订阅替代的 props 和同步 `useRef`。
- 目标：`src/App.tsx` 降到 700 行以内，且没有文件因迁移超过 500 行（豁免清单只减不增）。
- 更新 `docs/BUSINESS_INDEX.md` 和 `pnpm locate` 所需中文注释。

### 阶段 4：验证与回滚

- 静态门禁：`pnpm build:web`、`pnpm test:unit`、`cd src-tauri && cargo check`、`openspec validate --all --strict`。
- 真机门禁：解锁状态下跑 `pnpm test:perf-panel`；show/hide 平均与最差都 ≤180ms，幻影 blur 自愈通过。
- 交互门禁：键盘上下选、分组滚动、多选、详情、快速预览、复制写回、关闭后重开。
- 回滚边界：每个阶段单独提交；若 perf 或交互回归，回退该阶段提交，不继续叠加迁移。

## 风险

| 风险 | 缓解 |
|---|---|
| store 订阅粒度导致额外重渲染 | 组件只订阅需要的字段；动作保持原子；先迁移选择域并用探针验证。 |
| 事件期引用改成 state 后读到旧值 | 保留同步 getter；禁止把 `selectedIdRef` 等直接改成订阅值。 |
| 与 TASK-7 性能修复相互污染 | TASK-7 基线稳定前不开始；每阶段独立提交和测量。 |
| 多选状态不变量被破坏 | 动作集中维护 Set 与模式；补静态门禁和交互门禁。 |
| 为迁移而迁移，收益不足 | 若阶段 2 后 `src/App.tsx` 无法低于 700 行或探针不达标，停止后续迁移并报告。 |

## 验收标准

- `nativeStatus` 保持本地 state；store 接口和实现均不暴露状态栏字段。
- store 文件不包含任何业务数据类型，不新增依赖。
- `src/App.tsx` ≤ 700 行；其余新增或修改的非豁免文件 ≤ 500 行。
- `pnpm build:web`、`pnpm test:unit`、`cd src-tauri && cargo check`、`openspec validate --all --strict` 全绿。
- 解锁状态下 `pnpm test:perf-panel` 全项通过，show/hide 平均与最差均 ≤180ms。
- 手动验证键盘导航、分组滚动、多选、详情、预览、写回和重开流程。
- TASK-11 验收项 6 只在上述条件全部满足后勾选。

## 审核结论

复审确认：保留细化方案作为后续候选，继续保持 dormant；先实施其他功能提案。`nativeStatus` 按审核选择保持本地 state。本次确认不构成实施授权。
