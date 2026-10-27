//! 图片文字识别（OCR）域：本地视觉端点调用与提取命令（ocr-image-text-extraction 提案 Phase 1）。
//!
//! 边界：只调用**本地** OpenAI-compatible 视觉端点（llama-server/Ollama/LM Studio），
//! 绝不路由云端 provider（隐私红线，见提案 What-4）；单图 8MB 上限、60s 超时、
//! `OCR_*` 稳定错误码。推理运行时（llama.cpp/模型文件）由用户自备，应用只做发现与调用。

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// 单次提取的图片字节上限：超过直接拒绝，不发起网络请求（提案 spec「提取资源边界」）。
pub const OCR_IMAGE_MAX_BYTES: usize = 8 * 1024 * 1024;

/// 单次请求超时（秒）：视觉编码+生成实测 2-9s，60s 覆盖慢机并留取消余量。
pub const OCR_TIMEOUT_SECS: u64 = 60;

/// 官方 plain-OCR 任务提示（OvisOCR3 prompts/plain_ocr.txt 契约：原样输出、阅读顺序、纯文本）。
pub const OCR_PLAIN_PROMPT: &str = "Read all the text in the image. Directly output the content.\n\n\
Rules:\n\
1. Preserve the original text exactly without translation, paraphrasing, correction, or completion.\n\
2. Follow the natural human reading order.\n\
3. Output plain text only. Use spaces and line breaks only to preserve text separation and reading order.\n\
4. Do not output Markdown, HTML, JSON, bounding boxes, category labels, explanations, or code fences.";

/// 默认本地端点：llama-server 的 brew 惯例端口段，用户可在设置覆盖。
pub const OCR_DEFAULT_ENDPOINT: &str = "http://127.0.0.1:8491";

/// 提取结果载荷：文本 + 端点/模型元数据，前端详情页展示与「保存为文本条目」共用。
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

/// OpenAI-compatible chat 响应中本命令关心的最小字段集合。
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

/// 读取 OCR 设置：启用开关（默认开）与端点 URL（默认 llama-server 惯例端口）。
/// 设置缺失/损坏时回退默认值——OCR 是增强能力，不允许因配置问题影响其他域。
pub fn ocr_settings() -> (bool, String) {
    let Ok(payload) = crate::settings_service::read_user_settings() else {
        return (true, OCR_DEFAULT_ENDPOINT.to_string());
    };
    let enabled = payload
        .settings
        .get("ocrEnabled")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(true);
    let endpoint = payload
        .settings
        .get("ocrEndpointUrl")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(OCR_DEFAULT_ENDPOINT)
        .trim_end_matches('/')
        .to_string();
    (enabled, endpoint)
}

/// 构造 chat completions 请求体（base64 图片 + plain-OCR 提示，temperature=0）。
pub fn build_ocr_request_body(image_base64: &str) -> serde_json::Value {
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

/// 从图片条目定位原图并做大小校验，返回 (文件字节, 内容 hash 键)。
/// 错误码：OCR_NOT_AN_IMAGE（条目不存在/非图片/缺 image_file）、OCR_IMAGE_TOO_LARGE。
pub fn load_clip_image_bytes(id: &str) -> Result<(Vec<u8>, String), String> {
    let conn = crate::open_clip_db()?;
    let row = match conn.query_row(
        "SELECT content_hash, image_file FROM clips WHERE id = ?1 AND deleted_at IS NULL",
        rusqlite::params![id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
    ) {
        Ok(row) => row,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(format!("OCR_NOT_AN_IMAGE: {id}"));
        }
        Err(other) => return Err(format!("OCR_DB_ERROR: {other}")),
    };
    let (content_hash, image_file) = row;
    let Some(image_file) = image_file else {
        return Err(format!("OCR_NOT_AN_IMAGE: {id}"));
    };
    let meta = std::fs::metadata(&image_file)
        .map_err(|error| format!("OCR_IMAGE_READ_FAILED: {image_file}: {error}"))?;
    if meta.len() as usize > OCR_IMAGE_MAX_BYTES {
        return Err(format!(
            "OCR_IMAGE_TOO_LARGE: {} bytes > {} limit",
            meta.len(),
            OCR_IMAGE_MAX_BYTES
        ));
    }
    let bytes = std::fs::read(&image_file)
        .map_err(|error| format!("OCR_IMAGE_READ_FAILED: {image_file}: {error}"))?;
    Ok((bytes, content_hash))
}

/// 提取命令主体：设置检查 → 读图 → base64 → POST 本地端点 → 纯文本返回。
/// 错误码：OCR_DISABLED / OCR_ENDPOINT_UNAVAILABLE / OCR_TIMEOUT / OCR_BAD_RESPONSE / OCR_*（见上）。
pub async fn ocr_extract_inner(id: &str) -> Result<OcrExtractPayload, String> {
    let (enabled, endpoint) = ocr_settings();
    if !enabled {
        return Err("OCR_DISABLED: image text recognition is disabled in settings".to_string());
    }
    let (bytes, _hash) = load_clip_image_bytes(id)?;
    let started = std::time::Instant::now();
    let body = build_ocr_request_body(&base64::engine::general_purpose::STANDARD.encode(&bytes));
    let url = format!("{endpoint}/v1/chat/completions");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(OCR_TIMEOUT_SECS))
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
    Ok(OcrExtractPayload {
        text: content,
        model: parsed.model.unwrap_or_default(),
        elapsed_ms: started.elapsed().as_millis() as u64,
        endpoint,
    })
}

