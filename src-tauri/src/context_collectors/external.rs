use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::context_collector_runtime::{redact_sensitive, run_json_command};

use super::{
    ExternalCollectorManifest, LoadedCollector, DEFAULT_TIMEOUT_MS, MAX_MANIFESTS,
    MAX_OUTPUT_BYTES,
};

pub(super) fn run_external_collector(collector: &LoadedCollector, input: &Value) -> Value {
    let timeout_ms = collector
        .manifest
        .timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(50, DEFAULT_TIMEOUT_MS);
    let max_output_bytes = collector
        .manifest
        .max_output_bytes
        .unwrap_or(MAX_OUTPUT_BYTES)
        .clamp(1024, MAX_OUTPUT_BYTES);
    let executable = match resolve_executable(collector) {
        Ok(path) => path,
        Err(error) => return json!({ "ok": false, "status": "invalid", "error": error }),
    };
    let input_json = match serde_json::to_vec(input) {
        Ok(value) => value,
        Err(error) => return json!({ "ok": false, "status": "invalid-input", "error": error.to_string() }),
    };
    let started = std::time::Instant::now();
    let output = match run_json_command(
        &executable,
        &collector.manifest.args,
        &input_json,
        Duration::from_millis(timeout_ms),
        max_output_bytes,
    ) {
        Ok(output) => output,
        Err(error) => return json!({ "ok": false, "status": "failed", "durationMs": started.elapsed().as_millis(), "error": error }),
    };
    let parsed = match serde_json::from_slice::<Value>(&output) {
        Ok(value) if value.is_object() => value,
        Ok(_) => return json!({ "ok": false, "status": "invalid-output", "error": "collector output must be a JSON object" }),
        Err(error) => return json!({ "ok": false, "status": "invalid-output", "error": format!("collector output is not JSON: {error}") }),
    };
    let mut redacted = Vec::new();
    let sanitized = redact_sensitive(parsed, "$".to_string(), &mut redacted);
    let validation = validate_collector_output(&sanitized);
    json!({
        "ok": true,
        "status": "ok",
        "collectorId": collector.manifest.id,
        "durationMs": started.elapsed().as_millis(),
        "output": sanitized,
        "validation": validation,
        "redactedFields": redacted,
    })
}

pub(super) fn load_external_collectors() -> Vec<Result<LoadedCollector, String>> {
    let Some(root) = collectors_directory() else {
        return vec![Err("collector directory unavailable: HOME is not set".to_string())];
    };
    let entries = match fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(error) => return vec![Err(format!("collector directory read failed: {error}"))],
    };
    let mut manifests = Vec::new();
    for entry in entries.flatten().take(MAX_MANIFESTS) {
        let entry_path = entry.path();
        let path = if entry_path.is_dir() {
            entry_path.join("collector.json")
        } else if entry_path.extension().and_then(|value| value.to_str()) == Some("json") {
            entry_path
        } else {
            continue;
        };
        if path.is_file() {
            manifests.push(load_manifest(&root, path));
        }
    }
    manifests
}

fn load_manifest(root: &Path, path: PathBuf) -> Result<LoadedCollector, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("collector root unavailable: {error}"))?;
    let manifest_path = path
        .canonicalize()
        .map_err(|error| format!("collector manifest unavailable: {error}"))?;
    if !manifest_path.starts_with(&root) {
        return Err(format!("collector manifest outside approved directory: {}", path.display()));
    }
    let raw = fs::read_to_string(&manifest_path).map_err(|error| format!("{}: {error}", path.display()))?;
    let manifest = serde_json::from_str::<ExternalCollectorManifest>(&raw)
        .map_err(|error| format!("{} invalid: {error}", path.display()))?;
    validate_manifest(&manifest)?;
    Ok(LoadedCollector { manifest, root, manifest_path })
}

fn validate_manifest(manifest: &ExternalCollectorManifest) -> Result<(), String> {
    if manifest.schema_version != 1
        || manifest.id.trim().is_empty()
        || manifest.name.trim().is_empty()
        || manifest.version.trim().is_empty()
    {
        return Err(format!("collector {} has an invalid schemaVersion/id/name/version", manifest.id));
    }
    if manifest.command.trim().is_empty()
        || manifest.args.len() > 16
        || manifest.args.iter().any(|arg| arg.len() > 256)
    {
        return Err(format!("collector {} has an invalid command or args", manifest.id));
    }
    if manifest.matcher.bundle_ids.is_empty() && manifest.matcher.app_names.is_empty() {
        return Err(format!("collector {} must declare match.bundleIds or match.appNames", manifest.id));
    }
    Ok(())
}

fn resolve_executable(collector: &LoadedCollector) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(&collector.manifest.command);
    let path = if candidate.is_absolute() {
        candidate
    } else {
        collector.manifest_path.parent().unwrap_or(&collector.root).join(candidate)
    };
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("collector executable unavailable: {error}"))?;
    if !canonical.starts_with(&collector.root) {
        return Err("collector executable must stay inside the approved collector directory".to_string());
    }
    if !canonical.is_file() {
        return Err("collector executable is not a file".to_string());
    }
    Ok(canonical)
}

pub(super) fn collectors_directory() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    #[cfg(target_os = "macos")]
    {
        return Some(home.join("Library").join("Application Support").join("ClipForge").join("context-collectors"));
    }
    #[cfg(target_os = "windows")]
    {
        return Some(home.join("AppData").join("Roaming").join("ClipForge").join("context-collectors"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Some(home.join(".config").join("clipforge").join("context-collectors"))
    }
}

pub(super) fn external_collectors_enabled() -> bool {
    crate::read_user_settings()
        .ok()
        .and_then(|payload| payload.settings.get("enableExternalContextCollectors").and_then(Value::as_bool))
        .unwrap_or(false)
}

fn validate_collector_output(value: &Value) -> Value {
    let mut errors = Vec::new();
    if value.get("schemaVersion").and_then(Value::as_i64) != Some(1) {
        errors.push("schemaVersion must be 1".to_string());
    }
    if !value.get("context").is_some_and(Value::is_object) {
        errors.push("context must be an object".to_string());
    }
    if !value.get("signals").is_some_and(Value::is_array) {
        errors.push("signals must be an array".to_string());
    }
    if !value.get("permissions").is_some_and(Value::is_object) {
        errors.push("permissions must be an object".to_string());
    }
    if !value
        .get("confidence")
        .and_then(Value::as_str)
        .is_some_and(|value| matches!(value, "high" | "best-effort" | "low"))
    {
        errors.push("confidence must be high, best-effort, or low".to_string());
    }
    json!({ "valid": errors.is_empty(), "errors": errors })
}
