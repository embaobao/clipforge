//! 端点域：本地准入校验、OCR 设置读取、`/v1/models` 发现与响应解析。
//! 边界：准入只认 http + 回环地址；发现只扫本机常见推理端口，不接触任何云端 provider。

use serde::Serialize;

use super::OCR_DEFAULT_ENDPOINT;

/// 校验 OCR 端点只指向本机（提案隐私红线：绝不把剪贴板图片发往云端）。
/// 用 `reqwest::Url` 解析 authority 而非字符串前缀，避免 `127.0.0.1.evil.com`、
/// `127.0.0.1@evil.com` 之类绕过；只放行 http + 127.0.0.1 / localhost / ::1。
/// 边界：局域网自托管、0.0.0.0、自定义 DNS 指向本机均被拒（静态无法确认归属），
/// 用户需改填回环地址；https 本地端点同样被拒，保持与默认配方一致。
/// 返回解析后的 Url，供调用方基于同一对象拼请求路径，避免带 query 的端点拼接错位。
pub(super) fn validate_local_endpoint(endpoint: &str) -> Result<reqwest::Url, String> {
    let reject = || format!("OCR_ENDPOINT_NOT_LOCAL: {endpoint}");
    let parsed = reqwest::Url::parse(endpoint).map_err(|_| reject())?;
    if parsed.scheme() != "http" || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(reject());
    }
    let host = parsed
        .host_str()
        .unwrap_or("")
        .trim_matches(['[', ']'])
        .to_ascii_lowercase();
    if !matches!(host.as_str(), "127.0.0.1" | "localhost" | "::1") {
        return Err(reject());
    }
    Ok(parsed)
}

/// 读取 OCR 设置：启用开关（默认开）与端点 URL（默认 llama-server 惯例端口）。
/// 设置缺失/损坏时回退默认值——OCR 是增强能力，不允许因配置问题影响其他域。
pub(super) fn ocr_settings() -> (bool, String) {
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

/// 从 `/v1/models` 响应提取模型 id 列表，兼容 OpenAI `data[].id` 与 llama-server `models[].name`。
pub(super) fn parse_models_from_listing(parsed: &serde_json::Value) -> Vec<String> {
    for (container, id_key) in [("data", "id"), ("models", "name")] {
        if let Some(items) = parsed.get(container).and_then(serde_json::Value::as_array) {
            let models: Vec<String> = items
                .iter()
                .filter_map(|item| item.get(id_key).and_then(serde_json::Value::as_str))
                .map(ToString::to_string)
                .collect();
            if !models.is_empty() {
                return models;
            }
        }
    }
    Vec::new()
}

/// 读多模态自报：`capabilities` 含 "multimodal" → Some(true)；有数组但不含 → Some(false)；无字段 → None。
pub(super) fn parse_vision_capability(parsed: &serde_json::Value) -> Option<bool> {
    let check = |value: &serde_json::Value| -> Option<bool> {
        let caps = value.get("capabilities")?.as_array()?;
        Some(
            caps.iter()
                .filter_map(serde_json::Value::as_str)
                .any(|cap| cap.eq_ignore_ascii_case("multimodal")),
        )
    };
    if let Some(flag) = check(parsed) {
        return Some(flag);
    }
    parsed
        .get("models")
        .and_then(serde_json::Value::as_array)
        .and_then(|models| models.first())
        .and_then(check)
}

/// 本地视觉端点候选：探测结果 + 来源说明，设置页「图片文字识别」分区展示用。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrEndpointCandidate {
    /// 端点根 URL（不含 /v1）。
    pub url: String,
    /// `/v1/models` 返回的模型 id 列表（Ollama/LM Studio/llama-server 均兼容该端点）。
    pub models: Vec<String>,
    /// 候选来源：端口惯例推断（vision 能力在提取时以 `OCR_*` 错误码兜底验证）。
    pub source: String,
    /// 端点是否自报多模态能力；None = 响应未声明，不能断定不支持。
    pub vision: Option<bool>,
}

/// 扫描常见本地推理端口（llama-server 8491/8080、Ollama 11434、LM Studio 1234）的
/// `/v1/models`（1s 超时/个、并发打完），可达者即候选。
pub(super) async fn detect_endpoints() -> Result<Vec<OcrEndpointCandidate>, String> {
    let probes = [
        ("http://127.0.0.1:8491", "llama-server 常例端口"),
        ("http://127.0.0.1:8080", "llama-server 默认端口"),
        ("http://127.0.0.1:11434", "Ollama"),
        ("http://127.0.0.1:1234", "LM Studio"),
    ];
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1))
        .build()
        .map_err(|error| format!("OCR_CLIENT_BUILD_FAILED: {error}"))?;
    let jobs = probes.iter().map(|(url, source)| {
        let client = client.clone();
        let url = url.to_string();
        let source = source.to_string();
        async move {
            let response = client.get(format!("{url}/v1/models")).send().await.ok()?;
            if !response.status().is_success() {
                return None;
            }
            let parsed: serde_json::Value = response.json().await.ok()?;
            Some(OcrEndpointCandidate {
                url,
                models: parse_models_from_listing(&parsed),
                source,
                vision: parse_vision_capability(&parsed),
            })
        }
    });
    Ok(futures::future::join_all(jobs)
        .await
        .into_iter()
        .flatten()
        .collect())
}
