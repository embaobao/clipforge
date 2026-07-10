use std::path::Path;

use serde_json::json;

use super::payload::{StandardClipboardPayload, TextPayload};
use super::storage::ImageStore;
use crate::{content_hash, ClipboardRepresentationPayload};

#[derive(Debug, Clone)]
pub struct ClipboardItemDraft {
    pub content: String,
    pub content_hash: String,
    pub payload_kind: String,
    pub kind: String,
    pub primary_format: String,
    pub available_formats: Vec<String>,
    pub representations: Vec<ClipboardRepresentationPayload>,
    pub plain_text: String,
    pub search_text: Option<String>,
    pub sub_kind: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub size: Option<i64>,
    pub file_types: Option<String>,
    pub thumbnail_path: Option<String>,
    pub image_file: Option<String>,
    pub metadata: serde_json::Value,
}

pub fn build_clipboard_draft(
    payload: StandardClipboardPayload,
    image_store: &ImageStore,
) -> Result<ClipboardItemDraft, String> {
    match payload {
        StandardClipboardPayload::Text(text) => build_text_draft(text),
        StandardClipboardPayload::Image(image) => {
            let stored = image_store.store(&image)?;
            let content = stored.file_name.clone();
            let primary_format = "image/png".to_string();
            Ok(ClipboardItemDraft {
                content: content.clone(),
                content_hash: content_hash(&primary_format, &image.bytes),
                payload_kind: "image".to_string(),
                kind: "attachment".to_string(),
                primary_format: primary_format.clone(),
                available_formats: vec![primary_format.clone()],
                representations: vec![ClipboardRepresentationPayload {
                    format: primary_format,
                    storage: "file".to_string(),
                    content: None,
                    file_name: Some(stored.file_name),
                    size: Some(stored.size),
                    hash: Some(stored.hash),
                    preferred: true,
                }],
                plain_text: format!("Image {}x{}", stored.width, stored.height),
                search_text: Some(format!("image png {}x{}", stored.width, stored.height)),
                sub_kind: Some("png".to_string()),
                width: Some(stored.width),
                height: Some(stored.height),
                size: Some(stored.size),
                file_types: Some("png".to_string()),
                thumbnail_path: Some(stored.thumbnail_path.to_string_lossy().to_string()),
                image_file: Some(stored.origin_path.to_string_lossy().to_string()),
                metadata: json!({ "storage": "image-store" }),
            })
        }
        StandardClipboardPayload::Files(paths) => build_files_draft(paths),
    }
}

fn build_text_draft(text: TextPayload) -> Result<ClipboardItemDraft, String> {
    let has_html = text.html.as_ref().is_some_and(|value| !value.trim().is_empty());
    let has_rtf = text.rtf.as_ref().is_some_and(|value| !value.trim().is_empty());
    let (primary_format, content, payload_kind, sub_kind) = if has_html {
        (
            "text/html".to_string(),
            text.html.clone().unwrap_or_default(),
            "html".to_string(),
            Some("html".to_string()),
        )
    } else if has_rtf {
        (
            "text/rtf".to_string(),
            text.rtf.clone().unwrap_or_default(),
            "rtf".to_string(),
            Some("rtf".to_string()),
        )
    } else {
        let payload_kind = crate::detect_payload_kind(&text.text);
        (
            crate::primary_format_from_payload(&payload_kind).to_string(),
            text.text.clone(),
            payload_kind,
            None,
        )
    };

    let mut available_formats = Vec::new();
    let mut representations = Vec::new();
    if !text.text.trim().is_empty() {
        available_formats.push("text/plain".to_string());
        representations.push(inline_representation(
            "text/plain",
            &text.text,
            primary_format == "text/plain",
        ));
    }
    if let Some(html) = text.html.as_ref().filter(|value| !value.trim().is_empty()) {
        available_formats.push("text/html".to_string());
        representations.push(inline_representation(
            "text/html",
            html,
            primary_format == "text/html",
        ));
    }
    if let Some(rtf) = text.rtf.as_ref().filter(|value| !value.trim().is_empty()) {
        available_formats.push("text/rtf".to_string());
        representations.push(inline_representation(
            "text/rtf",
            rtf,
            primary_format == "text/rtf",
        ));
    }
    if !available_formats.iter().any(|format| format == &primary_format) {
        available_formats.insert(0, primary_format.clone());
    }

    let plain_text = if text.text.trim().is_empty() {
        content.clone()
    } else {
        text.text
    };
    let kind = crate::analysis_kind_from_payload(&payload_kind);
    Ok(ClipboardItemDraft {
        content: content.clone(),
        content_hash: content_hash(&primary_format, content.as_bytes()),
        payload_kind,
        kind,
        primary_format,
        available_formats,
        representations,
        plain_text: plain_text.clone(),
        search_text: Some(plain_text),
        sub_kind,
        width: None,
        height: None,
        size: Some(content.as_bytes().len() as i64),
        file_types: None,
        thumbnail_path: None,
        image_file: None,
        metadata: json!({}),
    })
}

fn build_files_draft(paths: Vec<String>) -> Result<ClipboardItemDraft, String> {
    let clean_paths = paths
        .into_iter()
        .filter(|path| !path.trim().is_empty())
        .collect::<Vec<_>>();
    if clean_paths.is_empty() {
        return Err("clipboard files payload is empty".to_string());
    }
    let content = clean_paths.join("\n");
    let file_names = clean_paths
        .iter()
        .map(|path| {
            Path::new(path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(path)
                .to_string()
        })
        .collect::<Vec<_>>();
    let file_types = clean_paths
        .iter()
        .filter_map(|path| Path::new(path).extension().and_then(|ext| ext.to_str()))
        .map(|ext| ext.to_lowercase())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let primary_format = "application/file-list".to_string();
    Ok(ClipboardItemDraft {
        content: content.clone(),
        content_hash: content_hash(&primary_format, content.as_bytes()),
        payload_kind: "file".to_string(),
        kind: "attachment".to_string(),
        primary_format: primary_format.clone(),
        available_formats: vec![primary_format.clone(), "text/plain".to_string()],
        representations: vec![
            inline_representation(&primary_format, &content, true),
            inline_representation("text/plain", &content, false),
        ],
        plain_text: content.clone(),
        search_text: Some(file_names.join("\n")),
        sub_kind: Some("file-list".to_string()),
        width: None,
        height: None,
        size: Some(clean_paths.len() as i64),
        file_types: (!file_types.is_empty()).then_some(file_types.join(",")),
        thumbnail_path: None,
        image_file: None,
        metadata: json!({ "fileCount": clean_paths.len() }),
    })
}

fn inline_representation(format: &str, content: &str, preferred: bool) -> ClipboardRepresentationPayload {
    ClipboardRepresentationPayload {
        format: format.to_string(),
        storage: "inline".to_string(),
        content: Some(content.to_string()),
        file_name: None,
        size: Some(content.as_bytes().len() as i64),
        hash: Some(content_hash(format, content.as_bytes())),
        preferred,
    }
}
