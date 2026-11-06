//! MCP 上下文快照与解析辅助（从 lib.rs 迁入，modularity Phase 4）：context reference /
//! snapshot 构建、剪贴板内容候选解析（parse-only 决策）、tags 参数清洗、editor 上下文快照与
//! #tag 提取。纯函数 + golden 用例（context_snapshot_tests 迁入）。

use super::mcp_trace_id;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;

use crate::agent::compact_agent_text;
use crate::{log_to_file, CaptureContextPayload, ClipItemPayload, PANEL_PINNED};

pub(crate) fn capture_context_url(context: &CaptureContextPayload) -> Option<&str> {
    context
        .application_context
        .as_ref()
        .and_then(|value| value.get("browser"))
        .and_then(|browser| browser.get("url"))
        .and_then(Value::as_str)
}

pub(crate) fn mcp_context_reference(item: &ClipItemPayload, include_content: bool) -> Value {
    json!({
        "id": format!("clip:{}", item.id),
        "source": "clip",
        "clipId": item.id,
        "title": item.analysis.title,
        "summary": compact_agent_text(&item.analysis.summary, 320),
        "payloadKind": item.payload_kind,
        "primaryUrl": item.analysis.url.as_deref().or_else(|| capture_context_url(&item.capture_context)),
        "textPreview": compact_agent_text(&item.content, if include_content { 2000 } else { 240 }),
        "tags": item.tags,
        "sourceAppName": item.source_app.as_ref().map(|source| source.name.clone()),
        "applicationContext": item.capture_context.application_context,
        "permissionScope": if include_content { "current-content" } else { "summary" },
        "contentLength": item.content.chars().count(),
        "captureContext": {
            "schemaVersion": item.capture_context.schema_version,
            "surface": item.capture_context.surface,
            "sourceLabel": item.capture_context.source_label,
            "sourceApp": item.capture_context.source_app,
            "observedAt": item.capture_context.observed_at,
            "primaryFormat": item.capture_context.primary_format,
            "availableFormats": item.capture_context.available_formats,
            "applicationContext": item.capture_context.application_context,
            "collectors": item.capture_context.collectors,
            "environment": item.capture_context.environment,
        },
        "provenance": {
            "agentContext": item.agent_context,
            "source": item.source,
            "bucket": item.bucket,
        }
    })
}

pub(crate) fn mcp_context_snapshot(item: &ClipItemPayload, include_content: bool) -> Value {
    let trace_id = mcp_trace_id();
    log_to_file(
        "info",
        "mcp-context-snapshot",
        &format!(
            "traceId={} contextSchema=ClipboardContextSnapshot.v1 clipId={} payloadKind={} includeContent={} contentLength={} tagCount={} sourceApp={}",
            trace_id,
            item.id,
            item.payload_kind,
            include_content,
            item.content.chars().count(),
            item.tags.len(),
            item.source_app
                .as_ref()
                .map(|source| source.name.as_str())
                .unwrap_or("")
        ),
    );
    json!({
        "schemaVersion": 1,
        "clip": mcp_context_reference(item, include_content),
        "permission": {
            "includeContent": include_content,
            "redactedFields": if include_content { Vec::<&str>::new() } else { vec!["content"] },
            "decision": if include_content { "user-authorized-content" } else { "summary-only" }
        },
        "trace": {
            "traceId": trace_id,
            "contextSchema": "ClipboardContextSnapshot.v1"
        }
    })
}

#[cfg(test)]
mod context_snapshot_tests {
    use super::*;
    use crate::{ClipAnalysisPayload, ClipboardRepresentationPayload, SourceAppPayload};

