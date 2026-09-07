# ClipForge 视觉重构 · 拆分与开发方案

> 状态：进行中  
> 原则：每完成一个可交付单元即跑 `pnpm build:web` + 截图 review，不再批量改动。

---

## 当前状态快照

| 模块 | 状态 | 说明 |
|---|---|---|
| 基础设施 | ✅ 完成 | Tailwind v3.4 + shadcn new-york + index.css token |
| 主面板 | ✅ 完成 | 480px 面板、搜索、列表、预览、底栏、⌘K、Toast |
| 设置窗口 | 🟡 部分 | Shell 已建，内部表单/卡片仍有旧类残留 |
| Workspace | ❌ 待重建 | detail / aggregate 内部样式全失效 |
| Onboarding | ❌ 待重建 | wizard 内部样式全失效 |
| DSH 面板 | 🟡 可用 | 已用 Tailwind，细节待对齐 |
| 验证门禁 | ✅ 通过 | build / unit / boundaries 全绿 |

---

## 拆分方案（按交付单元）

### 单元 A：设置窗口内部精修（优先级最高，用户最常进）
目标文件：
- `src/settings/controls.tsx` → 已完成（Switch/Slider/ToggleGroup/Input 已对齐）
- `src/settings/components/SettingsStatusPanel.tsx` → 待重建（当前仍用旧类）
- `src/settings/components/SettingsCodeTabs.tsx` → 待重建（当前包 animate-ui）
- `src/settings/components/SettingsErrorBoundary.tsx` → 待重建
- `src/settings/components/OnboardingEntryCard.tsx` → 待重建
- `src/settings.tsx` 内部 `setting-row` / `setting-card` / `permission-card` 残留 → 待清理

交付物：设置窗口 6 个 tab 全部视觉对齐设计稿，无旧类残留。

### 单元 B：Workspace 详情页
目标文件：
- `src/workspace/workspace-panels.tsx`（1864 行）→ 拆分为：
  - `src/workspace/components/ClipDetailWorkspace.tsx`（容器）
  - `src/workspace/components/DetailQuickEditor.tsx`（编辑器）
  - `src/workspace/components/DetailPreview.tsx`（内容预览：Markdown/Link/Json/Image/File）
  - `src/workspace/components/DetailDshPanel.tsx`（AI 分析结果）
  - `src/workspace/components/DetailMeta.tsx`（来源/格式/上下文）
- `src/workspace/components/WorkspaceCrumb.tsx`（面包屑）

交付物：详情页编辑器 + AI 区 + 预览区全部视觉对齐，文件 ≤500 行/个。

### 单元 C：Workspace 聚合页（多选合并预览）
目标文件：
- `src/workspace/workspace-panels.tsx` 中 `MultiAggregateWorkspace` 拆出
- `src/workspace/components/MultiAggregateWorkspace.tsx`
- `src/workspace/components/AggregateItem.tsx`

交付物：多选合并预览页视觉对齐。

### 单元 D：Onboarding 向导
目标文件：
- `src/settings/onboarding-wizard.tsx`（422 行）→ 拆分为：
  - `src/onboarding/components/OnboardingWizard.tsx`（容器）
  - `src/onboarding/components/OnboardingStep.tsx`（步骤）
  - `src/onboarding/components/OnboardingFeatureCard.tsx`（功能卡片）
- `src/onboarding/OnboardingApp.tsx`（壳）

交付物：引导页 5 步全部视觉对齐，键盘导航可用。

### 单元 E：DSH 面板细节
目标文件：
- `src/dsh/dsh-panel.tsx`

交付物：与主面板同语言，加载/错误状态对齐。

### 单元 F：全量回归
- `pnpm build:web`
- `pnpm test:unit`
- `pnpm test:boundaries`
- `pnpm tauri dev` 截图 review

---

## 执行顺序与依赖

```
A（设置内部） → B（Workspace 详情） → C（Workspace 聚合） → D（Onboarding） → E（DSH） → F（回归）
```

依赖关系：无强依赖，可并行，但按用户高频路径排序。

---

## 每单元交付流程

1. 改代码（最小范围）
2. 跑 `pnpm build:web`
3. 截图（Playwright / Tauri dev）给你 review
4. 你确认后进入下一单元

---

## 当前阻塞项

- 无技术阻塞。
- 需要你在每单元完成后 review 截图。

---

## 预计工时

| 单元 | 预估改动文件数 | 预估时间 |
|---|---|---|
| A 设置内部 | 6 | 30–45 min |
| B 详情页 | 6 | 60–90 min |
| C 聚合页 | 2 | 20–30 min |
| D Onboarding | 4 | 30–45 min |
| E DSH | 1 | 10 min |
| F 回归 | 0 | 20 min |
