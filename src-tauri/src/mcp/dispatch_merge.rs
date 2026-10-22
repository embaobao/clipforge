//! MCP `clipboard.merge` 工具臂（TASK-6-B）：按 ids 读取多条剪贴记录，按分隔符/编号/顺序
//! 选项拼成纯文本返回。纯读路径——不调用 `capture_clip_record` / `write_clipboard_item`，
//! 不写库、不写回系统剪贴板（写入选项不在本波范围，见 task-6 范围红线）。
//! 拼接语义与前端 `src/clipboard/clipboard-domain.ts` `formatAggregate` 逐条对齐：
//! 顺序（click=传入序 / time=createdAt 稳定降序）、编号按 ordered 下标、空条目跳过、
//! 尾部空白裁剪、file 走路径逐行、image 走文件名降级。

use serde_json::{json, Value};

use crate::{init_schema, load_clip, open_clip_db, ClipItemPayload};

/// 条目顺序：click 保持 ids 传入序（等同前端 selected/点击序），time 按 createdAt 降序。
#[derive(Clone, Copy)]
enum MergeOrder {
    Click,
    Time,
}

/// 拼接选项：separator 已解析转义为真实分隔串，numbered 为编号开关。
struct MergeOptions {
    separator: String,
    numbered: bool,
    order: MergeOrder,
}

/// 拼接结果：merged 为最终文本；item_count/ids 只统计实际参与拼接的条目（空条目已跳过）。
struct MergeOutcome {
    merged: String,
    item_count: usize,
    ids: Vec<String>,
}

impl MergeOptions {
    /// 从工具参数解析拼接选项：separator 默认空行 `"\n\n"`，numbered 默认 false，order 默认 click。
    /// order 传非法值返回 -32602 而不静默回退——静默回退会让 Agent 拿到与预期顺序不一致的拼接结果。
    fn from_args(args: &Value) -> Result<Self, (i64, String)> {
        let separator = args
            .get("separator")
            .and_then(Value::as_str)
            .map(unescape_separator)
            .unwrap_or_else(|| "\n\n".to_string());
        let numbered = args
            .get("numbered")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let order = match args.get("order").and_then(Value::as_str) {
            None | Some("click") => MergeOrder::Click,
            Some("time") => MergeOrder::Time,
            Some(_) => {
                return Err((
                    -32602,
                    "clipboard.merge requires order to be click or time".to_string(),
                ))
            }
        };
        Ok(Self {
            separator,
            numbered,
            order,
        })
    }
}

/// 分隔串转义：字面 `\n` `\t` `\r` → 真实控制字符（与前端 resolveSeparator 的 custom 档同序替换）。
fn unescape_separator(value: &str) -> String {
    value
        .replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace("\\r", "\r")
}

/// 从路径或 URL 提取文件名：与前端 `clipboard-domain.ts` `getFileNameFromPath` 同语义
/// （file:// 剥离、http(s) 取 pathname 末段并 percent-decode、?# 截断、按 / 与 \ 取末段）。
fn file_name_from_path(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    let normalized = value.strip_prefix("file://").unwrap_or(value);
    let lowered = normalized.to_ascii_lowercase();
    if lowered.starts_with("http://") || lowered.starts_with("https://") {
        let after_scheme = normalized
            .split_once("://")
            .map(|(_, rest)| rest)
            .unwrap_or(normalized);
        let path = after_scheme
            .split_once('/')
            .map(|(_, path)| path)
            .unwrap_or("");
        // 先切掉 query/fragment 再取末段，等价前端的 url.pathname（不含查询串）
        let last = path
            .split(['?', '#'])
            .next()
            .unwrap_or(path)
            .split('/')
            .filter(|part| !part.is_empty())
            .next_back();
        if let Some(last) = last {
            let decoded = percent_decode(last);
            if !decoded.is_empty() {
                return decoded;
            }
        }
        // pathname 无末段时退到 host（前端回退 url.hostname）
        return after_scheme
            .split(['/', ':', '?', '#'])
            .find(|part| !part.is_empty())
            .unwrap_or(after_scheme)
            .to_string();
    }
    let clean = normalized.split(['?', '#']).next().unwrap_or(normalized);
    clean
        .split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .next_back()
        .unwrap_or(clean)
        .to_string()
}

