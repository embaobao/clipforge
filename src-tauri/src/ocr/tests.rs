//! OCR 域测试：纯函数 / 隔离数据目录 / 本地 stub HTTP / golden 冻结。
//!
//! 目录化后统一挂在 `ocr::tests`，`cargo test --lib ocr` 过滤串不变。
//! 全局状态约定：改 `CLIPFORGE_DATA_DIR` 的用例持 `TEST_DATA_DIR_LOCK`；
//! 写进程内缓存的淘汰/并发/毒化用例持本文件 `OCR_CACHE_TEST_LOCK`，避免并行互相清空。

use super::{OCR_IMAGE_MAX_BYTES, OcrExtractPayload, builtin, cache, endpoint, extract};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::sync::Mutex;

fn sample(text: &str) -> OcrExtractPayload {
    OcrExtractPayload {
        text: text.to_string(),
        model: "OvisOCR3-Q8_0".to_string(),
        elapsed_ms: 2760,
        endpoint: "http://127.0.0.1:8491".to_string(),
    }
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio rt")
}

fn data_dir_lock() -> std::sync::MutexGuard<'static, ()> {
    crate::hard_delete_image_cleanup_tests::TEST_DATA_DIR_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

/// 在隔离数据目录建表并插入一张图片行；image_file 由调用方决定是否真实存在。
fn image_row(root: &Path, id: &str, hash: &str, image_file: &Path) {
    std::fs::create_dir_all(root).expect("create dir");
    std::env::set_var("CLIPFORGE_DATA_DIR", root);
    crate::init_clip_database().expect("init db");
    let conn = crate::open_clip_db().expect("open db");
    conn.execute(
        "INSERT INTO clips (id, content, content_hash, primary_format, kind, bucket,
             source, source_label, payload_kind, image_file, thumbnail_path,
             created_at, updated_at, last_seen_at)
         VALUES (?1, 'img', ?2, 'image/png', 'media', 'all',
             'test', 'test', 'image', ?3, '', 1, 1, 1)",
        rusqlite::params![id, hash, image_file.to_string_lossy().to_string()],
    )
    .expect("insert image row");
}

/// 零新增依赖的本地 HTTP stub：回环地址恰被 validate_local_endpoint 放行。
fn spawn_stub(status: &str, body: &str) -> (u16, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let port = listener.local_addr().expect("addr").port();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buf = [0u8; 4096];
        let _ = stream.read(&mut buf);
        let _ = stream.write_all(response.as_bytes());
    });
    (port, handle)
}

static OCR_CACHE_TEST_LOCK: Mutex<()> = Mutex::new(());

fn cache_guard() -> std::sync::MutexGuard<'static, ()> {
    OCR_CACHE_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

// ===== 端点 / 设置 / 请求体 =====

/// `/v1/models` 兼容解析：OpenAI data[].id 与 llama-server models[].name 两种形状。
#[test]
fn parses_both_models_listing_shapes() {
    let openai = serde_json::json!({"data": [{"id": "gpt-x"}, {"id": "b"}]});
    assert_eq!(endpoint::parse_models_from_listing(&openai), vec!["gpt-x", "b"]);
    assert_eq!(endpoint::parse_vision_capability(&openai), None);
    let llama = serde_json::json!({"models": [{
        "name": "OvisOCR3-Q8_0.gguf",
        "capabilities": ["completion", "multimodal"]
    }]});
    assert_eq!(endpoint::parse_models_from_listing(&llama), vec!["OvisOCR3-Q8_0.gguf"]);
    assert_eq!(endpoint::parse_vision_capability(&llama), Some(true));
    let no_vision = serde_json::json!({"models": [{"name": "m", "capabilities": ["completion"]}]});
    assert_eq!(endpoint::parse_vision_capability(&no_vision), Some(false));
}

/// 请求体契约：data URL 前缀、plain-OCR 提示、temperature=0。
#[test]
fn builds_plain_ocr_request_body() {
    let body = extract::build_ocr_request_body("QUJD");
    let content = body["messages"][0]["content"].as_array().expect("content array");
    assert!(content[0]["image_url"]["url"].as_str().unwrap().starts_with("data:image/png;base64,QUJD"));
    assert!(content[1]["text"].as_str().unwrap().contains("plain text only"));
    assert_eq!(body["temperature"].as_f64(), Some(0.0));
}

/// 非图片条目报 OCR_NOT_AN_IMAGE，而不是打端点。
#[test]
fn missing_clip_reports_not_an_image() {
    let _guard = data_dir_lock();
    let root = std::env::temp_dir().join(format!("clipforge-ocr-miss-{}", std::process::id()));
    image_row(&root, "clip_other", "other-hash", &root.join("x.png"));
    let error = cache::load_image_identity("clip_does_not_exist").unwrap_err();
    assert!(error.starts_with("OCR_NOT_AN_IMAGE"), "got: {error}");
    let _ = std::fs::remove_dir_all(&root);
}

