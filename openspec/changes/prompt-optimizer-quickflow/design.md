# 设计：提示词优化快捷工具（prompt-optimizer-quickflow）

## 1. 形态决策：主窗口路由视图，不新建窗口

| 方案 | 说明 | 取舍 |
| --- | --- | --- |
| **A. 主窗口内部路由（选定）** | `main` 窗口新增 `/optimizer` 路由视图，快捷键唤起 = 既有 show 链路 + 路由切换 | 复用 ≤180ms show 基线、焦点/失焦/pin 语义、i18n、diff 组件；零新窗口配置 |
| B. 独立小窗（Trae 式） | 新 label + 新 HTML 入口 + 独立窗口生命周期 | 新增性能面、失焦/pin 语义要重做；与 RS-57（悬浮窗扩展点）职责重叠，属重复建设 |
| C. 复用详情页 diff 态 | 唤起直接跳最新条目详情 | 入口仍深（列表→详情），且优化对象未必是最新条目本身；视图定制空间小 |

选 A 的硬理由：本提案 P0 急需、不等底座；主窗口 show 链路是被 `pnpm test:perf-panel` 固化过的唯一达标唤起路径。B 的体验差异（常驻小窗）由 RS-57 以面板组件扩展点承接——本提案把编排与出口动作做成可迁移模块，即为其预留形态。

## 2. 交互流（端到端时序）

```mermaid
title="快捷优化流"
sequenceDiagram
  participant U as 用户
  participant K as 全局快捷键(Rust)
  participant W as 主窗口(optimizer 路由)
  participant E as 编排层(optimize-flow)
  participant P as provider(piComplete)
  participant C as copyText 写回链

  U->>U: 在任意应用复制提示词(正常采集入库)
  U->>K: 按 promptOptimizerShortcut
  K->>W: show main 窗口 + emit prompt-optimizer-quickflow 事件
  W->>W: 切 /optimizer 路由
  W->>E: mount → run(source=最新剪贴板文本)
  E->>P: optimizePromptWithPi(content, providerConfig)
  P-->>E: optimizedContent
  E->>W: 结果态: 原文/优化稿 diff(draft-diff 形态)
  U->>W: 确认「回写剪贴板」
  W->>C: copyText(optimized, source="prompt-optimizer")
  C->>C: capture_clip_record 显式入库 → write_clipboard_item(450ms 抑制)
  C-->>W: 完成 toast;剪贴板=优化稿,无回环采集
```

分支：剪贴板无文本 → 空态（引导先复制）；provider 缺位 → 禁用态引导设置页；优化失败 → 错误条 + 重试；结果与原文无差异 → 提示且不出确认写动作；「保存为片段」出口 = 同一显式入库 + `update_clip_record(bucket="snippet")`。

## 3. 快捷键与设置键

- 新设置键 `promptOptimizerShortcut: string`，默认 `"CommandOrControl+Shift+P"`，空串 = 关闭快捷键（仅托盘/菜单入口）。
- 新设置键 `promptOptimizerProviderId: string`，空串 = 跟随默认 agent provider。
- 注册：`settings_service/commands.rs` 的 `registered_global_shortcuts()` 纳入新键（与主键同样走 normalize + 去重 + `sync_global_shortcut_registration` 全量重建链）；handler 判定命中新键时：`main` 窗口不可见则走既有 show 路径，随后 emit `prompt-optimizer-quickflow` 事件；前端监听事件切 `/optimizer` 路由。
- 冲突语义：与主键同值时注册阶段去重保主键（红测断言 normalize 后两键不相等）；沙箱实例沿用「只注册设置键、失败仅 warning」既有行为。
- 设置页：快捷键控件复用既有 shortcut 录入；通道选择放 Agent 分区，一个 Select（选项 = `agentProviders` 列表 + 「跟随默认」），不加新配置面板。

## 4. 优化引擎与模型通道（本地优先、云端兜底）

- 引擎原样复用 `optimizePromptWithPi`（`prompt-optimizer.ts`）：单次 `piComplete`、4000 字截断、空返回抛错。**不重写引擎**。
- 通道解析顺序（编排层实现，纯函数可测）：
  1. `promptOptimizerProviderId` 非空 → 取 `agentProviders` 中该 id 的配置；id 失效（被删）→ 视为未配置走 2，并 toast 提示；
  2. 空 → `agent_resolve_pi_provider` 默认通道（现状行为，云端兜底即此）。
