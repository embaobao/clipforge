use clipboard_rs::common::RustImage;
use clipboard_rs::{Clipboard, ClipboardContext, ContentFormat};

use super::payload::{ImagePayload, StandardClipboardPayload, TextPayload};

pub fn read_clipboard_payload() -> Result<Option<StandardClipboardPayload>, String> {
    let ctx = ClipboardContext::new().map_err(clip_err)?;
    if let Some(files) = read_files(&ctx)? {
        return Ok(Some(StandardClipboardPayload::Files(files)));
    }
    if ctx.has(ContentFormat::Image) {
        if let Some(image) = read_image(&ctx)? {
            return Ok(Some(StandardClipboardPayload::Image(image)));
        }
    }
    read_text_payload(&ctx).map(|payload| payload.map(StandardClipboardPayload::Text))
}

pub fn read_clipboard_text_fallback() -> Result<String, String> {
    match read_clipboard_payload()? {
        Some(StandardClipboardPayload::Text(text)) => Ok(text.text),
        Some(StandardClipboardPayload::Files(paths)) => Ok(paths.join("\n")),
        Some(StandardClipboardPayload::Image(image)) => {
            Ok(format!("[Image {}x{} PNG]", image.width, image.height))
        }
        None => Ok(String::new()),
    }
}

fn read_files(ctx: &ClipboardContext) -> Result<Option<Vec<String>>, String> {
    if !ctx.has(ContentFormat::Files) {
        return Ok(None);
    }
    let files = ctx
        .get_files()
        .map_err(clip_err)?
        .into_iter()
        .filter(|path| !path.trim().is_empty())
        .collect::<Vec<_>>();
    Ok((!files.is_empty()).then_some(files))
}

fn read_text_payload(ctx: &ClipboardContext) -> Result<Option<TextPayload>, String> {
    let has_text = ctx.has(ContentFormat::Text);
    let has_html = ctx.has(ContentFormat::Html);
    let has_rtf = ctx.has(ContentFormat::Rtf);
    if !has_text && !has_html && !has_rtf {
        return Ok(None);
    }
    let text = if has_text {
        ctx.get_text().map_err(clip_err)?
    } else {
        String::new()
    };
    let html = read_optional(has_html, || ctx.get_html());
    let rtf = read_optional(has_rtf, || ctx.get_rich_text());
    if text.trim().is_empty() && html.is_none() && rtf.is_none() {
        return Ok(None);
    }
    Ok(Some(TextPayload { text, html, rtf }))
}

fn read_image(ctx: &ClipboardContext) -> Result<Option<ImagePayload>, String> {
    if let Ok(bytes) = ctx.get_buffer(PNG_FORMAT) {
        if let Some((width, height)) = png_dimensions(&bytes) {
            return Ok(Some(ImagePayload {
                bytes,
                width,
                height,
            }));
        }
    }

    let image = ctx.get_image().map_err(clip_err)?;
    let (width, height) = image.get_size();
    if width == 0 || height == 0 {
        return Ok(None);
    }
    let bytes = image.to_png().map_err(clip_err)?.get_bytes().to_vec();
    Ok((!bytes.is_empty()).then_some(ImagePayload {
        bytes,
        width,
        height,
    }))
}

#[cfg(target_os = "macos")]
const PNG_FORMAT: &str = "public.png";
#[cfg(target_os = "windows")]
const PNG_FORMAT: &str = "PNG";
#[cfg(all(unix, not(target_os = "macos")))]
const PNG_FORMAT: &str = "image/png";

pub fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    if bytes.len() < 24 || bytes[..8] != SIGNATURE || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    if width == 0 || height == 0 {
        None
    } else {
        Some((width, height))
    }
}

fn read_optional(
    available: bool,
    read: impl FnOnce() -> clipboard_rs::common::Result<String>,
) -> Option<String> {
    if !available {
        return None;
    }
    read().ok().filter(|value| !value.trim().is_empty())
}

fn clip_err<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

#[cfg(test)]
mod tests {
    use super::png_dimensions;

    #[test]
    fn parses_png_dimensions() {
        let bytes = [
            0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D',
            b'R', 0, 0, 0, 2, 0, 0, 0, 3,
        ];
        assert_eq!(png_dimensions(&bytes), Some((2, 3)));
    }
}
