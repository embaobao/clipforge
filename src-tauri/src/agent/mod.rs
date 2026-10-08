//! Agent 域门面（从 lib.rs 迁入，modularity Phase 4）：payload 结构体、状态枚举与十一个
//! agent_* Tauri 命令薄壳。业务实现下沉到 provider.rs（探测/校验/模型）、context.rs（上下文/
//! prompt 组装）、events.rs（事件/输出流）与 run.rs（运行状态机）；命令函数只做参数解包与
//! 错误映射，settings_service 经 `crate::agent::` 复用，不再直引 lib.rs 私有符号。

pub mod check;
pub mod context;
pub mod events;
pub mod pi;
pub mod provider;
pub mod run;
mod runs;

pub use pi::agent_resolve_pi_provider;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::process::Child;

pub(crate) use check::{
    check_agent_candidate, check_openai_compatible_models, provider_configs_with_readiness,
};
pub(crate) use context::{agent_trace_id, compact_agent_text};
pub(crate) use provider::{
    agent_candidate_by_id, agent_detect_candidates, agent_tool_descriptors,
    configured_default_agent_provider_id,
};
pub(crate) use run::agent_prepare_run_impl;
pub(crate) use runs::cleanup_agent_children;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClipboardAgentProviderConfig {
    id: String,
    label: String,
    kind: String,
    configured: bool,
    command_preview: String,
    redacted_config: Value,
    last_readiness: Option<AgentProviderReadiness>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClipboardAgentToolDescriptor {
    name: String,
    description: String,
    permission: String,
    write: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentProviderReadiness {
    provider_id: String,
    status: String,
    reason: String,
    checked_at: i64,
    command_preview: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentDetectCandidate {
    provider_id: String,
    label: String,
    kind: String,
    command: String,
    args: Vec<String>,
    configured: bool,
    base_url: Option<String>,
    api_key: Option<String>,
    api_key_ref: Option<String>,
    model_id: Option<String>,
    timeout_seconds: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentConfigPayload {
    pub(crate) active_provider_id: Option<String>,
    pub(crate) providers: Vec<ClipboardAgentProviderConfig>,
    pub(crate) tools: Vec<ClipboardAgentToolDescriptor>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentProviderModelsPayload {
    provider_id: String,
    active_model_id: Option<String>,
    models: Vec<String>,
    source: String,
    message: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentInvocationConfig {
    pub(crate) provider_id: Option<String>,
    pub(crate) prompt: String,
    pub(crate) context_set: Value,
    pub(crate) allow_full_content: Option<bool>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentStartRunInput {
    run_id: Option<String>,
    provider_id: Option<String>,
    prompt: String,
    context_set: Value,
    confirmed: Option<bool>,
    allow_full_content: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentRunPayload {
    id: String,
    conversation_id: String,
    provider_id: String,
    status: String,
    prompt_preview: String,
    command_preview: String,
    context_summary: String,
    output: String,
    error_code: Option<String>,
    error_message: Option<String>,
    exit_code: Option<i32>,
    created_at: i64,
    updated_at: i64,
    started_at: Option<i64>,
    finished_at: Option<i64>,
    duration_ms: Option<i64>,
}

#[derive(Clone, Copy)]
pub(crate) enum AgentRunStatus {
    Idle,
    Preparing,
    WaitingConfirmation,
    Running,
    Streaming,
    Succeeded,
    Failed,
    Cancelling,
    Cancelled,
}

impl AgentRunStatus {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            AgentRunStatus::Idle => "idle",
            AgentRunStatus::Preparing => "preparing",
            AgentRunStatus::WaitingConfirmation => "waiting_confirmation",
            AgentRunStatus::Running => "running",
            AgentRunStatus::Streaming => "streaming",
            AgentRunStatus::Succeeded => "succeeded",
            AgentRunStatus::Failed => "failed",
            AgentRunStatus::Cancelling => "cancelling",
            AgentRunStatus::Cancelled => "cancelled",
        }
    }

    pub(super) fn is_active(self) -> bool {
        matches!(
            self,
            AgentRunStatus::Preparing
                | AgentRunStatus::WaitingConfirmation
                | AgentRunStatus::Running
                | AgentRunStatus::Streaming
                | AgentRunStatus::Cancelling
        )
    }
}

pub(super) fn agent_status_from_str(status: &str) -> Option<AgentRunStatus> {
    match status {
        "idle" => Some(AgentRunStatus::Idle),
        "preparing" => Some(AgentRunStatus::Preparing),
        "waiting_confirmation" => Some(AgentRunStatus::WaitingConfirmation),
        "running" => Some(AgentRunStatus::Running),
        "streaming" => Some(AgentRunStatus::Streaming),
        "succeeded" => Some(AgentRunStatus::Succeeded),
        "failed" => Some(AgentRunStatus::Failed),
        "cancelling" => Some(AgentRunStatus::Cancelling),
        "cancelled" => Some(AgentRunStatus::Cancelled),
        _ => None,
    }
}

pub(super) fn agent_status(status: AgentRunStatus) -> String {
    status.as_str().to_string()
}

pub(super) fn set_agent_run_status(
    payload: &mut AgentRunPayload,
    status: AgentRunStatus,
    now: i64,
) {
    payload.status = agent_status(status);
    payload.updated_at = now;
    if matches!(
        status,
        AgentRunStatus::Succeeded | AgentRunStatus::Failed | AgentRunStatus::Cancelled
    ) {
        payload.finished_at = Some(now);
        payload.duration_ms = payload.started_at.map(|started| now - started);
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentPreparedRunPayload {
    pub(crate) run: AgentRunPayload,
    pub(crate) requires_confirmation: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentTranscriptRowPayload {
    id: String,
    run_id: String,
    kind: String,
    text: String,
    scroll_anchor: bool,
    created_at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentUiMessagePayload {
    run_id: String,
    message_id: String,
    role: String,
    parts: Value,
    metadata: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentAgUiEventPayload {
    run_id: String,
    message_id: String,
    event_type: String,
    role: String,
    text: Option<String>,
    status: Option<String>,
    tool_name: Option<String>,
    arguments_preview: Option<String>,
    result_preview: Option<String>,
    custom_event: Option<String>,
    custom_payload: Option<Value>,
    created_at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentRunSnapshotPayload {
    run: AgentRunPayload,
    transcript: Vec<AgentTranscriptRowPayload>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentSessionSnapshotPayload {
    runs: Vec<AgentRunSnapshotPayload>,
    active_run_id: Option<String>,
    restored_at: i64,
}

pub(crate) struct AgentRunState {
    payload: AgentRunPayload,
    transcript: Vec<AgentTranscriptRowPayload>,
    child: Option<Child>,
    foreground_clip_id: Option<String>,
}

pub(super) fn is_active_agent_status(status: &str) -> bool {
    agent_status_from_str(status).is_some_and(AgentRunStatus::is_active)
}

/// settings_service 侧的 agent 配置解析入口（保留原符号名，Phase 4 起 live 在 agent 模块）。
pub fn settings_service_resolve_agent_config() -> Result<AgentConfigPayload, String> {
    let providers = provider_configs_with_readiness(false);
    let default_provider_id = configured_default_agent_provider_id();
    let active_provider_id = default_provider_id
        .as_deref()
        .and_then(|default_id| providers.iter().find(|provider| provider.id == default_id))
        .or_else(|| providers.iter().find(|provider| provider.configured))
        .or_else(|| providers.first())
        .map(|provider| provider.id.clone());
    Ok(AgentConfigPayload {
        active_provider_id,
        providers,
        tools: agent_tool_descriptors(),
    })
}

#[tauri::command]
pub fn agent_get_config() -> Result<AgentConfigPayload, String> {
    settings_service_resolve_agent_config()
}

#[tauri::command]
pub fn agent_list_providers() -> Result<Vec<ClipboardAgentProviderConfig>, String> {
    Ok(provider_configs_with_readiness(false))
}

#[tauri::command]
pub fn agent_check_provider(provider_id: Option<String>) -> Result<AgentProviderReadiness, String> {
    let candidate = agent_candidate_by_id(provider_id.as_deref())
        .ok_or_else(|| "AGENT_PROVIDER_NOT_CONFIGURED".to_string())?;
    Ok(check_agent_candidate(&candidate))
}

#[tauri::command]
pub fn agent_list_provider_models(
    provider_id: Option<String>,
) -> Result<AgentProviderModelsPayload, String> {
    let candidate = agent_candidate_by_id(provider_id.as_deref())
        .ok_or_else(|| "AGENT_PROVIDER_NOT_CONFIGURED".to_string())?;
    Ok(check_openai_compatible_models(&candidate))
}

#[tauri::command]
pub fn agent_detect() -> Result<Vec<AgentProviderReadiness>, String> {
    Ok(agent_detect_candidates()
        .iter()
        .map(check_agent_candidate)
        .collect())
}

#[tauri::command]
pub fn agent_prepare_run(input: AgentInvocationConfig) -> Result<AgentPreparedRunPayload, String> {
    run::agent_prepare_run_impl(input)
}

#[tauri::command]
pub fn agent_start_run<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: AgentStartRunInput,
) -> Result<AgentRunPayload, String> {
    run::agent_start_run_impl(app, input)
}

#[tauri::command]
pub fn agent_cancel_run(run_id: String) -> Result<AgentRunPayload, String> {
    run::agent_cancel_run_impl(run_id)
}

#[tauri::command]
pub fn agent_get_run(run_id: String) -> Result<AgentRunPayload, String> {
    run::agent_get_run_impl(run_id)
}

#[tauri::command]
pub fn agent_get_transcript(run_id: String) -> Result<Vec<AgentTranscriptRowPayload>, String> {
    run::agent_get_transcript_impl(run_id)
}

#[tauri::command]
pub fn agent_restore_session() -> Result<AgentSessionSnapshotPayload, String> {
    run::agent_restore_session_impl()
}
