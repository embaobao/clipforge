# 设计：UI 设计风格升级

## 交互设计

快捷面板视觉：
- 透明背景 + 毛玻璃效果（macOS）
- 圆角裁切（12px）
- 紧凑间距（4px~8px）
- 高信息密度（列表项高度 32px）
- 快捷键标记小号字体（12px）

管理窗口视觉：
- 清晰层级：导航栏 | 内容区 | 详情面板
- 信息密度高：减少空白，紧凑布局
- 边框分隔：不用阴影，用细边框
- 等宽字体：ID、代码使用 Mono 字体

## 技术设计

### 1. 设计 Token 体系

```css
/* src/styles/tokens.css */
:root {
  /* 颜色 - 黑白对比 */
  --color-bg: #ffffff;
  --color-bg-secondary: #f5f5f5;
  --color-bg-tertiary: #e5e5e5;
  --color-text: #000000;
  --color-text-secondary: #666666;
  --color-text-tertiary: #999999;
  --color-border: #e0e0e0;
  --color-border-strong: #cccccc;
  --color-accent: #000000;
  --color-accent-secondary: #333333;

  /* 字体 */
  --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-family-mono: "SF Mono", "Monaco", "Inconsolata", "Fira Mono", monospace;
  --font-size-xs: 12px;
  --font-size-sm: 14px;
  --font-size-md: 16px;
  --font-size-lg: 18px;
  --font-size-xl: 20px;

  /* 间距 - 紧凑 */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 12px;
  --spacing-lg: 16px;
  --spacing-xl: 24px;

  /* 圆角 */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-full: 9999px;

  /* 列表项高度 */
  --item-height-sm: 28px;
  --item-height-md: 32px;
  --item-height-lg: 40px;
}

/* 暗黑模式 */
.dark {
  --color-bg: #0a0a0a;
  --color-bg-secondary: #1a1a1a;
  --color-bg-tertiary: #2a2a2a;
  --color-text: #ffffff;
  --color-text-secondary: #a0a0a0;
  --color-text-tertiary: #6a6a6a;
  --color-border: #3a3a3a;
  --color-border-strong: #4a4a4a;
}
```

### 2. 快捷面板样式

```css
/* src/styles/QuickPanel.css */
.quick-panel {
  width: 360px;
  height: 560px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: var(--radius-xl);
  overflow: hidden;

  /* macOS 毛玻璃 */
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);

  /* 圆角裁切 */
  clip-path: inset(0 round var(--radius-xl));
}

.quick-panel.dark {
  background: rgba(10, 10, 10, 0.95);
}

/* 搜索框 */
.quick-search {
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
}

.quick-search input {
  width: 100%;
  font-size: var(--font-size-md);
  background: transparent;
  border: none;
  outline: none;
}

/* 列表项 */
.quick-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: var(--item-height-md);
  padding: 0 var(--spacing-md);
  cursor: pointer;
  border-bottom: 1px solid var(--color-border);
}

.quick-item:hover {
  background: var(--color-bg-secondary);
}

.quick-item.selected {
  background: var(--color-bg-tertiary);
}

.quick-item .summary {
  font-size: var(--font-size-sm);
  color: var(--color-text);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-item .shortcut-badge {
  font-size: var(--font-size-xs);
  font-family: var(--font-family-mono);
  color: var(--color-text-tertiary);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-secondary);
}
```

### 3. 管理窗口样式

```css
/* src/styles/MainWindow.css */
.main-window {
  display: grid;
  grid-template-columns: 200px 1fr 300px;
  grid-template-rows: 56px 1fr;
  gap: 0;
  background: var(--color-bg);
}

/* 导航栏 */
.nav-bar {
  grid-column: 1 / 4;
  height: 56px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  padding: 0 var(--spacing-lg);
}

.nav-item {
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-md);
  color: var(--color-text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
}

.nav-item:hover {
  color: var(--color-text);
  background: var(--color-bg-tertiary);
}

.nav-item.active {
  color: var(--color-text);
  background: var(--color-bg);
  font-weight: 500;
}

/* 侧边栏 */
.sidebar {
  grid-column: 1;
  background: var(--color-bg-secondary);
  border-right: 1px solid var(--color-border);
  padding: var(--spacing-md);
}

.sidebar-item {
  height: var(--item-height-md);
  padding: 0 var(--spacing-sm);
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
}

.sidebar-item:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text);
}

/* 内容区 */
.content-area {
  grid-column: 2;
  padding: var(--spacing-md);
  overflow-y: auto;
}

/* 详情面板 */
.detail-panel {
  grid-column: 3;
  background: var(--color-bg-secondary);
  border-left: 1px solid var(--color-border);
  padding: var(--spacing-md);
}

/* ID/代码等宽字体 */
.mono-text {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
```

