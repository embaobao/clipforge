# 还债拆分：功能验证 / 功能设计 / Review / 测试交付方案

> 配套 [execution-plan.md](./execution-plan.md)（切片顺序）与 [tasks.md](./tasks.md)（收账）。盟哥 2026-11-25 拍板：**豁免文件上限从 500 放宽到 800**；普通文件仍是 500。本方案据此重算目标。

## 0. 目标与红线

- 目标：`src/settings.tsx`、`src/App.tsx`、`src-tauri/src/lib.rs` 三个豁免文件各 ≤800 行（门禁按 `split("\n").length` 计数，比 `wc -l` 多 1），并在达标后从豁免清单移除。
- 红线：56 个 `#[tauri::command]` 的名字/签名/返回值不变；41 条 MCP 工具与 dispatch 不变；设置字段、配置读写、事件名、托盘菜单 id、快捷键、面板显隐阈值（≤180 ms）、剪贴板采集/写回/删除/恢复行为不变。
- 不做：不借拆分改行为、不把业务数据塞进全局 store、不新增关键依赖、不触碰 `src-tauri/src/ocr/*`（其他提案正在改）、不扩豁免清单（`file-size-exemptions.json` 只减不增）。

## 1. 完整功能验证方案

### 1.1 基线（2026-11-25 11:20 实测，HEAD `18933e3`）

| 观测项 | 基线 | 取证方式 |
|---|---:|---|
| `cargo test --lib` | 84 passed / 0 failed | 已跑，输出留在 `.work/debt-split/baseline/` |
| `pnpm test:unit` | 18 步全绿，含 MCP dispatch 41 工具、索引 99 路径、agent-map 与新文件门禁 | 已跑，输出留在 `.work/debt-split/baseline/` |
| `src-tauri/src/lib.rs` command 数 | 56 | `rg -c '#\[tauri::command\]'` |
| 面板性能 | 未跑：用户正在操作（HIDIdleTime 0 s），注入热键会抢焦点 | 解锁且空闲 ≥45 s 后复跑 |

### 1.2 冻结基线与不变量断言

- `.work/debt-split/baseline/commands.txt` 保存 56 个命令名；每片之后 `diff` 必须为空。提交前用 `verify-mcp-dispatch.mjs` 断言 41 条工具全有 dispatch arm。
- `scripts/verify-settings-surface.mjs` / `verify-surface-boundaries.mjs` / `verify-runtime-boundaries.mjs` / `verify-keyword-suggestions.mjs` 的现有断言是行为基线；拆分只允许新增断言，不允许为迁就源码移动而删弱断言。
- 行为等价性靠"纯函数测试 + 结构门禁 + 命令清单"三层；无法自动化的 UI 交互走人工/探针验证，并如实记「未验证」。

### 1.3 验证矩阵（每片必填）

| 域 | 自动验证 | 需人工/探针 | 不通过即回退 |
|---|---|---|---|
| settings.tsx 动作 | `pnpm build:web`、`verify-settings-surface.mjs`、设置保存/清理/诊断的纯函数用例 | 设置页四组操作：保存反馈、两步清理、诊断导出、重开向导 | 保存路径或反馈状态变化 |
| lib.rs 窗口/面板 | `cargo check`、`cargo test --lib`、命令名 diff、焦点框预取门禁 | 解锁空闲后 `pnpm test:perf-panel`（show/hide ≤180 ms、动画可打断、无鬼影） | 热键/固定/淡出代际行为变化 |
| lib.rs 日志/托盘 | 命令名 diff、日志边界用例、`pnpm test:unit` | 托盘菜单 id 与导出路径 | 日志格式或菜单 id 变化 |
| App.tsx 写回 | `verify-runtime-boundaries.mjs`（补 `updateClip` / `updateClipContent` 锚点）、写回纯逻辑用例 | 复制→粘贴→撤销、搜索重排不覆盖剪贴板 | 写回深链重写、回写抑制失效 |
| App.tsx 搜索/UI | `verify-keyword-suggestions.mjs`（SSR 加载真实模块，已覆盖 @/#/关键词/拼音） | 面板输入「会」「平台」、↑/↓/Enter、不误粘贴 | 建议组装或输入焦点退化 |
| 门禁本身 | `verify-file-size-gate.mjs` 一次性工作区：普通 501 行 fail、豁免 801 行只 warn、普通 500/豁免 600 通过 | — | 阈值行为不符 |

