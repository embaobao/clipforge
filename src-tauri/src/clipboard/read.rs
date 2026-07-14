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
    let html = read_optional("text/html", has_html, || ctx.get_html());
    let rtf = read_optional("text/rtf", has_rtf, || ctx.get_rich_text());
    if text.trim().is_empty() && html.is_none() && rtf.is_none() {
        return Ok(None);
    }
    Ok(Some(TextPayload { text, html, rtf }))
}

fn read_image(ctx: &ClipboardContext) -> Result<Option<ImagePayload>, String> {
    match ctx.get_buffer(PNG_FORMAT) {
        Ok(bytes) => {
            if let Some((width, height)) = png_dimensions(&bytes) {
                return Ok(Some(ImagePayload {
                    bytes,
                    width,
                    height,
                }));
            }
            crate::log_to_file(
                "warn",
                "clipboard-read",
                &format!(
                    "png buffer format present but dimensions invalid format={} bytes={}",
                    PNG_FORMAT,
                    bytes.len()
                ),
            );
        }
        Err(error) => {
            crate::log_to_file(
                "warn",
                "clipboard-read",
                &format!(
                    "png buffer unavailable despite image=true format={} error={}",
                    PNG_FORMAT, error
                ),
            );
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
    format: &str,
    available: bool,
    read: impl FnOnce() -> clipboard_rs::common::Result<String>,
) -> Option<String> {
    if !available {
        return None;
    }
    match read() {
        Ok(value) => {
            if value.trim().is_empty() {
                None
            } else {
                Some(value)
            }
        }
        Err(error) => {
            crate::log_to_file(
                "warn",
                "clipboard-read",
                &format!(
                    "optional format unavailable despite has=true format={} error={}",
                    format, error
                ),
            );
            None
        }
    }
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
            0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0,
            0, 0, 2, 0, 0, 0, 3,
        ];
        assert_eq!(png_dimensions(&bytes), Some((2, 3)));
    }
}
