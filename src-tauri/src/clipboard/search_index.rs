//! 全文索引（`clip_fts`）的写入与查询变换。
//!
//! 为什么：FTS5 默认分词器把一段连续汉字整体当成一个词元，搜「平台」命中不了
//! 「插件化平台启动接线」。做法：写入索引前给每个汉字后面补一个空格，查询词做同样变换，
//! 「平台」就变成「平」「台」相邻的短语，部分词即可命中。
//! 边界：只影响索引副本，`clips` 表原文不动；英文、数字按前缀匹配；
//! 汉字之间夹的标点在索引里是分隔符，跨标点相邻的两个字也算相邻（评审时定下的取舍）。

use rusqlite::{params, Connection, OptionalExtension};

/// 当前数据库结构版本（`PRAGMA user_version`）。3 = 全文索引逐字切分 + 存量标签清理。
pub const SCHEMA_VERSION: i64 = 3;

/// 需要逐字切分的字符：假名、汉字（扩展 A、基本区、兼容区、扩展 B 及以后）、韩文音节。
fn is_split_char(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3040..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xAC00..=0xD7AF
            | 0xF900..=0xFAFF | 0x20000..=0x2FA1F
    )
}

/// 给汉字补分隔：每个汉字后面补一个空格；汉字紧跟在字母或数字后面时前面也补一个空格。
/// 不补的话 unicode61 分词器会把「1补」这种相邻的字母数字与汉字当成同一个词，按字搜就搜不到。
pub fn split_cjk_chars(text: &str) -> String {
    // 汉字在 UTF-8 里占 3 字节，补空格最多让长度增加约三分之二。
    let mut out = String::with_capacity(text.len() + text.len() / 2 + 8);
    let mut previous: Option<char> = None;
    for ch in text.chars() {
        if is_split_char(ch) {
            if previous.is_some_and(|last| last.is_alphanumeric()) {
                out.push(' ');
            }
            out.push(ch);
            out.push(' ');
            previous = Some(' ');
        } else {
            out.push(ch);
            previous = Some(ch);
        }
    }
    out
}

/// 用户输入的查询文本 → FTS5 MATCH 表达式：空白分隔的词各自成为带前缀匹配的短语，词之间是「且」。
/// 只含标点的词在 FTS5 里没有词元，得到一个匹配不到任何行的短语，不会报语法错误。
pub fn fts_query(text: &str) -> String {
    text.split_whitespace()
        .map(|term| format!("\"{}\"*", split_cjk_chars(term).replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

fn insert_indexed(conn: &Connection, id: &str, cols: [&str; 6]) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO clip_fts(id, content, plain_text, search_text, title, summary, tags)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            split_cjk_chars(cols[0]),
            split_cjk_chars(cols[1]),
            split_cjk_chars(cols[2]),
            split_cjk_chars(cols[3]),
            split_cjk_chars(cols[4]),
            split_cjk_chars(cols[5]),
        ],
    )
}

/// 把一条 clips 行写入全文索引（先删后插）。条目在回收站里时只删不插。
pub fn upsert_fts(conn: &Connection, id: &str) -> Result<(), String> {
    let cols: Option<[String; 6]> = conn
        .query_row(
            "SELECT COALESCE(content, ''), COALESCE(plain_text, ''),
                    COALESCE(search_text, plain_text, ''), COALESCE(title, ''),
                    COALESCE(summary, ''), COALESCE(tags, '')
             FROM clips WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            |row| {
                Ok([
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ])
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    conn.execute("DELETE FROM clip_fts WHERE id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    if let Some(cols) = cols {
        insert_indexed(
            conn,
            id,
            [&cols[0], &cols[1], &cols[2], &cols[3], &cols[4], &cols[5]],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// 全量重建：清空索引后把所有未删除条目按当前规则重新写入，返回写入条数。
/// 调用方负责事务（数据库升级时在 `BEGIN IMMEDIATE` 里调用）。
pub fn rebuild_all(conn: &Connection) -> Result<usize, String> {
    conn.execute("DELETE FROM clip_fts", [])
        .map_err(|error| error.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, COALESCE(content, ''), COALESCE(plain_text, ''),
                    COALESCE(search_text, plain_text, ''), COALESCE(title, ''),
                    COALESCE(summary, ''), COALESCE(tags, '')
             FROM clips WHERE deleted_at IS NULL",
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                [
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ],
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut count = 0;
    for row in rows {
        let (id, cols) = row.map_err(|error| error.to_string())?;
        insert_indexed(
            conn,
            &id,
            [&cols[0], &cols[1], &cols[2], &cols[3], &cols[4], &cols[5]],
        )
        .map_err(|error| error.to_string())?;
        count += 1;
    }
    Ok(count)
}

/// 数据库结构升级到当前版本：清理存量标签 + 全文索引按新规则重建，两者在同一个事务里完成。
/// `current_version` 已是最新时直接返回（`init_schema` 每个命令都会调用，这里不能每次都抢写锁）；
/// 事务内再读一次版本，主进程与 `--mcp` 侧车同时启动时只有一个真正执行升级。
pub fn upgrade_schema(conn: &Connection, current_version: i64) -> Result<(), String> {
    if current_version >= SCHEMA_VERSION {
        return Ok(());
    }
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|error| error.to_string())?;
    let result = upgrade_in_transaction(conn);
    let finish = match &result {
        Ok(()) => "COMMIT",
        Err(_) => "ROLLBACK",
    };
    conn.execute_batch(finish)
        .map_err(|error| error.to_string())?;
    result
}

fn upgrade_in_transaction(conn: &Connection) -> Result<(), String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if version >= SCHEMA_VERSION {
        return Ok(());
    }
    let retired_at = crate::now_millis().unwrap_or(0);
    let (rows, tags) = super::tag_cleanup::retire_stored_tags(conn, retired_at)?;
    let indexed = rebuild_all(conn)?;
    crate::log_to_file(
        "info",
        "schema-upgrade",
        &format!(
            "schema upgraded {} -> {}: retired tags rows={}, tags={}, reindexed={}",
            version, SCHEMA_VERSION, rows, tags, indexed
        ),
    );
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_cjk_chars_spaces_each_han_char_only() {
        assert_eq!(split_cjk_chars("平台react"), "平 台 react");
        // 基本区之外的汉字（扩展 B）与假名同样逐字切分，emoji 与英文不受影响。
        assert_eq!(
            split_cjk_chars("\u{20000}\u{3042}a🎉"),
            "\u{20000} \u{3042} a🎉"
        );
        // 字母数字紧贴汉字时两侧都要隔开，否则「1补」会被分词器当成一个词。
        assert_eq!(split_cjk_chars("1补流程a台"), "1 补 流 程 a 台 ");
        assert_eq!(split_cjk_chars(""), "");
    }

    #[test]
    fn fts_query_builds_prefixed_phrases() {
        assert_eq!(fts_query("平台 react"), "\"平 台 \"* \"react\"*");
        assert_eq!(fts_query("say \"hi"), "\"say\"* \"\"\"hi\"*");
        assert_eq!(fts_query("   "), "");
    }
}