### 4. 列表样式优化

```css
/* src/styles/ClipList.css */
.clip-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.clip-item {
  height: var(--item-height-md);
  padding: 0 var(--spacing-md);
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--spacing-sm);
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
}

.clip-item:hover {
  background: var(--color-bg-secondary);
}

.clip-item.selected {
  background: var(--color-bg-tertiary);
  border-left: 2px solid var(--color-accent);
}

/* 紧凑信息布局 */
.clip-summary {
  font-size: var(--font-size-sm);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clip-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  display: flex;
  gap: var(--spacing-xs);
}

.clip-meta-item {
  padding: 2px 4px;
  background: var(--color-bg-secondary);
  border-radius: var(--radius-sm);
}
```

### 5. 按钮样式

```css
/* src/styles/Button.css */
.btn {
  height: var(--item-height-md);
  padding: 0 var(--spacing-md);
  font-size: var(--font-size-sm);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.1s;
}

.btn-primary {
  background: var(--color-accent);
  color: var(--color-bg);
  border: none;
}

.btn-primary:hover {
  background: var(--color-accent-secondary);
}

.btn-secondary {
  background: var(--color-bg-secondary);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover {
  background: var(--color-bg-tertiary);
}

.btn-ghost {
  background: transparent;
  color: var(--color-text-secondary);
  border: none;
}

.btn-ghost:hover {
  background: var(--color-bg-secondary);
  color: var(--color-text);
}

.btn-sm {
  height: var(--item-height-sm);
  padding: 0 var(--spacing-sm);
  font-size: var(--font-size-xs);
}
```

### 6. 输入框样式

```css
/* src/styles/Input.css */
.input {
  height: var(--item-height-md);
  padding: 0 var(--spacing-md);
  font-size: var(--font-size-sm);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  outline: none;
}

.input:focus {
  border-color: var(--color-accent);
}

.input::placeholder {
  color: var(--color-text-tertiary);
}

.input-sm {
  height: var(--item-height-sm);
  font-size: var(--font-size-xs);
}
```

### 7. 间距优化

**当前间距**：过于宽松，信息密度低
**优化后间距**：紧凑，一屏显示更多

| 元素 | 当前 | 优化后 |
|------|------|--------|
| 列表项高度 | 48px | 32px |
| 列表项间距 | 12px | 0（border 分隔） |
| 导航栏高度 | 64px | 56px |
| 侧边栏宽度 | 240px | 200px |
| 详情面板宽度 | 360px | 300px |
| padding | 16px | 12px |

### 8. 颜色对比度

```css
/* 高对比度方案 */
--color-text: #000000;           /* 对背景 100% 对比 */
--color-text-secondary: #666666; /* 对背景 40% 对比 */
--color-text-tertiary: #999999;  /* 对背景 60% 对比 */
--color-border: #e0e0e0;         /* 对背景 12% 对比 */

/* 暗黑模式 */
--color-text: #ffffff;           /* 对背景 100% 对比 */
--color-text-secondary: #a0a0a0; /* 对背景 63% 对比 */
--color-text-tertiary: #6a6a6a;  /* 对背景 42% 对比 */
```

### 9. 字体大小

```css
/* 紧凑字体 */
--font-size-xs: 12px;  /* 辅助信息、快捷键标记 */
--font-size-sm: 14px;  /* 列表项、按钮 */
--font-size-md: 16px;  /* 搜索框、标题 */
--font-size-lg: 18px;  /* 大标题 */
--font-size-xl: 20px;  /* 主标题（不常用） */
```

### 10. 圆角

```css
/* 小圆角 */
--radius-sm: 4px;   /* badge、meta */
--radius-md: 6px;   /* 按钮、输入框 */
--radius-lg: 8px;   /* 卡片、面板 */
--radius-xl: 12px;  /* 窗口整体 */
```

## 边界

- 不引入外部 CSS 框架（保持轻量）
- 不实现复杂动画（避免性能问题）
- 设计 token 用 CSS 变量，不用 JS 动态计算
- 暗黑模式后续提案

## 验证要求

- 快捷面板圆角、毛玻璃效果正常
- 列表项高度紧凑（32px）
- 信息密度提升（一屏显示更多）
- 字体大小一致
- 颜色对比度符合可访问性标准
- `pnpm build` 通过
- `pnpm tauri dev` 验证视觉效果