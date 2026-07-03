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

后续 MCP server 应映射到这些工具名：

- `clipboard.capture`
- `clipboard.search`
- `clipboard.copy`
- `clipboard.update`
- `clipboard.delete`
- `clipboard.export`
- `clipboard.import`

MCP 只负责标准调用入口，不应该引入复杂 AI 配置流程。
