//! Agent provider 健康检查层（从 lib.rs 迁入，modularity Phase 4）：子进程探测
//! （sh -lc + 1500ms 超时）、静态 openai-compatible 模型清单、shell 转义与
//! readiness 聚合（provider_configs_with_readiness）。副作用集中在 check_agent_candidate
//! 的子进程探测；其余为纯函数并带 golden 用例。

use serde_json::json;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use super::provider::{
    agent_detect_candidates, agent_path_env, cache_agent_readiness, cached_agent_readiness,
    command_preview, shell_escape_word,
};
use super::{
    AgentDetectCandidate, AgentProviderModelsPayload, AgentProviderReadiness,
    ClipboardAgentProviderConfig,
};
use crate::now_millis;

pub(crate) fn check_agent_candidate(candidate: &AgentDetectCandidate) -> AgentProviderReadiness {
    let checked_at = now_millis().unwrap_or(0);
    if candidate.kind == "openai-compatible" {
        let missing_key = candidate
            .api_key
            .as_deref()
            .map(str::trim)
            .map(str::is_empty)
            .unwrap_or_else(|| {
                candidate
                    .api_key_ref
                    .as_deref()
                    .and_then(|key| std::env::var(key).ok())
                    .map(|value| value.trim().is_empty())
                    .unwrap_or(true)
            });
        if missing_key || candidate.model_id.is_none() {
            return cache_agent_readiness(AgentProviderReadiness {
                provider_id: candidate.provider_id.clone(),
                status: "not-configured".to_string(),
                reason: "configure modelId plus apiKey or apiKeyEnv in settings.json5 to enable OpenAI-compatible provider".to_string(),
                checked_at,
                command_preview: command_preview(candidate),
            });
        }
        let bridge_ready = Command::new("sh")
            .arg("-lc")
            .arg("command -v python3")
            .env("PATH", agent_path_env())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        return cache_agent_readiness(AgentProviderReadiness {
            provider_id: candidate.provider_id.clone(),
            status: if bridge_ready { "ready" } else { "not-found" }.to_string(),
            reason: if bridge_ready {
                "OpenAI-compatible config is present; runtime bridge is available"
            } else {
                "python3 bridge runtime is not available in merged PATH"
            }
            .to_string(),
            checked_at,
            command_preview: command_preview(candidate),
        });
    }
    let path = agent_path_env();
    let mut child = match Command::new("sh")
        .arg("-lc")
        .arg(format!(
            "command -v {}",
            shell_escape_word(&candidate.command)
        ))
        .env("PATH", path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            return cache_agent_readiness(AgentProviderReadiness {
                provider_id: candidate.provider_id.clone(),
                status: "health-timeout".to_string(),
                reason: error.to_string(),
                checked_at,
                command_preview: command_preview(candidate),
            });
        }
    };
    let started = std::time::Instant::now();
    let status_result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if started.elapsed() >= Duration::from_millis(1500) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("provider detect exceeded 1500ms".to_string());
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(error) => break Err(error.to_string()),
        }
    };
    let (status, reason): (String, String) = match status_result {
        Ok(status) if status.success() => {
            ("ready".to_string(), "command found in PATH".to_string())
        }
        Ok(status) if status.code() == Some(126) => (
            "permission-denied".to_string(),
            "command exists but is not executable".to_string(),
        ),
        Ok(_) if candidate.configured => (
            "not-found".to_string(),
            "configured command is not available in merged PATH".to_string(),
        ),
        Ok(_) => (
            "not-configured".to_string(),
            "candidate command is not available in merged PATH".to_string(),
        ),
        Err(error) => ("health-timeout".to_string(), error),
    };
    cache_agent_readiness(AgentProviderReadiness {
        provider_id: candidate.provider_id.clone(),
        status,
        reason,
        checked_at,
        command_preview: command_preview(candidate),
    })
}

pub(crate) fn check_openai_compatible_models(
    candidate: &AgentDetectCandidate,
) -> AgentProviderModelsPayload {
    if candidate.kind != "openai-compatible" {
        return AgentProviderModelsPayload {
            provider_id: candidate.provider_id.clone(),
            active_model_id: candidate.model_id.clone(),
            models: Vec::new(),
            source: "unsupported-provider".to_string(),
            message: "Model listing is only available for OpenAI-compatible providers".to_string(),
        };
    }

    let mut models = Vec::new();
    if let Some(model_id) = candidate.model_id.as_deref() {
        models.push(model_id.to_string());
    }
    models.extend(
        [
            "gpt-4.1-mini",
            "gpt-4.1",
            "gpt-4o-mini",
            "gpt-4o",
            "o4-mini",
            "o3-mini",
        ]
        .iter()
        .map(|model| model.to_string()),
    );
    models.sort();
    models.dedup();

    AgentProviderModelsPayload {
        provider_id: candidate.provider_id.clone(),
        active_model_id: candidate.model_id.clone(),
        models,
        source: "static-openai-compatible".to_string(),
        message: "Static model suggestions; edit settings.json5 to use a custom modelId"
            .to_string(),
    }
}

pub(crate) fn provider_configs_with_readiness(check: bool) -> Vec<ClipboardAgentProviderConfig> {
    agent_detect_candidates()
        .into_iter()
        .map(|candidate| {
            let last_readiness = if check {
                Some(check_agent_candidate(&candidate))
            } else {
                cached_agent_readiness(&candidate.provider_id)
            };
            ClipboardAgentProviderConfig {
                id: candidate.provider_id.clone(),
                label: candidate.label.clone(),
                kind: candidate.kind.clone(),
                configured: candidate.configured,
                command_preview: command_preview(&candidate),
                redacted_config: if candidate.kind == "openai-compatible" {
                    json!({
                        "protocol": "openai-compatible",
                        "baseURL": candidate.base_url.as_deref().unwrap_or("not-configured"),
                        "apiKeyRef": candidate.api_key_ref.as_deref().unwrap_or("not-configured"),
                        "apiKey": "not-sent-to-react",
                        "hasInlineApiKey": candidate.api_key.as_deref().map(|value| !value.trim().is_empty()).unwrap_or(false),
                        "modelId": candidate.model_id.as_deref().unwrap_or("not-configured"),
                        "timeoutSeconds": candidate.timeout_seconds.unwrap_or(120)
                    })
                } else {
                    json!({
                        "command": candidate.command,
                        "argsCount": candidate.args.len(),
                        "apiKey": "not-sent-to-react",
                        "baseURL": "not-sent-to-react"
                    })
                },
                last_readiness,
            }
        })
        .collect()
}

#[cfg(test)]
mod golden_tests {
    use super::*;

    #[test]
    fn shell_escape_word_quotes_metacharacters() {
        assert_eq!(shell_escape_word("plain-cmd_1.0/x"), "plain-cmd_1.0/x");
        assert_eq!(shell_escape_word("echo 'hi'"), "'echo '\\''hi'\\'''");
    }

    /// keyRef 路径：非 openai-compatible provider 的模型清单固定 unsupported-provider。
    #[test]
    fn openai_models_reject_non_openai_provider() {
        let candidate = AgentDetectCandidate {
            provider_id: "claude-cli".to_string(),
            label: "Claude CLI".to_string(),
            kind: "local-cli".to_string(),
            command: "claude".to_string(),
            args: Vec::new(),
            configured: false,
            base_url: None,
            api_key: None,
            api_key_ref: None,
            model_id: None,
            timeout_seconds: None,
        };
        let payload = check_openai_compatible_models(&candidate);
        assert_eq!(payload.source, "unsupported-provider");
        assert!(payload.models.is_empty());
    }
}
