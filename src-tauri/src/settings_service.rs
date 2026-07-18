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
