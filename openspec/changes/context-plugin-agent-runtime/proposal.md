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
- 当前上下文字段有“代码已预留”和“真实稳定采集”两种状态，需要显式分级。
- 当前输入环境、编辑器 draft、selection、插件权限、Agent 可读范围还没有统一契约。
- 插件和 Agent 的能力升级缺少版本、兼容性、回滚、禁用和审计机制。

## 目标

1. 定义 `ClipboardContextSnapshot`，作为插件和 Agent 读取当前剪贴板上下文的唯一入口。
2. 定义插件 manifest、权限模型、触发点和输出动作，明确“什么是插件”。
3. 定义 Agent Provider 与 AG-UI 面板桥，明确“什么是 Agent 能力”。
4. 保持 MCP tools 是对外稳定接口，不直接绑定 React/Tiptap UI 状态。
5. 定义 Tiptap Editor Session 边界，让编辑态上下文可用但受控。
6. 规划自动升级能力：应用、插件、Agent adapter、能力 manifest 的版本协商、灰度、回滚、禁用和审计。
7. 保证快速面板主路径不被 OCR、识别、Agent 调用、插件加载阻塞。

## 非目标

- 不在第一阶段实现远程插件市场。
- 不允许插件直接访问 SQLite、React state、localStorage 或系统剪贴板原生 API。
- 不允许 Agent 后台直接改写剪贴板历史或系统剪贴板。
- 不默认把完整剪贴板历史、完整正文、可执行路径、输入框坐标暴露给外部 Agent。
- 不在第一阶段实现任意远程代码执行或未签名插件自动安装。
- 不把 AG-UI 当成插件发现协议；AG-UI 只负责 Agent 与页面之间的运行事件。

## 用户价值

- 详情页能稳定展示“这段内容是什么、来自哪里、现在能做什么”。
- 插件按钮可以基于当前内容提供固定能力，例如 OCR、内容检查、模板渲染、格式转换。
- Agent 可以作为详情页助手读取受控上下文，返回预览结果、patch 或自定义渲染面板。
- MCP tools 能把 ClipForge 的能力暴露给外部客户端，但不会破坏应用内部状态。
- 后续能力升级可以灰度、回滚、禁用和审计，不牺牲丝滑体验。

## 成功标准

- 能从详情页构造一个脱敏的只读 `ClipboardContextSnapshot`。
- 进入编辑态后能创建 `EditorSession`，并在 snapshot 中受控暴露 `selection/draft/version/dirty`。
- 插件 manifest 能声明读取哪些上下文字段、写入哪些动作、触发在哪些内容类型上。
- Agent Provider 能统一本地 Agent、远程 Agent、ACP adapter，并输出 AG-UI 事件。
- MCP 只暴露稳定工具，例如 `clipboard.context.get`、`clipboard.plugin.call`、`clipboard.editor.preview_patch`。
- 自动升级能力先支持检查、兼容性判断、用户确认、回滚记录和 kill switch，不做静默全量升级。

