//! MCP stdio 运行时与门面（从 lib.rs 迁入，modularity Phase 4）：run_mcp_stdio 主循环、
//! JSON-RPC envelope（initialize/tools/list/tools/call）、mcp_status 命令与 call_mcp_tool 路由
//! 壳。工具规格在 specs.rs（40 条，golden 断言见本文件测试），上下文辅助在 context.rs，
//! 各工具臂实现在 dispatch*.rs；子进程句柄 MCP_CHILD 为本模块私有。

pub mod context;
pub mod dispatch;
pub mod dispatch_agent_editor;
pub mod dispatch_write;
pub mod envelope;
mod specs;

use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use crate::{log_to_file, now_millis};

pub(crate) use dispatch::call_mcp_tool;
use specs::mcp_tool_specs;

static MCP_CHILD: std::sync::LazyLock<Arc<Mutex<Option<Child>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(None)));

fn mcp_child() -> Arc<Mutex<Option<Child>>> {
    MCP_CHILD.clone()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpStatusPayload {
    enabled: bool,
    running: bool,
    transport: String,
    command: String,
    tools: Vec<String>,
    message: String,
}

fn mcp_status_payload(
    enabled: bool,
    running: bool,
    transport: &str,
    message: &str,
) -> McpStatusPayload {
    McpStatusPayload {
        enabled,
        running,
        transport: transport.to_string(),
        command: format!(
            "{} --mcp",
            std::env::current_exe()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_else(|_| "clipforge".to_string())
        ),
        tools: mcp_tool_names()
            .into_iter()
            .map(ToString::to_string)
            .collect(),
        message: message.to_string(),
    }
}

pub(crate) fn mcp_tool_names() -> Vec<&'static str> {
    mcp_tool_specs().into_iter().map(|tool| tool.name).collect()
}

pub fn run_mcp_stdio() -> Result<(), String> {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = line.map_err(|error| error.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(error) => {
                writeln!(
                    stdout,
                    "{}",
                    mcp_error(Value::Null, -32700, &error.to_string())
                )
                .map_err(|write_error| write_error.to_string())?;
                stdout.flush().map_err(|error| error.to_string())?;
                continue;
            }
        };
        if let Some(response) = handle_mcp_request(request) {
            writeln!(stdout, "{response}").map_err(|error| error.to_string())?;
            stdout.flush().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn handle_mcp_request(request: Value) -> Option<Value> {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if method.starts_with("notifications/") {
        return None;
    }
    let response = match method {
        "initialize" => Ok(json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "clipforge", "version": "0.1.0" }
        })),
        "tools/list" => Ok(json!({ "tools": mcp_tools() })),
        "tools/call" => {
            let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
            call_mcp_tool(params)
        }
        _ => Err((-32601, format!("unknown method: {method}"))),
    };
    Some(match response {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => mcp_error_with_data(id, code, &message, method, None),
    })
}

fn mcp_error(id: Value, code: i64, message: &str) -> Value {
    mcp_error_with_data(id, code, message, "protocol", None)
}

fn mcp_error_with_data(
    id: Value,
    code: i64,
    message: &str,
    method: &str,
    tool: Option<&str>,
) -> Value {
    let trace_id = mcp_trace_id();
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message,
            "data": {
                "ok": false,
                "traceId": trace_id,
                "method": method,
                "tool": tool.unwrap_or(""),
                "businessChain": "mcp -> clipforge-service",
                "hint": mcp_error_hint(message),
                "expected": "Use tools/list to inspect schemas, then call tools/call with { name: \"clipf.*\", arguments: { ... } }."
            }
        }
    })
}

pub(super) fn mcp_trace_id() -> String {
    now_millis()
        .map(|ts| format!("mcp_{ts}"))
        .unwrap_or_else(|_| "mcp_unknown".to_string())
}

fn mcp_error_hint(message: &str) -> &'static str {
    // 顺序敏感："requires ids" 含子串 "requires id",必须先判 ids(否则 ids 提示不可达)
    if message.contains("requires ids") {
        "Provide ids as an array, for example {\"ids\":[\"clip_xxx\"]}."
    } else if message.contains("requires id") {
        "Provide a valid ClipForge item id, for example {\"id\":\"clip_xxx\"}."
    } else if message.contains("requires text or id") {
        "Provide either text or id. Prefer id when operating on an existing clipboard item."
    } else if message.contains("requires content") {
        "Provide content as a string."
    } else if message.contains("unknown tool") {
        "Use the clipf.* tool namespace. Call tools/list before choosing a tool."
    } else {
        "Check the tool input schema and retry with the required arguments."
    }
}

// ==== 以下函数体自 lib.rs 迁入（MCP stdio 运行时），行为零变化 ====

fn mcp_tools() -> Vec<Value> {
    mcp_tool_specs()
        .into_iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "inputSchema": (tool.input_schema)(),
            })
        })
        .collect()
}

#[tauri::command]
pub fn start_mcp_server() -> Result<McpStatusPayload, String> {
    start_mcp_server_with_reason("settings")
}

