//! settings 域原子写实现（从 lib.rs 迁入，modularity Phase 3）：
//! SETTINGS_WRITE_LOCK 所有权在此，写路径唯一入口是 mod.rs 门面（run_settings_write /
//! commit_settings_*），本模块外禁止直接 .lock()；poisoned 后进程级降级（写禁用、读可用）。
//! 同时承载 patch/replace/reset 草稿构造（prepare_*）与原子写辅助。

use serde_json::Value;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};

use crate::{log_to_file, settings_path};

/// golden 用例（modularity Phase 3 评审修订项）：冻结纯函数层行为——修订冲突文案、
/// patch 合并结果、变更路径格式；重构前后断言不变。
#[cfg(test)]
mod golden_tests {
    use super::{collect_changed_paths, ensure_expected_settings_revision, merge_settings_patch};
    use serde_json::json;

    #[test]
    fn revision_conflict_message_is_stable() {
        // revision 是内容哈希(settings_revision 计算),fixture 里塞 "revision" 字段不影响
        let settings = json!({"general": {"launchAtLogin": false}});
        let error = ensure_expected_settings_revision(&settings, Some("rev-0")).unwrap_err();
        assert!(
            error.starts_with("SETTINGS_REVISION_CONFLICT: expected rev-0, current rev_")
                && error.ends_with("; get latest settings before retrying"),
            "实际文案: {error}"
        );
        // 无 expected / 空串 = 跳过乐观并发检查,返回当前内容哈希
        assert!(ensure_expected_settings_revision(&settings, None)
            .unwrap()
            .starts_with("rev_"));
        assert!(ensure_expected_settings_revision(&settings, Some("  "))
            .unwrap()
            .starts_with("rev_"));
    }

    #[test]
    fn patch_merge_and_changed_paths_are_stable() {
        let original = json!({"general": {"launchAtLogin": false}, "theme": "dark", "removed": 1});
        let mut base = original.clone();
        let patch = json!({"general": {"launchAtLogin": true}, "theme": "dark", "added": 2});
        merge_settings_patch(&mut base, &patch);
        // base 保留自身键、被 patch 覆盖/新增;patch 中 null 语义 = 删除(此处未用到)
        assert_eq!(
            base,
            json!({"general": {"launchAtLogin": true}, "theme": "dark", "removed": 1, "added": 2})
        );
        let mut paths = Vec::new();
        collect_changed_paths(&original, &base, "$", &mut paths);
        // 仅报告真正变化的路径;removed 在两边未变,不出现
        assert_eq!(paths, vec!["$.added", "$.general.launchAtLogin"]);
    }

    /// pi-sdk L2（keyRef/redact）：读路径把 apiKey 抹成 "[redacted]" 后，整表回写
    /// 不改动的条目应按 id 回填磁盘真实 key；新 key 原样落库；无同 id 旧条目时移除占位字段。
    #[test]
    fn redacted_provider_api_key_placeholder_is_restored_on_write() {
        let previous = json!({
            "agent": {"providers": [
                {"id": "a", "kind": "openai-compatible", "baseUrl": "https://x/v1", "modelId": "m", "apiKey": "sk-live-a"},
                {"id": "b", "kind": "openai-compatible", "baseUrl": "https://y/v1", "modelId": "m", "apiKey": "sk-live-b"}
            ]}
        });
        // 模拟设置页读到的脱敏形态：只改了 a 的 label，b 带 "[redacted]" 占位回写，c 是新条目带新 key。
        let mut next = json!({
            "agent": {"providers": [
                {"id": "a", "kind": "openai-compatible", "label": "改名", "baseUrl": "https://x/v1", "modelId": "m"},
                {"id": "b", "kind": "openai-compatible", "baseUrl": "https://y/v1", "modelId": "m", "apiKey": "[redacted]"},
                {"id": "c", "kind": "openai-compatible", "baseUrl": "https://z/v1", "modelId": "m", "apiKey": "sk-new-c"}
            ]}
        });
        super::preserve_redacted_provider_api_keys(&mut next, &previous);
        let providers = next["agent"]["providers"].as_array().unwrap();
        assert!(
            providers[0].get("apiKey").is_none(),
            "未带占位符的新条目不应凭空获得 key"
        );
        assert_eq!(
            providers[1]["apiKey"].as_str(),
            Some("sk-live-b"),
            "占位符应回填磁盘真实 key"
        );
        assert_eq!(
            providers[2]["apiKey"].as_str(),
            Some("sk-new-c"),
            "新 key 应原样落库"
        );

        // 无同 id 旧条目：占位符不允许被当作 key 存储。
        let previous_empty = json!({});
        let mut next_orphan = json!({
            "agent": {"providers": [{"id": "d", "kind": "openai-compatible", "apiKey": "[redacted]"}]}
        });
        super::preserve_redacted_provider_api_keys(&mut next_orphan, &previous_empty);
        assert!(
            next_orphan["agent"]["providers"][0].get("apiKey").is_none(),
            "无磁盘旧值的占位符应被移除"
        );
    }

