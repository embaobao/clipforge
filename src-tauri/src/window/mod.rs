//! 窗口/面板域（S2 债务切片）：快速面板的命令壳与显隐核心，自 lib.rs 平移。
//! 平移纪律：函数签名、命令名、字符串与日志文本逐字不变；lib.rs 只保留
//! `mod window` 声明与 `generate_handler!` 注册，行为零变化。
//! 原生淡出/浮窗/幻影 blur 等窗口层机制在 `position.rs`（面板行为与定位执行）。

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Instant;
use tauri::{Emitter, LogicalSize, Manager};
#[cfg(target_os = "macos")]
use tauri_nspanel::ManagerExt;

mod position;

// position 层为模块私有；以下 re-export 供 lib.rs 的粘贴/事件链路直接调用，
// 平移后调用点（paste 路径、on_window_event 失焦自愈）无需改名。
pub(crate) use position::{
    focus_context_snapshot, hide_panel_before_paste, is_phantom_blur,
    reclaim_panel_key_after_phantom_blur,
};
use position::{hide_panel_with_native_fade, panel_visible_to_user, show_panel_window};
use crate::{
    apply_capture_settings, apply_position_strategy, capture_clip_payload_with_options,
    check_accessibility_permission_platform, clipboard, configure_panel_window, cursor_logical_point,
    focused_input_bounds_platform, get_monitor_id, is_listen_paused, log_panel_open_step,
    log_to_file, maybe_prompt_accessibility_on_first_panel, monitor_for_logical_point, now_millis,
    open_onboarding_window_internal, open_settings_window_internal, panel_position,
    resolve_panel_dims, save_panel_position, set_panel_position, should_skip_writeback,
    snapshot_paste_target_bounds, AccessibilityPermissionPayload, FocusedInputBoundsPayload,
    MANAGEMENT_PANEL_WIDTH, PanelPositionStrategy, PanelTriggerPayload, QUICK_PANEL_WIDTH,
};

#[tauri::command]
pub(crate) fn set_panel_mode<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    mode: String,
) -> Result<(), String> {
    let width = if mode == "management" {
        MANAGEMENT_PANEL_WIDTH
    } else {
        QUICK_PANEL_WIDTH
    };
    configure_panel_window(&window, width);
    Ok(())
}

/// 打开设置窗口的普通入口：保持进入 `settings.html`，不携带初始分类参数。
#[tauri::command]
pub(crate) fn open_settings_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    open_settings_window_internal(app, None)
}

/// 打开设置窗口并进入指定分类；分类使用白名单，避免前端传入任意 URL。
#[tauri::command]
pub(crate) fn open_settings_window_with_section<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    section: String,
) -> Result<(), String> {
    open_settings_window_internal(app, Some(section.as_str()))
}

#[tauri::command]
pub(crate) fn open_onboarding_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    open_onboarding_window_internal(app, "manual")
}

/// 焦点输入框位置命令（兼容面，仓库内无调用方）。
/// 做什么：按需返回当前系统焦点输入框坐标，读不到时退化为全 0 的 fallback。
/// 边界：后台周期性预热已移除（见 focus-prefetch-idle-removal 提案）；本命令自身
/// 仍保留 600ms 短缓存，未命中时现场调原生 AX 查询。保留注册仅为仓库外调用方与回滚契约，
/// 面板定位与粘贴目标快照均不依赖本命令。
#[tauri::command]
pub(crate) fn focused_input_bounds() -> Result<FocusedInputBoundsPayload, String> {
    focused_input_bounds_platform().or_else(|_| {
        Ok(FocusedInputBoundsPayload {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
            source: "fallback".to_string(),
        })
    })
}

#[tauri::command]
pub(crate) fn show_quick_panel_command<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    source: Option<String>,
) -> Result<PanelTriggerPayload, String> {
    open_panel(&app, source.as_deref().unwrap_or("command"))
}

#[tauri::command]
pub(crate) fn hide_quick_panel_command<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<PanelTriggerPayload, String> {
    hide_panel(&app, "command")
}

#[tauri::command]
pub(crate) fn toggle_quick_panel_command<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    source: Option<String>,
) -> Result<PanelTriggerPayload, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    // 可见性口径与全局快捷键 toggle_quick_panel 一致（panel_visible_to_user）：
    // 淡出在途按「已隐藏」处理走 show，取消淡出而非二次 hide。
    if panel_visible_to_user(&window) {
        hide_panel(&app, source.as_deref().unwrap_or("toggle"))
    } else {
        open_panel(&app, source.as_deref().unwrap_or("toggle"))
    }
}