/// 回环端点放行：IPv4 / localhost / IPv6、带端口路径查询、大小写 scheme。
#[test]
fn validate_local_endpoint_accepts_loopback_hosts() {
    for url in ["http://127.0.0.1:8491", "http://localhost:11434", "http://[::1]:1234/v1?x=1", "HTTP://LOCALHOST/", "http://127.0.0.1"] {
        assert!(endpoint::validate_local_endpoint(url).is_ok(), "{url}");
    }
}

/// 云端 / 伪装 / 非 http / 局域网端点一律拒绝，错误码可定位。
#[test]
fn validate_local_endpoint_rejects_cloud_and_non_http() {
    for url in ["https://127.0.0.1:8491", "http://example.com", "http://127.0.0.1.evil.com", "http://127.0.0.1@evil.com", "http://0.0.0.0:8491", "http://192.168.1.10:8491", "ftp://127.0.0.1", "", "127.0.0.1:8491"] {
        let error = endpoint::validate_local_endpoint(url).unwrap_err();
        assert!(error.starts_with("OCR_ENDPOINT_NOT_LOCAL"), "{url}: {error}");
    }
}

/// schema 必须接受 OCR 两个键，否则设置页写入被 settings_service_patch 拒绝。
#[test]
fn schema_accepts_ocr_setting_keys() {
    let patch = serde_json::json!({"ocrEnabled": false, "ocrEndpointUrl": "http://127.0.0.1:8491"});
    assert!(crate::settings_service::validate_settings_patch(&patch).is_ok());
}

#[test]
fn schema_rejects_bad_ocr_values() {
    assert!(crate::settings_service::validate_settings_patch(&serde_json::json!({"ocrEndpointUrl": ""})).is_err());
    assert!(crate::settings_service::validate_settings_patch(&serde_json::json!({"ocrEnabled": "yes"})).is_err());
}

// ===== 缓存 =====

#[test]
fn cache_key_separates_endpoints() {
    let a = cache::cache_key("http://127.0.0.1:8491", "hash-abc");
    assert_ne!(a, cache::cache_key("http://127.0.0.1:8080", "hash-abc"));
    assert_eq!(a, cache::cache_key("http://127.0.0.1:8491", "hash-abc"));
}

#[test]
fn cache_miss_returns_none_for_unknown_key() {
    assert!(cache::get_cached("miss-only::cache-key-miss-test").is_none());
}

#[test]
fn cached_payload_is_returned_with_zero_elapsed() {
    let key = cache::cache_key("http://127.0.0.1:8491", "cache-roundtrip-test-hash");
    cache::store_cached(key.clone(), &sample("识别文本"));
    let hit = cache::get_cached(&key).expect("应命中缓存");
    assert_eq!(hit.text, "识别文本");
    assert_eq!(hit.elapsed_ms, 0);
}

/// 8MB 上限在读文件前拒绝，不发起任何网络请求（spec「超大图片拒绝」Scenario）。
#[test]
fn read_image_bytes_rejects_over_8mb() {
    let path = std::env::temp_dir().join(format!("clipforge-ocr-oversize-{}.bin", std::process::id()));
    std::fs::write(&path, vec![0u8; OCR_IMAGE_MAX_BYTES + 1]).expect("写临时大文件");
    let error = cache::read_image_bytes(path.to_str().unwrap()).unwrap_err();
    let _ = std::fs::remove_file(&path);
    assert!(error.starts_with("OCR_IMAGE_TOO_LARGE"), "{error}");
}

/// 超过 64 条整体清空：最早键失效、最后一条仍在。
#[test]
fn cache_eviction_clears_at_limit() {
    let _guard = cache_guard();
    cache::clear_cache_for_tests();
    let limit = cache::OCR_CACHE_MAX_ENTRIES;
    for i in 0..=limit {
        cache::store_cached(cache::cache_key("http://127.0.0.1:8491", &format!("eviction-{i}")), &sample("淘汰"));
    }
    assert!(cache::get_cached(&cache::cache_key("http://127.0.0.1:8491", "eviction-0")).is_none());
    assert!(cache::get_cached(&cache::cache_key("http://127.0.0.1:8491", &format!("eviction-{limit}"))).is_some());
}

#[test]
fn cache_concurrent_rw_no_panic() {
    let _guard = cache_guard();
    cache::clear_cache_for_tests();
    let handles: Vec<_> = (0..8)
        .map(|i| std::thread::spawn(move || {
            let key = cache::cache_key("http://127.0.0.1:8491", &format!("concurrent-{i}"));
            cache::store_cached(key.clone(), &sample("并发"));
            let _ = cache::get_cached(&key);
        }))
        .collect();
    for handle in handles {
        handle.join().expect("并发读写不应 panic");
    }
}

