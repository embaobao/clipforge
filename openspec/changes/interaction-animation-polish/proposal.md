# 提案：交互动画与丝滑度优化（interaction-animation-polish）

## 优先级

体验治理线（不抢占剪贴板核心功能）。Phase 1（motion token + 滚动闪烁修复）建议随下一次触碰 `index.css` / 列表行的任务一并落地；其余阶段按切片独立推进，不阻塞功能开发主线。

## 背景

全仓动效盘点与多 Agent 审查（提案 review / 操作链与 hover 审计 / 唤起性能审计，文件:行号证据见 tasks.md 各项）结论：**主面板已有基础动效语言（panel-in/out、row-in、tooltip、Radix 菜单动画），但存在一致性缺失、一处高频体验硬伤、hover 反馈全站不统一、操作链非必要延迟，以及唤起动画的真实性能瓶颈**。

### 现状问题（按严重度）

1. **虚拟列表滚动闪烁（高频硬伤）**：`ClipboardRow.tsx:87,93` + `VirtualList.tsx:169-178`——滚动时窗口回填的每一行都重放 0.18s `row-in` + 20ms 递增 delay，快速滚动全程持续闪烁。动效本意是「新数据出现」，实际表达成了「窗口回填」，违背 motion-meaning（动效必须表达因果，Apple HIG）。
2. **时长/缓动无 token**：时长散布 100/120/150/160/180/200/220ms，缓动混用 `ease` / `cubic-bezier(0.32,0.72,0,1)` / `cubic-bezier(0.4,0,1,1)` / `ease-out`（index.css:135-153,166,265-285；ClipboardRow.tsx:87；ClipboardRowActions.tsx:28；ui/switch.tsx:22 等）。同一面板内动画节奏不统一，是「不丝滑」的直接来源（motion-consistency）。
3. **部分高频交互 0ms 瞬时切换**：多选底栏（MultiSelectBottomBar.tsx:15-22）、搜索补全下拉（GlassSearchBar.tsx:170）、workspace 路由切换 list↔detail↔aggregate（App.tsx:1032-1077）、空态、runtime-error-toast——出现/消失全是硬切。右键/命令菜单**已有** Radix + tailwindcss-animate 出入场（ui/dropdown-menu.tsx:66-69），缺口是时长/缓动未 token 化、且出场动画期间未屏蔽点击（`data-[state=closed]` 无 `pointer-events-none`，Esc 关闭后 ~150ms 内原位点击可误触「已关闭」的菜单项）。
4. **hover/按压反馈全站不一致**（多 Agent 审计，16 类控件）：主面板行无 `hover:bg`（反馈全靠动作钮浮现）；行 `active:scale-[0.99]` 配 `transition-colors` → scale 瞬跳无过渡；行内动作钮却是 `transition-all`；workspace 详情页/设置页/onboarding/QuickPreviewCard 全部无 `active:` 按下反馈；历史行动作区 display 硬切换 vs trash 行 opacity 过渡，两套机制；补全项鼠标悬停无任何视觉反馈（高亮仅由键盘 activeIndex 驱动）；`focus-visible` 全站仅 1 处（DetailQuickEditor textarea）；补全项/过滤标签/多选底栏/⌘K 触发钮缺 `cursor-pointer`；28px（h-7）图标钮命中区低于 Apple ≥32px 建议；DetailOverflowMenu 菜单项未套统一 menuItem class。
5. **操作链非必要延迟**：点击过滤标签/补全等离散操作也走 120ms 搜索防抖（App.tsx:221 useDebouncedValue），连打才需要的等待被离散点击承担；删除链路先 `await invoke` 才更新 UI（App.tsx:926-934），pointer-down 后行不消失——与收藏的乐观更新（use-clip-writeback.ts:66-80）不一致，违反 Apple「反馈在按下瞬间」。
6. **入场/退出时长关系违反惯例**：panel-in 0.22s vs panel-out 0.16s（比例尚可），但 tooltip 120ms 进/无出场、补全下拉出场 0ms；退出应约为入场的 60–70%（exit-faster-than-enter）。
7. **reduced-motion 覆盖是枚举式**：`index.css:392-398` 仅显式关闭 4 个 keyframes 类，`animation` 无全局压缩，新增动画默认漏网（无障碍回归风险）。已核实 anim-freeze-guard 探针为轮询式（anim-freeze-guard.ts:34-46，setTimeout + getComputedStyle，不依赖动画事件），全局压缩与其无冲突。
8. **性能瓶颈定位**（多 Agent 性能审计修正）：
   - 静态多层 box-shadow（panel-shadow）无逐帧成本——真正压在唤起动画上的是：面板根节点 `.material` blur(28px) saturate(180%) 的 backdrop-filter 在 panel-in 动 transform 期间**每帧全面板重采样**（透明窗口 + CSS 材质，非 NSVisualEffectView，tauri.conf.json:13,24）[INFERENCE 3-6ms/帧]；
   - 唤起空窗：Rust show → Tauri IPC 事件（5-20ms）→ React setState 挂 panel-in（1-5ms），期间面板先画「静止终态」1-2 帧再跳回 from 帧，可见一次小跳变；原生 NSPanel 的 Core Animation 在 orderFront 同帧原子启动，零空窗；
   - 点击选中 → `renderItem` 引用变化 → 可见窗口全部行 reconcile（VirtualList.tsx:215-225，ClipboardRow 无 React.memo）≈ 3-8ms 主线程；
   - `transition-all`（ClipboardRowActions.tsx:28）监听全部属性，存在意外动画与合成开销；
   - animate-ui 死代码含 layout 动画（highlight.tsx:268-271 动 top/left/width/height；radix/sidebar.tsx:246-258 动 width/left；animate/tabs.tsx:329-332 动 filter blur），全套组件无业务调用；
   - `float-y` keyframes（index.css:157 区域）无使用方；
   - 设置页 `SettingsStickyStatusBar` 与主面板 `.material` 双层 backdrop-filter 叠加；
   - `index.css:161` 注释写 120ms、实际 0.18s，文档失实。

