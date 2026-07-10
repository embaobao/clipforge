pub mod ingest;
pub mod payload;
pub mod read;
pub mod storage;
pub mod write;

pub use ingest::build_clipboard_draft;
pub use payload::{StandardClipboardPayload, TextPayload};
pub use read::{read_clipboard_payload, read_clipboard_text_fallback};
pub use storage::ImageStore;
pub use write::write_clipboard_item;
