//! 面板原生行为层（S2 债务切片）：NSPanel 淡出/浮窗显示、幻影 blur 自愈与粘贴前隐藏，
//! 自 lib.rs 平移。签名与日志逐字不变；lib.rs 只保留 quick_panel_level 等纯常量查询。

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use tauri::{Emitter, Manager};
#[cfg(target_os = "macos")]
use tauri_nspanel::ManagerExt;
use super::is_panel_pinned;
use crate::{frontmost_app_identity_including_self, log_to_file, now_millis};

#[cfg(target_os = "macos")]
pub(crate) fn hide_panel_before_paste<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if is_panel_pinned() {
        log_to_file(
            "info",
            "paste",
            "hide before paste skipped because panel is pinned",
        );
        return;
    }
    if let Ok(panel) = app.get_webview_panel("main") {
        log_to_file(
            "debug",
            "paste",
            &format!(
                "hide panel before paste: visibleBefore={}",
                panel.is_visible()
            ),
        );
        panel.resign_key_window();
        panel.hide();
        log_to_file(
            "debug",
            "paste",
            &format!(
                "hide panel before paste: visibleAfter={}",
                panel.is_visible()
            ),
        );
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        log_to_file(
            "debug",
            "paste",
            &format!(
                "hide window before paste fallback: visibleBefore={} focusedBefore={}",
                window.is_visible().unwrap_or(false),
                window.is_focused().unwrap_or(false)
            ),
        );
        let _ = window.hide();
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn hide_panel_before_paste<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if is_panel_pinned() {
        log_to_file(
            "info",
            "paste",
            "hide before paste skipped because panel is pinned",
        );
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        log_to_file(
            "debug",
            "paste",
            &format!(
                "hide window before paste: visibleBefore={} focusedBefore={}",
                window.is_visible().unwrap_or(false),
                window.is_focused().unwrap_or(false)
            ),
        );
        let _ = window.hide();
    }
}

/// 最近一次面板 show 的毫秒时间戳（UNIX epoch）：幻影 blur 自愈的时间窗判定基准。
/// 只在 macOS show_floating_window_by_label 成功路径写入；0 表示从未 show 或已重置。
#[cfg(target_os = "macos")]
static PANEL_LAST_SHOWN_MS: AtomicI64 = AtomicI64::new(0);

/// 最近一次幻影 blur 自愈（夺回 key）的毫秒时间戳：同一轮自愈引发的连环 blur
/// （resign_key 波纹会触发多次 focusChanged）只自愈一次，避免与后台 app 反复争抢。
#[cfg(target_os = "macos")]
static PANEL_LAST_RECLAIM_MS: AtomicI64 = AtomicI64::new(0);

/// 幻影 blur 判定：面板 show 后短时间内、且系统层无任何用户输入（键/鼠/滚轮）时发生的
/// 失焦，几乎都是后台 App 自激活（agent 终端、剪贴板管理器等周期性 activate 自己）抢走
/// key——面板对用户仍应可见可用，此时自动夺回 key 而不是淡出隐藏。用户真实操作
/// （点击面板外、Cmd-Tab、点其他窗口）会留下 CGEventSource 输入时间戳，照常隐藏。
/// 返回 Some(true)=判定为幻影 blur（可自愈）；Some(false)=用户输入触发的真 blur；None=无法判定（保守走隐藏）。
#[cfg(target_os = "macos")]
pub(crate) fn is_phantom_blur(now_ms: i64) -> Option<bool> {
    // core-graphics crate 未导出该 C 函数，按现有 AX extern 风格直接声明；
    // CoreGraphics 框架已被 AppKit 链接，无需额外链接参数。
    // eventType 传 -1（kCGAnyInputEventType）统计任意输入类型。
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: i32) -> f64;
    }
    // 0.35s 内有过物理输入即视为用户引发的失焦;show 后 3s 内的静默失焦按幻影处理。
    // 3s 依据实测:后台 app 自激活型幻影 blur 落在 show 后 0.57s-4s 区间,
    // 1.2s 太窄会漏掉;用户操作型失焦(点击/Cmd-Tab)都会在 0.35s 内留下输入事件,不会误判。
    const USER_INPUT_WINDOW_S: f64 = 0.35;
    const PHANTOM_WINDOW_MS: i64 = 3000;
    let since_input = unsafe {
        CGEventSourceSecondsSinceLastEventType(
            0, /* kCGEventSourceStateCombinedSessionState */
            -1,
        )
    };
    if !since_input.is_finite() {
        return None;
    }
    let shown = PANEL_LAST_SHOWN_MS.load(Ordering::Relaxed);
    let since_show_ms = if shown > 0 { now_ms - shown } else { i64::MAX };
    Some(since_show_ms <= PHANTOM_WINDOW_MS && since_input >= USER_INPUT_WINDOW_S)
}

