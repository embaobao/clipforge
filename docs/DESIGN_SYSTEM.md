# ClipForge 设计系统规范

> 版本：v1.0  
> 适用：ClipForge 前端（Tauri v2 + React 19 + TypeScript + Tailwind CSS v3 + shadcn/ui）  
> 维护原则：所有视觉变更必须更新本文档；禁止在组件内硬编码颜色/尺寸/阴影，必须消费 token。

---

## 1. 设计原则

1. **纯灰阶**：禁止任何彩色主题色（无蓝/绿/紫/橙）。唯一允许彩色：`text-destructive`（仅文字）、macOS 窗口红绿灯。
2. **双主题**：light/dark 跟随系统，`.dark` class 切换，禁止闪烁。
3. **中文优先**：字体用系统栈，不引外部字体；中文禁用斜体。
4. **动效克制**：动画只动 `transform` / `opacity`；尊重 `prefers-reduced-motion` 与 `prefers-reduced-transparency`。
5. **单一材质层**：`backdrop-filter` 只允许出现在浮动面板（`.material`），禁止多层 blur/saturate 叠加。

---

## 2. 设计令牌（Tokens）

### 2.1 语义颜色（HSL 变量）

| Token | 浅色值 | 深色值 | 用途 |
|---|---|---|---|
| `--background` | `0 0% 100%` | `240 10% 3.9%` | 页面/窗口底 |
| `--foreground` | `240 10% 3.9%` | `0 0% 98%` | 主文字 |
| `--card` | `0 0% 100%` | `240 10% 3.9%` | 卡片/设置窗口底 |
| `--card-foreground` | `240 10% 3.9%` | `0 0% 98%` | 卡片文字 |
| `--popover` | `0 0% 100%` | `240 10% 3.9%` | 弹出层底 |
| `--popover-foreground` | `240 10% 3.9%` | `0 0% 98%` | 弹出层文字 |
| `--primary` | `240 5.9% 10%` | `0 0% 98%` | 主按钮、Switch 开、Slider、选中圆、Toast |
| `--primary-foreground` | `0 0% 98%` | `240 5.9% 10%` | 主按钮文字 |
| `--secondary` | `240 4.8% 95.9%` | `240 3.7% 15.9%` | 次级背景 |
| `--secondary-foreground` | `240 5.9% 10%` | `0 0% 98%` | 次级文字 |
| `--muted` | `240 4.8% 95.9%` | `240 3.7% 15.9%` | 弱背景 |
| `--muted-foreground` | `240 3.8% 46.1%` | `240 5% 64.9%` | 次级文字、meta、快捷键、序号 |
| `--accent` | `240 4.8% 95.9%` | `240 3.7% 15.9%` | 选中行填充 |
| `--accent-foreground` | `240 5.9% 10%` | `0 0% 98%` | 选中行文字 |
| `--destructive` | `0 84.2% 60.2%` | `0 62.8% 30.6%` | 破坏性操作 |
| `--destructive-foreground` | `0 0% 98%` | `0 0% 98%` | 破坏性操作文字 |
| `--border` | `240 5.9% 90%` | `240 3.7% 15.9%` | 边框 |
| `--input` | `240 5.9% 90%` | `240 3.7% 15.9%` | 输入框边框 |
| `--ring` | `240 5.9% 10%` | `240 4.9% 83.9%` | 焦点环 |
| `--radius` | `0.625rem` | `0.625rem` | 基础圆角（10px） |

### 2.2 发丝线（Hairline）

全界面唯一分隔手段，不使用可见边框：

| 场景 | 浅色 | 深色 |
|---|---|---|
| 强分隔（面板主分区） | `border-black/[0.05]` | `border-white/[0.07]` |
| 弱分隔（设置表单行间） | `border-black/[0.04]` | `border-white/[0.06]` |

### 2.3 选中态

全界面唯一选中语言：

| 场景 | 浅色 | 深色 |
|---|---|---|
| 选中行 | `bg-black/[0.045]` | `bg-white/[0.07]` |
| 多选行 | `bg-black/[0.03]` | `bg-white/[0.05]` |

禁止：描边、黑块、左侧色条。

### 2.4 阴影

```css
/* 浮动面板 */
.panel-shadow {
  box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.05),
    0 8px 24px -8px rgb(0 0 0 / 0.1), 0 24px 64px -16px rgb(0 0 0 / 0.14);
}
.dark .panel-shadow {
  box-shadow: 0 0 0 0.5px rgb(255 255 255 / 0.1),
    0 8px 24px -8px rgb(0 0 0 / 0.5), 0 24px 64px -16px rgb(0 0 0 / 0.5);
}

/* 设置窗口 */
.window-shadow {
  box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.06),
    0 16px 48px -12px rgb(0 0 0 / 0.16), 0 40px 96px -24px rgb(0 0 0 / 0.12);
}
.dark .window-shadow {
  box-shadow: 0 0 0 0.5px rgb(255 255 255 / 0.1),
    0 16px 48px -12px rgb(0 0 0 / 0.55), 0 40px 96px -24px rgb(0 0 0 / 0.5);
}
```

