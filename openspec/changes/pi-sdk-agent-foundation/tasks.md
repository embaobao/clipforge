# 任务：pi sdk 作为 ClipForge Agent 能力基础

> 状态（2026-09-11）：提案 newly created，盟哥已拍板方向。Phase 1（DSH 删除）为夜间
> 任务首个大战役，按 docs/HANDOFF.md 与本文件 Phase 1 要点分批执行。

## Phase 0：方向确认与调研 🟡

- [x] pi sdk 调研：github.com/earendil-works/pi，npm `@mariozechner/pi-coding-agent`，统一 LLM API + 可编程 SDK + 工具调用 + 会话管理
- [x] 盟哥拍板：pi 确立为 Agent 能力基础，DSH 全链废弃（2026-09-11）
- [x] Phase 0 细化：锁定 pi-ai/pi-agent-core@0.73.1（MIT），SDK 子包形态确认（@mariozechner/pi-ai 统一 LLM API：getModel/completeSimple/stream）；最小依赖面 = 两个库包（不引 pi-coding-agent CLI 的 TUI 依赖栈）

## Phase 1：DSH 全量删除（先删后建，避免双 Agent 链并存）🟡

### 1a. 前端
- [ ] 删 `src/dsh/`（dsh-panel.tsx）与 `src/dsh-main.tsx` 入口（含 vite 多页面配置与 tauri 窗口）
- [ ] 删/清 `src/agent/dsh-analysis.ts`（DSH 分析与守护进程服务层）
- [ ] 清引用链：use-clip-writeback 的 analyzeClipboardWithDsh、use-panel-keyboard/TopToolbar 的 onOpenDsh、PanelSurface 类型 "dsh" 成员、ClipContextMenu「AI 分析」入口（暂禁用或接占位）
- [ ] 删 DSH 设置项与相关 data-dev-probe

### 1b. Rust
- [ ] 删 `src-tauri/src/dsh.rs`（守护进程 spawn/kill/健康探活/命令）
- [ ] lib.rs：删 dsh 命令注册、spawn/kill 调用、mod dsh 声明
- [ ] tauri.conf.json：删 dsh 窗口配置

### 1c. 验证与文档
- [ ] 每删一层 `pnpm build:web` / `cargo check` + grep 复查无残留引用；verify 脚本 dsh 断言随迁/删除
- [ ] 全套验证 + CLIPFORGE_DISABLE_CAPTURE=1 冒烟
- [ ] DSH 三提案归档（deepseek-harness-embedding / dsh-file-context-conversation / dsh-system-context-menu，--skip-specs）+ ROADMAP 更新

## Phase 2：pi sdk 最小集成 🟡

- [x] 引入依赖并封装 `src/agent/pi/` 适配层（provider-config.ts：AgentProviderConfig 映射 + piComplete 最小补全封装；tsc 真实校验 pi-ai 类型兼容）
- [ ] pi-ai API 对接补全：stream 流式调用、工具注册（clipboard.read/search）——clipboard.read 需条目查询通道经 props/命令注入
- [ ] 工具注册：clipboard.read（读指定条目）/ clipboard.search（查历史）两个最小工具
- [ ] 详情页「AI 分析」与右键菜单入口切换到 pi 底层（保持现有交互与状态栏文案结构）
- [ ] API Key 走 settings 的 redaction/keyRef 机制，不落盘前端

## Phase 3：产品功能点 🟡

- [ ] 条目 AI 分析与摘要（替代 DSH clipboard_analyze 能力）
- [ ] 智能标签建议（分析结果 → 标签应用，沿用 onApplyTags/onApplyFolder 通道）
- [ ] 分析历史（本地持久化，替代 DSH 历史）

## Phase 4：验证与收尾 🟡

- [ ] 全量回归 + CLIPFORGE_DISABLE_CAPTURE=1 冒烟 + 盟哥视觉/功能验收
- [ ] docs/HANDOFF.md 与 PROPOSAL_ROADMAP.md 收官更新

## 注意事项

- DSH 删除是删除手术：每批独立可验证可提交；verify 脚本先 grep dsh 断言随迁/删除（教训×6）；App 手术删除区间用「下一个顶层声明」定位。
- 冒烟一律带 CLIPFORGE_DISABLE_CAPTURE=1（双实例事故 2026-09-10）。
- pi sdk 的 API Key 与网络调用不得进入剪贴板热路径（沿用控制面/热路径隔离原则，verify-hot-path 有否定断言）。
