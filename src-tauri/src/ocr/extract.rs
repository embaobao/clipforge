//! 提取域：请求体构造、HTTP 响应解析与「准入 → 缓存 → 读图 → 提取 → 写缓存」控制流。
//! 边界：macOS 优先同步调用系统 Vision（在阻塞线程池执行），否则走本地端点；
//!   端点显式传入的 `extract_with_endpoint` 供 stub 测试注入，不依赖全局设置文件。

use base64::Engine;
use serde::Deserialize;
use serde_json::json;

use super::{OCR_PLAIN_PROMPT, OCR_TIMEOUT_SECS, OcrExtractPayload, builtin, cache, endpoint};

/// OpenAI-compatible chat 响应中本域关心的最小字段集合。
#[derive(Debug, Deserialize)]
struct OcrChatResponse {
    model: Option<String>,
    choices: Vec<OcrChatChoice>,
}

#[derive(Debug, Deserialize)]
struct OcrChatChoice {
    message: OcrChatMessage,
}

#[derive(Debug, Deserialize)]
struct OcrChatMessage {
    content: Option<String>,
}

/// 构造 chat completions 请求体（base64 图片 + plain-OCR 提示，temperature=0）。
pub(super) fn build_ocr_request_body(image_base64: &str) -> serde_json::Value {
    json!({
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{image_base64}")}},
                {"type": "text", "text": OCR_PLAIN_PROMPT},
            ],
        }],
        "temperature": 0,
        "max_tokens": 4096,
    })
}

/// 命令主体：启用检查 → macOS 内置 Vision → 兜底本地端点。
/// 错误码：OCR_DISABLED / OCR_BUILTIN_* / OCR_ENDPOINT_* / OCR_TIMEOUT /
///   OCR_ENDPOINT_ERROR / OCR_BAD_RESPONSE / OCR_IMAGE_* / OCR_NOT_AN_IMAGE。
pub(super) async fn ocr_extract_inner(id: &str) -> Result<OcrExtractPayload, String> {
    let (enabled, endpoint) = endpoint::ocr_settings();
    if !enabled {
        return Err("OCR_DISABLED: image text recognition is disabled in settings".to_string());
    }

    // 内置引擎只有 macOS 可用。失败保留具体错误码给脱敏提示，同时回落到用户
    // 已配置的本地视觉服务，避免系统 OCR 偶发失败时功能完全不可用。
    #[cfg(target_os = "macos")]
    if let Ok(payload) = extract_with_builtin(id).await {
        return Ok(payload);
    }
    extract_with_endpoint(id, &endpoint).await
}

/// 内置引擎提取：缓存键按引擎隔离；读图大小校验后把同步 Vision 调用移到阻塞线程池。
/// 只在 macOS 编译，其他平台由 `ocr_extract_inner` 直接走端点。
#[cfg(target_os = "macos")]
async fn extract_with_builtin(id: &str) -> Result<OcrExtractPayload, String> {
    let (content_hash, image_file) = cache::load_image_identity(id)?;
    let key = cache::cache_key(builtin::BUILTIN_ENGINE, &content_hash);
    if let Some(hit) = cache::get_cached(&key) {
        return Ok(hit);
    }
    // 内置 OCR 直接读文件路径，不构造 base64；仍需 8MB / 文件存在校验。
    let _ = cache::read_image_bytes(&image_file)?;
    let started = std::time::Instant::now();
    let text = tokio::task::spawn_blocking(move || builtin::recognize_image(&image_file))
        .await
        .map_err(|_| "OCR_BUILTIN_FAILED: Vision worker crashed".to_string())??;
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("OCR_BUILTIN_NO_TEXT: no text observed in image".to_string());
    }
    let payload = OcrExtractPayload {
        text,
        model: "Apple Vision".to_string(),
        elapsed_ms: started.elapsed().as_millis() as u64,
        endpoint: "builtin://apple-vision".to_string(),
    };
    cache::store_cached(key, &payload);
    Ok(payload)
}

/// 带显式端点的提取实现：供 command 与本地 stub 测试共用。
/// 顺序不可调整：准入在读 DB 之前、缓存查重在读图之前，避免云端 POST 与重复推理。
pub(super) async fn extract_with_endpoint(
    id: &str,
    endpoint: &str,
) -> Result<OcrExtractPayload, String> {
    let base = endpoint::validate_local_endpoint(endpoint)?;
    let (content_hash, image_file) = cache::load_image_identity(id)?;
    let key = cache::cache_key(endpoint, &content_hash);
    if let Some(hit) = cache::get_cached(&key) {
        return Ok(hit);
    }
    let bytes = cache::read_image_bytes(&image_file)?;
    let started = std::time::Instant::now();
    let body = build_ocr_request_body(&base64::engine::general_purpose::STANDARD.encode(&bytes));
    let url = base
        .join("v1/chat/completions")
        .map_err(|error| format!("OCR_ENDPOINT_NOT_LOCAL: {endpoint}: {error}"))?
        .to_string();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(OCR_TIMEOUT_SECS))
        // 禁止重定向：本地端点若返回 307/308，reqwest 默认会带 base64 图片转发到任意地址。
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("OCR_CLIENT_BUILD_FAILED: {error}"))?;
    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                format!("OCR_TIMEOUT: exceeded {OCR_TIMEOUT_SECS}s")
            } else {
                format!("OCR_ENDPOINT_UNAVAILABLE: {url}: {error}")
            }
        })?;
    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        let brief: String = detail.chars().take(300).collect();
        return Err(format!("OCR_ENDPOINT_ERROR: HTTP {status}: {brief}"));
    }
    let parsed: OcrChatResponse = response
        .json()
        .await
        .map_err(|error| format!("OCR_BAD_RESPONSE: {error}"))?;
    let content = parsed
        .choices
        .first()
        .and_then(|choice| choice.message.content.clone())
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "OCR_BAD_RESPONSE: empty completion".to_string())?;
    let payload = OcrExtractPayload {
        text: content,
        model: parsed.model.unwrap_or_default(),
        elapsed_ms: started.elapsed().as_millis() as u64,
        endpoint: endpoint.to_string(),
    };
    cache::store_cached(key, &payload);
    Ok(payload)
}