### 1.4 人工走查准入

面板会抢键盘焦点。走查前读 `ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print $NF/1e9}'`，<45 s 不跑；走查脚本用 CGEvent HID 注入 + AX 焦点守卫，不向输入框真按 Enter（面板内 Enter 会粘贴到前一个应用）。实测抢焦点后约 0.3–1.2 s 会被前台应用抢回并自动收起，因此走查需在用户离开键盘时进行；不满足就记「未验证」，不伪造通过。

## 2. 合理的功能设计（拆分后的模块边界）

### 2.1 阈值与门禁（先行改动）

- `scripts/verify-file-size.mjs`：普通文件仍 `limit=500` 硬失败；豁免文件 `target=800`，超过 800 只 warn（保留还债提醒），不硬失败（当前三文件均 >800，硬失败会让门禁长期红）。新增 `verify-file-size-gate.mjs` 用一次性工作区固定此语义。
- `scripts/file-size-exemptions.json`：三条 `target` 从 500 改 800，`_doc` 同步说明；达标后从 `exempt` 删除。
- 目的：把还债目标从 500 放宽到 800，仍靠 warn 提醒未达标文件，门禁保持可运行。

### 2.2 settings.tsx → `src/settings/`

- 目标：`src/settings/settings-actions.ts` 导出 `useSettingsActions(deps)`，封装 `updateSettings`、`refreshLogStats`、`refreshDataStats`、`cleanupDataNow`、`revealDataFolder`、`cleanupLogsNow`、`exportDiagnosticsBundle`、`addTagRule`、`updateTagRule`、`deleteTagRule`、`refreshAccessibilityStatus`、`openAccessibilitySettings`、`resetAccessibilityPermission`、`setLaunchAtLoginEnabled`、`refreshPanelStatus`、`testFloatingPanel`、`copyToClipboard`、`runUpdateAction`、`copyMcpAgentCodeTab`。
- seam：依赖通过参数注入（`invoke`、`tr`、`state.settings`、状态 setter、`formatSettingsError`），模块内不自行创建全局状态、不直接 import Tauri runtime；这样 `run-unit-checks.mjs` 可以直接编译并测纯逻辑（配置文本构造、状态转移），Tauri 调用留给现有 surface 门禁。
- `src/settings.tsx` 只保留 section 路由、JSX 组装与少量局部 UI 状态；section JSX 不移动，避免视觉/交互回归。
- ≤800 行只需移出约 30 行，但按整组动作函数平移（约 360 行），留足余量。

### 2.3 lib.rs → 域模块

- `src-tauri/src/window/mod.rs`：13 个面板/窗口 command 壳 + `open_panel` / `hide_panel` / `show_quick_panel` / `toggle_quick_panel` / `hide_panel_with_native_fade` + `PANEL_FADE_ACTIVE` / `PANEL_FADE_GENERATION` 幂等与代际守卫，逐字平移；纯位置计算抽 `#[cfg(test)]` 可测函数。
- `src-tauri/src/log_service.rs`：`log_to_file` / `query_app_logs` / `cleanup_app_logs` / `get_log_stats` / `export_diagnostics_bundle`；托盘菜单 id 与重建逻辑进 `src-tauri/src/tray.rs`。
- `lib.rs` 最终形态：setup、`generate_handler!`、模块声明与最小胶水；目标 ≤800（实际尽量 ≤700）。

### 2.4 App.tsx → hooks + components（不引入 store）

