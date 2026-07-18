# ClipForge 项目说明

## 目标

建设一个跨平台剪贴板工具，第一阶段完整覆盖 Clipy 的剪贴板历史、复制回写、片段、文件夹和快速唤起；后续再提供搜索增强、归档、语义检索和 MCP 工具接口。

## 当前范围

- Tauri v2 + React + TypeScript 应用骨架
- 原生文本剪贴板读取与写入
- 快速粘贴主入口
- 即时搜索
- 历史、归档、片段视图
- 收藏、复制、归档、删除、全选当前结果删除
- 后续 MCP 标准工具接口
- 图片、文件、富文本剪贴板历史（已立项，见 [file-image-clipboard-support](./changes/file-image-clipboard-support/proposal.md)）

## 非目标

- 第一阶段优先实现 Clipy 等价能力，但快速菜单可以先用窗口内面板模拟，后续再接原生菜单/托盘。
- 不在第一阶段实现系统级粘贴模拟；复制回系统剪贴板优先，粘贴由用户或后续快捷键模块触发。
- 不在第一阶段接入远程云同步。

## 架构原则

- 快速菜单负责高频粘贴，窗口负责搜索和整理，托盘和快捷键负责唤起。
- 原生能力收敛在 Rust command 层，前端通过稳定命令调用。
- 数据层先保持轻量，后续以 SQLite 和本地向量索引替换 localStorage。
- MCP 作为标准工具接口暴露，不和 UI 状态强耦合。
- 前端 UI 按业务 surface 组织（clipboard / settings / workspace / agent / status），每个 surface 根节点带 `data-surface` 身份 marker，新增样式按 surface 归档，不再向 `src/App.css` 追加全局覆盖（由 `scripts/verify-surface-boundaries.mjs` 守护，见 [frontend-surface-architecture-refactor](./changes/frontend-surface-architecture-refactor/design.md)）。

## 活跃提案

| 提案 | 状态 | 说明 |
|------|------|------|
| [frontend-surface-architecture-refactor](./changes/frontend-surface-architecture-refactor/proposal.md) | P1 Phase 1 护栏进行中 | 前端 Surface 架构、路由拆分、业务功能区、主要页面布局、交互契约、主题样式分层和历史提案收口基线。Phase 1 护栏已落地：4 个 surface 根 `data-surface` marker、`scripts/verify-surface-boundaries.mjs`、App.css legacy 冻结、`main-panel-functional-layout-plan/tasks.md`、3 个历史提案标记 superseded。后续主面板、设置页、详情页、Agent 面板整合开发先对齐该提案 |
| [file-image-clipboard-support](./changes/file-image-clipboard-support/proposal.md) | P3 收尾，72/79 | 格式支持基础层：图片、文件、HTML/RTF 富文本剪贴板历史；`parses_png_dimensions`、`clipboard::write` 和 OpenSpec 校验已复跑通过，剩余真实复制/展示/粘贴和清理验证 |
| [clipboard-multi-format-fidelity](./changes/clipboard-multi-format-fidelity/proposal.md) | P3 收尾，22/26 | 格式支持保真层：补齐 HTML/RTF/图片/文件的多 representation、纯文本降级和回写验证矩阵；`clipboard::write` 和 OpenSpec 校验已复跑通过，剩余系统剪贴板写回与监听去重实机验证 |
| [ai-model-plugin-productization](./changes/ai-model-plugin-productization/proposal.md) | P4 讨论中，65/76 | Phase 0 scope 已复审，Phase 2-8 文档级定义已完成：模型 provider/profile/policy、AIOutput、Tiptap 增强边界、Manifest V2、Agent capability、MCP 工具面、设置页映射和产品 capability gate 已收敛；Context7 恢复前不进入 SDK/Tiptap 实现，Phase 9 仅保留边界/运行验证记录，不代表真实 SDK/provider/Tiptap 已接入 |
| [vercel-ai-sdk-integration](./changes/vercel-ai-sdk-integration/proposal.md) | P4.1 后置进行中，30/38 | 已收敛为 AI 产品化后的候选切片，未确认版本/API 假设已降级为待 Context7 确认；摘要/embedding/job/provenance、非全量自动摘要、推荐候选范围和无 embedding store 降级策略已定义。已新增详情页 AI 摘要区和 `ai-summary` 服务边界，支持 `VITE_CLIPFORGE_AI_MOCK=1` 本地 mock 摘要、pending/ready/failed 状态、重新生成和当前详情上下文内的本地相似推荐；摘要区现在还展示 key points、category、provider/model provenance 和 generatedAt。列表行已显示 `metadata.aiSummary` 状态图标，右键菜单已提供“生成 AI 摘要”入口并写回 metadata；AI 摘要日志已收敛为 metadata-only helper，不记录 prompt/output/正文/URL/API key。Context7 quota 恢复前仍不能确认真实 SDK API、版本或安装命令，真实 OpenAI-compatible provider 调用和 Tauri dev 验证尚未实现 |
| [codebase-modularity-refactor](./changes/codebase-modularity-refactor/proposal.md) | P4.5 后置治理，6/26 | 约束单文件规模、中文注释和按域拆分；`test:unit` / file-size guard 已复跑通过，Agent 入口和 overlay 已补 `data-agent-*` 稳定 marker，verifier 已优先验证这些 marker，但完整 verifier 结构化迁移和模块拆分仍后置，近期多 Agent 资源优先投向功能开发 |

