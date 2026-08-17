//! DSH（DeepSeek Harness）内嵌分析模块 —— 插件式集成
//!
//! 集成方式（盟哥 2026-08-17 决策）：DSH 作为可更新依赖直接引用，剪贴板分析做成它的
//! Cordis 插件（@clipforge/dsh-plugin）。Rust 侧只做薄桥接：拉起 Node sidecar 加载
//! clipforge profile，sidecar 内 DSH 负责 agent 编排、工具调用与结构化输出强校验
//! （`clipboard_analyze` 工具的 `output.schema`），最终打印 `DSH_RESULT::<json>` 一行。
//! 本模块读取该行并解析，不再手写 prompt，也不再正则抠 JSON。
//!
//! 安全边界：
//! - sidecar 使用内置 clipforge profile（只读分析，不挂载 bash/fs/web 执行能力）。
//! - 内容默认截断至 MAX_CONTENT_CHARS，全文需授权。
//! - 任何缺失 / 超时 / 失败都走降级路径，AI 入口在前端禁用，基础剪贴板功能不受影响。

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// 分析输入。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DshAnalyzeInput {
    /// 关联剪贴板 id（仅用于前端回写定位，不参与模型调用）
    pub clip_id: Option<String>,
    /// 待分析的剪贴板文本
    pub content: String,
    /// 分析类型：保留字段以兼容前端，实际产出由 DSH 的 SKILL.md 决定（此处忽略）
    #[serde(default)]
    pub analysis_type: Option<String>,
    /// node 可执行路径（默认取 CLIPFORGE_DSH_NODE 或系统 node）
    #[serde(default)]
    pub node_path: Option<String>,
    /// DSH sidecar 脚本路径（默认取 CLIPFORGE_DSH_SIDECAR 或探测）
    #[serde(default)]
    pub sidecar_path: Option<String>,
    /// DSH_HOME 覆盖（默认用 dsh 自身默认位置）
    #[serde(default)]
    pub dsh_home: Option<String>,
    /// provider api key（注入到进程环境变量，不落盘到前端）
    #[serde(default)]
    pub api_key: Option<String>,
    /// OpenAI 兼容 base url（可选）
    #[serde(default)]
    pub base_url: Option<String>,
    /// 模型 id（可选，交给 dsh 默认）
    #[serde(default)]
    pub model: Option<String>,
    /// 超时秒数（默认 60）
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
}

fn default_timeout() -> u64 {
    60
}

/// 四类分析结果（与 ai-model-plugin-productization 提案对齐）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DshAnalyzeResult {
    /// 一句话总结
    pub summary: Option<String>,
    /// 内容类别：文本 / 代码 / 链接 / JSON / 表格 / 日志 / 图片 / 其他
    pub category: Option<String>,
    /// 自动标签
    pub tags: Vec<String>,
    /// 建议归入的文件夹名
    pub suggested_folder: Option<String>,
    /// 提取的结构化字段（URL / 邮箱 / 电话 / 关键键值）
    pub extracted: JsonValue,
    /// sidecar 原始输出（解析失败时回退）
    pub raw: String,
    /// 是否降级（true 表示未拿到结构化结果，但可能有 raw）
    pub degraded: bool,
    /// 错误码：DSH_NOT_FOUND / DSH_SPAWN_FAILED / DSH_TIMEOUT / DSH_SIDECAR_ERROR / DSH_NO_RESULT_LINE / 无则空
    pub error_code: Option<String>,
}

/// 解析 node 路径：参数优先 → 环境变量 → 系统 node
fn resolve_node(node_path: Option<&str>) -> String {
    if let Some(p) = node_path {
        if !p.trim().is_empty() {
            return p.trim().to_string();
        }
    }
    if let Ok(p) = std::env::var("CLIPFORGE_DSH_NODE") {
        if !p.trim().is_empty() {
            return p.trim().to_string();
        }
    }
    "node".to_string()
}

