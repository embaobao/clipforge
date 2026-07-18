# OpenSpec 提案路线图与交接计划

更新时间：2026-07-16

本文件用于把当前已归档提案、仍在推进的 active change、以及后续 Agent 的接手顺序分开管理。当前仓库状态以 `openspec list`、各 change 的 `tasks.md` 和主文档为准，不用历史聊天记录判断完成度。

## 前端架构基线

2026-07-16 新增 [`frontend-surface-architecture-refactor`](../openspec/changes/frontend-surface-architecture-refactor/proposal.md)，作为后续主面板、设置页、详情页、Agent 面板、路由拆分和样式系统重整的统一基线。

后续前端改动默认先对齐该提案：

- 业务功能区固定为快速剪贴板区、内容详情区、设置管理区、Agent 辅助区、系统状态区。
- 交互优先级固定为：剪贴板热路径 > 管理动作 > 详情辅助 > Agent 增强 > 设置诊断。
- 主面板布局固定为 `TopCommandBar / ModeBar / ClipboardList / StatusFeedback / OverlayLayer`。
- 设置页采用 Sidebar + Tabs + catalog-driven SettingsField + complex panel 插槽。
- 路由统一基于现有 `@tanstack/react-router`；路由用于 page/surface 边界和懒加载，不接管列表选中、滚动、复制等热路径状态。
- 样式按 `theme tokens` 和 surface scoped styles 拆分；禁止继续在 `src/App.css` 追加新的全局 `P-FINAL` 覆盖。
- 成熟组件优先使用 shadcn/Radix/Animate UI/lucide/floating-ui，不再手写并行基础控件。
- 项目默认组件参考知识库为 [`docs/COMPONENT_REFERENCE.md`](./COMPONENT_REFERENCE.md)，组件选型、shadcn CLI 使用、已安装组件和业务区映射默认以该文档为准。

### Superseded（方向被吸收，文档待 Phase 10 清理）

以下 change 的布局、交互和样式方向已由 `frontend-surface-architecture-refactor` 统一吸收，标记为 **superseded**（不是 archived：尚未归档，文档待 Phase 10 检查无引用后再删除或归档）。在此之前其任务语境仍可查，但不得作为新实现的依据：

| Change | 状态 | 被吸收方 |
| --- | --- | --- |
| `main-panel-functional-layout-plan` | superseded | `frontend-surface-architecture-refactor`（主面板区域契约 → 组件/目录拆分；已补 `tasks.md` 对齐真实代码） |
| `quick-panel-visual-regression-recovery` | superseded | `frontend-surface-architecture-refactor`（视觉回归修复 → 样式分层 + App.css 冻结） |
| `settings-sidebar-component-library-recovery` | superseded | `frontend-surface-architecture-refactor`（设置页 Sidebar 组件库壳层 → catalog-driven 字段渲染 + 复杂面板拆分） |

后续新实现一律以 active change 为准；确认吸收完成后，按 `frontend-surface-architecture-refactor` Phase 10 检查 `rg` 引用并删除或归档历史遗留文档，避免多个文档给出冲突定义。

## 已归档

以下 change 已归档，不再作为 active backlog：

| Change | 归档路径 | 说明 |
| --- | --- | --- |
| `context-plugin-agent-runtime` | `openspec/changes/archive/2026-07-15-context-plugin-agent-runtime/` | 已同步到 `openspec/specs/agent-runtime/spec.md`；本次归档使用 `--skip-specs`，因为 spec delta 已提前合入 |
| `search-filter-tags-filetypes` | `openspec/changes/archive/2026-07-14-search-filter-tags-filetypes/` | 已同步到 `openspec/specs/search-filters/spec.md` |
| `panel-interaction-upgrade` | `openspec/changes/archive/2026-07-14-panel-interaction-upgrade/` | 无 spec delta，按完成任务归档 |
| `github-release-update-distribution` | `openspec/changes/archive/2026-07-14-github-release-update-distribution/` | 无 spec delta，按完成任务归档 |
| `content-smart-format-decoder` | `openspec/changes/archive/2026-07-14-content-smart-format-decoder/` | 无 spec delta，按完成任务归档 |
| `settings-field-refactor` | `openspec/changes/archive/2026-07-15-settings-field-refactor/` | 已收敛为 `settings-interface-redesign` 的最小 `SettingFieldConfig` catalog 决策，并同步到 `openspec/specs/settings-registry/spec.md` |
| `remotion-animation-workbench` | `openspec/changes/archive/2026-07-15-remotion-animation-workbench/` | 已同步到 `openspec/specs/animation-workbench/spec.md`；独立 Remotion workspace、motion 转发脚本、双 composition、双语场景配置和 README 已完成 |

