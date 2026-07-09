# 提案：Agent MCP 服务接口

## 背景

当前 ClipForge 缺少 Agent/MCP 接口，无法被外部工具（如 Claude Code、Cursor、GPT）访问剪贴板历史。用户需要：
- AI Agent 直接读取剪贴板历史
- AI Agent 快速写入内容到剪贴板
- AI Agent 搜索和组织剪贴板条目
- AI Agent 导入导出剪贴板数据

参考项目调研结论：
- **EcoPaste** 明确规划 MCP 接口，不进入主流程，只作为标准工具接口
- **ClipForge AGENTS.md** 明确 MCP 作为标准工具接口暴露，不和 UI 状态强耦合

## 目标

- 实现 **MCP Server**：提供剪贴板读写接口
- 标准工具契约：
  - `clipboard.capture`：采集当前剪贴板
  - `clipboard.search`：搜索历史条目
  - `clipboard.copy`：写入到剪贴板
  - `clipboard.update`：更新条目属性
  - `clipboard.delete`：删除条目
  - `clipboard.export`：导出历史数据
  - `clipboard.import`：导入历史数据
- MCP Server 不依赖 UI 状态，直接调用 ClipboardRepository

## 非目标

- 不实现复杂的 AI 配置面板
- 不实现 Agent 自动执行（只提供接口）
- 不实现云端同步（后续提案）

## 用户价值

- Claude Code 可以直接读取用户剪贴板历史，辅助代码编写
- Cursor 可以搜索剪贴板中的代码片段，快速复用
- GPT 可以写入生成的文本到剪贴板，用户一键粘贴
- Agent 可以批量组织剪贴板历史（归档、删除、导出）

## 技术调研结论

### MCP 协议

Model Context Protocol (MCP) 是 Anthropic 提出的 Agent 工具接口标准：
- **Transport**：stdio / SSE / WebSocket
- **Tools**：Agent 可调用的工具列表
- **Resources**：Agent 可读取的资源
- **Prompts**：Agent 可使用的提示模板

### MCP Tool 定义

```json
{
  "name": "clipboard_search",
  "description": "搜索剪贴板历史条目",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "搜索关键词" },
      "kind": { "type": "string", "enum": ["text", "image", "files"], "description": "内容类型" },
      "limit": { "type": "integer", "default": 20 }
    }
  }
}
```

### ClipForge MCP 架构

```
┌─────────────────────────────────────┐
│  MCP Server (tauri-plugin-mcp)       │
│  - clipboard.capture                 │
│  - clipboard.search                  │
│  - clipboard.copy                    │
│  - clipboard.update                  │
│  - clipboard.delete                  │
│  - clipboard.export/import           │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│  ClipboardRepository                 │  ← 统一数据访问层
│  - upsert_item                       │
│  - search_items                      │
│  - list_items                        │
│  - delete_item                       │
│  - export/import                     │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│  SQLite + FTS5                       │  ← 数据持久化
└─────────────────────────────────────┘
```

### 与 UI 分离

MCP Server 不依赖 UI 状态：
- 直接调用 ClipboardRepository（Rust 层）
- 不通过 Tauri 前端
- 不依赖窗口显示状态
- 异步执行，不阻塞 UI