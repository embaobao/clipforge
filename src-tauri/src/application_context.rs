use serde_json::{json, Value};
use std::process::Command;

/// 前台应用的稳定身份信息，供剪贴板来源和应用上下文共同使用。
#[derive(Clone, Debug)]
pub(crate) struct SourceAppInfo {
    pub(crate) name: String,
    pub(crate) bundle_id: String,
    pub(crate) executable_path: String,
    pub(crate) icon_base64: Option<String>,
}

/// 一次采集得到的应用来源与扩展上下文。
#[derive(Clone, Debug)]
pub(crate) struct CapturedApplicationContext {
    pub(crate) source_app: SourceAppInfo,
    pub(crate) application_context: Value,
}

/// 读取一次前台应用快照；扩展上下文失败时仍保留基础应用信息。
pub(crate) fn capture(include_application_context: bool) -> Option<CapturedApplicationContext> {
    #[cfg(target_os = "macos")]
    {
        return capture_macos(include_application_context);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = include_application_context;
        None
    }
}

/// 按 Bundle ID 和应用名归类，供 Agent 选择更准确的上下文解释器。
pub(crate) fn classify_application(bundle_id: &str, name: &str) -> &'static str {
    let bundle = bundle_id.to_lowercase();
    let app_name = name.to_lowercase();
    if is_browser_bundle(&bundle) {
        "browser"
    } else if bundle.contains("vscode")
        || bundle.contains("codium")
        || bundle.contains("cursor")
        || bundle.contains("todesktop")
        || bundle.contains("code.oss")
        || bundle.contains("jetbrains")
        || bundle.contains("xcode")
        || app_name.contains("visual studio code")
        || app_name.contains("vscodium")
        || app_name.contains("cursor")
        || app_name == "code"
    {
        "editor"
    } else if bundle.contains("terminal")
        || bundle.contains("iterm")
        || bundle.contains("warp")
        || bundle.contains("wezterm")
        || app_name.contains("terminal")
    {
        "terminal"
    } else if bundle == "com.apple.finder" || app_name == "finder" {
        "file-manager"
    } else {
        "generic"
    }
}

/// 从编辑器窗口标题和进程参数提取可用的文档、工作区线索。
pub(crate) fn parse_editor_context(window_title: &str, command_line: Option<&str>) -> Value {
    let cleaned_title = window_title
        .trim()
        .trim_end_matches(" - Visual Studio Code")
        .trim_end_matches(" - Code")
        .trim_end_matches(" - Cursor")
        .trim();

    let (document_name, workspace_name) =
        if let Some((document, workspace)) = cleaned_title.split_once(" \u{2014} ") {
            (non_empty(document), non_empty(workspace))
        } else if let Some((document, workspace)) = cleaned_title.rsplit_once(" - ") {
            (non_empty(document), non_empty(workspace))
        } else {
            (non_empty(cleaned_title), None)
        };

    let command_line = command_line.unwrap_or("");
    let document_path = extract_uri_or_path(command_line, &["--file-uri", "--goto"]);
    let workspace_path = extract_uri_or_path(command_line, &["--folder-uri", "--workspace-uri"]);

    json!({
        "document": {
            "name": document_name,
            "path": document_path,
            "source": if document_path.is_some() { "process-args" } else { "window-title" },
        },
        "workspace": {
            "name": workspace_name,
            "path": workspace_path,
            "source": if workspace_path.is_some() { "process-args" } else { "window-title" },
        }
    })
}

/// 解析浏览器 AppleScript 返回的 URL 和标题，格式错误时安全降级。
pub(crate) fn parse_browser_payload(raw: &str) -> Option<(String, String)> {
    let mut parts = raw.trim().split('\u{1f}');
    let url = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let title = parts.next().map(str::trim).unwrap_or("");
    Some((url.to_string(), title.to_string()))
}

