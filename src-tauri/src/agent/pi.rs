//! pi 前端分析运行时的 provider 解析（agent 域，pi-sdk L2）：
//! settings_service 读路径对 agent.providers[].apiKey 统一 redaction（"[redacted]" 占位），
//! 前端设置态拿不到明文 key；pi-ai 调用所需的 provider 配置在调用时经
//! agent_resolve_pi_provider 解析（inline apiKey 或 apiKeyEnv/apiKeyRef 环境变量），
//! 明文 key 只在这一次 IPC 往返中出现，不落任何前端持久状态。

use serde::Serialize;
use serde_json::Value;

use super::provider::{value_bool, value_string};
use crate::settings_service::read_user_settings;

/// 解析出的单个 pi provider（camelCase 序列化，字段与前端 AgentProviderConfig 对齐）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedPiProvider {
    provider: String,
    label: Option<String>,
    model_id: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    /// key 来源标注（"inline"=设置内联 key，"env"=apiKeyEnv/apiKeyRef 环境变量）；
    /// None = 无 key，pi-ai 侧走自身 env 回退。
    api_key_source: Option<&'static str>,
}

/// 解析单个 provider 的 API key：inline apiKey 优先（"[redacted]" 是读路径占位符，
/// 磁盘上不应出现，防御性跳过），其次 apiKeyEnv/apiKeyRef 指向的环境变量。
fn resolve_pi_api_key(entry: &Value) -> (Option<String>, Option<&'static str>) {
    if let Some(inline) = value_string(entry, &["apiKey"]).filter(|key| key != "[redacted]") {
        return (Some(inline), Some("inline"));
    }
    if let Some(var_name) = value_string(entry, &["apiKeyEnv", "apiKeyRef"]) {
        if let Ok(value) = std::env::var(&var_name) {
            if !value.trim().is_empty() {
                return (Some(value), Some("env"));
            }
        }
    }
    (None, None)
}

/// settings 条目 → pi provider 配置：enabled=false 与 local-cli/cli（子进程 agent，
/// pi-ai 走 HTTP API 用不上）跳过；新结构（agent.providers[]）的 kind 映射为 pi-ai 的
/// openai provider（baseUrl 由前端覆盖到模型上）；legacy（顶层 agentProviders[]）
/// 的 provider 字段原样保留。
fn pi_provider_from_entry(entry: &Value) -> Option<ResolvedPiProvider> {
    if !entry.is_object() || !value_bool(entry, "enabled", true) {
        return None;
    }
    let kind = value_string(entry, &["kind"]);
    let provider = match (value_string(entry, &["provider"]), kind.as_deref()) {
        (Some(provider), _) => provider,
        (None, Some("openai-compatible" | "openai" | "openapi")) => "openai".to_string(),
        _ => return None,
    };
    let (api_key, api_key_source) = resolve_pi_api_key(entry);
    Some(ResolvedPiProvider {
        provider,
        label: value_string(entry, &["label", "name"]),
        model_id: value_string(entry, &["modelId", "model"]),
        base_url: value_string(entry, &["baseUrl", "baseURL", "endpoint"]),
        api_key,
        api_key_source,
    })
}

/// pi 运行时 provider 解析命令：返回首个可用的 pi provider 配置（无可用配置返回 null）。
#[tauri::command]
pub fn agent_resolve_pi_provider() -> Result<Option<ResolvedPiProvider>, String> {
    let settings = read_user_settings()
        .map(|payload| payload.settings)
        .unwrap_or(Value::Null);
    let providers = settings
        .get("agent")
        .and_then(|agent| agent.get("providers"))
        .and_then(Value::as_array)
        .or_else(|| settings.get("agentProviders").and_then(Value::as_array));
    Ok(providers.and_then(|entries| entries.iter().filter_map(pi_provider_from_entry).next()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 新结构条目：disabled 与 local-cli 跳过；"[redacted]" 占位 key 不当作 inline key。
    #[test]
    fn skips_disabled_cli_and_placeholder_key_entries() {
        assert!(
            pi_provider_from_entry(&json!({
                "enabled": false, "kind": "openai-compatible",
                "baseUrl": "https://x/v1", "modelId": "m", "apiKey": "sk-live"
            }))
            .is_none(),
            "disabled entry should be skipped"
        );
        assert!(
            pi_provider_from_entry(&json!({"kind": "local-cli", "command": "claude"})).is_none(),
            "local-cli entry cannot serve pi-ai HTTP calls"
        );
        let resolved = pi_provider_from_entry(&json!({
            "id": "openai-main", "kind": "openai-compatible", "enabled": true,
            "baseUrl": "http://127.0.0.1:9/v1", "modelId": "gpt-4.1-mini", "apiKey": "[redacted]"
        }))
        .expect("openai-compatible entry should resolve");
        assert_eq!(resolved.provider, "openai");
        assert_eq!(resolved.base_url.as_deref(), Some("http://127.0.0.1:9/v1"));
        assert_eq!(
            resolved.api_key, None,
            "redaction placeholder must not be reused as a key"
        );
    }

    /// legacy 条目：provider 字段原样保留，inline apiKey 原样解析。
    #[test]
    fn legacy_entry_keeps_provider_and_inline_key() {
        let resolved = pi_provider_from_entry(&json!({
            "provider": "anthropic", "label": "Anthropic",
            "modelId": "claude-sonnet-4", "apiKey": "sk-ant-live"
        }))
        .expect("legacy entry should resolve");
        assert_eq!(resolved.provider, "anthropic");
        assert_eq!(resolved.api_key.as_deref(), Some("sk-ant-live"));
        assert_eq!(resolved.api_key_source, Some("inline"));
    }
}
