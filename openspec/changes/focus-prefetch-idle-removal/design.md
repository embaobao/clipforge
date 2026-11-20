# Design：移除焦点框预取空转

> 配套 `proposal.md`。行号基于 2026-11-05 工作区 `src-tauri/src/lib.rs`（9559 行）。
> 本文是「影响范围确认」的权威记录；结论均可追溯到 `路径:行号` 或 git 提交。已按三份多模型 review 修订。

## 1. 现状链路

```
run() :7815  ── 无条件 ──▶ start_focus_prefetch_thread() :3788
                              │  thread::spawn(loop) 无退出条件
                              │  sleep(FOCUS_PREFETCH_INTERVAL_MS=250ms) :188
                              ▼
                    focused_input_bounds_platform() :3517 (macOS)
                              │  ① 读 FOCUS_BOUNDS_CACHE :239
                              │     命中条件 valid && age<600ms :3519-3529
                              │  ② 未命中 → native_focused_input_bounds() :3533
                              │     AXUIElement 跨进程查询 :3799-3959
                              │  ③ 仅 Ok 时写缓存 :3540-3552
                              │     失败不写、不更新 updated_at → 下轮必真查
                              ▼
                    FOCUS_BOUNDS_CACHE（运行时结果无人消费）

#[tauri::command] focused_input_bounds() :3411 ──▶ 同上 platform ──▶ 兜底全 0
   注册 :7950 ｜ 调用方：仓库内无（src/ git 历史 0 命中）

面板定位（真正的主链路）
open_panel :7972 ─▶ apply_position_strategy :9400 ─▶ 几何策略 ladder :9408-9413
                 └─▶ 后台线程 :8059-8061 ─▶ snapshot_paste_target_bounds :3557
                                              └─▶ native_focused_input_bounds :3571（直调）
                                                   └─▶ PASTE_TARGET_BOUNDS_CACHE :241（另一个缓存）
```

两套缓存是两个独立 OnceLock（`:239` / `:241`，访问器 `:253` / `:259`），数据结构都复用 `CachedFocusBounds`（`:197`），但写入者、消费者、生命周期完全不同。混淆两者是此前误判的根源。

## 2. 断链证据

| # | 结论 | 证据 |
|---|---|---|
| 1 | `focus_bounds_cache()` 只在 macOS 版 platform 内被读写 | `:253-257` 定义；全仓仅 `:3518`（读）、`:3521`（TTL）、`:3541`（写） |
| 2 | platform 只有两个入口：command 与预取线程 | `:3413`、`:3793`；Grep 全仓无第三处 |
| 3 | command 无任何调用方 | `src/` 全目录 0 命中；`git log -S 'focused_input_bounds' --oneline -- src` 为空；`tauri-web-mock.ts:23` switch 无 case、`:253` 有 default 兜底；`scripts/verify-mcp-dispatch.mjs` 只校验 `clipf.*`/`clipboard.*`；mcp/、scripts/、examples/、dev probe（`:7780-7811`）、`#[cfg(test)]`（`:9464`）均无分发。**注意**：`capabilities/default.json` 无 ACL 项**不能**作为证据——app-defined command 默认可达，外部硬编码 `invoke` 真实可达 |
| 4 | 面板定位不经过 platform | `open_panel :8067-8097` 全是几何；`apply_position_strategy :9400-9453` 的 ladder 为 `position_active_window_center :9370` / `position_follow_cursor :8957` / `position_center :8999` |
| 5 | `FocusInput` 分支不可达 | `get_strategy_for_source :9455-9461` 只返回 TrayCenter / FollowCursor / Center / 默认 FollowCursor；设置里的 `positionStrategy` 只在 `:1708-1711` 进诊断日志，从未反序列化成枚举 |
| 6 | 显示后覆盖已删除 | `compute_panel_position :8353-8358` 带 `#[allow(dead_code)]`、全仓无调用方；`lib.rs:8101-8104` 明确「不再在显示后用焦点输入框位置覆盖定位」——**该注释本身正确，不需修改** |
| 7 | 粘贴目标链独立 | `:3571` 直调 native，写 `:3583/:3595/:3611/:3639` 的 `paste_target_bounds_cache()`；`restore_paste_target_focus :3664`（唯一调用 `:727`）用它做粘贴时 activate 目标 App |
| 8 | git 重构史 | `8f9b332` 引入 command；`cd13758` 引入缓存+预取+显示后异步覆盖；`f4fb863` 删显示前同步探测；**`44c44b7` 删掉显示后覆盖线程、native 从 osascript 换成 AX，但预取线程与缓存未删** |
| 9 | 恒 false 的残留字段 | `:8083/:8090` 的 `position_source` 只能是 `sync-*`/`fallback-*` → `:8337` `used_focused_input` 恒 false；`:8110` 传的是策略名而非焦点来源 |

