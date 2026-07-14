use clipboard_rs::common::RustImage;
use clipboard_rs::{Clipboard, ClipboardContent, ClipboardContext, RustImageData};

use crate::ClipItemPayload;

#[derive(Debug, Clone)]
pub struct ClipboardWriteResult {
    pub written_formats: Vec<String>,
    pub guard_hash: String,
    pub text_fallback: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClipboardWritePlan {
    pub mode: ClipboardWriteMode,
    pub entries: Vec<ClipboardWriteEntry>,
    pub guard_hash: String,
    pub text_fallback: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClipboardWriteMode {
    PlainText,
    RichText,
    Image,
    Files,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClipboardWriteEntry {
    pub format: String,
    pub data: ClipboardWriteData,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClipboardWriteData {
    Text(String),
    ImageFile(String),
    FileList(Vec<String>),
}

pub fn write_clipboard_item(
    item: &ClipItemPayload,
    paste_mode: Option<&str>,
) -> Result<ClipboardWriteResult, String> {
    let ctx = ClipboardContext::new().map_err(clip_err)?;
    let plan = build_clipboard_write_plan(item, paste_mode)?;
    execute_clipboard_write_plan(&ctx, &plan)?;
    Ok(ClipboardWriteResult {
        written_formats: plan.written_formats(),
        guard_hash: plan.guard_hash,
        text_fallback: plan.text_fallback,
    })
}

pub fn build_clipboard_write_plan(
    item: &ClipItemPayload,
    paste_mode: Option<&str>,
) -> Result<ClipboardWritePlan, String> {
    let mode = paste_mode.unwrap_or("rich");
    if matches!(mode, "plain" | "filesAsPaths" | "files-as-paths") {
        let text = plain_text_for_item(item);
        return Ok(ClipboardWritePlan::new(
            ClipboardWriteMode::PlainText,
            vec![text_entry("text/plain", text.clone())],
            crate::content_hash("text/plain", text.as_bytes()),
            text,
        ));
    }

    match item.primary_format.as_str() {
        "text/html" => build_rich_text_plan(item, "html"),
        "text/rtf" => build_rich_text_plan(item, "rtf"),
        "image/png" => build_image_plan(item),
        "application/file-list" => build_files_plan(item),
        _ => {
            let text = item.content.clone();
            Ok(ClipboardWritePlan::new(
                ClipboardWriteMode::PlainText,
                vec![text_entry("text/plain", text.clone())],
                item.content_hash.clone(),
                text,
            ))
        }
    }
}

fn execute_clipboard_write_plan(
    ctx: &ClipboardContext,
    plan: &ClipboardWritePlan,
) -> Result<(), String> {
    match plan.mode {
        ClipboardWriteMode::PlainText => {
            let text = plan.text_entry().ok_or_else(|| {
                "CLIPBOARD_WRITE_INVALID_PLAN: plain text entry missing".to_string()
            })?;
            ctx.set_text(text.to_string()).map_err(clip_err)
        }
        ClipboardWriteMode::RichText => {
            let mut content = Vec::new();
            for entry in &plan.entries {
                match (entry.format.as_str(), &entry.data) {
                    ("text/plain", ClipboardWriteData::Text(text)) => {
                        content.push(ClipboardContent::Text(text.clone()));
                    }
                    ("text/html", ClipboardWriteData::Text(text)) => {
                        content.push(ClipboardContent::Html(text.clone()));
                    }
                    ("text/rtf", ClipboardWriteData::Text(text)) => {
                        content.push(ClipboardContent::Rtf(text.clone()));
                    }
                    _ => {
                        return Err(format!(
                            "CLIPBOARD_WRITE_INVALID_PLAN: unsupported rich entry {}",
                            entry.format
                        ));
                    }
                }
            }
            ctx.set(content).map_err(clip_err)
        }
        ClipboardWriteMode::Image => {
            let path = plan
                .entries
                .iter()
                .find_map(|entry| match (&entry.format, &entry.data) {
                    (format, ClipboardWriteData::ImageFile(path)) if format == "image/png" => {
                        Some(path)
                    }
                    _ => None,
                })
                .ok_or_else(|| {
                    "CLIPBOARD_WRITE_INVALID_PLAN: image file entry missing".to_string()
                })?;
            let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
            let image = RustImageData::from_bytes(&bytes).map_err(clip_err)?;
            ctx.set_image(image).map_err(clip_err)
        }
        ClipboardWriteMode::Files => {
            let files = plan
                .entries
                .iter()
                .find_map(|entry| match (&entry.format, &entry.data) {
                    (format, ClipboardWriteData::FileList(files))
                        if format == "application/file-list" =>
                    {
                        Some(files.clone())
                    }
                    _ => None,
                })
                .ok_or_else(|| {
                    "CLIPBOARD_WRITE_INVALID_PLAN: file list entry missing".to_string()
                })?;
            ctx.set_files(files).map_err(clip_err)
        }
    }
}

fn build_rich_text_plan(
    item: &ClipItemPayload,
    rich_kind: &str,
) -> Result<ClipboardWritePlan, String> {
    let plain = plain_text_for_item(item);
    let mut entries = vec![text_entry("text/plain", plain.clone())];
    if rich_kind == "html" {
        entries.push(text_entry("text/html", item.content.clone()));
    } else {
        entries.push(text_entry("text/rtf", item.content.clone()));
    }
    Ok(ClipboardWritePlan::new(
        ClipboardWriteMode::RichText,
        entries,
        item.content_hash.clone(),
        plain,
    ))
}

fn build_image_plan(item: &ClipItemPayload) -> Result<ClipboardWritePlan, String> {
    let path = item.image_file.as_ref().ok_or_else(|| {
        "CLIPBOARD_WRITE_IMAGE_MISSING_FILE: image item missing imageFile".to_string()
    })?;
    Ok(ClipboardWritePlan::new(
        ClipboardWriteMode::Image,
        vec![ClipboardWriteEntry {
            format: "image/png".to_string(),
            data: ClipboardWriteData::ImageFile(path.clone()),
        }],
        item.content_hash.clone(),
        item.plain_text.clone(),
    ))
}

fn build_files_plan(item: &ClipItemPayload) -> Result<ClipboardWritePlan, String> {
    let files = item
        .content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if files.is_empty() {
        return Err("CLIPBOARD_WRITE_FILE_LIST_EMPTY: file item has no paths".to_string());
    }
    Ok(ClipboardWritePlan::new(
        ClipboardWriteMode::Files,
        vec![ClipboardWriteEntry {
            format: "application/file-list".to_string(),
            data: ClipboardWriteData::FileList(files),
        }],
        item.content_hash.clone(),
        plain_text_for_item(item),
    ))
}

impl ClipboardWritePlan {
    fn new(
        mode: ClipboardWriteMode,
        entries: Vec<ClipboardWriteEntry>,
        guard_hash: String,
        text_fallback: String,
    ) -> ClipboardWritePlan {
        ClipboardWritePlan {
            mode,
            entries,
            guard_hash,
            text_fallback,
        }
    }

    pub fn written_formats(&self) -> Vec<String> {
        self.entries
            .iter()
            .map(|entry| entry.format.clone())
            .collect::<Vec<_>>()
    }

    fn text_entry(&self) -> Option<&str> {
        self.entries.iter().find_map(|entry| match &entry.data {
            ClipboardWriteData::Text(text) => Some(text.as_str()),
            _ => None,
        })
    }
}

fn text_entry(format: &str, text: String) -> ClipboardWriteEntry {
    ClipboardWriteEntry {
        format: format.to_string(),
        data: ClipboardWriteData::Text(text),
    }
}

fn plain_text_for_item(item: &ClipItemPayload) -> String {
    item.search_text
        .clone()
        .filter(|text| !text.trim().is_empty())
        .unwrap_or_else(|| {
            if item.plain_text.trim().is_empty() {
                item.content.clone()
            } else {
                item.plain_text.clone()
            }
        })
}

fn clip_err<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        build_clipboard_write_plan, ClipboardWriteData, ClipboardWriteMode, ClipboardWritePlan,
    };
    use crate::{
        CaptureContextPayload, ClipAnalysisPayload, ClipItemPayload, ClipboardRepresentationPayload,
    };
    use serde_json::json;

    fn test_item(primary_format: &str, content: &str) -> ClipItemPayload {
        let content_hash = crate::content_hash(primary_format, content.as_bytes());
        ClipItemPayload {
            id: "clip-test".to_string(),
            content: content.to_string(),
            content_hash: content_hash.clone(),
            created_at: 1,
            updated_at: 1,
            last_seen_at: 1,
            last_copied_at: None,
            source: "clipboard".to_string(),
            kind: "text".to_string(),
            bucket: "history".to_string(),
            favorite: false,
            tags: Vec::new(),
            copy_count: 0,
            analysis: ClipAnalysisPayload {
                source_name: "Unit".to_string(),
                badge: "TXT".to_string(),
                title: "Unit clip".to_string(),
                summary: "Unit summary".to_string(),
                url: None,
                host: None,
                is_markdown: false,
            },
            payload_kind: "text".to_string(),
            primary_format: primary_format.to_string(),
            available_formats: vec![primary_format.to_string()],
            representations: vec![ClipboardRepresentationPayload {
                format: primary_format.to_string(),
                storage: "inline".to_string(),
                content: Some(content.to_string()),
                file_name: None,
                size: Some(content.len() as i64),
                hash: Some(content_hash),
                preferred: true,
            }],
            plain_text: "plain fallback".to_string(),
            search_text: Some("plain search".to_string()),
            sub_kind: None,
            width: None,
            height: None,
            size: Some(content.len() as i64),
            file_types: None,
            thumbnail_path: None,
            image_file: None,
            is_sensitive: false,
            capture_context: CaptureContextPayload {
                schema_version: 1,
                surface: "unit-test".to_string(),
                source_label: "Unit Test".to_string(),
                source_app: None,
                observed_at: 1,
                primary_format: primary_format.to_string(),
                available_formats: vec![primary_format.to_string()],
                environment: json!({ "platform": "test" }),
            },
            metadata: json!({}),
            agent_context: json!({}),
            source_app: None,
        }
    }

    fn entry_text(plan: &ClipboardWritePlan, format: &str) -> Option<String> {
        plan.entries
            .iter()
            .find_map(|entry| match (&entry.format, &entry.data) {
                (entry_format, ClipboardWriteData::Text(text)) if entry_format == format => {
                    Some(text.clone())
                }
                _ => None,
            })
    }

    #[test]
    fn html_rich_plan_writes_plain_and_html() {
        let item = test_item("text/html", "<b>Hello</b>");

        let plan = build_clipboard_write_plan(&item, None).expect("html write plan");

        assert_eq!(plan.mode, ClipboardWriteMode::RichText);
        assert_eq!(plan.written_formats(), vec!["text/plain", "text/html"]);
        assert_eq!(
            entry_text(&plan, "text/plain"),
            Some("plain search".to_string())
        );
        assert_eq!(
            entry_text(&plan, "text/html"),
            Some("<b>Hello</b>".to_string())
        );
        assert_eq!(plan.guard_hash, item.content_hash);
    }

    #[test]
    fn plain_mode_for_html_writes_plain_only_with_plain_hash() {
        let item = test_item("text/html", "<b>Hello</b>");

        let plan = build_clipboard_write_plan(&item, Some("plain")).expect("plain write plan");

        assert_eq!(plan.mode, ClipboardWriteMode::PlainText);
        assert_eq!(plan.written_formats(), vec!["text/plain"]);
        assert_eq!(
            entry_text(&plan, "text/plain"),
            Some("plain search".to_string())
        );
        assert_eq!(
            plan.guard_hash,
            crate::content_hash("text/plain", "plain search".as_bytes())
        );
    }

    #[test]
    fn rtf_rich_plan_writes_plain_and_rtf() {
        let item = test_item("text/rtf", "{\\rtf1 Hello}");

        let plan = build_clipboard_write_plan(&item, None).expect("rtf write plan");

        assert_eq!(plan.mode, ClipboardWriteMode::RichText);
        assert_eq!(plan.written_formats(), vec!["text/plain", "text/rtf"]);
        assert_eq!(
            entry_text(&plan, "text/rtf"),
            Some("{\\rtf1 Hello}".to_string())
        );
    }

    #[test]
    fn image_plan_uses_image_file_without_touching_clipboard() {
        let mut item = test_item("image/png", "image.png");
        item.image_file = Some("/tmp/clipforge-image.png".to_string());
        item.plain_text = "Image 2x3".to_string();

        let plan = build_clipboard_write_plan(&item, None).expect("image write plan");

        assert_eq!(plan.mode, ClipboardWriteMode::Image);
        assert_eq!(plan.written_formats(), vec!["image/png"]);
        assert_eq!(plan.text_fallback, "Image 2x3");
        assert_eq!(
            plan.entries[0].data,
            ClipboardWriteData::ImageFile("/tmp/clipforge-image.png".to_string())
        );
    }

    #[test]
    fn file_rich_and_path_modes_share_standard_entries() {
        let mut item = test_item("application/file-list", "/tmp/a.txt\n/tmp/b.md\n");
        item.plain_text = "/tmp/a.txt\n/tmp/b.md\n".to_string();
        item.search_text = Some("a.txt\nb.md".to_string());

        let rich = build_clipboard_write_plan(&item, None).expect("file write plan");
        assert_eq!(rich.mode, ClipboardWriteMode::Files);
        assert_eq!(rich.written_formats(), vec!["application/file-list"]);
        assert_eq!(
            rich.entries[0].data,
            ClipboardWriteData::FileList(vec!["/tmp/a.txt".to_string(), "/tmp/b.md".to_string()])
        );

        let paths =
            build_clipboard_write_plan(&item, Some("filesAsPaths")).expect("path write plan");
        assert_eq!(paths.mode, ClipboardWriteMode::PlainText);
        assert_eq!(paths.written_formats(), vec!["text/plain"]);
        assert_eq!(
            entry_text(&paths, "text/plain"),
            Some("a.txt\nb.md".to_string())
        );
    }
}
