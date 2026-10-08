//! MCP skill / plugin / agent / editor 工具臂（从 lib.rs 迁入，modularity Phase 4）：
//! skill 三臂（frontend-local-private 契约）、plugin 两臂（builtin manifest 与动作解析）、
//! agent.run（prepare-only，不自动启动）、editor 六臂（context/preview_patch/apply_patch/
//! save/render_template/suggest_update）。臂内确认语义与错误码逐字节保留。

use serde_json::{json, Value};

use super::context::{editor_context_snapshot, extract_hash_tags, json_tags_arg};
use super::envelope::{builtin_plugin_manifests_value, first_safe_http_url};
use crate::agent::{
    agent_prepare_run_impl, agent_trace_id, compact_agent_text, AgentInvocationConfig,
};
use crate::{init_schema, load_clip, open_clip_db, save_editor_draft, SaveEditorDraftInput};

pub(super) fn dispatch_skill_list() -> Value {
    json!({
        "skills": [],
        "source": "frontend-local-private-skills",
        "message": "Private skill drafts stay in the visible frontend store unless the user confirms native persistence."
    })
}

pub(super) fn dispatch_skill_save_draft(args: &Value) -> Result<Value, (i64, String)> {
    let name = args.get("name").and_then(Value::as_str).ok_or_else(|| {
        (
            -32602,
            "clipboard.skill.save_draft requires name".to_string(),
        )
    })?;
    let prompt_template = args
        .get("promptTemplate")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            (
                -32602,
                "clipboard.skill.save_draft requires promptTemplate".to_string(),
            )
        })?;
    Ok(json!({
        "draft": {
            "id": agent_trace_id("skill_draft"),
            "name": name,
            "description": args.get("description").and_then(Value::as_str).unwrap_or(""),
            "promptTemplatePreview": compact_agent_text(prompt_template, 500),
            "requiresUserConfirmation": true
        }
    }))
}