/// 持锁 panic 毒化 Mutex 后，缓存仍可读写（不得让 OCR 主流程崩溃）。
#[test]
fn cache_poison_recovers() {
    let _guard = cache_guard();
    cache::clear_cache_for_tests();
    let poisoned = std::thread::spawn(|| {
        let _held = cache::lock_cache();
        panic!("故意毒化缓存锁");
    });
    assert!(poisoned.join().is_err());
    let key = cache::cache_key("http://127.0.0.1:8491", "poison-recovery");
    cache::store_cached(key.clone(), &sample("恢复"));
    assert!(cache::get_cached(&key).is_some());
}

// ===== golden：冻结对外契约 =====

mod golden_tests {
    use super::*;

    /// 请求体键形状冻结：改字段名会同时影响端点兼容与前端契约，必须先改测试。
    #[test]
    fn request_body_shape_is_frozen() {
        let body = extract::build_ocr_request_body("QUJD");
        let content = body["messages"][0]["content"].as_array().expect("content array");
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(content.len(), 2);
        assert_eq!(content[0]["type"], "image_url");
        assert_eq!(content[1]["type"], "text");
        assert_eq!(body["temperature"], 0);
        assert_eq!(body["max_tokens"], 4096);
    }

    /// 错误码前缀集合冻结：前端按 `OCR_*` 前缀映射提示文案。
    #[test]
    fn error_codes_are_prefixed() {
        let codes = [
            endpoint::validate_local_endpoint("http://example.com").unwrap_err(),
            cache::read_image_bytes("/definitely/missing.png").unwrap_err(),
        ];
        for code in codes {
            assert!(code.starts_with("OCR_"), "{code}");
        }
    }
}

// ===== 隔离数据目录 + 本地 stub HTTP =====

/// 本地 stub 返回 200：解析 model/text，并确认请求走的是 /v1/chat/completions。
#[test]
fn stub_success_parses_model_text() {
    let _guard = data_dir_lock();
    let root = std::env::temp_dir().join(format!("clipforge-ocr-stub-ok-{}", std::process::id()));
    let img = root.join("stub.png");
    image_row(&root, "clip_stub_ok", "stub-ok-unique-hash", &img);
    std::fs::write(&img, b"fake-png").expect("写测试图");
    let (port, handle) = spawn_stub("200 OK", r#"{"model":"stub-model","choices":[{"message":{"content":"OK"}}]}"#);
    let url = format!("http://127.0.0.1:{port}");
    let result = runtime().block_on(extract::extract_with_endpoint("clip_stub_ok", &url)).expect("stub 提取成功");
    handle.join().expect("stub 线程");
    assert_eq!(result.text, "OK");
    assert_eq!(result.model, "stub-model");
    assert_eq!(result.endpoint, url);
    let _ = std::fs::remove_dir_all(&root);
}

/// 本地 stub 返回 400：必须映射为 OCR_ENDPOINT_ERROR 且带状态码。
#[test]
fn stub_4xx_returns_endpoint_error() {
    let _guard = data_dir_lock();
    let root = std::env::temp_dir().join(format!("clipforge-ocr-stub-4xx-{}", std::process::id()));
    let img = root.join("stub.png");
    image_row(&root, "clip_stub_4xx", "stub-4xx-unique-hash", &img);
    std::fs::write(&img, b"fake-png").expect("写测试图");
    let (port, handle) = spawn_stub("400 Bad Request", "bad");
    let url = format!("http://127.0.0.1:{port}");
    let error = runtime().block_on(extract::extract_with_endpoint("clip_stub_4xx", &url)).unwrap_err();
    handle.join().expect("stub 线程");
    assert!(error.starts_with("OCR_ENDPOINT_ERROR: HTTP 400"), "{error}");
    let _ = std::fs::remove_dir_all(&root);
}

/// 缓存命中时 image_file 可以不存在：证明命中路径不读图、不 POST。
#[test]
fn cache_hit_skips_image_read() {
    let _guard = data_dir_lock();
    let root = std::env::temp_dir().join(format!("clipforge-ocr-hit-{}", std::process::id()));
    let missing = root.join("deleted-image.png");
    image_row(&root, "clip_cache_hit", "cache-hit-unique-hash", &missing);
    let url = "http://127.0.0.1:8491";
    cache::store_cached(cache::cache_key(url, "cache-hit-unique-hash"), &sample("缓存命中"));
    let result = runtime().block_on(extract::extract_with_endpoint("clip_cache_hit", url)).expect("命中缓存");
    assert_eq!(result.text, "缓存命中");
    assert_eq!(result.elapsed_ms, 0);
    let _ = std::fs::remove_dir_all(&root);
}

/// macOS 内置 OCR 最小回归：对固定文字图片识别，防止 FFI 类/选择器漂移后静默失效。
#[cfg(target_os = "macos")]
#[test]
fn builtin_vision_recognizes_sample_text() {
    let fixture = concat!(env!("CARGO_MANIFEST_DIR"), "/src/ocr/fixtures/ocr-sample.png");
    let text = builtin::recognize_image(fixture).expect("Vision 识别固定样本应成功");
    assert!(text.contains("ClipForge"), "识别结果应含 ClipForge：{text}");
    assert!(text.contains("2026"), "识别结果应含 2026：{text}");
}
