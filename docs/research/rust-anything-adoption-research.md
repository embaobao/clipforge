# rust-anything 借鉴评估调研（2026-11-19）

> 调研对象：<https://github.com/erkamyaman/rust-anything>（本地克隆 `~/workspace/open-source/rust-anything`，CLI v1.5.1）
> 结论去向：[openspec/changes/rust-anything-adoption-eval/proposal.md](../../openspec/changes/rust-anything-adoption-eval/proposal.md)
> 调研方式：仓库文档 / DECISIONS / skills 通读（scout，证据均为 file:line 引用）+ ClipForge 热路径源码比对。查重：无既往 rust-anything 借鉴记录。

## 结论先行

**rust-anything 不是 ClipForge 的直接优化手段，当前不建议为性能目的启动移植流程。** 它是「把 TS/Python/Go 等应用逐单元重写为 Rust」的验证工具链（`profile → analyze → bridge → record → build → diff → bench → shadow → gate`，docs/how-it-works.md:14-42）。ClipForge 后端已是 Rust，没有待迁主体；前端 TS 侧当前没有 profiling 证据表明存在热循环。

可落地借鉴 3 类工程纪律 × 3 个缺口（B/C 类可立即参照，A 类须信号触发）；明确不抄 6 条（见下）。

工具现状：`rust-anything` CLI 1.5.1 已安装（`~/.nvm/versions/node/v26.11.1/bin/rust-anything`，npmmirror 预编译二进制）。**未运行 `setup`**：它只注册 Claude Code / Codex / Cursor / Gemini / OpenCode 的用户级配置；omp 侧直接调 CLI 已够用，接入 omp MCP（`rust-anything mcp` stdio）属用户级配置变更，需单独批准。

## ClipForge 候选热路径事实（唯一评估对象）

- `src/App.tsx:566` `filteredClips` useMemo：每次按键对全量 `clips` 逐条 `matchesSearchTerm`。
- `src/clipboard/clip-search.ts:10` `getSearchHaystack`：每条每次重建大字符串（含 `JSON.stringify(applicationContext)`，无缓存）。
- `src/clipboard/clip-search.ts:41` `matchesSearchTerm`：精确包含 → 拼音（pinyin-pro，`precision:"any"`）→ `fuzzyIncludes`（子序列）。
- Rust 侧已有 `search_clip_records` invoke 双层过滤，前端过滤是对内存列表的第二层。
- 该路径未做过 profiling（panel-list-perf 收口的是列表渲染，不含搜索过滤）。

## 借鉴表

| # | 模式 | 来源证据 | 落法 | 缺口 |
|---|------|---------|------|------|
| 1 | record→diff→gate 行为录制先行 + 录制指纹失效检测（`recorded-from.json`，源变更后 gate 必败，`map --check` 进 CI） | docs/how-it-works.md:14-42,144,206 | agent-plugin-runtime golden 冻结纪律的外部成熟机制参照：黄金用例随源变更强制重录，防多 agent 并行改仓库时 golden 悄悄过期 | B |
| 2 | bench verdict 与正确性 gate 分离（正确 ≠ 该上；≥1.1x 才 ship，<0.9x 明确不 ship） | DECISIONS.md X5、S4；docs/faq.md「Is Rust always faster? No」 | panel-open-perf 等既有探针的 verdict 纪律：性能结论独立于功能 CI，低于阈值明确不上 | B |
| 3 | 语义陷阱语料库（non-ASCII / emoji / `-0` / `NaN` / 正则 traps） | docs/how-it-works.md:35 | 剪贴板内容天然混 emoji / 多语言 / `#` 开头文本（default_tags 已踩过 token 坑），可低成本喂给过滤/搜索/标签函数单测 | B |
| 4 | MCP server + SKILL.md 步骤化工作流 + doctor 自检 + 计划后暂停等用户批准 | skills/rust-anything/SKILL.md；DECISIONS.md S16；docs/how-it-works.md:42 | agent-plugin-runtime 插件工作流（发现/加载/失败隔离/自检）的成熟对照范本 | C |
| 5 | wasm-bindgen batch+index：数据一次跨越、留在 Rust、索引预建、只回传结果 | docs/how-it-works.md:43-72（batch 11.5x vs 逐条 0.2-0.4x）；DECISIONS.md A4「Portable code must keep running in browsers」；同一 `port.rs` 可同出 napi+wasm 两形态（DECISIONS.md S10） | 仅当信号表触发：前端批量打分/过滤热路径的唯一被证明高价值形态 | A |

## 不抄清单（scout 一致意见，权重最高）

1. **whole-app 流水线**（front-door / wire / lift / 整仓重写）：后端已是 Rust，无待迁主体。
2. **napi-rs 桥**：文档限定 Node-only（docs/how-it-works.md:119），WKWebView 加载不了 `.node`。
3. **细粒度逐函数移植当性能手段**：官方实测每 item 一次桥调用只有原始的 0.2-0.4x；对应 ClipForge 即「别把单个前端小函数经 invoke 搬去 Rust」。
4. **shadow 同进程双跑**：为进程内模块替换设计；ClipForge 前后端 invoke 边界天然是对比边界。
5. **桥开销微优化**（S1-S15：binary wire / mimalloc / rayon / UTF-16 缓冲）：进程内 FFI 微优化，invoke/wasm 场景用不上大半，且增前端包体。
6. **用 rust-anything 的 profile/analyze 替代 ClipForge 自有探针做面板性能诊断**：它面向跨语言移植规划，面板显隐/渲染诊断应继续用 panel-open-perf、CGWindowList 等自有手段。

## 与既有治理的接口

- **agent-plugin-runtime**（backlog TASK-3）：借鉴表 #1/#4 是其 golden 冻结与插件工作流的外部参照；rust-anything 是开发 CLI 不是 L3 业务工具，**不计入** agent-extension-seams 同源计数。
- **panel-list-perf**（已归档）：列表渲染已收口；搜索过滤热路径未 profiling，是 A 缺口的唯一评估对象。
- 若日后信号触发移植：`record` 录制的原始 TS 行为可直接作为回归测试资产；`traps` 语料可先行喂给现有过滤/标签函数单测（不需要移植就能落地，属低成本顺带项）。
