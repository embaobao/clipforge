//! Agent 事件与输出流处理（从 lib.rs 迁入，modularity Phase 4）：redacted 事件日志、
//! transcript 行插入、AG-UI 事件发射（agent_agui_event/agent_ui_message）、openai-compatible
//! python 桥脚本与 stdout/stderr reader 线程（8 行/2048B/120ms 批量阈值逐字节保留）。

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read};
use std::thread;
use std::time::Duration;
use tauri::Emitter;

use super::context::{agent_trace_id, compact_agent_text};
use super::run::append_agent_output;
use super::{
    AgentAgUiEventPayload, AgentRunPayload, AgentTranscriptRowPayload, AgentUiMessagePayload,
};
use crate::{log_to_file, now_millis};

pub(crate) fn log_agent_event(event: &str, run: &AgentRunPayload, extra: Value) {
    let snapshot = json!({
        "event": event,
        "runId": run.id,
        "conversationId": run.conversation_id,
        "providerId": run.provider_id,
        "status": run.status,
        "promptPreviewLength": run.prompt_preview.chars().count(),
        "contextSummaryLength": run.context_summary.chars().count(),
        "outputLength": run.output.chars().count(),
        "errorCode": run.error_code,
        "exitCode": run.exit_code,
        "durationMs": run.duration_ms,
        "redactedFields": ["prompt", "output", "contextSummary", "commandPreview"],
        "extra": extra,
    });
    log_to_file("info", "agent-runtime", &snapshot.to_string());
}

pub(crate) fn insert_agent_transcript(
    run_id: &str,
    kind: &str,
    text: &str,
    scroll_anchor: bool,
) -> AgentTranscriptRowPayload {
    AgentTranscriptRowPayload {
        id: agent_trace_id("agent_row"),
        run_id: run_id.to_string(),
        kind: kind.to_string(),
        text: text.to_string(),
        scroll_anchor,
        created_at: now_millis().unwrap_or(0),
    }
}

pub(crate) fn emit_agent_ui_message<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    run_id: &str,
    role: &str,
    text: &str,
    status: Option<&str>,
) {
    let message_id = format!("{role}:{run_id}");
    let event_type = if text.is_empty() {
        "STATE_DELTA"
    } else if matches!(status, Some("succeeded" | "failed" | "cancelled")) {
        "STATE_DELTA"
    } else {
        "TEXT_MESSAGE_CONTENT"
    };
    let event = AgentAgUiEventPayload {
        run_id: run_id.to_string(),
        message_id,
        event_type: event_type.to_string(),
        role: role.to_string(),
        text: if text.is_empty() {
            None
        } else {
            Some(text.to_string())
        },
        status: status.map(str::to_string),
        tool_name: None,
        arguments_preview: None,
        result_preview: None,
        custom_event: None,
        custom_payload: None,
        created_at: now_millis().unwrap_or(0),
    };
    emit_agent_agui_event(app, event);
}

pub(super) fn agent_agui_event_parts(event: &AgentAgUiEventPayload) -> Value {
    let mut parts = Vec::new();
    if let Some(text) = event.text.as_deref() {
        parts.push(json!({ "type": "text", "text": text }));
    }
    match event.event_type.as_str() {
        "TOOL_CALL" => {
            if let Some(name) = event.tool_name.as_deref() {
                parts.push(json!({
                    "type": "data-tool-call",
                    "data": {
                        "name": name,
                        "argumentsPreview": event.arguments_preview.as_deref().unwrap_or(""),
                        "status": event.status.as_deref().unwrap_or("running")
                    }
                }));
            }
        }
        "TOOL_RESULT" => {
            if let Some(name) = event.tool_name.as_deref() {
                parts.push(json!({
                    "type": "data-tool-result",
                    "data": {
                        "name": name,
                        "resultPreview": event.result_preview.as_deref().unwrap_or(""),
                        "status": event.status.as_deref().unwrap_or("succeeded")
                    }
                }));
            }
        }
        "CUSTOM" => {
            if let Some(custom_event) = event.custom_event.as_deref() {
                parts.push(json!({
                    "type": "data-custom",
                    "data": {
                        "event": custom_event,
                        "payload": event.custom_payload.clone().unwrap_or_else(|| json!({}))
                    }
                }));
            }
        }
        _ => {}
    }
    if let Some(status) = event.status.as_deref() {
        parts.push(json!({
            "type": "data-status",
            "data": { "status": status }
        }));
    }
    Value::Array(parts)
}

fn emit_agent_agui_event<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    event: AgentAgUiEventPayload,
) {
    let parts = agent_agui_event_parts(&event);
    let payload = AgentUiMessagePayload {
        run_id: event.run_id.clone(),
        message_id: event.message_id.clone(),
        role: event.role.clone(),
        parts,
        metadata: json!({
            "conversationId": format!("conversation:{}", event.run_id),
            "runId": event.run_id.clone(),
            "createdAt": event.created_at,
            "aguiEventType": event.event_type.clone(),
        }),
    };
    let _ = app.emit("agent_agui_event", &event);
    let _ = app.emit("agent_ui_message", payload);
}

pub(crate) enum AgentOutputMode {
    PlainText,
    StandardJsonEvents,
}

pub(super) fn openai_compatible_bridge_script() -> &'static str {
    r#"
import json
import os
import sys
import urllib.error
import urllib.request

def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)

