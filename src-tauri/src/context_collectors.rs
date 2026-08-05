use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::context_collector_system::augment_process_context;

mod external;
use external::{
    collectors_directory, external_collectors_enabled, load_external_collectors,
    run_external_collector,
};

const PROTOCOL: &str = "clipforge.application-context.collector.v1";
const DEFAULT_TIMEOUT_MS: u64 = 500;
const MAX_OUTPUT_BYTES: usize = 65_536;
const MAX_MANIFESTS: usize = 64;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExternalCollectorManifest {
    schema_version: u64,
    id: String,
    name: String,
    version: String,
    enabled: bool,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(rename = "match")]
    matcher: CollectorMatcher,
    #[serde(default)]
    permissions: Vec<String>,
    #[serde(default)]
    priority: Option<i32>,
    timeout_ms: Option<u64>,
    max_output_bytes: Option<usize>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CollectorMatcher {
    #[serde(default)]
    bundle_ids: Vec<String>,
    #[serde(default)]
    app_names: Vec<String>,
}

#[derive(Debug, Clone)]
struct LoadedCollector {
    manifest: ExternalCollectorManifest,
    manifest_path: PathBuf,
    root: PathBuf,
}

/// 返回应用上下文采集器协议、内置示例和外部适配器安装约定，供 MCP/Agent 生成适配器。
pub(crate) fn collector_catalog() -> Value {
    json!({
        "protocol": PROTOCOL,
        "schemaVersion": 1,
        "purpose": "Read-only application metadata for clipboard context and Agent linking.",
        "input": {
            "schemaVersion": 1,
            "application": { "name": "string|null", "bundleId": "string|null", "processId": "string|null" },
            "window": { "title": "string|null" },
            "process": { "workingDirectory": "string|null", "executablePath": "string|null" },
            "environment": { "platform": "string", "arch": "string", "appVersion": "string" }
        },
        "output": {
            "schemaVersion": 1,
            "context": "object",
            "signals": "string[]",
            "permissions": "object",
            "confidence": "high|best-effort|low"
        },
        "safety": {
            "readOnly": true,
            "shell": false,
            "defaultExternalExecution": false,
            "timeoutMs": DEFAULT_TIMEOUT_MS,
            "maxOutputBytes": MAX_OUTPUT_BYTES,
            "neverCollect": ["prompt", "transcript", "token", "password", "cookie", "authorization"],
            "redaction": "Sensitive output keys are replaced with null before MCP response."
        },
        "externalAdapter": {
            "directory": collectors_directory().map(|path| path.to_string_lossy().to_string()),
            "manifestFile": "collector.json",
            "transport": "JSON object on stdin, one JSON object on stdout",
            "command": "An executable path relative to collector.json or an absolute path inside the collector directory",
            "enableSetting": "enableExternalContextCollectors",
            "example": {
                "id": "browser.chrome.example",
                "match": { "bundleIds": ["com.google.Chrome"] },
                "priority": 100,
                "permissions": ["automation"],
                "output": { "context": { "browser": { "url": "https://example.com", "title": "Example" } }, "signals": ["chrome-active-tab"], "confidence": "high" }
            }
        }
    })
}

