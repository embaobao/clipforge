# ClipForge 视觉重构 · 交接摘要

## 会话背景

用户要求按 `docs/Kimi_Agent_设计系统草图.zip` 中的设计稿，将 ClipForge 从旧 CSS 架构全面迁移到 Tailwind CSS v3 + shadcn/ui 新视觉体系。设计稿对应文档为 `docs/DESIGN_SYSTEM.md`（本次会话新建）。

## 已完成工作

### 基础设施（完成）
- `package.json`：Tailwind v4 → v3.4.19，新增 postcss、autoprefixer、sonner、cmdk、tailwindcss-animate
- `tailwind.config.js`：zinc 色系 + HSL token 映射 + 自定义字号/动画
- `postcss.config.js`：标准 PostCSS 流程
- `components.json`：shadcn new-york / zinc / CSS variables
- shadcn 组件已安装：button、dropdown-menu、switch、slider、select、toggle-group、separator、scroll-area、tooltip、tabs、accordion、sonner
- `src/index.css`：全量 token + `.material` / `.panel-shadow` / `.window-shadow` / `.mono` / `.thin-scroll` / `.panel-in` / `.row-in`

### 主面板（完成）
- `src/App.tsx`：480px 面板容器 `w-[480px] rounded-[14px] material panel-shadow overflow-hidden panel-in`
- `src/clipboard/components/TopToolbar.tsx`：52px 搜索栏 + 28px scope 圆钮（Clock/Star/Scissors/MoreHorizontal）
- `src/clipboard/components/ClipboardRow.tsx`：行高 44/40/34px、28×28 图标块、选中态 `bg-black/[0.045]`
- `src/clipboard/components/ClipboardRowActions.tsx`：序号/⏎/已复制/hover 动作
- `src/clipboard/components/ClipboardContentPreview.tsx`：13px 主文本 + 11px muted meta
- `src/clipboard/components/QuickPreviewCard.tsx`：空格预览卡（新建）
- `src/clipboard/components/QuickCommandMenu.tsx`：⌘K 菜单（新建）
- `src/clipboard/components/MultiSelectBottomBar.tsx`：多选底栏（新建）
- `src/clipboard/components/TrashRow.tsx` / `TrashContextMenu.tsx`：回收站（新建）
- `src/clipboard/components/ClipboardEmptyState.tsx`：空状态
- `src/clipboard/components/PanelStatusFeedback.tsx`：底栏状态
- 键盘映射已补：空格开关快速预览（非多选模式下）

### 设置窗口（大部分完成）
- `src/settings/components/SettingsShell.tsx`：680px 外壳（红绿灯标题栏 + 172px 侧栏 + 内容区 + 底部）
- `src/settings/components/SettingsStatusPanel.tsx`：已重写为 shadcn + Tailwind
- `src/settings/components/SettingsErrorBoundary.tsx`：已重写
- `src/settings/components/SettingsCodeTabs.tsx`：已重写为 shadcn Tabs
- `src/settings/controls.tsx`：已重写（SegmentSetting/NumberSetting/SliderSetting/ToggleSetting/ReadonlyField/CheckItem）
- `src/settings.tsx`：已接入 SettingsShell，旧类已清理

### 旧样式清理（完成）
已删除：`src/App.css`、`src/settings.css`、`src/theme/tokens.css`、`src/clipboard/styles/clipboard-panel.css`、`src/workspace/styles/detail-page.css`、`src/dsh/dsh-panel.css`、`src/onboarding/onboarding.css`、`src/clipboard/components/ClipboardRow.module.css`

### 验证（2026-09-07 夜间全套复验通过）
- `pnpm build:web`：通过
- `pnpm test:boundaries`：通过（已更新 `verify-surface-boundaries.mjs`、`verify-settings-surface.mjs`、`verify-onboarding-surface.mjs`）
- `pnpm test:unit`：通过（`verify-settings-surface.mjs` 的 CodeTabs 过期断言已按 shadcn 新实现修复：改锁本地封装/复制回调/dev probe 标记）
- `cargo check`：本轮未触碰 src-tauri，未重跑

## 基线提交（2026-09-07 夜间批次 1）

全部未提交改动已按逻辑单元分 6 批提交，工作区干净：
`e82cf95` 基础设施 → `d4e1b1b` 主面板 → `20b7773` 设置窗口 → `6812db6` workspace/onboarding/dsh 过渡态 → `b9625a0` 删除旧 CSS → `8f76cc1` 文档与提案。

## 批次 2：Workspace 详情页拆分（2026-09-07 夜间，待办#1 完成）

- `986bf09` 修复 tailwind.config.js 字体名尾部多余右引号（消除 vite css-syntax-error 警告）
- `2e06530` 详情页从 workspace-panels.tsx（1831 行）拆分至 `src/workspace/components/`：
  workspace-detail-shared / DetailPreview / DetailQuickEditor / DetailDshPanel / DetailMeta / DetailOverflowMenu / ClipDetailWorkspace（外壳 498 行）；
  workspace-panels.tsx 重写为聚合页 + re-export（173 行），**已移出 file-size 豁免清单（剩 4 项）**。
- 旧 `detail-*` / `aggregate-*` 无样式类全部替换为 Tailwind 语义类；行为与 props 签名不变（App.tsx import 路径不变）。
- DSH 分析面板移出标题栏行（改渲染在 Crumb 下方），分析状态收敛进 `useDshQuickAnalysis` hook。
- 3 个 verify 脚本（editor-agent-bridge / runtime-boundaries / surface-boundaries）读取路径随拆分同步更新，断言语义不变。
- 验证：build:web ✓ / test:unit ✓ / test:boundaries ✓；cargo check 未重跑（未触碰 src-tauri）；tauri dev 视觉走查跳过（无人值守）。

