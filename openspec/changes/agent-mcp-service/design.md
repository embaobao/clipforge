# 设计：Agent MCP 服务接口

## 交互设计

Agent 调用流程：
1. Agent（Claude Code）启动 MCP Client
2. MCP Client 连接 ClipForge MCP Server（stdio/SSE）
3. Agent 调用 clipboard.search 工具搜索历史
4. MCP Server 返回搜索结果（JSON）
5. Agent 调用 clipboard.copy 写入内容到剪贴板
6. 用户在目标应用粘贴

配置入口：
- 设置中提供 MCP Server 启用/禁用开关
- 显示 MCP Server 状态（运行/停止）
- 显示连接端口（如 SSE 端口 3000）

## 技术设计

### 1. MCP Server 框架

**使用 tauri-plugin-mcp**：
```rust
// Cargo.toml
[dependencies]
tauri-plugin-mcp = "0.1"  # 或自研 MCP 模块
```

**自研 MCP 模块**：
```rust
// src-tauri/src/mcp/mod.rs
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub struct MCPServer {
    tools: Vec<MCPTool>,
    repository: ClipboardRepository,
}

impl MCPServer {
    pub fn new(repository: ClipboardRepository) -> Self {
        Self {
            tools: vec![
                MCPTool::new("clipboard_capture", "采集当前剪贴板", capture_schema()),
                MCPTool::new("clipboard_search", "搜索剪贴板历史", search_schema()),
                MCPTool::new("clipboard_copy", "写入到剪贴板", copy_schema()),
                MCPTool::new("clipboard_update", "更新条目属性", update_schema()),
                MCPTool::new("clipboard_delete", "删除条目", delete_schema()),
                MCPTool::new("clipboard_export", "导出历史数据", export_schema()),
                MCPTool::new("clipboard_import", "导入历史数据", import_schema()),
            ],
            repository,
        }
    }

    pub async fn run_stdio(&mut self) -> Result<(), String> {
        let stdin = BufReader::new(tokio::io::stdin());
        let mut stdout = tokio::io::stdout();

        let mut lines = stdin.lines();

        while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
            let request: Value = serde_json::from_str(&line)
                .map_err(|e| format!("Parse request failed: {}", e))?;

            let response = self.handle_request(request).await?;

            let response_str = serde_json::to_string(&response)
                .map_err(|e| format!("Serialize response failed: {}", e))?;

            stdout.write_all(response_str.as_bytes()).await?;
            stdout.write_all(b"\n").await?;
            stdout.flush().await?;
        }

        Ok(())
    }

    async fn handle_request(&mut self, request: Value) -> Result<Value, String> {
        let method = request["method"].as_str().unwrap_or("");

        match method {
            "tools/list" => Ok(json!({
                "tools": self.tools.iter().map(|t| t.to_json()).collect::<Vec<_>>()
            })),
            "tools/call" => {
                let tool_name = request["params"]["name"].as_str().unwrap_or("");
                let arguments = request["params"]["arguments"].clone();
                self.call_tool(tool_name, arguments).await
            },
            _ => Ok(json!({ "error": "Unknown method" })),
        }
    }

    async fn call_tool(&mut self, name: &str, args: Value) -> Result<Value, String> {
        match name {
            "clipboard_capture" => self.capture(args).await,
            "clipboard_search" => self.search(args).await,
            "clipboard_copy" => self.copy(args).await,
            "clipboard_update" => self.update(args).await,
            "clipboard_delete" => self.delete(args).await,
            "clipboard_export" => self.export(args).await,
            "clipboard_import" => self.import(args).await,
            _ => Err(format!("Unknown tool: {}", name)),
        }
    }
}
```

### 2. MCP Tool 定义