**表述修正**（复核意见）：`FOCUS_BOUNDS_CACHE` 的「唯一写者是预取线程」不严谨 —— command 若被调用同样会写缓存（`:3413` → `:3541`）。因为 command 无调用方，**运行时**实际只有预取线程在写。结论不变：缓存结果没有消费者。

## 3. 影响范围矩阵

| 主功能 | 入口 | 是否读 FOCUS_BOUNDS_CACHE | 停用预取后 |
|---|---|---|---|
| 面板显示 / 隐藏 | `open_panel :7972`、`hide_quick_panel :8115` | 否 | 不变 |
| 面板定位（6 策略 + 回退） | `apply_position_strategy :9400` | 否 | 不变 |
| 粘贴目标 App 激活 | `snapshot_paste_target_bounds :3557` → `PASTE_TARGET_BOUNDS_CACHE :241` | 否（独立缓存） | 不变 |
| 复制写回与抑制 | `use-clip-writeback.ts` / `WRITEBACK_SUPPRESS :192` | 否 | 不变 |
| 剪贴板采集 | `clipboard/watcher.rs:204` 120ms | 否 | 不变 |
| 全局快捷键 / 托盘 | `:9458` / tray | 否 | 不变 |
| 辅助功能权限 | `check_accessibility_permission_platform :3962` 直查 `AXIsProcessTrusted()` | 否 | 不变；权限链与预热无因果 |
| 设置页 `positionStrategy` | `settings-model.ts:68`、`DisplayPanelSection.tsx:114` | 否 | 不变（原本后端也不读，另案） |
| 诊断面板 / 内存可观测 | `src-tauri/src/diagnostics.rs`、`CaptureStorageSections.tsx` | 否 | 不变；但上一轮工作区改动在本文件，实施前须隔离避免混提 |
| show/hide ≤180ms | `scripts/perf-panel-probe.py` | 不依赖预热日志/缓存 | 需回归兜底，**不作为本改动的因果验收** |

## 4. 删除边界（实施时逐项核对）

**可删（方案 A，3 处）**
- `lib.rs:188` `FOCUS_PREFETCH_INTERVAL_MS`
- `lib.rs:3786-3796` `start_focus_prefetch_thread()`（含中文注释）
- `lib.rs:7815` `run()` 调用行（函数返回 `()`，直接删行；漏删会 unresolved）

删后剩 `generate_handler! :7950` → `:3412` → `:3517` → `:3518/:3521/:3541` 完整可达链，**无任何符号变 unreferenced**，不会新增 dead_code 警告（`Cargo.toml` 无 lints 段；`thread`/`Duration` 在 `:726/:730` 等仍大量使用）。`FOCUS_CACHE_MAX_AGE_MS :189` 仍被 `:3521` 使用，不是「保留但无人用」。

