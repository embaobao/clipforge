//! MCP tools/call 路由壳与读类工具臂（从 lib.rs 迁入，modularity Phase 4）：name/args
//! 提取、前后日志、envelope 包装；写库/编辑器/agent/settings 臂分文件实现
//! （dispatch_write.rs / dispatch_agent_editor.rs），臂内字面量与错误码逐字节保留。

use serde_json::{json, Value};

use super::context::{
    mcp_context_reference, mcp_context_snapshot, parse_clipboard_content_candidates,
};
use super::dispatch_agent_editor::{
    dispatch_agent_run, dispatch_editor_apply_patch, dispatch_editor_context,
    dispatch_editor_preview_patch, dispatch_editor_render_template, dispatch_editor_suggest_update,
    dispatch_plugin_call, dispatch_plugin_list, dispatch_skill_list, dispatch_skill_run,
    dispatch_skill_save_draft,
};
use super::dispatch_write::{
    dispatch_clipboard_copy, dispatch_clipboard_update, dispatch_clipf_delete,
    dispatch_clipf_export, dispatch_clipf_import,
};
use super::envelope::{json_string_vec, mcp_content_response, mcp_result_envelope};
use crate::agent::agent_trace_id;
use crate::context_collectors;
use crate::{
    analysis_kind, analyze_clip, capture_clip_record, capture_current_clipboard, default_tags,
    init_schema, load_clip, log_to_file, now_millis, open_clip_db, query_clip_records,
    search_clip_records, settings_service, AnalyzeClipPayload, SearchClipsRequest,
};

pub(crate) fn call_mcp_tool(params: Value) -> Result<Value, (i64, String)> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| (-32602, "tools/call requires name".to_string()))?;
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    log_to_file(
        "info",
        "mcp",
        &format!(
            "tool_call start tool={} source={} requestId={}",
            name,
            args.get("sourceLabel")
                .and_then(Value::as_str)
                .unwrap_or("MCP Agent"),
            args.get("requestId").and_then(Value::as_str).unwrap_or("")
        ),
    );
    let result = match name {
        "clipboard.capture" | "clipf.capture" => dispatch_capture(name, &args)?,
        "clipboard.context.get" | "clipf.get" => dispatch_context_get(name, &args)?,
        "clipboard.context.live" => context_collectors::capture_live_context(
            args.get("collectorId").and_then(Value::as_str),
            args.get("includeExternal")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        )
        .map_err(|error| (-32000, error))?,
        "clipboard.context.collectors.list" => context_collectors::list_collectors(),
        "clipboard.context.collector.contract" => context_collectors::collector_catalog(),
        "clipboard.context.collector.debug" => {
            let collector_id =
                args.get("collectorId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        (
                            -32602,
                            "clipboard.context.collector.debug requires collectorId".to_string(),
                        )
                    })?;
            context_collectors::debug_collector(collector_id, args.get("fixture").cloned())
                .map_err(|error| (-32000, error))?
        }
        "clipboard.context.compose" => dispatch_context_compose(&args)?,
        "clipf.list" => dispatch_clipf_list(&args)?,
        "clipboard.search" | "clipf.search" => dispatch_search(&args)?,
        "clipboard.content.parse" => {
            let content = if let Some(content) = args.get("content").and_then(Value::as_str) {
                content.to_string()
            } else if let Some(id) = args.get("id").and_then(Value::as_str) {
                let conn = open_clip_db().map_err(|error| (-32000, error))?;
                init_schema(&conn).map_err(|error| (-32000, error))?;
                load_clip(&conn, id)
                    .map_err(|error| (-32000, error))?
                    .content
            } else {
                return Err((
                    -32602,
                    "clipboard.content.parse requires content or id".to_string(),
                ));
            };
            parse_clipboard_content_candidates(&content)
        }
        "clipf.analyze" => dispatch_analyze(&args)?,
        "clipboard.copy" | "clipf.copy" => dispatch_clipboard_copy(name, &args)?,
        "clipboard.update" | "clipf.update" => dispatch_clipboard_update(&args)?,
        "clipboard.skill.list" => dispatch_skill_list(),
        "clipboard.skill.save_draft" => dispatch_skill_save_draft(&args)?,
        "clipboard.skill.run" => dispatch_skill_run(&args)?,
        "clipboard.plugin.list" => dispatch_plugin_list(),
        "clipboard.plugin.call" => dispatch_plugin_call(&args)?,
        "clipboard.agent.run" => dispatch_agent_run(&args)?,
        "clipboard.editor.context" => dispatch_editor_context(&args)?,
        "clipboard.editor.preview_patch" => dispatch_editor_preview_patch(&args)?,
        "clipboard.editor.apply_patch" | "clipboard.editor.save" => {
            dispatch_editor_apply_patch(name, &args)?
        }
        "clipboard.editor.render_template" => dispatch_editor_render_template(&args)?,
        "clipboard.editor.suggest_update" => dispatch_editor_suggest_update(&args)?,
        "clipf.delete" => dispatch_clipf_delete(&args)?,
        "clipf.export" => dispatch_clipf_export(&args)?,
        "clipf.import" => dispatch_clipf_import(&args)?,
        // ===== B3：MCP 设置/Agent 工具分发（复用统一 SettingsService 底层函数；实现见 settings_service/mcp.rs）=====
        "clipf.settings.get" => settings_service::mcp::call_settings_agent_tool(name, &args)?,
        "clipf.settings.patch" => settings_service::mcp::call_settings_agent_tool(name, &args)?,
        "clipf.settings.replace" => settings_service::mcp::call_settings_agent_tool(name, &args)?,
        "clipf.settings.reset" => settings_service::mcp::call_settings_agent_tool(name, &args)?,
        "clipf.agent.providers" => settings_service::mcp::call_settings_agent_tool(name, &args)?,
        "clipf.agent.check" => settings_service::mcp::call_settings_agent_tool(name, &args)?,
        "clipf.agent.models" => settings_service::mcp::call_settings_agent_tool(name, &args)?,
        _ => return Err((-32602, format!("unknown tool: {name}"))),
    };
    log_to_file(
        "info",
        "mcp",
        &format!(
            "tool_call success tool={} source={} requestId={}",
            name,
            args.get("sourceLabel")
                .and_then(Value::as_str)
                .unwrap_or("MCP Agent"),
            args.get("requestId").and_then(Value::as_str).unwrap_or("")
        ),
    );
    mcp_content_response(mcp_result_envelope(name, &args, result)?)
}

