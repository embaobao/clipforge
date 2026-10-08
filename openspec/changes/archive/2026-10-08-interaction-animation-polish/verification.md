# 验收标准：整体视觉回归 + 功能回归（interaction-animation-polish 及后续交付通用）

> 依据 2026-09-29 基线实测建立。所有回归经 **ego-browser** 驱动真实渲染面（`preview.html` 悬浮窗内嵌真实主面板 iframe + `settings.html`），断言走 DOM 公共行为层 + 截图，不测内部实现。
> 基线：unit 全绿 · 交互 21/21 · 视觉 13/13 · 搜索响应 134ms · 长任务 max 60ms。

## Seam（验收面）定义

| Seam | 载体 | 断言方式 |
|------|------|----------|
| 主面板交互面 | `http://localhost:7100/preview.html`（iframe `#panel` = 真实 App） | DOM 几何/状态断言 + 截图 |
| 设置页 | `http://localhost:7100/settings.html` | 错误边界 + 分栏切换 + 截图 |
| 纯逻辑域函数 | `search-query / smart-format / plugin-actions / editor-*`（tsc 编译后 node assert） | 行为断言 |

虚拟列表「数据层」断言一律通过**公共行为表达**（如滚回顶部读首行），禁止读内部 state/ref（T19 教训：读 DOM 渲染窗口会伪判置顶失败）。

## 三层回归矩阵（交付前必须全绿）

### L1 纯逻辑单测
```bash
node scripts/run-unit-checks.mjs
```

### L2 功能回归（T1-T21）
```bash
pnpm dev --port 7100 &   # 已运行则跳过
bash scripts/run-interaction-tests.sh
```
覆盖：种子加载、三档宽度溢出、复制 toast 生命周期、搜索过滤/Esc、键盘导航、空格预览、粘贴反馈、回收站全链路、收藏视图、详情往返、tooltip（可见/等宽/高度/视口内）、28px 命中区、剪贴板事件入库、滚动抑制与自动出卡、浮卡滑入交互、**分页 >200 复制不截断且置顶（T19）**、显隐动画契约（T20：panel-in 无 opacity 帧、panel-out 存在、材质 alpha ≥ 0.85）、面板无透明带（T21）、设置页。

### L3 视觉走查 + 性能门禁（A01-A12 + P01）
```bash
bash scripts/run-visual-audit.sh     # 截图存 /tmp/clipforge-visual/audit/
```
覆盖：初始渲染、行 hover（动作钮不遮文本）、行 tooltip 几何、工具栏 hover/激活、搜索、预览卡、多选聚合、详情页、右键菜单、回收站、320 窄窗、设置两栏。
性能门禁：搜索响应 < 200ms；走查全程无 > 200ms 长任务。

## 动效专项断言（本提案新增）

| ID | 断言 | 验证方式 |
|----|------|----------|
| M1 | 快速滚动 3 屏：回填行不重放 `row-in`（无逐行闪现） | L2 新增 T22：滚动后新挂载行 `animationName` 不含 row-in 且无 stagger delay |
| M2 | 粘贴新条目 / 切搜索词 / 切筛选：新行仍保留 stagger 入场 | T22 反向断言（数据 epoch 变化时保留） |
| M3 | 动画时长/缓动走 token：动画上下文无裸写 `0.\d+s` / `duration-\d+`（豁免 `ui/*`） | grep 门禁（见下） |
| M4 | panel-in/out 只动 transform（WKWebView 冻结安全） | 已有 T20 覆盖，持续生效 |
| M5 | reduced-motion：系统开关开启后全部动画瞬时呈现、无 stagger 残留 | `pnpm tauri dev` 人工走查（Chromium 不代表 WKWebView） |

M3 的 grep 门禁（豁免清单管理存量，新增即 FAIL）：
```bash
grep -rnE 'duration-(1?[0-9]{2})\b|0\.[0-9]+s' src --include='*.tsx' --include='*.css' \
  | grep -v 'src/components/ui/' | grep -vE 'animation-delay|transition-delay'   # Phase 1 落地后应为 0 行（动画上下文）
```

## 执行时机

1. **开发前**：三层基线全绿（本文件顶部数据即基线，回归脚本改动需同步更新此处）。
2. **每个切片交付前**：L1+L2+L3 全绿；触碰 Tauri 原生层加跑 `pnpm tauri dev` + `cargo check`。
3. **Phase 1 收尾**：M1-M4 自动断言全绿 + M5 人工走查记录。
4. 偶发失败处理：ego 自动化有 hidden 抖动重试机制；同用例连续 2 次失败才算真红，定位根因后修实现或修断言层（禁止为绿改断言语义）。