**必须保留**
- `native_focused_input_bounds()` `:3798+`（macOS cfg）—— `:3571` 仍用；非 macOS 不引用
- `snapshot_paste_target_bounds()` `:3557` / 非 macOS stub `:3661`、`PASTE_TARGET_BOUNDS_CACHE :241` 与 `paste_target_bounds_cache() :259`、`PASTE_TARGET_CACHE_MAX_AGE_MS :190`（命名相近，勿误删）
- `CachedFocusBounds :197`（`:3574/:3630/:8357` 仍在用）
- `FocusInput` 枚举变体 `:221`（`settings_service/mod.rs:295` schema 与前端仍接受该值）
- `compute_panel_position :8354`、`PanelTriggerPayload` 两字段 `:587-588`（前端 `settings-model.ts:142-143`、`DisplayPanelSection.tsx:140` 仍消费）
- accessibility 全链、i18n focusInput 文案、`:191` `LAST_NATIVE_POSITION_FAILURE_MS`（既存只写不读残留，与本提案无关，勿动）

**保留但补注释（兼容面）**
- `focused_input_bounds` command `:3411-3422`、注册项 `:7950`、两个 cfg 版 platform（`:3516-3554` / `:3781-3784`）、`FOCUS_BOUNDS_CACHE :239`、`focus_bounds_cache() :253`、`FOCUS_CACHE_MAX_AGE_MS :189`、`FocusedInputBoundsPayload :435-443`
- 注释必须写真实语义：「**不再有后台预热；command 自身仍保留 600ms 短缓存**；仓库内无调用方，保留仅为外部/回滚契约」。不要写「现场查一次、不依赖预热缓存」——与 `:3518-3531` 仍读缓存矛盾。
- 只删 macOS 版 platform 会让 `:3413` 无定义 → **两个 cfg 版一起留**。

**方案 C 否决理由**：删 command 需跨双平台改 6+ 处，漏一处即编译失败；且 app-defined command 默认可达，仓库外硬编码 `invoke` 真实可达，删后返回 "command not found"。保留 command 边际成本接近 0。

## 5. 行为变化（并发 / 生命周期 / 平台 / 契约）

- 不再有 `thread::spawn` 永生线程；`FOCUS_BOUNDS_CACHE` 的 `OnceLock` 不再被运行时初始化（除非 command 被调用），Mutex 争用消失。
- `native_focused_input_bounds()` 的 AX 调用频率：预取路径 4 次/秒 → **0**；面板打开时 `snapshot_paste_target_bounds` 每次 1 次，与现状一致。
- 非 macOS：原本线程体被 cfg 包住是 no-op，删除后仍为 no-op；command 非 macOS 版返回 Err 不变。
- 日志：无现成探针依赖预热相关日志；删除不产生日志断言失败。
- 契约：外部若调用 command，仍走 `:3518-3553` 的「短缓存 → 现场 AX → 写缓存」；这是**无超时的同步跨进程调用**，未授权时可能阻塞数秒（无实测依据）。权限弹窗只由 `:4005-4012` 的 `AXIsProcessTrustedWithOptions` 触发且 `:4141/:4178/:5332` 有一次保护，停用预取**不会**导致反复弹窗或权限链退化。
- 不做配置开关：删死代码靠 git revert 回滚，比开关干脆。

## 6. 验证设计（已按 review 改造为可证伪）