#[tauri::command]
pub(crate) fn focus_quick_panel_command<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<PanelTriggerPayload, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    show_panel_window(&app, &window);
    Ok(panel_trigger_payload(&window, "focus", "manual-focus", ""))
}

#[tauri::command]
pub(crate) fn release_focus_command<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<PanelTriggerPayload, String> {
    hide_panel_before_paste(&app);
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    Ok(panel_trigger_payload(
        &window,
        "release-focus",
        "hidden",
        "",
    ))
}

#[tauri::command]
pub(crate) fn get_panel_trigger_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<PanelTriggerPayload, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    Ok(panel_trigger_payload(&window, "status", "current", ""))
}

pub(crate) fn open_panel<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    reason: &str,
) -> Result<PanelTriggerPayload, String> {
    let panel_started = Instant::now();
    let mut panel_last_step = panel_started;
    // 唤起前同步补采一次剪贴板：快速复制后立刻唤起时，100ms 轮询尚未采到新条目，
    // 面板首帧先显示旧列表，300ms 后前端 manual 补采才把新条目顶到首行——列表在
    // 手指落下后才跳动（用户反馈「每次唤起后界面刷新、第一条改变」）。提前到显示前
    // 采集，首帧即最终态。capture_clip_payload 按 content_hash 幂等（重复调用仅
    // promote 同一行），轮询线程稍后重采不会产生重复条目。文本读板 ~1ms、图片数十 ms，
    // 在唤起热路径可接受。
    if !is_listen_paused() && !should_skip_writeback() {
        if let Ok(Some(raw_payload)) = clipboard::read_clipboard_payload() {
            if let Ok(Some(payload)) = apply_capture_settings(raw_payload) {
                let now = now_millis().unwrap_or(0);
                if let Err(error) = capture_clip_payload_with_options(
                    payload,
                    Some("Clipboard".to_string()),
                    now,
                    false,
                ) {
                    log_to_file(
                        "debug",
                        "panel-open-perf",
                        &format!("open_panel: pre-show capture skipped: {}", error),
                    );
                }
            }
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        maybe_prompt_accessibility_on_first_panel(app, reason);
        log_panel_open_step(
            reason,
            "first-permission-dispatch",
            panel_started,
            &mut panel_last_step,
        );
        let strategy = get_strategy_for_source(reason);
        let strategy_clone = strategy.clone();
        log_panel_open_step(
            reason,
            "resolve-strategy",
            panel_started,
            &mut panel_last_step,
        );

        // 入口诊断：来源 -> 策略，以及【逻辑点】光标与其所在屏。配合下游各 position_* 的结果日志，
        // 可完整复现一次唤起的定位决策链（用于排查「出现在错误的屏/位置」）。
        let (cx, cy) = cursor_logical_point(&window).unwrap_or((-1.0, -1.0));
        let cursor_monitor = monitor_for_logical_point(&window, cx, cy)
            .map(|m| get_monitor_id(&m))
            .unwrap_or_default();
        log_panel_open_step(
            reason,
            "cursor-monitor",
            panel_started,
            &mut panel_last_step,
        );
        let acc = check_accessibility_permission_platform()
            .map(|a| a.status)
            .unwrap_or_default();
        log_panel_open_step(
            reason,
            "accessibility-status",
            panel_started,
            &mut panel_last_step,
        );
        log_to_file(
            "debug",
            "panel-position",
            &format!(
            "open_panel: source={} strategy={:?} cursor=({},{}) cursor_monitor={} accessibility={}",
                reason, strategy, cx, cy, cursor_monitor, acc
            ),
        );
        // 粘贴目标快照只用于「粘贴时 activate 目标 App」所需的 bundle id 与焦点框位置，
        // 实现走 NSWorkspace.frontmostApplication + 原生 AX 直查（不 fork osascript）。放到
        // 后台线程执行，避免在唤起热路径上阻塞——用户从面板出现到选中条目通常 >100ms，足够缓存就绪。
        {
            let reason_owned = reason.to_string();
            let fallback = if cx >= 0.0 && cy >= 0.0 {
                Some((cx, cy))
            } else {
                None
            };
            thread::spawn(move || {
                snapshot_paste_target_bounds(&reason_owned, fallback);
            });
        }

        // 宽高可由用户设置覆盖（默认 420×488）。
        let (panel_width, panel_h) = resolve_panel_dims();
        // 1. 计算面板高度（基于当前显示器工作区）
        let panel_height = panel_position(&window, panel_width, panel_h)
            .map(|(_, _, h)| h)
            .unwrap_or(panel_h);
        let _ = window.set_size(LogicalSize::new(panel_width, panel_height));
        log_panel_open_step(
            reason,
            "size-and-height",
            panel_started,
            &mut panel_last_step,
        );

        // 2. 同步应用定位策略（单次定位，不重复）
        let position_source: String =
            match apply_position_strategy(&window, strategy, panel_width, panel_height) {
                Some((x, y)) => {
                    set_panel_position(&window, x, y);
                    format!("sync-{:?}", strategy_clone)
                }
                None => {
                    // 策略失败时用 fallback 居中
                    if let Some((fx, fy, _)) = panel_position(&window, panel_width, panel_height) {
                        set_panel_position(&window, fx, fy);
                    }
                    format!("fallback-{:?}", strategy_clone)
                }
            };
        log_panel_open_step(reason, "position", panel_started, &mut panel_last_step);

        // 3. 显示窗口
        show_panel_window(app, &window);
        log_panel_open_step(reason, "show-window", panel_started, &mut panel_last_step);
        let _ = window.emit("clipforge://show-quick-panel", reason);
        log_panel_open_step(reason, "emit-show", panel_started, &mut panel_last_step);

        // 不再在显示后用焦点输入框位置【覆盖】定位：那条 osascript 异步路径会在面板已可见时
        // 再次 set_panel_position，造成「先出现在光标处、再跳到输入框处」的可见跳动（用户反映像
        // bug 一样闪烁）。按需求：触发那一刻位置确定即可（上面的同步 apply_position_strategy），
        // 显示之后不再移动面板，消除闪烁。

        let payload = panel_trigger_payload(
            &window,
            reason,
            &position_source,
            &format!("{:?}", strategy_clone),
        );
        log_panel_open_step(reason, "payload", panel_started, &mut panel_last_step);
        Ok(payload)
    } else {
        Err("main window is not available".to_string())
    }
}

pub(crate) fn hide_panel<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    reason: &str,
) -> Result<PanelTriggerPayload, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;

    // 固定(pin)语义只拦「自动隐藏」：失焦隐藏(前端 is_panel_pinned_command 门控)与
    // 粘贴前隐藏(hide_panel_before_paste 自查)各自已按 pin 放行;此处若一刀切拦截,
    // 全局快捷键 toggle / Esc / 显式 hide 命令在 pin 态下全部失效,面板将无法收起。
    save_panel_position(&window);

    #[cfg(target_os = "macos")]
    {
        if let Ok(panel) = app.get_webview_panel("main") {
            hide_panel_with_native_fade(&app, &panel);
        } else {
            let _ = window.hide();
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.hide();
    }
    let _ = window.emit("clipforge://hide-quick-panel", reason);
    Ok(panel_trigger_payload(&window, reason, "hidden", ""))
}

