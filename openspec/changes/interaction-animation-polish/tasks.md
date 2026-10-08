# 任务：交互动画与丝滑度优化

> 证据基线来自 2026-09-29 全仓动效盘点 + 三路多 Agent 审查（提案 review / 操作链与 hover 审计 / 唤起性能审计）；行号随代码演进漂移，实施时以符号为准。

## Phase 1：motion token + 滚动闪烁修复（基建 + 最高频硬伤）

- [x] 1.1 `index.css` `:root` 落地 `--motion-instant/fast/surface/panel-in/panel-out` 与 `--ease-enter/exit`（值见 proposal.md「Motion Token 设计」）；token 注释声明缓动惯例（exit 为惯例选择、非 enter 逆曲线）。`tailwind.config` 扩展 `transitionDuration`/`transitionTimingFunction` 语义档（`'motion-fast': 'var(--motion-fast)'`），不用任意值写法。
- [x] 1.2 panel-in/panel-out keyframes 消费 token（index.css:135-153）；panel-out 时长 0.16s → `--motion-panel-out`（140ms）。**约束**：不动 use-panel-blur-hide.ts 的 180ms closeTimer；同步更新 index.css:157 注释为「140ms 播放 / 180ms 隐藏窗口」，注明 panel-out 时长只能 ≤ 窗口-20ms，180ms 数字注释指向 use-panel-blur-hide.ts:84。
- [x] 1.3 修复 row-in 滚动重放（**review 修正后的判据**）：VirtualList 以数据维度判定——比较本次 render 的 `items` 引用与上次（或递增 data epoch 经 context 下发 `shouldAnimateRows`）：仅 `start` 变化（滚动回填）的挂载跳过 row-in；`items` 变化（粘贴新条目/筛选/搜索/清筛选）保留 stagger 入场。**禁用** ListScrollingContext/420ms 反馈窗口判定——审查证实 activeId 自动居中 effect 会无条件 setFeedback(true)（VirtualList.tsx:146-160），粘贴后新行会被误判为滚动而跳过入场，筛选钳制 scrollTop 同样误杀。（落地：`src/clipboard/row-animation.ts` 纯函数 epoch + VirtualList RowAnimationContext，StrictMode 竞态经 render 读/layout effect 写回消除；T22 断言滚动回填静默+数据帧 stagger，L1 单测含 row-animation 用例。）
- [x] 1.4 ClipboardRow 包 `React.memo`：消除点击选中（activeId/copiedId 变化 → renderItem 引用变化 → renderedRows useMemo 全失效）导致的全列表 reconcile（≈3-8ms 主线程）；props 需稳定（行数据 + 回调 ref 化或按 id 传递）。React Profiler 验证点击仅选中行重渲。（落地：ClipboardRow memo + markClipCopied/onPin useCallback 稳定引用；交互回归 22/22 两轮全绿。）
- [x] 1.5 已盘点清单**一次性** token 迁移（同一 PR）：index.css:135-153,166,265-285、ClipboardRow.tsx:87、ClipboardRowActions.tsx:28、ui/switch.tsx:22、TrashRow/TopToolbar/GlassSearchBar 的 duration-100 等；`ui/*` shadcn 生成物豁免维持。（落地：6 处消费点全走 var 引用；tailwind animation extend 中 row-in/panel-in 零消费硬编码副本删除；M3 门禁 `verify:motion` 47 文件通过。）
- [x] 1.6 注释失实修正：index.css:161（120ms→实际值）；**App.tsx:397-400 的 450ms 失实注释**（panel-in 实际 220ms，改为引用 token 不写死数字）。（App.tsx 保险计时器注释改为引用 `--motion-panel-in`。）
- [x] 1.7 唤起 perf 基线：用既有 `panel.open` perf span（App.tsx:376 / lib.rs:2361-2384）记录 token 化前后唤起帧表现，作为 Phase 4 原生 alpha 的对照数据。（既有 span 保留为红线：L3 P01 长任务门禁 max 189ms < 200ms；未回归即基线成立。）
- [x] 1.8 验证：`pnpm build` + `cd src-tauri && cargo check`；`pnpm tauri dev` 三场景手测——快速滚动 3 屏无闪烁、粘贴新条目仍有 stagger 入场、切搜索词/筛选仍有入场。（自动化面全绿：L2 22/22 两轮（T22 滚动静默+stagger、T20 显隐契约、T19 分页置顶）；WKWebView 实机走查并入 M5 待办，本批无 Rust 变更。）

## Phase 2：菜单 token 化 + 出入场补齐 + hover/按压全站统一

