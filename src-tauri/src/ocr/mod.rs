//! 图片文字识别（OCR）域门面：本地视觉端点调用与提取命令（ocr-image-text-extraction 提案）。
//!
//! 模块划分（按职责，非按层）：`endpoint` 端点准入/设置/发现、`extract` 请求体与提取控制流、
//!   `cache` 结果缓存与图片定位、`tests` 单元 / stub / golden 测试。
//! 边界：只调用**本地** OpenAI-compatible 视觉端点，绝不路由云端（隐私红线）；单图 8MB 上限、
//!   60s 超时、`OCR_*` 稳定错误码。推理运行时（llama.cpp/模型文件）由用户自备，应用只做发现与调用。
//! 对外契约：`ocr::ocr_extract` / `ocr::ocr_detect_endpoints` 两个 command 路径与前端
//!   `invoke("ocr_extract")`、错误码字符串保持不变；内部 helper 一律 `pub(super)` 最小可见。

mod builtin;
mod cache;
mod endpoint;
mod extract;
#[cfg(test)]
#[path = "tests.rs"]
mod tests;

use serde::Serialize;

pub use endpoint::OcrEndpointCandidate;

/// 单次提取的图片字节上限：超过直接拒绝，不发起网络请求（提案 spec「提取资源边界」）。
pub const OCR_IMAGE_MAX_BYTES: usize = 8 * 1024 * 1024;
/// 单次请求超时（秒）：视觉编码+生成实测 2-9s，60s 覆盖慢机并留取消余量。
pub const OCR_TIMEOUT_SECS: u64 = 60;
/// 默认本地端点：llama-server 的 brew 惯例端口段，用户可在设置覆盖。
pub const OCR_DEFAULT_ENDPOINT: &str = "http://127.0.0.1:8491";
/// 官方 plain-OCR 任务提示（OvisOCR3 prompts/plain_ocr.txt：原样输出、阅读顺序、纯文本）。
pub const OCR_PLAIN_PROMPT: &str = "Read all the text in the image. Directly output the content.\n\n\
Rules:\n\
1. Preserve the original text exactly without translation, paraphrasing, correction, or completion.\n\
2. Follow the natural human reading order.\n\
3. Output plain text only. Use spaces and line breaks only to preserve text separation and reading order.\n\
4. Do not output Markdown, HTML, JSON, bounding boxes, category labels, explanations, or code fences.";

/// 提取结果载荷：文本 + 端点/模型元数据，前端详情页展示与「保存为文本条目」共用。
/// 缓存命中时 `elapsed_ms` 置 0，避免把首次真实耗时当成命中耗时写进诊断元数据。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrExtractPayload {
    /// 提取出的纯文本（已 trim 尾部空白）。
    pub text: String,
    /// 端点返回的 model 字段（如 "OvisOCR3-Q8_0"），用于结果溯源展示。
    pub model: String,
    /// 端到端耗时（毫秒），供诊断与体验基线。
    pub elapsed_ms: u64,
    /// 实际命中的端点 URL（设置覆盖后的最终值）。
    pub endpoint: String,
}

/// 查询当前平台是否提供内置 OCR（设置页据此隐藏本地端点配置）。
#[tauri::command]
pub fn ocr_builtin_available() -> bool {
    cfg!(target_os = "macos")
}

/// 提取图片条目中的文字（Tauri command，前端详情页/右键菜单「提取文字」入口）。
/// macOS 优先用系统 Vision 内置识别；失败时保留端点路径作兜底，返回 `OCR_*` 稳定错误码。

#[tauri::command]
pub async fn ocr_extract(id: String) -> Result<OcrExtractPayload, String> {
    extract::ocr_extract_inner(&id).await
}

/// 探测本地视觉端点候选（Tauri command，设置页「自动发现」按钮）。
#[tauri::command]
pub async fn ocr_detect_endpoints() -> Result<Vec<OcrEndpointCandidate>, String> {
    endpoint::detect_endpoints().await
}
