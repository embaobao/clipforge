# 任务：稳定黑白高密度快捷面板

## 1. 启动与验证纠偏

- [x] 查明旧布局来源是生产 bundle 进程，而不是当前 dev 主入口。
- [x] 强制结束 `target/debug/bundle/macos/ClipForge.app` 旧进程。
- [x] 在最终交付中说明验证时只保留 dev 进程。

## 2. 黑白主题与选中态

- [x] 移除当前主列表青色/蓝色 target cursor 选中效果。
- [x] 将 active、hover、selected 统一为黑色直角虚线边框。
- [x] 删除选中 pulse、移动框和歪斜角标。
- [x] 保持列表行无厚重背景、无阴影、无卡片感。

## 3. 多选顶部导航

- [x] 多选模式顶部显示操作台。
- [x] 操作台包含返回、多选路径、选中数量、全选、聚合详情、复制、删除、关闭。
- [x] 底部 dock 只保留导航和状态。
- [x] `ArrowRight` 进入聚合详情，`ArrowLeft`/`Esc` 回退。

## 4. 行级信息密度

- [x] 列表左右 8px，行内容撑满宽度。
- [x] 文本保持 12px，一行省略。
- [x] 行内默认不展示删除。
- [x] 收藏过的条目默认显示收藏标记，未收藏只在 hover/focus 显示。

## 5. 验证

- [x] `pnpm build`
- [x] `cd src-tauri && cargo check`
- [x] `pnpm tauri dev`
- [x] 使用真实应用截图验证无旧布局、黑白虚线选中、多选顶部操作台。

## 实现说明

- 多选上下文动作已从底部浮层迁移到顶部操作台。
- 列表 active、hover、selected 均由行自身黑色直角虚线边框表达；旧 target cursor、pulse 和蓝色角标被最终 CSS 覆盖禁用。