    fn test_clip(id: &str, content: &str, payload_kind: &str) -> ClipItemPayload {
        ClipItemPayload {
            id: id.to_string(),
            content: content.to_string(),
            content_hash: format!("hash-{id}"),
            created_at: 1,
            updated_at: 1,
            last_seen_at: 1,
            last_copied_at: None,
            source: "clipboard".to_string(),
            kind: payload_kind.to_string(),
            bucket: "history".to_string(),
            favorite: false,
            tags: vec!["AI".to_string(), "work".to_string()],
            copy_count: 0,
            analysis: ClipAnalysisPayload {
                source_name: "Example".to_string(),
                badge: "TXT".to_string(),
                title: format!("Title {id}"),
                summary: "Safe summary".to_string(),
                url: content
                    .split_whitespace()
                    .find(|part| part.starts_with("https://"))
                    .map(ToString::to_string),
                host: Some("example.com".to_string()),
                is_markdown: payload_kind == "markdown",
            },
            payload_kind: payload_kind.to_string(),
            primary_format: if payload_kind == "markdown" {
                "text/markdown"
            } else {
                "text/plain"
            }
            .to_string(),
            available_formats: vec!["text/plain".to_string()],
            representations: vec![ClipboardRepresentationPayload {
                format: "text/plain".to_string(),
                storage: "inline".to_string(),
                content: Some(content.to_string()),
                file_name: None,
                size: Some(content.len() as i64),
                hash: Some(format!("hash-{id}")),
                preferred: true,
            }],
            plain_text: content.to_string(),
            search_text: Some(content.to_string()),
            sub_kind: None,
            width: None,
            height: None,
            size: Some(content.len() as i64),
            file_types: if payload_kind == "file" {
                Some("txt".to_string())
            } else {
                None
            },
            thumbnail_path: None,
            image_file: None,
            is_sensitive: false,
            capture_context: CaptureContextPayload {
                schema_version: 1,
                surface: "unit-test".to_string(),
                source_label: "Unit Test".to_string(),
                source_app: Some(json!({ "name": "Safari", "bundleId": "com.apple.Safari" })),
                application_context: Some(json!({
                    "kind": "browser",
                    "browser": { "url": "https://example.com", "title": "Example" }
                })),
                collectors: json!({ "status": "complete", "results": [], "diagnostics": [] }),
                observed_at: 1,
                primary_format: "text/plain".to_string(),
                available_formats: vec!["text/plain".to_string()],
                environment: json!({ "platform": "test" }),
            },
            metadata: json!({ "note": "metadata is safe" }),
            agent_context: json!({ "generatedBy": "agent", "conversationId": "conv-test" }),
            source_app: Some(SourceAppPayload {
                name: "Safari".to_string(),
                bundle_id: "com.apple.Safari".to_string(),
                executable_path: "/Applications/Safari.app".to_string(),
                icon_base64: None,
            }),
        }
    }

    #[test]
    fn context_snapshot_covers_source_link_markdown_file_and_long_text() {
        let link = test_clip("link", "https://example.com/a?b=1", "link");
        let link_snapshot = mcp_context_snapshot(&link, false);
        assert_eq!(link_snapshot["schemaVersion"], 1);
        assert_eq!(link_snapshot["clip"]["sourceAppName"], "Safari");
        assert_eq!(
            link_snapshot["clip"]["primaryUrl"],
            "https://example.com/a?b=1"
        );
        assert_eq!(
            link_snapshot["clip"]["applicationContext"]["browser"]["url"],
            "https://example.com"
        );
        assert_eq!(
            link_snapshot["clip"]["captureContext"]["sourceApp"]["name"],
            "Safari"
        );
        assert_eq!(
            link_snapshot["clip"]["captureContext"]["environment"]["platform"],
            "test"
        );
        assert_eq!(link_snapshot["clip"]["tags"][0], "AI");
        assert_eq!(
            link_snapshot["clip"]["provenance"]["agentContext"]["generatedBy"],
            "agent"
        );
        assert_eq!(link_snapshot["permission"]["decision"], "summary-only");
        assert_eq!(link_snapshot["permission"]["redactedFields"][0], "content");

        let markdown = test_clip("markdown", "# Heading\n\n- item", "markdown");
        let markdown_snapshot = mcp_context_snapshot(&markdown, false);
        assert_eq!(markdown_snapshot["clip"]["payloadKind"], "markdown");
        assert_eq!(
            markdown_snapshot["clip"]["captureContext"]["primaryFormat"],
            "text/plain"
        );

        let file = test_clip("file", "/Users/example/report.txt", "file");
        let file_snapshot = mcp_context_snapshot(&file, false);
        assert_eq!(file_snapshot["clip"]["payloadKind"], "file");
        assert_eq!(file_snapshot["clip"]["contentLength"], 25);

        let long_content = "0123456789 ".repeat(80);
        let long_item = test_clip("long", &long_content, "text");
        let summary_snapshot = mcp_context_snapshot(&long_item, false);
        let full_snapshot = mcp_context_snapshot(&long_item, true);
        assert!(
            summary_snapshot["clip"]["textPreview"]
                .as_str()
                .unwrap()
                .chars()
                .count()
                <= 240
        );
        assert_eq!(
            full_snapshot["permission"]["decision"],
            "user-authorized-content"
        );
        assert!(full_snapshot["permission"]["redactedFields"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(
            full_snapshot["clip"]["textPreview"]
                .as_str()
                .unwrap()
                .chars()
                .count()
                > summary_snapshot["clip"]["textPreview"]
                    .as_str()
                    .unwrap()
                    .chars()
                    .count()
        );
    }
}

pub(crate) fn parse_clipboard_content_candidates(content: &str) -> Value {
    let trimmed = content.trim();
    let mut candidates = Vec::new();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        candidates.push(json!({ "type": "url", "value": trimmed, "confidence": "high" }));
    }
    if trimmed.starts_with('/') || trimmed.starts_with("~/") || trimmed.contains(":\\") {
        candidates.push(json!({ "type": "file-path", "value": compact_agent_text(trimmed, 500), "confidence": "medium" }));
    }
    if serde_json::from_str::<Value>(trimmed).is_ok() {
        candidates.push(json!({ "type": "json", "value": "valid-json", "confidence": "high" }));
    }
    for line in trimmed.lines().take(80) {
        let line_trimmed = line.trim();
        if line_trimmed.starts_with("```") {
            candidates.push(
                json!({ "type": "code-block", "value": "markdown-fence", "confidence": "medium" }),
            );
        }
        if line_trimmed.starts_with("http://") || line_trimmed.starts_with("https://") {
            candidates.push(json!({ "type": "url", "value": line_trimmed, "confidence": "high" }));
        }
        if line_trimmed.contains("Error:")
            || line_trimmed.contains("Exception")
            || line_trimmed.contains("Traceback")
        {
            candidates.push(json!({ "type": "error-log", "value": compact_agent_text(line_trimmed, 500), "confidence": "high" }));
        }
        if line_trimmed.starts_with('$')
            || line_trimmed.starts_with("pnpm ")
            || line_trimmed.starts_with("cargo ")
            || line_trimmed.starts_with("npm ")
        {
            candidates.push(json!({ "type": "command", "value": compact_agent_text(line_trimmed, 500), "confidence": "medium" }));
        }
        if line_trimmed.contains("](") && line_trimmed.contains(')') {
            candidates.push(json!({ "type": "markdown-link", "value": compact_agent_text(line_trimmed, 500), "confidence": "medium" }));
        }
    }
    candidates.dedup_by(|a, b| a == b);
    json!({
        "schemaVersion": 1,
        "contentLength": content.chars().count(),
        "candidates": candidates,
        "permissionDecision": {
            "decision": "parse-only",
            "reason": "Candidates are metadata only and are not executed."
        }
    })
}

pub(crate) fn json_tags_arg(args: &Value, fallback: &[String]) -> Vec<String> {
    args.get("tags")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|tag| {
                    tag.trim()
                        .trim_start_matches('#')
                        .trim_start_matches("tag:")
                        .trim()
                        .to_string()
                })
                .filter(|tag| !tag.is_empty())
                .take(12)
                .collect::<Vec<_>>()
        })
        .filter(|tags| !tags.is_empty())
        .unwrap_or_else(|| fallback.to_vec())
}

