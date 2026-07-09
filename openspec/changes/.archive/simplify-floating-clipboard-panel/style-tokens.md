# Style Token 规范

## 目标

ClipForge 的视觉系统基于 shadcn 语义 token，叠加 ClipForge 产品 token，形成“像素 + 模糊玻璃 + 极简高密度工具”的统一风格。

token 必须解决四类问题：

1. 视觉一致：颜色、圆角、阴影、玻璃、边框、字体和图标状态统一。
2. 尺寸稳定：搜索区、预览区、列表行、底部栏、多选 sheet 固定高度，避免内容抖动。
3. 交互明确：hover、active、selected、copied、focused、disabled 有一致状态。
4. 扩展可控：内容类型、插件状态、Agent 状态都有语义 token，不在组件里散落颜色。

## 分层

```text
shadcn semantic tokens
  └─ ClipForge product tokens
       ├─ glass tokens
       ├─ pixel tokens
       ├─ density/layout tokens
       ├─ motion tokens
       ├─ content-kind tokens
       └─ integration/status tokens
```

实现阶段建议先落在 `src/App.css` 或 `src/styles/tokens.css`。当前项目未完整初始化 shadcn/tailwind，P1 不强制迁移 Tailwind，但变量命名必须兼容 shadcn。

## shadcn 语义 Token

```css
:root {
  --radius: 10px;

  --background: oklch(0.985 0.004 255);
  --foreground: oklch(0.18 0.035 255);

  --card: oklch(1 0 0 / 0.82);
  --card-foreground: var(--foreground);

  --popover: oklch(1 0 0 / 0.9);
  --popover-foreground: var(--foreground);

  --primary: oklch(0.56 0.18 253);
  --primary-foreground: oklch(0.99 0.004 255);

  --secondary: oklch(0.94 0.018 252);
  --secondary-foreground: oklch(0.22 0.035 255);

  --muted: oklch(0.93 0.012 255);
  --muted-foreground: oklch(0.48 0.025 255);

  --accent: oklch(0.91 0.055 250);
  --accent-foreground: oklch(0.22 0.045 255);

  --destructive: oklch(0.58 0.22 28);
  --destructive-foreground: oklch(0.99 0.004 255);

  --border: oklch(0.82 0.018 255 / 0.72);
  --input: oklch(0.88 0.018 255 / 0.72);
  --ring: oklch(0.62 0.17 253);
}

.dark {
  --background: oklch(0.15 0.025 255);
  --foreground: oklch(0.96 0.01 255);

  --card: oklch(0.2 0.025 255 / 0.78);
  --card-foreground: var(--foreground);

  --popover: oklch(0.18 0.025 255 / 0.92);
  --popover-foreground: var(--foreground);

  --primary: oklch(0.68 0.16 253);
  --primary-foreground: oklch(0.13 0.025 255);

  --secondary: oklch(0.25 0.025 255);
  --secondary-foreground: oklch(0.94 0.01 255);

  --muted: oklch(0.26 0.02 255);
  --muted-foreground: oklch(0.72 0.018 255);

  --accent: oklch(0.3 0.055 250);
  --accent-foreground: oklch(0.96 0.01 255);

  --destructive: oklch(0.66 0.19 26);
  --destructive-foreground: oklch(0.98 0.008 255);

  --border: oklch(1 0 0 / 0.12);
  --input: oklch(1 0 0 / 0.16);
  --ring: oklch(0.72 0.13 253);
}
```

说明：

- `primary` 来自 `banner.png` 的蓝色，但降低饱和度，避免整页单蓝。
- `background` 不是纯白，而是略冷的冰白，方便玻璃层与列表区分。
- 暗色模式不是简单反色，保持蓝色品牌但降低大面积刺激。

## ClipForge 产品 Token