## Phase 1 交付实测（2026-09-29）

| 检查项 | 结果 | 证据 |
|--------|------|------|
| L1 unit（含 row-animation epoch 纯函数） | ✅ | `[unit] search-query … row-animation checks passed` |
| M3 门禁 `pnpm verify:motion` | ✅ | `[motion-tokens] ok (checked 48 files)` |
| L2 交互回归（T1-T22，含新 T22） | ✅ 22/22 | 末次全绿跑；T22 `hasRowIn:false, hasDelay:false, firstScreenHasAnim:true` |
| L3 视觉走查 + 性能门禁 | ✅ 13/13 | 搜索 135ms、长任务 0 |
| `cargo check` | ✅ | `Finished dev profile in 3.19s` 零警告 |
| `pnpm build`（tsc+vite+打包） | ✅ | coder 切片交付（`ClipForge_0.1.0_aarch64.dmg` exit=0）+ 我清理 tailwind 死配置后未再触发重打包（仅删 animation extend 两条零消费条目，vite 构建输入为 index.css/keyframes，无 ts 消费点） |

### 断言层修正记录（非语义放松）

- **T15 waitForFunction 签名**：Playwright options 须为第三参（曾以 `(fn, {timeout})` 二参形式崩脚本）。
- **T15 到底判定时序缝隙**：原实现「轮询直达底部 → 退出后立即读 `article`」会撞上 VirtualList `onScroll→setState` 异步重渲的旧窗口，`deepRowVisible` 假阴（探针实证：直达后立即读为 false，等 300ms 后为 true，列表构成正确）。修复为「到底 + 底部行已渲染」在同一轮询内满足——这是虚拟窗口更新的本意断言，非放松。

### M3 门禁（替代 grep 手工命令）

`scripts/verify-motion-tokens.mjs`（`pnpm verify:motion`）：扫业务 tsx 禁裸 `duration-\d+`/`duration-[..ms]`，扫 index.css 动画上下文禁裸秒数（白名单：token 定义、冻结守卫 0.01ms、float-y 7s、库层 `src/components/ui/**`、`animate-ui/**`）。新增裸时长即 FAIL，豁免清单只减不增。

### Motion token 单一来源（Phase 1 落地）

`:root` 定义 `--motion-instant/fast/surface/panel-in/panel-out` + `--ease-enter/exit`；Tailwind `transitionDuration/transitionTimingFunction` 同源映射；index.css 6 处消费点全部改 var 引用（panel-out 0.16s→140ms、行内 tooltip/浮卡 120ms→fast 150ms 为提案内值变更）；业务 tsx 6 处 `duration-100`→`duration-instant`。tailwind `animation` extend 中 `row-in`/`panel-in` 两条零消费硬编码副本已删除（避免第二事实源）。

### M5（reduced-motion 人工走查）

**已走查（2026-09-30，实机 WKWebView）**：`pnpm tauri dev` 真实面板 + 系统设置「辅助功能 → 动态效果 → 减弱动态效果」开启（AXCheckBox 0→1 经 computer-use 驱动）后走查：

| 场景 | 结果 | 证据 |
|------|------|------|
| Ctrl+V 唤起面板 | ✅ 瞬时落定 | 快捷键后 ~100ms 截图：面板完整呈现（搜索聚焦 + 9 行全可见 + 状态栏），无空白帧/位移残影——220ms panel-in 已被 0.01ms 压制 |
| 列表 stagger | ✅ 无残留 | 同帧全部行最终态不透明度，无逐行闪现 |
| 搜索过滤「omp」 | ✅ 即时 | 输入后列表即时重排，行全部最终态渲染 |
| 浮卡（hover 意图） | ✅ 瞬时落定 | 指针停行上 ~1.5s 浮卡出现即最终态，无 slide 残影 |
| Esc 关闭 | ✅ | 面板即关（隐藏路径本就不依赖动画播完） |

走查后已还原：`defaults delete com.apple.universalaccess reduceMotion`（走查前该键不存在，已精确还原）、System Settings 退出、dev 实例关闭。备注：Chromium 回归面（L2/L3）不含系统 reduced-motion 语义，本走查为 WKWebView 实机补证；Space 浮卡未触发的现象与动效无关（焦点在搜索框，Space 进查询串，T6 链路在 L2 已绿）。