## 当前 active change

| 优先级 | Change | 当前进度 | 接手建议 |
| --- | --- | --- | --- |
| P0 | `settings-service-unified-protocol` | 77/79 | 先做。统一设置服务、MCP 设置协议、Agent provider 配置和 300ms 性能边界；Settings Service 模块拆分和热路径静态边界已完成，主面板已退回 legacy 设置写入且 hot-path / runtime boundary 脚本通过；debug-only repeat probe 已取得运行中 WebView `panel.open count=30/p95=63ms/max=63ms`、设置页 `settings.section count=30/p95=127ms/max=138ms/sourceCounts.fallback=30`，以及真实 Settings Service 写入后的 `settings.changed count=2/p95=122ms/max=122ms`；主面板打开、设置页切换和设置窗口接收 `settings_changed` 已通过。已新增受控 quick probe：`CLIPFORGE_DEV_TEXTEDIT_TARGET=1` / `CLIPFORGE_DEV_PASTE_TARGET=browser` 都带前台目标校验，且发系统 `Command+V` 前会二次确认目标仍 ready；本机直接 `open -a Safari/TextEdit` 后前台仍停在 Codex/ChatGPT，因此 quick paste 会安全 skip。剩余重点仍是真实 quick 选中/滚动/复制/粘贴 P95 和端到端主面板能力验证，需要人工置前受控输入目标或专用测试目标。 |
| P1 | `settings-interface-redesign` | 49/52 | 依赖 P0 的服务语义。设置页信息架构、语义控件、Code Tabs 基线、Tooltip、Status Panel、响应式和 i18n 基本完成；真实 `pnpm tauri dev` DOM probe 已验证设置窗口、Sidebar/Tabs、Toggle/Switch/Slider/Number 保存、Code Tabs 复制、Tooltip/Escape、诊断导出、清理日志和更新状态反馈。Context7 拉取 Animate UI Radix Sidebar / Code Tabs 仍因 quota 阻塞，硬编码扫描仍有 208 个候选未逐项收敛。 |
| P1.1 | `onboarding-to-settings-proposal` | 41/44 | 设置页引导、主面板旧引导移除、设置窗口 onboarding section 命令、App.css 清理和自动校验已完成；真实 `pnpm tauri dev` DOM probe 已验证五步切换、capture toggle 实时保存、`settings.changed p95=122ms`、完成态、设置页重开引导和菜单无 Onboarding 入口。剩余真实系统权限授权、重启后不再自动打开设置页、主面板历史/搜索/复制实机验证。 |
| P1.2 | `top-nav-optimization` | 28/30 | 顶部工具栏已承接 History / Favorites、搜索、Agent、状态和 Trash / Settings 菜单；底部 Dock 渲染、滚动隐藏状态和旧 Dock 专属样式已移除，`check:i18n`、`tsc`、Agent verifier 和 OpenSpec 已复跑通过；真实 DOM probe 已确认 toolbar、drag-region 属性、History/Favorites/Trash 切换、搜索/Agent/菜单可见、列表底部不被遮挡和快捷键可用。剩余真实窗口拖拽、搜索输入和按钮点击不触发拖拽需系统级证据。 |
| P2 | `app-internationalization-en-support` | 38/38 | 已完成。设置页中英文切换、默认跟随系统、重启后语言保持、Settings Service 语言 patch 后托盘菜单刷新、设置页英文和主面板英文布局均已通过真实 `pnpm tauri dev` probe；Rust native system locale 已在 macOS 下优先读取 `AppleLanguages` / `AppleLocale`，与 WebView `navigator.language` 对齐。 |
| P3 | `detail-rich-editor-agent-bridge` | 77/81 | 已补齐详情编辑器 `保存并复制` 入口，保存成功后使用 `save_editor_draft` 返回的当前 clip 走 `onCopy(postSaveClip)` 写回系统剪贴板路径，避免重新 capture 成新历史条目；`verify-editor-agent-bridge`、`pnpm test:unit`、`check:i18n` 和 OpenSpec 校验已复跑通过；剩详情编辑、保存、复制/粘贴链路真实 Tauri 验证。 |
| P3 | `file-image-clipboard-support` | 72/79 | `cargo test parses_png_dimensions`、`cargo test clipboard::write` 和 OpenSpec 校验已复跑通过；剩文本、HTML、图片、文件复制/展示/粘贴和磁盘清理手动验证。 |
| P3 | `clipboard-multi-format-fidelity` | 22/26 | `cargo test clipboard::write` 和 OpenSpec 校验已复跑通过；剩系统剪贴板 HTML/file/image 写回与监听去重实机验证。 |
| P3 | `clipboard-agent-panel` | 169/170 | Agent verifier 已同步 top-nav 后的新入口，并补强主面板 open/hide/toggle 原生路径不含 `agent_detect` / provider check 的静态断言；`CLIPFORGE_DEV_OPEN=panel CLIPFORGE_DEV_PERF_REPEAT=3 pnpm tauri dev` 已验证真实面板打开 `panel.open p95=64ms`，detect timeout 不影响面板定位/隐藏/再次唤起。剩 OpenAI-compatible provider 标准消息流真实 provider 验证。 |
| P1 | `frontend-surface-architecture-refactor` | Phase 0 完成 / Phase 1 进行中 | 作为前端整合开发基线，方案已确认。Phase 1 护栏已落地：4 个 surface 根 `data-surface` marker、`scripts/verify-surface-boundaries.mjs`（marker + App.css P-FINAL 不再增长）、App.css legacy 冻结 banner、`main-panel-functional-layout-plan/tasks.md`、3 个历史提案标记 superseded。下一步进 Phase B 主面板展示层拆分 / Phase E 设置页字段化。 |
| P4 | `ai-model-plugin-productization` | 65/76 | Phase 0 scope 已复审，Phase 2-8 文档级定义已完成：模型 provider/profile/policy、AIOutput、Tiptap 增强边界、Manifest V2、Agent capability、MCP 工具面、设置页映射和产品 capability gate 已收敛；Phase 1 仍受 Context7 quota 阻塞，Phase 9 仅完成边界/运行验证记录，不代表真实 SDK/provider/Tiptap 已接入。 |
| P4.1 | `vercel-ai-sdk-integration` | 30/38 | 已收敛为 P4.1 候选切片，proposal 中未确认版本/API 假设已降级为待 Context7 确认；`ClipAiSummary`、`ClipAiEmbedding/vectorRef`、AI job/provenance、非全量自动摘要、推荐候选范围和无 embedding store 降级策略已定义。详情页 AI 摘要区已支持 `VITE_CLIPFORGE_AI_MOCK=1` 本地 mock 摘要、pending/ready/failed 状态和重新生成；相似推荐已基于当前详情上下文候选、tags/host/format/source/关键词本地排序并复用详情跳转，不挤占主列表；摘要区现在还展示 key points、category、provider/model provenance 和 generatedAt。列表行已显示 `metadata.aiSummary` 状态图标，右键菜单已提供“生成 AI 摘要”入口并写回 metadata；AI 摘要日志已收敛为 metadata-only helper，不记录 prompt/output/正文/URL/API key。当前仍不安装或调用 Vercel AI SDK，真实 OpenAI-compatible provider 调用和 Tauri dev 验证仍未完成。 |
| P4.5 | `codebase-modularity-refactor` | 6/26 | 后置治理项，不作为近期多 Agent 功能开发主线；`test:unit` / file-size guard 已复跑通过，Agent 入口和 overlay 已补 `data-agent-*` 稳定 marker，verifier 已优先验证这些 marker，但完整 data-marker / 导出符号迁移和模块拆分仍后置。 |
`reference-projects-research` 和 `.archive` 当前没有任务，不计入实现队列。

