//! 插件内存预算常量与 manifest fixture（Phase 1 spike 用）。
//!
//! manifest `memoryLimit` 字段（design §2）是字符串（如 `"8MB"`），宿主侧解析为字节后
//! 交给 rquickjs `set_memory_limit`。Phase 2 完整 schema 校验时此解析函数会升级为带
//! 错误回执的校验器（`PLUGIN_MANIFEST_INVALID`），当前只服务 spike 的最小 fixture。

/// 每个插件 Runtime 的默认内存上限（design §18.2：8MB 默认值，Phase 1 实测基线后复核）。
pub const DEFAULT_MEMORY_LIMIT_BYTES: usize = 8 * 1024 * 1024;

/// spike fixture manifest 的内存上限：故意取极小值，让 `while(true)` + 大数组分配在
/// 毫秒级命中上限，不必先烧满 8MB。
pub const FIXTURE_MEMORY_LIMIT_BYTES: usize = 64 * 1024;

/// 解析 manifest `memoryLimit` 字符串为字节数。
///
/// 支持 `B`/`KB`/`MB`/`GB`（大小写不敏感，1024 进制）。无法识别时回退默认值——
/// Phase 1 不承接 manifest 校验职责（Phase 2 由 schema 校验先行拒绝）。
pub fn parse_memory_limit(raw: Option<&str>) -> usize {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return DEFAULT_MEMORY_LIMIT_BYTES;
    };
    let upper = raw.to_ascii_uppercase();
    let (number, unit) = match upper.strip_suffix("GB") {
        Some(n) => (n, 1024 * 1024 * 1024),
        None => match upper.strip_suffix("MB") {
            Some(n) => (n, 1024 * 1024),
            None => match upper.strip_suffix("KB") {
                Some(n) => (n, 1024),
                None => (upper.as_str(), 1),
            },
        },
    };
    number
        .trim()
        .parse::<usize>()
        .ok()
        .map(|n| n.saturating_mul(unit))
        .unwrap_or(DEFAULT_MEMORY_LIMIT_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_units_and_falls_back_on_garbage() {
        assert_eq!(parse_memory_limit(Some("8MB")), 8 * 1024 * 1024);
        assert_eq!(parse_memory_limit(Some("64kb")), 64 * 1024);
        assert_eq!(parse_memory_limit(Some("1024")), 1024);
        assert_eq!(parse_memory_limit(None), DEFAULT_MEMORY_LIMIT_BYTES);
        assert_eq!(parse_memory_limit(Some("")), DEFAULT_MEMORY_LIMIT_BYTES);
        assert_eq!(parse_memory_limit(Some("abc")), DEFAULT_MEMORY_LIMIT_BYTES);
    }
}
