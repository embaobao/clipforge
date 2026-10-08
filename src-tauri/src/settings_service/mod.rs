//! settings 域门面（modularity Phase 3）：get/patch/replace/reset 公共流程、redact 与
//! payload 组装、写事务唯一入口（run_settings_write / commit_settings_*），以及设置 JSON
//! Schema 校验。铁律（2026-10-08 评审）：SETTINGS_WRITE_LOCK 私有于 write.rs，锁内不
//! emit、不跨 await、无网络/子进程 I/O；emit/托盘/快捷键等副作用一律在锁释放后执行。

pub mod commands;
pub(crate) mod mcp;
mod write;

use crate::{now_millis, parse_json5_like, settings_path, system_native_locale};
pub use commands::{
    current_global_shortcut_value, settings_service_agent_check, settings_service_agent_models,
    settings_service_agent_providers, settings_service_get, settings_service_patch,
    settings_service_replace, settings_service_reset, sync_global_shortcut_registration,
    sync_launch_at_login_from_settings, update_clipforge_settings,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::hash::{Hash, Hasher};
pub use write::{merge_settings_patch, settings_changed_paths, write_user_settings};

#[derive(Serialize)]
pub struct UserSettingsPayload {
    pub path: String,
    pub settings: Value,
}

#[tauri::command]
pub fn read_user_settings() -> Result<UserSettingsPayload, String> {
    let path = settings_path()?;
    if !path.exists() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        std::fs::write(&path, "{}\n").map_err(|error| error.to_string())?;
    }

    let raw = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let settings = parse_json5_like(&raw).unwrap_or(Value::Object(Default::default()));
    Ok(UserSettingsPayload {
        path: path.to_string_lossy().to_string(),
        settings,
    })
}

#[tauri::command]
pub fn get_clipforge_settings() -> Result<Value, String> {
    read_user_settings().map(|payload| payload.settings)
}

pub fn settings_revision(settings: &Value) -> String {
    let serialized = serde_json::to_string(settings).unwrap_or_else(|_| settings.to_string());
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    serialized.hash(&mut hasher);
    format!("rev_{:016x}", hasher.finish())
}

pub(crate) fn redact_settings_value(value: &Value) -> Value {
    let mut redacted = value.clone();
    // 抹掉明文 apiKey（B7）：schema 同时接受新结构 agent.providers[] 和 legacy 顶层 agentProviders[]，
    // 两条路径都要 redact，否则 settings_service_get 会泄漏 legacy provider 的 key。
    if let Some(providers) = redacted
        .get_mut("agentProviders")
        .and_then(Value::as_array_mut)
    {
        for provider in providers {
            redact_provider_api_key(provider);
        }
    }
    if let Some(agent) = redacted.get_mut("agent") {
        if let Some(providers) = agent.get_mut("providers").and_then(Value::as_array_mut) {
            for provider in providers {
                redact_provider_api_key(provider);
            }
        }
    }
    redacted
}

/// 抹掉单个 provider 配置里的明文 apiKey，统一返回 redacted 占位符。
fn redact_provider_api_key(provider: &mut Value) {
    if let Some(object) = provider.as_object_mut() {
        if object.contains_key("apiKey") {
            object.insert(
                "apiKey".to_string(),
                Value::String("[redacted]".to_string()),
            );
        }
    }
}

pub(crate) fn public_settings_payload(include_schema: bool) -> Result<Value, String> {
    let payload = read_user_settings()?;
    let settings = payload.settings;
    let revision = settings_revision(&settings);
    let updated_at = now_millis()?;
    Ok(json!({
        "settings": redact_settings_value(&settings),
        "schema": if include_schema { settings_json_schema() } else { Value::Null },
        "revision": revision,
        "updatedAt": updated_at,
        "source": "tauri",
        "writePolicy": {
            "recommendedMode": "patch",
            "replaceRequiresConfirmation": true,
            "resetRequiresConfirmation": true,
            "arrayMerge": "replace"
        },
        "warnings": [
            "Prefer settings patch updates. Full replacement is available only with confirmed=true.",
            "Arrays are replaced as complete values, including agent.providers and tagRules.",
            "Prefer agent.providers[].apiKeyEnv over persistent inline apiKey."
        ],
        "redaction": {
            "agent.providers[].apiKey": "write-only in UI and MCP responses should not depend on reading it back from provider list",
            "agent.providers[].apiKeyEnv": "preferred for persistent config"
        }
    }))
}

pub(crate) fn desired_launch_at_login(settings: &Value) -> bool {
    settings
        .get("launchAtLogin")
        .and_then(Value::as_bool)
        .unwrap_or(true)
}

