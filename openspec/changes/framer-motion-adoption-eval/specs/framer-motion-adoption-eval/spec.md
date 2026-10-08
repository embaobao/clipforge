# Delta:动效库引入评估(framer-motion-adoption-eval)

> 评估类提案(P2,dormant)。本 delta 固化「何时重新评估引入 motion 库」的判据与红线,不引入任何依赖。

## ADDED Requirements

### Requirement: motion 库引入触发判据

是否引入 framer-motion SHALL 由下述信号表触发评估,而非默认引入;四项信号均未出现时本提案 SHALL 保持 dormant,不在任何业务 surface 引入 motion 依赖。

#### Scenario: 信号未出现

- **WHEN** 退出动画组件、共享元素过渡、手势驱动动画、复杂编排四项信号均未出现
- **THEN** 不引入 framer-motion 或任何 JS 驱动动画库,CSS motion token 方案为唯一动效实现

#### Scenario: 信号出现后试点

- **WHEN** 任一信号出现并决定试点
- **THEN** 只在一个 surface 做 PoC(建议 workspace 路由切换),性能红线(panel.open 不回退、长任务 < 200ms、T20 显隐动画契约不破)任一超标即裁剪;冻结兼容前置:WKWebView 后台冻结->唤起不跳帧/隐形,否则必须包与 cf-anim-frozen 等价的降级开关
