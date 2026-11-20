# 设计：固定悬浮面板语义收敛（pinned-floating-panel）

## 1. 语义模型（本提案的核心决策）

pin 表达的是「**在我明确收起之前，别因为焦点变化把面板拿走**」，不是「面板永远不许关」。据此把现有隐藏路径一刀切成两类：

| 类别 | 路径 | pin 态行为 | 现状 |
| --- | --- | --- | --- |
| 自动隐藏 | window blur → 60ms 延迟 → `is_panel_pinned_command` → 原生淡出（`use-panel-blur-hide.ts:71-97`） | **抑制** | 已正确 |
| 自动隐藏 | 外部点击 / 幻影 blur 自愈（`lib.rs:7834-7840`、`8246-8271`） | **抑制** | 已正确 |
| 显式收起 | 全局快捷键 toggle（`settings_service/commands.rs:394-397` → `lib.rs:8155-8189`） | **放行** | 已正确（`hide_panel` 无 pin 拦截） |
| 显式收起 | Esc（`use-panel-keyboard.ts:276-279`） | **放行** | ❌ 残留 `if (!settingsRef.current.panelPinned)`，pin 时不发 hide 命令 |
| 显式收起 | `hide_quick_panel_command` / 托盘 / 菜单收起 | **放行** | 需按同一口径核对 |
| 状态复位 | `hide-quick-panel` 事件（`use-panel-blur-hide.ts:147-150`） | 前端应复位 UI 态，不阻止 Rust 已执行的 hide | ❌ 现按前端 settingsRef 跳过复位 |

`archive/2026-07-14-panel-interaction-upgrade/proposal.md:24` 的原始定义「所有隐藏路径在 pinned 时跳过」是 A1 的根因；`lib.rs:8121-8123` 已用注释纠正，本提案把这条纠正**贯彻到前端**。

## 2. 权威源与状态流

**唯一权威源**：`src-tauri/src/lib.rs:8192` 的 `static PANEL_PINNED: AtomicBool`。所有隐藏决策、可见性判断、探针断言都读它；前端 `settingsRef.current.panelPinned` 只用于「菜单勾选态 / 设置页显示」，不再参与任何 `if` 决策。

```
用户触发 toggle（⌘P / 菜单）
  → 前端 invoke set_panel_pinned_command(next)
      → Rust ① store AtomicBool
            ② 经 Settings Service 写盘（带 revision，失败则不 store）
            ③ 返回 { pinned, revision }
  → 前端收到成功才 setSettings(next)；失败 → 保持旧值 + toast + logAppError
  → settings_changed 事件同步其他窗口（设置窗 / 面板）
```

要点：

- **先 Rust 后前端**，消除 A3 的 fire-and-forget 脏状态。当前 `App.tsx:817-823` 顺序相反，必须改。
- Rust 失败时不写内存、不写盘，返回明确错误码；前端不回滚已成功的一半。
- 启动恢复链（`lib.rs:5900-5917` 读 `read_user_settings` → `PANEL_PINNED.store`）保留，作为三方一致性的兜底，但不再是唯一持久化通道。
- `src/services/tauri-web-mock.ts:137-141` 的 localStorage 分支同步改为「模拟同一事务链」，保证 `pnpm dev` 浏览器态与真机语义一致。

## 3. 逐文件改动点

