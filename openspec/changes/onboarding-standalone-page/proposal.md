# 提案：引导页面独立化（Eco 模式）与设置页配套优化

## 状态

- 优先级：P1.x（首次体验链路 + 设置页信息架构打磨）。
- 阶段：首期 A 已落地实现，待 `pnpm build` / `cargo check` / Tauri 实机验证；后续 B/C（sidebar 常驻、兜底、日志）仍未完成。
- 变更标识：`onboarding-standalone-page`。
- 前置依赖：`frontend-surface-architecture-refactor`（前端 surface 基线）、`settings-service-unified-protocol`（设置读写协议）、archived `onboarding-to-settings-proposal`（已把引导从主面板迁入设置页，本提案在其基础上进一步拆为独立窗口）。

## Why

archived `onboarding-to-settings-proposal` 已经把初次引导从悬浮面板迁入设置页（借鉴 Eco 应用“初始化时引导用户到设置面板”的实践）。但落地后发现三个新问题：

1. **引导塞在设置页 tab 里，空间和焦点都被设置页框架绑架。** 当前 `OnboardingWizard` 是 `shortcut-language` section 下 `onboarding` tab 的内容，受设置页 sidebar + header + 滚动容器约束，无法做成 Eco 风格的沉浸式分步引导。
2. **设置页 sidebar 会折叠成图标条。** `SettingsSidebar` 默认 `collapsible="icon"` 且用 `!absolute` 浮动定位，用户必须点 `SidebarTrigger` 才能展开看全分类，与“设置页应是低噪声、全量可见的信息架构”冲突。
3. **设置页缺少显示兜底和可观测性。** section 加载失败、权限缺失、数据为空、窗口过窄时没有统一 fallback；导航/保存/兜底也缺少标准化日志，问题难以定位。

本提案把引导拆为独立 Tauri 窗口（设置页只留“打开引导”触发按钮），把 sidebar 改为全量常驻，并补齐显示兜底与日志。为避免单个 change 过大，实施按阶段收敛：首期只交付独立引导窗口链路；sidebar 常驻、兜底和日志作为后续 phase，不与首期窗口链路混在同一批验收里。

## 背景

当前实现坐标：

- 引导组件：`src/settings/onboarding-wizard.tsx`，在 `src/settings.tsx` 的 `shortcut-language` section `onboarding` tab 内渲染（`settings.tsx:1020-1031`）。
- 设置页 sidebar：`src/settings/components/SettingsSidebar.tsx`，基于 Animate UI Radix Sidebar，`collapsible` 默认 `"icon"`；`settings.tsx:982-998` 用 `!absolute !inset-y-0 !h-full` 浮动定位，`SidebarTrigger` 在 `SettingsSectionHeader` 里。
- 设置窗口创建：`src-tauri/src/lib.rs::open_settings_window_internal` 用 `WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(...))`；窗口配置在 `src-tauri/tauri.conf.json`（`label: "settings"`，`720x600`，`url: "settings.html"`）。
- 首启动判断：`onboardingCompleted`、`onboardingShownAt` 字段已存在；启动时后台检查辅助功能权限，缺失且未展示过时打开独立引导窗口。

## 目标

### 首期目标（P1.x-A，先做）

1. 新建独立 `onboarding` 窗口（复用 settings 窗口创建模式），承载 Eco 风格的沉浸式分步引导。
2. 设置页移除内嵌 `OnboardingWizard`，只保留一个“打开引导”触发按钮 + 引导完成状态。
3. 首次安装（`onboardingCompleted=false` 且 `onboardingShownAt` 为空）自动判断：打开引导窗口，且不阻塞托盘与主面板快捷键等功能界面。

### 后续目标（同 change 后续 phase）

4. 设置页 sidebar 改为全量常驻展开（`collapsible="none"`，去掉浮动定位），用户一次看全所有分类。
5. 为设置页/引导页补齐显示兜底：加载失败、权限缺失、数据为空、窗口过窄的统一 fallback 与空态。
6. 为设置页/引导页补齐标准化日志（导航、保存、section 切换、性能、兜底命中），遵循项目 JSONL 日志格式。

## 非目标

- 不改变引导的业务步骤内容（欢迎 / 权限 / 采集 / 快捷键 / 功能介绍），只改承载形态。
- 不改变权限检查与设置保存的后端逻辑，复用 `settings-service-unified-protocol`。
- 不重构设置页的整体 surface 契约（仍对齐 `frontend-surface-architecture-refactor` 的区域划分）。
- 不在本提案实现引导内容的 i18n 新增文案（沿用既有 i18n key，缺的按既有流程补）。
- 不引入新的引导框架或动画库（优先复用已 vendored 的 Animate UI / Radix / lucide）。

## 核心设计方向

### 1. 引导拆为独立窗口（Eco 模式）

- 新建 `onboarding` 窗口（`label: "onboarding"`，独立 `onboarding.html` 入口，参考 settings 窗口）。
- `OnboardingWizard` 从 `src/settings/` 迁到 `src/onboarding/`，去掉设置页框架依赖，做成沉浸式分步卡片。
- 视觉借鉴 Eco：独立窗口、分步指示器、权限状态高亮、主/辅按钮层级、淡入淡出切换。