## Phase 2-4 交付实测（2026-09-30）

| 检查项 | 结果 | 证据 |
|--------|------|------|
| L1 unit（含 row-animation） | ✅ | `[unit] … row-animation checks passed` |
| M3 门禁 `pnpm verify:motion` | ✅ | `[motion-tokens] ok (checked 47 files)`（animate-ui 33 死文件删除后 48→47） |
| 文件尺寸门禁 | ✅ | `File size verification passed (limit=500, 豁免 3)` |
| settings surface 门禁 | ✅ | `Settings surface verification passed` |
| L2 交互回归 | ✅ 22/22 × 2 连续 | run 1/2 均 exit=0；T18/T19/T22 断言层修正后零抖动 |
| L3 视觉走查 + 性能门禁 | ✅ 13/13 | P01 `{"count":10,"max":189,…}` < 200ms 红线 |
| `pnpm build`（tsc+vite+打包） | ✅ | exit=0，产出 `ClipForge_0.1.0_aarch64.dmg` |
| `cargo check` | ✅ | `Finished dev profile in 2.57s`（src-tauri 本批零改动） |

### 验证中修复的真实缺陷（非动效范畴，回归暴露）

- **`use-panel-keyboard.ts` effect deps 缺失（上游既有 bug）**：deps 数组漏 `quickPreviewOpen`，Space 打开浮卡后 effect 不重订阅，闭包内 `quickPreviewOpen` 恒 false → Esc 无法关卡（探针复现：Esc 到达 window 且 `preventDefault` 已调，卡片仍在）。修复：`quickPreviewOpen` 入 deps（重订阅成本可忽略）。这是**真 bug 修复**——T6 在 2026-09-29 基线尚能通过属侥幸（环境抖动导致 effect 频繁重订阅掩盖了闭包过期；探针空转面下 9/10 复现）。
- **App.tsx `filteredClips` 引用不稳定（上游既有）**：每次 render 新数组 → keyboard effect deps（含 `filteredClips`）每帧重订阅 → 闭包常新掩盖上一条 bug；修复为 `useMemo`（与既有 memoization 模式一致）。文件头注「deps 原样保留住焦点/稳定 handler 语义」为上游遗留失实注释，已同步修正为如实描述。

### 断言层修正记录（非语义放松，均沿 T15 先例）

- **T19/T22 滚轮喂入与 scrollTop 异步落地时序缝隙**：固定 4 次滚轮在高负载/rAF 节流下只累积几 px，伪判「未置顶/卡内不能滚」。改为轮询喂入直至目标满足（上限 12 轮），断言本体（置顶不截断/卡内滚动且列表不动）不变。
- **T18 卡中途消失停喂**：卡片若在轮询中途消失，剩余滚轮会落到列表（listMoved 被污染成假红）。改为检测到卡片消失立即停喂并记录 `diedAtRound`/事件时间线（诊断用），契约断言不变。
- **T6 探针证据链**：独立复现页（panel 尺寸对齐套件 420×400、iframe 内 focus 复刻 FocusPanel 链路）9/10 复现 Esc 失灵；`keys` 记录证实 keydown 抵达 window、Escape 分支被陈旧闭包跳过 → 定位到 deps 缺失，修复后套件连跑两轮全绿。

### 本批交付的 Phase 2-4 内容摘要

- Phase 2：Radix 菜单 token 化 + `data-[state=closed]:pointer-events-none` 误点修复；多选底栏 slide-up/回收（常驻挂载 + visible 驱动）；补全下拉内层包装节点 fade+4px；16 类控件 hover/按压/cursor/focus-visible/命中区统一。
- Phase 3：workspace 路由 SurfaceFade（fade+4px/`--motion-surface`）；空态与 runtime-error-toast 入场 fade；业务 tsx `transition-all` 清零；reduced-motion 全局三件套（duration/iteration/delay + transition-duration）；动作区显隐统一 opacity+pointer-events。
- Phase 4：animate-ui 33 死文件 + SettingsSidebar 死 import 删除；`float-y` keyframes 删除；设置粘底状态栏去 backdrop-blur（双层材质收敛，主面板 `.material` 未动）；NSPanel 原生 alpha 探索**裁剪**（理由与重开条件见 tasks.md 4.4 备注）。

### M5 状态

已完成实机走查（见上方 M5 节，2026-09-30）：面板唤起/列表 stagger/搜索过滤/浮卡/Esc 全链路瞬时呈现，系统设置已精确还原。
