# Delta:产品迭代治理(product-iteration-governance)

## ADDED Requirements

### Requirement: Agent 范式三层归位

ClipForge 的 Agent 能力 SHALL 按三层形态归位:L1 嵌入式分析(详情页 PiAnalysisBar)、L2 工具化助手(pi sdk 会话+工具)、L3 MCP stdio 外部接口;SHALL NOT 引入第四种 Agent 运行时形态或并行的 LLM 集成链。

#### Scenario: 新增 AI 能力对号入座

- **WHEN** 提出新的 AI 能力(如智能标签、语义检索、助手对话)
- **THEN** 该能力归入 L1/L2/L3 之一并由对应载体承接(pi 适配层或 clipf.* 工具族),不新建运行时或双轨实现

#### Scenario: 工具同源

- **WHEN** L2 pi 工具与 L3 MCP 工具暴露同一剪贴板领域能力
- **THEN** 二者消费同一领域命令层,禁止各自独立实现业务逻辑

### Requirement: AI 不进热路径

AI 推理与网络调用 SHALL NOT 进入剪贴板热路径(主面板搜索/列表/复制/粘贴);主面板交互区域 SHALL 保持无 AI 触点。

#### Scenario: 主面板性能不受 AI 影响

- **WHEN** L2 助手执行工具调用或 LLM 请求
- **THEN** 主面板 quick.scroll/select/copy/paste 基线(P95 ≤ 300ms)不回退,热路径边界校验持续通过

#### Scenario: API Key 边界

- **WHEN** pi 适配层需要 provider API Key
- **THEN** Key 经 settings redaction/keyRef 机制存取,不落盘前端明文

### Requirement: 波次推进顺序

功能迭代 SHALL 按五波次推进:W1 剪贴板核心闭环收口 → W2 搜索与语义检索 → W3 Agent 能力补全 → W4 运行时与外部接口决策 → W5 治理与演示(横切);每个活跃 change SHALL 在其提案头标注所属波次。

#### Scenario: 排期查询单点解释

- **WHEN** 需要决定「下一批推进哪个 change」
- **THEN** 依据本提案波次表与退出条件即可决定,无需交叉考古多个提案依赖声明

#### Scenario: 波次外提案

- **WHEN** 新提案无法归入现有波次
- **THEN** 先修订本提案波次表(或明确归入 W5 横切),再开工

### Requirement: 交互区域矩阵门禁

新增功能点或 surface SHALL 对号入座交互区域矩阵(主面板/workspace 详情/设置/托盘快捷键/onboarding/MCP stdio);矩阵外区域 SHALL 先扩矩阵(修订本提案)再实现。

#### Scenario: AI 触点准入

- **WHEN** 某交互区域计划新增 AI 入口
- **THEN** 对照矩阵:仅 workspace 详情(L1)、设置(L2 配置)、MCP stdio(L3)允许;主面板/托盘/onboarding 拒绝

#### Scenario: 写回安全

- **WHEN** L3 MCP 或 L2 助手产生写回(标签/内容修改)
- **THEN** 经 preview/confirm 通道,不静默直写
