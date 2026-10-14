# Tasks:debug-mode-performance-observability

## 1. 调研（先行，产出结论再定实现深度）

- [x] 1.1 业界常驻剪贴板类应用诊断能力调研：Clipy / EcoPaste / Maccy / Paste / PasteNow / Alfred（clipboard 相关），各自是否有诊断面板、内存显示、日志导出；输出对比表（2026-10-09 初版结论：均有「导出诊断信息」类能力，形态以「设置内诊断区+一键导出」为主，无独立性能面板；本提案 v1 采用同一形态）
- [x] 1.2 macOS 平台能力取舍调研：MetricKit 回传通道 vs 自采样 vs Instruments 脚本化（结论：自采样 task_info(phys_footprint) 为零依赖实时方案，已 C 探针逐字段校准并加编译期断言+单测；MetricKit 需 App Store 通道不采用；Instruments 留作人工深挖）
- [x] 1.3 热路径埋点盘点：`panel-open-perf` 分步日志 + `scripts/perf-panel-probe.py` 已覆盖 show/hide 端到端；缺口（唤起内部分段 P50/P95 聚合）记录待办
- [ ] 1.4 汇总调研结论到本提案 design 段，删除未确认假设（v1 实施后补）

## 2. 设计

- [x] 2.1 调试模式 settings 字段设计（v1 决策：不新增 settings 字段——「打开 diagnostics tab」即调试模式，比持久开关更零成本；持久开关留给后续「常驻采样」需求再评估）
- [x] 2.2 采样数据模型：指标名/单位/粒度（UI 侧 1s 轮询、Rust 按需采集）；告警规则（内存连续 3 次单调增长、日志新鲜度 >5s）面板内高亮不弹窗
- [ ] 2.3 诊断包内容与导出格式（已有 export_diagnostics_bundle JSON 报告在用；zip 落桌面形态待与用户确认是否需要）
- [x] 2.4 UI 形态决策：设置页「存储与日志 → diagnostics」tab 内嵌指标面板（对齐业界「设置内诊断区」形态；独立窗口不做）

## 3. 实现

- [x] 3.1 `src-tauri/src/diagnostics/` 模块：按需采集（无后台线程，零开销）+ 指标 command（中文注释、206 行 ≤500 门禁）
- [x] 3.2 设置页调试 section：实时数值 + 告警高亮（tab 挂载才轮询，卸载即停）
- [x] 3.3 lib.rs 挂接：command 注册；不触碰剪贴板热路径
- [x] 3.4 调试指标不新增第二套日志格式（内存/数据/健康度与现有 jsonl 指标字段共存）

## 4. 验证与收尾

- [x] 4.1 门禁：`pnpm build` + `cargo check` + `cargo test --lib`（36 全过，含 FFI 不变量单测）+ `pnpm test:unit`
- [ ] 4.2 沙箱实测（需机器解锁后）：开关调试模式 → 采样数值合理（与活动监视器对照 RSS 误差 <20%）→ 导出诊断包可打开 → 关闭后零采样开销（采样线程退出/空转）
- [x] 4.3 更新 `docs/BUSINESS_INDEX.md`（新 surface/模块行）与 `docs/DESIGN_SYSTEM.md`（调试面板视觉规范，如有新形态） --2026-10-13 对账:调试指标面板挂设置 sections（CaptureStorageSections.tsx）,已被「设置 sections」索引行覆盖无新 surface;§7.2 本次随侧栏常驻化重写已对齐,调试面板无新视觉形态不补规范
- [ ] 4.4 盟哥人工验收后按 openspec 流程归档
