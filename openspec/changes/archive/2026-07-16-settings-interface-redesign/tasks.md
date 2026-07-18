# 任务：设置页信息架构与交互组件重构

## Phase 0：作废增量基线

- [x] 确认 `src/settings/controls.tsx`（ToggleGroup 控件）、侧边栏 `motion.layoutId` 活跃指示条（提交 `4e54f24`/`28f2e39`/`f69c703`）为过渡产物，彻底重构中替换或删除
- [x] 不在 Inc1-4 增量产物上继续叠加；以本提案彻底方案为唯一基线

## Phase 1：依赖与边界确认

- [ ] 使用 Context7 重新拉取 Animate UI **Radix Sidebar、Code Tabs** 当前文档（Tabs / Tooltip / Toggle Group 已 vendored，仅需核对其 API 是否漂移）
- [x] 确认本地已 vendored：Tabs、Tooltip、Toggle Group；待 vendor：Radix Sidebar、Code Tabs
- [x] 补齐缺失的 Animate UI 组件（Radix Sidebar、Code Tabs）到 `src/components/animate-ui/`
- [x] 确认新增依赖是否已经存在于 `package.json`，缺失时先列安装命令再引入（Radix Sidebar 通常依赖 `radix-ui` 或对应 `@radix-ui/react-*`）
- [x] 确认本提案不改变 `AppSettings`、Rust command 和配置持久化语义
- [x] 合并 `settings-field-refactor` 的最小 `SettingFieldConfig` catalog 决策，不引入 `json-render` 或第二套 schema runtime
- [x] 新增 `src/settings/settings-field-catalog.ts`，以最小 catalog 固化一级分类、二级 tabs、字段类型和 i18n key 映射
- [x] 新增设置域 `SettingsSidebar` / `SettingsCodeTabs` 组件基线，供后续彻底重构消费；不冒充已完成官方 Radix Sidebar / Animate UI Code Tabs vendor

## Phase 2：设置页信息架构

- [x] 重组 `SECTIONS` 为新的一级分类
- [x] 引入 Settings Sidebar，替换当前粗按钮式侧边栏
- [x] Sidebar 项保留图标和文案，当前态、hover、focus 态清晰
- [x] 内容区域新增 Section Header 和 Sticky Status Bar
- [x] 每个一级分类内部接入 Animate UI Tabs
- [x] 移除设置内容中的长滚动堆叠，按子项拆分到 Tabs

## Phase 3：表单控件映射

- [x] 将 `SegmentSetting` 迁移为 Animate UI Radix Toggle Group
- [x] 将 `language`、`panelDensity`、`contentDisplayMode`、`tagMode` 接入 Toggle Group
- [x] 将布尔项统一到 Switch 或多选 Toggle Group
- [x] 将数值项拆成 Slider + Number Input 或 Number Field
- [x] 为路径项提供只读 Field、复制动作和 Tooltip
- [x] 为状态项提供统一 Status Panel
- [x] 保证所有表单控件有可见 label、键盘可达和 disabled 状态

## Phase 4：MCP、Agent 与代码示例

- [x] 用 Code Tabs 重构 `manual` 和 `integration` 内的 MCP 示例
- [x] 将 Agent 安装提示、MCP 命令、JSON-RPC、Provider JSON 拆为独立 code tab
- [x] 为每个 Code Tab 提供复制按钮和成功反馈
- [x] 保留当前 `copyMcpCommand` 和 `copyAgentProviderTemplate` 的业务语义
- [x] 避免代码块撑高页面，代码区域内部滚动

## Phase 5：Tooltip 与动作语义

- [x] 用 Animate UI TooltipProvider 包裹设置页
- [x] 将 icon-only、路径截断、危险动作、诊断导出和复制动作接入 Tooltip
- [x] 保留 tooltip 内容和触发策略，不新增页面说明噪音
- [x] 将动作分为主要、辅助、诊断、危险四类
- [x] `导出排查包` 放入诊断 Tab，和普通配置项分离
- [x] 清理日志和重置权限动作提供危险态或确认态

## Phase 6：视觉与响应式

- [x] 统一设置页 token：背景、边框、文本、muted、accent、danger、radius
- [x] 侧边栏减轻视觉重量，避免粗大按钮和大色块
- [x] 控件高度、内边距和间距使用 4px / 8px 节奏
- [x] 适配 900x640、1200x760、720x640 窗口
- [x] Reduced Motion 下关闭 Tabs 和 Tooltip 的位移动效

## Phase 7：国际化与文案

- [x] 新增设置页可见文案全部接入 i18n key
- [x] 中文文案保持工具语义，不使用打印、报告生成等不准确表达
- [x] 英文文案和中文 key 同步补齐
- [ ] 运行硬编码文案检查脚本并处理白名单

## Phase 8：验证

- [x] `pnpm exec tsc --noEmit` 通过
- [x] `pnpm run check:i18n` 通过
- [x] `pnpm build` 通过
- [x] `cd src-tauri && cargo check` 通过
- [x] `pnpm tauri dev` 验证设置窗口打开、Sidebar 切换和 Tabs 切换
- [x] `pnpm tauri dev` 验证 Toggle Group、Switch、Slider、Number Field 能保存设置
- [x] `pnpm tauri dev` 验证 Code Tabs 复制 MCP / JSON / Provider 模板
- [x] `pnpm tauri dev` 验证 Tooltip、键盘导航和 Escape 关闭
- [x] `pnpm tauri dev` 验证导出排查包、清理日志、更新流程位置和状态反馈正确