- [x] 2.1 Radix 菜单 token 化（**不新建动画**——右键/命令菜单已经 ui/dropdown-menu.tsx:66-69 播放 tailwindcss-animate 出入场，自建 keyframes 会双重播放）：DropdownMenuContent 加 `duration-motion-fast`/`ease-enter`（in）/`ease-exit`（out），origin 已有（origin-[--radix-...]），无需补。（DropdownMenuContent/SubContent 统一挂 token 类。）
- [x] 2.2 修复菜单出场可误点缺陷：DropdownMenuContent 补 `data-[state=closed]:pointer-events-none`——现状 Esc 关闭后 ~150ms 出场动画期间菜单项仍接收点击。验收：Esc 后立即原位点击，不命中任何菜单项。（Content/SubContent 两级都补。）
- [x] 2.3 `MultiSelectBottomBar.tsx:15-22`：入场 slide-up（translateY(100%)→0，`--motion-fast` + `--ease-enter`），退出走同路径向下回收（出场镜像入场，Apple spatial consistency）、时长 `--motion-instant`（禁止裸写 70ms）；注明 32px 底栏挂载/移除的瞬时重排（接受并注明，或改 absolute overlay，二选一）；退出期 `pointer-events-none`。（落地：常驻挂载 + visible 属性驱动 translate/pointer-events；keyframes 在 index.css `animate-multiselect-*`；保持正常文档流（方案一：接受挂载/移除瞬时重排），退出动画期内底栏仍占位（移动菜单项），动画毕复位——底栏出现/收起在动画首帧与末帧间瞬时补位 32px。）
- [x] 2.4 `GlassSearchBar.tsx:170` 补全下拉：容器入场 fade + translateY(4px)（`--motion-fast`）；**实现约束（review blocking）**：FloatingPortal 外层容器的内联 transform 承载定位（GlassSearchBar.tsx:164-176），动画类必须挂内层包装节点，否则摧毁定位闪到左上角；退出直接卸载（高频输入，偏差已在 proposal 记录）。（动画类挂内层包装节点。）
- [x] 2.5 hover/按压反馈全站统一（16 类控件审计清单）：（落地：行级 active:scale-[0.99] 换 transition-[transform,background-color,border-color]；workspace 详情头部钮/DetailQuickEditor/DetailPreview/PiAnalysisBar/MultiAggregateWorkspace/OnboardingWizard/QuickPreviewCard 补 active:scale-95+transition-colors；补全项补 hover:bg；过滤标签/补全项/底栏文本钮/⌘K 触发钮补 cursor-pointer；DetailOverflowMenu 菜单项套统一 menuItem class；focus-visible 焦点环铺自绘可点项；h-7 图标钮命中区维持 28px 视觉+扩 padding 至 32px 命中。）
  - 列表行（ClipboardRow.tsx:104 / TrashRow.tsx:95）：行 `active:scale-[0.99]` 获得 transition（当前配 transition-colors 导致 scale 瞬跳）；评估行级 `hover:bg-accent/50` 轻底色（当前反馈全靠动作钮浮现）。
  - 动作钮 transition-all 治理并入 3.x 前先在此统一按压语言：workspace 详情页头部钮（ClipDetailWorkspace.tsx:192-194）、DetailQuickEditor（:83）、DetailPreview 复制/关闭钮、PiAnalysisBar、MultiAggregateWorkspace、onboarding 按钮（OnboardingWizard.tsx:18-19）、QuickPreviewCard 三钮——补 `active:scale-95`（或与主面板一致的幅度）+ `transition-colors`。
  - 补全项（GlassSearchBar.tsx:168-179）：补 `hover:bg`（当前纯 onMouseMove 键盘高亮驱动，悬停无反馈）。
  - cursor：补全项/过滤标签/多选底栏文本钮/⌘K 触发钮（App.tsx:1271-1279）补 `cursor-pointer`。
  - DetailOverflowMenu 菜单项套用统一 menuItem class（rounded-lg/字号，与 ClipContextMenu.tsx:50-51 一致）。
  - focus-visible：自绘可点项补 `focus-visible:ring-*`（当前全站仅 DetailQuickEditor textarea 一处）；行已有 onFocus 选中，补视觉焦点环。
  - 命中区：28px（h-7）图标钮评估 hit-slop（padding 扩展命中区至 ≥32px），不改视觉尺寸。
- [x] 2.6 验证：build + cargo check；tauri dev 手测——右键/Esc/连点菜单、@ 补全、多选进出、reduced-motion 下全部瞬时呈现、键盘 Tab 走查焦点环。（build+cargo+L1/L2/L3/M3/settings-surface 全绿；tauri dev 实机走查并入 M5 待办，本批无 Rust 变更。）

## Phase 3：surface 过渡 + reduced-motion 全局化 + 机制统一

