/**
 * DSH（DeepSeek Harness）内嵌分析：前端调用层。
 *
 * 对应 Rust command `analyze_clipboard`：拉起 `node <sidecar>` 加载 clipforge profile，
 * 对剪贴板内容做只读快速分析，返回四类结果（summary / category / tags / suggestedFolder / extracted）。
 *
 * 集成方式（盟哥 2026-08-17 决策）：DSH 作为可更新依赖直接引用；剪贴板分析是它自带的
 * Cordis 插件（@clipforge/dsh-plugin），结构化输出由工具的 `output.schema` 强校验。
 * 本层只负责调用 Rust 命令并消费结构化结果，不再做任何文本解析。
 *
 * 运行时定位：开发期默认指向项目内 sidecar.mjs + 隔离 workspace 的 managed node；
 * 生产期由 Tauri sidecar 打包，路径通过 import.meta.env 注入覆盖。
 */

import { invoke } from "@tauri-apps/api/core";

/** 分析类型：保留字段以便兼容，实际产出由 DSH 的 SKILL.md 决定（Rust 侧忽略）。 */
export type DshAnalysisType =
  | "summary"
  | "classify"
  | "extract"
  | "auto-tag"
  | "suggest-folder"
  | "all";

/** 与 src-tauri/src/dsh.rs 的 DshAnalyzeInput 对齐 */
export interface DshAnalyzeInput {
  clipId?: string;
  content: string;
  analysisType?: DshAnalysisType;
  nodePath?: string;
  /** DSH sidecar 脚本路径（替代旧版 dshBinPath） */
  sidecarPath?: string;
  dshHome?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutSeconds?: number;
}

/** 与 src-tauri/src/dsh.rs 的 DshAnalyzeResult 对齐 */
export interface DshAnalyzeResult {
  summary?: string;
  category?: string;
  tags: string[];
  suggestedFolder?: string;
  extracted: unknown;
  raw: string;
  degraded: boolean;
  errorCode?: string;
}

// 开发期默认运行时（项目内 sidecar.mjs + 隔离 workspace 的 managed node）。
// 生产期由 Tauri sidecar 注入：VITE_DSH_NODE_PATH / VITE_DSH_SIDECAR_PATH。
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const DSH_NODE_PATH =
  env.VITE_DSH_NODE_PATH ??
  "/Users/embaobao/.workbuddy/binaries/node/versions/22.22.2/bin/node";
const DSH_SIDECAR_PATH =
  env.VITE_DSH_SIDECAR_PATH ??
  "/Users/embaobao/workspace/idea/clipforge/dsh/profiles/clipforge/sidecar.mjs";

export interface AnalyzeClipboardOptions {
  analysisType?: DshAnalysisType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutSeconds?: number;
}

/**
 * 调用 Rust command 对剪贴板内容做 DSH 只读分析。
 * 缺失 node/sidecar 或超时/失败时，Rust 侧返回降级结果（degraded=true + errorCode），由调用方展示。
 */
export async function analyzeClipboard(
  content: string,
  options: AnalyzeClipboardOptions = {},
): Promise<DshAnalyzeResult> {
  return invoke<DshAnalyzeResult>("analyze_clipboard", {
    content,
    nodePath: DSH_NODE_PATH,
    sidecarPath: DSH_SIDECAR_PATH,
    analysisType: options.analysisType ?? "all",
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
    timeoutSeconds: options.timeoutSeconds ?? 60,
  } satisfies DshAnalyzeInput);
}

// 本地 AI 分析历史（localStorage，最近 20 条），用于管理与审计。
// 注意：DSH 自身 session store 在 rc.6 未暴露稳定 API，这里用前端 localStorage 兜底，
// 不依赖外部服务，缺失时静默降级。
const DSH_HISTORY_KEY = "clipforge.dsh.history";

export interface DshHistoryEntry {
  clipId?: string;
  summary?: string;
  category?: string;
  tags: string[];
  suggestedFolder?: string;
  degraded: boolean;
  errorCode?: string;
  at: number;
}

export function recordDshHistory(entry: Omit<DshHistoryEntry, "at">): void {
  try {
    const raw = localStorage.getItem(DSH_HISTORY_KEY);
    const list: DshHistoryEntry[] = raw ? (JSON.parse(raw) as DshHistoryEntry[]) : [];
    list.unshift({ ...entry, at: Date.now() });
    localStorage.setItem(DSH_HISTORY_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    // localStorage 不可用时忽略
  }
}

export function getDshHistory(): DshHistoryEntry[] {
  try {
    const raw = localStorage.getItem(DSH_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as DshHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

// ── DSH 常驻守护进程（web carrier）控制层 ──
// 对应 Rust command：start_dsh_daemon / stop_dsh_daemon / get_dsh_status。
// 悬浮 dsh surface 通过 DSH_WEB_URL 嵌入官方 Web UI（兼容模式，直接使用他的 web 页面）。

/** DSH 官方 Web UI 的 loopback 地址（与 sidecar.mjs / dsh.rs 默认端口一致）。 */
export const DSH_WEB_URL = `http://127.0.0.1:${env.VITE_DSH_PORT ?? "3080"}`;

/** 与 src-tauri/src/dsh.rs 的 DshDaemonStartInput 对齐 */
export interface DshDaemonStartInput {
  nodePath?: string;
  sidecarPath?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  host?: string;
  port?: number;
}

/** 拉起（或重启）DSH 常驻守护进程。 */
export async function startDshDaemon(input?: DshDaemonStartInput): Promise<void> {
  return invoke("start_dsh_daemon", { input: input ?? null });
}

/** 停止 DSH 常驻守护进程。 */
export async function stopDshDaemon(): Promise<void> {
  return invoke("stop_dsh_daemon");
}

/** 查询 DSH 守护进程健康状态（就绪 = 进程存活且端口可连）。 */
export async function getDshStatus(): Promise<boolean> {
  return invoke<boolean>("get_dsh_status");
}

// ── DSH 独立悬浮窗控制层 ──
// 对应 Rust command：open_dsh_window / hide_dsh_window / toggle_dsh_window。
// 复用剪贴板窗体的悬浮逻辑（NSPanel status-level 浮动、失焦隐藏、固定），
// 仅把窗口 label 从 "main" 换成 "dsh"，使 DSH 能悬浮于其他应用之上快速使用 Agent。

/** 打开 DSH 独立悬浮窗（复用剪贴板浮窗的定位 + 显示逻辑）。 */
export async function openDshWindow(): Promise<void> {
  return invoke("open_dsh_window");
}

/** 隐藏 DSH 独立悬浮窗（不杀守护进程，会话可恢复）。 */
export async function hideDshWindow(): Promise<void> {
  return invoke("hide_dsh_window");
}

/** 切换 DSH 独立悬浮窗显隐（托盘菜单 / 全局快捷键使用）。 */
export async function toggleDshWindow(): Promise<void> {
  return invoke("toggle_dsh_window");
}
