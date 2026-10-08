//! settings_service_* Tauri 命令层（从 lib.rs 迁入，modularity Phase 3）。
//! Phase 3 起写路径经 mod.rs 门面（commit_settings_*）走锁：锁内只做读-改-原子写，
//! emit/自启/快捷键/托盘等副作用一律在锁释放后执行；本文件不再直接触碰 SETTINGS_WRITE_LOCK。

use serde_json::{json, Value};
use tauri::Emitter;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::agent::{
    agent_check_provider, agent_list_provider_models, AgentProviderModelsPayload,
    AgentProviderReadiness,
};
use crate::{
    append_app_log, build_tray_menu, log_to_file, now_millis, set_launch_at_login_native,
    toggle_quick_panel, TRAY_ID,
};

use super::{
    commit_settings_patch, commit_settings_replace, commit_settings_reset, desired_launch_at_login,
    public_settings_payload, read_user_settings, redact_settings_value, run_settings_write,
    settings_changed_paths, settings_revision, validate_settings_patch,
};

const DEFAULT_GLOBAL_SHORTCUT: &str = "Control+V";
const LEGACY_DEFAULT_GLOBAL_SHORTCUT: &str = "CommandOrControl+Shift+V";
const FALLBACK_GLOBAL_SHORTCUT: &str = "Control+V";

fn normalize_global_shortcut_value(raw: Option<&str>) -> String {
    let shortcut = raw.unwrap_or_default().trim();
    if shortcut.is_empty() || shortcut.eq_ignore_ascii_case(LEGACY_DEFAULT_GLOBAL_SHORTCUT) {
        DEFAULT_GLOBAL_SHORTCUT.to_string()
    } else {
        shortcut.to_string()
    }
}

/// 读取当前生效的全局快捷键（托盘菜单展示用；从 lib.rs 迁入，Phase 3）。
pub fn current_global_shortcut_value() -> String {
    read_user_settings()
        .ok()
        .and_then(|settings| {
            settings
                .settings
                .get("globalShortcut")
                .and_then(Value::as_str)
                .map(|value| value.to_string())
        })
        .map(|value| normalize_global_shortcut_value(Some(&value)))
        .unwrap_or_else(|| DEFAULT_GLOBAL_SHORTCUT.to_string())
}

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
    // 校验是纯计算，放锁外，缩短持锁时间（铁律 2）。
    validate_settings_patch(&patch)?;
    let draft = commit_settings_patch(&patch, expected_revision.as_deref())?;
    let previous_revision = draft.previous_revision;
    let changed_paths = draft.changed_paths;
    let next = draft.next;
    // 锁已释放：副作用（自启/快捷键/托盘/emit）在锁外执行。
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
    validate_settings_patch(&settings)?;
    let draft = commit_settings_replace(settings, expected_revision.as_deref())?;
    let previous_revision = draft.previous_revision;
    let changed_paths = draft.changed_paths;
    let next = draft.next;
    // 锁已释放：副作用在锁外执行。
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
    let scope = scope.ok_or_else(|| {
        "SETTINGS_RESET_REQUIRES_SCOPE: use one of all, agent, shortcuts, display, capture, storage, logs, tags".to_string()
    })?;
    let draft = commit_settings_reset(&scope, expected_revision.as_deref())?;
    let previous_revision = draft.previous_revision;
    let changed_paths = draft.changed_paths;
    let next = draft.next;
    // 锁已释放：副作用在锁外执行。
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
    let config = crate::agent::settings_service_resolve_agent_config()?;
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

// ---- legacy 设置写命令（从 lib.rs 迁入，Phase 3）----

/// legacy update_clipforge_settings 的浅合并辅助：顶层键覆盖，不做深层 merge。
fn merge_json_object(base: &mut Value, patch: Value) {
    if !base.is_object() {
        *base = Value::Object(Default::default());
    }
    let Some(base_object) = base.as_object_mut() else {
        return;
    };
    if let Some(patch_object) = patch.as_object() {
        for (key, value) in patch_object {
            base_object.insert(key.clone(), value.clone());
        }
    }
}

#[tauri::command]
pub fn update_clipforge_settings<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: Value,
) -> Result<Value, String> {
    // legacy 写路径同样走 settings_service 门面锁 + settings_changed 事件总线（B2b + B5），
    // 消除多窗口漂移根因；锁内只做读-合并-原子写，副作用在锁外。
    let (previous_revision, current, changed_paths) = run_settings_write(|previous| {
        let mut current = previous.clone();
        merge_json_object(&mut current, input);
        let changed_paths = settings_changed_paths(previous, &current);
        let previous_revision = settings_revision(previous);
        Ok((
            Some(current.clone()),
            (previous_revision, current, changed_paths),
        ))
    })?;
    if changed_paths.iter().any(|path| path == "$.launchAtLogin") {
        sync_launch_at_login_from_settings(&app, &current, "legacy-settings-patch");
    }
    sync_global_shortcut_registration(&app);
    refresh_tray_menu_after_settings_write(&app, "legacy-settings-patch");
    let updated_at = now_millis()?;
    let revision = settings_revision(&current);
    emit_settings_changed(
        &app,
        previous_revision,
        revision,
        changed_paths,
        "settings-window",
        "patch",
        updated_at,
    );
    Ok(current)
}