fn dispatch_capture(name: &str, args: &Value) -> Result<Value, (i64, String)> {
    let source_label = format!(
        "{} via {}",
        args.get("sourceLabel")
            .and_then(Value::as_str)
            .unwrap_or("MCP Agent"),
        name
    );
    let payload = if let Some(content) = args.get("content").and_then(Value::as_str) {
        capture_clip_record(
            content.to_string(),
            Some(source_label),
            now_millis().map_err(|error| (-32000, error))?,
        )
        .map_err(|error| (-32000, error))?
    } else {
        capture_current_clipboard(
            Some(source_label),
            now_millis().map_err(|error| (-32000, error))?,
        )
        .map_err(|error| (-32000, error))?
    };
    serde_json::to_value(payload).map_err(|error| (-32000, error.to_string()))
}

fn dispatch_context_get(name: &str, args: &Value) -> Result<Value, (i64, String)> {
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| (-32602, format!("{name} requires id")))?;
    let conn = open_clip_db().map_err(|error| (-32000, error))?;
    init_schema(&conn).map_err(|error| (-32000, error))?;
    let item = load_clip(&conn, id).map_err(|error| (-32000, error))?;
    if name == "clipboard.context.get" {
        Ok(mcp_context_snapshot(
            &item,
            args.get("includeContent")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        ))
    } else {
        serde_json::to_value(item).map_err(|error| (-32000, error.to_string()))
    }
}