### 已有的正确决策（保持，不回退）

- panel-in/out 只动 transform 不动 opacity：规避 WKWebView 后台冻结卡 from 帧（anim-freeze-guard）——本提案所有新动画延续「只动 transform/opacity」守则。
- 虚拟列表容器 `translateY` + will-change 纯合成层。
- `prefers-reduced-transparency` 降级已存在。
- tooltip 500ms 意图延时抑制滚动误弹（交互层，非动画，不在本提案范围）。

## 目标

1. **建立全局 motion token**（index.css `:root`）：统一时长与缓动，已盘点清单一次性迁移，新动画禁止裸写时长。
2. **修复滚动闪烁**：`row-in` 只在「数据集变化」时播放（items 引用 epoch 判定），虚拟列表滚动回填的行不再重放动画；粘贴新条目/筛选/搜索切换仍保留 stagger 入场。
3. **补齐关键交互的出入场**：多选底栏、补全下拉、路由切换、空态、错误条——全部走统一 token，只动 transform/opacity；**菜单不新建动画**，改为 token 化既有 Radix 动画并补出场期 `pointer-events-none`（修复 Esc 后可误点已关闭菜单项的真实缺陷）。
4. **hover/按压反馈全站统一**（Apple：反馈在 pointer-down 即时、因果一致）：可点项补齐 `active:` 按下反馈（主面板语言推广到 workspace/settings/onboarding/QuickPreviewCard）；行 scale 按压获得 transition；补全项补鼠标悬停反馈；统一历史行/trash 行动作区显隐机制；补 `cursor-pointer` 与 `focus-visible`。
5. **reduced-motion 全局化**：`animation-duration + iteration-count + delay` 三件套全局压缩兜底，不再依赖枚举。
6. **性能治理（对齐原生唤起水准）**：删 animate-ui 死代码与 `float-y`；`transition-all` 改精确属性；评估双层 backdrop-filter 收敛；为 ClipboardRow 补 React.memo 消除点击全列表 reconcile；以既有 `panel.open` perf span 建立唤起掉帧基线，Phase 1 前后对比。
7. **探索项（P2，可裁剪）**：Rust 侧 NSPanel 原生淡入淡出（animator/alphaValue），绕开 webview 冻结与空窗，让唤起动效对齐原生 NSPanel app。

