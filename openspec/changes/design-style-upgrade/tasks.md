# 任务：UI 设计风格升级

## Phase 1：设计 Token 体系

- [x] 创建 tokens.css（颜色、字体、间距、圆角）
- [x] 定义黑白对比颜色变量
- [x] 定义紧凑间距变量
- [x] 定义字体大小变量（xs~xl）
- [x] 定义圆角变量（sm~xl）
- [x] 定义列表项高度变量

## Phase 2：快捷面板样式优化

- [x] QuickPanel.css 重写
- [x] 透明背景 + 毛玻璃效果
- [x] 圆角裁切（12px）
- [x] 紧凑列表项（32px 高度）
- [x] 快捷键标记样式（小号字体）
- [x] 搜索框样式

## Phase 3：管理窗口样式优化

- [x] MainWindow.css 重写
- [x] Grid 布局（侧边栏 200px + 内容区 + 详情面板 300px）
- [x] 导航栏紧凑（56px 高度）
- [x] 侧边栏紧凑（200px 宽度）
- [x] 详情面板紧凑（300px 宽度）
- [x] 边框分隔（不用阴影）

## Phase 4：列表样式优化

- [x] ClipList.css 重写
- [x] 紧凑列表项（32px 高度）
- [x] Border 分隔（不用间距）
- [x] 选中项边框高亮
- [x] 辅助信息小号字体

## Phase 5：按钮样式优化

- [x] Button.css 重写
- [x] 紧凑按钮（32px 高度）
- [x] 小号字体（14px）
- [x] 无阴影（用背景色变化）
- [x] 三种变体：primary/secondary/ghost

## Phase 6：输入框样式优化

- [x] Input.css 重写
- [x] 紧凑输入框（32px 高度）
- [x] Focus 边框高亮
- [x] Placeholder 颜色

## Phase 7：等宽字体应用

- [x] ID 使用 Mono 字体
- [x] 代码片段使用 Mono 字体
- [x] 快捷键标记使用 Mono 字体

## Phase 8：间距优化

- [x] 列表项高度从 48px 改为 32px
- [x] padding 从 16px 改为 12px
- [x] 导航栏高度从 64px 改为 56px
- [x] 侧边栏宽度从 240px 改为 200px

## Phase 9：颜色对比度优化

- [x] 主文本黑色（#000）
- [x] 辅助文本灰色（#666）
- [x] 边框浅灰色（#e0e0e0）
- [x] 高对比度验证

## Phase 10：验证

- [x] 检查：快捷面板圆角、毛玻璃
- [x] 检查：列表项高度紧凑
- [x] 检查：信息密度提升
- [x] 检查：字体大小一致
- [x] 检查：颜色对比度符合 WCAG
- [x] `pnpm build` 通过
- [x] `pnpm tauri dev` 验证视觉效果

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

## Phase 11：来源应用与资源类型识别

- [x] Rust 后端捕获来源应用名称、bundle id、可执行路径
- [x] Rust 后端提取来源应用图标并转为 base64 PNG
- [x] 数据库增加 source_app_name / source_app_bundle / source_app_executable / source_app_icon 字段
- [x] 前端列表显示来源应用名称与图标
- [x] 扩展 payload_kind 识别：text / link / markdown / code / command / html / file / image / json / chart / table
- [x] 列表显示类型标签与图标

## Phase 12：iOS 26 Safari 式沉浸导航

- [x] 面板背景透明度可配置（panelBackgroundOpacity，20%–100%）
- [x] 设置面板增加透明度滑块和滚动隐藏开关
- [x] 底部 Dock 随列表向下滚动自动隐藏，向上滚动或回顶自动显示
- [x] 顶部搜索随滚动距离收缩，回顶恢复
- [x] 使用 CSS 变量 --cf-panel-bg-opacity 统一控制面板背景透明度

## Phase 13：交互修复

- [x] 多选首次点击列表滚动不触发选择：VirtualList 仅在键盘导航时自动滚动
- [x] Space 键改为选中当前项并打开预览绑定
- [x] 快速预览卡片固定高度约 38%，内容区域支持滚动
- [x] 搜索未触发时显示悬浮胶囊玻璃按钮，触发后全宽展开
- [x] 收藏等按钮激活态使用液态玻璃背景

## 验证

- [x] `pnpm build` 通过
- [x] `cd src-tauri && cargo check` 通过
- [x] 来源应用图标提取接口编译通过

## 依赖变更

### Cargo.toml

```toml
file_icon_provider = "1"
image = { version = "0.25", default-features = false, features = ["png"] }
base64 = "0.22"
```

### package.json

无需新增依赖。

## 文件修改

- `src-tauri/src/lib.rs`：来源应用信息捕获、图标提取、payload_kind 识别
- `src-tauri/Cargo.toml`：新增 file_icon_provider / image / base64 依赖
- `src/App.tsx`：来源应用图标显示、滚动沉浸导航状态、Space 选择预览
- `src/App.css`：P-FINAL.4 iOS 26 Safari 式导航样式
- `src/settings.tsx`：透明度与滚动隐藏设置控件
- `src/settings.css`：滑块与开关样式

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

## 完成记录

- 2026-07-08：Phase 11–13 实现完毕，`pnpm build` 与 `cd src-tauri && cargo check` 均通过，剩余 6 条 Rust 未使用变量/函数警告（与本次 UI 改动无关）。