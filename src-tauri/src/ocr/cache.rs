//! 缓存域：图片 OCR 结果缓存与图片条目读取（ocr-image-text-extraction 提案）。
//!
//! 做什么：把提取结果按「端点 + 图片 content_hash」缓存在进程内，同图同端点重复提取
//!   直接返回，不再读图 / base64 / POST 本地视觉端点；同时承担图片条目的定位与大小校验。
//! 为什么：原实现把 content_hash 当 `_hash` 丢弃，每次提取都重跑 2-9s 视觉推理；
//!   提案 spec 要求「同一图片的提取结果可按图片 content_hash 缓存复用」。
//! 边界：进程内缓存，重启即失效；键含端点避免换模型返回旧文本；不含模型 id
//!   （同端点换 gguf 会陈旧，已知残余风险）；上限 64 条、超限整体清空（OCR 低频，
//!   不引入 LRU）；命中不重新探测端点可达性；不落盘（载荷无 Deserialize 且含敏感内容）。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use super::{OCR_IMAGE_MAX_BYTES, OcrExtractPayload};

/// 缓存条目上限：超过即整体清空，避免无限增长。`pub(super)` 供测试断言与实现同步。
pub(super) const OCR_CACHE_MAX_ENTRIES: usize = 64;

static OCR_RESULT_CACHE: OnceLock<Mutex<HashMap<String, OcrExtractPayload>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<String, OcrExtractPayload>> {
    OCR_RESULT_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 缓存可丢弃：Mutex 被毒化时恢复内部数据，绝不 panic 影响 OCR 主流程。
pub(super) fn lock_cache() -> std::sync::MutexGuard<'static, HashMap<String, OcrExtractPayload>> {
    cache().lock().unwrap_or_else(|error| error.into_inner())
}

/// 构造缓存键：同图不同端点（可能对应不同模型）必须 miss，防止返回旧模型的识别文本。
pub(super) fn cache_key(endpoint: &str, content_hash: &str) -> String {
    format!("{endpoint}::{content_hash}")
}

/// 读取缓存；命中时把 `elapsed_ms` 置 0，避免把首次真实耗时当成命中耗时写进诊断元数据。
pub(super) fn get_cached(key: &str) -> Option<OcrExtractPayload> {
    let mut payload = lock_cache().get(key).cloned()?;
    payload.elapsed_ms = 0;
    Some(payload)
}

/// 写入缓存；超过上限整体清空（简化淘汰，OCR 为低频手动动作）。
/// 并发同键双 miss 会各 POST 一次，不做 in-flight 去重，避免引入异步锁复杂度。
pub(super) fn store_cached(key: String, payload: &OcrExtractPayload) {
    let mut guard = lock_cache();
    if guard.len() >= OCR_CACHE_MAX_ENTRIES {
        guard.clear();
    }
    guard.insert(key, payload.clone());
}

/// 测试辅助：清空进程内缓存，供淘汰 / 并发用例在独占锁下重置全局状态。
#[cfg(test)]
pub(super) fn clear_cache_for_tests() {
    lock_cache().clear();
}

/// 从图片条目取 (content_hash, image_file)，不读文件内容，供缓存查重前置使用。
/// 错误码：OCR_NOT_AN_IMAGE（条目不存在 / 缺 image_file）、OCR_DB_ERROR。
pub(super) fn load_image_identity(id: &str) -> Result<(String, String), String> {
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
    Ok((content_hash, image_file))
}

/// 读取原图并做 8MB 上限校验。错误码：OCR_IMAGE_TOO_LARGE / OCR_IMAGE_READ_FAILED。
pub(super) fn read_image_bytes(image_file: &str) -> Result<Vec<u8>, String> {
    let meta = std::fs::metadata(image_file)
        .map_err(|error| format!("OCR_IMAGE_READ_FAILED: {image_file}: {error}"))?;
    if meta.len() as usize > OCR_IMAGE_MAX_BYTES {
        return Err(format!(
            "OCR_IMAGE_TOO_LARGE: {} bytes > {} limit",
            meta.len(),
            OCR_IMAGE_MAX_BYTES
        ));
    }
    std::fs::read(image_file)
        .map_err(|error| format!("OCR_IMAGE_READ_FAILED: {image_file}: {error}"))
}
