# 设计：黑白面板与稳定多选导航

## 视觉规则

主面板只使用黑白灰 token：

- 文本：黑色 `oklch(0.12 0 0)`。
- 次级文本：半透明黑色。
- 背景：透明白色玻璃或极浅灰。
- 边框：半透明黑色。
- 选中边框：黑色虚线。
- 删除：只在多选上下文中使用红色语义色，默认列表和底部 dock 不展示。

选中态不再使用 target cursor 动画。原因是当前虚拟列表、滚动条 gutter 和多轮 CSS 覆盖共同作用时，移动框容易出现偏移，影响可信度。P1 改为每行自身显示直角虚线边框，后续如果要恢复动效，必须先抽成独立 `TargetFocusRing` 组件并单独验证对齐。

## 布局规则

### 默认列表

```text
┌────────────────────────────┐
│        glass search         │
├────────────────────────────┤
│  1  clipboard content ...   │
│  2  clipboard content ... ☆ │
│  3  clipboard content ...   │
├────────────────────────────┤
│ status        history fav…  │
└────────────────────────────┘
```

- 搜索层透明玻璃，居中/全宽，不用厚重实体白块。
- 列表行占满宽度，左右 8px。
- 行高固定，文本 12px，一行省略。
- hover 只改变虚线边框透明度，不使用大面积背景色。
- 收藏过的条目默认显示收藏标记；未收藏只在 hover/focus 时显示。

### 多选模式

```text
┌────────────────────────────┐
│ ←  列表 / 多选     2 selected │
│ [ ]   聚合详情   复制   删除  │
├────────────────────────────┤
│ ✓ selected content ...       │
│ ✓ selected content ...       │
│ 38 normal content ...        │
├────────────────────────────┤
│ status        history fav…   │
└────────────────────────────┘
```

- 多选开启后顶部固定显示操作台。
- 顶部操作台承载多选路径、选中数量、全选、聚合详情、复制、删除、关闭。
- 底部 dock 不承担上下文动作，避免导航和操作混在一起。
- `ArrowRight` 进入 `/aggregate` 聚合工作台，`ArrowLeft` 或 `Esc` 返回列表/退出多选。

## 交互规则

- 行主体点击：复制。
- 数字块点击：进入多选并切换该条选择。
- 选中态：行自身黑色虚线边框，稳定对齐，不做移动动画。
- `Space`：单条模式快速预览，多选模式切换 active item。
- `Cmd+数字`：复制或多选切换；普通数字仍保留给搜索。
- 删除：默认列表不暴露，多选操作台可删除到垃圾箱，垃圾箱内才允许彻底删除。

## 启动验证规则

每次视觉验证前必须确认：

```bash
ps -ax -o pid=,command= | rg "ClipForge.app/Contents/MacOS/clipforge|target/debug/clipforge|tauri.js dev|vite"
```

只允许出现：

- `tauri.js dev`
- `vite`
- `target/debug/clipforge`

如果出现 `src-tauri/target/debug/bundle/macos/ClipForge.app/Contents/MacOS/clipforge`，必须先强制结束。否则 Computer Use 和截图会命中旧 bundle，导致误判。

