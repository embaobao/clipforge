//! Agent 上下文与 prompt 组装（从 lib.rs 迁入，modularity Phase 4）：上下文摘要压缩、
//! application context 摘要、context set 摘要、prompt 拼装与 AgentRunPayload 初始构建。
//! 全部为纯函数（只读 serde_json Value），供 run.rs / mcp dispatch 复用。

use serde_json::Value;

use super::provider::command_preview;
use super::{AgentDetectCandidate, AgentInvocationConfig, AgentRunPayload};
use crate::now_millis;

pub(crate) fn agent_trace_id(prefix: &str) -> String {
    now_millis()
        .map(|ts| format!("{prefix}_{ts}"))
        .unwrap_or_else(|_| format!("{prefix}_unknown"))
}

pub(crate) fn compact_agent_text(value: &str, max: usize) -> String {
    let text = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= max {
        text
    } else {
        let mut out = text.chars().take(max.saturating_sub(1)).collect::<String>();
        out.push('…');
        out
    }
}

pub(crate) fn agent_application_context_summary(reference: &Value) -> String {
    let Some(context) = reference.get("applicationContext") else {
        return String::new();
    };
    let mut fields = Vec::new();
    if let Some(kind) = context.get("kind").and_then(Value::as_str) {
        fields.push(format!("kind={kind}"));
    }
    if let Some(title) = context
        .get("window")
        .and_then(|window| window.get("title"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        fields.push(format!("window={}", compact_agent_text(title, 120)));
    }
    if let Some(browser) = context.get("browser") {
        if let Some(url) = browser.get("url").and_then(Value::as_str) {
            fields.push(format!("url={}", compact_agent_text(url, 180)));
        }
        if let Some(title) = browser.get("title").and_then(Value::as_str) {
            fields.push(format!("page={}", compact_agent_text(title, 100)));
        }
    }
    for (label, key) in [("workspace", "workspace"), ("document", "document")] {
        if let Some(value) = context
            .get(key)
            .and_then(|item| item.get("path").or_else(|| item.get("name")))
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            fields.push(format!("{label}={}", compact_agent_text(value, 140)));
        }
    }
    if let Some(selection) = context.get("selection") {
        let count = selection.get("count").and_then(Value::as_u64).unwrap_or(0);
        let first_path = selection
            .get("paths")
            .and_then(Value::as_array)
            .and_then(|paths| paths.first())
            .and_then(Value::as_str)
            .unwrap_or("");
        if count > 0 {
            fields.push(format!(
                "selectionCount={count}{}",
                if first_path.is_empty() {
                    String::new()
                } else {
                    format!(" first={}", compact_agent_text(first_path, 120))
                }
            ));
        }
    }
    if fields.is_empty() {
        String::new()
    } else {
        fields.join(" ")
    }
}

pub(crate) fn agent_context_summary(context_set: &Value, allow_full_content: bool) -> String {
    let mode = context_set
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("current");
    let references = context_set
        .get("references")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if references.is_empty() {
        return format!("mode={mode}; references=0");
    }
    let lines = references
        .iter()
        .take(20)
        .enumerate()
        .map(|(index, reference)| {
            let title = reference
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("untitled");
            let payload_kind = reference
                .get("payloadKind")
                .and_then(Value::as_str)
                .unwrap_or("text");
            let permission = reference
                .get("permissionScope")
                .and_then(Value::as_str)
                .unwrap_or("summary");
            let url = reference
                .get("primaryUrl")
                .and_then(Value::as_str)
                .unwrap_or("");
            let tags = reference
                .get("tags")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .take(8)
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .unwrap_or_default();
            let preview_key = if allow_full_content {
                "textPreview"
            } else {
                "summary"
            };
            let preview = reference
                .get(preview_key)
                .and_then(Value::as_str)
                .or_else(|| reference.get("textPreview").and_then(Value::as_str))
                .unwrap_or("");
            let application_context = agent_application_context_summary(reference);
            format!(
                "{}. [{} permission={}] {} url={} context={} tags={} preview={}",
                index + 1,
                payload_kind,
                permission,
                compact_agent_text(title, 80),
                compact_agent_text(url, 120),
                compact_agent_text(&application_context, 420),
                tags,
                compact_agent_text(preview, if allow_full_content { 1200 } else { 240 })
            )
        })
        .collect::<Vec<_>>();
    format!(
        "mode={mode}; references={}\n{}",
        references.len(),
        lines.join("\n")
    )
}

pub(crate) fn agent_context_foreground_clip_id(context_set: &Value) -> Option<String> {
    context_set
        .get("references")
        .and_then(Value::as_array)
        .and_then(|references| references.first())
        .and_then(|reference| reference.get("clipId"))
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .map(ToString::to_string)
}

pub(crate) fn compose_agent_prompt(input: &AgentInvocationConfig) -> String {
    let allow_full_content = input.allow_full_content.unwrap_or(false);
    [
        "You are ClipForge's clipboard agent runtime.".to_string(),
        "Use only the structured context below. Do not assume hidden clipboard content.".to_string(),
        "Write operations must be returned as suggestions unless the user confirms a visible action.".to_string(),
        "".to_string(),
        "Context snapshot:".to_string(),
        agent_context_summary(&input.context_set, allow_full_content),
        "".to_string(),
        "User request:".to_string(),
        input.prompt.clone(),
    ]
    .join("\n")
}

pub(super) fn build_agent_run_payload(
    run_id: String,
    provider: &AgentDetectCandidate,
    prompt: &str,
    context_set: &Value,
    status: &str,
    now: i64,
    allow_full_content: bool,
) -> AgentRunPayload {
    AgentRunPayload {
        id: run_id,
        conversation_id: context_set
            .get("id")
            .and_then(Value::as_str)
            .map(|id| format!("conversation:{id}"))
            .unwrap_or_else(|| "conversation:current".to_string()),
        provider_id: provider.provider_id.clone(),
        status: status.to_string(),
        prompt_preview: compact_agent_text(prompt, 240),
        command_preview: command_preview(provider),
        context_summary: agent_context_summary(context_set, allow_full_content),
        output: String::new(),
        error_code: None,
        error_message: None,
        exit_code: None,
        created_at: now,
        updated_at: now,
        started_at: None,
        finished_at: None,
        duration_ms: None,
    }
}