pub(super) fn dispatch_skill_run(args: &Value) -> Result<Value, (i64, String)> {
    let context_set = args.get("contextSet").cloned().unwrap_or_else(|| json!({}));
    let trimmed_references = context_set
        .get("references")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .take(20)
                .map(|item| {
                    json!({
                        "id": item.get("id").and_then(Value::as_str).unwrap_or(""),
                        "source": item.get("source").and_then(Value::as_str).unwrap_or(""),
                        "clipId": item.get("clipId").and_then(Value::as_str).unwrap_or(""),
                        "title": item.get("title").and_then(Value::as_str).unwrap_or(""),
                        "summary": compact_agent_text(item.get("summary").and_then(Value::as_str).unwrap_or(""), 320),
                        "payloadKind": item.get("payloadKind").and_then(Value::as_str).unwrap_or(""),
                        "primaryUrl": item.get("primaryUrl").and_then(Value::as_str).unwrap_or(""),
                        "tags": item.get("tags").cloned().unwrap_or_else(|| json!([])),
                        "permissionScope": item.get("permissionScope").and_then(Value::as_str).unwrap_or("summary"),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(json!({
        "status": "prepared",
        "skillId": args.get("skillId").and_then(Value::as_str).unwrap_or(""),
        "trimmedContextSet": {
            "id": context_set.get("id").and_then(Value::as_str).unwrap_or(""),
            "mode": context_set.get("mode").and_then(Value::as_str).unwrap_or("current"),
            "references": trimmed_references,
            "limits": context_set.get("limits").cloned().unwrap_or_else(|| json!({}))
        },
        "permissionDecision": {
            "decision": "trimmed-summary-only",
            "reason": "clipboard.skill.run must carry explicit context scope; full content is not forwarded through MCP skill run."
        },
        "requiresUserConfirmation": true
    }))
}

pub(super) fn dispatch_plugin_list() -> Value {
    json!({
        "manifests": builtin_plugin_manifests_value(),
        "source": "builtin",
        "capabilitySchema": 1
    })
}

pub(super) fn dispatch_plugin_call(args: &Value) -> Result<Value, (i64, String)> {
    let plugin_id = args
        .get("pluginId")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            (
                -32602,
                "clipboard.plugin.call requires pluginId".to_string(),
            )
        })?;
    let action_id = args
        .get("actionId")
        .and_then(Value::as_str)
        .unwrap_or(match plugin_id {
            "builtin.open-link" => "open-link",
            "builtin.open-detail" => "open-detail",
            _ => "",
        });
    let loaded_item = if let Some(id) = args.get("id").and_then(Value::as_str) {
        let conn = open_clip_db().map_err(|error| (-32000, error))?;
        init_schema(&conn).map_err(|error| (-32000, error))?;
        Some(load_clip(&conn, id).map_err(|error| (-32000, error))?)
    } else {
        None
    };
    let content = args
        .get("content")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| loaded_item.as_ref().map(|item| item.content.clone()))
        .unwrap_or_default();
    let explicit_target = args.get("target").and_then(Value::as_str);
    match plugin_id {
        "builtin.open-link" => {
            let target = explicit_target
                .map(ToString::to_string)
                .or_else(|| {
                    loaded_item
                        .as_ref()
                        .and_then(|item| item.analysis.url.clone())
                })
                .or_else(|| first_safe_http_url(&content))
                .ok_or_else(|| {
                    (
                        -32602,
                        "builtin.open-link requires a safe http(s) target".to_string(),
                    )
                })?;
            Ok(json!({
                "status": "resolved",
                "pluginId": plugin_id,
                "actionId": action_id,
                "action": {
                    "type": "openUrl",
                    "target": target,
                    "requiresUserConfirmation": false
                },
                "execution": "preview-only",
                "parsedTargets": super::context::parse_clipboard_content_candidates(&content)
            }))
        }
        "builtin.open-detail" => Ok(json!({
            "status": "resolved",
            "pluginId": plugin_id,
            "actionId": action_id,
            "action": {
                "type": "navigateDetail",
                "clipId": loaded_item.as_ref().map(|item| item.id.clone()).unwrap_or_default(),
                "requiresUserConfirmation": false
            },
            "execution": "preview-only",
            "parsedTargets": super::context::parse_clipboard_content_candidates(&content)
        })),
        _ => Err((-32602, format!("unsupported pluginId: {plugin_id}"))),
    }
}

pub(super) fn dispatch_agent_run(args: &Value) -> Result<Value, (i64, String)> {
    let prompt = args
        .get("prompt")
        .and_then(Value::as_str)
        .ok_or_else(|| (-32602, "clipboard.agent.run requires prompt".to_string()))?
        .to_string();
    let prepared = agent_prepare_run_impl(AgentInvocationConfig {
        provider_id: args
            .get("providerId")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        prompt,
        context_set: args.get("contextSet").cloned().unwrap_or_else(|| json!({})),
        allow_full_content: args.get("allowFullContent").and_then(Value::as_bool),
    })
    .map_err(|error| (-32000, error))?;
    Ok(json!({
        "status": "prepared",
        "run": prepared.run,
        "requiresConfirmation": prepared.requires_confirmation,
        "execution": "not-started"
    }))
}

pub(super) fn dispatch_editor_context(args: &Value) -> Result<Value, (i64, String)> {
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| (-32602, "clipboard.editor.context requires id".to_string()))?;
    let conn = open_clip_db().map_err(|error| (-32000, error))?;
    init_schema(&conn).map_err(|error| (-32000, error))?;
    let item = load_clip(&conn, id).map_err(|error| (-32000, error))?;
    Ok(editor_context_snapshot(&item, &args))
}

pub(super) fn dispatch_editor_preview_patch(args: &Value) -> Result<Value, (i64, String)> {
    let id = args.get("id").and_then(Value::as_str).ok_or_else(|| {
        (
            -32602,
            "clipboard.editor.preview_patch requires id".to_string(),
        )
    })?;
    let conn = open_clip_db().map_err(|error| (-32000, error))?;
    init_schema(&conn).map_err(|error| (-32000, error))?;
    let item = load_clip(&conn, id).map_err(|error| (-32000, error))?;
    let replacement = args
        .get("replacement")
        .and_then(Value::as_str)
        .unwrap_or(&item.content);
    Ok(json!({
        "preview": {
            "id": agent_trace_id("editor_patch"),
            "sessionId": args.get("sessionId").and_then(Value::as_str).unwrap_or("mcp-editor-session"),
            "draftVersion": args.get("draftVersion").and_then(Value::as_i64).unwrap_or(1),
            "contentPatch": {
                "type": "replaceDocument",
                "beforeChars": item.content.chars().count(),
                "afterChars": replacement.chars().count(),
                "preview": compact_agent_text(replacement, 1200)
            },
            "tagPatch": args.get("tagPatch").cloned().unwrap_or_else(|| json!({ "add": [], "remove": [], "keep": item.tags })),
            "writesDatabase": false
        }
    }))
}

