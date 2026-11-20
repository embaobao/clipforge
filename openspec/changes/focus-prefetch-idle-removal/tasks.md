# Tasks: focus-prefetch-idle-removal

> 状态：**代码改动 + 两轮 review + 静态/编译/前端验证已完成；GUI 实机与 pnpm build 待单独点头**。
> 证据栏填实测输出；未跑的项目保持 `[ ]` 并写明原因，禁止写「应该没问题」。
> 隔离约定：工作区 `git status` 有 20+ 项未提交改动（盟哥原有 + 上一轮 4 个）。

## 1. 影响范围确认（已完成，只读）

- [x] 1.1 查清 `FOCUS_BOUNDS_CACHE` 完整读写链 -- 证据：`design.md` 第 1、2 节
- [x] 1.2 确认 `focused_input_bounds` command 仓库内无调用方 -- 证据：`src/` 全目录 0 命中、`git log -S ... -- src` 为空（`capabilities` 无 ACL 项不作证据）
- [x] 1.3 确认面板定位 / 粘贴 / 采集 / 写回 / 快捷键 / 权限链 / 诊断面板不依赖该缓存 -- 证据：`design.md` 第 3 节
- [x] 1.4 查清 git 重构断链点 -- 证据：`44c44b7` 删显示后覆盖、`f4fb863` 删显示前探测
- [x] 1.5 盘点现成测试 / 门禁覆盖 -- 证据：`design.md` 第 6 节；**0 覆盖**，必须新增静态断言
- [x] 1.6 首轮多模型独立复核 -- 证据：推理模型确认核心结论、修正「唯一写者」表述

## 2. Review 与修复（两轮，均已完成）

- [x] 2.1 首轮三模型 review（推理=正确性，默认=openspec/AGENTS.md 合规，轻量=验证可执行性）-- 证据：三份只读审查意见
- [x] 2.2 汇总首轮意见修订四件套 -- 证据：吸收 18 条（perf 误测稳定版、p95 不存在、缓存语义矛盾、单测恒真、sample 不可定量、CLAUDE.md 越界、工作区盘点错误等）
- [x] 2.3 提交大白话结论 + 完整结果预览图 -- 证据：对话交付
- [x] 2.4 确认前不改产品代码 -- 证据：阶段一仅写提案四文档
- [x] 2.5 盟哥确认「开始实施」 -- 证据：AskUserQuestion 选择「确认，开始实施」
- [x] 2.6 **第二轮 review（盟哥要求「review 修复方案并做相关测试」）**：三模型复审**实际 diff** + 执行全量测试 -- 证据：推理模型指出 `///` 注释误挂到现存 `native_focused_input_bounds()`、默认模型实测门禁可绕过并纠正索引义务误判、轻量模型跑完全部命令全绿
- [x] 2.7 按第二轮意见修复：① `lib.rs` 的 `///` 改 `//` 并明确指代 `FOCUS_BOUNDS_CACHE` / 独立 paste 缓存；② 加固 `scripts/verify-focus-prefetch.mjs`（`import.meta.url` 定位、递归扫全部 `.rs`、剥注释、词边界、fail-closed、空源码判失败）；③ 补 `docs/BUSINESS_INDEX.md` 索引行；④ 修订 proposal/design/spec/tasks 的失实表述 -- 证据：本轮各文件 diff
- [x] 2.8 第二轮全量测试 -- 证据：第 5 节 5.12

## 3. 实施（已完成）

- [ ] 3.1 隔离 -- **未做，如实记录**：未切分支 / stash（会动盟哥 20+ 未提交改动，风险更高），实际 `git branch --show-current` 仍为 `main`，采用文件级精确编辑。后果见 `design.md` 第 8 节第 8 条：`lib.rs` / `package.json` 的 diff 混入上一轮工作线改动，提交前须按 hunk 隔离。此项不标完成。
- [x] 3.2 删 `FOCUS_PREFETCH_INTERVAL_MS` 常量 -- 证据：加固门禁断言不存在
- [x] 3.3 删 `start_focus_prefetch_thread()` 函数体，留 `//` 中文说明注释（第二轮修正 rustdoc 误挂） -- 证据：`cargo check` 无 warning
- [x] 3.4 删 `run()` 调用行 -- 证据：门禁 + `cargo check` 通过
- [x] 3.5 为保留的 command / macOS platform 补中文文档注释 -- 证据：第二轮推理模型逐条核对注释与 `:3520-3560` 行为一致
- [x] 3.6 核对「必须保留」清单 -- 证据：门禁 10 项 KEPT 全部命中；第二轮复核 `PASTE_TARGET_BOUNDS_CACHE`、`restore_paste_target_focus`、`generate_handler!`、`FocusedInputBoundsPayload`、双 cfg platform 均在
- [x] 3.7 新增并加固 `scripts/verify-focus-prefetch.mjs`，挂入 `pnpm test:unit` -- 证据：`✓ 焦点框预取已停用（扫描 46 个 .rs，2 项禁用符号不存在），10 项主链路/兼容面符号完整`
- [x] 3.8 临时 debug 计数打点 -- **决策：不启用**（非「已完成」）：静态闭合已是强证据，避免引入埋点；与 spec「不加常驻埋点」一致

