# 提案：framer-motion 引入评估（framer-motion-adoption-eval）

> 所属波次:见 [product-iteration-master-plan](../product-iteration-master-plan/proposal.md)。

## 状态

评估类提案（P2，独立切片）。**不阻塞** interaction-animation-polish 主线；主线的 CSS motion token 方案先行落地，本提案回答「什么时候 CSS 不够、motion 库值不值得上」。

## 背景：主提案为什么不引入

interaction-animation-polish 排除 framer-motion 的四个理由（本提案逐条复核）：

1. **AGENTS.md 约束**：「不引入重型运行时，除非有明确性能和维护收益」——motion react 约 34KB gzip + 每动画实例 JS 主线程驱动，CSS transition 由合成器线程驱动、零 JS 常驻成本。当前面板已有性能瓶颈（唤起动画期间 backdrop-filter 逐帧重采样），再加 JS 驱动动画是反向操作。
2. **动效形态匹配度低**：本产品动效全部是**触发式**（快捷键唤起、hover 意图、菜单开关、路由切换），没有**手势驱动**动画。framer-motion 的核心价值（spring velocity 重定向、拖拽 velocity handoff、布局共享元素）在非手势场景收益锐减；触发式过渡 CSS transition 天然可中断且从当前值续接（transition 中途反向触发会平滑回弹），无需库。
3. **WKWebView 冻结风险未验证**：后台 app 的 WKWebView 会冻结 CSS 动画时间轴（已有 anim-freeze-guard 探针 + cf-anim-frozen 兜底，T20 契约保证入场帧天然可见）。framer-motion 由 rAF/JS 驱动，冻结时行为不同（rAF 停调 → JS 动画完全停帧，恢复后是否跳帧/闪现未验证），现有守卫不覆盖 JS 动画。
4. **透明窗口 + 每帧成本**：面板是透明窗口，唤起动画期间每帧都在做全屏合成；JS 驱动动画的样式写入时机（rAF 对齐）在 WKWebView 上与合成器提交的竞态会放大空窗/跳帧风险。

## 复核：什么信号出现时值得重新评估

| 信号 | 触发的需求 | CSS 现状缺口 |
|------|-----------|--------------|
| 需要**退出动画**的组件变多（多选栏、补全下拉之后还有更多） | AnimatePresence 式「延迟卸载 + 退出编排」 | CSS 需要手写 unmount 延迟状态机（闭包 + timer），组件多后维护成本反超 |
| 列表↔详情需要**共享元素过渡**（缩略图飞入详情头图） | layout animation（FLIP） | 纯 CSS 无法做跨树 FLIP，手写 getBoundingClientRect 编排约 100-200 行且易碎 |
| 手势交互进入主链路（拖拽排序、滑动删除、拖拽多选） | 拖拽 velocity handoff + 边界回弹 | CSS 无法表达，手写 rAF 弹簧约 150 行/场景 |
| 复杂编排（多元素时序联动）超出 stagger 表达 | 编排声明式描述 | CSS delay 链脆弱，改时序要改多处 |

当前四项信号全部未出现（共享元素过渡在 Phase 3 明确不做双渲染 crossfade；无手势需求）。

## 试点方案（若信号出现）

- **范围铁律**：只在一个 surface PoC（建议 workspace 路由切换，编排复杂度最高的场景），不进主面板列表热路径。
- **性能红线**（任一超标即裁剪）：
  - `panel.open` perf span 不回退；
  - 交互走查全程长任务仍 < 200ms（scripts/run-visual-audit.sh P01）；
  - T20 显隐动画契约不破（唤起入场帧天然可见）。
- **冻结兼容前置**：tauri dev 实机验证「后台冻结 → 唤起」不出现跳帧/隐形；不满足则必须给 motion 动画包一层与 cf-anim-frozen 等价的降级开关，成本计入评估。
- **产物**：PoC 分支 + 上述三线数据 + 一页对比结论（引入/裁剪 + 理由），走 review 后决策。

## 非目标

- 不评估 GSAP（体积与授权模型更重，编排需求未出现）、react-spring（社区维护状态不如 motion）、auto-animate（能力子集，覆盖不了上表信号）。
- 不在评估完成前给任何业务 surface 引入 motion 依赖。

## 成功标准

- 本提案给出「何时引入」的可执行判据（上表信号 + 红线），后续开发不再重复争论。
- 若信号出现：按试点方案产出 PoC 结论；若未出现：本提案保持 dormant，无需实施。
