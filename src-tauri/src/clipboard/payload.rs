#[derive(Debug, Clone)]
pub enum StandardClipboardPayload {
    Text(TextPayload),
    Image(ImagePayload),
    Files(Vec<String>),
}

#[allow(dead_code)]
pub type ClipboardCapture = StandardClipboardPayload;
#[allow(dead_code)]
pub type FilesPayload = Vec<String>;

#[derive(Debug, Clone)]
pub struct TextPayload {
    pub text: String,
    pub html: Option<String>,
    pub rtf: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ImagePayload {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}
