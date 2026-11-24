//! 标签入库校验与存量标签的一次性清理。
//!
//! 为什么：旧的 `#` 规则把正文里所有 `#` 开头的片段都当标签入库（「#3」「#1a1a2e」
//! 「#腾讯会议：963-810-970」），链接 / Markdown 两条内置规则又给三分之一的条目打上类型标签，
//! 标签栏里只剩类型和垃圾。现在：`#话题` 必须长得像话题才入库；类型标签默认不再写入标签列；
//! 存量在数据库升级时清理一次。

use rusqlite::{params, Connection};
use serde_json::{Map, Value};
use std::collections::HashSet;

/// 内置类型标签（小写比较）：只应作为 kind 过滤，不应占用标签列。
const BUILTIN_TYPE_TAGS: [&str; 2] = ["链接", "markdown"];

/// `#话题` 两端要剥掉的标点：半角常用标点 + 中文全角标点（「#周报。」这种句尾写法很常见）。
pub const HASHTAG_TRIM_CHARS: &str = "#,.;:!?)]}\"'，。：；！？）】》」』、";

/// `#话题` 自动标签是否合法：2–32 个字符，只含字母、数字、汉字、下划线、连字符，
/// 至少含一个字母或汉字，且不是 3/4/6/8 位的十六进制色值（如 `#fff`、`#1a1a2e`）。
pub fn is_valid_hashtag_tag(tag: &str) -> bool {
    let count = tag.chars().count();
    if !(2..=32).contains(&count) {
        return false;
    }
    let mut has_letter = false;
    for ch in tag.chars() {
        if !(ch.is_alphanumeric() || ch == '_' || ch == '-') {
            return false;
        }
        has_letter |= ch.is_alphabetic();
    }
    let is_hex_color =
        matches!(count, 3 | 4 | 6 | 8) && tag.chars().all(|ch| ch.is_ascii_hexdigit());
    has_letter && !is_hex_color
}

/// 这一条里应被移除的标签：内置类型标签；以及正文里确实以 `#` 形式出现、又不合法的自动标签。
/// 后一条用来保住用户手打的标签——手打的标签不会恰好等于正文里的 `#片段`。
fn retired_tags(tags: &str, content: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    tags.split(',')
        .map(str::trim)
        .filter(|tag| !tag.is_empty() && seen.insert(tag.to_lowercase()))
        .filter(|tag| {
            BUILTIN_TYPE_TAGS
                .iter()
                .any(|builtin| builtin.eq_ignore_ascii_case(tag))
                || (!is_valid_hashtag_tag(tag) && content.contains(&format!("#{tag}")))
        })
        .map(str::to_string)
        .collect()
}

/// 一次性清理存量标签，返回 (改动行数, 移除标签个数)。被移除的标签连同时间记入
/// `metadata_json.tags_retired = { "<标签>": <毫秒时间戳> }`，便于核对与恢复。
/// 边界：不改动 `updated_at` / `last_seen_at`（这不是用户编辑）；metadata 不是 JSON 对象的行跳过。
pub fn retire_stored_tags(conn: &Connection, retired_at: i64) -> Result<(usize, usize), String> {
    let rows: Vec<(String, String, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, tags, COALESCE(content, ''), metadata_json FROM clips WHERE tags != ''",
            )
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<_, _>>()
            .map_err(|error| error.to_string())?
    };
    let mut changed = 0;
    let mut removed = 0;
    for (id, tags, content, metadata_json) in rows {
        let retired = retired_tags(&tags, &content);
        if retired.is_empty() {
            continue;
        }
        let Ok(Value::Object(mut metadata)) = serde_json::from_str::<Value>(&metadata_json) else {
            continue;
        };
        let kept: Vec<&str> = tags
            .split(',')
            .map(str::trim)
            .filter(|tag| !tag.is_empty() && !retired.iter().any(|gone| gone == tag))
            .collect();
        let entry = metadata
            .entry("tags_retired".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(map) = entry.as_object_mut() {
            for tag in &retired {
                map.insert(tag.clone(), Value::from(retired_at));
            }
        }
        let metadata_json = serde_json::to_string(&metadata).map_err(|error| error.to_string())?;
        conn.execute(
            "UPDATE clips SET tags = ?1, metadata_json = ?2 WHERE id = ?3",
            params![kept.join(","), metadata_json, id],
        )
        .map_err(|error| error.to_string())?;
        changed += 1;
        removed += retired.len();
    }
    Ok((changed, removed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashtag_tag_rejects_numbers_colors_and_fragments() {
        for junk in [
            "3",
            "13",
            "5423",
            "0000",
            "1963",
            "32517**",
            "1a1a2e",
            "fff",
            "a",
            "1a1a2e），只对",
        ] {
            assert!(!is_valid_hashtag_tag(junk), "{junk} 不该入库");
        }
        for topic in [
            "待办",
            "周报",
            "clipforge",
            "Github-token",
            "v2_1",
            "clipforge".repeat(3).as_str(),
        ] {
            assert!(is_valid_hashtag_tag(topic), "{topic} 应该入库");
        }
    }

    #[test]
    fn retired_tags_keep_hand_made_tags() {
        let content = "方案 #3 见 #1a1a2e），只对主要物体添加";
        let tags = "链接,Markdown,3,1a1a2e），只对主要物体添加,聚合,0000";
        assert_eq!(
            retired_tags(tags, content),
            vec!["链接", "Markdown", "3", "1a1a2e），只对主要物体添加"]
        );
        // 正文里没有对应 #片段的标签一律保留。
        assert!(retired_tags("0000,聚合", "普通正文").is_empty());
    }
}
