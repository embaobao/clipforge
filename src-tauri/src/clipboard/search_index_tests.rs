//! 回归：汉字部分词可搜、英文前缀可搜、中文标签参与全文搜索；
//! 数据库从版本 2 升级时一次性清理存量标签，并按新规则重建全文索引。

use super::revive_tests::{capture, isolated_data_dir, search_ids};
use rusqlite::params;

fn user_version(conn: &rusqlite::Connection) -> i64 {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("user_version")
}

#[test]
fn han_substring_and_english_prefix_are_searchable() {
    let _guard = isolated_data_dir("han-substring");
    let platform = capture("插件化平台启动接线", 1000).item.id;
    let sentence = capture("先搜平台，再搜方案", 1100).item.id;
    let clipboard = capture("Clipboard manager", 1200).item.id;

    // 结果按最近使用倒序。
    assert_eq!(
        search_ids("平台"),
        vec![sentence.as_str(), platform.as_str()]
    );
    assert!(search_ids("台平").is_empty(), "短语要求相邻且顺序一致");
    assert_eq!(
        search_ids("clip"),
        vec![clipboard.as_str()],
        "英文按前缀匹配"
    );
    assert_eq!(
        search_ids("manager"),
        vec![clipboard.as_str()],
        "完整单词仍然可搜"
    );
    assert!(search_ids("，，，").is_empty(), "只含标点的查询不报错");
}

#[test]
fn only_valid_hashtags_become_tags() {
    let _guard = isolated_data_dir("hashtag-validation");
    // 编号、色值不是话题；正文里有链接也不再加「链接」类型标签。
    let clip = capture("看 https://example.com #待办 #3 #1a1a2e #周报。", 1000);
    assert_eq!(clip.item.tags, vec!["待办".to_string(), "周报".to_string()]);
}

#[test]
fn chinese_tag_is_searchable() {
    let _guard = isolated_data_dir("tag-search");
    let id = capture("普通正文", 1000).item.id;
    let conn = crate::open_clip_db().expect("open db");
    conn.execute("UPDATE clips SET tags = '聚合' WHERE id = ?1", params![id])
        .expect("set tags");
    crate::upsert_fts(&conn, &id).expect("reindex");
    assert_eq!(search_ids("聚合"), vec![id]);
}

#[test]
fn schema_upgrade_retires_tags_and_rebuilds_index() {
    let _guard = isolated_data_dir("schema-upgrade");
    let content = "方案 #3 见 #1a1a2e），只对主要物体添加";
    let id = capture(content, 1000).item.id;
    let conn = crate::open_clip_db().expect("open db");
    conn.execute(
        "UPDATE clips SET tags = ?1 WHERE id = ?2",
        params!["链接,3,1a1a2e），只对主要物体添加,0000,聚合", id],
    )
    .expect("set tags");
    // 退回版本 2 的状态：索引里是没切分的原文。
    conn.execute_batch(
        "DELETE FROM clip_fts;
         INSERT INTO clip_fts(id, content, plain_text, search_text, title, summary, tags)
         SELECT id, content, plain_text, COALESCE(search_text, plain_text), title, summary, tags FROM clips;
         PRAGMA user_version = 2;",
    )
    .expect("downgrade to v2");
    // 任何一次打开数据库都会顺带升级，所以不通过搜索验证升级前状态，直接验证升级结果。

    crate::init_schema(&conn).expect("upgrade");

    let tags: String = conn
        .query_row("SELECT tags FROM clips WHERE id = ?1", params![id], |row| {
            row.get(0)
        })
        .expect("tags");
    let metadata: String = conn
        .query_row(
            "SELECT metadata_json FROM clips WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .expect("metadata");
    assert_eq!(
        tags, "0000,聚合",
        "类型标签与正文里的 #片段被清掉；正文没有 #0000，这个标签保留"
    );
    assert!(metadata.contains("\"tags_retired\"") && metadata.contains("\"链接\""));
    assert_eq!(user_version(&conn), 3);
    assert_eq!(search_ids("物体添加"), vec![id.as_str()]);
    assert_eq!(search_ids("聚合"), vec![id.as_str()], "标签列同样逐字切分");
    assert!(search_ids("链接").is_empty());

    // 版本已是最新：再初始化不重复迁移，索引里每条只有一行。
    crate::init_schema(&conn).expect("init again");
    let indexed: i64 = conn
        .query_row("SELECT COUNT(*) FROM clip_fts", [], |row| row.get(0))
        .expect("count fts");
    let active: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM clips WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )
        .expect("count clips");
    assert_eq!(indexed, active);
}

/// 设置里没有 builtinTagRules 时读到：链接、Markdown 关，#话题 开。
#[test]
fn builtin_tag_rules_default_to_topic_only() {
    let _guard = isolated_data_dir("tag-defaults");
    assert_eq!(crate::builtin_tag_rules_enabled(), (false, false, true));
}
