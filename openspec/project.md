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

## 活跃提案

| 提案 | 状态 | 说明 |
|------|------|------|
| [github-release-update-distribution](./changes/github-release-update-distribution/proposal.md) | P0 提案中 | 先补齐 GitHub Releases 分发、版本检查、签名更新、失败回滚和本地更新状态 |
| [app-internationalization-en-support](./changes/app-internationalization-en-support/proposal.md) | P0.5 提案中 | 添加基础国际化能力，支持中文/英文切换，并为公开分发前的用户可见文案建立 key 与检查流程 |
| [settings-service-unified-protocol](./changes/settings-service-unified-protocol/proposal.md) | P0.65 提案中 | 收敛设置页、MCP 和 Agent 配置到统一 Settings Service，提供 schema、patch、replace/reset 保护、事件和 provider 能力 |
| [settings-interface-redesign](./changes/settings-interface-redesign/proposal.md) | P0.7 提案中 | 优化设置页信息架构、Sidebar、Tabs、Code Tabs、Tooltip 和表单控件映射，让配置交互符合桌面工具标准 |
| [file-image-clipboard-support](./changes/file-image-clipboard-support/proposal.md) | P1 待实现 | 格式支持基础层：引入 clipboard-rs，支持图片、文件、HTML/RTF 富文本剪贴板历史 |
| [clipboard-multi-format-fidelity](./changes/clipboard-multi-format-fidelity/proposal.md) | P1 提案中 | 格式支持保真层：补齐 HTML/RTF/图片/文件的多 representation、纯文本降级和回写验证矩阵 |
| [search-filter-tags-filetypes](./changes/search-filter-tags-filetypes/proposal.md) | P2 提案中 | 搜索增强依托前面的格式字段，支持 `tag:`、`#tag`、`type:`、`file:`、`kind:`、`bucket:` 等结构化筛选 |
| [content-smart-format-decoder](./changes/content-smart-format-decoder/proposal.md) | P3 小功能提案 | 智能识别代码、JSON、URL/Base64/JWT/Unicode/HTML entity，并提供格式化、补齐和解码动作 |
| [context-plugin-agent-runtime](./changes/context-plugin-agent-runtime/proposal.md) | 提案中 | 上下文快照、插件边界、Agent 智能建议反吐、AG-UI 桥、MCP 工具面与自动升级能力 |
| [detail-rich-editor-agent-bridge](./changes/detail-rich-editor-agent-bridge/proposal.md) | 提案中 | 详情页紧凑编辑、tag 快速编辑、`#tag` 建议、AI 建议回填、后续 Tiptap 富文本编辑 |
| [clipboard-agent-panel](./changes/clipboard-agent-panel/proposal.md) | P4 提案中 | 悬浮面板内 Agent 工作页：用剪贴板上下文集合、私域 skill 和受控工具完成分析、管理与结果回填 |
| [ai-model-plugin-productization](./changes/ai-model-plugin-productization/proposal.md) | P4.5/P5 讨论中 | 规划模型配置、Tiptap AI Toolkit、详情页 AI 增强、Agent 插件化、插件体系 V2 和 AI 能力标品化 |

## 建议推进顺序

1. P0：先完成 [github-release-update-distribution](./changes/github-release-update-distribution/proposal.md)，让后续功能有稳定分发、检查升级和回滚基础。
2. P0.5：公开分发前完成 [app-internationalization-en-support](./changes/app-internationalization-en-support/proposal.md)，支持英文并建立新增文案收口流程。
3. P0.65：先完成 [settings-service-unified-protocol](./changes/settings-service-unified-protocol/proposal.md) 的第一阶段，让设置窗口和 MCP 共享统一 Settings Service；首批不迁移主面板，避免影响现有快速面板能力。
4. P0.7：完成 [settings-interface-redesign](./changes/settings-interface-redesign/proposal.md)，让公开分发前的偏好设置、更新、MCP 接入和诊断入口具备稳定、可解释的交互。
5. P1：再完成格式支持，先落 [file-image-clipboard-support](./changes/file-image-clipboard-support/proposal.md)，再补 [clipboard-multi-format-fidelity](./changes/clipboard-multi-format-fidelity/proposal.md)。
6. P2：搜索增强依托格式字段推进，完成 [search-filter-tags-filetypes](./changes/search-filter-tags-filetypes/proposal.md)，其中 `#tag` 与详情页 tag 跳转可先用现有 tags 字段铺垫。
7. P3：最后做 [content-smart-format-decoder](./changes/content-smart-format-decoder/proposal.md)，按 JSON 格式化/补齐和常用解码小功能逐步交付。
8. P4：在上下文快照、智能解析和详情页回填边界稳定后，再推进 [clipboard-agent-panel](./changes/clipboard-agent-panel/proposal.md)，只做 Agent 调用服务，不做 Agent 管理平台。
9. P4.5/P5：完成 [ai-model-plugin-productization](./changes/ai-model-plugin-productization/proposal.md) 的方案评审，确认配置好模型后的默认 AI 能力、Agent 插件化原则、Tiptap AI Toolkit 边界和标品化分层后，再拆实现提案。