/// 列出内置和用户目录中的采集器；无效外部 manifest 只作为诊断返回，不阻断主流程。
pub(crate) fn list_collectors() -> Value {
    let mut collectors = vec![
        json!({ "id": "system.frontmost", "name": "Frontmost application", "kind": "builtin", "enabled": true, "supports": ["application", "window", "process"] }),
        json!({ "id": "browser.active-tab", "name": "Browser active tab", "kind": "builtin", "enabled": true, "supports": ["url", "title"], "examples": ["Chrome", "Safari", "Firefox", "Arc", "Edge", "Brave", "Vivaldi", "Opera"] }),
        json!({ "id": "editor.workspace", "name": "Editor workspace", "kind": "builtin", "enabled": true, "supports": ["document", "workspace", "git"] }),
        json!({ "id": "terminal.git", "name": "Terminal and Git", "kind": "builtin", "enabled": true, "supports": ["workingDirectory", "repository", "branch", "status"] }),
        json!({ "id": "finder.selection", "name": "Finder selection", "kind": "builtin", "enabled": true, "supports": ["selectedPaths"] }),
        json!({ "id": "assistant.metadata", "name": "Codex/ChatGPT metadata", "kind": "builtin", "enabled": true, "supports": ["application", "window", "process", "project"], "transcriptAccess": "never" }),
    ];
    let mut diagnostics = Vec::new();
    for loaded in load_external_collectors() {
        match loaded {
            Ok(collector) => collectors.push(external_descriptor(&collector)),
            Err(error) => diagnostics.push(error),
        }
    }
    json!({
        "protocol": PROTOCOL,
        "collectors": collectors,
        "external": {
            "directory": collectors_directory().map(|path| path.to_string_lossy().to_string()),
            "enabledBySetting": external_collectors_enabled(),
            "diagnostics": diagnostics,
        }
    })
}

/// 采集当前前台应用的实时上下文；不会写入剪贴板历史。
pub(crate) fn capture_live_context(
    collector_id: Option<&str>,
    include_external: bool,
) -> Result<Value, String> {
    let captured = crate::application_context::capture(true);
    let mut application_context = captured
        .as_ref()
        .map(|snapshot| snapshot.application_context.clone())
        .unwrap_or_else(|| json!({
            "schemaVersion": 1,
            "kind": "unavailable",
            "confidence": "low",
            "application": null,
            "window": null,
            "signals": [],
            "permissions": { "accessibility": "unavailable" }
        }));
    augment_process_context(&mut application_context);
    let base_context = application_context.clone();
    let (application_context, results, diagnostics) = if include_external {
        collect_external_contexts(base_context, collector_id)
    } else {
        let diagnostics = collector_id
            .map(|id| vec![format!("{id} skipped: external execution was not requested")])
            .unwrap_or_default();
        (application_context, Vec::new(), diagnostics)
    };
    let input = collector_input(&application_context, &json!({}));

    let captured_at = now_millis();
    Ok(json!({
        "snapshotType": "live-application-context",
        "capturedAt": captured_at,
        "protocol": PROTOCOL,
        "applicationContext": application_context,
        "input": input,
        "collectors": results,
        "permissions": {
            "externalExecutionRequested": include_external,
            "externalExecutionEnabled": external_collectors_enabled(),
            "redactedFields": ["prompt", "transcript", "token", "password", "cookie", "authorization"]
        },
        "diagnostics": diagnostics,
    }))
}

/// 调试指定外部采集器，返回实际发送给脚本的输入和受限输出，便于 Agent 迭代适配器。
pub(crate) fn debug_collector(
    collector_id: &str,
    fixture: Option<Value>,
) -> Result<Value, String> {
    if collector_id.trim().is_empty() {
        return Err("collectorId is required".to_string());
    }
    let loaded = load_external_collectors()
        .into_iter()
        .find_map(|item| item.ok().filter(|collector| collector.manifest.id == collector_id))
        .ok_or_else(|| format!("external collector not found: {collector_id}"))?;
    let (input, match_context) = if let Some(fixture) = fixture {
        if !fixture.is_object() {
            return Err("fixture must be an object following the collector input contract".to_string());
        }
        (fixture.clone(), fixture)
    } else {
        let live = capture_live_context(None, false)?;
        (
            live.get("input").cloned().unwrap_or_else(|| json!({})),
            live.get("applicationContext")
                .cloned()
                .unwrap_or(Value::Null),
        )
    };
    let result = if !external_collectors_enabled() {
        json!({ "ok": false, "status": "disabled", "error": "enableExternalContextCollectors=false" })
    } else if !loaded.manifest.enabled {
        json!({ "ok": false, "status": "disabled", "error": "collector manifest enabled=false" })
    } else if !collector_matches(&loaded.manifest.matcher, &match_context) {
        json!({ "ok": false, "status": "not-matched", "error": "collector does not match the current frontmost application" })
    } else {
        run_external_collector(&loaded, &input)
    };
    Ok(json!({
        "snapshotType": "collector-debug",
        "protocol": PROTOCOL,
        "collector": external_descriptor(&loaded),
        "input": input,
        "result": result,
        "redactedFields": ["prompt", "transcript", "token", "password", "cookie", "authorization"],
    }))
}