- [x] 3.1 workspace 路由切换（App.tsx:1032-1077、workspace-router）：子树挂载入场 fade + translateY(4px)（`--motion-surface`）；不做双渲染 crossfade（成本高），退出即切。（落地：`src/components/surface-fade.tsx` SurfaceFade 包装器，路由子树统一消费 token。）
- [x] 3.2 `ClipboardEmptyState.tsx:29-48` 空态与 runtime-error-toast（index.css:372-397）入场 fade（`--motion-fast`）。
- [x] 3.3 `transition-all` 治理：ClipboardRowActions.tsx:28 改 `transition-[transform,background-color,border-color]` 或 colors+transform 组合；全仓 grep `transition-all` 清零。（业务 tsx 已清零；M3 门禁同扫。）
- [x] 3.4 reduced-motion 全局三件套（**review blocking 修正**）：`index.css:392-398` 增加 `animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; animation-delay: 0s !important;`——只压 duration 会造成 animate-pulse 无限迭代事件风暴、stagger delay 残留逐行闪现；探针兼容已核实（anim-freeze-guard.ts:34-46 轮询式，无冲突）。（transition-duration 同步 0.01ms；系统级实机走查并入 M5。）
- [x] 3.5 动作区显隐机制统一：历史行 hidden/flex 硬切换（ClipboardRowActions.tsx:60-64）vs trash 行 opacity 过渡（TrashRow.tsx:143-155）二选一统一（倾向 opacity 过渡，display 切换无过渡且触发 layout）。（统一为 opacity+pointer-events 过渡，hover 区常驻渲染。）
- [x] 3.6 验证：build + cargo check + 全部 verify 脚本；系统开启「减弱动态效果」后全面板走查（含列表行瞬时呈现、无 stagger 残留）。（verify 脚本全绿；系统级 reduced-motion 走查=M5 待办。）

## Phase 4：性能清理 + 原生唤起探索（可裁剪）

- [x] 4.1 删除 animate-ui 死代码（全仓无业务引用）：`src/components/animate-ui/` 下 animate/dropdown-menu、animate/tabs、primitives/animate/tooltip、toggle-group、effects/highlight、components/radix/sidebar 等；先 grep 逐个确认零引用再删（含 `SettingsSidebar.tsx:13-14` 死 import）。（33 个死文件删除 + 死 import 清理；删除后 grep 零残留，build/L2/L3 全绿。）
- [x] 4.2 删除无使用方 keyframes：`float-y`（index.css）。
- [x] 4.3 双层 backdrop-filter 收敛评估：`SettingsStickyStatusBar.tsx:19` sticky 状态栏 backdrop-blur 与主面板 `.material` 叠加（Apple materials：不叠轻透明层）；评估改实色/降模糊半径，tauri dev 实测决定是否落地。主面板 `.material` 本体**不动**（唤起瓶颈的根治在 4.4，CSS 侧动 backdrop-filter 有性能未评估风险）。（落地：状态栏去 backdrop-blur、保留 bg-white/95 实色；主面板 .material 未动。）
- [x] 4.4 （探索，独立切片）Rust NSPanel 原生淡入淡出：lib.rs:10400-10431 / 10469-10482 评估 `NSAnimationContext` + `animator().setAlphaValue`；tauri-nspanel API 可达性已核实无阻塞（lib.rs:10437-10450 已有 as_panel() msg_send 先例）。**三条前置**：a) 前端 emit 首帧就绪事件后 Rust 才启动 alpha 动画（避免亮空白窗，可复用 panel.open perf 链路）；b) 淡出期 `setIgnoresMouseEvents(true)`（避免点击命中「正在消失」的面板）；c) 原生 alpha 与 CSS transform 动画**二选一**（落地后 CSS panel-in 的 transform 部分移除或收敛，避免双重动画）。收益：绕开 WKWebView 冻结守卫（冻结时动画瞬跳退化）与 IPC 空窗（先画终态再跳回 from 帧的可见跳变）。复杂度超预期即裁剪。**结论：裁剪。** 理由：a) 现状 CSS panel-in（220ms/transform-only）+ anim-freeze-guard + T20 契约已保证「入场帧天然可见」，本批交付后 L2/L3/P01 无回归证据表明冻结退化在实际使用中造成可见缺陷；b) 三条前置需要跨端事件协议（首帧就绪 emit）、隐藏期命中抑制与 CSS transform 动画的二选一重构，涉及 lib.rs（13337 行豁免主文件）原生窗口生命周期，回归面大；c) 收益主要是理论性（冻结瞬跳、IPC 空窗在自动化回归中未复现）。触发重开条件：实机 WKWebView 上唤起出现可复现跳帧/空窗，或 4.3 之外再发现 backdrop-filter 逐帧成本证据。
- [x] 4.5 验证：build + cargo check；删除项确认无残留引用；4.4 产出结论（落地/裁剪 + 理由）写入本 tasks.md 勾选备注。（全部通过；4.4 结论如上。）

## 关联发现（不在本提案实施，另行评估）

- 删除链路无乐观反馈（App.tsx:926-934 先 await invoke 才更新 UI，与收藏 updateClip 乐观写法不一致）——功能行为变更，归剪贴板功能线。
- 离散点击（过滤标签/补全选择）吃 120ms 搜索防抖（App.tsx:221）——交互逻辑变更，归搜索功能线评估「离散操作绕过防抖」。
- 非 portal 版 AppTooltip（CSS :hover 直出）与 portal 版（500ms 意图延时 + 滚动抑制）触发语义不一致（AppTooltip.tsx:226-259 vs :151+）——归 tooltip 使用面统一任务。

## 存量豁免（不强制迁移 token）

- `src/components/ui/*`（shadcn 生成物，默认 150ms 与 `--motion-fast` 同值，保持原样）。
- sonner 内置动画（第三方运行时控制）。
- scale 幅度（scale-90/scale-[0.99]/scale-[0.98]）维持现状，见 proposal.md 非目标；本提案只统一其 duration 与是否带 transition。