/// 最小 percent-decode：`%XX`（十六进制）→ 字节，非法序列原样保留。
/// 只服务 URL 文件名提取，多字节 UTF-8 序列按字节累积后整体解码（对齐 decodeURIComponent 常见用例）。
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
            if let Some(byte) = hex.and_then(|hex| u8::from_str_radix(hex, 16).ok()) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| value.to_string())
}

/// 条目 → 可拼接文本：与前端 `clipboard-domain.ts` `aggregateItemText` 同语义。
/// file 取 content 内全部路径逐行（无路径回退 content）；image 走文件名降级链；其它取 content 原文。
/// 偏差：Rust 侧 `ClipItemPayload` 无 `analysis.attachment` 字段，image 少了「附件名」这一回退档
/// （image_file → thumbnail_path → analysis.title → content），前端链为 image_file → attachment.name → …。
fn aggregate_item_text(item: &ClipItemPayload) -> String {
    if item.payload_kind == "file" {
        let paths: Vec<&str> = item
            .content
            .split(['\r', '\n'])
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .collect();
        if paths.is_empty() {
            item.content.clone()
        } else {
            paths.join("\n")
        }
    } else if item.payload_kind == "image" {
        let from_image_file = file_name_from_path(item.image_file.as_deref().unwrap_or_default());
        if !from_image_file.is_empty() {
            return from_image_file;
        }
        let from_thumbnail =
            file_name_from_path(item.thumbnail_path.as_deref().unwrap_or_default());
        if !from_thumbnail.is_empty() {
            return from_thumbnail;
        }
        if !item.analysis.title.is_empty() {
            return item.analysis.title.clone();
        }
        item.content.clone()
    } else {
        item.content.clone()
    }
}

/// 按 options 拼接多个条目。编号取 ordered 数组下标（含被跳过的空条目），与前端
/// `formatAggregate` 的 `index + 1` 一致；`load` 注入以便用内存库做 dispatch 级冒烟。
fn merge_clips<F>(ids: &[String], options: &MergeOptions, load: F) -> Result<MergeOutcome, String>
where
    F: Fn(&str) -> Result<ClipItemPayload, String>,
{
    let mut items = Vec::with_capacity(ids.len());
    for id in ids {
        items.push(load(id)?);
    }
    let ordered: Vec<&ClipItemPayload> = match options.order {
        MergeOrder::Click => items.iter().collect(),
        // 稳定降序：同 createdAt 保持 ids 传入序（前端 Array.prototype.sort 同为稳定排序）
        MergeOrder::Time => {
            let mut sorted: Vec<&ClipItemPayload> = items.iter().collect();
            sorted.sort_by(|left, right| right.created_at.cmp(&left.created_at));
            sorted
        }
    };
    let mut parts: Vec<String> = Vec::with_capacity(ordered.len());
    let mut used_ids: Vec<String> = Vec::with_capacity(ordered.len());
    for (index, item) in ordered.iter().enumerate() {
        let text = aggregate_item_text(item);
        let trimmed = text.trim_end();
        if trimmed.is_empty() {
            continue;
        }
        parts.push(if options.numbered {
            format!("{}. {trimmed}", index + 1)
        } else {
            trimmed.to_string()
        });
        used_ids.push(item.id.clone());
    }
    Ok(MergeOutcome {
        merged: parts.join(&options.separator),
        item_count: parts.len(),
        ids: used_ids,
    })
}