## 4. 文档与索引同步（已完成）

- [x] 4.1 更正 `lib.rs` 粘贴目标快照的 osascript 注释为「NSWorkspace + 原生 AX」；`:8101` 正确注释未动 -- 证据：第二轮核对 `frontmost_app_identity:3720` 与 `native_focused_input_bounds:3809-3956`
- [x] 4.2 更正 `FocusInput` 分支注释（标注不可达、显示后不再异步覆盖） -- 证据：与 `get_strategy_for_source:9453-9459` 一致
- [x] 4.3 删 `CLAUDE.md:49` 越界架构句，指向 `docs/ARCHITECTURE.md` -- 证据：CLAUDE.md diff
- [x] 4.4 `docs/ARCHITECTURE.md:180/195` 标注 FocusInput 当前不可达并补现状说明段 -- 证据：ARCHITECTURE.md diff
- [x] 4.5 补 `docs/BUSINESS_INDEX.md` 索引行（**第二轮纠正**：新增校验脚本触发 AGENTS.md:101，初稿误判为不触发） -- 证据：「验证速查」表新增「焦点框预取 / 面板定位」行，`locate --check-index` 通过
- [x] 4.6 归档 / worktree 矛盾登记 -- 证据：`design.md` 第 7 节；归档内容未改
- [x] 4.7 收窄 `spec.md` 中 `CLAUDE.md` 条款：只承诺删 `:49` 越界句，既有失实（`:23/:31/:41-43/:47/:50`）另案登记 -- 证据：spec.md 第 4 条 Requirement

## 5. 验证

- [x] 5.1 `openspec validate focus-prefetch-idle-removal --strict` -- 证据：`is valid`，exit=0（两轮复验）
- [x] 5.2 `cargo check` -- 证据：`Finished dev profile ... in 0.86s`，**无任何 warning（含无 unused import）**，exit=0
- [x] 5.3 `cargo test --lib` -- 证据：`49 passed; 0 failed; 1 ignored`（ignored 为需本地 llama-server 的 OCR 用例），exit=0
- [x] 5.4 `pnpm test:unit` -- 证据：全链 exit=0；含加固门禁输出、`[check-index] 80 个路径全部存在`、file-size 3 项既有豁免还债提醒
- [x] 5.5 加固后静态门禁单独运行 -- 证据：`扫描 46 个 .rs`，exit=0
- [x] 5.5b `pnpm build:web` -- 证据：`✓ built in 21.65s`（3398 modules），exit=0；3 条 Tailwind ambiguous class + 1 条 chunk >500kB 均为既有警告
- [x] 5.7 AX 归零 -- 证据：**静态闭合**（非运行时计数）：`src/` 与 `src-tauri/src/` 中两个废弃符号 0 命中；`native_focused_input_bounds` 只剩 `:3797` 定义、`:3539` platform（由无调用方 command 间接进入）、`:3577` snapshot（仅面板唤起触发）三处，`run()` 调用行已删。按 spec 允许静态闭合，未用 `sample`
- [x] 5.12 **第二轮全量复测**（盟哥要求） -- 证据：轻量模型 Agent 依次执行 8 项，1-8 全部 exit=0 / 0 命中；`git diff --stat` = 4 文件 32+/24-（含上一轮混入的 hunk，见 3.1）
- [ ] 5.6 `pnpm tauri dev` / `pnpm dev:sandbox` 启动 -- **未跑**：需 GUI 会话与机器解锁，且会与常驻稳定版争用全局快捷键
- [ ] 5.8 `pnpm test:perf-panel -- --sandbox --rounds 20` -- **未跑**：需机器解锁 + dev 实例；仅回归兜底
- [ ] 5.9 `pnpm dev:sandbox` 实机粘贴回归 -- **未跑**：需人眼在外部输入框唤起面板并选条目粘贴
- [x] 5.10 `cargo check --target x86_64-pc-windows-msvc` -- **失败（环境限制，非代码缺陷）**：`aws-lc-sys` 报 `fatal error: 'windows.h' file not found`，缺 MSVC/Windows SDK，exit=101；如实记录不作阻断
- [ ] 5.11 `pnpm build` -- **未跑，执行前需盟哥点头**：会删并重建 `release/*.dmg`、`codesign` 重签、`hdiutil` 覆盖 DMG、重写 `CLIPFORGE_MUST_READ.html`、改 `release/checksums.txt` 与 `latest.json`

## 6. 收尾

- [x] 6.1 回填两轮验收证据 -- 证据：本文件第 3-5 节
- [x] 6.2 记录未验证项与残留风险 -- 证据：第 5 节 5.6 / 5.8 / 5.9 / 5.10 / 5.11 + `design.md` 第 8 节（含混提风险与 CLAUDE.md 既有失实）
- [ ] 6.3 仅记录、不作验收/归档前置：另案登记 `FocusInput` 设置项选了没效果、`usedFocusedInput` 恒 false、`compute_panel_position` 死代码、CLAUDE.md 既有失实
- [ ] 6.4 盟哥验收后按 openspec 流程归档
