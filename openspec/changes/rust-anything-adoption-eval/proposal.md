# 提案：rust-anything 引入评估（rust-anything-adoption-eval）

> 所属波次: 见 [product-iteration-master-plan](../product-iteration-master-plan/proposal.md)（W5 性能治理横切）。

## 状态

评估类提案（P2，独立切片，dormant）。工具已安装为开发 CLI（rust-anything 1.5.1，npmmirror 预编译二进制，未写入任何 agent 用户级配置）；不阻塞任何主线提案。调研依据见 [docs/research/rust-anything-adoption-research.md](../../../docs/research/rust-anything-adoption-research.md)。

## 背景：工具是什么、为什么评估

rust-anything 把 TS/Python/Go 等应用逐单元重写为 Rust：`profile` 找热函数 → `bridge` 生成 crate（TS 桥二选一：napi-rs 仅 Node、wasm-bindgen 面向浏览器）→ `record` 先录制原始行为 → `diff` 回放比对 → `bench` 计时裁决 → `gate` 全绿才算移植完成（docs/how-it-works.md:14-42）。它不自动翻译代码：Rust 由开发者/agent 写，工具供给「热在哪、行为黄金用例、验证门禁、性能裁决」。

ClipForge 适配事实：后端已是 Rust（无待迁主体）；前端 TS 跑在 WKWebView（浏览器语境，wasm-bindgen 是唯一可用桥，napi-rs 明确限定 Node，docs/how-it-works.md:119）。唯一候选热路径是搜索过滤：`src/App.tsx:566` 每次按键对全量 clips 逐条 `matchesSearchTerm`，`src/clipboard/clip-search.ts:10` 每条每次重建 haystack（含 `JSON.stringify`，无缓存）。当前无 profiling 证据表明该路径实际超预算（panel-list-perf 收口的是列表渲染，不含搜索过滤）。

## 复核：什么信号出现时值得重新评估

| 信号 | 触发的需求 | 现状缺口 |
|------|-----------|---------|
| profile 证实搜索过滤热（如 5000 条历史下每次按键过滤耗时超帧预算），且 TS 侧 haystack 缓存优化后仍超标 | 纯 TS 已到顶，需要更低常数 | 未 profiling；TS 缓存（第一梯队）尚未实施 |
| 列表从子序列命中升级为 fuzzy scoring + 排序 | batch+index 形态才有收益 | 现为 boolean include，无打分 |
| 万级批量数据操作进入前端（批量打标 / 分析 / 去重） | 数据一次跨越、留在 Rust | 现有操作均为单条 invoke |

当前三项信号均未出现。

## 试点方案（若信号出现）

- **第一梯队（不依赖本工具，先行）**：haystack 按 item 内容缓存、`JSON.stringify(applicationContext)` 出列。纯 TS 改动，成本远低于任何移植，大概率使问题消失。
- **第二梯队（本工具登场）**：`rust-anything profile` 取证 → `bridge --batch`（wasm-bindgen）→ `record`（含 Unicode/emoji 陷阱语料）→ `diff` 必须 0 mismatch → `bench` verdict ≥1.1x 才 ship（上游纪律：正确 ≠ 该上，DECISIONS.md X5）。唯一被证明的移植形态是 batch+index（wasm 11.5x，docs/how-it-works.md:72）；逐函数移植是官方实测的负收益（0.2-0.4x），禁止。
- **范围铁律**：只移植纯函数单元（normalizeSearch / fuzzyIncludes / haystack 匹配）；pinyin-pro 不移植（数据表庞大，保持 TS 侧）；UI/editor 代码留在 JS（上游 A4 决策）。
- **性能红线**（任一超标即裁剪）：diff 录制回放全一致（0 mismatch，含陷阱语料）；panel.open perf span 不回退；`pnpm build` 前端包体增量 >500KB gzip 即裁剪；搜索行为与 TS 逐条一致。

## 非目标

- 不做整 app 重写（后端已是 Rust）、不用 napi-rs（webview 非 Node）、不用 shadow 双跑（invoke 边界天然可对比）。
- 不用 rust-anything 的 profile/analyze 替代 ClipForge 自有探针做面板显隐 / 渲染诊断。
- 不在本提案中把 rust-anything 接入 omp 的 MCP 配置（`setup` 只注册 Claude Code / Codex / Cursor / Gemini / OpenCode 的用户级配置；omp 直接调 CLI 已够用，如需 MCP 挂载属用户级配置变更，需单独批准）。
- 不在评估触发前引入任何 wasm 依赖或修改搜索实现。

## 成功标准

- 本提案固化「何时用 rust-anything 做前端热路径移植」的可执行判据（信号表 + 两梯队 + 红线），后续开发不再重复争论。
- 未触发时保持 dormant：CLI 保持可用，不产生任何代码 / 依赖变更。
- B/C 类工程纪律借鉴（录制指纹防漂移、bench verdict 分离、traps 语料）由 [借鉴调研](../../../docs/research/rust-anything-adoption-research.md) 承接，按需在对应提案（agent-plugin-runtime 等）中落地，不在本提案内实施。
