# Tasks:debug-mode-performance-observability

## 1. 调研（先行，产出结论再定实现深度）

- [ ] 1.1 业界常驻剪贴板类应用诊断能力调研：Clipy / EcoPaste / Maccy / Paste / PasteNow / Alfred（clipboard 相关），各自是否有诊断面板、内存显示、日志导出；输出对比表
- [ ] 1.2 macOS 平台能力取舍调研：MetricKit 回传通道 vs 自采样（`task_info`/`TASK_VM_INFO` 取 phys_footprint、`sysinfo` crate）vs Instruments 脚本化（`xctrace`/`instruments` CLI 可自动化录制）；含 WKWebView 独立进程的内存归集方式
- [ ] 1.3 热路径埋点盘点：`panel-open-perf` 分步日志现有 step 清单 + `scripts/perf-smoke.mjs` 覆盖范围，缺口列表（唤起/采集/写回/搜索各阶段）
- [ ] 1.4 汇总调研结论到本提案 design 段，删除未确认假设（对齐 openspec 评审要求）

## 2. 设计

- [ ] 2.1 调试模式 settings 字段设计（默认关闭、落 settings.json5、Rust 权威；与 `debugLogsEnabled` 的关系）
- [ ] 2.2 采样数据模型：指标名、单位、采样粒度（1s）、环形缓冲长度、内存阈值告警规则
- [ ] 2.3 诊断包内容与导出格式（jsonl + settings + 环境快照 + 采样快照 + 进程清单；zip 落桌面）
- [ ] 2.4 UI 形态决策：独立调试窗口 vs 设置页内嵌 section（依据 1.1 调研与 DESIGN_SYSTEM 约束）

## 3. 实现

- [ ] 3.1 `src-tauri/src/diagnostics/` 模块：采样线程（开关控制、零开销保证）+ 指标快照 command + 诊断包导出 command（中文注释、≤500 行）
- [ ] 3.2 设置页调试 section：开关 + 实时数值/曲线 + 告警高亮 + 导出按钮（Tailwind 语义 token，禁新建组件 CSS）
- [ ] 3.3 lib.rs 挂接：setup 起采样线程（按 settings 开关）、command 注册；不触碰剪贴板热路径
- [ ] 3.4 调试模式开启时 verbose 诊断日志全开（复用 should_write_app_log 过滤链，不新增第二套日志格式）

## 4. 验证与收尾

- [ ] 4.1 门禁：`pnpm build` + `cd src-tauri && cargo check` + `pnpm test:unit`（含 verify-file-size / locate --check-index）
- [ ] 4.2 沙箱实测（`pnpm dev:sandbox`）：开关调试模式 → 采样数值合理（与活动监视器对照 RSS 误差 <20%）→ 导出诊断包可打开 → 关闭后零采样开销（采样线程退出/空转）
- [ ] 4.3 更新 `docs/BUSINESS_INDEX.md`（新 surface/模块行）与 `docs/DESIGN_SYSTEM.md`（调试面板视觉规范，如有新形态）
- [ ] 4.4 盟哥人工验收后按 openspec 流程归档
