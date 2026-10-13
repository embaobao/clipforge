# 设计:Snipaste 级截图+贴图能力(snipaste-parity)

> 前置阅读:[proposal.md](./proposal.md) · 逆向依据:[docs/research/snipaste-reversing-report.md](../../../docs/research/snipaste-reversing-report.md)
> 本文只回答「怎么建」;功能验收场景见 [specs/](./specs/)。

## 0. 已核实的宿主事实(2026-10-12 现场确认)

| 基础设施 | 现状 | 对本提案的意义 |
|---|---|---|
| `tauri-nspanel` (v2.1 branch) | 已在 Cargo.toml,面板已 NSPanel 化 | 贴图窗/选区浮层复用同一 NSPanel 通道 |
| `core-graphics` 0.25 / `core-foundation` 0.10 | 已有 | CGWindowList 窗口矩形检测零新依赖 |
| AX 权限链(`AXIsProcessTrusted` 等 5 个 command) | 已有 | 元素检测(后期)直接挂现有权限面 |
| 全局快捷键插件 + 托盘 + autostart | 已有 | 截屏/贴图热键按 settings_service 配置化接入 |
| 多入口 vite(main/settings/onboarding/preview/dev-paste-target) | 已有 | 新增 `snip.html`(选区浮层)入口即可 |
| 图片存储(`get_image_storage_path`)+ rusqlite | 已有 | 截图产物、贴图状态落现有持久化体系 |
| editor 画布域 | 已有 | Phase 2 标注的宿主 |
| perf-panel 探针体系 | 已有 | 选区浮层/贴图窗性能验收直接扩探针 |

## 1. 总体架构

```
全局热键 ─┬─ snip 流程                          paster 流程
          │                                          │
          ▼                                          ▼
  snip/(Rust 新域)                        paster/(Rust 新域)
  ├─ hotkeys.rs  热键注册/分发              ├─ panel.rs    NSPanel 窗口池(原生,非 webview)
  ├─ capture.rs  底图捕获(screencapture CLI → SCK 增强) ├─ transform.rs 缩放/旋转/透明度/吸附
  ├─ windows.rs  CGWindowList 窗口矩形      ├─ menu.rs     原生右键菜单
  └─ selection.rs 选区浮层窗口生命周期      └─ store.rs    贴图状态持久化(SQLite)
          │                                          │
          ▼                                          │
  snip.html(全屏透明 webview,每屏一实例)            │
  ├─ 蒙版+选区+手柄                                   │
  ├─ 放大镜取色(canvas 读底图像素)                   │
  └─ Phase2: 标注编辑器(editor 域复用)             │
          │                                          │
          ▼                                          ▼
  产物去向:剪贴板 / 贴图窗 / 文件 / 剪贴板历史(= capture 链路新 clip,payloadKind=screenshot)
```

原则:

- **热路径零侵入**:snip/paster 全部新域;不碰 `clipboard/` 现有文件;对接点只有两个——产物写剪贴板(writeback guard 复用)与截图入历史(发布 `capture.finished` 事件,走 agent-extension-seams 已定的事件面契约)。
- **域文件 ≤500 行**,纯函数层(`&Connection`/纯数据变换)与 command 薄壳分离,中文注释全覆盖。
- **webview 只用在人的交互点上**(选区浮层、标注、管理面板),**贴图窗本体不用 webview**(见 §3 决策)。

## 2. 关键决策记录

### D1 截屏:L0 系统CLI 起步,SCK 仅作后续增强
- L0:`screencapture -x`(系统自带二进制,静默截全屏/指定区域/指定窗口),产物读入内存作为「底图」。
- 流程:热键 → 先弹蒙版浮层(纯色,体感即时)→ 后台截底图(实测 150-400ms)→ 底图就位后显示冻结画面。
- 区域选择 = 在底图上框选;「刷新截图」= 重截一次底图。
- **P1 全部验收用 L0 即可达成**;ScreenCaptureKit(objc2 bindings)列为 P4 后可选优化(帧级低延迟、逐屏缓存),不阻塞任何功能。
- 理由:SCK 的 Rust binding 生态不成熟,自写 FFI 量大;CLI 路径零依赖、当天可通,风险后置。

### D2 窗口检测用 CGWindowList,元素检测推迟
- `CGWindowListCopyWindowInfo`(core-graphics 已含 binding)拿窗口矩形+图层+归属,截屏时高亮命中窗口。
- **界面元素检测(AX 层级遍历)不进 P1**:AX FFI 量大,且窗口级已覆盖 80% 场景;列为 Phase 4 后可选(Snipaste 的 Tab 切换检测语义保留在热键表)。

### D3 贴图窗:原生 NSPanel,不用 webview
- 每个 webview ≈30-60MB;50 贴图 = 不可接受。改用 AppKit 原生 NSPanel(NSImageView + NSTrackingArea),单窗 ≈2-5MB。
- 缩放/旋转/翻转/透明度/边缘吸附全部 AppKit 原生;右键菜单 NSMenu 原生。
- 贴图窗「标注」不内嵌:提供「编辑」入口,按需唤起 webview 标注编辑器(与截屏标注同一套),编辑结果替换原贴图。**P3 不做贴图内嵌标注**,已在 proposal 明确。
- 复用 tauri-nspanel 的 objc 通道;`set_ignore_cursor_events` 做鼠标穿透。