- 盟哥放宽到 800 后，S6（Zustand 状态 store）**取消**：约 30 个 state/ref 留在 App.tsx，通过 props 显式传给新组件/hooks。
- `src/clipboard/use-clip-writeback.ts` 已 499 行：先拆出第二个文件（例如 `writeback-commands.ts`）再接 `updateClip` / `updateClipContent` 深链；禁止把它加到豁免清单。
- 搜索 handler/建议状态进 `use-panel-search.ts`；TopCommandBar / ModeBar / ClipboardList / StatusBar / Overlay 按区块进 `src/clipboard/components/`，props 由现有 state/handler 直接传。
- 数据所有权：业务数据仍由 Tauri command 驱动，hooks 只管 UI 状态与调用；不新增运行时。

## 3. 代码拆分 review 方案

- 每片一个提交，提交前由独立 `reviewer` agent 复审（读代码 + 基线 + 断言），输出中文分级问题（blocker / should-fix / nit）并附 `path:line`；blocker/should-fix 修完再合，nit 记录不阻断。
- reviewer 固定检查表：① 命令名/签名 diff 为空；② 事件名、配置字段、托盘 id、快捷键、日志文本不变；③ 依赖方向无环、无 Tauri runtime 渗入纯模块；④ 新增中文文档注释、模块 ≤800（普通 ≤500）；⑤ 红/绿证据齐全；⑥ 回滚路径可用（`git revert <slice>`）；⑦ 没有顺手改行为或格式污染他人 hunks。
- 证据存放：红/绿输出写进 `openspec/changes/codebase-modularity-refactor/tasks.md` 对应项，附提交 SHA；大日志放 `.work/debt-split/<slice>/`（gitignore，可清理），不塞进提案正文。
- 门禁失败即 no-go：不提交、不继续下一片；先把断言/代码修到绿。发现基线本身错误时，先重取基线并说明原因，不改断言掩盖差异。

## 4. 测试交付方案

- 测试落点：Rust 纯逻辑/状态机 → 目标模块内 `#[cfg(test)]`，数据目录用 `hard_delete_image_cleanup_tests::TEST_DATA_DIR_LOCK` 串行隔离；前端纯函数 → `scripts/run-unit-checks.mjs`；依赖项目内模块/SSR → `scripts/verify-keyword-suggestions.mjs` 式 Vite SSR 探针；UI 约束 → 三个 `verify-*-surface/boundaries.mjs` 结构门禁。
- 每个切片交付：① 失败断言输出（红）；② 平移后的绿测输出；③ `cargo check` + `cargo test --lib` + `pnpm build:web` + `pnpm test:unit` + `openspec validate --all --strict` + `pnpm locate --check-index` 六门禁；④ `tasks.md` 勾项与 SHA；⑤ 人工走查结果或明确的「未验证 + 原因」。
- 新测试必须抓真实回归：只测行为/不变量，不测实现细节、不测源码文本（结构门禁例外：测模块边界与符号存在，需说明不可自动化的原因）。
- 最终验收：三文件均 ≤800 且从豁免清单移除；普通文件 500 / 豁免 800 的双阈值门禁生效；84 → ≥84 个 Rust 测试、16 步 → ≥16 步 unit 门禁全绿；命令清单 diff 为空；MCP 41 工具冻结；剩余人工走查项逐条标注已做或未做原因。

## 5. 执行顺序（评审通过后）

1. 门禁双阈值改造（先红后绿）→ 提交。
2. S1 settings.tsx 动作 → 验证 → review → 提交。
3. S2 lib.rs 窗口/面板 → 验证（含解锁后 perf probe 或记录未验证）→ review → 提交。
4. S3 lib.rs 日志/托盘 → S4 App.tsx 写回 → S5 App.tsx 搜索/UI → 每片同上。
5. 三文件达标后移除豁免；`pnpm test:unit` 全绿；更新 Backlog TASK-11 与 tasks.md，出最终测试交付报告。