## 推荐推进顺序

1. `settings-service-unified-protocol`
   - 建立 Rust `SettingsService` 作为单一设置服务。
   - 前端设置页和 MCP 共享同一服务协议，但前端走 Tauri command，外部 Agent 走 MCP tool。
   - 第一阶段禁止迁移主面板热路径。主面板打开、滚动、选中、复制/粘贴反馈必须保持 P95 <= 300ms。
   - 现有治理门禁保持生效，但不把治理脚本升级作为本阶段独立主线。

2. `settings-interface-redesign`
   - 在 P0 的 contract 稳定后重做设置页。
   - 采用侧边栏 + tab/section 的低噪声信息结构。
   - 表单项映射到 toggle group、segmented control、select、switch、slider 等具体控件，不再粗暴展示 JSON 或堆叠输入框。

3. 主界面减负组
   - `onboarding-to-settings-proposal` 先把首次引导迁移到设置窗口，保留主面板首屏的剪贴板热路径。
   - `top-nav-optimization` 再迁移底部 Dock 和菜单入口；如果 Onboarding 尚未迁移，不应先删除主面板菜单中的 Onboarding 入口。
   - 两者都必须继承 P0 的 300ms 热路径约束，不得新增启动时阻塞读取或网络检查。

4. 手动验证收尾组
   - `app-internationalization-en-support`
   - `file-image-clipboard-support`
   - `clipboard-multi-format-fidelity`
   - `detail-rich-editor-agent-bridge`
   - `clipboard-agent-panel`
   这些 change 多数已实现，优先补 Tauri dev 手动验证记录，再决定是否归档。