### 2. 设置页只留触发按钮

- `shortcut-language` section 的 `onboarding` tab 内容改为：引导状态摘要（已完成 / 未完成）+ “打开引导”按钮。
- 按钮调用新 Tauri 命令 `open_onboarding_window`（照 `open_settings_window` 模式）。
- 移除设置页内嵌的完整 wizard 渲染。

### 3. 首启动自动判断（推荐策略）

- 应用启动检测 `onboardingCompleted`：
  - `false` → 自动打开 `onboarding` 窗口。
  - `true` → 不自动打开。
- 引导窗口是独立窗口，**不阻塞**托盘菜单和全局快捷键唤起主面板（功能界面照常可用）。
- 用户完成或跳过引导 → 标记 `onboardingCompleted=true` → 关闭引导窗口。
- 设置页的“打开引导”按钮随时可复查引导。

### 4. sidebar 全量常驻

- `SettingsSidebar` 的 `collapsible` 从 `"icon"` 改为 `"none"`。
- 去掉 `settings.tsx` 里 sidebar 的 `!absolute !inset-y-0 !h-full` 浮动定位，改为常规文档流固定宽度常驻。
- `SidebarTrigger` 的折叠语义移除（可保留为视觉占位或删除，见 design）。

### 5. 显示与兜底

- 每个 section 增加统一 fallback：加载中 / 加载失败 / 权限缺失 / 数据为空。
- 窗口过窄时 sidebar 与内容区的响应式降级（不折叠成 icon，而是保证最小可读宽度 + 内容区横向滚动）。
- 权限缺失走 Eco 风格的“明确下一步”提示（跳系统设置 + 刷新检测）。

### 6. 标准化日志

- 设置页/引导页的导航切换、section 渲染耗时、保存结果、性能采样、兜底命中均走 JSONL 标准格式（`{ts,level,module,event,fields,msg}`）。
- `module` 固定为 `settings-window` 或 `onboarding-window`。
- 性能采样沿用 `window.__clipforgePerf`（P95 采样子项 `onboarding.step` / `settings.section` / `settings.changed`）。
- 日志只记摘要与事件，不记设置值原文、权限 token、剪贴板正文。

## 用户价值

1. **首次体验更专注**：引导窗口独立、沉浸，不再被设置页框架挤压，贴近 Eco 等现代 macOS 应用的初始化观感。
2. **设置页更清爽**：sidebar 全量可见，用户一次看全所有分类，无需点展开展开。
3. **功能界面不丢失**：首启动自动弹引导的同时，托盘和快捷键唤起的主面板照常可用。
4. **更健壮**：加载失败、权限缺失、空数据、窄窗口都有明确兜底，不再白屏或错位。
5. **更可观测**：导航/保存/兜底有标准化日志，问题易定位。

## 成功标准

1. 引导在独立 `onboarding` 窗口呈现，设置页内不再渲染完整 `OnboardingWizard`。
2. 设置页 `onboarding` tab 只剩引导状态摘要 + “打开引导”按钮，点击能打开引导窗口。
3. 首次安装（`onboardingCompleted=false`）启动时自动打开引导窗口；托盘与主面板快捷键不受阻塞。
4. 设置页 sidebar 始终全量展开，无 icon 折叠行为，无浮动遮挡。
5. section 加载失败 / 权限缺失 / 数据为空 / 窗口过窄均有 fallback，不出现白屏或布局错位。
6. 导航、保存、兜底命中、性能采样有标准化 JSONL 日志。
7. `pnpm build`、`cd src-tauri && cargo check`、OpenSpec strict 校验通过。
8. `pnpm tauri dev` 验证首启动自动弹引导、引导窗口独立可用、设置页 sidebar 全量可见、兜底与日志正常。

## 与现有方案的关系

| 现有方案 | 关系 |
| --- | --- |
| archived `onboarding-to-settings-proposal` | 继承其“引导迁出主面板”的方向，进一步把引导从设置页 tab 拆为独立窗口 |
| `frontend-surface-architecture-refactor` | 本提案是设置页 surface 的具体演进，区域划分与样式分层以其为基线 |
| `settings-interface-redesign` | sidebar 全量展开与显示兜底对齐其信息架构目标，不冲突 |
| `settings-service-unified-protocol` | 引导与设置读写复用其协议，`onboardingCompleted` 走统一 Settings Service |
| `top-nav-optimization` | 主面板顶部导航与托盘入口不变，仅首启动多开引导窗口 |

## 已确认设计决策（2026-07-30）

- **引导窗口与功能界面**：首启动**只弹引导窗口**，功能界面（主面板 + 托盘 + 全局快捷键）保持可达，不并排打开设置/主面板，避免首启动打开过多窗口。
- **`SidebarTrigger`**：**删除**，折叠语义移除后 header 更简洁。
- **`onboarding.html`**：**独立入口**，隔离样式与依赖，避免设置页 bundle 变大。
- **引导窗口尺寸**：**固定 `640x560`，`resizable: false`**，保证分步布局稳定。
- **首启动中间态**：**引入 `onboardingShownAt` 时间戳**，已展示但未完成时不再自动弹，用户可从设置页触发按钮手动重入。
