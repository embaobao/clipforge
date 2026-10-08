//! MCP 工具规格表（从 lib.rs 迁入，modularity Phase 4）：全部工具的 name / description /
//! inputSchema 纯数据声明。条目顺序即 tools/list 输出顺序，golden 用例（见 mcp/mod.rs）
//! 冻结条数与排序；增删或重排工具必须显式交接 golden 清单。

use serde_json::{json, Value};

pub(super) struct McpToolSpec {
    pub(super) name: &'static str,
    pub(super) description: &'static str,
    pub(super) input_schema: fn() -> Value,
}

pub(super) fn mcp_tool_specs() -> Vec<McpToolSpec> {
    vec![
        McpToolSpec {
            name: "clipboard.context.get",
            description: "Get a safe redacted ClipboardContextSnapshot by id.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "includeContent": { "type": "boolean" }
                }
            }),
        },
        McpToolSpec {
            name: "clipboard.context.compose",
            description: "Compose an AgentContextSet from ids, favorites, search-result, all, or current scope.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "mode": { "type": "string", "enum": ["current", "selected", "favorites", "search-result", "all"] },
                    "ids": { "type": "array", "items": { "type": "string" } },
                    "text": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "types": { "type": "array", "items": { "type": "string" } },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 50 }
                }
            }),
        },
        McpToolSpec {
            name: "clipboard.context.live",
            description: "Capture a live, metadata-only snapshot of the current frontmost application. External collectors require explicit includeExternal=true and the enableExternalContextCollectors setting.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "collectorId": { "type": "string", "description": "Optional external collector id to run." },
                    "includeExternal": { "type": "boolean", "description": "Run matching user-installed read-only collectors." }
                }
            }),
        },
        McpToolSpec {
            name: "clipboard.context.collectors.list",
            description: "List built-in and user-installed application context collectors plus their diagnostics.",
            input_schema: || json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "clipboard.context.collector.contract",
            description: "Return the application context collector v1 contract, safety rules, and Chrome adapter example.",
            input_schema: || json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "clipboard.context.collector.debug",
            description: "Run one matching external collector against the current frontmost application and return its input, output, timing, and redaction diagnostics.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "collectorId": { "type": "string" },
                    "fixture": { "type": "object", "description": "Optional synthetic collector input for development without opening the target app." }
                },
                "required": ["collectorId"]
            }),
        },
        McpToolSpec {
            name: "clipboard.content.parse",
            description: "Parse URL, file path, JSON, command, code block, error log, and Markdown candidates without executing them.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "content": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "clipboard.capture",
            description: "Capture content as a standardized ClipForge item.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "content": { "type": "string" },
                    "sourceLabel": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "clipboard.update",
            description: "Update a clipboard item through the unified write interface.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "content": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "favorite": { "type": "boolean" },
                    "pinned": { "type": "boolean" },
                    "bucket": { "type": "string" },
                    "metadata": { "type": "object" },
                    "agentContext": { "type": "object" }
                },
                "required": ["id"]
            }),
        },
        McpToolSpec {
            name: "clipboard.copy",
            description: "Copy a standardized ClipForge item by id.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "text": { "type": "string" },
                    "pasteMode": { "type": "string", "enum": ["rich", "plain", "filesAsPaths"] }
                }
            }),
        },
        McpToolSpec {
            name: "clipboard.search",
            description: "Search ClipForge clipboard history with text, tags, type, kind, bucket, favorite, and file extension filters.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "bucket": { "type": "string" },
                    "types": { "type": "array", "items": { "type": "string" } },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "favorite": { "type": "boolean" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
                }
            }),
        },
        McpToolSpec {
            name: "clipf.settings.get",
            description: "Read redacted ClipForge settings, schema, writePolicy, redaction rules, and revision.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "includeSchema": { "type": "boolean" }
                }
            }),
        },
        McpToolSpec {
            name: "clipf.settings.patch",
            description: "Patch ClipForge settings through the unified Settings Service. Prefer this over replace.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "patch": { "type": "object" },
                    "actor": { "type": "string" },
                    "reason": { "type": "string" },
                    "expectedRevision": { "type": "string" },
                    "includeSchema": { "type": "boolean" }
                },
                "required": ["patch"]
            }),
        },
        McpToolSpec {
            name: "clipf.settings.replace",
            description: "Replace the full ClipForge settings document. Requires confirmed=true.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "settings": { "type": "object" },
                    "actor": { "type": "string" },
                    "reason": { "type": "string" },
                    "expectedRevision": { "type": "string" },
                    "confirmed": { "type": "boolean" },
                    "includeSchema": { "type": "boolean" }
                },
                "required": ["settings", "confirmed"]
            }),
        },
        McpToolSpec {
            name: "clipf.settings.reset",
            description: "Reset a ClipForge settings scope. Requires scope and confirmed=true.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string", "enum": ["all", "agent", "shortcuts", "display", "capture", "storage", "logs", "tags"] },
                    "actor": { "type": "string" },
                    "reason": { "type": "string" },
                    "expectedRevision": { "type": "string" },
                    "confirmed": { "type": "boolean" },
                    "includeSchema": { "type": "boolean" }
                },
                "required": ["scope", "confirmed"]
            }),
        },
        McpToolSpec {
            name: "clipf.agent.providers",
            description: "List redacted Agent providers resolved from Settings Service.",
            input_schema: || json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "clipf.agent.check",
            description: "Check readiness for the default or selected Agent provider without blocking the quick panel.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "providerId": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "clipf.agent.models",
            description: "List available models for the default or selected OpenAI-compatible Agent provider.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "providerId": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "clipboard.skill.list",
            description: "List private clipboard skill summaries. Frontend local drafts are not exposed as secrets.",
            input_schema: || json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "clipboard.skill.save_draft",
            description: "Return a confirm-write skill draft envelope; actual enablement remains user-confirmed.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "description": { "type": "string" },
                    "promptTemplate": { "type": "string" }
                },
                "required": ["name", "promptTemplate"]
            }),
        },
        McpToolSpec {
            name: "clipboard.skill.run",
            description: "Prepare a private skill run with explicit context scope and permission trimming.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "skillId": { "type": "string" },
                    "contextSet": { "type": "object" }
                }
            }),
        },
        McpToolSpec {
            name: "clipboard.plugin.list",
            description: "List built-in ClipForge plugin manifests and capability boundaries.",
            input_schema: || json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "clipboard.plugin.call",
            description: "Resolve a plugin action into a preview/action envelope. Built-in calls do not execute unsafe actions.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "pluginId": { "type": "string" },
                    "actionId": { "type": "string" },
                    "id": { "type": "string" },
                    "content": { "type": "string" },
                    "target": { "type": "string" }
                },
                "required": ["pluginId"]
            }),
        },
        McpToolSpec {
            name: "clipboard.agent.run",
            description: "Prepare an Agent run from prompt and contextSet. Execution requires explicit confirmation outside MCP.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "providerId": { "type": "string" },
                    "prompt": { "type": "string" },
                    "contextSet": { "type": "object" },
                    "allowFullContent": { "type": "boolean" }
                },
                "required": ["prompt"]
            }),
        },
        McpToolSpec {
            name: "clipboard.editor.context",
            description: "Build a safe EditorContextSnapshot for a clipboard item and optional draft.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "sessionId": { "type": "string" },
                    "draftVersion": { "type": "integer" },
                    "content": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["id"]
            }),
        },
        McpToolSpec {
            name: "clipboard.editor.preview_patch",
            description: "Preview editor content/tag changes. Does not write to database.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "sessionId": { "type": "string" },
                    "draftVersion": { "type": "integer" },
                    "replacement": { "type": "string" },
                    "tagPatch": { "type": "object" }
                },
                "required": ["id"]
            }),
        },
        McpToolSpec {
            name: "clipboard.editor.apply_patch",
            description: "Apply a user-confirmed editor patch through save_editor_draft.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "sessionId": { "type": "string" },
                    "draftVersion": { "type": "integer" },
                    "replacement": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "confirmed": { "type": "boolean" }
                },
                "required": ["id", "replacement", "confirmed"]
            }),
        },
        McpToolSpec {
            name: "clipboard.editor.save",
            description: "Save an editor draft through the unified native editor command.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "sessionId": { "type": "string" },
                    "draftVersion": { "type": "integer" },
                    "content": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["id", "content"]
            }),
        },
        McpToolSpec {
            name: "clipboard.editor.render_template",
            description: "Render a simple editor template against safe variables.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "template": { "type": "string" },
                    "variables": { "type": "object" }
                },
                "required": ["template"]
            }),
        },
        McpToolSpec {
            name: "clipboard.editor.suggest_update",
            description: "Return a local EditorSuggestionResult with content/tag patch preview only.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "sessionId": { "type": "string" },
                    "draftVersion": { "type": "integer" },
                    "content": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["id"]
            }),
        },
        McpToolSpec {
            name: "clipf.capture",
            description: "Capture current text into ClipForge history.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "content": { "type": "string" },
                    "sourceLabel": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "clipf.get",
            description: "Get a ClipForge item by id. Agent instruction example: use clipf.get id=clip_xxx",
            input_schema: || json!({
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }),
        },
        McpToolSpec {
            name: "clipf.list",
            description: "List recent ClipForge clipboard history. Agent instruction example: use clipf.list limit=9",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "bucket": { "type": "string", "enum": ["all", "history", "archive", "snippet", "trash"] },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 200 },
                    "cursor": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "clipf.search",
            description: "Search ClipForge clipboard history with text, tags, type, kind, bucket, favorite, and file extension filters.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "bucket": { "type": "string", "enum": ["all", "history", "archive", "snippet", "trash"] },
                    "types": { "type": "array", "items": { "type": "string" } },
                    "type": { "type": "string" },
                    "kinds": { "type": "array", "items": { "type": "string" } },
                    "kind": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "tag": { "type": "string" },
                    "fileExtensions": { "type": "array", "items": { "type": "string" } },
                    "fileExtension": { "type": "string" },
                    "favorite": { "type": "boolean" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 200 },
                    "cursor": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "clipf.analyze",
            description: "Analyze text with ClipForge content detection without writing it to history.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "content": { "type": "string" },
                    "sourceLabel": { "type": "string" }
                },
                "required": ["content"]
            }),
        },
        McpToolSpec {
            name: "clipf.copy",
            description: "Copy a standardized ClipForge item by id, or capture text first and then copy the generated item. Agent instruction example: use clipf.copy id=clip_xxx",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "text": { "type": "string" },
                    "pasteMode": { "type": "string", "enum": ["rich", "plain", "filesAsPaths"] }
                }
            }),
        },
        McpToolSpec {
            name: "clipf.update",
            description: "Update a clipboard item content, favorite, pinned, note, or bucket.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "content": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "favorite": { "type": "boolean" },
                    "pinned": { "type": "boolean" },
                    "note": { "type": "string" },
                    "metadata": { "type": "object" },
                    "agentContext": { "type": "object" },
                    "bucket": { "type": "string" }
                },
                "required": ["id"]
            }),
        },
        McpToolSpec {
            name: "clipf.delete",
            description: "Move clipboard items to trash.",
            input_schema: || json!({
                "type": "object",
                "properties": { "ids": { "type": "array", "items": { "type": "string" } } },
                "required": ["ids"]
            }),
        },
        McpToolSpec {
            name: "clipf.export",
            description: "Export ClipForge history as JSON.",
            input_schema: || json!({ "type": "object", "properties": { "includeDeleted": { "type": "boolean" } } }),
        },
        McpToolSpec {
            name: "clipf.import",
            description: "Import ClipForge history from JSON items.",
            input_schema: || json!({
                "type": "object",
                "properties": { "items": { "type": "array", "items": { "type": "object" } } },
                "required": ["items"]
            }),
        },
    ]
}