| 目标 | 方法 | 通过标准 |
|---|---|---|
| 线程不再启动（强证据） | **静态源码断言**（第二轮 review 加固）：`scripts/verify-focus-prefetch.mjs` 用 `import.meta.url` 定位根目录、递归扫描 `src-tauri/src/**/*.rs`（实测 46 个）、剥离行/块注释后按词边界匹配，fail-closed（读失败 / 空源码即失败）；双向断言 2 个废弃符号不存在 + 10 个必须保留符号存在。配合 `cargo check`（删函数后残留引用直接编译失败） | 断言通过（实测 exit=0）+ `cargo check` 通过 |
| AX 查询归零 | ① **静态闭合**：`native_focused_input_bounds` 的全部调用点只剩 `:3413`（仓库内 0 调用方）与 `:3571`（仅 `:8060` 唤起时触发），静置无唤起即可推出归零；② 可选动态：实施期在 `focused_input_bounds_platform()` 入口临时加一行 `log_to_file("debug","focus","ax-probe")`（复用现成通道、受 `debugLogsEnabled` 控制），静置 5 分钟数 `clipforge.jsonl` 里 `ax-probe` 条数做前后对照，验收后移除 | 静态闭合成立；动态计数从约 1200 条/5min → 0 |
| 面板不变慢（仅回归兜底） | `pnpm test:perf-panel -- --sandbox --rounds 20`（**必须 `--sandbox`**：默认打未改动的稳定版 `/Applications/ClipForge.app`），标注「与本改动无因果，仅回归兜底」 | `max(values)` 最差轮次 ≤180ms；脚本不输出 p95，口径不写 p95 |
| 粘贴目标不受影响 | `pnpm dev:sandbox`（HEAD 已提交的稳定入口）实机：外部输入框唤起面板 → 选条目粘贴 | 目标 App 正确 activate、内容写入 |
| 编译与门禁 | `openspec validate focus-prefetch-idle-removal --strict` + `cd src-tauri && cargo check` + `cargo test --lib` + `pnpm test:unit`（已含 `locate --check-index`）+ `pnpm tauri dev` | 全绿 |
| 双平台 | `cargo check --target x86_64-pc-windows-msvc`（本机 `rustup target list --installed` 已装） | 如实记录结果；macOS 缺 MSVC 链接器时大概率失败，记为环境限制**不作阻断**；未装 `x86_64-apple-darwin` |

**为什么不用 `sample` / Rust 单测（review 否掉的伪验收）**
- `cargo test --lib` 不调用 `run()`（`:7814`），线程在测试里本来就不会启动；删掉符号后测试连引用都拿不到，断言恒真。
- `sample <pid> 5` 的 `5` 是 **5 秒不是 5 分钟**，非自身进程需 sudo，且是调用栈文本，无法定量「4 次/秒 → 0」；阴性结论不可证。
- `pnpm test:perf-panel` 默认 `rounds=5`（`perf-panel-probe.py:253`）、判据是 `max(values) ≤180`（`:319-327`）、**不输出 p95**、测稳定版、且 show/hide 路径从不读该缓存 → 即使删错也 PASS。
- `scripts/perf-panel-probe.py` 依赖 CGEvent 注入全局热键，锁屏/息屏必然全超时。

**当前门禁覆盖现状**：`pnpm test:unit` 串联 10 个脚本，读 Rust 的只有 `verify-editor-agent-bridge.mjs`、`verify-mcp-dispatch.mjs`、`verify-file-size.mjs`（仅行数）、`locate.mjs`；**没有任何门禁对 lib.rs 做内容断言**。lib.rs 在豁免清单内，9559 → ~9556 行仍只 warn 不 fail（`verify-file-size.mjs:45-48`）。因此必须新增上面的静态断言，不能靠现成门禁兜底。

## 7. 文档与注释同步清单（已按 review 校正）

