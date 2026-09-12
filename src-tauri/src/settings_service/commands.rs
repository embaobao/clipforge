//! settings_service_* Tauri 命令层（从 lib.rs 迁入，modularity Phase 3）。
//! 依赖主体辅助函数经 crate:: 引用；SETTINGS_WRITE_LOCK 已 pub(crate)。

use serde_json::{json, Value};

use crate::AgentProviderModelsPayload;
use crate::AgentProviderReadiness;
use crate::SETTINGS_WRITE_LOCK;
use crate::agent_check_provider;
use crate::agent_list_provider_models;
use crate::emit_settings_changed;
use crate::log_slow_settings_operation;
use crate::log_to_file;
use crate::now_millis;
use crate::prepare_settings_patch;
use crate::prepare_settings_replace;
use crate::prepare_settings_reset;
use crate::read_user_settings;
use crate::refresh_tray_menu_after_settings_write;
use crate::public_settings_payload;
use crate::settings_service_resolve_agent_config;
use crate::write_user_settings;
use crate::settings_revision;
use crate::settings_write_response;
use crate::sync_global_shortcut_registration;
use crate::sync_launch_at_login_from_settings;
use crate::validate_settings_patch;

// ---- settings_service_get ----
#[tauri::command]
pub fn settings_service_get(include_schema: Option<bool>) -> Result<Value, String> {
    // 记录耗时（B6）：300ms 是控制面操作的硬预算，超限写 log 便于回归追踪。
    let started = std::time::Instant::now();
    let mut payload = public_settings_payload(include_schema.unwrap_or(true))?;
    let duration_ms = started.elapsed().as_millis() as i64;
    payload["durationMs"] = json!(duration_ms);
    log_slow_settings_operation("get", duration_ms);
    Ok(payload)
}


// ---- settings_service_patch ----
#[tauri::command]
pub fn settings_service_patch<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    patch: Value,
    actor: Option<String>,
    reason: Option<String>,
    expected_revision: Option<String>,
) -> Result<Value, String> {
    let started = std::time::Instant::now();
    let _write_guard = SETTINGS_WRITE_LOCK
        .lock()
        .map_err(|error| format!("SETTINGS_LOCK_POISONED: {error}"))?;
    validate_settings_patch(&patch)?;
    let previous = read_user_settings()?.settings;
    let draft = prepare_settings_patch(&previous, &patch, expected_revision.as_deref())?;
    let previous_revision = draft.previous_revision;
    let changed_paths = draft.changed_paths;
    let next = draft.next;
    write_user_settings(next.clone())?;
    if changed_paths.iter().any(|path| path == "$.launchAtLogin") {
        sync_launch_at_login_from_settings(&app, &next, "settings-service-patch");
    }
    sync_global_shortcut_registration(&app);
    refresh_tray_menu_after_settings_write(&app, "settings-service-patch");
    let updated_at = now_millis()?;
    let revision = settings_revision(&next);
    emit_settings_changed(
        &app,
        previous_revision.clone(),
        revision,
        changed_paths.clone(),
        actor.as_deref().unwrap_or("settings-window"),
        "patch",
        updated_at,
    );
    log_to_file(
        "info",
        "settings-service",
        &format!(
            "patch actor={} reason={} changed={}",
            actor.as_deref().unwrap_or("settings-window"),
            reason.as_deref().unwrap_or(""),
            changed_paths.join(",")
        ),
    );
    let mut response = settings_write_response(next, previous_revision, changed_paths, true)?;
    let duration_ms = started.elapsed().as_millis() as i64;
    response["durationMs"] = json!(duration_ms);
    log_slow_settings_operation("patch", duration_ms);
    Ok(response)
}