    /// pi-sdk L2（读路径证据）：redact_settings_value 对新结构 agent.providers[] 与
    /// legacy 顶层 agentProviders[] 两条路径都把 apiKey 抹成 "[redacted]"，其余字段保留。
    #[test]
    fn read_path_redacts_agent_provider_api_keys_both_shapes() {
        let settings = json!({
            "agent": {"providers": [{"id": "a", "kind": "openai-compatible", "apiKey": "sk-live-a"}]},
            "agentProviders": [{"provider": "anthropic", "apiKey": "sk-legacy"}]
        });
        let redacted = super::super::redact_settings_value(&settings);
        assert_eq!(
            redacted["agent"]["providers"][0]["apiKey"].as_str(),
            Some("[redacted]"),
            "agent.providers[].apiKey 必须脱敏"
        );
        assert_eq!(
            redacted["agentProviders"][0]["apiKey"].as_str(),
            Some("[redacted]"),
            "legacy agentProviders[].apiKey 必须脱敏"
        );
        assert_eq!(
            redacted["agent"]["providers"][0]["id"].as_str(),
            Some("a"),
            "非 key 字段保留"
        );
    }
}

/// 设置写入互斥锁（B2b）：保护 read-modify-write 全段，避免设置窗 + MCP/主面板并发写入导致 lost-update。
/// Phase 3 起锁私有于本模块，且只在 mod.rs 门面（run_settings_write / commit_settings_*）里持有；
/// 底层 read/write 不加锁，避免重入死锁。
static SETTINGS_WRITE_LOCK: Mutex<()> = Mutex::new(());

/// 进程级降级标记（铁律 3）：锁一旦 poisoned，本进程禁用一切设置写入（读不受影响），需重启恢复；
/// 不自动重建锁。
static SETTINGS_WRITE_DEGRADED: AtomicBool = AtomicBool::new(false);

/// 获取设置写锁（仅 mod.rs 门面调用）：
/// - 已降级：直接拒绝写入；
/// - poisoned：标记降级并返回 SETTINGS_LOCK_POISONED 错误。
pub(super) fn acquire_settings_write_lock() -> Result<MutexGuard<'static, ()>, String> {
    if SETTINGS_WRITE_DEGRADED.load(Ordering::SeqCst) {
        return Err(
            "SETTINGS_WRITE_DEGRADED: settings write lock previously poisoned; writes disabled until restart"
                .to_string(),
        );
    }
    SETTINGS_WRITE_LOCK.lock().map_err(|error| {
        SETTINGS_WRITE_DEGRADED.store(true, Ordering::SeqCst);
        log_to_file(
            "error",
            "settings-service",
            &format!("settings write lock poisoned: {error}; writes disabled until restart"),
        );
        format!("SETTINGS_LOCK_POISONED: {error}")
    })
}

/// 一次设置写事务的产物：next 为落盘内容，previous_revision/changed_paths 供事件与响应组装。
pub struct SettingsWriteDraft {
    pub next: Value,
    pub previous_revision: String,
    pub changed_paths: Vec<String>,
}

