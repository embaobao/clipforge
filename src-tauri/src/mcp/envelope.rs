//! MCP envelope 与纯辅助（从 lib.rs 迁入，modularity Phase 4）：tools/call 统一结果
//! 包装（mcp_result_envelope + mcp_content_response）、来源标记、args 向量解析、
//! next-actions 提示表、内建插件 manifest 与安全 URL 提取。全部纯函数。

use serde_json::{json, Value};

use super::mcp_trace_id;

pub(crate) fn mcp_result_envelope(
    tool: &str,
    args: &Value,
    result: Value,
) -> Result<Value, (i64, String)> {
    let trace_id = mcp_trace_id();
    let source = mcp_source_payload(args);
    Ok(json!({
        "ok": true,
        "traceId": trace_id,
        "tool": tool,
        "source": source,
        "businessChain": "mcp -> clipforge-service -> local-store",
        "permissionDecision": {
            "decision": "allow",
            "reason": "local MCP stdio call with explicit tool arguments"
        },
        "redactedFields": [],
        "nextActions": mcp_next_actions(tool),
        "result": result,
    }))
}

pub(crate) fn mcp_source_payload(args: &Value) -> Value {
    json!({
        "surface": "mcp",
        "client": args.get("client").and_then(Value::as_str).unwrap_or("unknown-agent"),
        "sourceLabel": args.get("sourceLabel").and_then(Value::as_str).unwrap_or("MCP Agent"),
        "requestId": args.get("requestId").and_then(Value::as_str).unwrap_or("")
    })
}

pub(crate) fn json_string_vec(args: &Value, key: &str) -> Option<Vec<String>> {
    match args.get(key)? {
        Value::Array(values) => {
            let out = values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>();
            if out.is_empty() {
                None
            } else {
                Some(out)
            }
        }
        Value::String(value) => {
            let out = value
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>();
            if out.is_empty() {
                None
            } else {
                Some(out)
            }
        }
        _ => None,
    }
}

pub(crate) fn mcp_next_actions(tool: &str) -> Vec<&'static str> {
    match tool {
        "clipboard.context.get" => vec![
            "clipboard.content.parse id=<item id>",
            "clipboard.update id=<item id>",
        ],
        "clipboard.context.compose" => vec![
            "clipboard.content.parse id=<item id>",
            "clipboard.search text=<keyword>",
        ],
        "clipboard.context.live" => vec![
            "clipboard.context.collectors.list",
            "clipboard.context.collector.contract",
            "clipboard.context.collector.debug collectorId=<id>",
        ],
        "clipboard.context.collectors.list" => vec!["clipboard.context.collector.contract"],
        "clipboard.context.collector.contract" => vec!["clipboard.context.collectors.list"],
        "clipboard.context.collector.debug" => vec!["clipboard.context.live includeExternal=true"],
        "clipboard.content.parse" => vec![
            "clipboard.capture content=<text>",
            "clipboard.search text=<keyword>",
        ],
        "clipboard.capture" => vec![
            "clipboard.context.get id=<returned id>",
            "clipboard.copy id=<returned id>",
        ],
        "clipboard.search" => vec![
            "clipboard.context.get id=<item id>",
            "clipboard.copy id=<item id>",
        ],
        "clipboard.copy" => vec!["paste in target app", "clipboard.update id=<item id>"],
        "clipboard.update" => vec!["clipboard.context.get id=<item id>"],
        "clipboard.editor.context" => vec![
            "clipboard.editor.preview_patch id=<item id>",
            "clipboard.editor.suggest_update id=<item id>",
        ],
        "clipboard.editor.preview_patch" => {
            vec!["clipboard.editor.apply_patch id=<item id> confirmed=true"]
        }
        "clipboard.editor.apply_patch" | "clipboard.editor.save" => {
            vec!["clipboard.editor.context id=<item id>"]
        }
        "clipboard.editor.render_template" => {
            vec!["clipboard.editor.preview_patch replacement=<rendered>"]
        }
        "clipboard.editor.suggest_update" => vec![
            "show tagPatch preview",
            "clipboard.editor.apply_patch confirmed=true",
        ],
        "clipboard.plugin.list" => vec!["clipboard.plugin.call pluginId=builtin.open-detail"],
        "clipboard.plugin.call" => vec![
            "show action preview",
            "clipboard.editor.preview_patch id=<item id>",
        ],
        "clipboard.agent.run" => vec![
            "show command preview",
            "agent_start_run confirmed=true from visible UI",
        ],
        "clipf.capture" => vec!["clipf.get id=<returned id>", "clipf.copy id=<returned id>"],
        "clipf.list" | "clipf.search" => vec!["clipf.get id=<item id>", "clipf.copy id=<item id>"],
        "clipf.get" => vec!["clipf.copy id=<item id>", "clipf.update id=<item id>"],
        "clipf.analyze" => vec![
            "clipf.capture content=<text>",
            "clipf.search text=<keyword>",
        ],
        "clipf.copy" => vec![
            "paste in target app",
            "clipf.update id=<item id> copied=true",
        ],
        _ => vec!["clipf.list limit=9"],
    }
}

pub(crate) fn builtin_plugin_manifests_value() -> Value {
    json!([
        {
            "id": "builtin.open-link",
            "name": "打开链接",
            "version": "1.0.0",
            "runtime": "builtin",
            "actions": [{ "id": "open-link", "type": "openUrl", "label": "打开链接" }],
            "matching": {
                "priority": 900,
                "contentKinds": ["link"],
                "payloadKinds": ["link", "html", "markdown", "text"],
                "urlPatterns": ["^https?://"]
            },
            "permissions": {
                "requiresUserConfirmation": false,
                "allowFullContent": false,
                "allowOpenUrl": true,
                "allowOpenApp": false,
                "allowRunCommand": false
            },
            "compatibility": { "app": ">=0.1.0", "contextSchema": 1 }
        },
        {
            "id": "builtin.open-detail",
            "name": "进入详情",
            "version": "1.0.0",
            "runtime": "builtin",
            "actions": [{ "id": "open-detail", "type": "navigateDetail", "label": "进入详情" }],
            "matching": {
                "priority": 100,
                "contentKinds": ["text", "markdown", "code", "command", "attachment", "json", "chart", "table"]
            },
            "permissions": {
                "requiresUserConfirmation": false,
                "allowFullContent": false,
                "allowOpenUrl": false,
                "allowOpenApp": false,
                "allowRunCommand": false
            },
            "compatibility": { "app": ">=0.1.0", "contextSchema": 1 }
        }
    ])
}

pub(crate) fn first_safe_http_url(content: &str) -> Option<String> {
    content
        .split_whitespace()
        .map(|part| {
            part.trim_matches(|ch: char| {
                matches!(ch, '<' | '>' | '"' | '\'' | ')' | ']' | ',' | ';')
            })
        })
        .find(|part| part.starts_with("http://") || part.starts_with("https://"))
        .map(ToString::to_string)
}

pub(crate) fn mcp_content_response(result: Value) -> Result<Value, (i64, String)> {
    Ok(json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&result).map_err(|error| (-32000, error.to_string()))?
        }]
    }))
}