/// 幻影 blur 自愈:后台 app 无用户输入抢走 key 时,夺回 key 让面板继续可用。
/// 必须走完整 show 抢占(而非裸 make_key_window):递增代际号取消在途淡出、
/// 复位 alpha=1——否则面板夺回 key 后仍会继续淡没(用户看到「失焦后面板透明消失」)。
/// 去重:RECLAIM 后 800ms 内的连环 blur 直接忽略(resign 波纹会触发多次 focusChanged)。
#[cfg(target_os = "macos")]
pub(crate) fn reclaim_panel_key_after_phantom_blur<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    _window: &tauri::Window<R>,
    now_ms: i64,
) -> bool {
    let last_reclaim = PANEL_LAST_RECLAIM_MS.load(Ordering::Relaxed);
    if last_reclaim > 0 && now_ms - last_reclaim < 800 {
        return false;
    }
    let Some(webview) = app.get_webview_window("main") else {
        return false;
    };
    PANEL_LAST_RECLAIM_MS.store(now_ms, Ordering::Relaxed);
    // 完整抢占:代际号+1 使在途淡出的收尾弃权,alpha 复位 1,order_front + make_key。
    show_floating_window_by_label(app, "main", &webview);
    // 同步通知前端把本次 blur 当宽限事件忽略:前端 blur→60ms→hide 链路会在 60ms 后
    // 发起一次真淡出,把刚夺回的面板又藏掉(夺回先行到达,前端收到 focus-guard 后
    // 再收到 blur 时处于宽限窗内,直接 return)。
    let _ = app.emit("clipforge://panel-focus-guard", now_ms);
    log_to_file(
        "info",
        "panel-focus",
        "phantom blur reclaim: background app stole key without user input, re-keyed panel via show preemption",
    );
    true
}

/// 焦点诊断快照:失焦瞬间的 keyWindow 归属与前台 app 身份,一次性拼成短串。
/// 仅诊断路径调用,不参与业务逻辑;拿不到主线程/panel 时逐项降级为占位符。
#[cfg(target_os = "macos")]
pub(crate) fn focus_context_snapshot<R: tauri::Runtime>(window: &tauri::Window<R>) -> String {
    use tauri_nspanel::objc2::msg_send;
    use tauri_nspanel::objc2_app_kit::{NSApplication, NSWindow};
    use tauri_nspanel::objc2_foundation::MainThreadMarker;

    let key_desc = if MainThreadMarker::new().is_some() {
        let app = NSApplication::sharedApplication(MainThreadMarker::new().unwrap());
        let key: Option<tauri_nspanel::objc2::rc::Retained<NSWindow>> =
            unsafe { msg_send![&*app, keyWindow] };
        match key {
            Some(key_window) => format!("keyWindow=ptr:{:?}", &*key_window as *const NSWindow),
            None => "keyWindow=nil".to_string(),
        }
    } else {
        "keyWindow=nonmain".to_string()
    };
    let front = frontmost_app_identity_including_self()
        .map(|(name, bundle)| format!("front={name}|{bundle}"))
        .unwrap_or_else(|| "front=nil".to_string());
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    format!("{key_desc} {front} winVisible={visible} winFocused={focused}")
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn focus_context_snapshot<R: tauri::Runtime>(_window: &tauri::Window<R>) -> String {
    String::new()
}

#[cfg(target_os = "macos")]
pub(super) fn show_panel_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) {
    show_floating_window_by_label(app, "main", window);
}