fn external_descriptor(collector: &LoadedCollector) -> Value {
    json!({
        "id": collector.manifest.id,
        "name": collector.manifest.name,
        "version": collector.manifest.version,
        "kind": "external",
        "enabled": collector.manifest.enabled,
        "manifestPath": collector.manifest_path.to_string_lossy().to_string(),
        "match": collector.manifest.matcher,
        "priority": collector.manifest.priority.unwrap_or(100),
        "permissions": collector.manifest.permissions,
        "timeoutMs": collector.manifest.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).clamp(50, DEFAULT_TIMEOUT_MS),
        "maxOutputBytes": collector.manifest.max_output_bytes.unwrap_or(MAX_OUTPUT_BYTES).clamp(1024, MAX_OUTPUT_BYTES),
    })
}

fn collector_input(context: &Value, collected_context: &Value) -> Value {
    json!({
        "protocol": PROTOCOL,
        "schemaVersion": 1,
        "application": context.get("application").cloned().unwrap_or(Value::Null),
        "window": context.get("window").cloned().unwrap_or(Value::Null),
        "process": context.get("process").cloned().unwrap_or(Value::Null),
        "collectedContext": collected_context,
        "environment": {
            "platform": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "appVersion": env!("CARGO_PKG_VERSION"),
        },
    })
}

/// 按优先级串行执行同一应用的多个采集器；后一个采集器只接收前面采集器已确认的上下文。
fn collect_external_contexts(
    mut application_context: Value,
    collector_id: Option<&str>,
) -> (Value, Vec<Value>, Vec<String>) {
    let mut results = Vec::new();
    let mut diagnostics = Vec::new();
    if !external_collectors_enabled() {
        diagnostics.push("external collectors skipped: enableExternalContextCollectors=false".to_string());
        return (application_context, results, diagnostics);
    }

    let mut collectors = Vec::new();
    for loaded in load_external_collectors() {
        match loaded {
            Ok(collector) => {
                if collector_id.is_none_or(|id| id == collector.manifest.id) {
                    collectors.push(collector);
                }
            }
            Err(error) => diagnostics.push(error),
        }
    }
    collectors.sort_by_key(|collector| collector.manifest.priority.unwrap_or(100));

    let mut collected_context = json!({});
    for collector in collectors {
        if !collector.manifest.enabled {
            diagnostics.push(format!("{} skipped: disabled", collector.manifest.id));
            continue;
        }
        if !collector_matches(&collector.manifest.matcher, &application_context) {
            continue;
        }
        let input = collector_input(&application_context, &collected_context);
        let result = run_external_collector(&collector, &input);
        if result.get("ok").and_then(Value::as_bool) == Some(true) {
            if let Some(context) = result
                .get("output")
                .and_then(|output| output.get("context"))
                .filter(|value| value.is_object())
            {
                merge_context(&mut collected_context, context);
            }
        }
        results.push(result);
    }
    merge_context(&mut application_context, &collected_context);
    (application_context, results, diagnostics)
}

/// 仅补齐新字段，避免外部脚本覆盖内置应用身份、浏览器 URL 等更高可信度数据。
fn merge_context(target: &mut Value, additions: &Value) {
    let (Some(target), Some(additions)) = (target.as_object_mut(), additions.as_object()) else {
        return;
    };
    for (key, value) in additions {
        match (target.get_mut(key), value) {
            (Some(existing), Value::Object(addition)) if existing.is_object() => {
                merge_context(existing, &Value::Object(addition.clone()));
            }
            (None, value) => {
                target.insert(key.clone(), value.clone());
            }
            _ => {}
        }
    }
}