```rust
// src-tauri/src/mcp/tools.rs
use serde_json::{json, Value};

pub struct MCPTool {
    name: String,
    description: String,
    input_schema: Value,
}

impl MCPTool {
    pub fn new(name: &str, description: &str, schema: Value) -> Self {
        Self {
            name: name.to_string(),
            description: description.to_string(),
            input_schema: schema,
        }
    }

    pub fn to_json(&self) -> Value {
        json!({
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input_schema
        })
    }
}

fn capture_schema() -> Value {
    json!({
        "type": "object",
        "properties": {}
    })
}

fn search_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "搜索关键词"
            },
            "kind": {
                "type": "string",
                "enum": ["text", "image", "files", "html"],
                "description": "内容类型过滤"
            },
            "is_favorite": {
                "type": "boolean",
                "description": "是否仅搜索收藏"
            },
            "limit": {
                "type": "integer",
                "default": 20,
                "description": "返回数量限制"
            },
            "offset": {
                "type": "integer",
                "default": 0,
                "description": "分页偏移"
            }
        },
        "required": ["query"]
    })
}

fn copy_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "要写入的文本内容"
            },
            "kind": {
                "type": "string",
                "enum": ["text", "image", "files"],
                "default": "text"
            }
        },
        "required": ["content"]
    })
}

fn update_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "id": {
                "type": "string",
                "description": "条目 ID"
            },
            "is_favorite": {
                "type": "boolean",
                "description": "是否收藏"
            },
            "is_pinned": {
                "type": "boolean",
                "description": "是否固定"
            },
            "note": {
                "type": "string",
                "description": "备注"
            }
        },
        "required": ["id"]
    })
}

fn delete_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "id": {
                "type": "string",
                "description": "条目 ID（单个删除）"
            },
            "ids": {
                "type": "array",
                "items": { "type": "string" },
                "description": "条目 ID 列表（批量删除）"
            }
        }
    })
}

fn export_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "format": {
                "type": "string",
                "enum": ["json", "csv"],
                "default": "json"
            },
            "limit": {
                "type": "integer",
                "default": 1000
            }
        }
    })
}

fn import_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "data": {
                "type": "string",
                "description": "导入数据（JSON 格式）"
            }
        },
        "required": ["data"]
    })
}
```

### 3. Tool 实现调用 ClipboardRepository

```rust
// src-tauri/src/mcp/handler.rs
use crate::repository::{ClipboardRepository, UpsertResult};

impl MCPServer {
    async fn capture(&mut self, _args: Value) -> Result<Value, String> {
        // 采集当前剪贴板
        let content = read_current_clipboard()?;

        let content_hash = compute_hash(&content);
        let summary = generate_summary(&content);

        let result = self.repository.upsert_item(
            &content_hash,
            "text",
            &content,
            &summary,
            &summary,
            None,
        ).await?;

        match result {
            UpsertResult::Inserted { id } => Ok(json!({
                "success": true,
                "id": id,
                "summary": summary
            })),
            UpsertResult::Updated { id, use_count } => Ok(json!({
                "success": true,
                "id": id,
                "use_count": use_count,
                "message": "已存在，计数更新"
            })),
        }
    }

    async fn search(&mut self, args: Value) -> Result<Value, String> {
        let query = args["query"].as_str().unwrap_or("");
        let kind = args["kind"].as_str();
        let is_favorite = args["is_favorite"].as_bool();
        let limit = args["limit"].as_i64().unwrap_or(20) as i64;
        let offset = args["offset"].as_i64().unwrap_or(0) as i64;

        let result = self.repository.search_items(
            query,
            kind,
            is_favorite,
            limit,
            offset,
        ).await?;

        Ok(json!({
            "items": result.items.iter().map(|item| json!({
                "id": item.id,
                "kind": item.kind,
                "summary": item.summary,
                "content": item.content,
                "source_app": item.source_app,
                "is_favorite": item.is_favorite,
                "is_pinned": item.is_pinned,
                "use_count": item.use_count,
                "created_at": item.created_at
            })).collect::<Vec<_>>(),
            "total": result.total,
            "has_more": result.has_more
        }))
    }

    async fn copy(&mut self, args: Value) -> Result<Value, String> {
        let content = args["content"].as_str().unwrap_or("");
        let kind = args["kind"].as_str().unwrap_or("text");

        // 写入剪贴板
        write_to_clipboard(kind, content)?;

        // 同时入库（可选）
        let content_hash = compute_hash_for_content(kind, content);
        let summary = generate_summary(content);

        self.repository.upsert_item(
            &content_hash,
            kind,
            content,
            &summary,
            &summary,
            None,
        ).await?;

        Ok(json!({
            "success": true,
            "message": "已写入剪贴板"
        }))
    }

    async fn update(&mut self, args: Value) -> Result<Value, String> {
        let id = args["id"].as_str().unwrap_or("");

        if let Some(is_favorite) = args["is_favorite"].as_bool() {
            self.repository.toggle_favorite(id, is_favorite).await?;
        }

        if let Some(is_pinned) = args["is_pinned"].as_bool() {
            self.repository.toggle_pin(id, is_pinned).await?;
        }

        if let Some(note) = args["note"].as_str() {
            self.repository.update_note(id, note).await?;
        }

        Ok(json!({
            "success": true,
            "id": id
        }))
    }

    async fn delete(&mut self, args: Value) -> Result<Value, String> {
        if let Some(id) = args["id"].as_str() {
            self.repository.soft_delete_item(id).await?;
        }

        if let Some(ids) = args["ids"].as_array() {
            for id in ids {
                if let Some(id_str) = id.as_str() {
                    self.repository.soft_delete_item(id_str).await?;
                }
            }
        }

        Ok(json!({
            "success": true
        }))
    }

    async fn export(&mut self, args: Value) -> Result<Value, String> {
        let format = args["format"].as_str().unwrap_or("json");
        let limit = args["limit"].as_i64().unwrap_or(1000) as i64;

        let items = self.repository.list_items(None, None, None, limit, 0).await?;

        match format {
            "json" => Ok(json!({
                "data": items.items,
                "count": items.items.len()
            })),
            "csv" => {
                let csv = items_to_csv(&items.items);
                Ok(json!({
                    "data": csv,
                    "count": items.items.len()
                }))
            },
            _ => Err(format!("Unknown format: {}", format)),
        }
    }

    async fn import(&mut self, args: Value) -> Result<Value, String> {
        let data = args["data"].as_str().unwrap_or("");

        let items: Vec<ClipboardItem> = serde_json::from_str(data)
            .map_err(|e| format!("Parse import data failed: {}", e))?;

        let mut imported = 0;
        let mut skipped = 0;

        for item in items {
            let content_hash = compute_hash_for_content(&item.kind, &item.content);

            match self.repository.upsert_item(
                &content_hash,
                &item.kind,
                &item.content,
                &item.summary.unwrap_or_default(),
                &item.summary.unwrap_or_default(),
                item.source_app.as_deref(),
            ).await {
                Ok(_) => imported += 1,
                Err(_) => skipped += 1,
            }
        }

        Ok(json!({
            "success": true,
            "imported": imported,
            "skipped": skipped
        }))
    }
}
```

