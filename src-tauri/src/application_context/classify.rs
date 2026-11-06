//! 应用归类子模块：`classify_application` 与 bundle 标记清单。
//! 从 application_context.rs 拆出以满足单文件 ≤500 行门禁（codebase-modularity-refactor）；
//! 行为与拆出前完全一致：按 Bundle ID 与应用名的小写子串匹配。

/// 按 Bundle ID 和应用名归类，供 Agent 选择更准确的上下文解释器。
pub(crate) fn classify_application(bundle_id: &str, name: &str) -> &'static str {
    let bundle = bundle_id.to_lowercase();
    let app_name = name.to_lowercase();
    if is_browser_bundle(&bundle) {
        "browser"
    } else if bundle.contains("codex")
        || bundle.contains("openai")
        || app_name == "codex"
        || app_name.contains("chatgpt")
    {
        // 只标识当前助手应用，不读取 prompt、transcript、token 或内部 session 内容。
        "assistant"
    } else if is_editor_bundle(&bundle)
        || app_name.contains("visual studio code")
        || app_name.contains("vscodium")
        || app_name.contains("cursor")
        || app_name == "code"
    {
        "editor"
    } else if is_terminal_bundle(&bundle) || app_name.contains("terminal") {
        "terminal"
    } else if bundle == "com.apple.finder" || app_name == "finder" {
        "file-manager"
    } else {
        "generic"
    }
}

/// 浏览器类 bundle id 清单（大小写不敏感精确匹配）。
const BROWSER_BUNDLE_IDS: [&str; 12] = [
    "com.google.chrome",
    "com.google.chrome.canary",
    "com.google.chrome.beta",
    "com.google.chrome.dev",
    "com.microsoft.edgemac",
    "com.brave.browser",
    "com.vivaldi.vivaldi",
    "com.operasoftware.opera",
    "company.thebrowser.browser",
    "com.apple.safari",
    "org.mozilla.firefox",
    "com.kagi.kagimacos",
];

/// 编辑器类 bundle id 的识别标记（小写子串匹配）。
const EDITOR_BUNDLE_MARKS: [&str; 7] = [
    "vscode",
    "codium",
    "cursor",
    "todesktop",
    "code.oss",
    "jetbrains",
    "xcode",
];

/// 终端类 bundle id 的识别标记（小写子串匹配）。
const TERMINAL_BUNDLE_MARKS: [&str; 4] = ["terminal", "iterm", "warp", "wezterm"];

fn is_browser_bundle(bundle_id: &str) -> bool {
    BROWSER_BUNDLE_IDS
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(bundle_id))
}

fn is_editor_bundle(bundle: &str) -> bool {
    EDITOR_BUNDLE_MARKS.iter().any(|mark| bundle.contains(mark))
}

fn is_terminal_bundle(bundle: &str) -> bool {
    TERMINAL_BUNDLE_MARKS
        .iter()
        .any(|mark| bundle.contains(mark))
}