### D4 文本/颜色转图:隐藏 webview 离屏渲染
- 中文排版(shaping/字体回退)交给 WebKit,零新依赖:隐藏 webview 渲染 HTML → canvas → toDataURL → 回传 PNG。
- 一次渲染 50-100ms,转图前有可见预览,延迟可接受。
- 颜色转图(色块+HEX 文本)同理,颜色识别复用 `clipboard/detect.rs` 的 `looks_like_color` 语义。

### D5 产物入剪贴板历史 = 现有 capture 链路的自然延伸
- 截图/贴图/取色产物统一走 `write_clipboard_item` 等价路径(复用 writeback guard 抑制回环),payloadKind=`screenshot`/`color`,在面板列表可见、可搜索、可回贴——**这是与 ClipForge 协同的核心价值,也是对 Snipaste 的超越点**。

### D6 权限:屏幕录制(必须)+ 辅助功能(仅窗口检测增强)
- Info.plist 增 `NSScreenCaptureUsageDescription`;检测用 `CGPreflightScreenCaptureAccess`/`CGRequestScreenCaptureAccess`(两行 extern C,零依赖),对齐现有 AX 权限 command 模式。
- 权限缺失时:截屏热键触发引导 UI,不静默失败。
- CGWindowList 窗口名读取在 macOS 15+ 需屏幕录制权限即可,不额外要求 AX。

### D7 热键默认值与冲突策略
- 默认:`F1` 截屏、`F3` 贴图(对齐 Snipaste 肌肉记忆),settings_service 可改;沙箱实例冲突降级为 warning(现有机制)。
- 触发热键时若 ClipForge 面板正显示,先隐藏面板,避免焦点纠缠。

## 3. 数据与状态

### SQLite 新表(paster 域自管迁移,不动 clip 表)
```sql
CREATE TABLE paster_windows (
  id TEXT PRIMARY KEY,            -- uuid
  image_ref TEXT NOT NULL,        -- 图片存储相对路径
  x REAL, y REAL,                 -- 屏幕坐标(全局逻辑坐标)
  width REAL, height REAL,        -- 当前显示尺寸(逻辑)
  natural_width REAL, natural_height REAL,
  scale REAL DEFAULT 1.0, rotation REAL DEFAULT 0,
  flip_h INTEGER DEFAULT 0, flip_v INTEGER DEFAULT 0,
  opacity REAL DEFAULT 1.0,
  click_through INTEGER DEFAULT 0,
  group_name TEXT DEFAULT '默认',
  source_kind TEXT NOT NULL,      -- snip|clipboard-image|text|color|file
  created_ms INTEGER NOT NULL
);
```
- 退出时快照、启动恢复(对齐 Snipaste 自动备份行为);窗口池上限 50,超限 LRU 淘汰(降采样缩略图留存可后续增强,首版直接关闭最旧)。
- 上次截屏区域、底图缓存等易失状态存内存,不持久化。

### 前端新入口
- `snip.html` + `src/snip/`:选区浮层(全屏透明、每屏一实例、label `snip-screen-{index}`);内含蒙版、选区手柄、放大镜、工具条(Phase 2 起挂标注)。
- 贴图窗无前端入口(纯原生);贴图管理(分组/批量)复用 settings 窗口新 section,推迟至 P3.5。

## 4. 性能预算(扩展现有 perf 探针)

| 动作 | 预算 | 测法 |
|---|---|---|
| 热键 → 蒙版浮层出现 | ≤120ms | 探针:注册回调打点 |
| 热键 → 底图就位(冻结画面可见) | ≤600ms(CLI 路径) | 探针 |
| 确认选区 → 剪贴板可粘贴 | ≤150ms | 探针:裁剪+PNG 编码打点 |
| 贴图指令 → NSPanel 可见 | ≤200ms | 探针 |
| 10 贴图同屏滚动/缩放 | 无可感卡顿(60fps) | 手动 + 动画可打断探针思路 |

## 5. 安全与隐私边界

- 截图默认**不自动入历史**(设置可开);快捷保存目录默认关闭。
- 不做 `-o exec(外部命令)`(proposal 已定);不读取其他应用内容,窗口检测只用公开矩形信息。
- 转图/标注全部本地;无网络路径。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| screencapture CLI 在无头/受限环境不可用 | 权限引导兜底;L1 SCK 增强路径保留 |
| 全屏冻结画面与真实屏幕有偏差(DPI/多屏排布) | 底图按屏捕获(`-D` 指定 display),逻辑/物理坐标换算集中在 `selection.rs` 单测 |
| NSPanel 经 objc 的生命周期管理(Rust 侧泄漏/悬垂) | 窗口池统一持有 + drop 测试;沿用 tauri-nspanel 成熟模式,不自写 raw objc runtime |
| WKWebView 离屏渲染时序不稳 | 渲染完成以消息回执为准(超时 2s 报错),不用固定 sleep |
| 全局热键与稳定版冲突 | 现有沙箱 warning 降级机制沿用;探针跑前确认解锁(已知约束) |

## 7. 交付节奏(与 tasks.md 对应)

每 Phase 一个可独立验收的交付,顺序:P1 截屏+取色 → P2 标注 → P3 贴图 → P4 自动化。P2 与 P3 可并行(P2 在前端域,P3 在 Rust 域,无文件交集)。
