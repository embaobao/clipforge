//! 剪贴板域：读取、监听、写回、入库草稿与共享去重/抑制状态。
pub mod dedup;
pub mod detect;
pub mod ingest;
pub mod payload;
pub mod read;
pub mod storage;
pub mod suppress;
pub mod watcher;
pub mod write;

pub use detect::detect_text;
pub use ingest::build_clipboard_draft;
pub use payload::{StandardClipboardPayload, TextPayload};
pub use read::read_clipboard_payload;
pub use storage::ImageStore;
pub use write::write_clipboard_item;
