# 提案：上下文驱动的插件与 Agent 运行时边界

## 背景

ClipForge 的产品主线仍然是快速、稳定、低延迟的剪贴板工具。后续插件、Agent、MCP、AG-UI、详情页富文本编辑都必须服务于这个主线，不能把应用改造成重型 AI 工作台。

当前项目已经具备一部分基础能力：

- 剪贴板条目已经保存内容、时间、分类、摘要、URL、来源应用等上下文。
- 详情页已经展示内容类型、来源应用和渲染器，并记录渲染业务链路日志。
- Rust 侧已经有最小 MCP stdio 工具入口。
- 详情页 Tiptap 编辑器与 Agent/MCP 扩展桥已有独立提案。

但这些能力还缺少统一边界：

- 插件、Agent、MCP tools、AG-UI 面板容易混在同一层。
- 当前详情页“打开链接”等动作仍是 UI 特判，应该收敛为标准内置插件，作为后续插件系统的最小可用样例。
- 当前上下文字段有“代码已预留”和“真实稳定采集”两种状态，需要显式分级。
- 当前输入环境、编辑器 draft、selection、插件权限、Agent 可读范围还没有统一契约。
- 插件和 Agent 的能力升级缺少版本、兼容性、回滚、禁用和审计机制。

## 目标

1. 定义 `ClipboardContextSnapshot`，作为插件和 Agent 读取当前剪贴板上下文的唯一入口。
2. 定义插件 manifest、权限模型、触发点和输出动作，明确“什么是插件”。
3. 将现有“打开链接”标准化为 `builtin.open-link` 插件：插件 icon、名称、触发条件、权限、执行动作都走统一插件链路。
4. 将普通文本默认“下钻详情页”标准化为 `builtin.open-detail` 插件，让 `Ctrl/Cmd+J` 始终走统一动作解析器。
5. 定义受控脚本插件：支持变量渲染、打开应用、打开终端、执行白名单命令或 `claude -p` 这类本地 Agent 命令，但默认需要用户确认。
6. 定义 Agent Provider 与 AG-UI 面板桥，明确“什么是 Agent 能力”。
7. 支持智能内容解析：从当前 clip 中提取用户最可能想复制、打开或下钻的候选内容，但不做长期学习和自动改优先级。
8. 保持 MCP tools 是对外稳定接口，不直接绑定 React/Tiptap UI 状态。
9. 定义 Tiptap Editor Session 边界，让编辑态上下文可用但受控。
10. 规划自动升级能力：应用、插件、Agent adapter、能力 manifest 的版本协商、灰度、回滚、禁用和审计。
11. 保证快速面板主路径不被 OCR、识别、Agent 调用、插件加载阻塞。

## 非目标

- 不在第一阶段实现远程插件市场。
- 不允许插件直接访问 SQLite、React state、localStorage 或系统剪贴板原生 API。
- 不允许 Agent 后台直接改写剪贴板历史或系统剪贴板。
- 不允许 Agent 静默创建并自动执行本地脚本；Agent 只能生成插件 manifest / 脚本草稿，保存和执行必须经过权限校验与用户确认。
- 不默认把完整剪贴板历史、完整正文、可执行路径、输入框坐标暴露给外部 Agent。
- 不在第一阶段实现任意远程代码执行或未签名插件自动安装。
- 不把 AG-UI 当成插件发现协议；AG-UI 只负责 Agent 与页面之间的运行事件。

## 用户价值

- 详情页能稳定展示“这段内容是什么、来自哪里、现在能做什么”。
- 插件按钮可以基于当前内容提供固定能力，例如打开链接、OCR、内容检查、模板渲染、格式转换。
- 用户可以把“根据当前详情内容打开终端并执行 `claude -p ...`”保存成一个可复用快捷指令插件。
- Agent 可以通过 MCP 生成插件名称、图标、脚本模板和触发条件，让用户在面板中预览、保存、调用。
- `Ctrl/Cmd+J` 对链接默认打开目标，对普通文本默认下钻详情页；对 JSON、命令、代码块、文件路径等内容先通过智能解析生成候选，再由内置动作或用户插件触发。
- Agent 可以通过 MCP 调用智能解析能力，生成“建议复制哪个字段 / 下钻哪个片段 / 用哪个插件处理”的候选，但第一阶段不学习、不自动调整插件优先级。
- Agent 可以作为详情页助手读取受控上下文，返回预览结果、智能建议反吐、patch 或自定义渲染面板。
- Agent 生成或 Agent 建议应用保存后的粘贴项自动带 `AI` tag，用户可在搜索栏用 `#AI` 快速找回。
- MCP tools 能把 ClipForge 的能力暴露给外部客户端，但不会破坏应用内部状态。
- 后续能力升级可以灰度、回滚、禁用和审计，不牺牲丝滑体验。

## 成功标准

- 能从详情页构造一个脱敏的只读 `ClipboardContextSnapshot`。
- 进入编辑态后能创建 `EditorSession`，并在 snapshot 中受控暴露 `selection/draft/version/dirty`。
- 插件 manifest 能声明读取哪些上下文字段、写入哪些动作、触发在哪些内容类型上。
- `builtin.open-link` 能替代当前详情页特判的打开链接动作，并通过同一套 `clipboard.plugin.call` 执行。
- `builtin.open-detail` 能作为普通文本 `Ctrl/Cmd+J` 的默认动作。
- `Ctrl/Cmd+J` 动作解析器能返回候选 action、智能解析出的目标片段、命中原因和是否需要确认。
- 智能解析能从 URL、文件路径、命令、JSON 字段、代码块、错误日志、Markdown 标题/链接中提取可复制/可下钻候选。
- Agent 能通过 MCP 创建或更新一个插件草稿，包含 `name/icon/script/triggers/contextFields/permissions`，但默认不自动执行。
- Agent Provider 能统一本地 Agent、远程 Agent、ACP adapter，并输出 AG-UI 事件。
- MCP 只暴露稳定工具，例如 `clipboard.context.get`、`clipboard.plugin.list`、`clipboard.plugin.create`、`clipboard.plugin.call`、`clipboard.editor.preview_patch`、`clipboard.editor.suggest_update`。
- Agent 生成内容进入剪贴板历史时必须写入来源元数据，并默认追加 `AI` tag。
- 自动升级能力先支持检查、兼容性判断、用户确认、回滚记录和 kill switch，不做静默全量升级。
