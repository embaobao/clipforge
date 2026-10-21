# TASK-5 + TASK-6-A 开发指令（合并一波，按序执行）

你只在 /Users/embaobao/workspace/idea/clipforge 工作。本波两个任务，先 TASK-5 后 TASK-6-A，
各自做完→门禁→commit→写 report，再做下一个。禁止两个任务改动混在同一 commit。

## 第 0 步：读任务书（真源）

1. `backlog/tasks/task-5 - 提示词快速优化器prompt-optimizer单次ai重写.md`
2. `backlog/tasks/task-6 - 多项拼接格式可定制-mcp-merge能力面.md` —— **本波只做 A（纯前端拼接格式），B（clipboard.merge MCP 工具、specs.rs）明确不做，不碰 src-tauri/**
3. 调研参考：`.work/supervisor/research-prompt-opt.md`（路线 A）、`.work/supervisor/research-merge-join.md`（A 节改动清单）

## 任务 1：TASK-5 提示词快速优化器

- 新增 `src/lib/prompt-optimizer.ts`（或按调研落 `src/agent/pi/prompt-optimizer.ts`，就近 pi 层优先）：
  内置优化元提示常量（5-slot brief：角色/任务/约束/输出格式/示例），走既有 `piComplete` 单次调用；
  provider 解析/降级/内容截断照抄 `src/agent/pi/analysis.ts` 的形态。
- 入口：详情页插件区（`src/workspace/components/detail/plugin-zone.tsx`）或 PiAnalysisBar 同款位置加
  「优化提示词」动作；产出走既有 `buildLocalEditorSuggestion` 的 EditorSuggestionResult 信封
  （contentPatch preview→diff→确认→`updateClipContent` 写回），**不新增写通道**。
- 无 provider 时：按钮禁用 + 提示去设置页（复用 AI 分析条既有门控形态），不做规则引擎降级层。
- i18n 双语 key（zh-CN/en-US）。
- 范围红线：不碰 `src-tauri/`、不碰 `mcp/specs.rs`、不动 pi 适配层签名、不做 eval 循环。

## 任务 2：TASK-6-A 拼接格式可定制（纯前端）

- 抽 `formatAggregate(items, opts)` helper（落 `src/clipboard/clipboard-domain.ts` 或相邻域文件），
  消掉两处硬编码 `join("\n\n")`：`src/clipboard/use-clip-writeback.ts` copySelectedClips 与
  `src/App.tsx` aggregatePreview（MultiAggregateWorkspace 同步用同一 helper）。
- 格式选项：分隔符（空行/换行/空格/自定义）、编号开关、顺序（默认点击序，可选列表/时间序——二选一可见）。
  入口在 `MultiSelectBottomBar`/`MultiAggregateWorkspace` 的格式弹出菜单；可激活「模板」占位按钮
  （模板=前缀/分隔符/编号的可存组合，存 localStorage 沿用 panel-settings 模式）；「结构化」按钮保持 disabled。
- 复制结果与预览必须一致（同一个 helper）。
- 非文本条目（文件/图片）降级为路径/描述字符串，UI 里给一行显式说明。
- i18n 双语 key。
- 范围红线：同上，不碰 src-tauri，不做富格式（RTF/HTML）合并。

## 交付纪律（两任务共同）

- 门禁每个任务各自跑绿才 commit：`pnpm build:web` + `pnpm test:unit`；rust 没动则 `cargo check` 可跳过但要确认 src-tauri 无 diff。
- Conventional Commits（`feat(prompt):` / `feat(clipboard):`）；只 add 自己改的文件，**禁 `git add -A`**。
- 单文件 ≤500 行规范照常（豁免清单只减不增）。
- **先写 report 再做长时间冒烟**（上一波 run3/run4 教训）：每完成一个任务立刻把
  「已验证/未验证/风险」写入 `.work/supervisor/task5-report.md` / `.work/supervisor/task6a-report.md`，
  冒烟部分限时 8 分钟，做不动就如实写「未验证」，不许谎报。
- 遇阻塞（API 形状不符/范围冲突）：写 `.work/supervisor/task5-findings.md` 记录+暂停等裁决，不要 hack。
- 锁屏提示：本机可能锁屏，UI 交互冒烟做不了就用探针/单元级验证替代并在 report 写明，不要卡死等待。