- 「本地优先」的落地方式：用户把某个 provider 配置为 baseUrl 指向本机 OpenAI 兼容端点（llama-server / Ollama，OCR 已有 `ocrEndpointUrl=127.0.0.1:8491` 同款先例）并将 `promptOptimizerProviderId` 指向它。设计上**不新增第二套端点配置**（不复刻 OCR 的独立 URL 键），避免与 provider 体系形成两处真相。
- 可达性守护：视图 mount 解析通道时若走本地 baseUrl，先经 `agent_check_provider` 探测（带超时），失败即回退默认通道并在结果区标注「本地通道不可达，已用默认通道」；不静默长等待。
- 超时预算：piComplete 调用设前端侧超时（本地 10s / 云端 30s，超时即报错可重试），避免用户面对无限运行态。

## 5. 回写与防回环（与 RS-51 抑制机制协同）

- **唯一写出口**：`copyText(optimizedContent, "prompt-optimizer", { sourceOptimizer: true })`（`use-clip-writeback.ts:467`）。它已串起：
  1. `capture_clip_record` 显式入库（content_hash 去重，同稿重写不产生重复条目）；
  2. `write_clipboard_item` 写系统剪贴板——Rust 侧先 `suppress_writeback_for(450ms)`，watcher 在抑制窗口内跳过采集（`clipboard/watcher.rs:84`）；
  3. 失败降级 `navigator.clipboard.writeText` + 状态提示。
- 前端不旁路任何裸写（红测静态断言：`src/prompt-optimizer/` 内不得出现 `navigator.clipboard` / 直接 `invoke("write_clipboard_item")`）。
- 原文条目不动：优化稿是新条目（source=`prompt-optimizer`，metadata.clipforgeContext 记录优化上下文），原文可在列表回溯；不覆盖用户刚复制的内容记录。
- 保存为片段：同一显式入库后 `update_clip_record({ id, bucket: "snippet" })`，复用既有 bucket 语义，零 schema 变更。

## 6. 前端模块结构（动作类扩展点形态预留）

```
src/prompt-optimizer/            # 新域目录（每个文件 ≤500 行，公共导出中文注释）
  optimize-flow.ts               # 编排纯函数:状态机 idle→capturing→optimizing→diff→writing/error
  use-quick-optimize.ts          # hook:路由进入/事件触发 → run(flow);单飞去重、重试
  QuickOptimizerView.tsx         # 视图:原文区 + draft-diff 形态结果区 + 出口动作条
  quick-optimizer-types.ts       # QuickActionSource/QuickActionResult/QuickActionExit 显式导出
```

- 类型命名对齐 RS-52 五类扩展点中的「粘贴动作」：`输入源(clipboard-latest) → 动作(prompt-optimize) → 结果(diff) → 出口(copy-back | save-snippet)`。本期是硬编码实现，但四段边界就是后续插件注册表的函数签名。
- 路由：`workspace-router.tsx` 加 `/optimizer` 路由，视图挂在 `main` 窗口；Esc 语义 = 返回列表路由（不是隐藏面板，避免与面板 Esc 收起歧义，红测断言）。
- 复用组件：diff 展示复用 `draft-diff.tsx` 形态（props 化抽用或同形新薄组件，实施时以最小改动定）；toast/错误条沿用详情页形态。

## 7. Rust 事件与命令

- 仅改 `settings_service/commands.rs`：`registered_global_shortcuts()` 返回值追加 `promptOptimizerShortcut`（normalize + 与主键/彼此去重）；`on_shortcut` handler 命中该键 → show main（若隐藏）+ `app.emit("prompt-optimizer-quickflow")`。
- **不新增 Tauri command**：取材用前端已有 clips 状态/`capture_current_clipboard`，写回走既有命令。Rust 侧改动收敛为快捷键注册 + 事件，`cargo check` 即可覆盖。
- settings schema：`settings_service` 校验白名单与 `settings-model.ts` 默认值加两键（走既有 Settings Service 事务，revision/`settings_changed` 自动获得）。

## 8. 竞态护栏

- **单飞**：`use-quick-optimize` 持 in-flight 标记，重复触发（连按快捷键、重复点重试）直接合并为一次。
- **取材瞬间漂移**：路由进入时快照一次「最新文本条目 id + content」，优化期间原文锁定该快照；期间剪贴板再变化不刷新（用户正看 diff），退出再进入才重取。
- **回写与采集竞态**：完全由 `copyText` 既有链承担（RS-51 已修），本层不加自有抑制逻辑——两套抑制并存才是回环风险源。
- **设置热更**：`promptOptimizerShortcut` 改动经既有 `sync_global_shortcut_registration` 全量重建，天然原子；通道键改动下次触发时生效，不打断在途优化。