pub fn ensure_expected_settings_revision(
    settings: &Value,
    expected_revision: Option<&str>,
) -> Result<String, String> {
    let revision = super::settings_revision(settings);
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
        .or_insert_with(|| serde_json::json!({}));
    if !agent_entry.is_object() {
        *agent_entry = serde_json::json!({});
    }
    if let Some(agent_object) = agent_entry.as_object_mut() {
        agent_object
            .entry("providers".to_string())
            .or_insert(legacy_providers);
    }
}

/// 读路径（redact_provider_api_key）把 agent.providers[].apiKey 统一抹成 "[redacted]" 占位，
/// 设置页整表回写（数组按 patch 语义整表替换）时未改动的 key 字段仍是占位符；此处按 id
/// 回填磁盘上的真实值，避免「只改了 label 却把 key 抹成占位符」的回归。新 key（非占位符）
/// 原样落库；找不到同 id 旧条目时移除占位字段（不允许把占位符当 key 存储）。
fn preserve_redacted_provider_api_keys(next: &mut Value, previous: &Value) {
    let Some(next_providers) = next
        .get_mut("agent")
        .and_then(|agent| agent.get_mut("providers"))
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    let previous_providers = previous
        .get("agent")
        .and_then(|agent| agent.get("providers"))
        .and_then(Value::as_array)
        .or_else(|| previous.get("agentProviders").and_then(Value::as_array));
    for entry in next_providers.iter_mut() {
        let Some(object) = entry.as_object_mut() else {
            continue;
        };
        if object.get("apiKey").and_then(Value::as_str) != Some("[redacted]") {
            continue;
        }
        let Some(id) = object.get("id").and_then(Value::as_str).map(str::to_string) else {
            object.remove("apiKey");
            continue;
        };
        let stored_key = previous_providers
            .and_then(|list| {
                list.iter()
                    .find(|entry| entry.get("id").and_then(Value::as_str) == Some(id.as_str()))
            })
            .and_then(|entry| entry.get("apiKey").and_then(Value::as_str))
            .map(str::to_string);
        match stored_key {
            Some(key) => {
                object.insert("apiKey".to_string(), Value::String(key));
            }
            None => {
                object.remove("apiKey");
            }
        }
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
    preserve_redacted_provider_api_keys(&mut next, previous);
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
    preserve_redacted_provider_api_keys(&mut next, previous);
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
        "all" => next = serde_json::json!({}),
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

#[tauri::command]
pub fn write_user_settings(settings: Value) -> Result<(), String> {
    write_settings_atomic(&settings)
}

/// 原子写入用户设置（B2）：先写临时文件并 fsync，再 rename 覆盖目标文件。
///
/// 所有写路径（settings_service_*、update_clipforge_settings、legacy 命令）都经过这里。
/// 裸 `fs::write` 在崩溃/断电时会截断或清空 settings.json5，导致丢失全部用户配置；
/// temp + sync_all + rename 保证目标文件要么是旧内容、要么是完整新内容，不会出现半写状态。
pub(super) fn write_settings_atomic(settings: &Value) -> Result<(), String> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let body = format!(
        "// ClipForge user settings. JSON5-style comments are allowed.\n{}\n",
        serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?
    );
    // 临时文件必须与目标在同一目录、同一文件系统，rename 才原子。
    let temp_path = match path.file_name().and_then(|name| name.to_str()) {
        Some(name) => path.with_file_name(format!("{name}.tmp")),
        None => return Err("SETTINGS_PATH_INVALID: cannot resolve settings file name".to_string()),
    };
    {
        let mut file = std::fs::File::create(&temp_path).map_err(|error| error.to_string())?;
        file.write_all(body.as_bytes())
            .map_err(|error| error.to_string())?;
        // fsync 确保数据落盘后再 rename，否则断电仍可能丢数据。
        file.sync_all().map_err(|error| error.to_string())?;
    }
    std::fs::rename(&temp_path, &path)
        .map_err(|error| format!("SETTINGS_ATOMIC_RENAME_FAILED: {error}"))
}
