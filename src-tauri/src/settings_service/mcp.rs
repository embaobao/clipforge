//! clipf.settings.* / clipf.agent.* MCP 工具实现与分发（从 lib.rs 迁入，modularity Phase 3）。
//! MCP stdio 子进程没有 AppHandle：patch/replace/reset 走 mod.rs 门面完成锁内读-改-原子写，
//! 但无法 emit settings_changed，也无法同步全局快捷键 / 重建托盘菜单（需主进程代发桥，
//! 见 settings-service-unified-protocol design §4）。

use serde_json::{json, Value};

use super::commands::{
    log_slow_settings_operation, settings_service_agent_providers_payload, settings_write_response,
};
use super::{
    commit_settings_patch, commit_settings_replace, commit_settings_reset, public_settings_payload,
    validate_settings_patch,
};
use crate::{agent_check_provider, agent_list_provider_models, log_to_file};

/// 门面错误的 MCP 错误码分类：revision 冲突 / scope 非法 / schema 校验失败属调用方问题
/// （-32602），读盘、写盘、锁 poisoned/degraded 属服务端问题（-32000）。
fn mcp_settings_error(error: String) -> (i64, String) {
    if error.starts_with("SETTINGS_REVISION_CONFLICT")
        || error.starts_with("SETTINGS_RESET_INVALID_SCOPE")
        || error.starts_with("SETTINGS_SCHEMA_VALIDATION_FAILED")
    {
        (-32602, error)
    } else {
        (-32000, error)
    }
}

/// MCP 设置局部更新：锁外校验 → 门面锁内 读-合并-原子写 → write response。
fn mcp_settings_patch(
    patch: Value,
    reason: Option<&str>,
    expected_revision: Option<&str>,
) -> Result<Value, (i64, String)> {
    let started = std::time::Instant::now();
    validate_settings_patch(&patch).map_err(|error| (-32602, error))?;
    let draft = commit_settings_patch(&patch, expected_revision).map_err(mcp_settings_error)?;
    let previous_revision = draft.previous_revision;
    let changed_paths = draft.changed_paths;
    let next = draft.next;
    log_to_file(
        "info",
        "settings-service",
        &format!(
            "mcp patch reason={} changed={}",
            reason.unwrap_or(""),
            changed_paths.join(",")
        ),
    );
    let mut response = settings_write_response(next, previous_revision, changed_paths, true)
        .map_err(|error| (-32000, error))?;
    let duration_ms = started.elapsed().as_millis() as i64;
    response["durationMs"] = json!(duration_ms);
    log_slow_settings_operation("mcp.patch", duration_ms);
    Ok(response)
}

/// MCP 设置全量替换（调用方必须先 confirmed=true）。
fn mcp_settings_replace(
    settings: Value,
    reason: Option<&str>,
    expected_revision: Option<&str>,
) -> Result<Value, (i64, String)> {
    let started = std::time::Instant::now();
    validate_settings_patch(&settings).map_err(|error| (-32602, error))?;
    let draft = commit_settings_replace(settings, expected_revision).map_err(mcp_settings_error)?;
    let previous_revision = draft.previous_revision;
    let changed_paths = draft.changed_paths;
    let next = draft.next;
    log_to_file(
        "warn",
        "settings-service",
        &format!(
            "mcp replace reason={} changed={}",
            reason.unwrap_or(""),
            changed_paths.join(",")
        ),
    );
    let mut response = settings_write_response(next, previous_revision, changed_paths, true)
        .map_err(|error| (-32000, error))?;
    let duration_ms = started.elapsed().as_millis() as i64;
    response["durationMs"] = json!(duration_ms);
    log_slow_settings_operation("mcp.replace", duration_ms);
    Ok(response)
}

/// MCP 设置按 scope 重置（调用方必须先 confirmed=true）。
fn mcp_settings_reset(
    scope: String,
    reason: Option<&str>,
    expected_revision: Option<&str>,
) -> Result<Value, (i64, String)> {
    let started = std::time::Instant::now();
    let draft = commit_settings_reset(&scope, expected_revision).map_err(mcp_settings_error)?;
    let previous_revision = draft.previous_revision;
    let changed_paths = draft.changed_paths;
    let next = draft.next;
    log_to_file(
        "warn",
        "settings-service",
        &format!(
            "mcp reset scope={} reason={} changed={}",
            scope,
            reason.unwrap_or(""),
            changed_paths.join(",")
        ),
    );
    let mut response = settings_write_response(next, previous_revision, changed_paths, true)
        .map_err(|error| (-32000, error))?;
    let duration_ms = started.elapsed().as_millis() as i64;
    response["durationMs"] = json!(duration_ms);
    log_slow_settings_operation("mcp.reset", duration_ms);
    Ok(response)
}

/// call_mcp_tool 的 settings/agent 分发分支（路由壳在 lib.rs）；非本域工具名返回 unknown tool。
pub(crate) fn call_settings_agent_tool(name: &str, args: &Value) -> Result<Value, (i64, String)> {
    match name {
        "clipf.settings.get" => {
            let started = std::time::Instant::now();
            let include_schema = args
                .get("includeSchema")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let mut payload =
                public_settings_payload(include_schema).map_err(|error| (-32000, error))?;
            let duration_ms = started.elapsed().as_millis() as i64;
            payload["durationMs"] = json!(duration_ms);
            log_slow_settings_operation("mcp.get", duration_ms);
            Ok(payload)
        }
        "clipf.settings.patch" => mcp_settings_patch(
            args.get("patch").cloned().unwrap_or_else(|| json!({})),
            args.get("reason").and_then(Value::as_str),
            args.get("expectedRevision").and_then(Value::as_str),
        ),
        "clipf.settings.replace" => {
            if args.get("confirmed").and_then(Value::as_bool) != Some(true) {
                return Err((
                    -32602,
                    "SETTINGS_REPLACE_REQUIRES_CONFIRMATION: retry with confirmed=true".to_string(),
                ));
            }
            let settings = args.get("settings").cloned().ok_or_else(|| {
                (
                    -32602,
                    "clipf.settings.replace requires settings".to_string(),
                )
            })?;
            mcp_settings_replace(
                settings,
                args.get("reason").and_then(Value::as_str),
                args.get("expectedRevision").and_then(Value::as_str),
            )
        }
        "clipf.settings.reset" => {
            if args.get("confirmed").and_then(Value::as_bool) != Some(true) {
                return Err((
                    -32602,
                    "SETTINGS_RESET_REQUIRES_CONFIRMATION: retry with scope and confirmed=true"
                        .to_string(),
                ));
            }
            let scope = args
                .get("scope")
                .and_then(Value::as_str)
                .ok_or_else(|| (-32602, "clipf.settings.reset requires scope".to_string()))?
                .to_string();
            mcp_settings_reset(
                scope,
                args.get("reason").and_then(Value::as_str),
                args.get("expectedRevision").and_then(Value::as_str),
            )
        }
        "clipf.agent.providers" => {
            settings_service_agent_providers_payload().map_err(|error| (-32000, error))
        }
        "clipf.agent.check" => {
            let provider_id = args
                .get("providerId")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            serde_json::to_value(
                agent_check_provider(provider_id).map_err(|error| (-32000, error))?,
            )
            .map_err(|error| (-32000, error.to_string()))
        }
        "clipf.agent.models" => {
            let provider_id = args
                .get("providerId")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            serde_json::to_value(
                agent_list_provider_models(provider_id).map_err(|error| (-32000, error))?,
            )
            .map_err(|error| (-32000, error.to_string()))
        }
        _ => Err((-32602, format!("unknown tool: {name}"))),
    }
}
