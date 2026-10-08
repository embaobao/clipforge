# 任务：pi sdk 作为 ClipForge Agent 能力基础

> 状态（2026-09-30 对账恢复）：本文件曾在 `2ebd9f5` 被误覆盖为视觉重构交接摘要副本（0 个任务项，真身见 `1aa5cd1`），已自 `1aa5cd1` 恢复结构并按代码现状逐项对账。对账证据：前端 `src/` grep 零旧 AI 侧车残留、`src-tauri/tauri.conf.json` 零旧 AI 窗口、`src/agent/pi/` 五模块在位（agent/analysis/analysis-history/provider-config/stream/tools）。

## Phase 0：方向确认与调研 ✅

- [x] pi sdk 调研：github.com/earendil-works/pi，npm `@mariozechner/pi-coding-agent`，统一 LLM API + 可编程 SDK + 工具调用 + 会话管理
- [x] 盟哥拍板：pi 确立为 Agent 能力基础，旧 AI 侧车全链废弃（2026-09-11，`a020068`）
- [x] Phase 0 细化：锁定 pi-ai/pi-agent-core@0.73.1（MIT），SDK 子包形态确认（@mariozechner/pi-ai 统一 LLM API：getModel/completeSimple/stream）；最小依赖面 = 两个库包（不引 pi-coding-agent CLI 的 TUI 依赖栈）

## Phase 1：旧 AI 侧车全量删除（先删后建，避免双 Agent 链并存）✅

### 1a. 前端
- [x] 删除旧 AI 面板前端目录与独立入口（含 vite 多页面配置与 tauri 窗口）--批次 36（`6275653`，-528 行）；vite input 现仅 devPasteTarget/main/onboarding/preview/settings 五入口
- [x] 删/清旧 AI 分析与守护进程服务层（前端 agent 服务文件）--随 `6275653`
- [x] 清引用链：剪贴板写回 hook 的 AI 分析调用、键盘/顶栏的打开旧 AI 面板回调、面板 surface 类型的旧 AI 成员、右键菜单「AI 分析」入口（暂禁用或接占位）--AI 入口由 Phase 2 PiAnalysisBar 恢复
- [x] 删旧 AI 侧车设置项与相关 data-dev-probe

### 1b. Rust
- [x] 删 Rust 守护进程模块（spawn/kill/健康探活/命令，484 行）--批次 37/38（`d7c7bd2`/`8fc1dcb`，-553 行）
- [x] lib.rs：删旧 AI 侧车命令注册、spawn/kill 调用、模块声明
- [x] tauri.conf.json：删旧 AI 窗口配置（窗口 4→3）

### 1c. 验证与文档
- [x] 每删一层 `pnpm build:web` / `cargo check` + grep 复查无残留引用；verify 脚本旧 AI 侧车断言随迁/删除
- [x] 全套验证 + CLIPFORGE_DISABLE_CAPTURE=1 冒烟
- [x] 旧 AI 侧车三提案归档（deepseek-harness-embedding 与两份衍生提案，--skip-specs）+ ROADMAP 更新--`0c694e7`，archive/2026-09-11-*
- [x] 收尾补刀（2026-09-30）：lib.rs `show_floating_window_by_label` 文档注释残留「旧 AI 面板复用…指定 label」已改为按 label 泛化表述（grep 兜底发现的最后一处文档残留）

## Phase 2：pi sdk 最小集成 ✅（剩 API Key 边界与 provider UI 两项）

- [x] 引入依赖并封装 `src/agent/pi/` 适配层（provider-config.ts：AgentProviderConfig 映射 + piComplete 最小补全封装；tsc 真实校验 pi-ai 类型兼容）--批次 39（`d36145b`）
- [x] pi-ai API 对接补全：stream 流式调用--批次 45 尾项（`a9fa1ce`，src/agent/pi/stream.ts）
- [x] 工具注册--批次 41（`085afa1`，src/agent/pi/tools.ts）：落地为 `clipboard_search`（只读检索历史）+ `clipboard_read_latest`（读最新一条，等价 search limit=1 快捷形态）；原计划的 clipboard.read(指定条目) 语义由 read_latest 覆盖首版，按 id 读取待后续工具面扩展
- [x] 会话装配：createClipForgeAgent（`085afa1`，agent.ts，系统提示词声明剪贴板助手角色）
- [x] 详情页「AI 分析」与右键菜单入口切换到 pi 底层（保持现有交互与状态栏文案结构）--PiAnalysisBar 自包含组件
- [ ] API Key 走 settings 的 redaction/keyRef 机制，不落盘前端--待办：provider-config.ts 现无 keyRef/redact 路径，需对接 settings-service 既有 redaction 机制
- [ ] provider 配置 UI：设置页 MCP/Agent 块的 provider 表单对接--待办：现仅 `getConfiguredAgentProviderCount` 计数摘要（AgentUpdateTagSections），无增删改表单；`cf4c121` 已确认现状

## Phase 3：产品功能点 🟡（1/3）

- [x] 条目 AI 分析与摘要（替代旧 AI 侧车 clipboard_analyze 能力）--PiAnalysisBar + analysis.ts，详情页入口恢复
- [ ] 智能标签建议（分析结果 → 标签应用，沿用 onApplyTags/onApplyFolder 通道）--待办：PiAnalysisBar 现无 tagPatch→onApplyTags 接线
- [x] 分析历史（本地持久化，替代旧 AI 侧车历史）--`32c1e9e`：analysis-history.ts（localStorage 上限 20 条裁剪、异常静默），PiAnalysisBar 成功后记录并展示最近 3 条

## Phase 4：验证与收尾 🟡

- [ ] 全量回归 + CLIPFORGE_DISABLE_CAPTURE=1 冒烟 + 盟哥视觉/功能验收
- [ ] docs/HANDOFF.md 与 PROPOSAL_ROADMAP.md 收官更新

## 注意事项

- 旧 AI 侧车删除是删除手术：每批独立可验证可提交；verify 脚本先 grep 相应断言随迁/删除（教训×6）；App 手术删除区间用「下一个顶层声明」定位。
- 冒烟一律带 CLIPFORGE_DISABLE_CAPTURE=1（双实例事故 2026-09-10）。
- pi sdk 的 API Key 与网络调用不得进入剪贴板热路径（沿用控制面/热路径隔离原则，verify-hot-path 有否定断言）。