// ---- 设置写入后的托盘/快捷键同步（从 lib.rs 迁入，Phase 3）----

/// 设置写入后重建托盘菜单（语言/快捷键文案可能已变）。
pub fn refresh_tray_menu_after_settings_write<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    reason: &str,
) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        match build_tray_menu(app) {
            Ok(menu) => {
                if let Err(error) = tray.set_menu(Some(menu)) {
                    log_to_file(
                        "warn",
                        "tray",
                        &format!("set_menu after settings write failed reason={reason}: {error}"),
                    );
                } else {
                    log_to_file(
                        "info",
                        "tray",
                        &format!("rebuilt menu after settings write reason={reason}"),
                    );
                }
            }
            Err(error) => log_to_file(
                "warn",
                "tray",
                &format!("rebuild menu after settings write failed reason={reason}: {error}"),
            ),
        }
    }
}

/// 读取设置并归一出需要注册的全局快捷键列表（主快捷键 + 默认 + fallback 去重）。
fn registered_global_shortcuts() -> Vec<String> {
    let configured = read_user_settings()
        .ok()
        .and_then(|settings| {
            settings
                .settings
                .get("globalShortcut")
                .and_then(Value::as_str)
                .map(|value| value.trim().to_string())
        })
        .unwrap_or_default();
    let primary = normalize_global_shortcut_value(Some(&configured));
    let mut shortcuts = vec![
        primary,
        DEFAULT_GLOBAL_SHORTCUT.to_string(),
        FALLBACK_GLOBAL_SHORTCUT.to_string(),
    ];

    shortcuts.sort();
    shortcuts.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    shortcuts
}

/// 按当前设置重建全局快捷键注册（设置写入后与 app 启动时调用）。
pub fn sync_global_shortcut_registration<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let shortcuts = registered_global_shortcuts();
    if let Err(error) = app.global_shortcut().unregister_all() {
        let _ = append_app_log(
            "warn".to_string(),
            "Unregister global shortcuts failed".to_string(),
            Some(error.to_string()),
        );
    }

    for shortcut in &shortcuts {
        let shortcut_label = shortcut.clone();
        let pressed_label = shortcut.clone();
        if let Err(error) =
            app.global_shortcut()
                .on_shortcut(shortcut.as_str(), move |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        log_to_file("debug", "shortcut", &format!("pressed {}", pressed_label));
                        toggle_quick_panel(app, "shortcut");
                    }
                })
        {
            let _ = append_app_log(
                "warn".to_string(),
                "Register global shortcut failed".to_string(),
                Some(format!("{}: {}", shortcut_label, error)),
            );
        }
    }

    log_to_file(
        "info",
        "shortcut",
        &format!("registered shortcuts: {}", shortcuts.join(", ")),
    );
}

// ---- 设置写盘编排辅助（从 lib.rs 迁入）----

pub fn settings_write_response(
    settings: Value,
    previous_revision: String,
    changed_paths: Vec<String>,
    include_schema: bool,
) -> Result<Value, String> {
    let mut payload = public_settings_payload(include_schema)?;
    payload["previousRevision"] = Value::String(previous_revision);
    payload["changedPaths"] = Value::Array(changed_paths.into_iter().map(Value::String).collect());
    payload["nextActions"] = json!([
        "Prefer settings_service_patch / clipf.settings.patch for follow-up changes.",
        "Use settings_service_get / clipf.settings.get to refresh schema and revision before replace/reset."
    ]);
    payload["settings"] = redact_settings_value(&settings);
    Ok(payload)
}

pub fn emit_settings_changed<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    previous_revision: String,
    revision: String,
    changed_paths: Vec<String>,
    actor: &str,
    mode: &str,
    updated_at: i64,
) {
    let _ = app.emit(
        "settings_changed",
        json!({
            "revision": revision,
            "previousRevision": previous_revision,
            "changedPaths": changed_paths,
            "actor": actor,
            "mode": mode,
            "updatedAt": updated_at
        }),
    );
}

pub fn sync_launch_at_login_from_settings<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &Value,
    reason: &str,
) {
    let desired = desired_launch_at_login(settings);
    match set_launch_at_login_native(app, desired) {
        Ok(status) => log_to_file(
            "info",
            "autostart",
            &format!(
                "sync reason={} desired={} enabled={} supported={}",
                reason, status.desired, status.enabled, status.supported
            ),
        ),
        Err(error) => log_to_file(
            "warn",
            "autostart",
            &format!("sync reason={} failed: {}", reason, error),
        ),
    }
}

pub fn log_slow_settings_operation(operation: &str, duration_ms: i64) {
    if duration_ms > 300 {
        log_to_file(
            "warn",
            "settings-service",
            &format!("slow {operation} durationMs={duration_ms} > 300"),
        );
    }
}