pub(crate) fn show_quick_panel<R: tauri::Runtime>(app: &tauri::AppHandle<R>, reason: &str) {
    if let Err(error) = open_panel(app, reason) {
        let _ = crate::append_app_log_impl(
            "warn".to_string(),
            "Open quick panel failed".to_string(),
            Some(error),
        );
    }
}

/// 切换面板可见性。快捷键用这个而非 show_quick_panel：
/// 面板已可见时再按快捷键应当【隐藏】（toggle），否则面板常驻可见、再按 show 是 no-op，
/// 主观上表现为「快捷键只生效一次」。
pub(crate) fn toggle_quick_panel<R: tauri::Runtime>(app: &tauri::AppHandle<R>, reason: &str) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // 「可见」必须是用户感知可见:原生淡出在途(160ms 窗口期)的窗口 is_visible 仍为 true,
    // 但对用户已等同隐藏;此时按快捷键意图是「唤起」,必须走 show 分支取消淡出,
    // 否则误判成第二次 hide,面板被彻底藏没(隐形面板 bug 根因)。
    // 口径与 toggle_quick_panel_command 共用 panel_visible_to_user，不再各写各的。
    let visible = panel_visible_to_user(&window);
    let focused = window.is_focused().unwrap_or(false);
    let panel_visible = app
        .get_webview_panel("main")
        .ok()
        .map(|panel| panel.is_visible())
        .unwrap_or(false);
    // 诊断「需要按两下才触发」：记录每次 toggle 的决策依据（show/hide）与当时的可见/聚焦状态。
    // 若用户反映第一次按下没反应，看这条日志即可判断是走了 hide 分支（可见性误判）还是
    // show 分支后焦点没进来（非激活 NSPanel 的 key-window 问题）。
    log_to_file(
        "info",
        "panel-toggle",
        &format!(
            "toggle reason={} decision={} windowVisible={} windowFocused={} panelVisible={}",
            reason,
            if visible { "hide" } else { "show" },
            visible,
            focused,
            panel_visible
        ),
    );
    if visible {
        let _ = hide_panel(app, reason);
    } else {
        show_quick_panel(app, reason);
    }
}

