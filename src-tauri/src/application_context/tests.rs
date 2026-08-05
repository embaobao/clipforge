use super::{classify_application, parse_browser_payload, parse_editor_context, parse_selection_paths};

#[test]
fn classifies_common_application_families() {
    assert_eq!(classify_application("com.google.Chrome", "Google Chrome"), "browser");
    assert_eq!(classify_application("com.microsoft.VSCode", "Code"), "editor");
    assert_eq!(classify_application("com.apple.Terminal", "Terminal"), "terminal");
    assert_eq!(classify_application("com.example.App", "Example"), "generic");
    assert_eq!(classify_application("com.openai.codex", "Codex"), "assistant");
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