try:
    config = json.loads(sys.stdin.read())
    base_url = (config.get("baseUrl") or "https://api.openai.com/v1").rstrip("/")
    model = config["modelId"]
    api_key_env = config.get("apiKeyEnv") or "CLIPFORGE_AGENT_OPENAI_API_KEY"
    api_key = config.get("apiKey") or os.environ.get(api_key_env, "")
    if not api_key:
        emit({"type": "error", "message": api_key_env + " is not set"})
        sys.exit(2)
    body = {
        "model": model,
        "stream": True,
        "messages": [
            {"role": "system", "content": "You are ClipForge's clipboard agent runtime. Return concise, actionable output."},
            {"role": "user", "content": config.get("prompt", "")},
        ],
    }
    request = urllib.request.Request(
        base_url + "/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=int(config.get("timeoutSeconds", 120))) as response:
        for raw in response:
            line = raw.decode("utf-8", "replace").strip()
            if not line or not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            chunk = json.loads(data)
            for choice in chunk.get("choices", []):
                delta = choice.get("delta", {})
                content = delta.get("content")
                if content:
                    emit({"type": "text", "delta": content})
                for tool_call in delta.get("tool_calls", []) or []:
                    function = tool_call.get("function", {}) or {}
                    emit({
                        "type": "tool_call",
                        "name": function.get("name") or tool_call.get("id") or "tool_call",
                        "argumentsPreview": function.get("arguments") or "",
                    })
except urllib.error.HTTPError as error:
    detail = error.read().decode("utf-8", "replace")
    emit({"type": "error", "message": "OpenAI-compatible HTTP error", "status": error.code, "detail": detail[:1000]})
    sys.exit(1)
except Exception as error:
    emit({"type": "error", "message": str(error)})
    sys.exit(1)
"#
}

pub(crate) fn handle_standard_agent_event<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    run_id: &str,
    line: &str,
) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return false;
    };
    match value.get("type").and_then(Value::as_str).unwrap_or("") {
        "text" => {
            let text = value
                .get("delta")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if text.is_empty() {
                return true;
            }
            append_agent_output(run_id, &text, false);
            emit_agent_ui_message(app, run_id, "assistant", &text, Some("streaming"));
            let _ = app.emit(
                "agent_message_delta",
                json!({ "runId": run_id, "stream": "stdout", "text": text }),
            );
            true
        }
        "tool_call" => {
            let event = AgentAgUiEventPayload {
                run_id: run_id.to_string(),
                message_id: format!("assistant:{run_id}"),
                event_type: "TOOL_CALL".to_string(),
                role: "assistant".to_string(),
                text: None,
                status: Some("running".to_string()),
                tool_name: value
                    .get("name")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                arguments_preview: value
                    .get("argumentsPreview")
                    .and_then(Value::as_str)
                    .map(|text| compact_agent_text(text, 800)),
                result_preview: None,
                custom_event: None,
                custom_payload: None,
                created_at: now_millis().unwrap_or(0),
            };
            emit_agent_agui_event(app, event);
            true
        }
        "tool_result" => {
            let event = AgentAgUiEventPayload {
                run_id: run_id.to_string(),
                message_id: format!("assistant:{run_id}"),
                event_type: "TOOL_RESULT".to_string(),
                role: "tool".to_string(),
                text: None,
                status: Some(
                    value
                        .get("status")
                        .and_then(Value::as_str)
                        .unwrap_or("succeeded")
                        .to_string(),
                ),
                tool_name: value
                    .get("name")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                arguments_preview: None,
                result_preview: value
                    .get("resultPreview")
                    .and_then(Value::as_str)
                    .map(|text| compact_agent_text(text, 800)),
                custom_event: None,
                custom_payload: None,
                created_at: now_millis().unwrap_or(0),
            };
            emit_agent_agui_event(app, event);
            true
        }
        "error" => {
            let message = value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("OpenAI-compatible provider error");
            append_agent_output(run_id, message, true);
            emit_agent_ui_message(app, run_id, "assistant", message, Some("failed"));
            true
        }
        _ => false,
    }
}

pub(crate) fn spawn_agent_output_reader<R, T>(
    app: tauri::AppHandle<R>,
    run_id: String,
    stream: &'static str,
    reader: T,
    stderr: bool,
    mode: AgentOutputMode,
) where
    R: tauri::Runtime,
    T: Read + Send + 'static,
{
    thread::spawn(move || {
        let reader = BufReader::new(reader);
        let mut buffered = Vec::<String>::new();
        let mut last_emit = std::time::Instant::now();
        let flush = |items: &mut Vec<String>| {
            if items.is_empty() {
                return;
            }
            let text = items.join("\n");
            items.clear();
            append_agent_output(&run_id, &text, stderr);
            emit_agent_ui_message(&app, &run_id, "assistant", &text, Some("streaming"));
            let _ = app.emit(
                "agent_message_delta",
                json!({ "runId": run_id, "stream": stream, "text": text }),
            );
        };
        for line in reader.lines().map_while(Result::ok) {
            if matches!(mode, AgentOutputMode::StandardJsonEvents)
                && !stderr
                && handle_standard_agent_event(&app, &run_id, &line)
            {
                continue;
            }
            buffered.push(line);
            let buffered_len: usize = buffered.iter().map(|item| item.len()).sum();
            if buffered.len() >= 8
                || buffered_len >= 2048
                || last_emit.elapsed() >= Duration::from_millis(120)
            {
                flush(&mut buffered);
                last_emit = std::time::Instant::now();
            }
        }
        flush(&mut buffered);
    });
}