/// 解析 Finder 返回的选中路径列表，保留顺序并去除空值。
pub(crate) fn parse_selection_paths(raw: &str) -> Vec<String> {
    raw.trim()
        .split('\u{1f}')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn non_empty(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn is_browser_bundle(bundle_id: &str) -> bool {
    [
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
        "com.kagi.kagimacOS",
    ]
    .iter()
    .any(|candidate| candidate.eq_ignore_ascii_case(bundle_id))
}

fn extract_uri_or_path(command_line: &str, flags: &[&str]) -> Option<String> {
    let tokens = command_line.split_whitespace().collect::<Vec<_>>();
    for flag in flags {
        let Some(index) = tokens.iter().position(|token| token == flag) else {
            continue;
        };
        let value = tokens.get(index + 1).copied().unwrap_or("");
        if let Some(value) = non_empty(value) {
            return Some(value);
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn capture_macos(include_application_context: bool) -> Option<CapturedApplicationContext> {
    let raw = run_osascript(
        r#"
tell application "System Events"
    set separator to ASCII character 31
    set frontApp to first application process whose frontmost is true
    set appName to name of frontApp
    set bundleId to bundle identifier of frontApp
    set execPath to POSIX path of (application file of frontApp as alias)
    set processId to ""
    try
        set processId to unix id of frontApp as text
    end try
    set windowTitle to ""
    try
        set windowTitle to name of front window of frontApp
    end try
    return appName & separator & bundleId & separator & execPath & separator & processId & separator & windowTitle
end tell
"#,
    )?;
    let fields = raw.trim().split('\u{1f}').collect::<Vec<_>>();
    if fields.len() < 5 {
        return None;
    }

    let name = fields[0].trim().to_string();
    let bundle_id = fields[1].trim().to_string();
    let executable_path = fields[2].trim().to_string();
    if name.is_empty() || bundle_id.is_empty() {
        return None;
    }
    let source_app = SourceAppInfo {
        name: name.clone(),
        bundle_id: bundle_id.clone(),
        executable_path: executable_path.clone(),
        icon_base64: bundle_icon_base64(&executable_path),
    };

    let kind = classify_application(&bundle_id, &name);
    let window_title = non_empty(fields[4]);
    let process_id = non_empty(fields[3]);
    let command_line = process_id.as_deref().and_then(process_command_line);
    let mut context = json!({
        "schemaVersion": 1,
        "kind": kind,
        "confidence": "best-effort",
        "application": {
            "name": name,
            "bundleId": bundle_id,
            "executablePath": executable_path,
            "processId": process_id,
        },
        "window": {
            "title": window_title,
            "source": "macos.accessibility",
        },
        "document": null,
        "workspace": null,
        "browser": null,
        "terminal": null,
        "selection": null,
        "signals": ["frontmost-application", "front-window-title"],
        "permissions": {
            "accessibility": "used",
            "automation": "not-requested",
        }
    });

    if include_application_context {
        enrich_context(
            &mut context,
            kind,
            &source_app.bundle_id,
            &source_app.name,
            window_title.as_deref(),
            command_line.as_deref(),
        );
    }

    Some(CapturedApplicationContext {
        source_app,
        application_context: context,
    })
}

#[cfg(target_os = "macos")]
fn enrich_context(
    context: &mut Value,
    kind: &str,
    bundle_id: &str,
    app_name: &str,
    window_title: Option<&str>,
    command_line: Option<&str>,
) {
    let Some(object) = context.as_object_mut() else {
        return;
    };
    if kind == "browser" {
        if let Some((url, title)) = browser_tab_context(bundle_id) {
            object.insert(
                "browser".to_string(),
                json!({
                    "name": app_name,
                    "url": url,
                    "title": title,
                    "source": "active-tab",
                    "confidence": "high",
                }),
            );
            object.insert(
                "permissions".to_string(),
                json!({
                    "accessibility": "used",
                    "automation": "used",
                }),
            );
            object
                .get_mut("signals")
                .and_then(Value::as_array_mut)
                .map(|signals| signals.push(json!("browser-active-tab")));
        } else {
            object.insert(
                "permissions".to_string(),
                json!({
                    "accessibility": "used",
                    "automation": "unavailable",
                }),
            );
        }
    } else if kind == "editor" {
        let editor = parse_editor_context(window_title.unwrap_or(""), command_line);
        object.insert("document".to_string(), editor["document"].clone());
        object.insert("workspace".to_string(), editor["workspace"].clone());
        object
            .get_mut("signals")
            .and_then(Value::as_array_mut)
            .map(|signals| signals.push(json!("editor-window-title")));
    } else if kind == "file-manager" {
        if let Some(paths) = finder_selection_paths() {
            object.insert(
                "selection".to_string(),
                json!({
                    "paths": paths,
                    "count": paths.len(),
                    "source": "finder-selection",
                    "confidence": "high",
                }),
            );
            object
                .get_mut("signals")
                .and_then(Value::as_array_mut)
                .map(|signals| signals.push(json!("file-manager-selection")));
        }
    } else if kind == "terminal" {
        object.insert(
            "terminal".to_string(),
            json!({
                "windowTitle": window_title,
                "source": "window-title",
                "confidence": "best-effort",
            }),
        );
    }
}

#[cfg(target_os = "macos")]
fn browser_tab_context(bundle_id: &str) -> Option<(String, String)> {
    let application = match bundle_id.to_lowercase().as_str() {
        "com.apple.safari" => "Safari",
        "org.mozilla.firefox" => "Firefox",
        "com.kagi.kagimacos" => "Kagi",
        "company.thebrowser.browser" => "Arc",
        "com.microsoft.edgemac" => "Microsoft Edge",
        "com.brave.browser" => "Brave Browser",
        "com.vivaldi.vivaldi" => "Vivaldi",
        "com.operasoftware.opera" => "Opera",
        "com.google.chrome.canary" => "Google Chrome Canary",
        "com.google.chrome.beta" => "Google Chrome Beta",
        "com.google.chrome.dev" => "Google Chrome Dev",
        "com.google.chrome" => "Google Chrome",
        _ => return None,
    };
    let script = if application == "Safari" {
        format!(
            "tell application \"{application}\"\nif (count of windows) = 0 then return \"\"\nset separator to ASCII character 31\nreturn (URL of current tab of front window) & separator & (name of current tab of front window)\nend tell"
        )
    } else {
        format!(
            "tell application \"{application}\"\nif (count of windows) = 0 then return \"\"\nset separator to ASCII character 31\nreturn (URL of active tab of front window) & separator & (title of active tab of front window)\nend tell"
        )
    };
    parse_browser_payload(&run_osascript(&script)?)
}

#[cfg(target_os = "macos")]
fn finder_selection_paths() -> Option<Vec<String>> {
    let raw = run_osascript(
        r#"
tell application "Finder"
    set separator to ASCII character 31
    set selectedItems to selection
    if (count of selectedItems) = 0 then return ""
    set outputItems to {}
    repeat with selectedItem in selectedItems
        set end of outputItems to POSIX path of (selectedItem as alias)
    end repeat
    set AppleScript's text item delimiters to separator
    return outputItems as text
end tell
"#,
    )?;
    let paths = parse_selection_paths(&raw);
    (!paths.is_empty()).then_some(paths)
}

#[cfg(target_os = "macos")]
fn process_command_line(process_id: &str) -> Option<String> {
    let output = Command::new("ps")
        .args(["-p", process_id, "-o", "command="])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "macos")]
fn run_osascript(script: &str) -> Option<String> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "macos")]
fn bundle_icon_base64(bundle_path: &str) -> Option<String> {
    use base64::Engine as _;
    use image::ImageEncoder as _;
    use std::path::PathBuf;

    let path = PathBuf::from(bundle_path);
    if !path.exists() {
        return None;
    }
    let icon = file_icon_provider::get_file_icon(&path, 64).ok()?;
    let mut png_bytes = Vec::with_capacity((icon.width * icon.height * 4) as usize / 2);
    let encoder = image::codecs::png::PngEncoder::new(&mut png_bytes);
    encoder
        .write_image(
            &icon.pixels,
            icon.width,
            icon.height,
            image::ExtendedColorType::Rgba8,
        )
        .ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png_bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        classify_application, parse_browser_payload, parse_editor_context, parse_selection_paths,
    };

    #[test]
    fn classifies_common_application_families() {
        assert_eq!(
            classify_application("com.google.Chrome", "Google Chrome"),
            "browser"
        );
        assert_eq!(
            classify_application("com.microsoft.VSCode", "Code"),
            "editor"
        );
        assert_eq!(
            classify_application("com.apple.Terminal", "Terminal"),
            "terminal"
        );
        assert_eq!(
            classify_application("com.example.App", "Example"),
            "generic"
        );
    }

    #[test]
    fn parses_editor_window_and_process_context() {
        let context = parse_editor_context(
            "main.ts \u{2014} clipforge",
            Some("Code --folder-uri file:///Users/demo/clipforge --file-uri file:///Users/demo/clipforge/main.ts"),
        );
        assert_eq!(context["document"]["name"], "main.ts");
        assert_eq!(context["workspace"]["name"], "clipforge");
        assert_eq!(context["workspace"]["path"], "file:///Users/demo/clipforge");
    }

    #[test]
    fn malformed_optional_context_is_ignored() {
        assert!(parse_browser_payload("").is_none());
        assert!(parse_browser_payload("https://example.com").is_some());
        assert_eq!(
            parse_selection_paths("/tmp/a\u{1f}\u{1f}/tmp/b"),
            vec!["/tmp/a", "/tmp/b"]
        );
    }
}