/// 提取图片条目中的文字（Tauri command，前端详情页/右键菜单「提取文字」入口）。
///
/// 只打本地视觉端点；失败返回 `OCR_*` 前缀错误码（前端按码映射提示文案）。
#[tauri::command]
pub async fn ocr_extract(id: String) -> Result<OcrExtractPayload, String> {
    ocr_extract_inner(&id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 请求体契约：data URL 前缀、plain-OCR 提示、temperature=0（提案 spec 与 README 配方一致）。
    #[test]
    fn builds_plain_ocr_request_body() {
        let body = build_ocr_request_body("QUJD");
        let content = body["messages"][0]["content"].as_array().expect("content array");
        let image_url = content[0]["image_url"]["url"].as_str().expect("data url");
        assert!(image_url.starts_with("data:image/png;base64,QUJD"));
        assert!(content[1]["text"].as_str().unwrap().contains("plain text only"));
        assert_eq!(body["temperature"].as_f64(), Some(0.0));
    }

    /// 非图片条目必须报 OCR_NOT_AN_IMAGE，而不是打端点（隔离数据目录 + 真实 schema）。
    #[test]
    fn missing_clip_reports_not_an_image() {
        let _guard = crate::hard_delete_image_cleanup_tests::TEST_DATA_DIR_LOCK.lock().expect("lock");
        let root = std::env::temp_dir().join(format!("clipforge-ocr-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("create dir");
        std::env::set_var("CLIPFORGE_DATA_DIR", &root);
        crate::init_clip_database().expect("init db schema");
        let error = load_clip_image_bytes("clip_does_not_exist").unwrap_err();
        assert!(error.starts_with("OCR_NOT_AN_IMAGE"), "got: {error}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 真实端点全链路（前置：llama-server 已在 127.0.0.1:8491 跑 OvisOCR3）。
    /// `cargo test --lib ocr -- --ignored` 显式触发；CI/常规门禁不依赖外部服务。
    #[test]
    #[ignore = "requires local llama-server with OvisOCR3 on 127.0.0.1:8491"]
    fn ocr_extract_live_end_to_end() {
        let _guard = crate::hard_delete_image_cleanup_tests::TEST_DATA_DIR_LOCK.lock().expect("lock");
        use crate::clipboard::payload::ImagePayload;

        use crate::{image_storage_path, open_clip_db};

        use super::ocr_extract_inner;

        let root = std::env::temp_dir().join(format!(
            "clipforge-ocr-live-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_millis()
        ));
        std::fs::create_dir_all(&root).expect("create dir");
        std::env::set_var("CLIPFORGE_DATA_DIR", &root);
        crate::init_clip_database().expect("init db");

        // 2x 渲染样张（评估已验证 5/5 行全对的那张）
        let png = std::path::PathBuf::from("/Users/embaobao/workspace/models/ovisocr3/probe/ground-truth-2x.png");
        let bytes = std::fs::read(&png).expect("probe png exists");
        let store = crate::clipboard::ImageStore::new(
            image_storage_path().expect("image storage path"),
        );
        let stored = store
            .store(&ImagePayload {
                bytes: bytes.clone(),
                width: 1800,
                height: 640,
            })
            .expect("store image");

        let conn = open_clip_db().expect("open db");
        conn.execute(
            "INSERT INTO clips (id, content, content_hash, primary_format, kind, bucket,
                 source, source_label, payload_kind, image_file, thumbnail_path,
                 created_at, updated_at, last_seen_at)
             VALUES ('clip_ocr_live', ?1, 'ocr-live-hash', 'image/png', 'media', 'all',
                 'test', 'test', 'image', ?2, ?3, 1, 1, 1)",
            rusqlite::params![
                stored.file_name,
                stored.origin_path.to_string_lossy().to_string(),
                stored.thumbnail_path.to_string_lossy().to_string(),
            ],
        )
        .expect("insert image row");

        let payload = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio rt")
            .block_on(ocr_extract_inner("clip_ocr_live"))
            .expect("live ocr extract");
        eprintln!(
            "[ocr live] {}ms model={} text={}",
            payload.elapsed_ms,
            payload.model,
            payload.text.replace('\n', " / ")
        );
        assert!(payload.text.contains("ClipForge OCR"));
        assert!(payload.text.contains("13800138000"));
        assert!(payload.text.contains("剪贴板历史"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
