# 提案:Snipaste 级截图+贴图能力(snipaste-parity)

> 状态:**方案已评审待放行** — 基于逆向调研 [docs/research/snipaste-reversing-report.md](../../../docs/research/snipaste-reversing-report.md)(2026-10-12)。
> 开发方案见 [design.md](./design.md)(决策 D1-D7),功能验收场景见 [specs/](./specs/)(4 个 capability delta)。
> 前置铁律:剪贴板主链路(快速工具闭环)优先级不变;本提案全部工作**不得触碰热路径**(采集/回写/面板显隐)。遵守 AGENTS.md:AI 能力不进本域,新 Rust command 域文件拆分 ≤500 行,全部公共能力中文注释。

## Why

ClipForge 定位是剪贴板工具,剪贴板闭环后最高频的相邻需求就是「截一张→贴在屏幕上」。Snipaste 证明了截屏+贴图与剪贴板历史是天然一体(贴图来源之一就是剪贴板图像,ClipForge 已有图像采集/存储链路)。逆向已拿到 Snipaste 完整功能面(815 条文案、120 设置项、59 热键语义、命令行协议),行为参照充分。

## What Changes(分四阶段,每阶段独立可交付)

### Phase 1 — 截屏 + 取色(核心域新建 `src-tauri/src/screenshot/`)
- macOS 原生截屏:ScreenCaptureKit 截全屏帧 → Rust 侧缓存逐屏帧;区域选择 UI 复用无框置顶窗口体系(perf-panel 探针可测)。
- 自动检测窗口(CGWindowList 矩形);元素检测(AX 层级遍历)复用现有 AX 权限链路,第二阶段再上。
- 放大镜取色:前端 canvas 放大截屏帧,RGB/HEX 输出 → **直接写入 ClipForge 剪贴板历史**(与现有 capture 链路对接,产生协同价值)。
- 对应 Snipaste 热键语义子集:截屏、截屏并复制、全屏截图、重复上次区域。

### Phase 2 — 标注(editor 域扩展,不新建域)
- 在截屏确认前提供 Snipaste 工具子集:画笔、矩形/椭圆、箭头、文本、马赛克/模糊、序号、撤销/重做;宽度滚轮调节。
- 宿主:现有 editor 画布域提取共享图层组件;复用 ClipForge 图片存储(标注结果=新图像 clip 入历史,可选)。
- 不做(首版):记号笔混合模式、放大镜贴片、折线、文字背景、形状记忆色。

### Phase 3 — 贴图窗(新域 `src-tauri/src/paster/`,窗口池)
- 每贴图一个 NSPanel(非激活、always-on-top、可鼠标穿透、可置底);来源:截图、**剪贴板当前内容**(图像/文本/颜色转图,后两者前端渲染成图)。
- 操作:滚轮缩放、旋转/翻转、透明度、双击隐藏、右键菜单(复制/另存/关闭/穿透开关)、边缘吸附。
- 分组与批量多选、自动备份恢复(对齐 ClipForge 现有 SQLite 持久化规划,不用 localStorage)——**排到 Phase 3.5 视情况拆分**。

### Phase 4 — 输出与自动化
- 快捷保存目录 + 文件命名变量引擎(日期/时间/窗口标题等,平移 Snipaste 变量表)。
- 命令行协议:`clipforge snip [--full|--last|--area …] -o clipboard|pin|file`;`clipforge paste`。**不做** `-o exec(外部命令)`(安全面考虑,列为不实现决策)。
- 触发角(hot corner)、托盘增强菜单:接入现有托盘。

## 明确不做(Snipaste 有意放弃项)
- `paste --html/--files` 多来源贴图、网页图片拖入自动下载、APNG(GIF 除外)、打印输出、二维码扫描、白板模式、Windows/触发角以外的平台专属项、`-o exec`。
- PRO 概念:全选贴图、反色/灰度等全部免费照做。

## 风险
- ScreenCaptureKit 需屏幕录制权限(新 Info.plist key + 权限引导 UI,对齐现有 AX 权限模式);
- 贴图窗口池内存:上限 + 缩略图降采样(Snipaste 用 sp_maxHiddenPasters,我们用固定上限如 50);
- 与稳定版共存的快捷键冲突:沙箱探针已有 warning 降级模式,沿用;
- 工作量:Phase 1 ≈ 2-3 个工作日,Phase 2 ≈ 3-4,Phase 3 ≈ 4-5,Phase 4 ≈ 2(粗估,含测试)。

## 判据(每阶段)
- P1:截屏→选区→复制/入历史端到端 <1.5s;放大镜取色写历史成功;快捷键冲突可降级。
- P2:6 种标注工具可用且撤销/重做正确;标注后复制结果正确。
- P3:贴图窗缩放/旋转/穿透/隐藏全部可用;10 贴图同屏无卡顿(perf 探针扩展)。
- P4:命名变量引擎与命令行协议测试通过。
- 全程:`pnpm build` + `cargo check` 绿;新域单测覆盖纯函数层。

## Alternatives 考察过的方案
- 纯 TS 屏幕截图(getDisplayMedia):仅浏览器内可用,拿不到全局热键体验,否。
- 集成现成截图库(如 Tauri screenshot 插件):功能浅(无元素检测/帧缓存),后续替换成本高于自建,否。
