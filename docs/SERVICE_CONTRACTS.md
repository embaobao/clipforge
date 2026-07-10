# 服务接口契约

ClipForge 的外部能力通过标准服务接口暴露，后续同步、导入导出、CLI 或 MCP server 都应复用这些契约，而不是绕过数据层直接改 UI 状态。

接口定义在：

```text
src/services/contracts.ts
src/services/example.ts
```

## 写入剪贴板数据

```ts
await repository.capture({
  content: "https://github.com/embaobao/clipforge",
  source: "clipboard",
  sourceLabel: "Clipboard",
  observedAt: Date.now(),
});
```

返回值会说明本次写入是新建、提升已有记录，还是被忽略：

```ts
type ClipboardCaptureResult = {
  status: "created" | "promoted" | "ignored";
  item?: ClipRecord;
  reason?: string;
};
```

## 检索剪贴板数据

```ts
await repository.query({
  text: "github",
  bucket: "all",
  limit: 50,
  sort: "recent",
});
```

查询必须支持分页：

```ts
type ClipQueryResult = {
  items: ClipRecord[];
  nextCursor?: string;
  total?: number;
  indexedAt?: number;
  window: {
    limit: number;
    cursor?: string;
    hasMore: boolean;
  };
};
```

## 软删除

```ts
await repository.delete(["clip_id"], { soft: true });
```

默认删除策略应该优先软删除，定期清理由配置控制。

## 导入导出

```ts
await repository.export({
  format: "jsonl",
  query: { bucket: "all", limit: 200 },
});
```

```ts
await repository.import({
  format: "json",
  content,
  strategy: "merge",
  sourceLabel: "Manual Import",
});
```

## MCP 工具映射

内测阶段 MCP server 统一使用 `clipf.*` 工具名：

- `clipf.capture`
- `clipf.get`
- `clipf.list`
- `clipf.search`
- `clipf.analyze`
- `clipf.copy`
- `clipf.update`
- `clipf.delete`
- `clipf.export`
- `clipf.import`

MCP 只负责标准调用入口，不应该引入复杂 AI 配置流程。

## Agent 快速访问边界

Agent、CLI、MCP server、同步服务都只能通过同一套服务契约访问剪贴板数据：

```mermaid
flowchart LR
  Agent["Agent / MCP / CLI"] --> Bridge["ExternalToolBridge"]
  Bridge --> Repo["ClipboardRepository"]
  Bridge --> Search["SearchIndex"]
  Repo --> DB["SQLite + FTS5"]
  Search --> DB
```

最低可用能力：

```ts
await bridge.call({
  tool: "clipf.capture",
  input: {
    content: "hello from agent",
    source: "external",
    sourceLabel: "MCP",
    observedAt: Date.now(),
  },
});

await bridge.call({
  tool: "clipf.search",
  input: {
    text: "hello",
    bucket: "all",
    limit: 20,
    sort: "recent",
  },
});
```

约束：

- 外部工具不得直接写 UI state、localStorage 或内存列表。
- 外部工具不得绕过 SQLite/FTS5 主存储。
- 搜索必须有 `limit`，默认不返回全量历史。
- 删除默认软删除，硬清理由配置驱动。
- AI 能力如果接入，只能作为 MCP 工具调用这些接口，不在快捷面板里增加复杂配置。