#[tauri::command]
pub fn get_clipforge_config_path() -> Result<String, String> {
    Ok(settings_path()?.to_string_lossy().to_string())
}

pub(crate) fn current_native_locale() -> &'static str {
    let preference = read_user_settings()
        .ok()
        .and_then(|settings| {
            settings
                .settings
                .get("language")
                .and_then(Value::as_str)
                .map(|value| value.to_string())
        })
        .unwrap_or_else(|| "system".to_string());
    match preference.as_str() {
        "zh-CN" => "zh-CN",
        "en-US" => "en-US",
        _ => system_native_locale(),
    }
}

/// 设置写事务唯一入口（铁律 1）：锁内读取当前设置交给 body 产出 next，Some(next) 才原子落盘，
/// 附带任意输出 T 返回给调用方。锁内规则（铁律 2）：只做读-改-写与本地原子写，禁止 emit、
/// 网络或子进程 I/O；emit/托盘/快捷键等副作用必须在本函数返回后执行。
/// 锁层级（铁律 4）：持锁期间仅允许再获取 DB 连接，禁嵌套其他锁。
pub fn run_settings_write<T>(
    body: impl FnOnce(&Value) -> Result<(Option<Value>, T), String>,
) -> Result<T, String> {
    let _guard = write::acquire_settings_write_lock()?;
    let previous = read_user_settings()?.settings;
    let (next, output) = body(&previous)?;
    if let Some(next) = next {
        write::write_settings_atomic(&next)?;
    }
    Ok(output)
}

/// patch/replace/reset 公共写流程：锁内 读 → prepare_* → 原子写，锁外返回 draft。
/// 调用方须先用 validate_settings_patch 校验输入（纯计算，无需持锁）。
pub fn commit_settings_patch(
    patch: &Value,
    expected_revision: Option<&str>,
) -> Result<write::SettingsWriteDraft, String> {
    commit_settings_write(|previous| write::prepare_patch(previous, patch, expected_revision))
}

pub fn commit_settings_replace(
    settings: Value,
    expected_revision: Option<&str>,
) -> Result<write::SettingsWriteDraft, String> {
    commit_settings_write(|previous| write::prepare_replace(previous, settings, expected_revision))
}

pub fn commit_settings_reset(
    scope: &str,
    expected_revision: Option<&str>,
) -> Result<write::SettingsWriteDraft, String> {
    commit_settings_write(|previous| write::prepare_reset(previous, scope, expected_revision))
}

fn commit_settings_write<F>(prepare: F) -> Result<write::SettingsWriteDraft, String>
where
    F: FnOnce(&Value) -> Result<write::SettingsWriteDraft, String>,
{
    run_settings_write(|previous| {
        let draft = prepare(previous)?;
        Ok((Some(draft.next.clone()), draft))
    })
}

#[tauri::command]
pub fn settings_get_public() -> Result<Value, String> {
    public_settings_payload(true)
}

#[tauri::command]
pub fn settings_patch_public(input: Value) -> Result<Value, String> {
    validate_settings_patch(&input)?;
    run_settings_write(|previous| {
        let mut current = previous.clone();
        merge_settings_patch(&mut current, &input);
        Ok((Some(current), ()))
    })?;
    public_settings_payload(true)
}

#[tauri::command]
pub fn settings_replace_public(input: Value, confirmed: Option<bool>) -> Result<Value, String> {
    if confirmed != Some(true) {
        return Err("SETTINGS_REPLACE_REQUIRES_CONFIRMATION: use partial patch unless you intend to replace the full settings object".to_string());
    }
    validate_settings_patch(&input)?;
    run_settings_write(|_| Ok((Some(input), ())))?;
    public_settings_payload(true)
}

#[tauri::command]
pub fn settings_reset_public(
    scope: Option<String>,
    confirmed: Option<bool>,
) -> Result<Value, String> {
    if confirmed != Some(true) {
        return Err("SETTINGS_RESET_REQUIRES_CONFIRMATION".to_string());
    }
    let scope = scope.unwrap_or_else(|| "all".to_string());
    run_settings_write(|previous| {
        let mut current = previous.clone();
        match scope.as_str() {
            "all" => current = json!({}),
            "agent" => {
                if let Some(object) = current.as_object_mut() {
                    object.remove("agent");
                    object.remove("agentProviders");
                }
            }
            key => {
                if let Some(object) = current.as_object_mut() {
                    object.remove(key);
                } else {
                    current = json!({});
                }
            }
        }
        Ok((Some(current), ()))
    })?;
    public_settings_payload(true)
}