## 批次 3：聚合页拆分 + Onboarding 向导拆分（2026-09-07 夜间，待办#2/#3 完成）

- `d7fb9a5` 聚合页拆分：`MultiAggregateWorkspace.tsx`（118 行）+ `AggregateItem.tsx`（63 行）；`workspace-panels.tsx` 缩为纯 re-export（5 行）；verify-surface-boundaries 聚合页 marker 检查随迁。
- `5890d76` onboarding 向导拆分：`settings/onboarding-wizard.tsx`（422 行旧类）迁移至 `src/onboarding/components/`（shared 153 行 + OnboardingWizard 268 行 + Step/FeatureCard 小组件），全部换 Tailwind 语义类；键盘导航、快捷键录制、探针、写入路径行为不变；verify-settings-surface 断言路径随迁。
- 验证：build:web ✓ / test:unit ✓ / test:boundaries ✓（两项拆分各验证一轮）；cargo check 未重跑（未触碰 src-tauri）；tauri dev 视觉走查跳过。

## 待办事项（按优先级，批次 3 后更新）

1. **DSH 面板细节对齐**（原#4）
   - iframe 与提示文本对齐设计稿；涉及视觉判断，建议盟哥白天人工确认后批量执行

2. **全量回归**（原#5）
   - `pnpm tauri dev` 视觉走查（**重点**：详情页/聚合页/onboarding 拆分重写区域的实际视觉效果未经人工确认）

3. **对账 openspec/changes/deepseek-harness-embedding/tasks.md**（Phase 6 半成品 / Phase 7 iframe 方案）

4. **AGENTS.md「样式按功能拆分」章节更新**：仍描述旧 CSS 架构，与 Tailwind 现实脱节

5. **按 docs/PROPOSAL_ROADMAP.md 推进其他提案**（无需用户决策的条目）

## 当前状态

- **主面板**：视觉重构完成，功能保留
- **设置窗口**：Shell + 控件完成，内容区功能保留
- **Workspace（详情页）**：已拆分完成，全部 Tailwind 语义类（批次 2）
- **Workspace（聚合页）**：已拆分完成（批次 3），`workspace-panels.tsx` 仅剩 re-export
- **Onboarding**：向导已拆分至 `src/onboarding/components/` 并清理旧类（批次 3）；`OnboardingApp.tsx` 根容器已 Tailwind
- **DSH 面板**：已用 Tailwind 根容器，但内部 iframe 和提示文本细节可再对齐。

## 待办事项（按优先级）

1. **Workspace 详情页拆分**（最高优先级）
   - 拆出 `src/workspace/components/ClipDetailWorkspace.tsx`、`DetailQuickEditor.tsx`、`DetailPreview.tsx`、`DetailDshPanel.tsx`、`DetailMeta.tsx`
   - 目标：每个文件 ≤500 行，全部用 Tailwind + shadcn

2. **Workspace 聚合页拆分**
   - 拆出 `src/workspace/components/MultiAggregateWorkspace.tsx`、`AggregateItem.tsx`

3. **Onboarding 向导拆分**
   - 拆出 `src/onboarding/components/OnboardingWizard.tsx`、`OnboardingStep.tsx`、`OnboardingFeatureCard.tsx`

4. **DSH 面板细节对齐**

5. **全量回归**
   - `pnpm build:web` + `pnpm test:unit` + `pnpm test:boundaries`
   - `pnpm tauri dev` 视觉走查

## 关键文件清单

| 文件 | 状态 | 备注 |
|---|---|---|
| `src/index.css` | 完成 | 全局 token + 工具类 |
| `tailwind.config.js` | 完成 | zinc + HSL 映射 |
| `src/App.tsx` | 完成 | 4051 行，主面板已重构 |
| `src/settings.tsx` | 完成 | 1865 行，Shell 已接入 |
| `src/settings/controls.tsx` | 完成 | 控件已重写 |
| `src/settings/components/SettingsShell.tsx` | 完成 | 新建 |
| `src/settings/components/SettingsStatusPanel.tsx` | 完成 | 已重写 |
| `src/settings/components/SettingsErrorBoundary.tsx` | 完成 | 已重写 |
| `src/settings/components/SettingsCodeTabs.tsx` | 完成 | 已重写 |
| `src/workspace/workspace-panels.tsx` | 完成 | 5 行纯 re-export（详情页/聚合页均已拆出） |
| `src/workspace/components/WorkspaceCrumb.tsx` | 完成 | 新建 |
| `src/workspace/components/ClipDetailWorkspace.tsx` | 完成 | 498 行外壳 + 6 个子组件（批次 2） |
| `src/workspace/components/MultiAggregateWorkspace.tsx` | 完成 | 118 行 + AggregateItem（批次 3） |
| `src/onboarding/components/OnboardingWizard.tsx` | 完成 | 268 行 + shared/Step/FeatureCard（批次 3） |
| `src/settings/onboarding-wizard.tsx` | 待拆 | 422 行，内部旧类残留 |
| `src/onboarding/OnboardingApp.tsx` | 部分 | 根容器已改，向导内部待拆 |
| `src/dsh/dsh-panel.tsx` | 部分 | 根容器已改，细节待对齐 |

## 建议技能

- `shadcn`：用于继续添加/更新 shadcn 组件
- `tailwind`：用于 Tailwind 配置和类名调试
- `frontend-design`：用于视觉规范参考
- `code-review`：用于完成后自查

## 注意事项

- 不要恢复任何已删除的 CSS 文件。
- 所有新样式必须使用 `hsl(var(--token))` 或 Tailwind 语义类。
- 保持 `data-surface="clipboard"` / `"settings"` / `"workspace"` / `"dsh"` / `"onboarding"` marker。
- 每完成一个子组件即跑 `pnpm build:web`。