| 位置 | 现状 | 处理 |
|---|---|---|
| `lib.rs:8049-8051` | 称 `snapshot` 会 fork osascript | 改为「NSWorkspace + 原生 AX，后台线程执行」；落笔前核对 `frontmost_app_identity()`（`:3696-3720`）实现 |
| `lib.rs:8101` | 陈述「不再用 osascript 异步路径覆盖定位」 | **注释正确，不动**（review 纠正了初稿的误判） |
| `lib.rs:9444-9446` | 仍写「见 open_panel 的异步覆盖」「AX 命中后异步覆盖会精修」 | 改为与 `:8101-8104` 一致的描述 |
| `lib.rs:3786-3787` | 预热线程注释 | 随函数删除；在保留的 command 上补兼容面中文注释 |
| `CLAUDE.md:49` | 「焦点位置有后台预热线程缓存」 | **删掉该越界架构句**，指向 `docs/ARCHITECTURE.md` 单点维护；AGENTS.md:31 规定 CLAUDE.md 只做最小引用，不维护第二套规则/架构事实 |
| `docs/ARCHITECTURE.md:180/195` | FocusInput 与回退链描述与现状矛盾 | 标注该策略当前不可达，指向 `get_strategy_for_source` |
| `docs/BUSINESS_INDEX.md` | 无相关条目 | **必须加**：新增校验脚本触发 AGENTS.md:101 索引维护义务；已在「验证速查」表加「焦点框预取 / 面板定位」行并引用 `scripts/verify-focus-prefetch.mjs`（初稿误判为不触发，第二轮 review 纠正） |
| 归档矛盾登记（不改内容） | `.archive/wire-startup-clipboard-capture/design.md:70`、`.archive/window-positioning/*`、`.archive/nspanel-floating-panel/design.md:189` 与 `tasks.md:38`、`archive/2026-07-14-panel-interaction-upgrade/tasks.md:17`、`.claude/worktrees/docs-claude-md-refresh/AGENTS.md:163` 均声称预热/FocusInput 生效 | 全部登记在本提案，明确「归档不改、worktree 分支不回流」；`archive/2026-07-16-clipboard-agent-panel/design.md:457` 是前端 SWR 预取，无关 |

## 8. 残留风险与未决问题

1. 仓库外硬编码 `invoke('focused_input_bounds')`：保留 command 规避；若未来确认无外部契约，可另案走方案 C。
2. 已构建的旧 `release/*.dmg` 与 `src-tauri/target/release/bundle/macos/ClipForge.app` 仍含该线程，只有重新构建才生效；稳定版 `/Applications` 本次不动。
3. `pnpm build` 副作用见 `proposal.md`「风险与验收」，含重签名与发布元数据改写，执行前需盟哥点头。
4. `FocusInput` 设置项选了没效果、`usedFocusedInput` 恒 false、`compute_panel_position` 死代码：只记录，**不作本提案验收/归档前置**；其中设置项是产品可感知问题，建议另案。
5. `pnpm test:perf-panel` 需机器解锁；`cargo check --target x86_64-pc-windows-msvc` **实测失败**（2026-11-05）：`aws-lc-sys` 编译 `jitterentropy-timer.c` 报 `fatal error: 'windows.h' file not found`，本机缺 MSVC/Windows SDK，exit=101。属环境限制、非代码缺陷，按提案不作阻断；macOS 目标 `cargo check` 与 `cargo test --lib` 均通过。
6. 工作区 `git status` 有 20+ 项未提交改动（盟哥原有 + 上一轮 4 个），实施必须用隔离分支或 stash；**不在任务清单里安排破坏性回滚动作**。实际实施未切分支/stash（会动盟哥改动），改采文件级精确编辑，已在 `tasks.md` 如实记录为「未隔离」。
7. `CLAUDE.md` 仍有**既有**失实描述（`:23` 把 `pnpm build` 写成 tsc&&vite build、`:41-43` 写 lib.rs ~3,400 行、`:47` 写监听 100ms、`:31` 写 Rust 无 `#[test]`、`:50` 维护第二套架构事实）。本提案只删 `:49` 越界预热句，其余另案登记、不扩大范围；第二轮 review 已据此收窄 `spec.md` 中「SHALL NOT 继续维护第二套架构事实」的过度承诺。
8. 第二轮 review 发现 `lib.rs` / `package.json` 的 diff 混入上一轮「运行内存检查」工作线的改动（`settings:diagnostics` 分支、`dev:diagnostics` / `mem:report` script），提交前须按 hunk 隔离；本提案不擅自回滚盟哥工作区改动。
