# 任务:snipaste-parity

> 对应 [proposal.md](./proposal.md) 四阶段与 [design.md](./design.md) 决策 D1-D7。每阶段独立可交付、独立验收;实施排期由用户逐阶段放行。前置:剪贴板主链路收口。

## Phase 1 — 截屏 + 取色(D1 L0 路径、D2 窗口级检测、D6 权限、D7 热键)

- [ ] P1.1 权限面:Info.plist `NSScreenCaptureUsageDescription`;`snip/permission.rs` 预检/请求 command(CGPreflight/CGRequest 两行 extern);设置窗权限引导 surface(对齐现有 AX 权限模式)
- [ ] P1.2 `snip/capture.rs`:screencapture CLI 封装(全屏/指定 display/区域,`-x` 静默),底图内存缓存;超时与 stderr 诊断
- [ ] P1.3 `snip/windows.rs`:CGWindowList 窗口矩形采集(core-graphics binding),过滤自身/桌面层,坐标系换算纯函数 + 单测
- [ ] P1.4 `snip/selection.rs`:选区浮层窗口生命周期(label `snip-screen-{i}`,NSPanel 通道复用,每屏一实例)
- [ ] P1.5 `snip.html` + `src/snip/`:蒙版、拖拽选区+手柄、方向键 1px 微调、窗口高亮/Tab 轮换、放大镜取色(canvas 读底图,RGB/HEX)
- [ ] P1.6 输出目标接线:复制(writeback guard 复用)、贴为贴图窗(留 P3 接口,先落 clipboard)、快捷保存(命名引擎 P4 前先用时间戳默认名)
- [ ] P1.7 取色/截图产物入剪贴板历史(payloadKind=`screenshot`/`color`,默认关、设置可开)
- [ ] P1.8 热键接入(D7):F1 截屏、F3 预留、repeat-last-region;settings_service 配置化;冲突 warning 降级
- [ ] P1.9 验收:perf 探针新增「热键→蒙版 ≤120ms」「→底图 ≤600ms」「确认→剪贴板 ≤150ms」;`pnpm build` + `cargo check` 绿;多屏/DPI 坐标换算单测过

## Phase 2 — 标注(前端域,可与 P3 并行)

- [ ] P2.1 标注图层架构:独立图层模型(base 不可变),工具注册表(每工具一文件,≤500 行)
- [ ] P2.2 工具实现:画笔/记号笔/矩形/椭圆/箭头/直线/文本/序号/马赛克/模糊(马赛克与模糊导出时原生分辨率扁平化,不可逆)
- [ ] P2.3 撤销/重做(有界历史)+ 滚轮调笔宽 + 颜色板(预设+自定义)
- [ ] P2.4 导出:扁平化渲染走离屏 canvas;对接 P1 输出目标
- [ ] P2.5 验收:几何/历史纯函数单测;手动 surface check(工具切换、效果边缘无接缝)

## Phase 3 — 贴图窗(D3 原生 NSPanel、D4 webview 转图)

- [ ] P3.1 `paster/panel.rs`:NSPanel 窗口池(tauri-nspanel 通道),非激活、置顶、LRU 上限 50、eviction 日志
- [ ] P3.2 来源管线:剪贴板图像 / 文本转图(D4 隐藏 webview 离屏渲染,消息回执制)/ 颜色转图(复用 detect.rs 色值语义)/ 图像文件路径
- [ ] P3.3 `paster/transform.rs`:滚轮缩放(指针为中心)、90° 旋转/镜像、透明度(10%-100%)、边缘吸附
- [ ] P3.4 `paster/menu.rs`:原生右键菜单(按来源动态:复制图像/纯文本/HTML/源路径、另存、穿透、关闭)
- [ ] P3.5 `paster/store.rs`:SQLite 表 + 退出快照/启动恢复 + 离屏拉回;隐藏/显示全部
- [ ] P3.6 鼠标穿透(set_ignore_cursor_events)+ 管理入口(隐藏/显示全部热键、托盘菜单项)
- [ ] P3.7 验收:10 贴图同屏探针;重启恢复过;「热键→NSPanel 可见 ≤200ms」探针
- [ ] P3.8 (独立放行)分组 + 批量多选 + 贴图管理 settings section

## Phase 4 — 输出与自动化

- [ ] P4.1 命名变量引擎(变量表+预览+非法字符清洗+冲突后缀,纯函数全单测)
- [ ] P4.2 快捷保存目录设置 + toast(reveal 动作)+ 不可写兜底
- [ ] P4.3 CLI:`clipforge snip [--full|--area|--last] -o clipboard|FILE`、`clipforge paste [--plain …]`;单实例 JSON stdout、退出码契约;app 未运行报错不拉起
- [ ] P4.4 触发角(四角独立+延迟+忽略名单)与托盘增强菜单
- [ ] P4.5 验收:CLI 端到端测试;热键冲突降级场景测试

## 明确不做(全程冻结,见 proposal)

`-o exec`、元素级 AX 检测(P4 后可选)、贴图内嵌标注、分组导入导出、网页图拖入下载、APNG、二维码、白板、打印。