## 9. TDD 计划（先红测后实现）

| # | 红测（先写，须失败） | 覆盖 |
| --- | --- | --- |
| T1 | `optimize-flow` 状态机：空输入/无文本条目 → 空态；provider 缺位 → 引导态；优化抛错 → error 可重试；正常 → diff 态且携带通道标注 | 编排全分支 |
| T2 | 通道解析：`promptOptimizerProviderId` 命中/失效回退/为空走默认 | 本地优先策略 |
| T3 | 无差异判定：优化稿 trim 后等于原文 → no-change 态，出口动作不出现 | 防无意义写 |
| T4 | 出口动作纯函数：copy-back 产出 `copyText(text,"prompt-optimizer",…)` 调用描述；save-snippet 产出 capture + bucket 更新描述 | 出口可测不碰真剪贴板 |
| T5 | 静态断言脚本（挂 `pnpm test:unit`）：`src/prompt-optimizer/` 无 `navigator.clipboard`/直调 `write_clipboard_item`；默认快捷键 normalize 后 ≠ 主键/legacy 键；Esc 路由语义；i18n key 双语齐备 | 防旁路/防冲突 |
| T6 | Rust：`registered_global_shortcuts` 含新键且与主键同值时去重保主键（纯函数抽取后单测，`cargo test --lib`） | 注册正确性 |

实现顺序：T1-T4 红 → 前端编排/视图绿 → T5/T6 红 → Rust 快捷键 + 断言脚本绿 → 门禁全量。

## 10. 性能预算与量化验收

| 段 | 预算 | 验收方式 |
| --- | --- | --- |
| 快捷键→窗口可见 | ≤180ms（既有基线，不回退） | `pnpm test:perf-panel -- --sandbox` |
| 可见→优化请求发出 | ≤100ms（取材+通道解析本地开销） | 单测计时断言（mock provider） |
| 请求→结果展示 | 本地通道 p50 ≤3s / 云端 p50 ≤8s（软目标） | 实机实测记录进交付说明；超时不阻塞，报错可重试 |
| 回写确认→toast | ≤200ms | 实机走查记录 |
| 快捷键冲突 | 默认键不撞 `Control+V`/`CommandOrControl+Shift+V`；撞第三方全局键时注册失败仅 warning + 托盘兜底 | 静态断言 + 实机 |
| 写回防回环 | 回写后 watcher 不新增条目（列表无重复） | 既有抑制测试 + 实机走查 |
| 门禁 | `pnpm test:unit` / `cargo check` / `pnpm build:web` / `check:i18n` / `locate --check-index` 全绿 | CI 式本地全跑 |

## 11. 备选方案与否决理由

- **为优化单开本地模型端点配置**（复刻 OCR 的 `ocrEndpointUrl` 模式）：否——与 provider 体系两处真相，设置面翻倍；provider baseUrl 已覆盖同需求。
- **流式输出优化过程**：否——`piComplete` 非流式；优化稿通常 <2K 字，流式收益小于改动面。
- **优化结果直接覆盖原条目**（`updateClipContent`）：否——破坏「原文可回溯」且触碰详情页写通道；新条目 + source 标记信息更完整、链路更短。
- **快捷键复用主键长按/二次键**：否——注册体系只支持单键语义，组合魔法键不可靠；独立键 + 可清空最直白。

## 12. 验证矩阵

| 项 | 自动化 | 实机（需解锁） | 人工 |
| --- | --- | --- | --- |
| 编排状态机全分支 | ✅ T1-T4 | — | — |
| 通道解析与回退 | ✅ T2 | 本地端点停机回退走查 | — |
| 快捷键注册/冲突/降级 | ✅ T5/T6 | 与常用应用全局键共存实测 | 盟哥按键手感 |
| 回写防回环 | ✅ T5 + 既有抑制测试 | 复制→优化→回写→列表无重复 | — |
| diff 确认与出口 | — | ✅ | 盟哥走查可读性 |
| 延迟预算 | show 基线 ✅ | 结果延迟实测记录 | — |
| i18n / 行数 / 注释门禁 | ✅ test:unit | — | — |