/// 拼接核心：参数解析 + 经注入 loader 读条目 + 产出工具结果 JSON。
/// dispatch 壳只负责开库，注入点让单测能用内存 sqlite 走完整条 dispatch 路径。
fn merge_payload<F>(args: &Value, load: F) -> Result<Value, (i64, String)>
where
    F: Fn(&str) -> Result<ClipItemPayload, String>,
{
    let ids = args
        .get("ids")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .filter(|ids| !ids.is_empty())
        .ok_or_else(|| (-32602, "clipboard.merge requires ids".to_string()))?;
    let options = MergeOptions::from_args(args)?;
    let outcome = merge_clips(&ids, &options, load).map_err(|error| (-32000, error))?;
    Ok(json!({
        "ok": true,
        "merged": outcome.merged,
        "chars": outcome.merged.chars().count(),
        "itemCount": outcome.item_count,
        "ids": outcome.ids,
    }))
}

/// `clipboard.merge` 工具臂：按 ids 读取多条剪贴记录并拼接为纯文本。
/// 只读：不调用 `capture_clip_record` / `write_clipboard_item`，不写库、不写回系统剪贴板。
pub(super) fn dispatch_clipboard_merge(args: &Value) -> Result<Value, (i64, String)> {
    let conn = open_clip_db().map_err(|error| (-32000, error))?;
    init_schema(&conn).map_err(|error| (-32000, error))?;
    merge_payload(args, |id| load_clip(&conn, id))
}

#[cfg(test)]
mod merge_tests {
    use super::*;
    use rusqlite::{params, Connection};

    /// 内存库 + 真实 init_schema/load_clip：覆盖 clips 列映射与 merge 全链路，
    /// 不设 CLIPFORGE_DATA_DIR（并行测试下环境变量会互相污染），不碰用户数据库。
    fn fixture_db() -> Connection {
        let conn = Connection::open_in_memory().expect("内存库应可打开");
        init_schema(&conn).expect("schema 应可初始化");
        conn
    }