## 非目标

- 不引入 framer-motion / GSAP 等新运行时（AGENTS.md：不引入重型运行时）；全部用 CSS transition/keyframes + 既有 tailwindcss-animate。
- 不改 tooltip 500ms 意图延时、面板 blur 隐藏时序等交互逻辑（只改视觉过渡）。
- 不做营销页式复杂编排（parallax/stagger 编排/scroll pinning）；工具面板以克制为准（excessive-motion：每视图 1–2 个关键动效）。
- 不统一 `active:scale` 幅度（scale-90/scale-[0.99]/scale-[0.98] 已形成稳定手感，改动收益低回归面大），仅统一其 duration 与是否带 transition。
- 不动菜单渲染架构（已统一走 ui/dropdown-menu），只做动画 token 化与出场点击屏蔽。

## Motion Token 设计

`index.css` `:root` 新增（dark 不区分，动效与主题无关）：

```css
:root {
  /* 时长：入场 ≤220ms，退出为对应入场的 ~65% */
  --motion-instant: 100ms;  /* hover/按压色彩反馈（现 duration-100） */
  --motion-fast: 150ms;     /* 菜单/下拉/小控件出入场 */
  --motion-surface: 180ms;  /* 内容区切换（路由/空态/多选栏） */
  --motion-panel-in: 220ms; /* 面板唤起（维持现值） */
  --motion-panel-out: 140ms;/* 面板失焦（0.16s 收敛到 65% 比例） */
  /* 缓动：入场减速到达，退出加速离开 */
  --ease-enter: cubic-bezier(0.32, 0.72, 0, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
}
```

- Tailwind v3 通过 `tailwind.config` 映射 `transitionDuration`/`transitionTimingFunction` 语义档（`'motion-fast': 'var(--motion-fast)'` 等）——不用任意值 `duration-[var(--motion-fast)]`（className 冗长，且 tailwindcss-animate 的 `animate-in/out` 消费 `duration-*`/`ease-*` 工具类，config 映射可让 Radix 菜单同轨受益）。
- 迁移策略：**Phase 1 同一 PR 内一次性替换已盘点清单全部站点**（纯重命名、grep 可验证）；`src/components/ui/*`（shadcn 生成物）维持豁免。不采用「触碰顺手迁」——审查确认其验收不可执行、双轨节奏长期并存。
- 缓动惯例声明（写入 token 注释）：`--ease-exit` 是「出场加速」惯例选择，非 `--ease-enter` 的逆曲线（逆为 `cubic-bezier(1,1,0.28,0.68)`）；可逆过渡以「出场镜像入场路径」为准（panel-out 与 panel-in 同方向同振幅回程），防止出现第三种缓动。

## 阶段切片