/// 解析 sidecar 路径：参数优先 → 环境变量 → 返回 None（触发降级）
fn resolve_sidecar(sidecar_path: Option<&str>) -> Option<String> {
    if let Some(p) = sidecar_path {
        if !p.trim().is_empty() {
            return Some(p.trim().to_string());
        }
    }
    if let Ok(p) = std::env::var("CLIPFORGE_DSH_SIDECAR") {
        if !p.trim().is_empty() {
            return Some(p);
        }
    }
    None
}

/// 内容截断上限：遵循 ai-model 提案隐私默认（只发摘要/元数据，全文需授权）
const MAX_CONTENT_CHARS: usize = 8000;

/// 只截断内容并拼一句分析指令；结构化字段由 DSH 的 SKILL.md + tool schema 约束，不在此写 JSON 模板。
fn build_task_content(content: &str) -> String {
    let truncated = if content.chars().count() > MAX_CONTENT_CHARS {
        let kept: String = content.chars().take(MAX_CONTENT_CHARS).collect();
        format!("{kept}\n…（内容已截断，原文过长）")
    } else {
        content.to_string()
    };
    format!("分析以下剪贴板内容并提交结构化结果：\n---\n{truncated}\n---")
}

/// 从 sidecar 输出中抓取 `DSH_RESULT::` 前缀行并解析为结构化结果；找不到则降级。
/// 注意：只解析我们自定义的单行协议，不再对整段模型输出做正则抠 JSON。
fn parse_dsh_result(raw: &str) -> DshAnalyzeResult {
    for line in raw.lines() {
        let line = line.trim_start();
        if let Some(json) = line.strip_prefix("DSH_RESULT::") {
            if let Ok(v) = serde_json::from_str::<JsonValue>(json) {
                return DshAnalyzeResult {
                    summary: v.get("summary").and_then(|x| x.as_str()).map(|s| s.to_string()),
                    category: v
                        .get("category")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string()),
                    tags: v
                        .get("tags")
                        .and_then(|x| x.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default(),
                    suggested_folder: v
                        .get("suggestedFolder")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string()),
                    extracted: v.get("extracted").cloned().unwrap_or(JsonValue::Null),
                    raw: raw.to_string(),
                    degraded: v.get("degraded").and_then(|x| x.as_bool()).unwrap_or(false),
                    error_code: v
                        .get("errorCode")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string()),
                };
            }
        }
    }
    DshAnalyzeResult {
        summary: if raw.trim().is_empty() {
            None
        } else {
            Some(raw.trim().to_string())
        },
        category: None,
        tags: vec![],
        suggested_folder: None,
        extracted: JsonValue::Null,
        raw: raw.to_string(),
        degraded: true,
        error_code: Some("DSH_NO_RESULT_LINE".to_string()),
    }
}

fn degraded_not_found() -> DshAnalyzeResult {
    DshAnalyzeResult {
        summary: None,
        category: None,
        tags: vec![],
        suggested_folder: None,
        extracted: JsonValue::Null,
        raw: String::new(),
        degraded: true,
        error_code: Some("DSH_NOT_FOUND".to_string()),
    }
}

fn degraded_error(code: String) -> DshAnalyzeResult {
    DshAnalyzeResult {
        summary: None,
        category: None,
        tags: vec![],
        suggested_folder: None,
        extracted: JsonValue::Null,
        raw: String::new(),
        degraded: true,
        error_code: Some(code),
    }
}