fn dispatch_context_compose(args: &Value) -> Result<Value, (i64, String)> {
    let conn = open_clip_db().map_err(|error| (-32000, error))?;
    init_schema(&conn).map_err(|error| (-32000, error))?;
    let mode = args
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("current");
    let include_content = args
        .get("includeContent")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let items = if let Some(ids) = args.get("ids").and_then(Value::as_array) {
        ids.iter()
            .filter_map(Value::as_str)
            .filter_map(|id| load_clip(&conn, id).ok())
            .collect::<Vec<_>>()
    } else if mode == "favorites" {
        search_clip_records(SearchClipsRequest {
            text: None,
            bucket: Some("all".to_string()),
            kinds: None,
            types: None,
            tags: None,
            file_extensions: None,
            favorite: Some(true),
            limit: args.get("limit").and_then(Value::as_i64).or(Some(20)),
            cursor: None,
        })
        .map_err(|error| (-32000, error))?
        .items
    } else if mode == "search-result" {
        search_clip_records(SearchClipsRequest {
            text: args
                .get("text")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            bucket: Some("all".to_string()),
            kinds: None,
            types: json_string_vec(&args, "types"),
            tags: json_string_vec(&args, "tags"),
            file_extensions: json_string_vec(&args, "fileExtensions"),
            favorite: args.get("favorite").and_then(Value::as_bool),
            limit: args.get("limit").and_then(Value::as_i64).or(Some(20)),
            cursor: None,
        })
        .map_err(|error| (-32000, error))?
        .items
    } else {
        query_clip_records(
            None,
            Some("all".to_string()),
            args.get("limit").and_then(Value::as_i64).or(Some(20)),
            None,
        )
        .map_err(|error| (-32000, error))?
        .items
    };
    Ok(json!({
        "contextSet": {
            "id": agent_trace_id("mcp_context"),
            "mode": mode,
            "references": items.iter().map(|item| mcp_context_reference(item, include_content)).collect::<Vec<_>>(),
            "createdAt": now_millis().unwrap_or(0),
            "updatedAt": now_millis().unwrap_or(0),
            "limits": {
                "maxItems": args.get("limit").and_then(Value::as_i64).unwrap_or(20),
                "maxCharsPerItem": if include_content { 2000 } else { 240 },
                "maxTotalChars": if include_content { 12000 } else { 4000 }
            }
        }
    }))
}

fn dispatch_clipf_list(args: &Value) -> Result<Value, (i64, String)> {
    let payload = query_clip_records(
        None,
        args.get("bucket")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        args.get("limit").and_then(Value::as_i64),
        args.get("cursor")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    )
    .map_err(|error| (-32000, error))?;
    serde_json::to_value(payload).map_err(|error| (-32000, error.to_string()))
}

fn dispatch_search(args: &Value) -> Result<Value, (i64, String)> {
    let payload = search_clip_records(SearchClipsRequest {
        text: args
            .get("text")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        bucket: args
            .get("bucket")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        kinds: json_string_vec(&args, "kinds").or_else(|| {
            json_string_vec(&args, "kind").map(|values| values.into_iter().take(1).collect())
        }),
        types: json_string_vec(&args, "types").or_else(|| {
            json_string_vec(&args, "type").map(|values| values.into_iter().take(1).collect())
        }),
        tags: json_string_vec(&args, "tags").or_else(|| {
            json_string_vec(&args, "tag").map(|values| values.into_iter().take(1).collect())
        }),
        file_extensions: json_string_vec(&args, "fileExtensions")
            .or_else(|| json_string_vec(&args, "fileExtension"))
            .or_else(|| json_string_vec(&args, "file")),
        favorite: args.get("favorite").and_then(Value::as_bool),
        limit: args.get("limit").and_then(Value::as_i64),
        cursor: args
            .get("cursor")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    })
    .map_err(|error| (-32000, error))?;
    serde_json::to_value(payload).map_err(|error| (-32000, error.to_string()))
}

fn dispatch_analyze(args: &Value) -> Result<Value, (i64, String)> {
    let content = args
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| (-32602, "clipf.analyze requires content".to_string()))?;
    let source_label = args
        .get("sourceLabel")
        .and_then(Value::as_str)
        .unwrap_or("MCP");
    let analysis = analyze_clip(content, source_label);
    let payload = AnalyzeClipPayload {
        content: content.to_string(),
        kind: analysis_kind(&analysis),
        tags: default_tags(&analysis, content),
        analysis,
    };
    serde_json::to_value(payload).map_err(|error| (-32000, error.to_string()))
}