```css
:root {
  /* 字体 */
  --cf-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --cf-font-mono: "SF Mono", "JetBrains Mono", "Cascadia Code", Consolas, monospace;

  /* 字号 */
  --cf-text-2xs: 10px;
  --cf-text-xs: 11px;
  --cf-text-sm: 12px;
  --cf-text-md: 13px;
  --cf-text-lg: 15px;

  /* 行高 */
  --cf-leading-tight: 1.15;
  --cf-leading-normal: 1.35;
  --cf-leading-relaxed: 1.55;

  /* 间距 */
  --cf-space-1: 2px;
  --cf-space-2: 4px;
  --cf-space-3: 6px;
  --cf-space-4: 8px;
  --cf-space-5: 10px;
  --cf-space-6: 12px;
  --cf-space-8: 16px;
  --cf-space-10: 20px;

  /* 圆角 */
  --cf-radius-xs: 4px;
  --cf-radius-sm: 6px;
  --cf-radius-md: 8px;
  --cf-radius-lg: 12px;
  --cf-radius-xl: 16px;
  --cf-radius-pill: 999px;

  /* 高密度布局 */
  --cf-panel-width-min: 420px;
  --cf-panel-width: 480px;
  --cf-panel-width-max: 560px;
  --cf-panel-height: 640px;
  --cf-search-height: 54px;
  --cf-filter-height: 28px;
  --cf-preview-height: 132px;
  --cf-row-height: 34px;
  --cf-row-height-comfort: 40px;
  --cf-shortcut-size: 24px;
  --cf-dock-height: 48px;
  --cf-sheet-height: 168px;

  /* z-index */
  --cf-z-base: 0;
  --cf-z-row-focus: 5;
  --cf-z-search: 20;
  --cf-z-preview: 25;
  --cf-z-dock: 30;
  --cf-z-sheet: 40;
  --cf-z-toast: 60;
}
```

## 玻璃 Token

```css
:root {
  --cf-glass-bg: oklch(1 0 0 / 0.58);
  --cf-glass-bg-strong: oklch(1 0 0 / 0.76);
  --cf-glass-bg-subtle: oklch(1 0 0 / 0.38);
  --cf-glass-border: oklch(1 0 0 / 0.56);
  --cf-glass-border-strong: oklch(0.74 0.04 255 / 0.46);
  --cf-glass-highlight: oklch(1 0 0 / 0.74);
  --cf-glass-shadow: 0 16px 44px oklch(0.28 0.06 255 / 0.16);
  --cf-glass-shadow-tight: 0 8px 24px oklch(0.26 0.05 255 / 0.14);
  --cf-glass-blur: 18px;
  --cf-glass-saturation: 1.35;
}

.dark {
  --cf-glass-bg: oklch(0.18 0.025 255 / 0.56);
  --cf-glass-bg-strong: oklch(0.2 0.03 255 / 0.78);
  --cf-glass-bg-subtle: oklch(0.18 0.025 255 / 0.38);
  --cf-glass-border: oklch(1 0 0 / 0.12);
  --cf-glass-border-strong: oklch(0.72 0.1 253 / 0.28);
  --cf-glass-highlight: oklch(1 0 0 / 0.1);
  --cf-glass-shadow: 0 18px 48px oklch(0 0 0 / 0.34);
  --cf-glass-shadow-tight: 0 10px 28px oklch(0 0 0 / 0.3);
}
```

使用规则：

- 顶部搜索、底部 dock、多选 sheet 使用 `--cf-glass-bg-strong`。
- 预览带使用 `--cf-glass-bg`。
- 列表行不使用玻璃 token，保持滚动性能和密度。
- `liquid-glass-react` 若引入，只读取这些 token 对应的参数，不在组件里硬编码。

## 像素与品牌 Token

```css
:root {
  --cf-pixel-ink: oklch(0.18 0.045 255);
  --cf-pixel-blue: var(--primary);
  --cf-pixel-white: oklch(0.99 0.004 255);
  --cf-pixel-edge: 1px;
  --cf-pixel-shadow: 0 1px 0 oklch(1 0 0 / 0.72), 0 2px 0 oklch(0.55 0.12 253 / 0.22);
  --cf-target-shadow: 0 0 0 1px var(--ring), 0 0 0 4px oklch(0.62 0.17 253 / 0.12);
}

.dark {
  --cf-pixel-ink: oklch(0.95 0.012 255);
  --cf-pixel-shadow: 0 1px 0 oklch(1 0 0 / 0.08), 0 2px 0 oklch(0.68 0.16 253 / 0.24);
  --cf-target-shadow: 0 0 0 1px var(--ring), 0 0 0 4px oklch(0.68 0.16 253 / 0.18);
}
```

使用规则：

- 像素感只用于品牌锚点、数字块、目标光标和局部边缘。
- 不使用像素字体作为正文，避免降低可读性。
- 不做厚重像素游戏 UI，ClipForge 仍是工具产品。

