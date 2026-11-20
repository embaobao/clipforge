# Delta: 焦点框预取空转清理（focus-prefetch-idle）

> 采用纯 `ADDED Requirements`：本仓 `openspec/specs/` 无对应基线，`MODIFIED` / `REMOVED` 在归档合并阶段有静默丢失风险（首轮 review 意见）。
> 所有条款描述清理后的目标行为，不改变任何用户可见功能。第二轮 review 收窄了 `CLAUDE.md` 条款、补了索引义务。

## ADDED Requirements

### Requirement: 禁止后台周期性焦点框预取

应用 SHALL NOT 在启动时创建以固定间隔轮询焦点输入框位置、且无退出条件的后台线程。焦点框位置信息 SHALL 仅在实际需要时按需读取：面板唤起时的粘贴目标快照，或外部直接调用 `focused_input_bounds` 命令。

#### Scenario: 冷启动后静置

- **WHEN** 应用启动并静置 5 分钟，期间用户未唤起面板
- **THEN** 不存在周期性 `AXUIElement` 焦点查询（原为约 4 次/秒），也不存在 `start_focus_prefetch_thread` 线程或其 250ms 间隔常量

#### Scenario: 编译期闭合

- **WHEN** 执行 `cargo check` 与静态源码断言
- **THEN** `src-tauri/src/**/*.rs` 中不存在 `start_focus_prefetch_thread` / `FOCUS_PREFETCH_INTERVAL_MS`，且因无可引用的残留符号而编译通过

### Requirement: focused_input_bounds 命令保留为兼容面

`focused_input_bounds` Tauri command SHALL 保留注册与 macOS / 非 macOS 双平台实现，作为仓库外调用方与回滚的兼容面。清理后该命令 SHALL NOT 由任何后台线程周期性调用；其自身 SHALL 继续保留 600ms 短缓存（读 `FOCUS_BOUNDS_CACHE`，未命中时现场查询原生 AX 并写回），SHALL NOT 因缺少预热而返回伪造坐标。命令 SHALL 以中文文档注释标明「仓库内无调用方、不再有后台预热」。

#### Scenario: 外部直接调用

- **WHEN** 仓库外脚本或 devtools 直接 `invoke('focused_input_bounds')`
- **THEN** 命令仍可解析，返回焦点输入框坐标或全 0 的 `fallback` 兜底，不返回 "command not found"

#### Scenario: 双平台编译

- **WHEN** 分别在 macOS 与已安装的非 macOS 目标上执行 `cargo check`
- **THEN** 两个 `focused_input_bounds_platform` cfg 分支均保留且 macOS 目标编译通过；非 macOS 目标若因缺少本机链接器失败，SHALL 如实记录为环境限制而非代码缺陷

### Requirement: 面板与粘贴主链路行为不变

面板显示、定位（几何策略与回退链）、隐藏、粘贴目标 App 激活、剪贴板采集、复制写回、全局快捷键 SHALL NOT 依赖 `FOCUS_BOUNDS_CACHE`。面板唤起时的粘贴目标快照 SHALL 继续由 `snapshot_paste_target_bounds` 在后台线程直调原生焦点查询，写入独立的 `PASTE_TARGET_BOUNDS_CACHE`。

#### Scenario: 外部输入框粘贴

- **WHEN** 用户在外部 App 的输入框唤起面板并选中一条历史粘贴
- **THEN** 目标 App 被正确激活且内容写入，与清理前行为一致

#### Scenario: 面板唤起延迟回归

- **WHEN** 在 dev 沙箱实例上运行 `pnpm test:perf-panel -- --sandbox --rounds 20`
- **THEN** show/hide 最差轮次 ≤180ms（脚本判据为 `max(values)`，不产出 p95），且该回归仅作兜底、不作为预取清理的因果验收

### Requirement: 文档与索引反映真实链路

项目文档 SHALL 描述当前真实的面板定位链路：几何策略 + 回退链、粘贴目标快照按需读取；SHALL NOT 声称存在后台焦点预热缓存或 `FocusInput` 定位策略已生效。失实注释 SHALL 被更正，归档文档与 worktree 分支的矛盾 SHALL 被登记而不篡改历史记录。本提案 SHALL 删除 `CLAUDE.md` 中越界的后台预热描述并指向 `docs/ARCHITECTURE.md`；该文件内**其他既有失实** SHALL 另案登记，不在本提案范围（不承诺一次性清理第二套架构事实）。

#### Scenario: 后续开发者查阅

- **WHEN** 开发者阅读 `CLAUDE.md:49`、`docs/ARCHITECTURE.md` 与 `src-tauri/src/lib.rs` 相关注释
- **THEN** 看不到「后台预热焦点位置缓存」的过时描述，`FocusInput` 当前不可达有明确标注，归档矛盾在本提案中可查

### Requirement: 新增校验脚本同步索引

本提案新增的 `scripts/verify-focus-prefetch.mjs` 属校验脚本，SHALL 按 AGENTS.md:101 在 `docs/BUSINESS_INDEX.md` 增加对应索引行，且该行引用的路径 SHALL 真实存在（由 `pnpm locate --check-index` 校验）。门禁 SHALL 递归扫描全部 Rust 源码、剥离注释后按词边界匹配，并在读失败或源码为空时 fail-closed。

#### Scenario: 索引防腐

- **WHEN** 执行 `pnpm test:unit`
- **THEN** `locate --check-index` 通过，`docs/BUSINESS_INDEX.md` 中「焦点框预取 / 面板定位」行指向真实存在的 `scripts/verify-focus-prefetch.mjs`

#### Scenario: 门禁抗绕过

- **WHEN** 把废弃符号改名、挪到别的 `.rs` 文件、写进注释，或让某个 Rust 源文件为空
- **THEN** 门禁不会静默通过：改名/挪文件由全量扫描 + 词边界覆盖，注释由剥离逻辑排除，空文件与读失败判失败

### Requirement: 验收可证伪

清理 SHALL 提供针对本改动的可证伪证据：静态源码断言 + `cargo check` 证明线程不再存在；AX 调用归零 SHALL 以静态闭合（`native_focused_input_bounds` 的调用点只剩 `focused_input_bounds_platform`（由无调用方的 command 间接进入）与仅唤起时触发的 `snapshot_paste_target_bounds`）或临时 debug 计数前后对照证明。SHALL NOT 以 `cargo test --lib` 中恒真断言、短时 `sample` 阴性结论、或默认测稳定版的性能探针充当验收。

#### Scenario: 验收审查

- **WHEN** 盟哥按 `tasks.md` 第 5 节逐条核对证据
- **THEN** 每条已标完成的证据都有实测输出、退出码或源码命中清单，且性能探针结果明确标注「仅回归兜底」
