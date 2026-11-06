# Snipaste 2.9 逆向调研报告

> 日期:2026-10-12 · 方法:REA 6.4.0 工具链 + Qt 资源静态分析(mac 本机 /Applications/Snipaste.app)
> 目的:为 ClipForge「截图+贴图」能力规划提供功能全景与实现参照。**纯调研,未改 ClipForge 任何源码。**

## 1. 目标概况

| 项 | 事实 |
|---|---|
| 版本 | Snipaste 2.9(macOS 通用版,2024-04 构建) |
| 技术栈 | Qt5/QWidgets 原生 C++,Mach-O universal (x86_64+arm64),89MB |
| 窗口形态 | LSUIElement(无 Dock 常驻托盘应用),全自绘截屏遮罩 |
| 商业模式 | 基础免费;PRO 45 元/单设备(多选贴图、反色/灰度、命令行组合输出等) |
| 授权技术 | licensepp (zuhd-org) |

## 2. 逆向方法与证据

- REA 原生引擎(Hopper/Ghidra/IDA)本机均未安装,Qt C++ 反编译路径未走;改用三条替代路径,均成功:
  1. **`.qm` 翻译资源解析**(核心突破):`Contents/Resources/lang/` 内置 55 种语言。Snipaste 打包用 Qt 6.5+ 私有格式(整体 smaz 压缩+字符串哈希),但 `qt_*.qm`(Qt 库串)是明文,`zh_cn.qm` 在哈希表错位下仍可按记录结构(记录=`01` 分隔 + `03`译文UTF-16BE + `08`comment + `06`source + `07`context)切出 **870 条消息、815 条干净简体中文文案**,覆盖 47 个功能类。解析脚本:`.work/evidence/parse_qm3.py`,全量数据:`.work/evidence/snipaste_zh_cn.tsv`。
  2. **二进制字符串提取**(arm64 切片):拿到 120 个设置控件 ID(cb_/sp_/le_/rb_ 前缀)、39 个 Qt 功能类名、命令行用法文档(嵌入 ini 注释)、config.ini 全部高级配置项(含默认值与版本沿革)。
  3. **REA 能力验证**:`npx rea-agents` CLI 6.4.0 全目录可用;`analyze-javascript-application` 等静态 JS 路径对 Qt 应用不适用,本次主要价值在确证「无引擎时的分析边界」。

## 3. 功能全景(逆向所得,按域)

### 3.1 截屏(Snipper)
- 区域选择:自动检测**窗口**与**界面元素**(按钮/菜单,AX 层级)双层,可热键切换;元素上下层切换;1px 微调(方向键移动区域、Shift+WASD 挪指针);从中心缩放;区域回放(上次成功区域一键重截);多屏+高分屏。
- 放大镜:像素级取色,RGB/HEX(可切换、可大写),网格线、锚点/边框/遮罩开关,像素放大倍数可调。
- 辅助:全屏十字线、截屏时辅助线、遮罩颜色自定义、捕捉鼠标指针、历史记录回放(`,`/`.` 切换截屏记录)、延时截屏、白板模式/透明白板模式(双击 Esc 退出)、活动窗口截取、带阴影截取、自定义尺寸对话框。
- 截屏中动作:Esc 确认弹层、右键重选/中止、双击复制(可配)、中键贴屏(可配)、刷新截图(重截屏帧)。

