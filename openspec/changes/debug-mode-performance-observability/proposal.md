# 提案：调试模式与应用性能/内存可观测（debug-mode-performance-observability）

> 所属波次：W5 治理与演示（横切，不阻塞功能提案），见 [product-iteration-master-plan](../product-iteration-master-plan/proposal.md)。

## 状态

方案提案（2026-10-09 用户提出）：当前应用只有零散的 `panel-open-perf` 分步耗时日志与 `pnpm test:perf` 冒烟脚本，没有面向开发者/高级用户的「调试模式」：看不到内存占用、采集/写入吞吐、监听线程健康状态，应用「有没有问题」只能翻 jsonl。本提案把可观测性提为正式工作项。

## Why

- **排障靠猜**：用户反馈「面板自己消失」「快捷键失灵」「多选状态丢了」这类问题时，当前手段是翻 `~/Library/Application Support/ClipForge/clipforge.jsonl` 按时间窗人肉切片；没有实时面板，问题复现窗口（亚秒级）抓不住。
- **内存无感知**：应用常驻 + WKWebView + SQLite + 图片缓存，长时间运行的内存增长（泄漏 vs 缓存膨胀）没有任何量化视图；用户明确要求「分析应用内存占用」。
- **业界有成熟参照**：Clipy/EcoPaste/Maccy/Alfred 等常驻剪贴板类应用均提供诊断导出或活动监视；macOS 平台有 MetricKit（系统级 metric 回传）、Instruments/Allocations、`sysinfo`/`task_info`（RSS/vsz 实时采样）、WKWebView `performance.memory`（JS 堆）等现成能力，缺的只是产品化通道。
- **已有埋点基础**：`panel-open-perf` 分步日志、`perf-smoke.mjs`、`clipforge.jsonl` 结构化日志（tsMs/context/message）都在，缺聚合与展示，不是从零起。

## What（范围）

1. **调试模式开关**：设置页「存储与日志」或新「调试」section 一个开关（落 settings，Rust 权威）；开启后：
   - 日志级别提升（`debugLogsEnabled` 已有）+ verbose 诊断类日志全开；
   - 调试面板出现（见 3）。
2. **实时指标采样（Rust 后台线程，1s 粒度，可开关）**：
   - 进程内存：`task_info` 取 RSS/phys_footprint（macOS `TASK_VM_INFO`），或 `sysinfo` crate；WKWebView 为独立进程，需按 pid 聚合或注明范围；
   - SQLite 体积、图片缓存目录体积、jsonl 行数/体积；
   - 采集吞吐（条/min）、写入抑制命中、监听线程状态（最近一次轮询时间/间隔）；
   - 热路径耗时：复用 `panel-open-perf` 已有分步埋点，聚合 P50/P95 展示。
3. **调试面板 UI**（Tauri 窗口或设置页内嵌 section）：实时数值/曲线 + 「一键导出诊断包」（jsonl + settings + 环境快照 + 采样快照，zip 落桌面）。
4. **问题检测提示**：阈值告警（内存超阈值且持续增长、轮询间隔超时、写入失败率升高）在调试面板内高亮，不弹窗（不打断用户）。
5. **业界方案调研（先行任务）**：Clipy/EcoPaste/Maccy/Paste/PasteNow 的诊断/内存能力 + macOS MetricKit vs 自采样 vs Instruments 脚本化的取舍，产出调研结论再定实现深度。

## Impact

- 新增 `src/settings/sections/`（或调试面板 surface）+ `src-tauri/src/diagnostics/` 模块（采样/导出），lib.rs 只挂线程与 command（遵守 500 行门禁与豁免只减不增）。
- 采样默认关闭，不采集中不产生后台开销；`CLIPFORGE_DATA_DIR` 隔离对沙箱 dev 同样生效，调试不污染稳定版数据。
- 不改剪贴板热路径行为，只观测。
- 与 `codebase-modularity-refactor` 共享文件所有权时串行；与 `agent-extension-seams`（事件面）无重叠（本提案不引入 Agent 事件）。

## 不做

- 不做远程遥测/上报（本地优先，红线）。
- 不引重型 APM 依赖；MetricKit 回传属系统通道，仅调研不实现。
- 不做生产环境常驻采样（调试模式关闭时零开销）。