## 状态 Token

```css
:root {
  --cf-state-hover: oklch(0.94 0.035 252 / 0.72);
  --cf-state-active: oklch(0.9 0.06 252 / 0.92);
  --cf-state-selected: oklch(0.86 0.09 252 / 0.84);
  --cf-state-copied: oklch(0.88 0.12 156 / 0.86);
  --cf-state-warning: oklch(0.86 0.15 82);
  --cf-state-danger: var(--destructive);
  --cf-state-disabled: oklch(0.68 0.014 255 / 0.56);
}

.dark {
  --cf-state-hover: oklch(0.28 0.04 252 / 0.72);
  --cf-state-active: oklch(0.33 0.06 252 / 0.86);
  --cf-state-selected: oklch(0.38 0.09 252 / 0.78);
  --cf-state-copied: oklch(0.42 0.12 156 / 0.78);
  --cf-state-warning: oklch(0.78 0.14 82);
}
```

## 内容类型 Token

```css
:root {
  --cf-kind-text: oklch(0.52 0.04 255);
  --cf-kind-link: oklch(0.58 0.16 253);
  --cf-kind-image: oklch(0.62 0.14 315);
  --cf-kind-file: oklch(0.62 0.11 180);
  --cf-kind-table: oklch(0.6 0.13 145);
  --cf-kind-chart: oklch(0.66 0.15 65);
  --cf-kind-rich-text: oklch(0.58 0.12 285);
  --cf-kind-unknown: var(--muted-foreground);
}
```

使用规则：

- 内容类型色只用于小图标、细线、badge，不铺满 row 背景。
- 同一 row 内主复制语义永远比类型色更重要。

## 动效 Token

```css
:root {
  --cf-motion-instant: 80ms;
  --cf-motion-fast: 140ms;
  --cf-motion-base: 200ms;
  --cf-motion-emphasis: 280ms;
  --cf-ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --cf-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --cf-ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --cf-target-scale: 1.012;
  --cf-press-scale: 0.985;
}
```

使用规则：

- 目标光标、sheet、hover 只用 transform/opacity。
- 不动画 height、width、top、left。
- `prefers-reduced-motion` 下把时长降到 1ms，保留焦点/状态变化。

## 集成状态 Token

```css
:root {
  --cf-status-idle: var(--muted-foreground);
  --cf-status-listening: oklch(0.58 0.13 156);
  --cf-status-writing: oklch(0.62 0.14 253);
  --cf-status-warning: var(--cf-state-warning);
  --cf-status-agent: oklch(0.62 0.12 285);
  --cf-status-plugin: oklch(0.6 0.11 180);
}
```

使用规则：

- 当前系统剪贴板、自动监听、焦点恢复、写回保护、Agent Bridge、插件动作都进入底部状态线。
- 不再保留独立“自动刷新”按钮。
- 状态色必须配合文本或图标，不能只靠颜色表达。

## 组件映射

| 组件 | 主要 token |
|---|---|
| `ClipForgeShell` | `--background`、`--foreground`、`--cf-panel-*` |
| `GlassSearchBar` | `--cf-glass-*`、`--cf-search-height`、`--ring` |
| `FilterChips` | `--secondary`、`--accent`、`--cf-filter-height` |
| `PreviewBand` | `--cf-preview-height`、`--cf-glass-bg` |
| `ClipboardRow` | `--cf-row-height`、`--cf-state-*`、`--cf-kind-*` |
| `ShortcutIndexButton` | `--cf-shortcut-size`、`--cf-pixel-*` |
| `TargetFocusRing` | `--cf-target-shadow`、`--cf-motion-*` |
| `BottomDock` | `--cf-dock-height`、`--cf-glass-bg-strong` |
| `AggregatePreviewSheet` | `--cf-sheet-height`、`--cf-glass-bg-strong` |
| `StatusLine` | `--cf-status-*`、`--muted-foreground` |

## 开发规则

- 新组件优先使用 shadcn 语义变量，不直接写颜色值。
- 自定义 CSS 变量必须以 `--cf-` 开头。
- 复杂业务样式必须写中文注释，说明业务原因，例如“多选开启时固定 sheet 高度，避免列表可视区域抖动”。
- 新增状态必须先补 token，再写组件样式。
- 每次 UI 调整至少验证亮色、暗色、键盘 focus、reduced-motion。