### 3.2 贴图窗(Paster)
- 来源:截图、剪贴板图像/**纯文本/HTML/颜色值转图**、图像文件(GIF/APNG 动图支持,PlugIns 有 libqapng)。
- 窗口操作:滚轮缩放(GIF=变速)、1/2 或 [ ] 旋转、3/4 镜像、Ctrl+滚轮透明度、鼠标穿透、缩略图(Shift+双击)、隐藏(双击)、Alt 取色、背景模式(伪透明/暗色/浅色棋盘)、窗口阴影、窗口吸附(magnetic_attach_threshold,默认 20px*DPI)、边缘贴边。
- 批量:多选(Ctrl/Shift 点选)、**全选可见贴图 [PRO]**、批量隐藏/显示、贴图分组(导入/导出/切组闪烁/组管理)、分配到桌面(全部/当前/自定义桌面)。
- 生存期:自动备份全部贴图状态(重启恢复)、可恢复贴图数上限(sp_maxHiddenPasters)、置顶策略、文件拖放、网页图片拖入自动下载(≤20MB)。
- 右键菜单:复制(图像/原始大小/纯文本/HTML/源文件路径)、另存、打开图片、在文件夹中查看、旋转/翻转/裁剪、替换为文件、输出选项(边框/阴影/圆角)、平滑处理、播放/暂停(GIF)。

### 3.3 标注(PaintBar,截图与贴图共用)
- 工具:画笔、记号笔、矩形/椭圆(描边/填充/带边框填充三态)、直线/折线、箭头(首尾独立开关)、铅笔、文本(字体族/缩放/粗斜体/文字背景)、马赛克/高斯模糊(可切换)、橡皮擦(可重编辑)、数字序号、放大镜(放大局部贴片)、颜色板(自定义+预设,形状分别记忆颜色可开关)。
- 通用:宽度滚轮调节(1/2/[/] 同效)、撤销/重做(可恢复 N 步)、清除区域内容、切换像素平滑。
- 实现线索:类名 PaintScene/PaintView/PaintItem 家族(QGraphicsScene 架构),14 个 XxxPaintItem 子类。

### 3.4 全局热键与托盘
- 热键命令可**自定义多条**(HotkeyCmdDialog:名称+命令),内置:截屏、截屏并自动复制、截屏并贴图、截屏/复制/贴图三连、贴图(图像/纯文本/HTML)、拾取色值、扫描二维码/条形码(BarcodeButton)、白板、记事本、显示/隐藏所有贴图、切组、全屏截图并复制、重复上次区域、禁用/启用全部热键、触发角(hot corner,四角独立+延迟+忽略名单)。
- 托盘:左/中/右键动作可配、增强菜单、图标颜色(主题色/自定义/彩色)、左键行为可设为截图/贴图等。
- 快捷键体系(59 条 KeybindingModel 条目):截屏态与贴图态两套 + 通用层;含 Esc 确认、Tab 切换窗口/元素检测、空格标注开关、`/` 像素微调等。

### 3.5 输出与自动化
- 输出目标:剪贴板(可选 BMP 附带格式)、文件(命名规则引擎:日期/时间/毫秒/计算机名/用户名/窗口标题/环境变量/时区等 20+ 变量,长度限制)、快捷保存目录(自动保存+提示音)、打印、**`-o exec(命令)` 截图成功后执行外部命令**。
- 命令行(嵌入二进制的用法文档):`snip [--area|--size|--full|--last|--active-window|--custom] [--delay N] [--shadow|--no-shadow] -o pin|clipboard|FILE|quick-save|file-dialog|printer|success|exec(CMD)`;PRO 可 `;` 组合多输出(固定顺序);`paste [--plain TEXT|--html TEXT|--files ...]`;`pick-color`;`--config=PATH`。
- 设置项 120 个控件 ID,分 8 大组:General/Snip/Paste/Annotate/Output/Hotkey2/Misc/Log;高级项含 GPU 加速(马赛克/阴影性能)、代理(检查更新用)、双击间隔、透明像素 alpha 移除(减小文件)。

### 3.6 PRO 门槛功能(免费版没有)
全选可见贴图、反色/灰度显示、命令行多输出组合、写软件元数据开关。

## 4. 本机数据布局(参照)

- `~/Library/Application Support/Snipaste/`:`config.ini`(文本配置)、`history/`(截屏历史)、`splog.txt`(日志)。
- `defaults` 域 `com.Snipaste`(少量)。历史目录可在 config.ini 改 `history_dir`。

## 5. 与 ClipForge 的差距与集成评估

ClipForge 现状(Tauri v2 + Rust + React):剪贴板采集/回写/归档/搜索主链路完整,editor 画布域已有,但**截图域为零**(无 ScreenCaptureKit/CGWindow 代码),无贴图窗概念。

### 可直接复用的 ClipForge 基础设施
- 全局快捷键(tauri-plugin-global-shortcut)+ 托盘 → 对应 Snipaste 热键/托盘层
- 无框置顶面板与焦点管理(perf-panel 探针体系)→ 贴图窗/截屏 UI 的工程基础
- AX 权限链路(check_accessibility_permission 等)→ 窗口/元素检测复用
- editor 画布域 → 标注工具的宿主
- settings_service 三件套 → Snipaste 式 8 组设置可平移进现有设置面

### 需新建的原生能力(Rust 侧,macOS)
1. 截屏:ScreenCaptureKit(SCScreenshotManager)或 `screencapture` CLI 兜底;逐屏帧缓存(刷新截图=重截帧)
2. 窗口/元素检测:CGWindowList(窗口矩形)+ AX API(元素树)——AX 链路已有,需加层级遍历
3. 贴图窗:每贴图一个 NSPanel(非激活、浮层、可穿透),Rust 侧管理窗口池;或单 panel+多画布(需评估点击穿透)
4. 文本/颜色转图:纯前端可做(SVG/canvas 渲染),无需原生
5. 取色放大镜:截屏帧 + 前端 canvas 放大即可,无需独立原生组件

### 风险与边界
- **Qt 自绘细节不可直接照搬**,macOS 上 Snipaste 的元素检测也是 AX 实现,行为可对齐但实现是自己的;GPU 加速、Windows 专属项(exclude_from_detection 等)不适用。
- Snipaste 是**免费+付费闭源软件**;本次逆向仅用于功能规划(行为清单),ClipForge 实现必须是原创代码,**不得反编译其二进制搬运代码**。
- 版权红线:文案、图标、音效(snipaste.icns/sound)均不可复制;交互行为与功能集不受版权保护,可安全参照。
- 体量建议:这是 ClipForge 继「剪贴板工具闭环」之后的下一主域,建议按 openspec 波次立项,不建议在剪贴板主链路未收口前动手。

## 6. 结论

1. Snipaste 全部功能面已通过**资源层逆向**(815 条文案 + 120 设置项 + 39 类名 + 完整命令行/ini 文档)拿到,无需原生反编译引擎,证据链完整可审计。
2. 功能边界清晰:截屏器(含元素检测/放大镜/历史回放)、贴图窗(转图/分组/批量/备份恢复)、标注 14 工具、热键+触发角+托盘、输出自动化(命名引擎/exec 钩子/命令行)。PRO 差异仅 4 项。
3. 对 ClipForge:集成**可行且基础设施大半现成**;核心缺口是 macOS 截屏(SCKit)与贴图窗(NSPanel 窗口池)两块原生能力,标注可复用 editor 域。建议作为独立波次提案(见 `openspec/changes/snipaste-parity/`),与剪贴板主链路解耦,分四阶段推进(取色/截屏→标注→贴图→自动化)。