| 文件 | 改动 | 约束 |
| --- | --- | --- |
| `src/clipboard/use-panel-keyboard.ts:276-279` | Esc 分支去掉 `panelPinned` 判据，无条件发 `hide_quick_panel_command` | 不新增 IPC；其余键位与 effect deps 不动 |
| `src/clipboard/use-panel-blur-hide.ts:147-150` | `hide-quick-panel` 事件改为无条件复位 UI 态 | 只复位状态，不二次触发 hide |
| `src/App.tsx:817-823` | `togglePanelPinned` 改事务链：await Rust → 成功后 setSettings，失败回滚 | 不引入新 store；保持 220ms 防抖写盘链不变 |
| `src-tauri/src/lib.rs:8273-8282` | `set_panel_pinned_command` 增加 Settings Service 写盘 + revision，返回结构化结果 | 命令薄壳，写盘逻辑下沉 `settings_service/`，带中文文档注释 |
| `src-tauri/src/lib.rs:3444` | `toggle_quick_panel_command` 可见性判断补 `!is_panel_fading()`，与 `:8162` 对齐 | 单一可见性判定函数，避免两处各写一份 |
| `src/clipboard/components/QuickCommandMenu.tsx:61-65` | 文案「固定到顶部」→「固定面板 / 取消固定」，硬编码中文改 i18n | 复用 `zh-CN.json:311-313` 的 `main.aria.pinPanel` / `unpinPanel` / `main.pin.title` |
| `src/i18n/locales/*.json` | 清理孤儿 key，补齐 en-US 对应文案；`main.onboarding.pin.*` 若在引导文案中仍有效则接入 | 跑 `pnpm check:i18n`；`scan-hardcoded-copy.mjs` 零新增 |
| `src/clipboard/components/QuickPastePanel.tsx:18` | 仅把 placeholder 文案改为「条目置顶功能开发中」，与窗口 pin 去歧义 | **不实现条目置顶** |
| 新增 `scripts/verify-panel-pin.mjs` | 静态断言（见 §5） | 零依赖、挂 `pnpm test:unit` |
| `scripts/perf-panel-probe.py` | 新增 pin 场景（见 §6） | 不改既有四项阈值与退出码语义 |

## 4. 时序与竞态护栏

- 失焦隐藏链路保持不变：60ms 延迟 → `is_panel_pinned_command`（catch 时 assume not pinned）→ 原生 alpha 淡出 `FADE_MS=110` + `FINISH_DELAY=118`。**不在其中新增 IPC**。
- Rust 侧 `PANEL_FADE_ACTIVE` / `PANEL_FADE_GENERATION`（`lib.rs:8552-8564`、`8593-8608`、`8667-8676`）继续负责淡出代际与可打断；pin 切换不得绕过代际号。
- 宽限窗 400ms（`App.tsx:380` 唤起）与 600ms（`blur-hide.ts:45` 幻影自愈）暂统一为具名常量并加中文注释说明两者用途差异；**不擅自合并数值**，需实机确认后再决定是否收敛（A9 单列）。
- 固定态下 `hide_panel` 仍执行 `save_panel_position`（`lib.rs:8124`），Remember 归一化坐标行为沿用 `.archive/window-positioning` 的既有实现，不改格式。

## 5. 静态断言（新增门禁）

`scripts/verify-panel-pin.mjs` 用纯文本/正则做否定断言，零依赖、失败退出码 1：

1. `hide_panel` 函数体内不含 `is_panel_pinned()` 调用 —— 防止一刀切拦截回归。
2. `use-panel-keyboard.ts` 的 Esc 分支不出现 `settingsRef.current.panelPinned`。
3. `use-panel-blur-hide.ts` 的隐藏判定与 `hide-quick-panel` 复位都不读前端 pin 值；唯一权威查询保留 `is_panel_pinned_command`。
4. `toggle_quick_panel_command` 与 `toggle_quick_panel` 的可见性判定表达式一致（含 `is_panel_fading`）。
5. pin 相关 i18n key 在 zh-CN / en-US 两侧都存在且被引用；菜单无硬编码中文。
6. `set_panel_pinned_command` 的返回结构含 `revision` 字段（防止回到只改内存的实现）。

挂入 `pnpm test:unit` 末尾，与 `pnpm locate --check-index` 并列；按 AGENTS.md「索引维护义务」同步 `docs/BUSINESS_INDEX.md` 的「验证速查」表。

## 6. 探针扩展

`scripts/perf-panel-probe.py` 现状只驱动全局快捷键 toggle，不读也不归一化 `panelPinned`，因此**pin 的核心语义完全无覆盖**。新增两个可选场景（默认跟随主探针、可用参数关闭）：

- **P1 固定态失焦不隐藏**：先通过沙箱设置把 `panelPinned=true`，唤起面板 → 触发一次真实 focus change → 断言窗口仍可见（`CGWindowList`），且未进入淡出代际；再 toggle 两次恢复。
- **P2 固定态显式收起**：pin 态下分别发 toggle 与 Esc，断言 show/hide 端到端 ≤180ms、无透明鬼影、动画可打断。

约束：① 探针结束必须把 `panelPinned` 还原为进入前的值，避免污染沙箱 settings.json5；② 锁屏预检（`:112-135` 返回码 3）保持原样，不因新增场景放宽；③ 既有四项（show/hide 延迟、幻影 blur 自愈、动画可打断、透明鬼影）阈值与退出码语义不变；④ `phantom_ok` 在 pin 态下要区分「自愈生效」与「pin 恰好不隐藏」，避免假阳性（现 `:293-307` 无法区分）。

