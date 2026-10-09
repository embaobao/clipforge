// Settings 页 MCP/Agent 代码 tab 文案构造:纯字符串拼装,无 React 依赖。
// 从 settings.tsx 外移(codebase-modularity-refactor 还债切片),宿主只需传
// mcp 命令与翻译函数;JSON-RPC 示例与 provider 模板同源冻结,改动需同步 golden 用例。

/** 标准 mcpServers 接入配置:复制后粘进支持 MCP 的 Agent(Claude Desktop/Cursor 等)即可接入。 */
export function buildMcpServerConfigJson(mcpCommand: string): string {
  return JSON.stringify(
    { mcpServers: { clipforge: { command: mcpCommand.replace(/\s*--mcp\s*$/, ""), args: ["--mcp"] } } },
    null,
    2,
  );
}

/** Agent provider 模板:OpenAI-compatible 官方示例 + 本地网关示例。 */
export function buildAgentProviderTemplateText(): string {
  return JSON.stringify(
    {
      agent: {
        providers: [
          {
            id: "openai-main",
            name: "OpenAI compatible",
            kind: "openai-compatible",
            enabled: true,
            baseUrl: "https://api.openai.com/v1",
            modelId: "gpt-4.1-mini",
            apiKeyEnv: "OPENAI_API_KEY",
            timeoutSeconds: 120,
          },
          {
            id: "local-openai-compatible",
            name: "Local OpenAI-compatible gateway",
            kind: "openai-compatible",
            enabled: false,
            baseUrl: "http://127.0.0.1:1234/v1",
            modelId: "local-model",
            apiKeyEnv: "CLIPFORGE_AGENT_LOCAL_API_KEY",
            timeoutSeconds: 120,
          },
        ],
      },
    },
    null,
    2,
  );
}

/** 真实 JSON-RPC 示例:与 MCP stdio 协议一致(tools/call),供调试参考。 */
export function buildJsonRpcExamples(): string {
  return [
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"clipf.list","arguments":{"limit":9}}}',
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"clipf.search","arguments":{"text":"github","limit":20}}}',
  ].join("\n");
}
