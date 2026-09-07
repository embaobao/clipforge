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

### 验证（部分通过）
- `pnpm build:web`：通过
- `pnpm test:boundaries`：通过（已更新 `verify-surface-boundaries.mjs`、`verify-settings-surface.mjs`、`verify-onboarding-surface.mjs`）
- `pnpm test:unit`：通过
- `cargo check`：通过

## 当前状态

- **主面板**：视觉重构完成，功能保留
- **设置窗口**：Shell + 控件完成，内容区功能保留
- **Workspace（详情/聚合页）**：`src/workspace/workspace-panels.tsx` 1861 行，内部仍大量使用已失效的旧类（`detail-editor`、`detail-tag-*`、`detail-suggestion-*`、`.aggregate-*` 等）。已抽出 `src/workspace/components/WorkspaceCrumb.tsx`，但其余子组件未拆。
- **Onboarding**：`src/settings/onboarding-wizard.tsx` 422 行，内部仍用旧类（`.onboarding-*`）。`src/onboarding/OnboardingApp.tsx` 根容器已改 Tailwind，但向导内部未拆。
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
| `src/workspace/workspace-panels.tsx` | 待拆 | 1861 行，内部旧类残留 |
| `src/workspace/components/WorkspaceCrumb.tsx` | 完成 | 新建 |
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
