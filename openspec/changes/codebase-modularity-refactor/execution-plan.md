# 还债执行计划（2026-11-25）：内容拆分 + TDD

> 归属 [codebase-modularity-refactor](./proposal.md) / [tasks.md](./tasks.md)。完整验证/设计/review/交付方案见 [review-and-test-plan.md](./review-and-test-plan.md)。本文只定执行切片与测试先行顺序；盟哥 2026-11-25 放宽豁免上限到 800，达标即从 `scripts/file-size-exemptions.json` 移除（只减不增）。

## 1. 债账（2026-11-25 实测）

| 豁免文件 | 当前行数 | 未还部分 | 目标模块 | 到 800 行的前提 |
|---|---:|---|---|---|
| `src-tauri/src/lib.rs` | 9787 | 56 个 command 壳、面板显隐/定位/淡出、日志、托盘、setup、`generate_handler!` | `window/`、`log_service.rs`、各域 `commands.rs` | 全部 command 与面板逻辑移出，lib.rs 只剩 setup + handler 注册；需 4 批 |
| `src/App.tsx` | 1643 | 约 30 个 state/ref 字段的粘合层、写回深链、搜索接线、UI JSX 组装 | `src/clipboard/` hooks + `src/clipboard/components/` | 800 上限下 state/ref 留在 App.tsx，不 store 化；拆 hooks/组件即可达标 |
| `src/settings.tsx` | 830 | 数据/日志/清理/更新/无障碍/MCP 的动作函数 + section JSX | `src/settings/settings-actions.ts` | 整组动作函数按 seam 平移即可达标，留足余量 |

测试设施现状：`cargo test --lib` 84 项（域模块内 `#[cfg(test)]`，Rust 侧用 `hard_delete_image_cleanup_tests::TEST_DATA_DIR_LOCK` 串行隔离数据目录）；`pnpm test:unit` 18 步（含新增 `agent-map.mjs` 与 `verify-file-size-gate.mjs`，另有 Vite SSR 加载真实模块的 `verify-keyword-suggestions.mjs`，以及 `verify-runtime-boundaries.mjs` / `verify-settings-surface.mjs` / `verify-surface-boundaries.mjs` / `verify-mcp-dispatch.mjs` 等结构门禁）。TDD 直接复用这些设施，不引入测试框架。

## 2. TDD 规则（每片统一）

1. **先红**：在目标测试文件里写"新模块/新不变量"的断言；此时运行必须失败，并保存失败输出作为切片证据。禁止先移动代码再补测试。
2. **再绿**：只做平移（移动 + 改 `use`/`import` + 补齐中文文档注释），不改行为、命令名、配置字段、事件名。
3. **再验证**：`cargo check` + `cargo test --lib`（Rust）/ `pnpm build:web`（前端）+ `pnpm test:unit` + `openspec validate --all --strict`；`cargo fmt --check` 只核对本次 hunks（仓库有既有 diffs）。
4. **后收账**：勾 `tasks.md`，改 `BUSINESS_INDEX.md` 域行，从豁免清单移除已达标文件，提交；不达标就不移除豁免。

测试落在哪里由 seam 决定：

- 纯函数 → `scripts/run-unit-checks.mjs`（tsc 编译纯模块）或新增 `scripts/verify-<域>.mjs`（Vite SSR 加载带项目内依赖的模块，模式见 `verify-keyword-suggestions.mjs`）。
- Rust 纯逻辑/状态机 → 目标模块内 `#[cfg(test)]` + 隔离数据目录锁；模式见 `src-tauri/src/clipboard/revive_tests.rs`。
- Tauri command 壳 → 结构门禁先断言新模块导出与注册路径（`verify-mcp-dispatch.mjs` 的 41 条工具与命令名保持冻结），再平移；command 签名零变化。
- UI JSX → `verify-settings-surface.mjs` / `verify-surface-boundaries.mjs` / `verify-runtime-boundaries.mjs` 的 data-marker / 导出符号断言先红，再切组件。

## 3. 切片（按依赖排序，每片一个提交）

