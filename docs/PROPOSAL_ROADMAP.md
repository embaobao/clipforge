# OpenSpec 提案路线图与交接计划

更新时间：2026-07-14

本文件用于把当前已归档提案、仍在推进的 active change、以及后续 Agent 的接手顺序分开管理。当前仓库状态以 `openspec list`、各 change 的 `tasks.md` 和主文档为准，不用历史聊天记录判断完成度。

## 已归档

以下 change 已在 2026-07-14 归档，不再作为 active backlog：

| Change | 归档路径 | 说明 |
| --- | --- | --- |
| `context-plugin-agent-runtime` | `openspec/changes/archive/2026-07-14-context-plugin-agent-runtime/` | 已同步到 `openspec/specs/agent-runtime/spec.md` |
| `search-filter-tags-filetypes` | `openspec/changes/archive/2026-07-14-search-filter-tags-filetypes/` | 已同步到 `openspec/specs/search-filters/spec.md` |
| `panel-interaction-upgrade` | `openspec/changes/archive/2026-07-14-panel-interaction-upgrade/` | 无 spec delta，按完成任务归档 |
| `github-release-update-distribution` | `openspec/changes/archive/2026-07-14-github-release-update-distribution/` | 无 spec delta，按完成任务归档 |
| `content-smart-format-decoder` | `openspec/changes/archive/2026-07-14-content-smart-format-decoder/` | 无 spec delta，按完成任务归档 |

## 当前 active change

| 优先级 | Change | 当前进度 | 接手建议 |
| --- | --- | --- | --- |
| P0 | `settings-service-unified-protocol` | 0/79 | 先做。统一设置服务、MCP 设置协议、Agent provider 配置和 300ms 性能边界。 |
| P1 | `settings-interface-redesign` | 0/47 | 依赖 P0 的服务语义。只重做设置页，不改主面板。 |
| P2 | `app-internationalization-en-support` | 31/38 | 主要剩 UI 长文案和 Tauri dev 手动验证。 |
| P3 | `detail-rich-editor-agent-bridge` | 77/81 | 剩详情编辑、保存、复制/粘贴链路手动验证。 |
| P3 | `file-image-clipboard-support` | 72/79 | 剩文本、HTML、图片、文件复制/展示/粘贴和磁盘清理手动验证。 |
| P3 | `clipboard-multi-format-fidelity` | 22/26 | 与文件/图片剪贴板能力联动验证。 |
| P3 | `clipboard-agent-panel` | 168/170 | 剩 provider 标准流式消息和 detect timeout 不影响面板定位/隐藏验证。 |
| P4 | `ai-model-plugin-productization` | 0/76 | 先重新审 scope，不建议在设置服务稳定前实现。 |
| P5 | `remotion-animation-workbench` | 0/10 | 独立 workbench，不阻塞 ClipForge 主流程。 |

`reference-projects-research` 和 `.archive` 当前没有任务，不计入实现队列。

## 推荐推进顺序

1. `settings-service-unified-protocol`
   - 建立 Rust `SettingsService` 作为单一设置服务。
   - 前端设置页和 MCP 共享同一服务协议，但前端走 Tauri command，外部 Agent 走 MCP tool。
   - 第一阶段禁止迁移主面板热路径。主面板打开、滚动、选中、复制/粘贴反馈必须保持 P95 <= 300ms。

2. `settings-interface-redesign`
   - 在 P0 的 contract 稳定后重做设置页。
   - 采用侧边栏 + tab/section 的低噪声信息结构。
   - 表单项映射到 toggle group、segmented control、select、switch、slider 等具体控件，不再粗暴展示 JSON 或堆叠输入框。

3. 手动验证收尾组
   - `app-internationalization-en-support`
   - `file-image-clipboard-support`
   - `clipboard-multi-format-fidelity`
   - `detail-rich-editor-agent-bridge`
   - `clipboard-agent-panel`
   这些 change 多数已实现，优先补 Tauri dev 手动验证记录，再决定是否归档。

4. 战略扩展组
   - `ai-model-plugin-productization`
   - `remotion-animation-workbench`
   需要先评估是否仍服务于“快速剪贴板工具”的主目标，避免把设置页和主面板变成 AI 控制台。

## Agent 分工建议

| Agent | 范围 | 验收 |
| --- | --- | --- |
| Agent A | `settings-service-unified-protocol` Rust service + Tauri commands | `openspec validate settings-service-unified-protocol --strict`、`cargo check`、主面板不新增 settings/provider 同步调用 |
| Agent B | `settings-interface-redesign` 前端设置页 | `pnpm build`、设置页交互 P95 <= 300ms、tooltip 文案策略不变 |
| Agent C | 剪贴板多格式和详情页手动验证 | Tauri dev 手动验证清单补齐，确认可归档项 |
| Agent D | i18n 收尾 | 中英文切换、系统默认、重启持久化、长文案不溢出 |
| Agent E | AI/plugin 产品化复审 | 先拆 scope 和依赖，不直接实现 |

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
- 设置写入默认使用 patch。replace/reset 需要 `confirmed: true`，MCP 返回值必须包含修复提示。
- 所有设置写入必须带 revision 或返回新 revision，避免多个 Agent 同时写入时互相覆盖。
- MCP settings tools 默认推荐局部更新；全量 replace 只用于迁移、导入或用户明确确认。
- JSON schema 是设置协议的一部分，供 MCP 和前端表单生成/校验复用。

## 交接注意

- `src-tauri/src/lib.rs` 当前包含设置服务方向的 WIP 代码，后续 Agent 接手 P0 时需要先整理成独立模块并注册命令，不要把半成品当作已完成服务。
- `src/App.css` 已包含快速列表选中态双边框修复，后续不要再用额外 animated pseudo-frame 叠加选中边框。
- 仓库中存在品牌图标、Agent 面板和 workbench 相关改动；提交前必须用 `git status --short` 复核当前树，不要误删用户已有产物。
