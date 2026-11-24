pub mod capture_worker;
pub mod cleanup;
pub mod detect;
pub mod ingest;
pub mod payload;
pub mod read;
pub mod storage;
pub mod watcher;
pub mod write;

pub use detect::detect_text;
pub use ingest::build_clipboard_draft;
pub use payload::{StandardClipboardPayload, TextPayload};
pub use read::read_clipboard_payload;
pub use storage::ImageStore;
pub use write::write_clipboard_item;

/// 回归测试：回收站条目再次复制后必须重新进入全文索引。
#[cfg(test)]
#[path = "revive_tests.rs"]
mod revive_tests;