### 2.5 材质（Material）

```css
.material {
  background: rgb(255 255 255 / 0.78);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  backdrop-filter: blur(28px) saturate(180%);
}
.dark .material { background: rgb(28 28 30 / 0.8); }

@media (prefers-reduced-transparency: reduce) {
  .material { background: rgb(250 250 250); backdrop-filter: none; -webkit-backdrop-filter: none; }
  .dark .material { background: rgb(24 24 26); }
}
```

---

## 3. 字号阶梯

| 字号 | 用途 | 示例 |
|---|---|---|
| 11px mono | 辅助信息、快捷键、序号、计数 | `VS Code · 2 分钟前` |
| 12.5px | 设置正文、菜单项 | `粘贴为纯文本` |
| 13px | 列表主文本、设置 label | `选中态用浅灰填充` |
| 15px | 搜索输入 | `搜索剪贴板历史…` |
| 20px+ | 区块标题 | `快速面板` |

等宽数字/快捷键使用 `.mono`：`ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace` + `font-feature-settings: "tnum"`。

---

## 4. 圆角

| 场景 | 半径 |
|---|---|
| 行 | 8px |
| 卡片/预览 | 10px |
| 面板 | 14px |
| 设置窗口 | 12px |
| 圆钮 | 999px |

---

## 5. 间距

4px 网格，常用：4 / 8 / 12 / 16。

---

## 6. 动效

| 场景 | 参数 |
|---|---|
| 按压反馈 | `scale(0.98)`（按钮 0.9–0.98），100ms ease-out |
| 行选中 | background-color 过渡 100ms |
| 面板弹出 | 450ms `cubic-bezier(0.32, 0.72, 0, 1)`，`translateY(12px) scale(0.965)` → 归位 |
| 菜单展开 | 180ms，从触发点缩放 |
| 行进入 | 120ms opacity，20ms 级联 |
| 降级 | `prefers-reduced-motion` 关闭全部动画 |

---

## 7. 组件规范

### 7.1 快速面板（480px）

容器：`w-[480px] rounded-[14px] material panel-shadow overflow-hidden panel-in`

结构：
- 搜索栏（h-52px）：Search 图标 15px + 裸 input 15px + scope 圆钮组
- 发丝线分隔
- 列表：组头（11px medium muted + mono 计数）+ 结果行（h-44px/34px）
- 底栏（h-36px）：左 `N 条 · ⌘K 全部操作`，右 `↑↓ 浏览 · ⏎ 粘贴 · 空格 预览 · / 搜索`

### 7.2 设置窗口（680px）

容器：`w-[680px] rounded-[12px] bg-card window-shadow`

结构：
- 标题栏（h-44px）：左侧 macOS 红绿灯，居中标题
- 侧栏（172px）：黑 2% 底，右侧发丝线
- 内容区：行式表单（label 13px + desc 11.5px muted，控件居右）
- 底部：版本号 + 恢复默认/导出数据

### 7.3 其余视图

复用同一套 token，不引入新颜色/圆角/阴影/组件样式。

---

## 8. 维护规范

### 8.1 新增样式必须走 token

禁止：
```css
/* 错误：硬编码颜色 */
.my-class { background: #f0f0f0; }
```

正确：
```tsx
<div className="bg-muted" />
```

### 8.2 新增组件必须按域拆分

- 快速面板组件：`src/clipboard/components/`
- 设置组件：`src/settings/components/`
- 详情/工作区组件：`src/workspace/components/`
- 通用 shadcn 组件：`src/components/ui/`

每个组件 ≤500 行，props 类型必须导出。

### 8.3 样式文件只允许一个

全局样式仅 `src/index.css`。组件样式优先 Tailwind 工具类，复杂样式用 `*.module.css` 并随组件迁移。

### 8.4 验证门禁

每次提交前必须运行：
```bash
pnpm build:web
pnpm test:unit
pnpm test:boundaries
```

---

## 9. 已废弃清单

以下文件/类已全部废弃，禁止再使用：

- `src/App.css`（已删除）
- `src/settings.css`（已删除）
- `src/theme/tokens.css`（已删除）
- `src/clipboard/styles/clipboard-panel.css`（已删除）
- `src/workspace/styles/detail-page.css`（已删除）
- `src/dsh/dsh-panel.css`（已删除）
- `src/onboarding/onboarding.css`（已删除）
- `src/clipboard/components/ClipboardRow.module.css`（已删除）

旧类名黑名单（发现即替换）：
- `.app-shell`, `.quick-panel`, `.clip-row`, `.quick-row`, `.content-column`, `.side-rail`
- `.toolbar`, `.search-wrap`, `.status-row`, `.tag-filter-*`
- `.detail-pane`, `.detail-editor`, `.detail-tag-*`, `.detail-suggestion-*`
- `.setting-row`, `.setting-card`, `.settings-action-button`, `.kbd-row`
- `.onboarding-standalone-shell`, `.onboarding-loading`
- `.dsh-panel-*`
