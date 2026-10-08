# 任务:产品持续迭代总纲

> 治理类提案:落地动作 = 建立波次表 + 交互区域矩阵 + 既有文档对齐;无代码改动。

## Phase 1:总纲建立

- [x] 确立 Agent 范式三层形态(L1 嵌入式分析 / L2 工具化助手 / L3 MCP 外部接口)与同源原则、红线
- [x] 盘点 15 个活跃 change 真实进度(`openspec list` + tasks 计数,2026-09-30)
- [x] 功能规划五波次(W1 核心收口 → W2 搜索语义 → W3 Agent 补全 → W4 运行时决策 → W5 治理演示)
- [x] 交互区域矩阵(6 区域 × 定位 × AI 触点 × 约束)

## Phase 2:对齐与验证

- [x] `docs/PROPOSAL_ROADMAP.md` 重写「当前 active change」表与「后续开发计划」, 与波次表一致,清除旧 AI 侧车三行与已失效快照引用--同步重写 `openspec/project.md` 活跃提案表;`frontend-surface-architecture-refactor` 按归档口径移出 active 队列
- [x] `openspec validate product-iteration-master-plan --strict` 通过;全量 `--all --strict` 下 framer-motion(补评估判据 delta)同步转绿,interaction-animation-polish 存量缺 delta 属 skip-specs 归档情形、按归档流程处理
- [x] 波次归位标注:13 个活跃 change 提案头部加「所属波次」标注行(仅注释性一行,不动验收标准)