pub(crate) fn editor_context_snapshot(item: &ClipItemPayload, args: &Value) -> Value {
    let content = args
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or(&item.content);
    let tags = json_tags_arg(args, &item.tags);
    let session_id = args
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or("mcp-editor-session");
    let draft_version = args
        .get("draftVersion")
        .and_then(Value::as_i64)
        .unwrap_or(1);
    json!({
        "schemaVersion": 1,
        "clip": {
            "id": item.id,
            "kind": item.kind,
            "payloadKind": item.payload_kind,
            "title": item.analysis.title,
            "summary": item.analysis.summary,
            "tags": item.tags,
            "sourceAppName": item.source_app.as_ref().map(|source| source.name.clone())
        },
        "editor": {
            "sessionId": session_id,
            "draftVersion": draft_version,
            "format": item.payload_kind,
            "selectionText": "",
            "contentLength": content.chars().count(),
            "tags": tags,
            "suggestedTags": extract_hash_tags(content),
            "dirty": content != item.content || tags != item.tags
        },
        "runtime": {
            "platform": std::env::consts::OS,
            "route": "/clip/$clipId",
            "activeView": "detail",
            "panelPinned": PANEL_PINNED.load(Ordering::Relaxed)
        },
        "permission": {
            "exposeFullContent": false,
            "redactedFields": ["previousClipboard.content", "sourceApp.executablePath"]
        }
    })
}

pub(crate) fn extract_hash_tags(content: &str) -> Vec<String> {
    let mut tags = Vec::new();
    for word in content.split_whitespace() {
        let tag = word
            .trim_matches(|ch: char| !ch.is_alphanumeric() && ch != '#' && ch != '_' && ch != '-')
            .trim_start_matches('#')
            .trim();
        if tag.is_empty()
            || tag.len() > 32
            || tags
                .iter()
                .any(|current: &String| current.eq_ignore_ascii_case(tag))
        {
            continue;
        }
        tags.push(tag.to_string());
        if tags.len() >= 12 {
            break;
        }
    }
    tags
}
