# 提案：剪贴板 Agent 调用面板

## 背景

ClipForge 的核心定位仍然是快速剪贴板工具。用户复制链接、文章、代码、错误日志、文件路径或图片后，当前应用已经能沉淀历史与上下文，但还缺少一个极简入口把剪贴板内容像附件一样交给 Agent 处理，并把处理结果回到剪贴板工作流里。

这里的 Agent 能力不是 Agent 管理平台。ClipForge 不负责管理多个 Agent、不做团队协作、不做远程机器人、不做 Agent 生命周期控制台；ClipForge 提供的是悬浮窗内的 Agent 聊天框，把当前剪贴板条目默认作为引用附件，用户通过 `@` 自动补全或“添加引用”快速挂载其他剪贴板条目，再调用本地 CLI Agent、AI SDK/OpenAI-compatible provider 或 MCP 工具。Agent 页不是工作台，默认首屏只暴露对话、引用附件、Agent/CLI 选择和发送。

AionUi 可以作为参考，但只借鉴局部能力：

- 本地 CLI Agent 的检测、启动、输出流转和会话展示。
- Agent 运行过程的进程登记、取消、退出清理和错误诊断。
- 把上下文引用注入对话，并把结果沉淀为可复用内容。

不借鉴 AionUi 的多 Agent 平台、Team Mode、远程通道、YOLO/Full-Auto、MCP 统一管理中心或完整 Cowork 工作台形态。

## 依赖关系

本提案依赖以下能力，不重复定义它们：

- [context-plugin-agent-runtime](../context-plugin-agent-runtime/proposal.md)：`ClipboardContextSnapshot`、`SmartParsedTarget`、`clipboard.content.parse`、受控 MCP 工具面。
- [detail-rich-editor-agent-bridge](../detail-rich-editor-agent-bridge/proposal.md)：详情页编辑会话、AI 建议预览、保存回填与 `AI` tag 规则。
- [file-image-clipboard-support](../file-image-clipboard-support/proposal.md)：图片、文件、HTML/RTF 等多格式剪贴板内容采集基础。

## 目标

1. 在快速面板或详情页增加一个极简 Agent 聊天框，用于围绕剪贴板引用完成对话、处理、保存和复制闭环。
2. 新建对话时默认附带当前剪贴板条目；其他历史、收藏、搜索结果、文件或 skill 上下文通过 `@` 自动补全、引用按钮或命令菜单追加，而不是在首屏铺开模式页签。
3. 支持调用一个最小本地 CLI Agent adapter，例如已配置的 `claude -p`、`codex` 或后续可检测命令模板；Agent/CLI 选择表现为 composer 内的紧凑选择器，不做配置面板。
4. 面板隐藏后 Agent run 继续运行，重新打开时能恢复状态、消息流和结果动作。
5. Agent 结果可以一键复制、保存为新剪贴板条目、收藏来源条目、归档来源条目、追加 `AI` tag，也可以触发受控的 ClipForge 管理动作。
6. 为 Agent 提供受限 MCP/工具接口，允许读取用户选择的上下文集合、解析内容、保存显式结果，但不能绕过用户确认静默改历史。
7. 保持快速剪贴板主路径低延迟：Agent 面板按需加载，不影响采集、搜索、复制、粘贴和详情打开。
8. 前端消息、流式事件和工具调用模型尽量兼容 AI SDK v5 / OpenAI-compatible provider，后续可以接入用户自己配置的 OpenAI、Anthropic、OpenAI-compatible 网关或本地模型服务。
9. Agent 探测和运行只能作为后台服务异步启动，不允许阻塞悬浮面板的唤起、定位、展示、隐藏和快捷键响应。
10. Agent 页消息区采用类似 shadcn `MessageScroller` 的滚动行为：流式输出不抢用户阅读位置，回到最新消息有显式按钮，重新打开会话能定位到最近有意义的用户 turn。
11. Agent 面板可以触发 ClipForge 自定义能力，但这些能力默认隐藏在输入命令和结果动作里；首屏不得出现复杂 skill/workbench 工具栏。
12. Agent 页附件引用采用 shadcn Base `Attachment` 的 media/title/description/actions 结构，但按 ClipForge 紧凑工具样式实现，不引入默认外观或重型依赖。
13. Agent 页消息流按 shadcn Base `MessageScroller` 的 provider/scroller/viewport/content/item/button 语义保持可替换结构；run marker 和跳到最新按钮也必须进入该结构，避免聊天框布局再次退化成工作台式分区。

## 非目标