/// Tauri 命令：对剪贴板内容做 DSH 只读快速分析（插件式集成薄桥接）
#[tauri::command]
pub async fn analyze_clipboard(input: DshAnalyzeInput) -> Result<DshAnalyzeResult, String> {
    if input.content.trim().is_empty() {
        return Err("DSH_EMPTY_CONTENT".to_string());
    }
    let node = resolve_node(input.node_path.as_deref());
    let sidecar = match resolve_sidecar(input.sidecar_path.as_deref()) {
        Some(s) => s,
        None => return Ok(degraded_not_found()),
    };

    let task = build_task_content(&input.content);
    let timeout = Duration::from_secs(input.timeout_seconds.max(5).min(300));

    let mut command = Command::new(&node);
    command.arg(&sidecar).arg(&task);
    if let Some(home) = &input.dsh_home {
        if !home.trim().is_empty() {
            command.env("DSH_HOME", home.trim());
        }
    }
    if let Some(key) = &input.api_key {
        if !key.trim().is_empty() {
            command.env("DEEPSEEK_API_KEY", key.trim());
        }
    }
    if let Some(url) = &input.base_url {
        if !url.trim().is_empty() {
            command.env("DEEPSEEK_BASE_URL", url.trim());
        }
    }
    if let Some(model) = &input.model {
        if !model.trim().is_empty() {
            command.env("DEEPSEEK_MODEL", model.trim());
        }
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(c) => c,
        Err(error) => return Ok(degraded_error(format!("DSH_SPAWN_FAILED:{error}"))),
    };

    let mut stdout = child.stdout.take();
    let reader = thread::spawn(move || {
        let mut buf = String::new();
        if let Some(out) = stdout.as_mut() {
            let _ = out.read_to_string(&mut buf);
        }
        buf
    });
    let mut stderr_buf = String::new();
    if let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_string(&mut stderr_buf);
    }

    let start = Instant::now();
    let mut timed_out = false;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    timed_out = true;
                    break;
                }
                thread::sleep(Duration::from_millis(150));
            }
            Err(_) => break,
        }
    }
    let raw = reader.join().unwrap_or_default();

    if timed_out {
        return Ok(degraded_error("DSH_TIMEOUT".to_string()));
    }
    if raw.trim().is_empty() && !stderr_buf.trim().is_empty() {
        // sidecar 报错（boot 失败 / 无 key 等），降级并把 stderr 透出便于排查
        return Ok(DshAnalyzeResult {
            summary: None,
            category: None,
            tags: vec![],
            suggested_folder: None,
            extracted: JsonValue::Null,
            raw: stderr_buf,
            degraded: true,
            error_code: Some("DSH_SIDECAR_ERROR".to_string()),
        });
    }

    Ok(parse_dsh_result(&raw))
}

// ─────────────────────────────────────────────────────────────────────────────
// DSH 常驻守护进程（web carrier）
//
// 与一次性 `analyze_clipboard` 并存：守护进程常驻拉起 `node sidecar.mjs --serve`，
// 由 dsh-web-app 在 loopback 上直接提供 DSH 官方 Web UI（兼容模式，参考项目 desktop 壳同思路）。
// 悬浮 dsh surface 通过 iframe 嵌入该地址即可「直接使用他的 web 页面」。
// 安全边界：host 固定 127.0.0.1（loopback-only），绝不暴露到局域网。
// ─────────────────────────────────────────────────────────────────────────────

use std::net::TcpStream;
use std::process::Child;
use std::sync::{Arc, Mutex};

/// DSH 常驻守护进程状态：跨应用生命周期持有子进程句柄。
/// 用 `Arc<Mutex<Option<Child>>>` 保证 `Send + Sync`，可经 `tauri::State` 注入命令。
pub struct DshDaemonState {
    pub child: Arc<Mutex<Option<Child>>>,
}

impl Default for DshDaemonState {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
        }
    }
}

/// 常驻守护进程启动参数（与 analyze_clipboard 的输入对齐，便于复用 provider 配置）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DshDaemonStartInput {
    #[serde(default)]
    pub node_path: Option<String>,
    #[serde(default)]
    pub sidecar_path: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
}

/// web carrier 默认监听端口（与 sidecar.mjs 的 SERVE_PORT 一致）。
const DSH_DEFAULT_PORT: u16 = 3080;
/// web carrier 默认绑定地址（loopback-only 硬约束）。
const DSH_DEFAULT_HOST: &str = "127.0.0.1";