| 阶段 | 内容 | 触碰面 | 验证 |
|------|------|--------|------|
| Phase 1 | motion token 落地 + 盘点清单一次性迁移；row-in items-epoch 判定修复滚动闪烁；ClipboardRow memo；注释失实修正（含 App.tsx 450ms 注释）；唤起 perf 基线 | index.css、tailwind.config、ClipboardRow、VirtualList、App.tsx | build + cargo check + 滚动/粘贴/筛选三场景手测 + perf span 对比 |
| Phase 2 | Radix 菜单 token 化 + 出场 pointer-events-none；多选栏/补全下拉出入场；hover/按压/cursor/focus-visible 全站统一 | ui/dropdown-menu、ClipContextMenu、TrashContextMenu、QuickCommandMenu、DetailOverflowMenu、MultiSelectBottomBar、GlassSearchBar、workspace/settings/onboarding 按钮 | build + 手测（Esc 后不可误点、菜单触发方向入场、reduced-motion 瞬时） |
| Phase 3 | 路由切换/空态/错误条过渡；reduced-motion 三件套全局化；动作区显隐机制统一 | App.tsx、workspace/*、index.css、ClipboardRowActions、TrashRow | build + verify 脚本 + reduced-motion 手测 |
| Phase 4 | animate-ui 死代码删除；float-y 删除；双层 blur 评估；NSPanel 原生动画探索（可选） | src/components/animate-ui、settings、lib.rs | build + cargo check + 回归 |

各阶段任务明细见 [tasks.md](tasks.md)。

## 用户价值

- 快速滚动历史列表不再闪烁，点击选中不再带动全列表重算——面板最高频的两条操作链直接变顺。
- 菜单、多选、搜索补全等高频交互从「硬切」变为有方向的轻过渡，按下有回应、悬停有反馈，操作因果清晰（Apple：反馈在按下瞬间）。
- 全站 hover/按压/焦点反馈一套语言：主面板、详情页、设置页手感一致，可预期。
- 全局统一节奏后，动画不再「有的快有的慢」；reduced-motion 用户获得完整、不漏网的降级。
- 唤起链路以 perf 数据对齐原生 NSPanel 水准：更接近「按快捷键面板即出现」的原生体感。

## 成功标准

- 时长/缓动 token 落地：已盘点清单站点一次迁完，动画上下文不再有裸写时长（grep `duration-\d`/`0\.\d+s` 清零，`ui/*` 豁免清单管理）。
- 快速滚动虚拟列表 3 屏以上无行入场重放；粘贴新条目、切搜索词、切筛选仍保留 stagger 入场（三场景人工验收）。
- Esc 关闭菜单后原位点击不再命中「已关闭」的菜单项。
- 主面板/workspace/settings/onboarding 可点项均有 active 按下反馈；补全项悬停有反馈；`focus-visible` 键盘可达。
- reduced-motion 全局压缩生效，新增 keyframes 无需手动加枚举。
- ClipboardRow memo 后点击选中不再触发全列表 reconcile（React Profiler 验证仅选中行重渲）。
- 唤起链路有 `panel.open` perf 基线数据，Phase 1 落地后掉帧无恶化。
- animate-ui 无业务引用的组件删除，`pnpm build` + `cargo check` + 全部 verify 脚本通过。

## 风险与约束

- **冻结守卫兼容**：已核实 anim-freeze-guard 探针为轮询式（setTimeout + getComputedStyle，不监听动画事件），reduced-motion 全局压缩与其无冲突；但压缩必须用三件套（duration + iteration-count:1 + delay:0），否则 `animate-pulse` 类无限动画会产生事件风暴、stagger delay 残留会导致逐行闪现。
- **唤起性能真实瓶颈**：panel-in 动画期间 `.material` backdrop-filter 逐帧全面板重采样 [INFERENCE 3-6ms/帧]；静态 box-shadow 无逐帧成本。若 perf 基线实测掉帧，根治路径是 Phase 4 原生 alpha（窗口级合成不经过 webview），不在 CSS 侧动 backdrop-filter。
- **WKWebView 合成差异**：新增动画全部先在 `pnpm tauri dev` 实机验证（Chromium 表现不代表 WKWebView）；只动 transform/opacity，禁止触发 layout 的属性。
- **NSPanel 原生动画**（Phase 4 探索项）是 macOS 专用路径，隔离在 Rust 层；落地前置三条：a) 前端 emit 首帧就绪事件后 Rust 才启动 alpha 动画（避免亮出空白窗）；b) 淡出期 `setIgnoresMouseEvents(true)`（避免点击命中「正在消失」的面板）；c) 原生 alpha 与 CSS transform 动画二选一不叠加。复杂度超预期则裁剪，不阻塞其他阶段。
- **菜单出场竞态**：真实落点是 Radix `data-[state=closed]:pointer-events-none`（现状 Esc 后 ~150ms 内可误点已关闭菜单项）；状态正确性不依赖 animation-end 事件。
- **补全下拉动画约束**：FloatingUI 定位容器的外联 transform 不可被动画覆盖——动画类挂内层包装节点，或退化为纯 fade。
- **多选底栏布局**：transform 动画不参与布局，32px 底栏挂载/移除会瞬时重排列表区——接受该幅度并注明，或底栏改 absolute overlay（Phase 2 实施时二选一）。
- **操作链延迟（关联发现，另行评估）**：删除无乐观反馈、离散点击吃 120ms 搜索防抖，属交互逻辑/功能行为变更，超出本动效提案范围；建议在剪贴板功能线单独评估，不在本提案内实施。
