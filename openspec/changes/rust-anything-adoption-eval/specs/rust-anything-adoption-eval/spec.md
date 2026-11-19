# Delta: rust-anything 引入评估（rust-anything-adoption-eval）

> 评估类提案（P2, dormant）。本 delta 固化「何时启用 rust-anything 做前端热路径移植」的判据与红线，不引入任何依赖或代码变更。

## ADDED Requirements

### Requirement: rust-anything 移植触发判据

是否用 rust-anything 对前端 TS 单元做 Rust/wasm 移植 SHALL 由信号表触发评估，而非默认启用；信号未出现时本提案 SHALL 保持 dormant，CLI 仅作为开发机可用工具，不产生任何代码或依赖变更。

#### Scenario: 信号未出现

- **WHEN** 搜索过滤热路径无 profiling 超预算证据、列表无打分排序需求、前端无万级批量数据操作
- **THEN** 不引入 wasm 依赖、不移植任何 TS 单元；TS 侧 haystack 缓存等低成本优化独立决策，与本工具解耦

#### Scenario: 信号出现后试点

- **WHEN** 任一信号出现并决定试点
- **THEN** 第一梯队先做纯 TS 优化（haystack 缓存），第二梯队按 profile→bridge --batch(wasm-bindgen)→record→diff→bench 流程只移植纯函数单元，pinyin-pro 与 UI 代码不移植

#### Scenario: 试点红线

- **WHEN** 试点产出 diff/bench/构建结果
- **THEN** diff 录制回放必须 0 mismatch（含 Unicode/emoji 陷阱语料），bench verdict ≥1.1x 才可 ship，panel.open perf span 不回退，前端包体增量 >500KB gzip 即裁剪
