//! MCP 写库工具臂（从 lib.rs 迁入，modularity Phase 4）：clipboard.copy / clipboard.update /
//! clipf.delete / clipf.export / clipf.import。copy 含写回抑制（450ms）与 copied=true 回写；
//! 臂内错误码（-32602/-32000）与错误文案逐字节保留。

use serde_json::Value;
use std::time::Duration;

use crate::clipboard;
use crate::{
    capture_clip_record, export_clip_records, import_clip_records, init_schema, load_clip,
    now_millis, open_clip_db, soft_delete_clip_records, suppress_writeback_for, update_clip_record,
    ImportClipInput, UpdateClipInput,
};

pub(super) fn dispatch_clipboard_copy(name: &str, args: &Value) -> Result<Value, (i64, String)> {
    let conn = open_clip_db().map_err(|error| (-32000, error))?;
    init_schema(&conn).map_err(|error| (-32000, error))?;
    let item = if let Some(id) = args.get("id").and_then(Value::as_str) {
        load_clip(&conn, id).map_err(|error| (-32000, error))?
    } else {
        let text = args
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| (-32602, format!("{name} requires text or id")))?
            .to_string();
        capture_clip_record(
            text,
            Some(format!(
                "{} via {}",
                args.get("sourceLabel")
                    .and_then(Value::as_str)
                    .unwrap_or("MCP Agent"),
                name
            )),
            now_millis().map_err(|error| (-32000, error))?,
        )
        .map_err(|error| (-32000, error))?
        .item
    };
    let paste_mode = args.get("pasteMode").and_then(Value::as_str);
    suppress_writeback_for(Duration::from_millis(450));
    let write_result =
        clipboard::write_clipboard_item(&item, paste_mode).map_err(|error| (-32000, error))?;
    let updated = update_clip_record(UpdateClipInput {
        id: item.id.clone(),
        content: None,
        tags: None,
        bucket: None,
        favorite: None,
        pinned: None,
        note: None,
        metadata: None,
        agent_context: None,
        copied: Some(true),
    })
    .map_err(|error| (-32000, error))?;
    Ok(serde_json::json!({
        "ok": true,
        "id": updated.id,
        "primaryFormat": updated.primary_format,
        "availableFormats": updated.available_formats,
        "writtenFormats": write_result.written_formats,
        "chars": write_result.text_fallback.chars().count()
    }))
}

pub(super) fn dispatch_clipboard_update(args: &Value) -> Result<Value, (i64, String)> {
    let id = args
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| (-32602, "clipf.update requires id".to_string()))?
        .to_string();
    let payload = update_clip_record(UpdateClipInput {
        id,
        content: args
            .get("content")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        tags: args.get("tags").and_then(Value::as_array).map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect()
        }),
        bucket: args
            .get("bucket")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        favorite: args.get("favorite").and_then(Value::as_bool),
        pinned: args.get("pinned").and_then(Value::as_bool),
        note: args
            .get("note")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        metadata: args.get("metadata").cloned(),
        agent_context: args.get("agentContext").cloned(),
        copied: None,
    })
    .map_err(|error| (-32000, error))?;
    serde_json::to_value(payload).map_err(|error| (-32000, error.to_string()))
}

pub(super) fn dispatch_clipf_delete(args: &Value) -> Result<Value, (i64, String)> {
    let ids = args
        .get("ids")
        .and_then(Value::as_array)
        .ok_or_else(|| (-32602, "clipf.delete requires ids".to_string()))?
        .iter()
        .filter_map(Value::as_str)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    serde_json::to_value(soft_delete_clip_records(ids).map_err(|error| (-32000, error))?)
        .map_err(|error| (-32000, error.to_string()))
}

pub(super) fn dispatch_clipf_export(args: &Value) -> Result<Value, (i64, String)> {
    serde_json::to_value(
        export_clip_records(args.get("includeDeleted").and_then(Value::as_bool))
            .map_err(|error| (-32000, error))?,
    )
    .map_err(|error| (-32000, error.to_string()))
}

pub(super) fn dispatch_clipf_import(args: &Value) -> Result<Value, (i64, String)> {
    let items_value = args
        .get("items")
        .cloned()
        .ok_or_else(|| (-32602, "clipf.import requires items".to_string()))?;
    let items = serde_json::from_value::<Vec<ImportClipInput>>(items_value)
        .map_err(|error| (-32602, error.to_string()))?;
    serde_json::to_value(import_clip_records(items).map_err(|error| (-32000, error))?)
        .map_err(|error| (-32000, error.to_string()))
}