// ===== 设置 schema 与校验（从 lib.rs 迁入，2026-09-11 modularity Phase 3 第一小步）=====
// settings_json_schema 返回设置文档的 JSON Schema（draft 2020-12）；
// validate_settings_patch 按 schema 校验 patch 并聚合错误信息。
pub fn settings_json_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "ClipForgeSettings",
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "language": { "type": "string", "enum": ["system", "zh-CN", "en-US"] },
            "globalShortcut": { "type": "string", "minLength": 1 },
            "panelDensity": { "type": "string", "enum": ["dense", "normal", "comfortable"] },
            "contentDisplayMode": { "type": "string", "enum": ["summary", "middle", "raw"] },
            "quickItemLimit": { "type": "integer", "minimum": 1, "maximum": 100 },
            "maxStoredItems": { "type": "integer", "minimum": 1, "maximum": 100000 },
            "clipboardPollMs": { "type": "integer", "minimum": 100, "maximum": 60000 },
            "cleanupEnabled": { "type": "boolean" },
            "cleanupIntervalHours": { "type": "integer", "minimum": 1, "maximum": 8760 },
            "softDeletedRetentionDays": { "type": "integer", "minimum": 1, "maximum": 3650 },
            "enableMarkdownPreview": { "type": "boolean" },
            "fuzzySearchEnabled": { "type": "boolean" },
            "pinyinSearchEnabled": { "type": "boolean" },
            "tagMode": { "type": "string", "enum": ["similar", "rules", "off"] },
            "tagRules": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "id": { "type": "string", "minLength": 1 },
                        "label": { "type": "string", "minLength": 1, "maxLength": 32 },
                        "query": { "type": "string", "maxLength": 500 }
                    },
                    "required": ["id", "label", "query"]
                }
            },
            "positionStrategy": { "type": "string", "enum": ["trayCenter", "followCursor", "center", "windowCenter", "lastPosition", "focusInput"] },
            "panelBackgroundOpacity": { "type": "number", "minimum": 0.2, "maximum": 1 },
            "enableScrollCollapse": { "type": "boolean" },
            "panelWidth": { "type": "integer", "minimum": 300, "maximum": 1200 },
            "panelHeight": { "type": "integer", "minimum": 240, "maximum": 1200 },
            "onboardingCompleted": { "type": "boolean" },
            "onboardingShownAt": { "type": ["integer", "null"], "minimum": 0 },
            "launchAtLogin": { "type": "boolean" },
            "logMaxSizeMb": { "type": "integer", "minimum": 1, "maximum": 2048 },
            "logKeepRatio": { "type": "number", "minimum": 0.05, "maximum": 1 },
            "logMaxLines": { "type": "integer", "minimum": 100, "maximum": 2000000 },
            "logRetentionDays": { "type": "integer", "minimum": 0, "maximum": 3650 },
            "logAutoCleanup": { "type": "boolean" },
            "logCleanupIntervalMin": { "type": "integer", "minimum": 60, "maximum": 1440 },
            "debugLogsEnabled": { "type": "boolean" },
            "captureTextEnabled": { "type": "boolean" },
            "captureHtmlEnabled": { "type": "boolean" },
            "captureRtfEnabled": { "type": "boolean" },
            "captureImageEnabled": { "type": "boolean" },
            "captureFileEnabled": { "type": "boolean" },
            "captureSensitiveEnabled": { "type": "boolean" },
            "captureApplicationContext": { "type": "boolean" },
            "captureExternalContextOnClipboard": { "type": "boolean" },
            "enableExternalContextCollectors": { "type": "boolean" },
            "imageMaxSizeMb": { "type": "integer", "minimum": 1, "maximum": 4096 },
            "textMaxSizeMb": { "type": "integer", "minimum": 1, "maximum": 1024 },
            "agentProviders": { "$ref": "#/$defs/agentProvidersLegacy" },
            "agent": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "defaultProviderId": { "type": "string" },
                    "defaultAgentId": { "type": "string" },
                    "providers": { "$ref": "#/$defs/agentProviders" }
                }
            }
        },
        "$defs": {
            "agentProvidersLegacy": { "$ref": "#/$defs/agentProviders" },
            "agentProviders": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "id": { "type": "string", "minLength": 1 },
                        "name": { "type": "string", "minLength": 1 },
                        "label": { "type": "string", "minLength": 1 },
                        "kind": { "type": "string", "enum": ["openai-compatible", "openai", "openapi", "local-cli", "cli", "local-cli-configured"] },
                        "enabled": { "type": "boolean" },
                        "baseUrl": { "type": "string" },
                        "baseURL": { "type": "string" },
                        "endpoint": { "type": "string" },
                        "modelId": { "type": "string" },
                        "model": { "type": "string" },
                        "apiKey": { "type": "string" },
                        "apiKeyEnv": { "type": "string" },
                        "apiKeyRef": { "type": "string" },
                        "timeoutSeconds": { "type": "integer", "minimum": 1, "maximum": 600 },
                        "command": { "type": "string" },
                        "args": { "type": "array", "items": { "type": "string" } }
                    },
                    "required": ["id", "kind"]
                }
            }
        }
    })
}