/// 通用浮窗显示：把指定 label 的窗口设为 NSPanel status-level 浮动面板并置于最前。
/// 剪贴板主面板等浮窗共用同一「悬浮于其他应用之上」能力，按 label 泛化。
/// 失焦/切换收起的原生淡出：走 NSWindow animator 的 alphaValue 代理动画,
/// 插值由 WindowServer 合成路径执行,不触发 WKWebView 重绘(backdrop-filter 的
/// material 层在 CSS opacity 动画下每帧强制重新栅格化,是自动收起卡顿的根源)。
/// 动画结束后 resign_key + hide,并把 alpha 复位为 1(下次唤起天然满透明度)。
/// 边界:主线程标记拿不到时退回瞬切,功能不回退;动画途中面板被再次唤起时,
/// show 路径会先 set_alpha_value(1.0) 抹掉中间态,不会停在半透明。

/// 面板原生淡出在途标志:hide 发起淡出时置位,show 抢占或收尾完成时复位。
/// toggle/失焦链据此判定「用户感知可见性」:淡出中的面板对用户等同不可见,
/// 此时再按快捷键必须走 show(取消淡出),否则误判成 hide 会把面板藏没。
static PANEL_FADE_ACTIVE: AtomicBool = AtomicBool::new(false);

/// 面板淡出代际号:每次发起新淡出或 show 抢占时递增;
/// 迟到的轮询/收尾闭包校验代际号不匹配即弃权,防止旧 hide 链干扰新状态。
static PANEL_FADE_GENERATION: AtomicI64 = AtomicI64::new(0);

fn next_fade_generation() -> i64 {
    PANEL_FADE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1
}

fn is_panel_fading() -> bool {
    PANEL_FADE_ACTIVE.load(Ordering::SeqCst)
}

/// 面板「用户感知可见」的唯一口径：窗口可见，且没有原生淡出在途。
/// 淡出（约 160ms）在途的窗口 is_visible 仍为 true，但对用户已等同隐藏，
/// 此时 toggle 意图是「唤起」（show 分支会取消淡出）；若误判成 hide，
/// 面板会被彻底藏没（隐形面板 bug）。全局快捷键 toggle_quick_panel 与
/// 前端/托盘显式 toggle（toggle_quick_panel_command）必须共用本判定，避免两套口径。
pub(super) fn panel_visible_to_user<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> bool {
    window.is_visible().unwrap_or(false) && !is_panel_fading()
}

