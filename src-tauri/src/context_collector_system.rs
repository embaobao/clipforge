use serde_json::{json, Value};

/// 为实时采集快照补充当前进程的 cwd、可执行路径和只读 Git 元数据。
#[cfg(target_os = "macos")]
pub(crate) fn augment_process_context(context: &mut Value) {
    let Some(pid) = context
        .get("application")
        .and_then(|value| value.get("processId"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    else {
        return;
    };
    let executable_path = context
        .get("application")
        .and_then(|value| value.get("executablePath"))
        .cloned()
        .unwrap_or(Value::Null);
    let mut process = json!({
        "pid": pid,
        "executablePath": executable_path,
        "workingDirectory": null,
        "source": "process-metadata-only"
    });
    if let Some(cwd) = process_working_directory(pid) {
        process["workingDirectory"] = json!(cwd);
        add_git_context(&mut process, &cwd);
    }
    if let Some(object) = context.as_object_mut() {
        object.insert("process".to_string(), process);
        if object.get("kind").and_then(Value::as_str) == Some("assistant") {
            let provider = object
                .get("application")
                .and_then(|value| value.get("name"))
                .cloned()
                .unwrap_or(Value::Null);
            object.insert(
                "assistant".to_string(),
                json!({
                    "provider": provider,
                    "metadataOnly": true,
                    "sessionId": null,
                    "sessionAccess": "not-collected",
                }),
            );
        }
    }
}

/// 非 macOS 不读取平台专属进程窗口信息，返回基础快照。
#[cfg(not(target_os = "macos"))]
pub(crate) fn augment_process_context(_context: &mut Value) {}

#[cfg(target_os = "macos")]
fn process_working_directory(pid: &str) -> Option<String> {
    use std::process::Command;
    use std::time::Duration;

    let mut command = Command::new("lsof");
    command.args(["-a", "-p", pid, "-d", "cwd", "-Fn"]);
    let output = crate::run_system_command_with_timeout(
        command,
        "context-collector/lsof",
        Duration::from_millis(300),
    )
    .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| {
            line.strip_prefix('n')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
}

#[cfg(target_os = "macos")]
fn add_git_context(process: &mut Value, cwd: &str) {
    let root = run_quick_command("git", &["-C", cwd, "rev-parse", "--show-toplevel"]);
    let branch = run_quick_command("git", &["-C", cwd, "branch", "--show-current"]);
    let status = run_quick_command("git", &["-C", cwd, "status", "--short"]);
    if root.is_none() && branch.is_none() && status.is_none() {
        return;
    }
    process["git"] = json!({
        "repositoryRoot": root,
        "branch": branch,
        "hasUncommittedChanges": status.as_ref().is_some_and(|value| !value.is_empty()),
        "changedFileCount": status.map(|value| value.lines().count()).unwrap_or(0),
        "source": "git-read-only",
    });
}

#[cfg(target_os = "macos")]
fn run_quick_command(program: &str, args: &[&str]) -> Option<String> {
    use std::process::Command;
    use std::time::Duration;

    let mut command = Command::new(program);
    command.args(args);
    let output = crate::run_system_command_with_timeout(
        command,
        "context-collector/system",
        Duration::from_millis(300),
    )
    .ok()?;
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!value.is_empty()).then_some(value)
}
