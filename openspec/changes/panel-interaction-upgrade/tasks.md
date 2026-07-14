# 任务：悬浮面板交互升级

## P0 · 核心交互 bug
- [x] 快捷键 Ctrl+V 改 toggle（可见即隐藏），修复"只触发一次"
- [x] 点击条目 = 直接粘贴并关闭面板（paste_clipboard_text 已含写入+隐藏+模拟 Cmd+V）
- [x] 失焦/外部点击自动关闭延时 900ms→180ms
- [x] 列表序号收敛为激活分组内 0-9

## 定位（多显示器/Retina）
- [x] cursor_logical_point：macOS 用 CGEvent.location()，绕开主屏 scale bug
- [x] monitor_for_logical_point：逻辑命中 + primary 兜底（不回退 current_monitor）
- [x] 修复 position_follow_cursor / panel_position 物理当逻辑（H1）
- [x] position_tray_center 改用光标屏（H4）
- [x] save_panel_position 物理坐标先转逻辑再归一化（Gap#1，持久态）
- [x] 异步焦点覆盖加「焦点屏==光标屏」一致性校验（H5）
- [x] 新增原生 CGWindowList 激活窗体中心作为统一兜底
- [x] FocusInput 策略实际启用激活窗体/AX（Gap#2）
- [x] 全链路 panel-position 调试日志（PRIMARY FALLBACK 告警）

## 分组快捷键
- [x] VirtualList：视口中心算激活分组 + scrollToGroupStart 命令式切组
- [x] 序号 0-9（激活组内），非激活组不显示
- [x] Cmd+0-9 触发激活组第 N 项
- [x] Cmd+↑/↓ 切组 + 焦点跟随新组第一项；纯 ↑/↓ 逐项移动
- [x] 移除 target-focus-ring，改用 .in-active-group 整组背景态

## pin 固定面板
- [x] PANEL_PINNED 标志 + set_panel_pinned_command（对齐 EcoPaste）
- [x] 所有自动隐藏路径在 pinned 时跳过（不移动面板）
- [x] 右上角悬浮 FAB（液态模糊玻璃圆，激活黑/未激活灰，tooltip「固定窗体」）
- [x] 修复 pinned 后点击外部仍隐藏：启动时从持久化设置恢复 PANEL_PINNED（前后端一致）；hide-quick-panel 事件加 pin 守卫（防御纵深）；blur 路径加 panel-pin 调试日志

## 多选工具栏
- [x] 操作按钮 icon-only + tooltip
- [x] 去删除二次确认（已即时删除）
- [x] 批量收藏按钮（favoriteSelectedClips，整体 toggle）
- [x] 完成提示 toast（1.2s，聚合复制/删除/批量收藏）

## 尺寸
- [x] 默认 420×488（适配 0-9 分组约 10 行）

## 托盘菜单扩充（对齐 EcoPaste）
- [x] build_tray_menu：打开快捷面板 / 偏好设置… / 暂停·恢复监听剪贴板 / 退出
- [x] 偏好设置 → open_settings_window
- [x] LISTEN_PAUSED 静态 + 后台监听线程每轮跳过采集（仅影响读取入库）
- [x] 切换监听后 tray_by_id + set_menu 重建菜单刷新文案（⏸/▶）
- [x] TrayIconBuilder::with_id(TRAY_ID) 便于重建定位

## 待办（后续）
- [x] 配置面板宽高（通用设置项，open_panel 读取 settings；resolve_panel_dims 读 settings.panelWidth/Height 钳制）
- [x] 单项选中 checkbox 样式对齐多选 checkbox
- [x] 列表右边距 + 滚动条浮右两边等宽
- [x] 长文案中间省略（头尾显示）：拆 head/tail 交 CSS flex，只收缩头部、尾部固定不裁，修复 JS 预截断后被 CSS 二次裁掉尾部
- [x] 输入框空时滚动收起 + 收起/激活态动画
- [ ] 底部导航切换引入 Animate UI Tabs active highlight，保留现有按钮尺寸与 Tooltip，不重排 footer
- [ ] 列表选择态参考 Animate UI Icons 的 hover/selected smooth highlight：保留现有虚线框与 active group 语义，仅让选择框位置/透明度平滑移动
- [ ] 页面内容切换统一使用短 spring 过渡，覆盖 history/favorites/trash/agent surface，避免切换时硬闪