### Phase 1/7/8 复跑记录（2026-07-16）

- 已重试 `npx ctx7@latest library "Animate UI" "ClipForge settings-interface-redesign needs current Animate UI Radix Sidebar and Code Tabs documentation"`：失败，Context7 返回 `Monthly quota exceeded`；因此仍不能勾选 Animate UI Radix Sidebar / Code Tabs 当前文档拉取任务。
- 已复跑 `pnpm check:i18n`：通过，`zh-CN.json` / `en-US.json` 共 763 个 key 对齐，引用检查覆盖 582 个 key。
- `scripts/scan-hardcoded-copy.mjs` 仍输出 208 个 hardcoded user-copy candidates；本轮未逐项收敛或扩展白名单，因此不勾选“运行硬编码文案检查脚本并处理白名单”。
- 已复跑 `pnpm exec tsc --noEmit`：通过。
- 已运行 `pnpm openspec validate settings-interface-redesign --strict`：通过。
- 已运行 `node scripts/verify-settings-surface.mjs`：通过；已用源码级 probe 覆盖设置窗口初始导航、Sidebar/Tabs、Toggle/Slider/Number 的保存 wiring、Code Tabs 复制、Tooltip/键盘/Escape 以及诊断面板动作与状态反馈。导出排查包与系统更新流程仍需真实 `pnpm tauri dev` 证据，因此保持未勾选。
- 已运行 `CLIPFORGE_DEV_OPEN=settings CLIPFORGE_DEV_PERF_REPEAT=1 CLIPFORGE_DEV_SETTINGS_DOM_PROBE=1 pnpm tauri dev`：应用日志记录 `settings_dom_probe settings pass=true` 和 `settings_dom_probe top_nav pass=true`；真实 WebView 覆盖 settings window 可见、7 个 Sidebar 项、`display-panel` / `capture-content` / `shortcut-language` / `mcp-agent` 侧栏切换、`onboarding` / `shortcut` / `language` / `install` Tabs 切换，以及 Toggle Group、Number、Slider、Switch 保存后出现 `settings.save.saved` 反馈。`settings.section p95=257ms`，无横向溢出。Code Tabs 全模板逐项复制、Tooltip/Escape、导出排查包、清理日志和更新流程仍需后续实机证据；当前仅验证了复制按钮可达，不把 reachability 当成完整复制成功。
- 已运行 `CLIPFORGE_DEV_OPEN=settings:tooltip CLIPFORGE_DEV_PERF_REPEAT=1 CLIPFORGE_DEV_SETTINGS_DOM_PROBE=1 pnpm tauri dev`：应用日志记录 `settings_dom_probe settings pass=true` 和 `settings_dom_probe top_nav pass=true`；真实 WebView 覆盖 `settings.keyboard.tabs.arrowRight`、`settings.tooltip.opens`、`settings.tooltip.escape` 均通过。
- 已运行 `CLIPFORGE_DEV_OPEN=settings:diagnostics CLIPFORGE_DEV_PERF_REPEAT=1 CLIPFORGE_DEV_SETTINGS_DOM_PROBE=1 pnpm tauri dev`：应用日志记录 `settings_dom_probe settings pass=true` 和 `settings_dom_probe top_nav pass=true`；真实 WebView 覆盖诊断刷新、导出排查包、清理日志确认/执行、更新流程面板与状态反馈。导出文件示例：`~/Library/Application Support/ClipForge/diagnostics/clipforge-diagnostics-1784167724295.json`。更新检查因远端 release JSON 拉取失败进入 failed 反馈，但状态反馈链路已验证；未执行下载或安装。
- 已补强 `settings:code-tabs` 探针：Code Tabs 复制先点 install/command/tools/json-rpc/provider 五个按钮，再用 `navigator.clipboard.readText()` 或 debug-only 原生命令 `dev_read_clipboard_text` 回读内容。已运行 `CLIPFORGE_DEV_OPEN=settings:code-tabs CLIPFORGE_DEV_PERF_REPEAT=1 CLIPFORGE_DEV_SETTINGS_DOM_PROBE=1 pnpm tauri dev`：真实 WebView 内五个 Code Tab 均复制成功，`install` 通过 Web Clipboard 读回，`command/tools/json-rpc/provider` 通过原生命令回读，`copy.matches=true` 且读回内容长度分别与预期一致；这条验收据实通过。
- 2026-07-16：按用户提供的 Animate UI 本地文档补齐 `src/components/animate-ui/components/radix/sidebar.tsx` 的组合式 Sidebar API（`SidebarProvider` / `Sidebar` / `SidebarHeader` / `SidebarContent` / `SidebarGroup` / `SidebarMenu` / `SidebarMenuButton` / `SidebarInset` / `SidebarTrigger` / `SidebarRail`），并接入 `SettingsSidebar`；补齐 `CodeTabs` 复制按钮 Tooltip。已复跑 `pnpm exec tsc --noEmit`、`node scripts/verify-settings-surface.mjs`、`pnpm openspec validate settings-interface-redesign --strict`、`git diff --check`：通过。
