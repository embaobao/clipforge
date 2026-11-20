# 提案：移除焦点框预取空转（focus-prefetch-idle-removal）

> 所属波次：性能治理（横切，不阻塞功能提案）。
> 状态（2026-11-09 校准）：**方案 A 已在工作区落地、两轮多模型 review 完成、静态与编译门禁已跑通；改动尚未提交，checkbox 未勾选**；剩 `pnpm build` 重签授权与 GUI 实机走查需盟哥单独点头。原文「代码仍未改，等盟哥明确确认后实施」是 11-05 提案阶段口径，与 `tasks.md` 2.5「盟哥确认开始实施」、2.6–2.8 第二轮 review 与全量测试及 `lib.rs` 实际 diff（删 `FOCUS_PREFETCH_INTERVAL_MS` / `start_focus_prefetch_thread()` / `run()` 调用三处）不一致，此处按事实更正，不改动下方 Why/What 的原始方案论证。
> 触发：2026-11-05 盟哥要求「预热线程单独、详细确认影响范围、建立完整提案并增加其他模型 Agent 进行 review，之后再改」。
> review 阵容：推理模型（正确性/风险）、默认模型（openspec 与 AGENTS.md 合规）、轻量模型（验证命令可执行性），三份均为只读独立审查。

## Why

1. `src-tauri/src/lib.rs:3788` 的 `start_focus_prefetch_thread()` 在 `run()`（`:7815`）**无条件**启动，每 250ms（`:188`）调一次 `focused_input_bounds_platform()` → macOS 原生 AX 跨进程查询（`:3799-3959`），约 **4 次/秒常驻**；线程无退出标志、无 JoinHandle，`RunEvent::Exit` 也不停它。
2. `:3540` 只有查询**成功**才写缓存；失败（无焦点输入框 / 无权限 / 自身前台，占绝大多数时间）既不写缓存也不更新 `updated_at`，下一轮必然真查，**无退避**。
3. 更关键：这条缓存链是**重构残留**，结果没有消费者（`design.md` 第 2 节）：
   - `FOCUS_BOUNDS_CACHE`（`:239`）只在 `focused_input_bounds_platform()`（`:3517-3554`）读写；唯一读者 `#[tauri::command] focused_input_bounds()`（`:3411`）在 `src/` 的**整个 git 历史从未被调用**（`git log -S 'focused_input_bounds' -- src` 为空），web mock / MCP / scripts / examples 均无分发。
   - 面板定位 `open_panel()`（`:7972-8117`）走几何策略 `apply_position_strategy()`（`:9400-9453`），不经过该 command；`FocusInput` 分支（`:9447`）因 `get_strategy_for_source()`（`:9455`）从不返回该值而不可达。
   - 面板真正用到的焦点信息来自 `snapshot_paste_target_bounds()`（`:3557`，`:8060` 后台线程调），**直调** `native_focused_input_bounds()`（`:3571`），写另一个 `PASTE_TARGET_BOUNDS_CACHE`（`:241`）。
   - `compute_panel_position()`（`:8353`）带 `#[allow(dead_code)]` 且无调用方。git `44c44b7` 删掉「显示后用焦点位置覆盖定位」的异步线程，但预取线程与缓存没跟着删；`f4fb863` 删掉显示前的同步探测。
4. 结论：4 次/秒的 AX 查询是**纯浪费**，不是面板 180ms 热路径的保命设计。先前「加负缓存」的判断建立在「预热有用」的错误前提上，本提案纠正。
5. 文档失真：`CLAUDE.md:49`、`docs/ARCHITECTURE.md:180/195` 仍称预热缓存 / FocusInput 已启用；`lib.rs:8049-8051`、`:9444-9446` 注释与现状矛盾；归档 `wire-startup-clipboard-capture/design.md:70` 称该 command 是热路径（只登记不改归档）。

## What（范围）

### 三方案决策

| 方案 | 做法 | 收益 | 风险 | 结论 |
|---|---|---|---|---|
| **A 停用预取线程（推荐）** | 删 `start_focus_prefetch_thread()`、`run()` 调用行、250ms 常量；**保留** command / 缓存 / platform 函数 | AX 查询 4 次/秒 → **0**；少一条永生线程 | 极低：净删 3 处，不碰 IPC 契约、不动双 cfg、不动 `generate_handler!` | **采用** |
| B 加负缓存退避 | 给预热线程加失败退避 | 4 次/秒 → 约 0.5~1 次/秒 | 低，但给死代码打补丁，新增静态/函数/测试，永生线程仍在 | 否决 |
| C 连 command 一起删 | 删 command、两个 cfg 版 platform、缓存、常量、payload、注册项 | 代码最干净 | 中：跨双平台改 6+ 处，漏一处即编译失败；app-defined command 默认可达，仓库外硬编码 `invoke` 真实可达 | 否决（保守第一步） |

### 采用方案 A 的交付项

