use clipboard_rs::common::RustImage;
use clipboard_rs::{Clipboard, ClipboardContent, ClipboardContext, RustImageData};

use crate::ClipItemPayload;

/// 执行系统剪贴板写入后返回的格式与回写抑制信息。
#[derive(Debug, Clone)]
pub struct ClipboardWriteResult {
    pub written_formats: Vec<String>,
    pub guard_hash: String,
    pub text_fallback: String,
}

/// 可测试的剪贴板写入计划；执行前完整描述格式、数据与降级文本。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClipboardWritePlan {
    pub mode: ClipboardWriteMode,
    pub entries: Vec<ClipboardWriteEntry>,
    pub guard_hash: String,
    pub text_fallback: String,
}

/// 系统剪贴板的实际写入模式。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClipboardWriteMode {
    PlainText,
    RichText,
    Image,
    Files,
}

/// 写入计划中的单个标准格式表示。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClipboardWriteEntry {
    pub format: String,
    pub data: ClipboardWriteData,
}

/// 写入计划支持的数据载体。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClipboardWriteData {
    Text(String),
    ImageFile(String),
    FileList(Vec<String>),
}

/// 根据条目的真实 representation 写入系统剪贴板，并返回写入结果。
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

/// 构建写入计划；仅有真实 file-list representation 的条目才能按文件写回。
pub fn build_clipboard_write_plan(
    item: &ClipItemPayload,
    paste_mode: Option<&str>,
) -> Result<ClipboardWritePlan, String> {
    let mode = paste_mode.unwrap_or("rich");
    if matches!(mode, "plain" | "filesAsPaths" | "files-as-paths") {
        // filesAsPaths 的语义是复制完整路径：file-list 条目的 search_text 存的是
        // 展示用文件名，完整路径在 file-list 表示与 content 里（ingest 写入约定）。
        let text = if matches!(mode, "filesAsPaths" | "files-as-paths")
            && item.primary_format == "application/file-list"
        {
            full_paths_for_item(item)
        } else {
            plain_text_for_item(item)
        };
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
        "application/file-list" if has_representation(item, "application/file-list") => {
            build_files_plan(item)
        }
        "application/file-list" => Ok(build_plain_representation_plan(item)),
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

fn build_plain_representation_plan(item: &ClipItemPayload) -> ClipboardWritePlan {
    let text = item
        .representations
        .iter()
        .find(|representation| representation.format == "text/plain")
        .and_then(|representation| representation.content.clone())
        .filter(|content| !content.trim().is_empty())
        .unwrap_or_else(|| plain_text_for_item(item));
    ClipboardWritePlan::new(
        ClipboardWriteMode::PlainText,
        vec![text_entry("text/plain", text.clone())],
        crate::content_hash("text/plain", text.as_bytes()),
        text,
    )
}

fn has_representation(item: &ClipItemPayload, format: &str) -> bool {
    item.representations
        .iter()
        .any(|representation| representation.format == format)
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

    /// 返回写入计划最终会发布到系统剪贴板的标准格式列表。
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

/// file-list 条目的完整路径文本：优先取 application/file-list 表示内容，
/// 回退 content（ingest 写入的 content 即换行连接的完整路径）。
fn full_paths_for_item(item: &ClipItemPayload) -> String {
    item.representations
        .iter()
        .find(|r| r.format == "application/file-list")
        .and_then(|r| r.content.clone())
        .filter(|text| !text.trim().is_empty())
        .unwrap_or_else(|| item.content.clone())
        .trim()
        .to_string()
}

fn clip_err<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

#[cfg(test)]
#[path = "write_tests.rs"]
mod tests;