fn resolve_schema_ref<'a>(root: &'a Value, schema: &'a Value) -> &'a Value {
    let Some(reference) = schema.get("$ref").and_then(Value::as_str) else {
        return schema;
    };
    if reference == "#/$defs/agentProviders" {
        return root
            .get("$defs")
            .and_then(|defs| defs.get("agentProviders"))
            .unwrap_or(schema);
    }
    if reference == "#/$defs/agentProvidersLegacy" {
        return root
            .get("$defs")
            .and_then(|defs| defs.get("agentProvidersLegacy"))
            .map(|value| resolve_schema_ref(root, value))
            .unwrap_or(schema);
    }
    schema
}

pub fn validate_settings_value(
    value: &Value,
    schema: &Value,
    root: &Value,
    path: &str,
    errors: &mut Vec<String>,
) {
    let schema = resolve_schema_ref(root, schema);
    if let Some(expected_type) = schema.get("type").and_then(Value::as_str) {
        let ok = match expected_type {
            "object" => value.is_object(),
            "array" => value.is_array(),
            "string" => value.is_string(),
            "boolean" => value.is_boolean(),
            "number" => value.is_number(),
            "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
            _ => true,
        };
        if !ok {
            errors.push(format!("{path} must be {expected_type}"));
            return;
        }
    }
    if let Some(options) = schema.get("enum").and_then(Value::as_array) {
        if !options.iter().any(|item| item == value) {
            errors.push(format!(
                "{path} must be one of {}",
                Value::Array(options.clone())
            ));
        }
    }
    if let Some(minimum) = schema.get("minimum").and_then(Value::as_f64) {
        if value.as_f64().is_some_and(|number| number < minimum) {
            errors.push(format!("{path} must be >= {minimum}"));
        }
    }
    if let Some(maximum) = schema.get("maximum").and_then(Value::as_f64) {
        if value.as_f64().is_some_and(|number| number > maximum) {
            errors.push(format!("{path} must be <= {maximum}"));
        }
    }
    if let Some(min_length) = schema.get("minLength").and_then(Value::as_u64) {
        if value
            .as_str()
            .is_some_and(|text| text.chars().count() < min_length as usize)
        {
            errors.push(format!("{path} is shorter than {min_length}"));
        }
    }
    if let Some(max_length) = schema.get("maxLength").and_then(Value::as_u64) {
        if value
            .as_str()
            .is_some_and(|text| text.chars().count() > max_length as usize)
        {
            errors.push(format!("{path} is longer than {max_length}"));
        }
    }
    if let (Some(object), Some(properties)) = (
        value.as_object(),
        schema.get("properties").and_then(Value::as_object),
    ) {
        let additional = schema
            .get("additionalProperties")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        for (key, item) in object {
            let next_path = if path == "$" {
                format!("$.{key}")
            } else {
                format!("{path}.{key}")
            };
            if let Some(property_schema) = properties.get(key) {
                validate_settings_value(item, property_schema, root, &next_path, errors);
            } else if !additional {
                errors.push(format!("{next_path} is not a supported setting key"));
            }
        }
    }
    if let (Some(items), Some(item_schema)) = (value.as_array(), schema.get("items")) {
        for (index, item) in items.iter().enumerate() {
            validate_settings_value(item, item_schema, root, &format!("{path}[{index}]"), errors);
        }
    }
}

pub fn settings_validation_error(errors: Vec<String>) -> String {
    format!(
        "SETTINGS_SCHEMA_VALIDATION_FAILED: {}; hint=Use clipf.settings.get to inspect schema, then retry with a smaller patch.",
        errors.join("; ")
    )
}

pub fn validate_settings_patch(input: &Value) -> Result<(), String> {
    let schema = settings_json_schema();
    let mut errors = Vec::new();
    validate_settings_value(input, &schema, &schema, "$", &mut errors);
    if errors.is_empty() {
        Ok(())
    } else {
        Err(settings_validation_error(errors))
    }
}
