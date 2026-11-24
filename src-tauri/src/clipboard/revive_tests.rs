//! 回归：被软删的条目（手动删除，或超出「历史数量上限」被移入回收站）再次复制后会复活，
//! 复活行必须重新进入全文索引，否则列表里看得到、文本搜索永远搜不到。

use super::payload::StandardClipboardPayload;

/// 进程级 `CLIPFORGE_DATA_DIR` 是全局状态：持锁串行，并把数据目录指到临时目录。
fn isolated_data_dir(tag: &str) -> std::sync::MutexGuard<'static, ()> {
    let guard = crate::hard_delete_image_cleanup_tests::TEST_DATA_DIR_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let root = std::env::temp_dir().join(format!(
        "clipforge-revive-test-{tag}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("create data dir");
    std::env::set_var("CLIPFORGE_DATA_DIR", &root);
    crate::init_clip_database().expect("init db");
    guard
}

fn capture(text: &str, observed_at: i64) -> crate::CaptureClipPayload {
    let payload = StandardClipboardPayload::Text(super::TextPayload {
        text: text.to_string(),
        html: None,
        rtf: None,
    });
    // 不采集应用上下文：那一步要跑 osascript，与本测试无关。
    crate::capture_clip_payload_with_options(payload, None, observed_at, false).expect("capture")
}

/// 带关键字的搜索只走全文索引（`FROM clip_fts JOIN clips`），索引缺失时结果里不会有这一行。
fn search_ids(text: &str) -> Vec<String> {
    crate::search_clip_records(crate::SearchClipsRequest {
        text: Some(text.to_string()),
        bucket: None,
        kinds: None,
        types: None,
        tags: None,
        file_extensions: None,
        favorite: None,
        limit: Some(20),
        cursor: None,
    })
    .expect("search")
    .items
    .into_iter()
    .map(|item| item.id)
    .collect()
}

/// 回收站里的同一条内容再次复制：状态是 promoted，且能重新被搜到。
#[test]
fn revived_clip_is_searchable_again() {
    let _guard = isolated_data_dir("promote");
    let content = "revive-regression-绝密口令";
    let id = capture(content, 1_000).item.id;
    assert_eq!(search_ids("绝密口令"), vec![id.clone()]);

    crate::soft_delete_clip_records(vec![id.clone()]).expect("soft delete");
    assert!(
        search_ids("绝密口令").is_empty(),
        "trash must stay out of search"
    );

    let revived = capture(content, 2_000);
    assert_eq!(revived.status, "promoted");
    assert_eq!(
        search_ids("绝密口令"),
        vec![id],
        "revived clip must be back in the search index"
    );
}
