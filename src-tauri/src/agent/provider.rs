//! Agent provider 探测与配置解析（从 lib.rs 迁入，modularity Phase 4）：候选构建
//! （settings/env/builtin）、命令预览（redaction/keyRef）、readiness 缓存（本模块私有）、
//! 健康检查与静态模型清单。纯函数部分带 golden 测试；子进程探测与 1500ms 超时循环属副作用。

use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::{AgentDetectCandidate, AgentProviderReadiness, ClipboardAgentToolDescriptor};
use crate::read_user_settings;

static AGENT_READINESS_CACHE: std::sync::LazyLock<
    Arc<Mutex<HashMap<String, AgentProviderReadiness>>>,
> = std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

fn agent_readiness_cache() -> Arc<Mutex<HashMap<String, AgentProviderReadiness>>> {
    AGENT_READINESS_CACHE.clone()
}

// ==== 以下函数体自 lib.rs 迁入（agent 域 provider 解析层），行为零变化 ====

pub(crate) fn agent_tool_descriptors() -> Vec<ClipboardAgentToolDescriptor> {
    vec![
        ClipboardAgentToolDescriptor {
            name: "clipboard.context.get".to_string(),
            description: "读取当前或指定剪贴板条目的安全上下文快照".to_string(),
            permission: "read-summary".to_string(),
            write: false,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.context.compose".to_string(),
            description: "按当前、选中、收藏、搜索结果或最近历史组合上下文集合".to_string(),
            permission: "read-summary".to_string(),
            write: false,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.content.parse".to_string(),
            description: "解析 URL、文件路径、JSON、命令、代码块、错误日志和 Markdown 候选"
                .to_string(),
            permission: "read-summary".to_string(),
            write: false,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.capture".to_string(),
            description: "显式写入一条新的 ClipForge 历史".to_string(),
            permission: "confirm-write".to_string(),
            write: true,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.update".to_string(),
            description: "通过可见结果动作更新内容、标签、收藏、归档等字段".to_string(),
            permission: "confirm-write".to_string(),
            write: true,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.copy".to_string(),
            description: "按统一多类型写回接口复制剪贴板条目".to_string(),
            permission: "confirm-write".to_string(),
            write: true,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.search".to_string(),
            description: "使用文本、tag、type、kind、bucket、favorite、file extension 检索"
                .to_string(),
            permission: "read-summary".to_string(),
            write: false,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.skill.list".to_string(),
            description: "列出私域剪贴板 skill 摘要".to_string(),
            permission: "read-summary".to_string(),
            write: false,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.skill.save_draft".to_string(),
            description: "保存用户确认后的私域 skill 草稿".to_string(),
            permission: "confirm-write".to_string(),
            write: true,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.skill.run".to_string(),
            description: "用当前上下文集合手动运行私域 skill".to_string(),
            permission: "read-summary".to_string(),
            write: false,
        },
    ]
}

pub(super) fn split_agent_command_template(template: &str) -> Option<(String, Vec<String>)> {
    let parts = template
        .split_whitespace()
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let (command, args) = parts.split_first()?;
    Some((command.clone(), args.to_vec()))
}

pub(crate) fn agent_path_env() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    #[cfg(target_os = "macos")]
    {
        let gui_paths = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
            "/Applications/Cursor.app/Contents/Resources/app/bin",
            "/Applications/Visual Studio Code.app/Contents/Resources/app/bin",
        ];
        return format!("{}:{}", gui_paths.join(":"), current);
    }
    #[cfg(not(target_os = "macos"))]
    {
        current
    }
}

fn value_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn value_bool(value: &Value, key: &str, default: bool) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(default)
}