- 不做 Agent 管理平台、Agent 市场、Agent 配置中心或多 Agent 团队模式。
- 不做远程 Telegram、Lark、WeChat、WebUI 等远程控制入口。
- 不做 YOLO、Full-Auto 或无人值守自动执行。
- 不默认暴露完整剪贴板历史、完整正文、文件系统路径、当前输入框坐标或来源应用可执行路径。
- 不允许 Agent 静默修改剪贴板历史、系统剪贴板、插件优先级或本地脚本。
- 不在第一阶段实现 Agent 自学习、长期偏好学习、自动生成并固化插件。
- 不把 Agent 面板做成 AI 首页、营销页、复杂工作台或 Agent 控制台。
- 不在第一阶段做公共 skill 市场或自动学习 skill；只支持用户私域剪贴板 skill 的草稿、手动保存、手动调用和 MCP 暴露。
- 不允许 Agent 面板绕过 ClipForge 权限模型直接修改配置、删除历史、执行脚本或安装扩展；所有管理动作都必须经过工具权限和用户确认。
- 不把 API key、baseURL、provider secret 暴露给前端；前端只使用 provider id、model id 和运行状态。
- 不在第一阶段做复杂模型供应商管理页，只预留标准 provider 配置和最小连接检查。

## 用户价值

- 用户复制一篇文章链接后，打开悬浮面板切到 Agent 页，当前链接默认作为引用出现，直接输入“帮我分析下这篇文章”即可处理。
- 用户也可以在输入框里输入 `@` 搜索并引用其它剪贴板历史、收藏条目、搜索结果、文件或某个剪贴板私域 skill 输出的上下文。
- Agent 分析完成后，用户可以把摘要保存为新剪贴板条目、收藏原链接、复制结果或直接放回系统剪贴板。
- 用户复制错误日志、代码块、JSON 字段或文件路径时，Agent 能读取智能解析候选，减少手工挑选上下文；必要时还能把这些候选沉淀成自己的剪贴板处理 skill。
- 用户可以通过输入命令、引用补全和结果动作调用标准 skill 或 MCP tool 来管理 ClipForge，例如批量整理标签、分析一组收藏、生成摘要并回填、创建剪贴板处理 skill 草稿；这些能力不占用默认聊天界面。
- 面板关闭或隐藏不打断长任务，用户稍后打开仍能看到运行状态和结果。
- 外部 Agent 通过 MCP 调用 ClipForge 时，只能使用受控剪贴板工具，边界清晰、可审计。

## 成功标准

- 快速面板存在清晰的 Agent 入口，打开后是简单聊天框而不是多区块工作台；Agent 页不影响默认剪贴板列表操作。
- 从任意当前条目进入 Agent 页时，都会生成默认 `AgentContextSet`，其中第一项是当前 clip 引用；用户可以通过 `@` 自动补全、引用按钮或命令菜单追加、移除或替换为 all、收藏、搜索结果、指定条目、文件或 skill 上下文。
- 本地 CLI Agent adapter 可以启动一次 run、流式返回消息、取消 run、记录错误和退出状态。
- 隐藏面板不会取消 run；重新打开能恢复最近对话和 run 状态。
- Agent 输出结果只能通过显式动作写入剪贴板历史或系统剪贴板。
- 保存 Agent 生成内容时默认写入 provenance，并追加 `AI` tag。
- `clipboard.context.get`、`clipboard.content.parse`、`clipboard.capture`、`clipboard.update`、`clipboard.copy`、`clipboard.search` 等工具都有权限裁剪和结构化日志。
- `clipboard.context.compose` 能按用户选择组合上下文引用，`clipboard.skill.*` 能维护用户私域剪贴板 skill 草稿和手动调用。
- Agent 面板能通过隐藏命令/结果动作使用 ClipForge 能力，包括剪贴板查询、标签维护、收藏/归档、结果回填、skill 草稿、MCP tool 调用；危险动作必须预览并确认，不能占据首屏。
- Agent 面板加载失败、CLI 缺失或 run 失败时，只降级 Agent 页，不影响剪贴板采集、搜索、复制和详情页。
- 前端 Agent 页可以消费标准化 `UIMessage` 风格消息流，文本增量、tool call、tool result、自定义 data part 都能被同一渲染器处理。
- 服务层可以通过 AI SDK provider registry 或 OpenAI-compatible 配置启动模型调用，同时本地 CLI adapter 也能映射成同一套消息流。
- 启动时 Agent 后台服务异常、检测超时或未完成时，悬浮面板仍可立即打开并正常完成剪贴板列表、搜索和复制动作。
- 消息滚动区在流式响应、加载历史、重新打开会话、停止/重试 run 时都能保持阅读位置，不把用户强制拉到底部。
- 附件引用条复用统一 Attachment 原语，用户能快速识别类型、标题、权限范围，并能一键移除本次上下文引用。
