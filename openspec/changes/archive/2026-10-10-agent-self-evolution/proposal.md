# 提案:agent-self-evolution(自迭代 Agent 能力域)

## Why

ClipForge 的 Agent 能力已沉淀三层(L1 内嵌动作、L2 MCP 工具、L3 智能标签),但"Agent 修改 Agent 自身"的元能力仍是空白:用户想让悬浮窗多一个按钮、pi-web 多一个 tab、或让 Agent 帮自己写一个新工具时,目前只能手改源码。本提案把「自迭代」做成一等能力域:Agent 可以在受控沙箱里生成、验证、安装能力包(界面插槽 + 工具 + 提示词模板),全程可审计、可回滚。

## What Changes

- **能力包(Power Pack)格式**:一个能力包 = manifest(power-pack.json)+ 可选界面插槽声明 + 可选 L2 工具(与 pi 侧同源注册)+ 可选提示词模板。落盘 `~/Library/Application Support/ClipForge/power-packs/<id>/`。
- **三处受控插槽**(宿主只暴露插槽,不开放任意 DOM):
  - 悬浮窗插槽:主面板底部工具条追加图标按钮,点击触发能力包声明的动作(调 L2 工具或打开 URL)。
  - pi-web tab 插槽:Agent 面板 web 页追加自定义 tab,内容为能力包声明的受控组件(只读卡片/表单)。
  - 提示词模板注册:能力包可注册提示词模板,出现在 Agent 对话的模板选择器。
- **Agent 自迭代回路**:Agent 通过 MCP 工具 `powerpack.scaffold`(生成能力包脚手架)→ 本地校验(manifest schema + 宿主 dry-run)→ 用户确认安装 → 生效/回滚。安装必须用户确认,不允许静默自装。
- **提示词管理**:设置页新增「提示词模板」分区:查看/编辑内置模板与能力包模板,导出/导入 JSON。

## Capabilities

### 新增 specs

- `power-pack-runtime`:能力包发现、manifest 校验、安装/卸载/回滚生命周期、三插槽渲染契约。
- `prompt-template-management`:提示词模板的注册、覆盖、导入导出。

## Impact

- 代码:`src-tauri/src/`(power_pack 模块,MCP 工具注册)、`src/agent/`(插槽渲染)、`src/settings/`(提示词分区)。
- 与 `agent-extension-seams`(dormant)的关系:本提案是 seams 的第 1 处消费者;若三处同源工具注册需求触发 seams 实施,能力包工具直接迁入同源注册表。
- 风险:自迭代 = 让 Agent 写代码,必须守住「沙箱内生成、schema 校验、用户确认、可回滚」四道闸;插槽只暴露声明式能力,不暴露 eval/DOM。