fn value_string_array(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn configured_default_agent_provider_id() -> Option<String> {
    let settings = read_user_settings().ok()?.settings;
    settings
        .get("agent")
        .and_then(|agent| {
            value_string(
                agent,
                &[
                    "defaultProviderId",
                    "default_provider_id",
                    "defaultAgentId",
                    "default_agent_id",
                ],
            )
        })
        .or_else(|| {
            value_string(
                &settings,
                &[
                    "defaultProviderId",
                    "default_provider_id",
                    "defaultAgentId",
                    "default_agent_id",
                ],
            )
        })
}

pub(super) fn configured_agent_providers_from_settings() -> Vec<AgentDetectCandidate> {
    let settings = read_user_settings()
        .map(|payload| payload.settings)
        .unwrap_or(Value::Null);
    let providers = settings
        .get("agent")
        .and_then(|agent| agent.get("providers"))
        .and_then(Value::as_array)
        .or_else(|| settings.get("agentProviders").and_then(Value::as_array));
    let Some(providers) = providers else {
        return Vec::new();
    };
    providers
        .iter()
        .enumerate()
        .filter_map(|(index, provider)| {
            if !provider.is_object() || !value_bool(provider, "enabled", true) {
                return None;
            }
            let kind = value_string(provider, &["kind"])
                .unwrap_or_else(|| "openai-compatible".to_string());
            let fallback_id = format!("settings-agent-{index}");
            let provider_id = value_string(provider, &["id"]).unwrap_or(fallback_id);
            let label =
                value_string(provider, &["label", "name"]).unwrap_or_else(|| provider_id.clone());
            if kind == "openai-compatible" || kind == "openapi" || kind == "openai" {
                let base_url = value_string(provider, &["baseUrl", "baseURL", "endpoint"])
                    .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
                let model_id = value_string(provider, &["modelId", "model"]);
                let api_key = value_string(provider, &["apiKey"]);
                let api_key_ref = value_string(provider, &["apiKeyEnv", "apiKeyRef"])
                    .or_else(|| Some("CLIPFORGE_AGENT_OPENAI_API_KEY".to_string()));
                let configured = model_id.is_some()
                    && (api_key.is_some()
                        || api_key_ref
                            .as_deref()
                            .and_then(|key| std::env::var(key).ok())
                            .map(|value| !value.trim().is_empty())
                            .unwrap_or(false));
                return Some(AgentDetectCandidate {
                    provider_id,
                    label,
                    kind: "openai-compatible".to_string(),
                    command: "python3".to_string(),
                    args: vec![
                        "-u".to_string(),
                        "-c".to_string(),
                        "<openai-compatible-stream-bridge>".to_string(),
                    ],
                    configured,
                    base_url: Some(base_url),
                    api_key,
                    api_key_ref,
                    model_id,
                    timeout_seconds: provider.get("timeoutSeconds").and_then(Value::as_u64),
                });
            }
            if kind == "local-cli" || kind == "cli" || kind == "local-cli-configured" {
                let command = value_string(provider, &["command"])?;
                return Some(local_agent_candidate(
                    &provider_id,
                    &label,
                    &command,
                    value_string_array(provider, "args"),
                    true,
                ));
            }
            None
        })
        .collect()
}

pub(crate) fn agent_detect_candidates() -> Vec<AgentDetectCandidate> {
    let mut candidates = Vec::new();
    candidates.extend(configured_agent_providers_from_settings());
    if let Ok(template) = std::env::var("CLIPFORGE_AGENT_COMMAND") {
        if let Some((command, args)) = split_agent_command_template(&template) {
            candidates.push(local_agent_candidate(
                "local-configured",
                "Configured local command",
                &command,
                args,
                true,
            ));
        }
    }
    candidates.extend([
        local_agent_candidate("claude-cli", "Claude CLI", "claude", Vec::new(), false),
        local_agent_candidate("codex-cli", "Codex CLI", "codex", Vec::new(), false),
        local_agent_candidate("qwen-cli", "Qwen CLI", "qwen", Vec::new(), false),
    ]);
    candidates.push(openai_compatible_agent_candidate());
    candidates
}

fn local_agent_candidate(
    provider_id: &str,
    label: &str,
    command: &str,
    args: Vec<String>,
    configured: bool,
) -> AgentDetectCandidate {
    AgentDetectCandidate {
        provider_id: provider_id.to_string(),
        label: label.to_string(),
        kind: if configured {
            "local-cli-configured"
        } else {
            "local-cli"
        }
        .to_string(),
        command: command.to_string(),
        args,
        configured,
        base_url: None,
        api_key: None,
        api_key_ref: None,
        model_id: None,
        timeout_seconds: None,
    }
}

fn openai_compatible_agent_candidate() -> AgentDetectCandidate {
    let base_url = std::env::var("CLIPFORGE_AGENT_OPENAI_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let model_id = std::env::var("CLIPFORGE_AGENT_OPENAI_MODEL")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let api_key_ref = "CLIPFORGE_AGENT_OPENAI_API_KEY".to_string();
    let configured = model_id.is_some()
        && std::env::var(&api_key_ref)
            .ok()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);
    AgentDetectCandidate {
        provider_id: "openai-compatible".to_string(),
        label: "OpenAI-compatible".to_string(),
        kind: "openai-compatible".to_string(),
        command: "python3".to_string(),
        args: vec![
            "-u".to_string(),
            "-c".to_string(),
            "<openai-compatible-stream-bridge>".to_string(),
        ],
        configured,
        base_url: Some(base_url),
        api_key: None,
        api_key_ref: Some(api_key_ref),
        model_id,
        timeout_seconds: None,
    }
}

pub(crate) fn shell_escape_word(value: &str) -> String {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/'))
    {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

pub(crate) fn command_preview(candidate: &AgentDetectCandidate) -> String {
    if candidate.kind == "openai-compatible" {
        return format!(
            "OpenAI-compatible streamText model={} baseURL={} apiKeyRef={}",
            candidate.model_id.as_deref().unwrap_or("not-configured"),
            candidate.base_url.as_deref().unwrap_or("not-configured"),
            candidate.api_key_ref.as_deref().unwrap_or("not-configured")
        );
    }
    if candidate.args.is_empty() {
        candidate.command.clone()
    } else {
        format!("{} {}", candidate.command, candidate.args.join(" "))
    }
}

pub(super) fn cached_agent_readiness(provider_id: &str) -> Option<AgentProviderReadiness> {
    agent_readiness_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.get(provider_id).cloned())
}

pub(super) fn cache_agent_readiness(readiness: AgentProviderReadiness) -> AgentProviderReadiness {
    if let Ok(mut cache) = agent_readiness_cache().lock() {
        cache.insert(readiness.provider_id.clone(), readiness.clone());
    }
    readiness
}

pub(crate) fn agent_candidate_by_id(provider_id: Option<&str>) -> Option<AgentDetectCandidate> {
    let candidates = agent_detect_candidates();
    if let Some(provider_id) = provider_id {
        candidates
            .iter()
            .find(|candidate| candidate.provider_id == provider_id)
            .cloned()
            .or_else(|| candidates.first().cloned())
    } else {
        candidates.first().cloned()
    }
}
#[cfg(test)]
mod golden_tests {
    use super::*;

    fn local_candidate(command: &str, args: Vec<&str>) -> AgentDetectCandidate {
        AgentDetectCandidate {
            provider_id: "test-local".to_string(),
            label: "Test".to_string(),
            kind: "local-cli-configured".to_string(),
            command: command.to_string(),
            args: args.into_iter().map(ToString::to_string).collect(),
            configured: true,
            base_url: None,
            api_key: None,
            api_key_ref: None,
            model_id: None,
            timeout_seconds: None,
        }
    }

    fn openai_candidate(model: Option<&str>, api_key_ref: Option<&str>) -> AgentDetectCandidate {
        AgentDetectCandidate {
            provider_id: "openai-compatible".to_string(),
            label: "OpenAI-compatible".to_string(),
            kind: "openai-compatible".to_string(),
            command: "python3".to_string(),
            args: vec!["-u".to_string(), "-c".to_string()],
            configured: false,
            base_url: Some("https://api.example.com/v1".to_string()),
            api_key: None,
            api_key_ref: api_key_ref.map(ToString::to_string),
            model_id: model.map(ToString::to_string),
            timeout_seconds: Some(60),
        }
    }

    /// redaction 契约：openai-compatible 预览只暴露 model/baseURL/apiKeyRef，绝不出现内联 key。
    #[test]
    fn command_preview_redacts_openai_credentials() {
        let preview = command_preview(&openai_candidate(
            Some("gpt-4.1-mini"),
            Some("CLIPFORGE_AGENT_OPENAI_API_KEY"),
        ));
        assert!(preview.contains("model=gpt-4.1-mini"));
        assert!(preview.contains("baseURL=https://api.example.com/v1"));
        assert!(preview.contains("apiKeyRef=CLIPFORGE_AGENT_OPENAI_API_KEY"));
        assert!(!preview.contains("sk-"));
    }

    #[test]
    fn command_preview_falls_back_to_not_configured() {
        let mut candidate = openai_candidate(None, None);
        candidate.base_url = None;
        let preview = command_preview(&candidate);
        assert!(preview.contains("model=not-configured"));
        assert!(preview.contains("baseURL=not-configured"));
        assert!(preview.contains("apiKeyRef=not-configured"));
    }

    #[test]
    fn command_preview_joins_local_command_and_args() {
        assert_eq!(
            command_preview(&local_candidate("claude", vec!["--print"])),
            "claude --print"
        );
        assert_eq!(
            command_preview(&local_candidate("claude", vec![])),
            "claude"
        );
    }

    #[test]
    fn split_agent_command_template_is_stable() {
        assert_eq!(
            split_agent_command_template("  claude   --print  "),
            Some(("claude".to_string(), vec!["--print".to_string()]))
        );
        assert_eq!(split_agent_command_template("   "), None);
    }
}