/// 解析 sidecar 脚本路径：参数优先 → 环境变量 → 沿仓库祖先目录探测默认位置。
/// 默认位置：`<仓库根>/dsh/profiles/clipforge/sidecar.mjs`。
fn resolve_daemon_sidecar(sidecar_path: Option<&str>) -> Option<String> {
    if let Some(p) = sidecar_path {
        if !p.trim().is_empty() {
            return Some(p.trim().to_string());
        }
    }
    if let Ok(p) = std::env::var("CLIPFORGE_DSH_SIDECAR") {
        if !p.trim().is_empty() {
            return Some(p);
        }
    }
    // 探测：当前 exe 所在目录向上找 `dsh/profiles/clipforge/sidecar.mjs`
    if let Ok(exe) = std::env::current_exe() {
        if let Some(found) = exe
            .ancestors()
            .find_map(|dir| {
                let candidate = dir.join("dsh/profiles/clipforge/sidecar.mjs");
                candidate.exists().then_some(candidate)
            })
        {
            return Some(found.to_string_lossy().to_string());
        }
    }
    None
}

/// 拉起常驻 web carrier 守护进程。已在运行时直接跳过；sidecar 找不到则降级报错。
pub fn spawn_dsh_daemon(
    state: &DshDaemonState,
    input: Option<DshDaemonStartInput>,
) -> Result<(), String> {
    // 已在运行则跳过，避免重复拉起
    {
        let guard = state.child.lock().unwrap();
        if guard.is_some() {
            return Ok(());
        }
    }
    let input = input.unwrap_or_default();
    let node = resolve_node(input.node_path.as_deref());
    let sidecar = match resolve_daemon_sidecar(input.sidecar_path.as_deref()) {
        Some(s) => s,
        None => return Err("DSH_SIDECAR_NOT_FOUND".to_string()),
    };
    let host = input
        .host
        .clone()
        .filter(|h| !h.trim().is_empty())
        .unwrap_or_else(|| DSH_DEFAULT_HOST.to_string());
    let port = input.port.unwrap_or(DSH_DEFAULT_PORT);

    let mut command = Command::new(&node);
    command.arg(&sidecar).arg("--serve");
    command.env("CLIPFORGE_DSH_HOST", &host);
    command.env("CLIPFORGE_DSH_PORT", port.to_string());
    if let Some(key) = &input.api_key {
        if !key.trim().is_empty() {
            command.env("DEEPSEEK_API_KEY", key.trim());
        }
    }
    if let Some(url) = &input.base_url {
        if !url.trim().is_empty() {
            command.env("DEEPSEEK_BASE_URL", url.trim());
        }
    }
    if let Some(model) = &input.model {
        if !model.trim().is_empty() {
            command.env("DEEPSEEK_MODEL", model.trim());
        }
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    match command.spawn() {
        Ok(child) => {
            *state.child.lock().unwrap() = Some(child);
            Ok(())
        }
        Err(error) => Err(format!("DSH_SPAWN_FAILED:{error}")),
    }
}

/// 停止常驻守护进程（杀子进程并等待回收，避免孤儿进程）。
pub fn kill_dsh_daemon(state: &DshDaemonState) {
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// 健康检查：进程存活且 loopback 端口可连（web carrier 已绑端口即视为 UI 就绪）。
pub fn dsh_daemon_healthy(port: u16) -> bool {
    TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        std::time::Duration::from_millis(300),
    )
    .is_ok()
}

/// Tauri 命令：拉起（或重启）DSH 常驻守护进程。
#[tauri::command]
pub async fn start_dsh_daemon(
    input: Option<DshDaemonStartInput>,
    state: tauri::State<'_, DshDaemonState>,
) -> Result<(), String> {
    spawn_dsh_daemon(&state, input)
}

/// Tauri 命令：停止 DSH 常驻守护进程。
#[tauri::command]
pub async fn stop_dsh_daemon(state: tauri::State<'_, DshDaemonState>) -> Result<(), String> {
    kill_dsh_daemon(&state);
    Ok(())
}

/// Tauri 命令：查询 DSH 守护进程健康状态（就绪 = 进程存活且端口可连）。
#[tauri::command]
pub async fn get_dsh_status(state: tauri::State<'_, DshDaemonState>) -> Result<bool, String> {
    let alive = {
        let mut guard = state.child.lock().unwrap();
        match guard.as_mut() {
            Some(child) => child.try_wait().map(|w| w.is_none()).unwrap_or(false),
            None => false,
        }
    };
    Ok(alive && dsh_daemon_healthy(DSH_DEFAULT_PORT))
}
