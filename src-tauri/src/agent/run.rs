//! Agent run 状态机（从 lib.rs 迁入，modularity Phase 4）：run 存储 + 私有锁（poisoned→错误
//! + 进程级降级，模式同 settings_service/write.rs）、prepare/start/cancel/get/transcript/restore
//! 实现、80ms wait 轮询、cleanup_agent_children 与输出缓冲。stdin/双 reader/事件时序逐字节保留；
//! 唯一行为变化：锁 poisoned 错误串改为 AGENT_RUNS_LOCK_POISONED / AGENT_RUNS_DEGRADED。

use serde_json::{json, Value};
use std::io::Write;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use tauri::Emitter;

use super::check::check_agent_candidate;
use super::context::{
    agent_context_foreground_clip_id, agent_trace_id, build_agent_run_payload, compose_agent_prompt,
};
use super::events::{
    emit_agent_ui_message, insert_agent_transcript, log_agent_event,
    openai_compatible_bridge_script, spawn_agent_output_reader, AgentOutputMode,
};
use super::provider::{agent_candidate_by_id, agent_path_env};
use super::runs::{acquire_agent_runs_lock, mark_agent_runs_degraded, AGENT_RUNS};
use super::{
    is_active_agent_status, set_agent_run_status, AgentInvocationConfig, AgentPreparedRunPayload,
    AgentRunPayload, AgentRunSnapshotPayload, AgentRunState, AgentRunStatus,
    AgentSessionSnapshotPayload, AgentStartRunInput, AgentTranscriptRowPayload,
};
use crate::{log_to_file, now_millis};

pub(crate) fn agent_prepare_run_impl(
    input: AgentInvocationConfig,
) -> Result<AgentPreparedRunPayload, String> {
    let provider = agent_candidate_by_id(input.provider_id.as_deref())
        .ok_or_else(|| "AGENT_PROVIDER_NOT_CONFIGURED".to_string())?;
    let now = now_millis()?;
    let prompt = compose_agent_prompt(&input);
    let run_id = agent_trace_id("agent_run");
    let foreground_clip_id = agent_context_foreground_clip_id(&input.context_set);
    let payload = build_agent_run_payload(
        run_id.clone(),
        &provider,
        &prompt,
        &input.context_set,
        AgentRunStatus::WaitingConfirmation.as_str(),
        now,
        input.allow_full_content.unwrap_or(false),
    );
    let transcript = vec![
        insert_agent_transcript(&run_id, "run-marker", "prepared", true),
        insert_agent_transcript(&run_id, "user-message", &input.prompt, true),
    ];
    acquire_agent_runs_lock()?.insert(
        run_id,
        AgentRunState {
            payload: payload.clone(),
            transcript,
            child: None,
            foreground_clip_id,
        },
    );
    log_agent_event(
        "prepared",
        &payload,
        json!({ "referenceCount": input.context_set.get("references").and_then(Value::as_array).map(|items| items.len()).unwrap_or(0) }),
    );
    Ok(AgentPreparedRunPayload {
        run: payload,
        requires_confirmation: true,
    })
}