/// 判断剪贴板捕获后是否需要异步执行外部采集器。
pub(crate) fn delayed_collection_enabled() -> bool {
    external_collectors_enabled()
        && crate::read_user_settings()
            .ok()
            .and_then(|payload| {
                payload
                    .settings
                    .get("captureExternalContextOnClipboard")
                    .and_then(Value::as_bool)
            })
            .unwrap_or(false)
}

/// 在剪贴板基础记录已落库后异步补写外部采集结果，不阻塞复制热路径。
pub(crate) fn schedule_delayed_collection(clip_id: String, mut application_context: Value) {
    let _ = std::thread::Builder::new()
        .name("clipforge-context-collector".to_string())
        .spawn(move || {
            if !external_collectors_enabled() {
                persist_delayed_collection(
                    &clip_id,
                    application_context,
                    Vec::new(),
                    vec!["external collectors disabled before execution".to_string()],
                    "skipped",
                );
                return;
            }
            augment_process_context(&mut application_context);
            let (application_context, results, diagnostics) =
                collect_external_contexts(application_context, None);
            let status = if results.iter().any(|result| result["ok"] == false) {
                "partial"
            } else {
                "complete"
            };
            persist_delayed_collection(
                &clip_id,
                application_context,
                results,
                diagnostics,
                status,
            );
        });
}

fn persist_delayed_collection(
    clip_id: &str,
    application_context: Value,
    results: Vec<Value>,
    diagnostics: Vec<String>,
    status: &str,
) {
    let Ok(conn) = crate::open_clip_db() else {
        crate::log_to_file("warn", "context-collector-async", "database unavailable during delayed write");
        return;
    };
    if crate::init_schema(&conn).is_err() {
        crate::log_to_file("warn", "context-collector-async", "schema unavailable during delayed write");
        return;
    }
    let raw: Result<String, _> = conn.query_row(
        "SELECT capture_context_json FROM clips WHERE id = ?1 AND deleted_at IS NULL",
        rusqlite::params![clip_id],
        |row| row.get(0),
    );
    let Ok(raw) = raw else {
        crate::log_to_file("debug", "context-collector-async", &format!("clip missing before delayed write id={clip_id}"));
        return;
    };
    let mut capture_context = serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| json!({}));
    capture_context["applicationContext"] = application_context;
    capture_context["collectors"] = json!({
        "status": status,
        "completedAt": now_millis(),
        "results": results,
        "diagnostics": diagnostics,
    });
    let serialized = match serde_json::to_string(&capture_context) {
        Ok(value) => value,
        Err(error) => {
            crate::log_to_file("warn", "context-collector-async", &format!("serialize delayed context failed id={clip_id} error={error}"));
            return;
        }
    };
    if let Err(error) = conn.execute(
        "UPDATE clips SET capture_context_json = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
        rusqlite::params![serialized, now_millis(), clip_id],
    ) {
        crate::log_to_file("warn", "context-collector-async", &format!("delayed context write failed id={clip_id} error={error}"));
    } else {
        crate::log_to_file("info", "context-collector-async", &format!("delayed context write complete id={clip_id} status={status} collectors={}", capture_context["collectors"]["results"].as_array().map(|items| items.len()).unwrap_or(0)));
    }
}

fn collector_matches(matcher: &CollectorMatcher, context: &Value) -> bool {
    let bundle_id = context
        .get("application")
        .and_then(|value| value.get("bundleId"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let app_name = context
        .get("application")
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if bundle_id.is_empty() && app_name.is_empty() {
        return false;
    }
    let bundle_match = matcher.bundle_ids.is_empty()
        || matcher
            .bundle_ids
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(bundle_id));
    let name_match = matcher.app_names.is_empty()
        || matcher
            .app_names
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(app_name));
    bundle_match && name_match && (!matcher.bundle_ids.is_empty() || !matcher.app_names.is_empty())
}

fn now_millis() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_millis() as i64).unwrap_or_default()
}

#[cfg(test)]
mod tests;
