pub mod commands;
pub use commands::{settings_service_agent_check, settings_service_agent_models, settings_service_agent_providers, settings_service_agent_providers_payload, settings_service_get, settings_service_patch, settings_service_replace, settings_service_reset};

use serde_json::{json, Value};
use std::hash::{Hash, Hasher};

pub struct SettingsWriteDraft {
    pub next: Value,
    pub previous_revision: String,
    pub changed_paths: Vec<String>,
}

pub fn settings_revision(settings: &Value) -> String {
    let serialized = serde_json::to_string(settings).unwrap_or_else(|_| settings.to_string());
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    serialized.hash(&mut hasher);
    format!("rev_{:016x}", hasher.finish())
}

pub fn ensure_expected_settings_revision(
    settings: &Value,
    expected_revision: Option<&str>,
) -> Result<String, String> {
    let revision = settings_revision(settings);
    if let Some(expected_revision) = expected_revision {
        if !expected_revision.trim().is_empty() && expected_revision != revision {
            return Err(format!(
                "SETTINGS_REVISION_CONFLICT: expected {expected_revision}, current {revision}; get latest settings before retrying"
            ));
        }
    }
    Ok(revision)
}

fn collect_changed_paths(previous: &Value, next: &Value, path: &str, out: &mut Vec<String>) {
    if previous == next {
        return;
    }
    match (previous.as_object(), next.as_object()) {
        (Some(previous_object), Some(next_object)) => {
            let mut keys = previous_object.keys().collect::<Vec<_>>();
            for key in next_object.keys() {
                if !previous_object.contains_key(key) {
                    keys.push(key);
                }
            }
            keys.sort();
            keys.dedup();
            for key in keys {
                let next_path = if path == "$" {
                    format!("$.{key}")
                } else {
                    format!("{path}.{key}")
                };
                collect_changed_paths(
                    previous_object.get(key).unwrap_or(&Value::Null),
                    next_object.get(key).unwrap_or(&Value::Null),
                    &next_path,
                    out,
                );
            }
        }
        _ => out.push(path.to_string()),
    }
}

pub fn settings_changed_paths(previous: &Value, next: &Value) -> Vec<String> {
    let mut out = Vec::new();
    collect_changed_paths(previous, next, "$", &mut out);
    if out.is_empty() {
        vec![]
    } else {
        out
    }
}

pub fn merge_settings_patch(base: &mut Value, patch: &Value) {
    if !base.is_object() || !patch.is_object() {
        *base = patch.clone();
        return;
    }
    let Some(base_object) = base.as_object_mut() else {
        return;
    };
    let Some(patch_object) = patch.as_object() else {
        return;
    };
    for (key, value) in patch_object {
        if value.is_null() {
            base_object.remove(key);
        } else if value.is_object() {
            let entry = base_object
                .entry(key.clone())
                .or_insert_with(|| Value::Object(Default::default()));
            merge_settings_patch(entry, value);
        } else {
            base_object.insert(key.clone(), value.clone());
        }
    }
}

/// 兼容读取 legacy `agentProviders`，但 Settings Service 新写入统一落到 `agent.providers`。
fn normalize_agent_provider_write(settings: &mut Value) {
    let Some(object) = settings.as_object_mut() else {
        return;
    };
    let Some(legacy_providers) = object.remove("agentProviders") else {
        return;
    };
    let agent_entry = object
        .entry("agent".to_string())
        .or_insert_with(|| json!({}));
    if !agent_entry.is_object() {
        *agent_entry = json!({});
    }
    if let Some(agent_object) = agent_entry.as_object_mut() {
        agent_object
            .entry("providers".to_string())
            .or_insert(legacy_providers);
    }
}

pub fn prepare_patch(
    previous: &Value,
    patch: &Value,
    expected_revision: Option<&str>,
) -> Result<SettingsWriteDraft, String> {
    let previous_revision = ensure_expected_settings_revision(previous, expected_revision)?;
    let mut next = previous.clone();
    merge_settings_patch(&mut next, patch);
    normalize_agent_provider_write(&mut next);
    let changed_paths = settings_changed_paths(previous, &next);
    Ok(SettingsWriteDraft {
        next,
        previous_revision,
        changed_paths,
    })
}

pub fn prepare_replace(
    previous: &Value,
    settings: Value,
    expected_revision: Option<&str>,
) -> Result<SettingsWriteDraft, String> {
    let previous_revision = ensure_expected_settings_revision(previous, expected_revision)?;
    let mut next = settings;
    normalize_agent_provider_write(&mut next);
    let changed_paths = settings_changed_paths(previous, &next);
    Ok(SettingsWriteDraft {
        next,
        previous_revision,
        changed_paths,
    })
}

pub fn prepare_reset(
    previous: &Value,
    scope: &str,
    expected_revision: Option<&str>,
) -> Result<SettingsWriteDraft, String> {
    let previous_revision = ensure_expected_settings_revision(previous, expected_revision)?;
    let mut next = previous.clone();
    match scope {
        "all" => next = json!({}),
        "agent" => {
            if let Some(object) = next.as_object_mut() {
                object.remove("agent");
                object.remove("agentProviders");
            }
        }
        "shortcuts" => {
            if let Some(object) = next.as_object_mut() {
                object.remove("globalShortcut");
            }
        }
        "display" => {
            if let Some(object) = next.as_object_mut() {
                for key in [
                    "panelDensity",
                    "contentDisplayMode",
                    "positionStrategy",
                    "panelBackgroundOpacity",
                    "enableScrollCollapse",
                    "panelWidth",
                    "panelHeight",
                ] {
                    object.remove(key);
                }
            }
        }
        "capture" => {
            if let Some(object) = next.as_object_mut() {
                for key in [
                    "captureTextEnabled",
                    "captureHtmlEnabled",
                    "captureRtfEnabled",
                    "captureImageEnabled",
                    "captureFileEnabled",
                    "captureSensitiveEnabled",
                    "captureExternalContextOnClipboard",
                    "enableExternalContextCollectors",
                    "imageMaxSizeMb",
                    "textMaxSizeMb",
                ] {
                    object.remove(key);
                }
            }
        }
        "storage" => {
            if let Some(object) = next.as_object_mut() {
                for key in [
                    "quickItemLimit",
                    "maxStoredItems",
                    "clipboardPollMs",
                    "cleanupEnabled",
                    "cleanupIntervalHours",
                    "softDeletedRetentionDays",
                ] {
                    object.remove(key);
                }
            }
        }
        "logs" => {
            if let Some(object) = next.as_object_mut() {
                for key in [
                    "logMaxSizeMb",
                    "logKeepRatio",
                    "logMaxLines",
                    "logRetentionDays",
                    "logAutoCleanup",
                    "logCleanupIntervalMin",
                    "debugLogsEnabled",
                ] {
                    object.remove(key);
                }
            }
        }
        "tags" => {
            if let Some(object) = next.as_object_mut() {
                object.remove("tagMode");
                object.remove("tagRules");
            }
        }
        _ => {
            return Err("SETTINGS_RESET_INVALID_SCOPE: use one of all, agent, shortcuts, display, capture, storage, logs, tags".to_string());
        }
    }
    let changed_paths = settings_changed_paths(previous, &next);
    Ok(SettingsWriteDraft {
        next,
        previous_revision,
        changed_paths,
    })
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