## 7. 跨平台与性能边界

- macOS 的 NSPanel（`lib.rs:7813 tauri_nspanel::init()`）、`.statusBar` level、`nonactivatingPanel`、`can_join_all_spaces`、`fullScreenAuxiliary` 全部沿用；Windows/Linux 的 `always_on_top` 分支不动。平台差异继续隔离在 Rust 原生层（AGENTS.md）。
- 不改定位算法、防抖、策略枚举；不改 `clips` 表 / `settings` schema；不新增表迁移。
- 热路径零新增同步等待：所有写盘走既有 Settings Service 异步事务；pin 查询复用单次 invoke，不加轮询、不加启动阻塞读取。
- 性能基线守住 `pnpm test:perf-panel` 的 show/hide ≤180ms 与 `quick.scroll/select/copy/paste` P95 ≤300ms。

## 8. 与相邻提案的边界

| 相邻项 | 关系 | 边界 |
| --- | --- | --- |
| `snipaste-parity`（0/27，待放行） | 技术前史，互不阻塞 | 贴图窗是独立 `paster/` 窗口池，其置顶/穿透/隐藏归 `specs/paster-windows`；本提案不把 pin 语义扩展过去，不改其 `F1/F3` 热键降级机制 |
| `.archive/nspanel-floating-panel` | 复用结论 | 只复用「失焦不自动隐藏、非抢焦点」的能力，不改 NSPanel 配置 |
| `.archive/window-positioning` | 复用结论 | 固定态收起仍走 `save_panel_position`；不改 Remember 存储格式 |
| `clipboard-interaction-repair`（0/10） | 并行、可能同改 `use-panel-keyboard.ts` | 需错开提交批次：本提案只动 Esc 的 pin 判据，其余键位路由归对方；合并前做冲突复核 |
| `product-iteration-master-plan` | 波次归位 | W1 补位；交互区域矩阵「托盘/全局快捷键/快速菜单」行不变，不新增 surface |

## 9. 备选方案与否决理由

- **把 pin 前端化（只留 settingsRef）**：否决。Rust 侧失焦/淡出/幻影自愈都读 `PANEL_PINNED`，前端化必然产生第三个真相，且跨窗口不同步。
- **取消 pin 态下的 Esc/toggle，要求先取消固定再收起**：否决。违背「显式收起一律放行」的语义，且与已提交的 `hide_panel` 行为冲突，会让 W1 验收出现两套结论。
- **把 `clips.pinned` 条目置顶一起做完**：否决。不同功能域、不同数据层，会扩大范围并混淆命名；本提案只做去歧义。
- **新增一个 NSPanel 变体承载固定态**：否决。窗口层已够用，新窗口会引入焦点与生命周期新风险，且与 `.archive/nspanel-floating-panel` 的非目标一致。

## 10. 验证矩阵

| 场景 | 期望 | 手段 |
| --- | --- | --- |
| pin=on，点击面板外 / 切到其他应用 | 面板保持可见，不淡出 | 自动探针 P1 + 沙箱实机 |
| pin=on，全局快捷键 toggle | 立即收起，位置被记住 | 自动探针 P2 + 沙箱实机 |
| pin=on，按 Esc | 立即收起，与 toggle 一致 | 自动探针 P2 + 沙箱实机 |
| pin=on，选中条目复制 / 粘贴 | 目标应用获得焦点，内容不粘回面板 | 沙箱实机（不可自动化） |
| toggle 时写盘失败 | 前端保持旧值、Rust 保持旧值、toast 报错，重启无漂移 | 注入式单测 + 沙箱实机 |
| 重启应用 | `panelPinned` 恢复，菜单勾选态与 Rust 一致 | 沙箱实机 |
| pin=off | 现有失焦隐藏、幻影 blur 自愈、四项性能探针全部不回退 | `pnpm test:perf-panel` |
| 菜单 / 引导文案 | 中英一致、无硬编码中文、无孤儿 key | `pnpm check:i18n` + 静态断言 |

所有「沙箱实机」项需机器解锁；锁屏 / 息屏下 CGEvent 注入必然超时，按 AGENTS.md 记为未验证项而非失败项。
