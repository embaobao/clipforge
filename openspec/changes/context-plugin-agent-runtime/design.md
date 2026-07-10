# 设计：上下文驱动的插件与 Agent 运行时边界

## 1. 分层架构

```mermaid
flowchart TB
  UI["React UI: 快速面板 / 详情页 / 编辑器"] --> Context["Context Snapshot Builder"]
  UI --> AgentPanel["AG-UI Agent Panel Bridge"]
  UI --> PluginHost["Plugin Runtime Host"]

  Context --> Core["App Core Services"]
  PluginHost --> Core
  AgentPanel --> AgentProvider["Agent Provider Adapter"]
  AgentProvider --> LocalAgent["Local Agent"]
  AgentProvider --> RemoteAgent["Remote Agent"]
  AgentProvider --> AcpAgent["ACP Adapter"]

  Mcp["MCP Surface"] --> Core
  Mcp --> PluginHost
  Mcp --> AgentProvider

  Core --> Db["SQLite / FTS / Native Clipboard"]
```

### App Core Services

App Core 是唯一业务真实源，负责：

- 剪贴板采集、搜索、复制、更新、删除。
- 详情页上下文构建。
- 编辑器 session 管理。
- 内容分析、OCR、模板渲染等内置能力。

插件、Agent、MCP 都不能绕过 App Core 直接读写数据库或 UI state。

### Plugin Runtime Host

插件是能力单元，不等于 MCP server。插件可以有不同运行形态：

- `builtin`：内置插件，例如 Markdown 检查、模板变量渲染。
- `mcp`：外部 MCP server 暴露的工具。
- `rpc`：本地 sidecar 或远程服务。
- `panel`：只返回声明式渲染 schema，由详情页沙盒渲染。

### MCP Surface

MCP 是对外稳定工具面：

- 用于外部 Agent/客户端调用 ClipForge 能力。
- 用于把插件能力以工具形式暴露给外部。
- 不直接操作 React 组件、Tiptap editor instance 或临时 UI state。

### AG-UI Agent Panel Bridge

AG-UI 是 Agent 与页面之间的事件协议：

- 接收 run input：messages、tools、context、state。
- 渲染 run lifecycle、message、tool call、tool result、state delta、error event。
- 允许应用自定义 `CUSTOM` event，用于详情页沙盒面板、patch preview、变量展示。

AG-UI 不承担插件发现、权限授权或升级管理。

## 2. Context Snapshot Contract

第一版 snapshot 同时覆盖详情页只读上下文和编辑态上下文，但分层启用。

```ts
export type ClipboardContextSnapshot = {
  schemaVersion: 1;
  snapshotId: string;
  createdAt: number;
  clip: {
    id: string;
    contentKind: string;
    payloadKind: string;
    title: string;
    summary: string;
    chars: number;
    lines: number;
    createdAt: number;
    updatedAt: number;
    lastSeenAt: number;
    lastCopiedAt?: number;
  };
  sourceApp?: {
    name: string;
    bundleId?: string;
    iconAvailable: boolean;
    executablePath?: string;
  };
  detail: {
    routePath: "/clip/$clipId";
    renderer: string;
    detailMode: string;
    businessChain: string;
  };
  trigger: {
    surface: "quick-panel" | "detail" | "editor" | "plugin" | "mcp" | "agent-panel";
    action: string;
    userInitiated: boolean;
  };
  editor?: EditorSessionSnapshot;
  permissions: ContextPermissionSnapshot;
  diagnostics: {
    source: "live" | "cached" | "partial";
    missing: string[];
    redacted: string[];
  };
};
```

### Editor Session Snapshot

```ts
export type EditorSessionSnapshot = {
  sessionId: string;
  draftVersion: number;
  mode: "readonly" | "editing";
  dirty: boolean;
  contentFormat: "text" | "markdown" | "html" | "json";
  selectionText?: string;
  readableFields: Array<"text" | "html" | "json" | "selection">;
};
```

详情页打开时默认没有 `editor`。用户点击“编辑”后才创建 session。

## 3. 当前上下文确定性

### 确定可用

- 内容正文、时间、收藏、标签、复制次数。
- `payloadKind` 和 `kind` 的基础推断。
- 标题、摘要、URL、host、Markdown 标记。
- macOS 下的来源应用名称、bundle id、可执行路径和 icon。
- 详情页渲染器、业务链路、路由、内容长度、行数。

### 条件可用

- 图片、文件、HTML 当前主要来自文本推断，不是稳定多 MIME 采集。
- 当前键入环境存在于粘贴目标恢复链路和日志中，但还不是稳定 context API。
- 前端和后端都有内容分析逻辑，需要后续统一。

### 第一阶段必须修正

- 后台监听和显式 capture 的 `kind` 分类路径要统一。
- `sourceApp.executablePath` 默认只允许本地 trusted 插件读取。
- 大正文、OCR 文本、编辑器全文必须按权限和长度上限暴露。

## 4. 插件边界