// ---- settings_service_replace ----
#[tauri::command]
pub fn settings_service_replace<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    settings: Value,
    actor: Option<String>,
    reason: Option<String>,
    expected_revision: Option<String>,
    confirmed: Option<bool>,
) -> Result<Value, String> {
    let started = std::time::Instant::now();
    if confirmed != Some(true) {
        return Err("SETTINGS_REPLACE_REQUIRES_CONFIRMATION: use patch for partial updates or retry with confirmed=true".to_string());
    }
    let _write_guard = SETTINGS_WRITE_LOCK
        .lock()
        .map_err(|error| format!("SETTINGS_LOCK_POISONED: {error}"))?;
    validate_settings_patch(&settings)?;
    let previous = read_user_settings()?.settings;
    let draft = prepare_settings_replace(&previous, settings, expected_revision.as_deref())?;
    let previous_revision = draft.previous_revision;
    let changed_paths = draft.changed_paths;
    let next = draft.next;
    write_user_settings(next.clone())?;
    sync_launch_at_login_from_settings(&app, &next, "settings-service-replace");
    sync_global_shortcut_registration(&app);
    refresh_tray_menu_after_settings_write(&app, "settings-service-replace");
    let updated_at = now_millis()?;
    let revision = settings_revision(&next);
    emit_settings_changed(
        &app,
        previous_revision.clone(),
        revision,
        changed_paths.clone(),
        actor.as_deref().unwrap_or("settings-window"),
        "replace",
        updated_at,
    );
    log_to_file(
        "warn",
        "settings-service",
        &format!(
            "replace actor={} reason={} changed={}",
            actor.as_deref().unwrap_or("settings-window"),
            reason.as_deref().unwrap_or(""),
            changed_paths.join(",")
        ),
    );
    let mut response = settings_write_response(next, previous_revision, changed_paths, true)?;
    let duration_ms = started.elapsed().as_millis() as i64;
    response["durationMs"] = json!(duration_ms);
    log_slow_settings_operation("replace", duration_ms);
    Ok(response)
}


// ---- settings_service_reset ----
#[tauri::command]
pub fn settings_service_reset<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    scope: Option<String>,
    actor: Option<String>,
    reason: Option<String>,
    expected_revision: Option<String>,
    confirmed: Option<bool>,
) -> Result<Value, String> {
    let started = std::time::Instant::now();
    if confirmed != Some(true) {
        return Err(
            "SETTINGS_RESET_REQUIRES_CONFIRMATION: retry with scope and confirmed=true".to_string(),
        );
    }
    let _write_guard = SETTINGS_WRITE_LOCK
        .lock()
        .map_err(|error| format!("SETTINGS_LOCK_POISONED: {error}"))?;
    let scope = scope.ok_or_else(|| {
        "SETTINGS_RESET_REQUIRES_SCOPE: use one of all, agent, shortcuts, display, capture, storage, logs, tags".to_string()
    })?;
    let previous = read_user_settings()?.settings;
    let draft = prepare_settings_reset(&previous, &scope, expected_revision.as_deref())?;
    let previous_revision = draft.previous_revision;
    let changed_paths = draft.changed_paths;
    let next = draft.next;
    write_user_settings(next.clone())?;
    sync_launch_at_login_from_settings(&app, &next, "settings-service-reset");
    sync_global_shortcut_registration(&app);
    refresh_tray_menu_after_settings_write(&app, "settings-service-reset");
    let updated_at = now_millis()?;
    let revision = settings_revision(&next);
    emit_settings_changed(
        &app,
        previous_revision.clone(),
        revision,
        changed_paths.clone(),
        actor.as_deref().unwrap_or("settings-window"),
        "reset",
        updated_at,
    );
    log_to_file(
        "warn",
        "settings-service",
        &format!(
            "reset scope={} actor={} reason={} changed={}",
            scope,
            actor.as_deref().unwrap_or("settings-window"),
            reason.as_deref().unwrap_or(""),
            changed_paths.join(",")
        ),
    );
    let mut response = settings_write_response(next, previous_revision, changed_paths, true)?;
    let duration_ms = started.elapsed().as_millis() as i64;
    response["durationMs"] = json!(duration_ms);
    log_slow_settings_operation("reset", duration_ms);
    Ok(response)
}


// ---- settings_service_agent_providers ----
#[tauri::command]
pub fn settings_service_agent_providers() -> Result<Value, String> {
    settings_service_agent_providers_payload()
}


// ---- settings_service_agent_providers_payload ----
pub fn settings_service_agent_providers_payload() -> Result<Value, String> {
    let config = settings_service_resolve_agent_config()?;
    Ok(json!({
        "activeProviderId": config.active_provider_id,
        "providers": config.providers,
        "tools": config.tools,
        "revision": settings_revision(&read_user_settings()?.settings)
    }))
}


// ---- settings_service_agent_check ----
#[tauri::command]
pub fn settings_service_agent_check(
    provider_id: Option<String>,
) -> Result<AgentProviderReadiness, String> {
    agent_check_provider(provider_id)
}


// ---- settings_service_agent_models ----
#[tauri::command]
pub fn settings_service_agent_models(
    provider_id: Option<String>,
) -> Result<AgentProviderModelsPayload, String> {
    agent_list_provider_models(provider_id)
}