pub(crate) fn agent_start_run_impl<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: AgentStartRunInput,
) -> Result<AgentRunPayload, String> {
    if input.confirmed != Some(true) {
        return Err("AGENT_RUN_CONFIRMATION_REQUIRED".to_string());
    }
    let provider = agent_candidate_by_id(input.provider_id.as_deref())
        .ok_or_else(|| "AGENT_PROVIDER_NOT_CONFIGURED".to_string())?;
    let run_id = input.run_id.unwrap_or_else(|| agent_trace_id("agent_run"));
    let foreground_clip_id = agent_context_foreground_clip_id(&input.context_set);
    if let Some(clip_id) = foreground_clip_id.as_deref() {
        let runs = acquire_agent_runs_lock()?;
        for state in runs.values() {
            if state.foreground_clip_id.as_deref() != Some(clip_id) {
                continue;
            }
            if state.payload.id == run_id && state.child.is_none() {
                continue;
            }
            if state.payload.id == run_id && state.child.is_some() {
                return Ok(state.payload.clone());
            }
            if state.child.is_some() || is_active_agent_status(&state.payload.status) {
                return Err(format!("AGENT_FOREGROUND_RUN_EXISTS:{}", state.payload.id));
            }
        }
    }
    let readiness = check_agent_candidate(&provider);
    if readiness.status != "ready" {
        let now = now_millis()?;
        let mut payload = build_agent_run_payload(
            run_id.clone(),
            &provider,
            &input.prompt,
            &input.context_set,
            AgentRunStatus::Failed.as_str(),
            now,
            input.allow_full_content.unwrap_or(false),
        );
        payload.error_code = Some(readiness.status.clone());
        payload.error_message = Some(readiness.reason.clone());
        set_agent_run_status(&mut payload, AgentRunStatus::Failed, now);
        acquire_agent_runs_lock()?.insert(
            run_id.clone(),
            AgentRunState {
                payload: payload.clone(),
                transcript: vec![insert_agent_transcript(
                    &run_id,
                    "run-error",
                    &readiness.reason,
                    true,
                )],
                child: None,
                foreground_clip_id,
            },
        );
        log_agent_event(
            "provider-unavailable",
            &payload,
            json!({ "readinessStatus": readiness.status }),
        );
        emit_agent_ui_message(
            &app,
            &run_id,
            "assistant",
            &readiness.reason,
            Some("failed"),
        );
        let _ = app.emit("agent_run_error", &payload);
        return Ok(payload);
    }

    let invocation = AgentInvocationConfig {
        provider_id: Some(provider.provider_id.clone()),
        prompt: input.prompt.clone(),
        context_set: input.context_set.clone(),
        allow_full_content: input.allow_full_content,
    };
    let prompt = compose_agent_prompt(&invocation);
    let now = now_millis()?;
    let output_mode = if provider.kind == "openai-compatible" {
        AgentOutputMode::StandardJsonEvents
    } else {
        AgentOutputMode::PlainText
    };
    let mut command = if provider.kind == "openai-compatible" {
        let mut command = Command::new("python3");
        command.args(["-u", "-c", openai_compatible_bridge_script()]);
        command
    } else {
        let mut command = Command::new(&provider.command);
        command.args(&provider.args);
        command
    };
    command
        .env("PATH", agent_path_env())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("AGENT_SPAWN_FAILED: {error}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        if provider.kind == "openai-compatible" {
            let bridge_input = json!({
                "prompt": prompt.clone(),
                "baseUrl": provider.base_url.as_deref().unwrap_or("https://api.openai.com/v1"),
                "apiKey": provider.api_key.as_deref().unwrap_or(""),
                "apiKeyEnv": provider.api_key_ref.as_deref().unwrap_or("CLIPFORGE_AGENT_OPENAI_API_KEY"),
                "modelId": provider.model_id.as_deref().unwrap_or(""),
                "timeoutSeconds": provider.timeout_seconds.unwrap_or(120),
            });
            stdin
                .write_all(bridge_input.to_string().as_bytes())
                .map_err(|error| format!("AGENT_STDIN_FAILED: {error}"))?;
        } else {
            stdin
                .write_all(prompt.as_bytes())
                .map_err(|error| format!("AGENT_STDIN_FAILED: {error}"))?;
        }
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut payload = build_agent_run_payload(
        run_id.clone(),
        &provider,
        &prompt,
        &input.context_set,
        AgentRunStatus::Streaming.as_str(),
        now,
        input.allow_full_content.unwrap_or(false),
    );
    payload.started_at = Some(now);
    set_agent_run_status(&mut payload, AgentRunStatus::Streaming, now);
    let transcript = vec![
        insert_agent_transcript(&run_id, "run-marker", "started", true),
        insert_agent_transcript(&run_id, "user-message", &input.prompt, true),
    ];
    acquire_agent_runs_lock()?.insert(
        run_id.clone(),
        AgentRunState {
            payload: payload.clone(),
            transcript,
            child: Some(child),
            foreground_clip_id,
        },
    );
    log_agent_event(
        "started",
        &payload,
        json!({ "allowFullContent": input.allow_full_content.unwrap_or(false) }),
    );
    let _ = app.emit("agent_run_started", &payload);
    emit_agent_ui_message(
        &app,
        &run_id,
        "assistant",
        &format!("正在运行: {}", payload.command_preview),
        Some("streaming"),
    );

    if let Some(stdout) = stdout {
        spawn_agent_output_reader(
            app.clone(),
            run_id.clone(),
            "stdout",
            stdout,
            false,
            output_mode,
        );
    }
    if let Some(stderr) = stderr {
        spawn_agent_output_reader(
            app.clone(),
            run_id.clone(),
            "stderr",
            stderr,
            true,
            AgentOutputMode::PlainText,
        );
    }

    let app_for_wait = app.clone();
    let run_id_for_wait = run_id.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(80));
        let maybe_finished = {
            let mut runs = match acquire_agent_runs_lock() {
                Ok(runs) => runs,
                Err(_) => return,
            };
            let Some(state) = runs.get_mut(&run_id_for_wait) else {
                return;
            };
            let Some(child) = state.child.as_mut() else {
                return;
            };
            match child.try_wait() {
                Ok(Some(status)) => {
                    let now = now_millis().unwrap_or(0);
                    state.child = None;
                    let next_status = if status.success() {
                        AgentRunStatus::Succeeded
                    } else {
                        AgentRunStatus::Failed
                    };
                    state.payload.exit_code = status.code();
                    set_agent_run_status(&mut state.payload, next_status, now);
                    if !status.success() {
                        state.payload.error_code = Some("AGENT_EXIT_FAILED".to_string());
                        state.payload.error_message =
                            Some(format!("provider exited with code {:?}", status.code()));
                    }
                    let row_text = format!(
                        "finished status={} exit={:?}",
                        state.payload.status,
                        status.code()
                    );
                    state.transcript.push(insert_agent_transcript(
                        &run_id_for_wait,
                        "run-marker",
                        &row_text,
                        true,
                    ));
                    Some(state.payload.clone())
                }
                Ok(None) => None,
                Err(error) => {
                    let now = now_millis().unwrap_or(0);
                    state.child = None;
                    state.payload.error_code = Some("AGENT_WAIT_FAILED".to_string());
                    state.payload.error_message = Some(error.to_string());
                    set_agent_run_status(&mut state.payload, AgentRunStatus::Failed, now);
                    Some(state.payload.clone())
                }
            }
        };
        if let Some(payload) = maybe_finished {
            log_agent_event("finished", &payload, json!({ "terminal": true }));
            emit_agent_ui_message(
                &app_for_wait,
                &payload.id,
                "assistant",
                if payload.output.is_empty() {
                    payload.error_message.as_deref().unwrap_or(&payload.status)
                } else {
                    &payload.output
                },
                Some(&payload.status),
            );
            if payload.status == "succeeded" {
                let _ = app_for_wait.emit("agent_run_finished", &payload);
            } else {
                let _ = app_for_wait.emit("agent_run_error", &payload);
            }
            let _ = app_for_wait.emit(
                "agent_transcript_rows",
                agent_get_transcript_impl(run_id_for_wait.clone()).unwrap_or_default(),
            );
            return;
        }
    });

    Ok(payload)
}