/// 面板「固定」状态：true 时失焦/外部点击不自动隐藏（参考 EcoPaste CLIPBOARD_WINDOW_PINNED）。
pub(crate) static PANEL_PINNED: AtomicBool = AtomicBool::new(false);

pub(crate) fn is_panel_pinned() -> bool {
    PANEL_PINNED.load(Ordering::Relaxed)
}

#[tauri::command]
pub(crate) fn set_panel_pinned_command(pinned: bool) -> Result<bool, String> {
    PANEL_PINNED.store(pinned, Ordering::Relaxed);
    log_to_file(
        "info",
        "panel-pin",
        &format!("set pinned = {} (stay-in-place)", pinned),
    );
    Ok(pinned)
}

/// 权威查询固定状态（对齐 EcoPaste should_auto_hide：隐藏决策统一以 Rust 标志为准，
/// 避免前端 settingsRef 与 Rust PANEL_PINNED 不同步导致固定后仍被前端 appWindow.hide() 误关）。
#[tauri::command]
pub(crate) fn is_panel_pinned_command() -> bool {
    is_panel_pinned()
}

pub(crate) fn panel_trigger_payload<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    source: &str,
    position_source: &str,
    focused_input_source: &str,
) -> PanelTriggerPayload {
    let position = window.outer_position().ok();
    let size = window.outer_size().ok();
    let accessibility =
        check_accessibility_permission_platform().unwrap_or(AccessibilityPermissionPayload {
            status: "unsupported".to_string(),
            can_read_focused_input: false,
            message: "accessibility status unavailable".to_string(),
        });
    PanelTriggerPayload {
        visible: window.is_visible().unwrap_or(false),
        focused: window.is_focused().unwrap_or(false),
        x: position.as_ref().map(|value| value.x as f64).unwrap_or(0.0),
        y: position.as_ref().map(|value| value.y as f64).unwrap_or(0.0),
        width: size.as_ref().map(|value| value.width as f64).unwrap_or(0.0),
        height: size
            .as_ref()
            .map(|value| value.height as f64)
            .unwrap_or(0.0),
        source: source.to_string(),
        position_source: position_source.to_string(),
        focused_input_source: focused_input_source.to_string(),
        used_focused_input: position_source.starts_with("focused-input"),
        accessibility_status: accessibility.status,
        message: accessibility.message,
    }
}

fn get_strategy_for_source(source: &str) -> PanelPositionStrategy {
    match source {
        "tray" => PanelPositionStrategy::TrayCenter,
        "shortcut" => PanelPositionStrategy::FollowCursor,
        "command" => PanelPositionStrategy::Center,
        _ => PanelPositionStrategy::FollowCursor,
    }
}

/// 面板定位来源 -> 策略的纯映射与固定标志默认值：迁移时先固化行为，防回归。
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panel_strategy_matches_trigger_source() {
        assert!(matches!(
            get_strategy_for_source("tray"),
            PanelPositionStrategy::TrayCenter
        ));
        assert!(matches!(
            get_strategy_for_source("shortcut"),
            PanelPositionStrategy::FollowCursor
        ));
        assert!(matches!(
            get_strategy_for_source("command"),
            PanelPositionStrategy::Center
        ));
        // 未知来源退回光标跟随（旧行为），不能因迁移变成 Center。
        assert!(matches!(
            get_strategy_for_source("dev-open"),
            PanelPositionStrategy::FollowCursor
        ));
    }

    #[test]
    fn panel_pin_defaults_to_false() {
        // 进程内标志默认未固定；不写日志路径（log_to_file 会落正式日志）。
        assert!(!is_panel_pinned());
    }
}