pub(super) fn dispatch_editor_apply_patch(
    name: &str,
    args: &Value,
) -> Result<Value, (i64, String)> {
    if name == "clipboard.editor.apply_patch"
        && args.get("confirmed").and_then(Value::as_bool) != Some(true)
    {
        return Err((
            -32602,
            "clipboard.editor.apply_patch requires confirmed=true".to_string(),
        ));
    }
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| (-32602, format!("{name} requires id")))?
        .to_string();
    let content = args
        .get(if name == "clipboard.editor.apply_patch" {
            "replacement"
        } else {
            "content"
        })
        .and_then(Value::as_str)
        .ok_or_else(|| (-32602, format!("{name} requires content")))?;
    let conn = open_clip_db().map_err(|error| (-32000, error))?;
    init_schema(&conn).map_err(|error| (-32000, error))?;
    let item = load_clip(&conn, &id).map_err(|error| (-32000, error))?;
    let saved = save_editor_draft(SaveEditorDraftInput {
        id,
        session_id: args
            .get("sessionId")
            .and_then(Value::as_str)
            .unwrap_or("mcp-editor-session")
            .to_string(),
        draft_version: args
            .get("draftVersion")
            .and_then(Value::as_i64)
            .unwrap_or(1),
        content: content.to_string(),
        tags: json_tags_arg(&args, &item.tags),
        metadata: Some(json!({ "surface": "mcp", "tool": name })),
    })
    .map_err(|error| (-32000, error))?;
    serde_json::to_value(saved).map_err(|error| (-32000, error.to_string()))
}

pub(super) fn dispatch_editor_render_template(args: &Value) -> Result<Value, (i64, String)> {
    let mut rendered = args
        .get("template")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            (
                -32602,
                "clipboard.editor.render_template requires template".to_string(),
            )
        })?
        .to_string();
    if let Some(vars) = args.get("variables").and_then(Value::as_object) {
        for (key, value) in vars {
            let token = format!("{{{{{key}}}}}");
            let replacement = value
                .as_str()
                .map(ToString::to_string)
                .unwrap_or_else(|| value.to_string());
            rendered = rendered.replace(&token, &replacement);
        }
    }
    Ok(json!({ "rendered": rendered, "chars": rendered.chars().count() }))
}

pub(super) fn dispatch_editor_suggest_update(args: &Value) -> Result<Value, (i64, String)> {
    let id = args.get("id").and_then(Value::as_str).ok_or_else(|| {
        (
            -32602,
            "clipboard.editor.suggest_update requires id".to_string(),
        )
    })?;
    let conn = open_clip_db().map_err(|error| (-32000, error))?;
    init_schema(&conn).map_err(|error| (-32000, error))?;
    let item = load_clip(&conn, id).map_err(|error| (-32000, error))?;
    let content = args
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or(&item.content);
    let suggested = extract_hash_tags(content);
    Ok(json!({
        "suggestion": {
            "id": agent_trace_id("editor_suggestion"),
            "sessionId": args.get("sessionId").and_then(Value::as_str).unwrap_or("mcp-editor-session"),
            "draftVersion": args.get("draftVersion").and_then(Value::as_i64).unwrap_or(1),
            "contentPatch": Value::Null,
            "tagPatch": {
                "add": suggested.iter().filter(|tag| !item.tags.iter().any(|current| current.eq_ignore_ascii_case(tag))).collect::<Vec<_>>(),
                "remove": [],
                "keep": item.tags
            },
            "rationale": "从当前草稿中的 #tag 生成待确认 tagPatch；不直接写入数据库。",
            "riskLevel": "low"
        }
    }))
}
