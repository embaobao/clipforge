# 设计：代码可维护性地基重构

## 1. 核心原则

1. **非 big-bang**：每个切片只动一个域，保持行为不变，`pnpm build` + `cargo check` + 全部 verify 脚本通过才算完成。禁止一次性大重写。
2. **校验与重构协同演进**：拆分前先升级对应 verify 脚本（从源码子串断言改为结构化/契约断言），避免拆完触发大面积误报。这是本提案最关键的约束。
3. **优先服务功能线**：先拆「能解锁功能」的模块。lib.rs settings 模块拆分直接让 MCP dispatch 和 Tauri command 共用同一 SettingsService 实现（服务 settings-service-unified-protocol B3）；前端 settings 组件拆分直接服务 settings-interface-redesign。
4. **门禁拦新增，存量按域还**：500 行硬门禁只对新增/被改动文件 fail；存量主文件进豁免清单，按切片逐步拆到达标。

## 2. 500 行门禁设计

门禁脚本 `scripts/verify-file-size.mjs`：

- 扫描 `src/**/*.{ts,tsx}` 和 `src-tauri/src/**/*.rs`（排除生成文件、`*.css`）。
- 读取豁免清单 `scripts/file-size-exemptions.json`（数组：文件相对路径 + 目标行数 + 关联提案）。
- 清单外文件 > 500 行 → **fail**。
- 清单内文件 > 目标行数 → **warn**（提示还债，不阻断）。

初始豁免清单：

```json
[
  { "path": "src/App.tsx", "target": 500, "track": "clipboard-panel-split" },
  { "path": "src/settings.tsx", "target": 500, "track": "settings-interface-redesign" },
  { "path": "src/agent-panel.tsx", "target": 500, "track": "agent-panel-split" },
  { "path": "src/agent-chat-page.tsx", "target": 500, "track": "agent-panel-split" },
  { "path": "src-tauri/src/lib.rs", "target": 500, "track": "lib-rs-module-split" }
]
```

随每个拆分切片完成，把对应文件从豁免清单移除（或拆出的子文件天然 ≤500）。

## 3. 中文注释规范

- **必须有中文 doc**：`#[tauri::command]` 函数、Rust public struct/enum、public 函数签名、TS exported interface/type、React 组件 props 类型、复杂业务逻辑（写回抑制、面板定位、settings 合并、MCP dispatch）。
- **不必加注释**：明显的 getter/setter、CSS、纯样式常量、私有小工具函数（除非逻辑非平凡）。
- 注释风格对齐提案/设计文档（中文），与 `AGENTS.md` 一致。
- 不强制行内注释；优先函数级 doc 说明「做什么、为什么、边界」。

## 4. lib.rs 拆分顺序

目标结构（渐进迁移，每步可独立验证）：

```text
src-tauri/src/
  lib.rs              // 仅保留 app setup + generate_handler! + 模块声明
  settings/
    mod.rs            // SettingsService：get/patch/replace/reset + revision + redaction
    schema.rs         // settings_json_schema + 校验
    write.rs          // 原子写 + Mutex + temp/rename/fsync
    commands.rs       // settings_service_* Tauri command 适配层
    mcp.rs            // clipf.settings.* / clipf.agent.* MCP dispatch（复用 service）
  agent/
    mod.rs            // AgentProvider 解析 + provider_configs_with_readiness
    run.rs            // agent run 状态机 + child 进程管理
    commands.rs       // agent_* Tauri command
  clipboard/          // 已存在（payload/read/write/ingest/storage/watcher/detect）
  mcp/
    mod.rs            // run_mcp_stdio + call_mcp_tool dispatch 表
    tools.rs          // mcp_tool_specs 声明
  window/             // PanelPositionStrategy + show/hide/position
  log_service.rs      // 日志
```

切片顺序（每片独立 PR/提交）：

1. **settings 模块**（最高优先，服务 B3）：把 settings_service_* + schema + redaction + write 从 lib.rs 抽出。
2. **agent 模块**：agent_* + provider 解析 + run 状态机。
3. **mcp 模块**：run_mcp_stdio + call_mcp_tool + mcp_tool_specs。
4. **window / log / tray** 模块。
5. lib.rs 收敛到 setup + handler 注册 + 模块声明。

每个切片必须：移动代码不修改逻辑 → `cargo check` + `cargo fmt` → 跑 verify 脚本 → 提交。

## 5. 前端拆分顺序

目标按 surface 拆：

```text
src/
  settings/           // settings-interface-redesign 已规划（design.md §10）
    SettingsApp.tsx
    settings-model.ts
    settings-sections.ts
    components/...
  agent/              // agent-panel + agent-chat-page 拆分
    AgentPanel.tsx
    chat/...
    references/...
    parts/...         // MessageScroller / Attachment / ToolPreview
  clipboard/          // App.tsx 的快速面板部分
    QuickPanel.tsx
    list/...
    detail/...
```

切片顺序：

1. **settings 局部抽组件**（服务 Phase 3）：先把 settings.tsx 里的 SettingRow / 状态卡片 / Code 示例抽成独立组件，验证 verify-runtime-boundaries 仍通过。
2. **agent-panel 拆 parts**：MessageScroller / Attachment / ToolPreview / ReferencePicker 各自独立文件，升级 verify-agent-panel.mjs 为 data-marker 断言。
3. **App.tsx 按 surface 拆**：clipboard panel / detail / agent overlay 各自模块。

## 6. 样式拆分策略

- 不再向 `src/App.css` 单文件追加。新组件样式随组件拆：
  - 优先 `*.module.css`（Vite 原生支持，零运行时）。
  - 或按域拆 `src/<surface>/<surface>.css`（与现有 App.css/settings.css/agent 风格一致时）。
- 现有 App.css（已很大）按 surface 抽出时随组件迁移，不一次性重写。
- CSS 变量/语义 token 保持全局（在 `:root`），组件只消费。

## 7. verify 脚本升级方法

现状问题：`verify-agent-panel.mjs` 用 `app.includes("具体字符串")` 断言。组件一拆，源码字符串变化 → 误报。

升级策略（按成本递增）：

1. **data-marker 断言**（首选）：要求渲染输出含 `data-agent-message-id` / `data-message-scroller` 等 marker，脚本断言 marker 存在，不依赖源码子串。现状脚本已在用部分 marker（`data-message-scroller-item` 等），扩展即可。
2. **导出符号断言**：脚本 import 模块，断言导出存在（`assert(AgentMessageScroller != null)`）。需配合 `run-unit-checks.mjs` 的 tsc 编译模式。
3. **行为断言**：对纯函数（search-query / smart-format / plugin-actions / editor），用现有 `run-unit-checks.mjs` 模式跑真实输入输出断言。
4. **源码子串断言**（最后手段）：仅用于无法用前三种表达的不变量（如「某 CSS class 不应存在」反向断言），且必须注释说明为何脆弱。

升级优先级：先升级会被当前拆分触碰的脚本。

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 拆分引入行为回归（无测试框架 catch） | 每切片跑全部 verify 脚本 + cargo check + pnpm build；复杂逻辑拆分前先补 run-unit-checks 行为断言 |
| verify 脚本升级本身引入误判 | 升级前后对同一份代码各跑一次，确保升级是「等价或更强」 |
| 豁免清单变成长期债务 | 每个 PR 必须减少豁免或新增豁免需在 tasks.md 说明；清单写入 roadmap 定期 review |
| 拆分节奏拖慢功能线 | 优先做「解锁功能」的拆分（settings/agent 模块），纯整理性拆分排在功能之后 |