### 4. MCP Server 启动命令

```rust
#[tauri::command]
pub async fn start_mcp_server(app: AppHandle) -> Result<(), String> {
    let repository = ClipboardRepository::new(&app)?;
    let mut server = MCPServer::new(repository);

    // stdio 方式启动
    tokio::spawn(async move {
        server.run_stdio().await.unwrap();
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_mcp_server(app: AppHandle) -> Result<(), String> {
    // 停止 MCP Server
    // ...

    Ok(())
}

#[tauri::command]
pub async fn get_mcp_status(app: AppHandle) -> Result<MCPStatus, String> {
    // 返回 MCP Server 状态
    Ok(MCPStatus {
        running: true,
        port: None,  // stdio 不需要端口
    })
}
```

### 5. 前端设置入口

```tsx
// src/components/Settings/MCPServerSettings.tsx
import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect } from 'react';

export function MCPServerSettings() {
    const [enabled, setEnabled] = useState(false);
    const [status, setStatus] = useState<MCPStatus | null>(null);

    useEffect(() => {
        loadStatus();
    }, []);

    async function loadStatus() {
        const s = await invoke<MCPStatus>('get_mcp_status');
        setStatus(s);
        setEnabled(s.running);
    }

    async function toggleServer() {
        if (enabled) {
            await invoke('stop_mcp_server');
        } else {
            await invoke('start_mcp_server');
        }
        setEnabled(!enabled);
        loadStatus();
    }

    return (
        <div className="mcp-settings">
            <div className="setting-item">
                <label>Agent MCP 服务</label>
                <button onClick={toggleServer}>
                    {enabled ? '停止' : '启动'}
                </button>
            </div>
            {status && (
                <div className="status">
                    状态：{status.running ? '运行中' : '已停止'}
                </div>
            )}
            <div className="help">
                <p>启用后，Claude Code、Cursor 等 Agent 可以通过 MCP 协议访问剪贴板历史。</p>
                <p>连接方式：stdio（通过 Tauri 命令行启动）</p>
            </div>
        </div>
    );
}
```

## 边界

- MCP Server 使用 stdio transport，不启动独立 HTTP 服务
- MCP Server 不依赖 UI 状态，直接调用 ClipboardRepository
- MCP Server 是可选功能，默认不启动
- Tool 实现复用现有 ClipboardRepository，不新建数据访问路径

## 验证要求

- Claude Code 可以调用 clipboard.search 工具
- Claude Code 可以调用 clipboard.copy 工具写入内容
- MCP Server 启动/停止正常
- 设置 UI 显示状态正确
- `pnpm build` 通过
- `cd src-tauri && cargo check` 通过
- `pnpm tauri dev` 验证实际行为