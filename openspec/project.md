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

> 2026-10-01:推进顺序与波次归位由 [product-iteration-master-plan](./changes/product-iteration-master-plan/proposal.md) 单点解释;下表状态列为摘要,进度以 `openspec list` 实数为准。旧 AI 侧车三提案已归档,不再列入。

| 提案 | 波次 | 状态 | 说明 |
|------|------|------|------|
| [file-image-clipboard-support](./changes/file-image-clipboard-support/proposal.md) | W1 | P3 收尾，75/83 | 格式支持基础层：图片、文件、HTML/RTF 富文本剪贴板历史；剩余真实复制/展示/粘贴和磁盘清理实机验证 |
| [clipboard-multi-format-fidelity](./changes/clipboard-multi-format-fidelity/proposal.md) | W1 | P3 收尾，22/26 | 格式保真层：多 representation、纯文本降级和回写验证矩阵；剩余系统剪贴板写回与监听去重实机验证 |
| [onboarding-standalone-page](./changes/onboarding-standalone-page/proposal.md) | W1 | P1.x 收尾，25/52 | 独立引导窗口、权限检查、开机启动已落地;仍需真实 Tauri 验证托盘/快捷键不阻塞、完成/跳过链路、P95 与日志边界 |
| [tailwind-v3-style-refactor](./changes/tailwind-v3-style-refactor/proposal.md) | W1 | 收尾，21/25 | v3 视觉重构;剩盟哥三 surface 人工走查 + 走查修复(旧 AI 面板 iframe 细节项已作废) |
| (W2 未开工,见总纲) | W2 | — | 基于 `clip_semantic_index`(SQLite local-keyword 已建)的语义检索,本地索引优先,先服务 pi/MCP 工具面 |
| [pi-sdk-agent-foundation](./changes/pi-sdk-agent-foundation/proposal.md) | W3 | P1 主体，21/26 | pi sdk Agent 基座:旧 AI 侧车删除完成、L1 分析/历史/工具面落地;剩 API Key redaction/keyRef、provider 极简 UI、智能标签建议、Phase 4 验收 |
| [ai-model-plugin-productization](./changes/ai-model-plugin-productization/proposal.md) | W3 | P4 复审中，65/76 | scope 复审后按 L1/L2 归位并入 pi 线;Context7 恢复前不进 SDK/Tiptap 实现 |
| [vercel-ai-sdk-integration](./changes/vercel-ai-sdk-integration/proposal.md) | W4 | P4.1 后置，30/38 | AI 产品化后候选切片,与 mastra/local-model 三案统一取舍,结论前不动 |
| [mastra-agent-runtime-evaluation](./changes/mastra-agent-runtime-evaluation/proposal.md) | W4 | P4.x 评估，11/25 | runtime 候选评估,不装依赖不进热路径;随 W4 统一取舍 |
| [local-model-quick-integration](./changes/local-model-quick-integration/proposal.md) | W4 | P4.x 候选，4/16 | 本地模型/Key 导入候选;随 W4 统一取舍 |
| [external-hook-plugin-runtime](./changes/external-hook-plugin-runtime/proposal.md) | W4 | P3 评审，0/67 | Block A 读取侧可推进;Block B 写入侧冻结 |
| [codebase-modularity-refactor](./changes/codebase-modularity-refactor/proposal.md) | W5 | P4.5 治理，11/26 | 随功能触碰渐进;file-size 门禁与豁免清单只减不增 |
| [framer-motion-adoption-eval](./changes/framer-motion-adoption-eval/proposal.md) | W5 | dormant | 按信号表触发(退出动画组件变多/共享元素/手势/复杂编排),当前均未出现 |
| [project-demo-gif-pipeline](./changes/project-demo-gif-pipeline/proposal.md) | W5 | P3 方案，0/30 | W1 稳定后录制;录屏转 gif 为主、Remotion 为辅 |

已完成待归档:`interaction-animation-polish`(25/25,走归档流程)。其余已归档提案见 [PROPOSAL_ROADMAP](../docs/PROPOSAL_ROADMAP.md)「已归档」节与 `openspec/changes/archive/`。

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
- `2026-08-05-settings-sidebar-component-library-recovery` — 归档时 14/14；设置页 Sidebar 组件库恢复，spec 并入 `specs/settings-interface`
- `2026-08-05-main-panel-functional-layout-plan` — 归档时 11/37；被统一前端架构吸收，使用 `--skip-specs`，剩余拆分与验收任务转入 `frontend-surface-architecture-refactor`
- `2026-08-05-quick-panel-visual-regression-recovery` — 归档时 22/30；被统一前端架构吸收，使用 `--skip-specs`，剩余选中/滚动/复制/粘贴交互与性能验收转入 `frontend-surface-architecture-refactor`

## 建议推进顺序

> 2026-09-02 方向调整：产品主线回归「打造好一个剪贴板」。近期只推进剪贴板核心体验（格式闭环实机验收、归档）、首次引导和实机验收；旧 AI 面板仅保留 iframe 实验形态、全链后置；AI/Agent 运行时四案维持统一评估，不直接进入产品热路径，取舍结论前不新增依赖。

1. P0：联合收尾 [onboarding-standalone-page](./changes/onboarding-standalone-page/proposal.md) 与 [frontend-surface-architecture-refactor](./changes/frontend-surface-architecture-refactor/proposal.md)，验证正式应用的开机启动、权限引导、虚线选中态、滚动跟随和复制/粘贴 P95。
2. P1：完成 [file-image-clipboard-support](./changes/file-image-clipboard-support/proposal.md) 与 [clipboard-multi-format-fidelity](./changes/clipboard-multi-format-fidelity/proposal.md) 的文本、HTML、图片、文件实机矩阵。
3. P2：交互基线固定后继续前端 surface 拆分；`external-hook-plugin-runtime` 只推进读取侧 Block A，写入侧继续冻结。
4. P4：统一复审 `ai-model-plugin-productization`、`vercel-ai-sdk-integration`、`local-model-quick-integration` 和 `mastra-agent-runtime-evaluation`，先形成 runtime 取舍结论，再决定是否进入 POC 或实现。
5. P3/P4.5：核心体验稳定后再推进演示 GIF；模块化治理随触碰文件渐进完成，不单独阻塞功能交付。
