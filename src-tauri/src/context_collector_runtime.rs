use serde_json::{Map, Value};
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

/// 执行外部采集器的 JSON stdio 协议，禁止 shell，并限制输出、等待和错误通道大小。
pub(crate) fn run_json_command(
    path: &Path,
    args: &[String],
    input: &[u8],
    timeout: Duration,
    max_output: usize,
) -> Result<Vec<u8>, String> {
    let mut command = Command::new(path);
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("collector spawn failed: {error}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(input)
            .map_err(|error| format!("collector stdin failed: {error}"))?;
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "collector stdout unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "collector stderr unavailable".to_string())?;
    let stdout_reader = thread::spawn(move || read_limited(stdout, max_output));
    let stderr_reader = thread::spawn(move || read_limited(stderr, 4096));
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = stdout_reader
                    .join()
                    .map_err(|_| "collector stdout reader failed".to_string())??;
                let error = stderr_reader
                    .join()
                    .map_err(|_| "collector stderr reader failed".to_string())??;
                if !status.success() {
                    return Err(format!(
                        "collector exited with {status}: {}",
                        String::from_utf8_lossy(&error).trim()
                    ));
                }
                return Ok(output);
            }
            Ok(None) if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(format!(
                    "collector timed out after {}ms",
                    timeout.as_millis()
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(error) => return Err(format!("collector wait failed: {error}")),
        }
    }
}

fn read_limited<R: Read>(mut reader: R, max_bytes: usize) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    reader
        .by_ref()
        .take((max_bytes + 1) as u64)
        .read_to_end(&mut output)
        .map_err(|error| error.to_string())?;
    if output.len() > max_bytes {
        return Err(format!("collector output exceeds {max_bytes} bytes"));
    }
    Ok(output)
}

/// 递归清理外部采集器结果中的 prompt、token、cookie 等敏感字段。
pub(crate) fn redact_sensitive(
    value: Value,
    path: String,
    redacted: &mut Vec<String>,
) -> Value {
    match value {
        Value::Object(object) => {
            let mut next = Map::new();
            for (key, child) in object {
                let child_path = format!("{path}.{key}");
                if is_sensitive_key(&key) {
                    redacted.push(child_path);
                    next.insert(key, Value::Null);
                } else {
                    next.insert(key, redact_sensitive(child, child_path, redacted));
                }
            }
            Value::Object(next)
        }
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .enumerate()
                .map(|(index, child)| {
                    redact_sensitive(child, format!("{path}[{index}]"), redacted)
                })
                .collect(),
        ),
        other => other,
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "prompt",
        "transcript",
        "token",
        "password",
        "cookie",
        "authorization",
        "secret",
        "apikey",
    ]
    .iter()
    .any(|part| key.contains(part))
}

#[cfg(test)]
mod tests {
    use super::redact_sensitive;
    use serde_json::json;

    #[test]
    fn redacts_nested_agent_secrets() {
        let mut fields = Vec::new();
        let result = redact_sensitive(
            json!({ "context": { "sessionId": "safe", "token": "secret" } }),
            "$".to_string(),
            &mut fields,
        );
        assert_eq!(result["context"]["sessionId"], "safe");
        assert_eq!(result["context"]["token"], serde_json::Value::Null);
        assert_eq!(fields, vec!["$.context.token"]);
    }
}