| # | 切片 | 先写的失败断言（红） | 拆分动作（绿） | 退出条件 |
|---|---|---|---|---|
| S1 | `settings.tsx` 动作函数 | `verify-settings-surface.mjs` 新增 `src/settings/settings-actions.ts` 导出符号断言；`run-unit-checks.mjs` 加纯函数用例（设置合并/配置文本构造） | 236–595 行的 data/log/cleanup/update/accessibility/MCP 动作迁入 `useSettingsActions`（依赖用参数传入，不在模块内创建），section JSX 保持原样 | `settings.tsx` ≤800；`pnpm build:web` + 全门禁 |
| S2 | `lib.rs` 窗口/面板域 | `verify-runtime-boundaries.mjs` 加 `src-tauri/src/window/mod.rs` 导出断言；Rust 侧给面板位置的纯计算补 `#[cfg(test)]`（抽出前先在 lib.rs 内联测试里固定当前行为） | 13 个面板/窗口 command 壳与 `open_panel`/`hide_panel`/`show_quick_panel`/`toggle_quick_panel`/`hide_panel_with_native_fade`/固定标志迁入 `window/`；淡出代际与幂等守卫逐字平移 | `lib.rs` 净减 ≥700 行；command 签名零变化；`pnpm test:perf-panel` 解锁后复跑（阈值 180 ms） |
| S3 | `lib.rs` 日志/诊断/托盘 | `verify-mcp-dispatch.mjs` 保持 41 工具冻结；`cargo test --lib` 先补日志清理参数读取的边界用例 | `log_to_file`/`log_path`/`query_app_logs`/`cleanup_app_logs`/`get_log_stats`/`export_diagnostics_bundle` 迁入 `log_service.rs`；托盘菜单 id 与重建逻辑迁入 `tray.rs` | `lib.rs` 再净减 ≥300 行；日志输出文本不变 |
| S4 | App.tsx 写回域接线与深链 | `verify-runtime-boundaries.mjs` 新增 `updateClip` / `updateClipContent` 终点锚（当前确实没有）；`verify-keyword-suggestions.mjs` 已覆盖搜索纯逻辑，不必重复 | `use-clip-writeback.ts` 已 499 行，**先拆第二个文件**再接 `useClipWriteback`；`copyClip/copyText/pasteClip/updateClipContent/openClipTarget` 按写路径分两批迁入，缓存失效复用同一入口 | 写回行为零变化；两个写回文件各 ≤500；`pnpm test:unit` 全绿 |
| S5 | App.tsx 搜索域与 UI JSX | `verify-surface-boundaries.mjs` 对 TopCommandBar/ModeBar/ClipboardList/StatusBar/Overlay 各加 data-marker 断言；`@`/`#`/关键词下拉沿用已通过的 `verify-keyword-suggestions.mjs` | 搜索 handler 与建议状态迁入 `use-panel-search.ts`；UI JSX 按区块切 `src/clipboard/components/`；props 由现有 state/handler 直接传，不建全局 store | 面板走查（解锁、用户不在输入）三项：输入「会」出候选、「平台」列表命中、↑/↓/Enter 不粘贴误触 |
| S6 | App.tsx 状态粘合层（取消） | 800 上限下不再需要 store 化 | 约 30 个 state/ref 保留在 App.tsx，通过 props 显式传给 hooks/组件；不引入 Zustand | 随 S4/S5 达标即收账；无独立提交 |
| S7 | `lib.rs` 其余 command + 收尾 | 每个域先加导出符号断言，迁移前后 `verify-mcp-dispatch.mjs` 输出逐字一致 | clipboard/accessibility/update/diagnostics/launch 各域 `commands.rs`；lib.rs 只剩 setup + `generate_handler!` | lib.rs ≤800；豁免清单 3 → 0；普通文件 500 硬失败、豁免 800 提醒 |

## 4. 顺序与并行约束

- S1 与 S2 可并行（文件不重叠）；S3 在 S2 之后（同文件顺序写避免冲突）；S4 → S5 严格串行（同文件、依赖前一刀的函数签名）；S7 最后（收口 lib.rs）。S6 已取消。
- 其他提案正在改同一文件时不打交叉提交：`src-tauri/src/ocr/*` 当前有未提交改动，S2/S3 只碰 `lib.rs` 的窗口/日志/托盘段，不碰 OCR 段。
- 面板走查必须等屏幕解锁且用户不在输入：面板唤起会抢键盘焦点，实测会在约 1 秒内被前台应用抢回并自动收起；强抢会吞掉用户输入。走查前查 `ioreg -c IOHIDSystem` 的 `HIDIdleTime`，低于 45 秒不跑。
- 每批只写自己改过行的门禁断言；脚本因源码移动而失效时改断言语义，不改行为去迁就脚本。

## 5. 决策点

1. **App.tsx 状态 store 化**：盟哥已把豁免上限放宽到 800，无需 store 化；S6 取消，state/ref 保留在 App.tsx，通过 props 传递。
2. **lib.rs 800 行目标**：S7 完成后 lib.rs 只剩 setup + handler 注册；若收敛到 600–700 行可把注册按域拆为 `register_*_commands()`，不新增豁免。门禁对非豁免文件硬失败阈值 500；豁免文件目标 800，超过只 warn 提醒还债。

## 6. 验收命令（每片必跑，输出贴进 tasks.md 证据）

```bash
pnpm build:web
pnpm test:unit                 # 含 file-size / MCP dispatch / index 全链
cd src-tauri && cargo check && cargo test --lib
cd .. && openspec validate --all --strict
pnpm locate --check-index
```

正式版部署另算：拆分不改变用户可见行为，但每次涉及面板/写回的切片部署后需复跑 `pnpm test:perf-panel`（解锁、空闲状态）并观察 24 小时采集日志无失败。