5. 战略扩展组
   - `ai-model-plugin-productization`
   - `vercel-ai-sdk-integration`
   需要先评估是否仍服务于“快速剪贴板工具”的主目标，避免把设置页和主面板变成 AI 控制台。

6. 后置治理组
   - `codebase-modularity-refactor`
   治理任务只在功能开发触碰对应文件时顺手推进；不单独占用近期多 Agent 功能开发资源。后续校验脚本和结构化 verifier 的规划放在功能主线稳定之后。

## Agent 分工建议

| Agent | 范围 | 验收 |
| --- | --- | --- |
| Agent A | `settings-service-unified-protocol` Rust service + Tauri commands | `openspec validate settings-service-unified-protocol --strict`、`cargo check`、主面板不新增 settings/provider 同步调用 |
| Agent B | `settings-interface-redesign` 前端设置页 | `pnpm build`、设置页交互 P95 <= 300ms、tooltip 文案策略不变 |
| Agent C | 剪贴板多格式和详情页手动验证 | Tauri dev 手动验证清单补齐，确认可归档项 |
| Agent D | i18n 收尾 | 中英文切换、系统默认、重启持久化、长文案不溢出 |
| Agent E | AI/plugin 产品化复审 | 先拆 scope 和依赖，不直接实现 |

多 Agent 执行规则：每个 Agent 完成后必须更新对应 `openspec/changes/<change>/tasks.md`，并同步 `docs/PROPOSAL_ROADMAP.md` / `openspec/project.md` 中的进度或阻塞状态；未完成的 GUI、Tauri dev、外部文档项不得勾选。

## 多 Agent 功能开发计划