pub(crate) fn append_agent_output(run_id: &str, line: &str, stderr: bool) {
    let Ok(mut runs) = AGENT_RUNS.lock() else {
        mark_agent_runs_degraded();
        return;
    };
    let Some(state) = runs.get_mut(run_id) else {
        return;
    };
    if !state.payload.output.is_empty() {
        state.payload.output.push('\n');
    }
    state.payload.output.push_str(line);
    if state.payload.output.chars().count() > 60_000 {
        state.payload.output = state
            .payload
            .output
            .chars()
            .rev()
            .take(60_000)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
    }
    state.payload.updated_at = now_millis().unwrap_or(state.payload.updated_at);
    log_agent_event(
        "output-flush",
        &state.payload,
        json!({
            "stream": if stderr { "stderr" } else { "stdout" },
            "chunkLength": line.chars().count(),
        }),
    );
    state.transcript.push(insert_agent_transcript(
        run_id,
        if stderr {
            "stderr"
        } else {
            "assistant-message"
        },
        line,
        false,
    ));
}

pub(crate) fn agent_cancel_run_impl(run_id: String) -> Result<AgentRunPayload, String> {
    let now = now_millis()?;
    let mut runs = acquire_agent_runs_lock()?;
    let state = runs
        .get_mut(&run_id)
        .ok_or_else(|| "AGENT_RUN_NOT_FOUND".to_string())?;
    if state.child.is_some() {
        set_agent_run_status(&mut state.payload, AgentRunStatus::Cancelling, now);
    }
    if let Some(child) = state.child.as_mut() {
        let _ = child.kill();
    }
    state.child = None;
    set_agent_run_status(&mut state.payload, AgentRunStatus::Cancelled, now);
    state.transcript.push(insert_agent_transcript(
        &run_id,
        "run-marker",
        "cancelled",
        true,
    ));
    log_agent_event("cancelled", &state.payload, json!({ "terminal": true }));
    Ok(state.payload.clone())
}

pub(crate) fn agent_get_run_impl(run_id: String) -> Result<AgentRunPayload, String> {
    acquire_agent_runs_lock()?
        .get(&run_id)
        .map(|state| state.payload.clone())
        .ok_or_else(|| "AGENT_RUN_NOT_FOUND".to_string())
}

pub(crate) fn agent_get_transcript_impl(
    run_id: String,
) -> Result<Vec<AgentTranscriptRowPayload>, String> {
    acquire_agent_runs_lock()?
        .get(&run_id)
        .map(|state| state.transcript.clone())
        .ok_or_else(|| "AGENT_RUN_NOT_FOUND".to_string())
}

pub(crate) fn agent_restore_session_impl() -> Result<AgentSessionSnapshotPayload, String> {
    let runs = acquire_agent_runs_lock()?;
    let mut snapshots: Vec<AgentRunSnapshotPayload> = runs
        .values()
        .map(|state| AgentRunSnapshotPayload {
            run: state.payload.clone(),
            transcript: state.transcript.clone(),
        })
        .collect();
    snapshots.sort_by_key(|snapshot| snapshot.run.created_at);
    let active_run_id = snapshots
        .iter()
        .rev()
        .find(|snapshot| is_active_agent_status(&snapshot.run.status))
        .or_else(|| snapshots.last())
        .map(|snapshot| snapshot.run.id.clone());
    log_to_file(
        "info",
        "agent-runtime",
        &json!({
            "event": "restore-session",
            "runCount": snapshots.len(),
            "activeRunId": active_run_id.clone(),
            "redactedFields": ["prompt", "output", "contextSummary", "commandPreview", "transcriptText"],
        })
        .to_string(),
    );
    Ok(AgentSessionSnapshotPayload {
        runs: snapshots,
        active_run_id,
        restored_at: now_millis()?,
    })
}