```ts
export type ClipForgePluginManifest = {
  id: string;
  name: string;
  version: string;
  runtime: "builtin" | "mcp" | "rpc" | "panel";
  entry?: string;
  capabilities: Array<
    | "context.read"
    | "content.read"
    | "content.transform"
    | "editor.previewPatch"
    | "editor.applyPatch"
    | "clipboard.write"
    | "agent.call"
    | "panel.render"
    | "network.request"
  >;
  contextFields: string[];
  contentTypes: string[];
  triggers: Array<{
    surface: "detail" | "editor" | "quick-action" | "background";
    actionId: string;
    label: string;
  }>;
  permissions: {
    requiresUserConfirmation: boolean;
    allowFullContent: boolean;
    allowSourceExecutablePath: boolean;
    allowNetwork: boolean;
  };
  compatibility: {
    app: string;
    contextSchema: number;
    agui?: string;
    mcp?: string;
  };
};
```

插件输出不能直接执行 UI 代码。第一阶段只允许以下输出：

- `renderPanel`：声明式面板 schema。
- `previewPatch`：编辑器 patch 预览。
- `replaceSelection`：编辑器选区替换建议。
- `replaceDocument`：整篇内容替换建议。
- `copyResult`：把结果写到系统剪贴板，需要用户确认。
- `callAgent`：调用 Agent Provider，需要用户确认和日志。

## 5. Agent 边界

Agent 是协作者，不是插件本身。第一阶段定义统一 provider：

```ts
export type AgentProvider = {
  id: string;
  kind: "local" | "remote" | "acp";
  displayName: string;
  startRun(input: AgentRunInput): AsyncIterable<AgUiEvent>;
  cancelRun(runId: string): Promise<void>;
};
```

Agent 输入只能由 `ClipboardContextSnapshot`、用户明确输入、以及当前会话允许的 tools 组成。

Agent 输出统一转成 AG-UI events：

- run started / finished
- text message delta
- tool call start / args / end
- tool result
- state snapshot / delta
- error event
- custom event：panel render、patch preview、permission prompt

## 6. MCP 工具面

第一阶段建议新增工具名：

| 工具 | 说明 |
|------|------|
| `clipboard.context.get` | 获取当前详情页或编辑会话的脱敏上下文 |
| `clipboard.plugin.list` | 返回可用插件 manifest 摘要 |
| `clipboard.plugin.call` | 调用指定插件动作 |
| `clipboard.editor.context` | 获取编辑器 session 上下文 |
| `clipboard.editor.preview_patch` | 提交 patch 预览，不写入 |
| `clipboard.editor.apply_patch` | 用户确认后应用到 draft |
| `clipboard.agent.run` | 以 AG-UI 兼容输入启动 Agent run |

MCP tool 返回值必须带 `traceId`、`businessChain`、`redactedFields`、`permissionDecision`，方便排障。

## 7. 自动升级能力规划

自动升级分四类，不混用：

1. **应用更新**：Tauri updater，使用签名 artifact、HTTPS endpoint、用户确认安装。
2. **内置能力 manifest 更新**：只更新规则、模板、内容识别配置，不执行新代码。
3. **插件更新**：更新插件 manifest 和外部 MCP/RPC endpoint 版本，需要兼容性检查和用户确认。
4. **Agent adapter 更新**：更新本地/远程 Agent Provider 配置、模型能力、工具白名单，不静默扩大权限。

### 版本与兼容性

```ts
export type CapabilityVersionRecord = {
  id: string;
  kind: "app" | "builtin-manifest" | "plugin" | "agent-provider";
  currentVersion: string;
  availableVersion?: string;
  minAppVersion?: string;
  contextSchema: number;
  permissionsChanged: boolean;
  releaseNotes?: string;
  signature?: string;
};
```

升级前必须检查：

- app 版本是否满足。
- `contextSchema` 是否兼容。
- 权限是否扩大。
- 插件运行时是否仍可用。
- 是否存在远程 kill switch 或本地禁用记录。

### 灰度、回滚、禁用

- 默认不静默安装应用更新。
- manifest 类更新可以后台检查，但应用前写入本地 pending 状态。
- 权限扩大必须用户确认。
- 每个插件和 Agent Provider 都有 kill switch。
- 最近一次可用版本必须保留，升级失败自动回滚。
- 所有升级检查、应用、失败、回滚都写结构化日志。

### 性能边界

- 更新检查不能阻塞快速面板启动。
- 插件更新和 Agent adapter 更新只能在空闲时检查。
- OCR、内容识别规则、远程 catalog 下载都不能进入剪贴板监听同步路径。

## 8. 错误隔离与日志

所有插件、Agent、MCP、AG-UI 面板错误都必须包含：

- `traceId`
- `pluginId` 或 `agentProviderId`
- `surface`
- `routePath`
- `businessChain`
- `clipId`
- `payloadKind`
- `contextSchema`
- `permissionDecision`
- `redactedFields`

页面层使用兜底组件隔离：

- renderer 级错误只替换当前渲染区。
- AG-UI panel 错误只替换 Agent 面板。
- 插件按钮错误只禁用该按钮或展示失败状态。
- tab 层不可处理错误只能降级当前 tab，不能让应用面板崩溃。

## 9. 实施顺序

1. 修正并冻结当前上下文字段确定性。
2. 定义 `ClipboardContextSnapshot` 和权限模型。
3. 定义插件 manifest 与输出 action。
4. 定义 Editor Session 只读/编辑态边界。
5. 定义 MCP tools surface。
6. 定义 AG-UI Agent Panel Bridge。
7. 定义自动升级 registry、兼容性检查、kill switch、回滚日志。
8. 再进入 Tiptap 编辑器和 Agent 面板实现。