本计划按功能交付优先，不把治理脚本作为近期独立开发 lane。所有 Agent 可以在独立 worktree 或子任务环境中开发，但最终必须由主协调者复核后合入 `main`，不得绕过当前主分支的脏树安全检查。

| Lane | 负责范围 | 可并行性 | 写入边界 | 完成定义 |
| --- | --- | --- | --- | --- |
| 主协调者 | 依赖排序、冲突复核、主分支集成、最终验证 | 常驻 | `docs/PROPOSAL_ROADMAP.md`、`openspec/project.md`、必要的集成修正 | 每轮合入前 `git status` / `openspec list` 清楚，合入后更新所有相关提案状态 |
| Agent A | `settings-service-unified-protocol` 剩余 GUI 验证和小修 | 第一优先，阻塞 P1 | `openspec/changes/settings-service-unified-protocol/tasks.md`，必要时 `src-tauri/src/settings_service.rs`、`src/services/settings.ts`、`src/settings.tsx` | 剩余 quick 选中/滚动/复制/粘贴 P95、主面板端到端能力能用 Tauri dev 证据证明；不能证明则记录阻塞，不勾选 |
| Agent B | `settings-interface-redesign` 设置页重构 | 依赖 Agent A 服务语义；Context7 恢复前只做不依赖外部 API 的信息架构准备 | `src/settings/`、`src/settings.tsx`、`src/settings.css`、对应 i18n key 和 tasks | 设置页结构、控件映射、状态反馈完成；`pnpm build` 和 OpenSpec validate 通过 |
| Agent C | `onboarding-to-settings-proposal` 与 `top-nav-optimization` | Agent B 之后；两者同一 Agent 串行更安全 | onboarding 写 `src/settings/` / settings command；top-nav 写 `src/App.tsx` / panel styles | 引导迁入设置页后再移除主面板 Onboarding；顶部导航不破坏搜索、复制、拖拽和快捷键 |
| Agent D | P2/P3 已实现能力收尾：i18n、file/image、多格式、详情桥、Agent panel | 可与 Agent B/C 并行，主要做验证和小修 | 对应 `tasks.md`、少量 bugfix 文件；不得重构主流程 | Tauri dev 手动验证补齐，能归档的提案归档，不能归档的列明缺口 |
| Agent E | AI/plugin 产品化复审 | 后置，不阻塞剪贴板主线 | `src/services/ai-summary.ts`、`src/workspace/ai-summary-panel.*`、对应 tasks；Context7 恢复前不写真实 SDK/provider 调用 | 已可展示 no-provider/SDK-pending 摘要状态；下一步等官方文档确认后再实现真实 SDK provider、摘要生成和推荐 |

执行节奏：

1. 先由 Agent A 收敛 P0；主协调者只在 P0 验证证据足够时更新状态。
   - hot-path guard 冲突已修复并复跑通过；设置窗口 `settings_changed` 已通过真实 Settings Service 写入探针验证。quick probe 已有 TextEdit / browser 两类受控目标保护，目标未 ready 时必须 skip；当前环境无法自动把 Safari/TextEdit 置前，归档 P0 前仍需补齐可信 quick 选中/滚动/复制/粘贴 P95 和主面板端到端能力证据，不能仅靠静态自动化、skip 样本或不安全前台目标采样归档。
2. Agent D 可并行处理 P2/P3 手动验证，不触碰 Agent B/C 的设置页和主导航写入范围。
3. Agent B 在 P0 语义稳定后进入设置页重构；如果 Context7 仍阻塞 Animate UI 文档，只推进信息架构和本地已 vendored 组件可验证部分。
4. Agent C 必须先做 onboarding，再做 top-nav，避免先删主面板入口导致引导无归宿。
5. 每个 Agent 的提交或补丁进入 `main` 前，必须完成两段复核：先对照对应 OpenSpec spec/tasks 做 spec compliance review，再做代码质量 review；有未解决 review 问题不得合入。
6. 每个 Agent 完成后必须更新：对应 `tasks.md`、`docs/PROPOSAL_ROADMAP.md`、`openspec/project.md`。若完成到可归档状态，主协调者负责 archive 和 `openspec validate --specs --strict`。