#[cfg(target_os = "macos")]
pub(super) fn hide_panel_with_native_fade<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    panel: &std::sync::Arc<dyn tauri_nspanel::Panel<R>>,
) {
    use tauri_nspanel::objc2::runtime::AnyObject;
    use tauri_nspanel::objc2_app_kit::NSAnimationContext;
    use tauri_nspanel::objc2_foundation::MainThreadMarker;

    // AppKit 未在主线程的极端场景退回瞬切,保证隐藏语义不变。
    if MainThreadMarker::new().is_none() {
        panel.resign_key_window();
        panel.hide();
        return;
    }
    // 幂等守卫:淡出已在途时再次进入(快捷键 hide 后前端 blur 路径 60ms 的迟到重入、
    // resign_key 引发的连环 blur 重试)直接弃权,不重启动画。旧行为:每次重入都
    // animator setAlphaValue 重启 160ms 淡出 + resign_key 又触发一次 blur → 前端
    // 60ms 后再次 invoke → 单次隐藏被拖成 6 段 ~62ms 的锯齿渐隐(用户感知「不丝滑」)。
    // 边界:show 抢占路径已把 PANEL_FADE_ACTIVE 复位为 false,之后的 hide 会正常发起新淡出。
    if PANEL_FADE_ACTIVE.load(Ordering::SeqCst) {
        return;
    }
    if !panel.is_visible() {
        panel.set_alpha_value(1.0);
        return;
    }
    // 抢占语义:置位「淡出在途」并递增代际号,旧淡出的轮询/收尾闭包校验失败自动弃权。
    PANEL_FADE_ACTIVE.store(true, Ordering::SeqCst);
    let generation = next_fade_generation();
    panel.resign_key_window();
    let app = app.clone();
    let panel_for_cb = panel.clone();
    // 动画时长 110ms：工具类软件隐藏端到端必须 ≤180ms。旧实现 160ms 动画 +
    // 后台线程 1ms 轮询 alphaValue 检测完成，实测检测不稳定多次落入 400ms
    // 兜底超时（端到端 440ms+，用户实测「隐藏很慢」）。
    const FADE_MS: u64 = 110;
    // 收尾延时 = 动画时长 + 25ms 余量（animator 提交到 WindowServer 合成有间隔）。
    // 用确定性定时替代轮询：定时线程只 sleep 后回主线程，不碰 AppKit 属性，
    // 也不受主线程繁忙影响；代际号校验保证 show 抢占时安全弃权。
    // 收尾延迟:alpha 动画 110ms + 8ms 合成器提交余量。animationBehavior=none 后
    // orderOut 是同步 unmap,无系统淡出可撞车;25ms 旧余量纯增加列表滞留时间。
    const FINISH_DELAY_MS: u64 = FADE_MS + 8;
    let app_for_dispatch = app.clone();
    let _ = app_for_dispatch.run_on_main_thread(move || {
        let fade_started = std::time::Instant::now();
        unsafe {
            let raw_panel = panel_for_cb.as_panel();
            // animator 代理:返回 NSWindow 的 animator 对象(NSAnimatablePropertyContainer),
            // 对其 setAlphaValue 即生成原生隐式动画;时长由外层 NSAnimationContext.duration 控制。
            let animator: *mut AnyObject = tauri_nspanel::objc2::msg_send![raw_panel, animator];
            if animator.is_null() {
                // 极端场景 animator 不可用:瞬切收尾,并解除在途标志(否则后续 hide 全被守卫挡住)。
                panel_for_cb.hide();
                panel_for_cb.set_alpha_value(1.0);
                PANEL_FADE_ACTIVE.store(false, Ordering::SeqCst);
                return;
            }
            let ctx = NSAnimationContext::currentContext();
            ctx.setDuration(FADE_MS as f64 / 1000.0);
            let _: () = tauri_nspanel::objc2::msg_send![animator, setAlphaValue: 0.0f64];
        }
        // 收尾:定时线程睡满 FINISH_DELAY_MS 后回主线程 hide。
        // 注意:NSWindow.orderOut/hide 属于主线程 AppKit 调用,禁止在定时线程直呼。
        let app_for_schedule = app.clone();
        let panel_for_finish = panel_for_cb.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(FINISH_DELAY_MS));
            let app_for_closure = app_for_schedule.clone();
            let _ = app_for_schedule.run_on_main_thread(move || {
                // 主线程串行点上再校验一次:排队期间可能已被 show 抢占(代际号变化)或面板已隐藏。
                if PANEL_FADE_GENERATION.load(Ordering::SeqCst) != generation
                    || !panel_for_finish.is_visible()
                {
                    return; // 已被 show/新淡出接管
                }
                panel_for_finish.hide();
                // alpha 复位推迟到下个 runloop tick:orderOut 同一 runloop tick 内
                // setAlphaValue(1.0) 会让带动画行为的窗口以 alpha=1 复活回闪
                // (Kimi 评审指出的机制);behavior=none 后保险仍保留。
                let panel_for_alpha = panel_for_finish.clone();
                let _ = app_for_closure.run_on_main_thread(move || {
                    panel_for_alpha.set_alpha_value(1.0);
                });
                PANEL_FADE_ACTIVE.store(false, Ordering::SeqCst);
                let _ = app_for_closure.emit("clipforge://panel-fade-finished", "hide");
                log_to_file(
                    "debug",
                    "panel-fade",
                    &format!(
                        "fade hidden +{}ms (fade={}ms)",
                        fade_started.elapsed().as_millis(),
                        FADE_MS
                    ),
                );
            });
        });
    });
}

