//! 托盘域：托盘菜单构建、菜单/图标事件处理。
//! 从 lib.rs setup_app 平移（S3 切片）；TRAY_ID 与 build_tray_menu 供 settings_service 复用。

use tauri::{
    menu::{Menu, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

use crate::log_service::log_to_file;
use crate::settings_service::current_global_shortcut_value;
use crate::{cleanup_agent_children, is_listen_paused, native_tr, set_listen_paused};
use crate::window::show_quick_panel;

/// 托盘菜单 id（用于切换监听状态后通过 app.tray_by_id 重建菜单刷新文案）。
pub(crate) const TRAY_ID: &str = "main-tray";

#[cfg(target_os = "macos")]
pub(crate) fn log_runtime_identity() {
    match crate::get_accessibility_diagnostics_platform() {
        Ok(diagnostics) => {
            let tcc_summary = diagnostics
                .tcc_records
                .iter()
                .map(|record| {
                    format!(
                        "{}:{}:{}:{}",
                        record.database, record.client, record.auth_label, record.csreq_summary
                    )
                })
                .collect::<Vec<_>>()
                .join("|");
            log_to_file(
                "info",
                "startup",
                &format!(
                    "runtime identity bundleId={} signatureId={} signatureKind={} cdHash={} trusted={} appPath={} tccRecords={} tccError={}",
                    diagnostics.expected_bundle_identifier,
                    diagnostics.code_signature_identifier,
                    diagnostics.signature_kind,
                    diagnostics.cd_hash,
                    diagnostics.trusted,
                    diagnostics.app_bundle_path,
                    tcc_summary,
                    diagnostics.tcc_query_error.unwrap_or_default()
                ),
            );
        }
        Err(error) => log_to_file(
            "warn",
            "startup",
            &format!("runtime identity diagnostics failed: {}", error),
        ),
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn log_runtime_identity() {}

/// 构建托盘右键菜单。监听开关的文案随 LISTEN_PAUSED 当前状态变化，
/// 因此切换后调用方需 set_menu 重建以刷新显示。
pub(crate) fn build_tray_menu<R: tauri::Runtime, M: Manager<R>>(
    manager: &M,
) -> Result<Menu<R>, String> {
    let open_quick = MenuItemBuilder::with_id("open_quick", native_tr("tray.openQuick"))
        .accelerator(&current_global_shortcut_value())
        .build(manager)
        .map_err(|e| e.to_string())?;
    let preferences = MenuItemBuilder::with_id("preferences", native_tr("tray.preferences"))
        .build(manager)
        .map_err(|e| e.to_string())?;
    let listen_label = if is_listen_paused() {
        native_tr("tray.resumeListening")
    } else {
        native_tr("tray.pauseListening")
    };
    let toggle_listen = MenuItemBuilder::with_id("toggle_listen", listen_label)
        .build(manager)
        .map_err(|e| e.to_string())?;
    let quit = MenuItemBuilder::with_id("quit", native_tr("tray.quit"))
        .build(manager)
        .map_err(|e| e.to_string())?;
    Menu::with_items(manager, &[&open_quick, &preferences, &toggle_listen, &quit])
        .map_err(|e| e.to_string())
}

/// 注册托盘图标、菜单与事件处理（托盘之外的启动流程仍留在 lib.rs setup_app）。
pub(crate) fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let menu = build_tray_menu(app)?;
    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("ClipForge")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open_quick" => show_quick_panel(app, "tray"),
            "preferences" => {
                if let Err(e) = crate::window::open_settings_window(app.clone()) {
                    log_to_file("warn", "tray", &format!("open settings failed: {}", e));
                }
            }
            "toggle_listen" => {
                let next_paused = !is_listen_paused();
                set_listen_paused(next_paused);
                log_to_file(
                    "info",
                    "clipboard-monitor",
                    if next_paused {
                        "listen paused (toggle from tray)"
                    } else {
                        "listen resumed (toggle from tray)"
                    },
                );
                if let Some(tray) = app.tray_by_id(TRAY_ID) {
                    match build_tray_menu(app) {
                        Ok(new_menu) => {
                            if let Err(e) = tray.set_menu(Some(new_menu)) {
                                log_to_file("warn", "tray", &format!("set_menu failed: {}", e));
                            }
                        }
                        Err(e) => {
                            log_to_file("warn", "tray", &format!("rebuild menu failed: {}", e))
                        }
                    }
                }
            }
            "quit" => {
                cleanup_agent_children();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_quick_panel(tray.app_handle(), "tray");
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }
    tray_builder.build(app)?;
    Ok(())
}
