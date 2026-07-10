use clipboard_rs::common::RustImage;
use clipboard_rs::{Clipboard, ClipboardContent, ClipboardContext, RustImageData};

use crate::ClipItemPayload;

#[derive(Debug, Clone)]
pub struct ClipboardWriteResult {
    pub written_formats: Vec<String>,
    pub guard_hash: String,
    pub text_fallback: String,
}

pub fn write_clipboard_item(
    item: &ClipItemPayload,
    paste_mode: Option<&str>,
) -> Result<ClipboardWriteResult, String> {
    let ctx = ClipboardContext::new().map_err(clip_err)?;
    let mode = paste_mode.unwrap_or("rich");
    if matches!(mode, "plain" | "filesAsPaths" | "files-as-paths") {
        let text = plain_text_for_item(item);
        ctx.set_text(text.clone()).map_err(clip_err)?;
        return Ok(ClipboardWriteResult {
            written_formats: vec!["text/plain".to_string()],
            guard_hash: crate::content_hash("text/plain", text.as_bytes()),
            text_fallback: text,
        });
    }

    match item.primary_format.as_str() {
        "text/html" => write_rich_text(&ctx, item, "html"),
        "text/rtf" => write_rich_text(&ctx, item, "rtf"),
        "image/png" => write_image(&ctx, item),
        "application/file-list" => write_files(&ctx, item),
        _ => {
            let text = item.content.clone();
            ctx.set_text(text.clone()).map_err(clip_err)?;
            Ok(ClipboardWriteResult {
                written_formats: vec!["text/plain".to_string()],
                guard_hash: item.content_hash.clone(),
                text_fallback: text,
            })
        }
    }
}

fn write_rich_text(
    ctx: &ClipboardContext,
    item: &ClipItemPayload,
    rich_kind: &str,
) -> Result<ClipboardWriteResult, String> {
    let plain = plain_text_for_item(item);
    let mut content = vec![ClipboardContent::Text(plain.clone())];
    let mut written_formats = vec!["text/plain".to_string()];
    if rich_kind == "html" {
        content.push(ClipboardContent::Html(item.content.clone()));
        written_formats.push("text/html".to_string());
    } else {
        content.push(ClipboardContent::Rtf(item.content.clone()));
        written_formats.push("text/rtf".to_string());
    }
    ctx.set(content).map_err(clip_err)?;
    Ok(ClipboardWriteResult {
        written_formats,
        guard_hash: item.content_hash.clone(),
        text_fallback: plain,
    })
}

fn write_image(ctx: &ClipboardContext, item: &ClipItemPayload) -> Result<ClipboardWriteResult, String> {
    let path = item
        .image_file
        .as_ref()
        .ok_or_else(|| "image item missing imageFile".to_string())?;
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    let image = RustImageData::from_bytes(&bytes).map_err(clip_err)?;
    ctx.set_image(image).map_err(clip_err)?;
    Ok(ClipboardWriteResult {
        written_formats: vec!["image/png".to_string()],
        guard_hash: item.content_hash.clone(),
        text_fallback: item.plain_text.clone(),
    })
}

fn write_files(ctx: &ClipboardContext, item: &ClipItemPayload) -> Result<ClipboardWriteResult, String> {
    let files = item
        .content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if files.is_empty() {
        return Err("file item has no paths".to_string());
    }
    ctx.set_files(files).map_err(clip_err)?;
    Ok(ClipboardWriteResult {
        written_formats: vec!["application/file-list".to_string()],
        guard_hash: item.content_hash.clone(),
        text_fallback: plain_text_for_item(item),
    })
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