#[cfg(target_os = "macos")]
fn show_floating_window_by_label<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
    window: &tauri::WebviewWindow<R>,
) {
    if let Ok(panel) = app.get_webview_panel(label) {
        // show 即抢占:递增淡出代际号使在途淡出全部失效,并清掉在途标志,
        // 防止旧 hide 链在唤起后把面板藏掉或把 alpha 拉回 0(隐形面板 bug)。
        next_fade_generation();
        PANEL_FADE_ACTIVE.store(false, Ordering::SeqCst);
        // 幻影 blur 自愈基准:记录本次 show 时刻,1.2s 内的静默失焦才走自愈判定。
        if let Ok(now) = now_millis() {
            PANEL_LAST_SHOWN_MS.store(now, Ordering::Relaxed);
        }
        // 原生淡出可能在中途被唤起打断:以 0 时长 animator 复位满透明度。
        // 必须走 animator 而非裸 set_alpha_value:在途的 110ms alpha 动画不会因模型值
        // 改变而停止(CA 动画按自身时间线跑完),裸赋值会让面板先淡没再瞬现(闪烁);
        // 0 时长 animator 赋值替换同 key 的在途动画,presentation 立即回到 1——
        // 这就是「动画随时可被硬需求打断」在 AppKit 侧的落点。
        unsafe {
            use tauri_nspanel::objc2::runtime::AnyObject;
            use tauri_nspanel::objc2_app_kit::NSAnimationContext;
            let raw_panel = panel.as_panel();
            let animator: *mut AnyObject = tauri_nspanel::objc2::msg_send![raw_panel, animator];
            if !animator.is_null() {
                NSAnimationContext::beginGrouping();
                let ctx = NSAnimationContext::currentContext();
                ctx.setDuration(0.0);
                let _: () = tauri_nspanel::objc2::msg_send![animator, setAlphaValue: 1.0f64];
                NSAnimationContext::endGrouping();
            } else {
                panel.set_alpha_value(1.0);
            }
        }
        panel.set_level(crate::quick_panel_level());
        panel.order_front_regardless();
        panel.show_and_make_key();
        // 二次唤起时 NSPanel 已 resign_key，show_and_make_key 后再补一次 webview 级
        // set_focus，确保键盘事件能进面板（修复「第二次触发不聚焦、快捷键不生效」）。
        let _ = window.set_focus();
        focus_webview_for_input(window);
        log_to_file(
            "info",
            "panel-focus",
            &format!(
                "show floating window {}: panelVisible={} windowVisible={} focused={} canBecomeKey={} hidesOnDeactivate={}",
                label,
                panel.is_visible(),
                window.is_visible().unwrap_or(false),
                window.is_focused().unwrap_or(false),
                panel.can_become_key_window(),
                panel.hides_on_deactivate()
            ),
        );
    } else {
        let _ = window.show();
        let _ = window.set_focus();
        log_to_file(
            "warn",
            "panel-focus",
            &format!(
                "show floating window {} fallback window path: visible={} focused={}",
                label,
                window.is_visible().unwrap_or(false),
                window.is_focused().unwrap_or(false)
            ),
        );
    }
}

#[cfg(target_os = "macos")]
fn focus_webview_for_input<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use tauri_nspanel::objc2_app_kit::{NSResponder, NSWindow as AppKitNSWindow};
    if let Err(error) = window.with_webview(|webview| unsafe {
        let ns_window: &AppKitNSWindow = &*webview.ns_window().cast::<AppKitNSWindow>();
        let webview_responder: &NSResponder = &*webview.inner().cast::<NSResponder>();
        let accepted = ns_window.makeFirstResponder(Some(webview_responder));
        log_to_file(
            "debug",
            "panel-focus",
            &format!("makeFirstResponder(WKWebView) accepted={}", accepted),
        );
    }) {
        log_to_file(
            "warn",
            "panel-focus",
            &format!("focus WKWebView failed: {}", error),
        );
    }
}

#[cfg(not(target_os = "macos"))]
pub(super) fn show_panel_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) {
    show_floating_window_by_label(app, "main", window);
}

#[cfg(not(target_os = "macos"))]
fn show_floating_window_by_label<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    _label: &str,
    window: &tauri::WebviewWindow<R>,
) {
    let _ = window.show();
    let _ = window.set_focus();
}
