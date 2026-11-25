//! macOS 内置 OCR：用系统 Vision 框架在进程内识别图片文字。
//!
//! 做什么：把本地图片路径交给 `VNRecognizeTextRequest`，按观察顺序拼成纯文本；
//!   失败统一返回 `OCR_BUILTIN_*` 稳定错误码，前端只读错误码不入原始 detail。
//! 为什么：用户要求「直接内置一个」，不应再要求用户自己启动本地视觉端点；
//!   Vision 随 macOS 交付，图片不出本机，隐私边界与旧端点路径一致。
//! 边界：仅 macOS 可用；单次图片仍受 `OCR_IMAGE_MAX_BYTES` 限制，识别在
//!   `spawn_blocking` 中执行，避免同步 Vision 调用阻塞 Tauri async runtime。

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub(crate) use macos::recognize_image;

/// 内置引擎标识：缓存键按引擎隔离；v2 增加 zh-Hans/en-US 识别语种，避免复用乱码缓存。
pub(super) const BUILTIN_ENGINE: &str = "apple-vision-v2";

/// 非 macOS 平台的内置 OCR 兜底：返回稳定错误码，由上层回落到本地端点路径。
#[cfg(not(target_os = "macos"))]
pub(super) fn recognize_image(_image_file: &str) -> Result<String, String> {
    Err("OCR_BUILTIN_UNAVAILABLE: built-in OCR is only available on macOS".to_string())
}