pub(crate) fn start_mcp_server_with_reason(reason: &str) -> Result<McpStatusPayload, String> {
    let child_ref = mcp_child();
    let mut child_slot = child_ref.lock().map_err(|error| error.to_string())?;
    if let Some(child) = child_slot.as_mut() {
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Ok(mcp_status_payload(
                true,
                true,
                "stdio",
                &format!("MCP server is already running ({reason})"),
            ));
        }
    }
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let child = Command::new(exe)
        .arg("--mcp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    *child_slot = Some(child);
    log_to_file(
        "info",
        "mcp",
        &format!("MCP server started, reason={}", reason),
    );
    Ok(mcp_status_payload(
        true,
        true,
        "stdio",
        &format!("MCP server started ({reason})"),
    ))
}

#[tauri::command]
pub fn stop_mcp_server() -> Result<McpStatusPayload, String> {
    let child_ref = mcp_child();
    let mut child_slot = child_ref.lock().map_err(|error| error.to_string())?;
    if let Some(child) = child_slot.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *child_slot = None;
    Ok(mcp_status_payload(
        true,
        false,
        "stdio",
        "MCP server stopped",
    ))
}

#[tauri::command]
pub fn get_mcp_status() -> Result<McpStatusPayload, String> {
    let child_ref = mcp_child();
    let mut child_slot = child_ref.lock().map_err(|error| error.to_string())?;
    let running = if let Some(child) = child_slot.as_mut() {
        child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
    } else {
        false
    };
    if !running {
        *child_slot = None;
    }
    Ok(mcp_status_payload(
        true,
        running,
        "stdio",
        if running {
            "MCP server running"
        } else {
            "MCP server idle"
        },
    ))
}

#[cfg(target_os = "macos")]
#[cfg(test)]
mod golden_tests {
    use super::*;

    /// specs 稳定性：40 条工具、名称序列与顺序完全冻结（前端 tools/list 契约）。
    #[test]
    fn mcp_tool_specs_are_frozen() {
        let specs = mcp_tool_specs();
        assert_eq!(specs.len(), 40);
        let names: Vec<&str> = specs.iter().map(|spec| spec.name).collect();
        assert_eq!(
            names,
            vec![
                "clipboard.context.get",
                "clipboard.context.compose",
                "clipboard.context.live",
                "clipboard.context.collectors.list",
                "clipboard.context.collector.contract",
                "clipboard.context.collector.debug",
                "clipboard.content.parse",
                "clipboard.capture",
                "clipboard.update",
                "clipboard.copy",
                "clipboard.search",
                "clipf.settings.get",
                "clipf.settings.patch",
                "clipf.settings.replace",
                "clipf.settings.reset",
                "clipf.agent.providers",
                "clipf.agent.check",
                "clipf.agent.models",
                "clipboard.skill.list",
                "clipboard.skill.save_draft",
                "clipboard.skill.run",
                "clipboard.plugin.list",
                "clipboard.plugin.call",
                "clipboard.agent.run",
                "clipboard.editor.context",
                "clipboard.editor.preview_patch",
                "clipboard.editor.apply_patch",
                "clipboard.editor.save",
                "clipboard.editor.render_template",
                "clipboard.editor.suggest_update",
                "clipf.capture",
                "clipf.get",
                "clipf.list",
                "clipf.search",
                "clipf.analyze",
                "clipf.copy",
                "clipf.update",
                "clipf.delete",
                "clipf.export",
                "clipf.import",
            ]
        );
    }

    /// tools/list 输出形状稳定：name/description/inputSchema 三键齐备。
    #[test]
    fn mcp_tools_payload_shape_is_stable() {
        let tools = mcp_tools();
        assert_eq!(tools.len(), 40);
        for tool in &tools {
            assert!(tool.get("name").is_some_and(Value::is_string));
            assert!(tool.get("description").is_some_and(Value::is_string));
            assert!(tool.get("inputSchema").is_some());
        }
    }

    /// 错误分类契约：mcp_error_hint 的子串匹配是前端提示的分类依据，逐字节保留。
    #[test]
    fn mcp_error_hint_classification_is_stable() {
        assert_eq!(
            mcp_error_hint("clipf.get requires id"),
            "Provide a valid ClipForge item id, for example {\"id\":\"clip_xxx\"}."
        );
        assert_eq!(
            mcp_error_hint("clipboard.copy requires text or id"),
            "Provide either text or id. Prefer id when operating on an existing clipboard item."
        );
        assert_eq!(
            mcp_error_hint("clipboard.capture requires content"),
            "Provide content as a string."
        );
        // 修复:先判 "requires ids"(长串)再判 "requires id",ids 提示可达
        assert_eq!(
            mcp_error_hint("clipf.delete requires ids"),
            "Provide ids as an array, for example {\"ids\":[\"clip_xxx\"]}."
        );
        assert_eq!(
            mcp_error_hint("unknown tool: x"),
            "Use the clipf.* tool namespace. Call tools/list before choosing a tool."
        );
        assert_eq!(
            mcp_error_hint("anything else"),
            "Check the tool input schema and retry with the required arguments."
        );
    }
}
