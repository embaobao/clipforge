//! 剪贴板保留策略清理：回收站过期硬删 + 超出「保留条数上限」的部分移入回收站。
//!
//! 为什么超额部分不再硬删：被上限挤出的条目是用户主动复制过的历史，悄悄抹掉等于数据丢失
//! （2026-11-24 生产库：500 条上限把 10-28 之前的非收藏历史全部硬删）。移入回收站后
//! 仍受 `softDeletedRetentionDays` 约束，到期由本模块的过期步骤硬删，期间可随时恢复。

use rusqlite::{params, Connection};
use serde::Serialize;

/// 清理结果（`cleanup_clip_records` 命令载荷）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupClipPayload {
    /// 过期回收站硬删条数——本次清理唯一不可恢复的部分。
    pub hard_deleted: i64,
    /// 超出上限被移入回收站的条数。
    pub overflow_soft_deleted: i64,
    pub ran_at: i64,
}

/// 执行一次保留策略清理。调用方负责打开数据库并建表。
pub fn run_clip_cleanup(
    conn: &Connection,
    ran_at: i64,
    retention_days: i64,
    max_active_items: i64,
) -> Result<CleanupClipPayload, String> {
    // 单事务：过期硬删与超额移入要么全部生效，要么全部不动，避免清理到一半崩溃后状态不可解释。
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let hard_deleted = hard_delete_expired_trash(&tx, ran_at, retention_days)?;
    let overflow_soft_deleted = trash_overflow_clips(&tx, ran_at, max_active_items)?;
    // 全文索引只保留有效条目：回收站条目不参与搜索。
    tx.execute(
        "DELETE FROM clip_fts WHERE id NOT IN (SELECT id FROM clips WHERE deleted_at IS NULL)",
        [],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(CleanupClipPayload {
        hard_deleted,
        overflow_soft_deleted,
        ran_at,
    })
}

/// 硬删回收站里超过保留期的条目。
fn hard_delete_expired_trash(
    conn: &Connection,
    now: i64,
    retention_days: i64,
) -> Result<i64, String> {
    let retention_ms = retention_days.max(1) * 24 * 60 * 60 * 1000;
    conn.execute(
        "DELETE FROM clips WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        params![now - retention_ms],
    )
    .map(|count| count as i64)
    .map_err(|error| error.to_string())
}

/// 把超出上限的最旧非收藏、未置顶条目移入回收站。
/// 收藏与置顶是用户显式表达「要保留」的信号，一律豁免；豁免条目多于上限时不裁剪。
fn trash_overflow_clips(conn: &Connection, now: i64, max_active_items: i64) -> Result<i64, String> {
    let active_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM clips WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let overflow = active_count.saturating_sub(max_active_items).max(0);
    if overflow == 0 {
        return Ok(0);
    }
    let ids: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM clips
                 WHERE deleted_at IS NULL AND favorite = 0 AND pinned = 0
                 ORDER BY last_seen_at ASC, created_at ASC
                 LIMIT ?1",
            )
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map(params![overflow], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    for id in &ids {
        conn.execute(
            "UPDATE clips SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![now, id],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(ids.len() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_schema;

    const DAY_MS: i64 = 24 * 60 * 60 * 1000;
    const NOW: i64 = 1_000_000_000_000;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open memory db");
        init_schema(&conn).expect("init schema");
        conn
    }

    /// 直接写库造数据：只填 NOT NULL 列；`last_seen_at` 决定被裁剪的先后。
    fn insert(
        conn: &Connection,
        id: &str,
        last_seen_at: i64,
        favorite: i64,
        pinned: i64,
        deleted_at: Option<i64>,
    ) {
        conn.execute(
            "INSERT INTO clips (id, content, content_hash, primary_format, kind, bucket, source,
                 source_label, payload_kind, created_at, updated_at, last_seen_at, favorite, pinned, deleted_at)
             VALUES (?1, ?2, ?3, 'text/plain', 'text', 'history', 'test', 'test', 'text',
                     ?4, ?4, ?4, ?5, ?6, ?7)",
            params![
                id,
                format!("content-{id}"),
                format!("hash-{id}"),
                last_seen_at,
                favorite,
                pinned,
                deleted_at,
            ],
        )
        .expect("insert clip row");
    }

    fn deleted_at(conn: &Connection, id: &str) -> Option<i64> {
        conn.query_row(
            "SELECT deleted_at FROM clips WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .expect("read deleted_at")
    }

    fn indexed_ids(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT id FROM clip_fts ORDER BY id")
            .expect("prepare fts query");
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query fts");
        rows.collect::<Result<Vec<_>, _>>()
            .expect("collect fts ids")
    }

    /// 超额条目进回收站而不是被硬删；收藏与置顶豁免；全文索引同步剔除回收站条目。
    #[test]
    fn overflow_moves_oldest_unprotected_rows_to_trash() {
        let conn = memory_db();
        for (id, last_seen_at, favorite, pinned) in [
            ("fav-old", 1, 1, 0),
            ("pinned-old", 2, 0, 1),
            ("old-a", 3, 0, 0),
            ("old-b", 4, 0, 0),
            ("new-a", 5, 0, 0),
            ("new-b", 6, 0, 0),
        ] {
            insert(&conn, id, last_seen_at, favorite, pinned, None);
            crate::clipboard::search_index::upsert_fts(&conn, id).expect("index clip");
        }

        // 6 条有效、上限 2：超额 4。收藏与置顶豁免，所以裁掉的是最旧的 4 条非保护条目，
        // 剩余有效数恰好等于上限。
        let payload = run_clip_cleanup(&conn, NOW, 30, 2).expect("run cleanup");

        assert_eq!(payload.overflow_soft_deleted, 4);
        assert_eq!(payload.hard_deleted, 0);
        for trashed in ["old-a", "old-b", "new-a", "new-b"] {
            assert_eq!(
                deleted_at(&conn, trashed),
                Some(NOW),
                "{trashed} must be in trash"
            );
        }
        for spared in ["fav-old", "pinned-old"] {
            assert_eq!(deleted_at(&conn, spared), None, "{spared} must stay active");
        }
        assert_eq!(
            indexed_ids(&conn),
            ["fav-old", "pinned-old"],
            "trash must drop out of search"
        );
    }

    /// 回收站里超过保留期的才硬删，保留期内的（含刚被上限移入的）保留。
    #[test]
    fn expired_trash_is_hard_deleted_and_fresh_trash_is_kept() {
        let conn = memory_db();
        insert(&conn, "expired", 1, 0, 0, Some(NOW - 31 * DAY_MS));
        insert(&conn, "fresh", 2, 0, 0, Some(NOW - DAY_MS));
        insert(&conn, "live", 3, 0, 0, None);

        let payload = run_clip_cleanup(&conn, NOW, 30, 500).expect("run cleanup");

        assert_eq!(payload.hard_deleted, 1);
        let expired_left: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clips WHERE id = 'expired'",
                [],
                |row| row.get(0),
            )
            .expect("count expired");
        assert_eq!(expired_left, 0);
        assert_eq!(deleted_at(&conn, "fresh"), Some(NOW - DAY_MS));
        assert_eq!(deleted_at(&conn, "live"), None);
    }

    #[test]
    fn nothing_is_trashed_below_the_limit() {
        let conn = memory_db();
        insert(&conn, "a", 1, 0, 0, None);
        insert(&conn, "b", 2, 0, 0, None);

        let payload = run_clip_cleanup(&conn, NOW, 30, 500).expect("run cleanup");

        assert_eq!(payload.overflow_soft_deleted, 0);
        assert_eq!(deleted_at(&conn, "a"), None);
        assert_eq!(deleted_at(&conn, "b"), None);
    }
}
