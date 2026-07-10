# ClipForge MCP 快速接入

ClipForge MCP 工具面处于内测阶段，当前统一使用 `clipf.*` 命名空间，不保留旧别名。

## 启动方式

外部 MCP Client 使用应用二进制的 stdio 模式：

```bash
/Applications/ClipForge.app/Contents/MacOS/clipforge --mcp
```

开发环境可以使用：

```bash
src-tauri/target/debug/clipforge --mcp
```

应用启动后会自动托管一个 MCP 子进程用于状态检测和应用内展示；外部 Agent 仍按 MCP stdio 规范启动自己的 server 进程。

## Agent 接入描述

ClipForge 对 Agent 暴露的是一个本地 stdio MCP Server。Agent 不需要直接读数据库、localStorage 或系统剪贴板 API，只需要把 ClipForge 注册成 MCP server，然后通过 `clipf.*` 工具完成读取、写入、复制、分析和导入导出。

接入原则：

- 先调用 `tools/list` 获取工具和 schema，不要硬猜参数。
- 调用工具统一走 `tools/call`，工具名只使用 `clipf.*`。
- 每次调用都传 `client`、`sourceLabel`、`requestId`，方便日志追溯。
- 成功时解析 `content[0].text` 中的 JSON envelope，再读取 `result`。
- 失败时读取 `error.data.hint` 和 `error.data.expected`，按提示修正参数后重试。
- Agent 指令里的 `use clipf.copy id=...` 只是面向人的简写；底层仍应转换成标准 MCP `tools/call` JSON-RPC。

## MCP Client 配置示例

正式安装后的配置：

```json
{
  "mcpServers": {
    "clipforge": {
      "command": "/Applications/ClipForge.app/Contents/MacOS/clipforge",
      "args": ["--mcp"]
    }
  }
}
```

开发环境配置：

```json
{
  "mcpServers": {
    "clipforge-dev": {
      "command": "/Users/embaobao/workspace/idea/clipforge/src-tauri/target/debug/clipforge",
      "args": ["--mcp"]
    }
  }
}
```

注意：MCP Client 配置里尽量使用绝对路径，避免 Agent 工作目录变化导致找不到二进制。

## 推荐给 Agent 的系统描述

可以把下面这段放进 Agent 的工具说明或系统提示中：

```text
You have access to the ClipForge MCP server named "clipforge".
Use it for clipboard history, current clipboard resources, and local clipboard write-back.

Rules:
- Discover tools with tools/list before first use.
- Use only clipf.* tools.
- Prefer clipf.list limit=9 to inspect recent items.
- Use clipf.get id=<clip_id> before operating on a specific item when content matters.
- Use clipf.copy id=<clip_id> to write an existing ClipForge item back to the system clipboard.
- Use clipf.capture content=<text> to save new content into ClipForge history.
- Use clipf.analyze content=<text> to classify content without saving it.
- Include client, sourceLabel, and requestId in every call.
- On success, parse content[0].text as JSON and read result.
- On failure, read error.data.hint and retry with corrected arguments.
```

## 最小验证流程

注册 MCP 后，让 Agent 依次做下面几步：

```text
1. tools/list，确认存在 clipf.list、clipf.get、clipf.copy。
2. use clipf.list limit=9
3. 从返回的 result.items[0].id 取一个 id。
4. use clipf.get id=<上一步 id>
5. use clipf.copy id=<上一步 id>
6. 如果失败，读取 error.data.hint 并按提示重试。
```

标准 JSON-RPC 版本：

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"clipf.list","arguments":{"limit":9,"client":"my-agent","sourceLabel":"My Agent","requestId":"req_list_001"}}}
```

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"clipf.copy","arguments":{"id":"clip_xxx","client":"my-agent","sourceLabel":"My Agent","requestId":"req_copy_001"}}}
```

## Agent 指令示例

这些是面向 Agent 的自然指令示例，底层仍会转换为标准 MCP `tools/call`：

```text
use clipf.list limit=9
use clipf.get id=clip_xxx
use clipf.copy id=clip_xxx
use clipf.search text="github" limit=20
use clipf.analyze content="https://github.com/embaobao/clipforge"
```

## 标准 JSON-RPC 示例

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"clipf.copy","arguments":{"id":"clip_xxx","client":"agent","sourceLabel":"Agent","requestId":"req_001"}}}
```

## 工具列表

- `clipf.capture`：写入历史。没有传 `content` 时读取当前系统剪贴板。
- `clipf.get`：按 `id` 获取单项。
- `clipf.list`：读取最近列表，支持 `bucket`、`limit`、`cursor`。
- `clipf.search`：搜索历史，支持 `text`、`bucket`、`limit`。
- `clipf.analyze`：只分析内容，不写入历史。
- `clipf.copy`：按 `id` 复制条目，或按 `text` 写入系统剪贴板。
- `clipf.update`：修改收藏、置顶、备注和 bucket。
- `clipf.delete`：软删除到垃圾箱。
- `clipf.export`：导出 JSON。
- `clipf.import`：导入 JSON。

## 成功返回结构

工具成功时，`content[0].text` 是 JSON 字符串，解析后结构固定：

```json
{
  "ok": true,
  "traceId": "mcp_1783677564286",
  "tool": "clipf.copy",
  "source": {
    "surface": "mcp",
    "client": "agent",
    "sourceLabel": "Agent",
    "requestId": "req_001"
  },
  "businessChain": "mcp -> clipforge-service -> local-store",
  "permissionDecision": {
    "decision": "allow",
    "reason": "local MCP stdio call with explicit tool arguments"
  },
  "redactedFields": [],
  "nextActions": ["clipf.list limit=9"],
  "result": {}
}
```

## 失败返回结构

工具失败时返回 JSON-RPC error，并在 `error.data` 中提供排障字段：

```json
{
  "code": -32602,
  "message": "clipf.get requires id",
  "data": {
    "ok": false,
    "traceId": "mcp_1783677564000",
    "method": "tools/call",
    "tool": "clipf.get",
    "businessChain": "mcp -> clipforge-service",
    "hint": "Provide a valid ClipForge item id, for example {\"id\":\"clip_xxx\"}.",
    "expected": "Use tools/list to inspect schemas, then call tools/call with { name: \"clipf.*\", arguments: { ... } }."
  }
}
```

## 来源与日志追溯

建议 Agent 在每次调用中传：

```json
{
  "client": "your-agent-name",
  "sourceLabel": "Your Agent",
  "requestId": "req_001"
}
```

ClipForge 会在应用日志中记录 `tool`、`sourceLabel`、`requestId`，并在返回值中带 `traceId`。后续增量更新、详情扩展、草稿维护都应沿用这组字段。
