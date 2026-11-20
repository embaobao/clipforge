//! 提取域：请求体构造、HTTP 响应解析与「准入 → 缓存 → 读图 → POST → 写缓存」控制流。
//! 边界：网络段是唯一 async 部分；端点显式传入的 `extract_with_endpoint` 供 stub 测试注入，
//!   避免测试依赖全局设置文件（最小依赖注入，不引入 trait/框架）。

use base64::Engine;
use serde::Deserialize;
use serde_json::json;

use super::{OCR_PLAIN_PROMPT, OCR_TIMEOUT_SECS, OcrExtractPayload, cache, endpoint};

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

/// 命令主体：读设置 → 启用检查 → 委托给带显式端点的实现。
/// 错误码：OCR_DISABLED / OCR_ENDPOINT_NOT_LOCAL / OCR_ENDPOINT_UNAVAILABLE / OCR_TIMEOUT /
///   OCR_ENDPOINT_ERROR / OCR_BAD_RESPONSE / OCR_IMAGE_* / OCR_NOT_AN_IMAGE。
pub(super) async fn ocr_extract_inner(id: &str) -> Result<OcrExtractPayload, String> {
    let (enabled, endpoint) = endpoint::ocr_settings();
    if !enabled {
        return Err("OCR_DISABLED: image text recognition is disabled in settings".to_string());
    }
    extract_with_endpoint(id, &endpoint).await
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