1. **停用线程**：删 `lib.rs:188`、`:3786-3796`、`:7815` 三处。删后 `generate_handler!`（`:7950`）→ `:3412` → `:3517` 链路仍完整可达，**不会新增 dead_code 警告**；`FOCUS_CACHE_MAX_AGE_MS`（`:189`）、`FOCUS_BOUNDS_CACHE`（`:239`）、`focus_bounds_cache()`（`:253`）仍被 `:3518/:3521/:3541` 使用。
2. **保留 command 作为兼容面**：`focused_input_bounds`、两个 cfg 版 platform、缓存、常量、`FocusedInputBoundsPayload` 全部保留。正确语义是「**不再有后台预热，command 自身仍保留 600ms 短缓存**」；补中文文档注释说明「仓库内无调用方、保留仅为外部/回滚契约」。
3. **更正文档与注释**：删 `CLAUDE.md:49` 越界架构句并指向 `docs/ARCHITECTURE.md`（AGENTS.md:31：CLAUDE.md 不维护第二套规则，不继续维护第二套架构事实）；`docs/ARCHITECTURE.md:180/195` 标注 FocusInput 当前不可达；`lib.rs:8049-8051`、`:9444-9446` 改失实注释（`:8101` 的注释本就正确，不动）。归档文档只登记矛盾。
4. **补可证伪验收**：静态源码断言 + `cargo check` 作为「线程不再启动」的强证据；AX 归零用静态闭合论证 + 可选一次性 debug 计数；性能探针只作**回归兜底**，不作为本改动的因果验收。
5. **只记录不处理**：`FocusInput` 设置项选了没效果、`focusedInputSource`/`usedFocusedInput` 恒 false、`compute_panel_position` 死代码 —— 另案，不作本提案验收/归档前置。

## Impact

- 改动：`src-tauri/src/lib.rs`（净删 3 处 + 注释）、`package.json`（`test:unit` 挂门禁）、`scripts/verify-focus-prefetch.mjs`（新增静态门禁）、`CLAUDE.md`（删句）、`docs/ARCHITECTURE.md`、`docs/BUSINESS_INDEX.md`（索引行）、本提案目录。
- `lib.rs` 在 500 行豁免清单内且**净删行**；中文文档注释满足 AGENTS.md 与 `pnpm locate` 数据源要求。本提案**新增了校验脚本** `scripts/verify-focus-prefetch.mjs`，按 AGENTS.md:101 必须同步 `docs/BUSINESS_INDEX.md` 索引行（初稿误判为「不触发」，第二轮 review 纠正并已补）；`locate --check-index` 会校验反引号路径真实存在。
- 跨平台：线程体本就 `#[cfg(target_os = "macos")]` 包裹，非 macOS 是 no-op；两平台均为纯减法。两个 cfg 版 platform 必须一起留，否则 macOS 编译断裂。
- **不碰**：剪贴板采集与 120ms watcher、复制写回与抑制、面板定位 / NSPanel 生命周期、全局快捷键、`snapshot_paste_target_bounds`、`PASTE_TARGET_BOUNDS_CACHE`、accessibility 权限链、`positionStrategy` 设置项、前后端 IPC 契约。
- 与 `debug-mode-performance-observability` 的交汇：上一轮工作区改动涉及 `src-tauri/src/diagnostics.rs` 与「监听线程健康」指标，本提案删的是另一条线程；**实施前先隔离工作区**，避免混提。`git status` 实测有 20+ 项未提交改动（含盟哥原有的 App.tsx / i18n / openspec 文档 / 6 个 `.work/supervisor` 删除），不只是上一轮的 4 个；处理方式用隔离分支或 stash，**不在任务清单里写破坏性回滚动作**。

## 不做

- 不做负缓存 / 退避（B）、不删 command（C）、不修 FocusInput 产品问题、不清理恒 false 字段与死函数。
- 不改面板定位策略、不引新运行时、不加常驻埋点、不做远程遥测、不改稳定版 `/Applications/ClipForge.app`。

## 风险与验收（已按 review 修正）

- 契约风险**低但非零**：app-defined command 默认可达（`capabilities` 无 ACL 项不构成反证），仓库外 JS / devtools 可能硬编码 `invoke('focused_input_bounds')`；保留 command 即规避。该路径无超时同步 AX 查询，未授权时可能阻塞数秒（无实测依据，不写「几十毫秒」）；不会反复弹权限窗（prompt 由 `:4005-4012` 触发且有一次保护）。
- 最大验收陷阱（review 发现）：`package.json:31` 的 `test:perf-panel` **默认测 `/Applications/ClipForge.app` 稳定版**（`perf-panel-probe.py:43`），而本提案不改稳定版 → 前后对照全绿但零证据；且脚本用 `max(values)` 判定、**不输出 p95**（`:319-327`）、默认仅 5 轮。必须用 `--sandbox --rounds 20`，口径写「最差轮次 ≤180ms」，并标注仅回归兜底。
- 验证命令：`openspec validate focus-prefetch-idle-removal --strict` → `cd src-tauri && cargo check` → `cargo test --lib` → `pnpm test:unit`（已含 `locate --check-index`）→ `pnpm build:web` → 加固后的静态源码断言 → `pnpm tauri dev` / `pnpm dev:sandbox`（AGENTS.md 涉原生能力要求）→ `pnpm test:perf-panel -- --sandbox --rounds 20`（需机器解锁）→ `cargo check --target x86_64-pc-windows-msvc`（本机已装，缺 MSVC 链接器时如实记录，不作阻断）。
- `pnpm build` 副作用（**执行前需盟哥点头**）：删 `release/*.dmg|zip|_internal-test`、完整 release 编译、`codesign --force --deep` 重签名、`hdiutil -ov` 覆盖 DMG、重写 `CLIPFORGE_MUST_READ.html`、跑 `sign-release-artifacts.mjs` / `generate-release-metadata.mjs`（会改 `release/checksums.txt` 与 `latest.json` 发布元数据）；不碰 `/Applications`。
- 量化目标：AX 查询 4 次/秒 → 0；冷启动不再 spawn 该线程；面板 show/hide 最差轮次 ≤180ms；粘贴目标链回归正常。