    fn seed(
        conn: &Connection,
        id: &str,
        content: &str,
        payload_kind: &str,
        created_at: i64,
        image_file: &str,
        thumbnail_path: &str,
    ) {
        conn.execute(
            "INSERT INTO clips (id, content, content_hash, primary_format, kind, bucket, source,
                source_label, created_at, updated_at, last_seen_at, payload_kind,
                image_file, thumbnail_path, plain_text)
             VALUES (?1, ?2, ?3, 'text/plain', 'text', 'history', 'clipboard', 'Unit Test',
                ?4, ?4, ?4, ?5, ?6, ?7, ?2)",
            params![
                id,
                content,
                format!("hash-{id}"),
                created_at,
                payload_kind,
                image_file,
                thumbnail_path
            ],
        )
        .expect("seed clip 应成功");
    }

    fn merge(args: Value, conn: &Connection) -> Value {
        merge_payload(&args, |id| load_clip(conn, id)).expect("merge 应成功")
    }

    /// 默认即旧硬编码行为：空行分隔 + 保持 ids 传入序（点击序）。
    #[test]
    fn merge_defaults_to_blank_line_separator_and_keeps_click_order() {
        let conn = fixture_db();
        seed(&conn, "clip_a", "alpha", "text", 100, "", "");
        seed(&conn, "clip_b", "beta", "text", 300, "", "");
        seed(&conn, "clip_c", "gamma", "text", 200, "", "");
        let payload = merge(json!({ "ids": ["clip_c", "clip_a", "clip_b"] }), &conn);
        assert_eq!(payload["merged"], "gamma\n\nalpha\n\nbeta");
        assert_eq!(payload["itemCount"], 3);
        assert_eq!(payload["chars"], 18);
        assert_eq!(payload["ids"], json!(["clip_c", "clip_a", "clip_b"]));
    }

    /// custom 分隔（含转义）+ 编号 + time 序（createdAt 降序）。
    #[test]
    fn merge_supports_custom_separator_numbered_and_time_order() {
        let conn = fixture_db();
        seed(&conn, "clip_a", "alpha", "text", 100, "", "");
        seed(&conn, "clip_b", "beta", "text", 300, "", "");
        seed(&conn, "clip_c", "gamma", "text", 200, "", "");
        let payload = merge(
            json!({
                "ids": ["clip_a", "clip_b", "clip_c"],
                "separator": "\\n---\\n",
                "numbered": true,
                "order": "time"
            }),
            &conn,
        );
        assert_eq!(payload["merged"], "1. beta\n---\n2. gamma\n---\n3. alpha");
    }

    /// 空内容条目跳过，但编号仍按 ordered 下标（空条目占序号不占输出）——与前端 formatAggregate 一致。
    #[test]
    fn merge_skips_empty_items_and_keeps_ordinal_positions() {
        let conn = fixture_db();
        seed(&conn, "clip_a", "alpha", "text", 100, "", "");
        seed(&conn, "clip_empty", "   \n\t ", "text", 200, "", "");
        seed(&conn, "clip_b", "beta  \n", "text", 300, "", "");
        let payload = merge(
            json!({ "ids": ["clip_a", "clip_empty", "clip_b"], "numbered": true, "separator": "\\n" }),
            &conn,
        );
        assert_eq!(payload["merged"], "1. alpha\n3. beta");
        assert_eq!(payload["itemCount"], 2);
        assert_eq!(payload["ids"], json!(["clip_a", "clip_b"]));
    }

    /// file 走路径逐行、image 走文件名降级链（image_file → thumbnail_path → title → content）。
    #[test]
    fn merge_degrades_file_and_image_payloads() {
        let conn = fixture_db();
        seed(
            &conn,
            "clip_file",
            "/tmp/one.txt\nfile:///tmp/two.png\n\n",
            "file",
            100,
            "",
            "",
        );
        seed(
            &conn,
            "clip_img_file",
            "binary",
            "image",
            200,
            "/tmp/pic.png",
            "",
        );
        seed(
            &conn,
            "clip_img_thumb",
            "binary",
            "image",
            300,
            "",
            "https://example.com/a/b%20c.png",
        );
        seed(&conn, "clip_img_title", "binary", "image", 400, "", "");
        let payload = merge(
            json!({ "ids": ["clip_file", "clip_img_file", "clip_img_thumb", "clip_img_title"], "separator": "\\n" }),
            &conn,
        );
        assert_eq!(
            payload["merged"],
            "/tmp/one.txt\nfile:///tmp/two.png\npic.png\nb c.png\nbinary"
        );
    }

    /// 缺 ids / 未知 id 都必须显式失败：不允许静默丢条目导致拼接结果缺内容。
    #[test]
    fn merge_rejects_missing_ids_and_unknown_ids() {
        let conn = fixture_db();
        seed(&conn, "clip_a", "alpha", "text", 100, "", "");
        let missing =
            merge_payload(&json!({}), |id| load_clip(&conn, id)).expect_err("缺少 ids 应报错");
        assert_eq!(missing.0, -32602);
        assert_eq!(missing.1, "clipboard.merge requires ids");
        let unknown = merge_payload(&json!({ "ids": ["clip_a", "clip_missing"] }), |id| {
            load_clip(&conn, id)
        })
        .expect_err("未知 id 应报错");
        assert_eq!(unknown.0, -32000);
        assert!(
            unknown.1.contains("clip_missing"),
            "错误应带上缺失 id，实际 {}",
            unknown.1
        );
    }

    /// 非法 order 值报 -32602，不静默回退 click。
    #[test]
    fn merge_rejects_unknown_order_value() {
        let conn = fixture_db();
        let error = merge_payload(&json!({ "ids": ["clip_a"], "order": "random" }), |id| {
            load_clip(&conn, id)
        })
        .expect_err("非法 order 应报错");
        assert_eq!(error.0, -32602);
        assert!(
            error.1.contains("order"),
            "错误应点名 order，实际 {}",
            error.1
        );
    }

    /// 分隔串支持 `\t` / `\r` 转义。
    #[test]
    fn merge_separator_unescapes_tab_and_carriage_return() {
        let conn = fixture_db();
        seed(&conn, "clip_a", "alpha", "text", 100, "", "");
        seed(&conn, "clip_b", "beta", "text", 200, "", "");
        let payload = merge(
            json!({ "ids": ["clip_a", "clip_b"], "separator": "\\t|\\r" }),
            &conn,
        );
        assert_eq!(payload["merged"], "alpha\t|\rbeta");
    }
}