## 统一设置服务边界

设置页、MCP 设置工具和 Agent provider 配置必须收敛到同一个 Settings Service：

```text
Settings window ── Tauri command ┐
Agent config UI ── Tauri command ├── SettingsService ── settings file / schema / validation
External Agent ── MCP tools ─────┘
```

统一的是 Settings Service、JSON schema、revision、redaction、错误码、事件和写入策略。前端设置页不通过 MCP stdio 调本机服务；MCP 是外部 Agent 的协议入口。

主面板首批不迁移。以下路径不能同步等待 Settings Service、MCP、provider check 或 models：

- 全局快捷键触发到面板可交互。
- 快速列表滚动和选中态。
- 搜索和过滤当前面板内容。
- 复制、粘贴、写回和自动隐藏。

## 性能与校验要求

- 可见交互必须在 300ms 内给出反馈。网络 provider check、models、updater、诊断导出等异步任务不要求 300ms 完成，但必须在 300ms 内显示 pending/loading/error 状态。
- GUI 性能验收已补 `window.__clipforgePerf` 采样入口；在 `pnpm tauri dev` 中采样 `panel.open`、`quick.select`、`quick.scroll`、`quick.copy`、`quick.paste`、`settings.section`、`settings.changed` 后，用 `window.__clipforgePerf.summary()` 取 P95。
- 设置写入默认使用 patch。replace/reset 需要 `confirmed: true`，MCP 返回值必须包含修复提示。
- 所有设置写入必须带 revision 或返回新 revision，避免多个 Agent 同时写入时互相覆盖。
- MCP settings tools 默认推荐局部更新；全量 replace 只用于迁移、导入或用户明确确认。
- JSON schema 是设置协议的一部分，供 MCP 和前端表单生成/校验复用。

## 交接注意

- `settings-service-unified-protocol` 已抽出 `src-tauri/src/settings_service.rs`，后续 Agent 接手 P0 时可用 `CLIPFORGE_DEV_OPEN=panel|settings|settings:onboarding pnpm tauri dev` 直接打开目标窗口做 GUI/P95 采样；当前 `panel` 已通过 `CLIPFORGE_DEV_PERF_REPEAT=30` 取得 `panel.open count=30/p95=63ms/max=63ms`，`settings` 已取得 `settings.section count=30/p95=127ms/max=138ms/sourceCounts.fallback=30`，并通过 `CLIPFORGE_DEV_SETTINGS_CHANGED_PROBE=1` 取得真实写入后的 `settings.changed count=2/p95=122ms/max=122ms`。`CLIPFORGE_DEV_QUICK_PROBE=1` 必须配合受控粘贴目标：`CLIPFORGE_DEV_TEXTEDIT_TARGET=1` 需要 TextEdit 临时文档 ready；`CLIPFORGE_DEV_PASTE_TARGET=browser` 默认打开 Safari 临时 `textarea`；原生 paste 在发 `Command+V` 前会二次确认目标仍 ready 且仍是预期前台应用。当前本机 TextEdit 超时、Safari 未能自动置前台，均已安全 skip；不可把不安全前台目标或 skip 样本当作 quick P95 / 端到端完成证据。
- `detail-rich-editor-agent-bridge` 已补 `保存并复制` UI，并复用保存后的当前 clip 走 `onCopy(postSaveClip)` 写回路径，后续只差真实系统剪贴板证据，不要再把该项误判为缺入口或误接到 `copyText` 新建历史路径。
- `src/App.css` 已包含快速列表选中态双边框修复，后续不要再用额外 animated pseudo-frame 叠加选中边框。
- 仓库中存在品牌图标、Agent 面板和 workbench 相关改动；提交前必须用 `git status --short` 复核当前树，不要误删用户已有产物。
