# 任务：设置页信息架构与交互组件重构

## Phase 1：依赖与边界确认

- [ ] 使用 Context7 重新拉取 Animate UI Tabs、Code Tabs、Tooltip、Radix Sidebar、Radix Toggle Group 当前文档
- [ ] 确认本地已有 `src/components/animate-ui/primitives/animate/tooltip.tsx` 可复用范围
- [ ] 补齐缺失的 Animate UI 组件到 `src/components/animate-ui/`
- [ ] 确认新增依赖是否已经存在于 `package.json`，缺失时先列安装命令再引入
- [ ] 确认本提案不改变 `AppSettings`、Rust command 和配置持久化语义

## Phase 2：设置页信息架构

- [ ] 重组 `SECTIONS` 为新的一级分类
- [ ] 引入 Settings Sidebar，替换当前粗按钮式侧边栏
- [ ] Sidebar 项保留图标和文案，当前态、hover、focus 态清晰
- [ ] 内容区域新增 Section Header 和 Sticky Status Bar
- [ ] 每个一级分类内部接入 Animate UI Tabs
- [ ] 移除设置内容中的长滚动堆叠，按子项拆分到 Tabs

## Phase 3：表单控件映射

- [ ] 将 `SegmentSetting` 迁移为 Animate UI Radix Toggle Group
- [ ] 将 `language`、`panelDensity`、`contentDisplayMode`、`tagMode` 接入 Toggle Group
- [ ] 将布尔项统一到 Switch 或多选 Toggle Group
- [ ] 将数值项拆成 Slider + Number Input 或 Number Field
- [ ] 为路径项提供只读 Field、复制动作和 Tooltip
- [ ] 为状态项提供统一 Status Panel
- [ ] 保证所有表单控件有可见 label、键盘可达和 disabled 状态

## Phase 4：MCP、Agent 与代码示例

- [ ] 用 Code Tabs 重构 `manual` 和 `integration` 内的 MCP 示例
- [ ] 将 Agent 安装提示、MCP 命令、JSON-RPC、Provider JSON 拆为独立 code tab
- [ ] 为每个 Code Tab 提供复制按钮和成功反馈
- [ ] 保留当前 `copyMcpCommand` 和 `copyAgentProviderTemplate` 的业务语义
- [ ] 避免代码块撑高页面，代码区域内部滚动

## Phase 5：Tooltip 与动作语义

- [ ] 用 Animate UI TooltipProvider 包裹设置页
- [ ] 将 icon-only、路径截断、危险动作、诊断导出和复制动作接入 Tooltip
- [ ] 保留 tooltip 内容和触发策略，不新增页面说明噪音
- [ ] 将动作分为主要、辅助、诊断、危险四类
- [ ] `导出排查包` 放入诊断 Tab，和普通配置项分离
- [ ] 清理日志和重置权限动作提供危险态或确认态

## Phase 6：视觉与响应式

- [ ] 统一设置页 token：背景、边框、文本、muted、accent、danger、radius
- [ ] 侧边栏减轻视觉重量，避免粗大按钮和大色块
- [ ] 控件高度、内边距和间距使用 4px / 8px 节奏
- [ ] 适配 900x640、1200x760、720x640 窗口
- [ ] Reduced Motion 下关闭 Tabs 和 Tooltip 的位移动效

## Phase 7：国际化与文案

- [ ] 新增设置页可见文案全部接入 i18n key
- [ ] 中文文案保持工具语义，不使用打印、报告生成等不准确表达
- [ ] 英文文案和中文 key 同步补齐
- [ ] 运行硬编码文案检查脚本并处理白名单

## Phase 8：验证

- [ ] `pnpm exec tsc --noEmit` 通过
- [ ] `pnpm run check:i18n` 通过
- [ ] `pnpm build` 通过
- [ ] `cd src-tauri && cargo check` 通过
- [ ] `pnpm tauri dev` 验证设置窗口打开、Sidebar 切换和 Tabs 切换
- [ ] `pnpm tauri dev` 验证 Toggle Group、Switch、Slider、Number Field 能保存设置
- [ ] `pnpm tauri dev` 验证 Code Tabs 复制 MCP / JSON / Provider 模板
- [ ] `pnpm tauri dev` 验证 Tooltip、键盘导航和 Escape 关闭
- [ ] `pnpm tauri dev` 验证导出排查包、清理日志、更新流程位置和状态反馈正确
