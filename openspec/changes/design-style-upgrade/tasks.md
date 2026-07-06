# 任务：UI 设计风格升级

## Phase 1：设计 Token 体系

- [ ] 创建 tokens.css（颜色、字体、间距、圆角）
- [ ] 定义黑白对比颜色变量
- [ ] 定义紧凑间距变量
- [ ] 定义字体大小变量（xs~xl）
- [ ] 定义圆角变量（sm~xl）
- [ ] 定义列表项高度变量

## Phase 2：快捷面板样式优化

- [ ] QuickPanel.css 重写
- [ ] 透明背景 + 毛玻璃效果
- [ ] 圆角裁切（12px）
- [ ] 紧凑列表项（32px 高度）
- [ ] 快捷键标记样式（小号字体）
- [ ] 搜索框样式

## Phase 3：管理窗口样式优化

- [ ] MainWindow.css 重写
- [ ] Grid 布局（侧边栏 200px + 内容区 + 详情面板 300px）
- [ ] 导航栏紧凑（56px 高度）
- [ ] 侧边栏紧凑（200px 宽度）
- [ ] 详情面板紧凑（300px 宽度）
- [ ] 边框分隔（不用阴影）

## Phase 4：列表样式优化

- [ ] ClipList.css 重写
- [ ] 紧凑列表项（32px 高度）
- [ ] Border 分隔（不用间距）
- [ ] 选中项边框高亮
- [ ] 辅助信息小号字体

## Phase 5：按钮样式优化

- [ ] Button.css 重写
- [ ] 紧凑按钮（32px 高度）
- [ ] 小号字体（14px）
- [ ] 无阴影（用背景色变化）
- [ ] 三种变体：primary/secondary/ghost

## Phase 6：输入框样式优化

- [ ] Input.css 重写
- [ ] 紧凑输入框（32px 高度）
- [ ] Focus 边框高亮
- [ ] Placeholder 颜色

## Phase 7：等宽字体应用

- [ ] ID 使用 Mono 字体
- [ ] 代码片段使用 Mono 字体
- [ ] 快捷键标记使用 Mono 字体

## Phase 8：间距优化

- [ ] 列表项高度从 48px 改为 32px
- [ ] padding 从 16px 改为 12px
- [ ] 导航栏高度从 64px 改为 56px
- [ ] 侧边栏宽度从 240px 改为 200px

## Phase 9：颜色对比度优化

- [ ] 主文本黑色（#000）
- [ ] 辅助文本灰色（#666）
- [ ] 边框浅灰色（#e0e0e0）
- [ ] 高对比度验证

## Phase 10：验证

- [ ] 检查：快捷面板圆角、毛玻璃
- [ ] 检查：列表项高度紧凑
- [ ] 检查：信息密度提升
- [ ] 检查：字体大小一致
- [ ] 检查：颜色对比度符合 WCAG
- [ ] `pnpm build` 通过
- [ ] `pnpm tauri dev` 验证视觉效果

## 依赖变更

### 无新增依赖

使用现有 CSS，不引入外部框架。

## 文件变更

### 新增文件

- `src/styles/tokens.css`：设计 Token 体系
- `src/styles/QuickPanel.css`：快捷面板样式
- `src/styles/MainWindow.css`：管理窗口样式
- `src/styles/ClipList.css`：列表样式
- `src/styles/Button.css`：按钮样式
- `src/styles/Input.css`：输入框样式

### 修改文件

- `src/App.css`：引入 token 和样式文件
- `src/components/QuickPastePanel.tsx`：应用新样式
- `src/components/ClipList.tsx`：应用新样式
- 各组件：替换硬编码样式为 CSS 变量

## 设计参考

### pi.dev 风格

- 黑白对比
- 极简布局
- 高信息密度
- 无阴影
- 小圆角

### shadcn/ui Token

- Semantic tokens
- 无依赖复制
- CSS 变量方式