## 已归档提案

以下 change 已归档，后续只看归档 spec 或 archive 记录，不再当作 active backlog：

- `github-release-update-distribution`
- `settings-field-refactor`
- `search-filter-tags-filetypes`
- `content-smart-format-decoder`
- `panel-interaction-upgrade`
- `context-plugin-agent-runtime`
- `remotion-animation-workbench`
- `2026-07-16-app-internationalization-en-support` — 归档时 38/38（全完成）；国际化与英文支持，spec 并入 `specs/internationalization`
- `2026-07-16-settings-service-unified-protocol` — 归档时 77/79；统一 Settings Service，spec 并入 `specs/settings-service`；剩余 2 项（主面板性能 smoke P95、主面板回归）移出 backlog
- `2026-07-16-settings-interface-redesign` — 归档时 50/52；设置页信息架构重写，spec 并入 `specs/settings-ui`；剩余 2 项（Context7 拉 Radix Sidebar / Code Tabs 文档、硬编码文案白名单 208 候选）移出 backlog
- `2026-07-16-onboarding-to-settings-proposal` — 归档时 41/44；引导迁设置窗，spec 并入 `specs/onboarding`；剩余 3 项（系统权限授权、重启门禁、主面板历史/搜索/复制实机验证）移出 backlog
- `2026-07-16-top-nav-optimization` — 归档时 28/30；顶部工具栏，spec 并入 `specs/panel-navigation`；剩余 2 项（窗口拖拽、搜索/按钮点击不触发拖拽系统级证据）移出 backlog
- `2026-07-16-clipboard-agent-panel` — 归档时 169/170；面板内 Agent 工作页，spec 并入 `specs/agent-panel`；剩余 1 项（真实 OpenAI-compatible provider 标准消息流验证）移出 backlog
- `2026-07-16-detail-rich-editor-agent-bridge` — 归档时 77/81；详情页紧凑编辑器，spec 并入 `specs/detail-editor`；剩余 4 项（文本编辑保存、Markdown 取消不丢预览、保存并复制写回、保存并粘贴复用链路实机验证）移出 backlog

## 建议推进顺序

> 2026-07-16 已归档 settings-service-unified-protocol、settings-interface-redesign、onboarding-to-settings-proposal、top-nav-optimization、clipboard-agent-panel、detail-rich-editor-agent-bridge、app-internationalization-en-support 七个提案（实现基本完成，剩余仅实机验证项，详见「已归档提案」每条的剩余说明）。原 P0 / P1 / P1.1 / P1.2 / P2 推进顺序随归档作废，backlog 收敛为下列 4 项。

1. P1：确认 [frontend-surface-architecture-refactor](./changes/frontend-surface-architecture-refactor/proposal.md)，把主面板、详情、设置、Agent、系统状态反馈的布局和交互定义固定下来，后续开发不再回到多个历史提案反复改。
2. P3：完成已实现能力的手动验证收尾，优先处理 [file-image-clipboard-support](./changes/file-image-clipboard-support/proposal.md) 与 [clipboard-multi-format-fidelity](./changes/clipboard-multi-format-fidelity/proposal.md)（图片 / 文件 / HTML 多格式写回与监听去重实机验证）。
3. P4：先复审 [ai-model-plugin-productization](./changes/ai-model-plugin-productization/proposal.md) 的 scope，再决定哪些 AI 能力进入主线。
4. P4.1：Context7 额度恢复后再评审 [vercel-ai-sdk-integration](./changes/vercel-ai-sdk-integration/proposal.md)，确认 AI SDK 接入边界后再决定是否并入 `ai-model-plugin-productization`。
5. P4.5：后置处理 [codebase-modularity-refactor](./changes/codebase-modularity-refactor/proposal.md) 的校验脚本与模块化规划；仅在功能开发触碰对应文件时同步推进。
