// DSH（DeepSeek Harness）悬浮面板：兼容模式，直接嵌入 DSH 官方 Web UI。
//
// 产品定位（盟哥 2026-08-17）：剪贴板 + 悬浮 DSH 双 surface 工具。本面板即「悬浮 AI 助手」，
// 通过 iframe 嵌入常驻守护进程在 loopback 上提供的 DSH 官方 Web UI（web carrier），
// 不自行实现对话 UI、不改动 DSH 本体 —— 即「直接使用他的 web 页面」。
// 守护进程由 Rust 命令 start_dsh_daemon 常驻拉起（sidecar.mjs --serve），
// 面板仅负责：确保守护进程在、轮询就绪、嵌入地址、关闭回到 clipboard surface。
//
// 与剪贴板面板的「链接 / 写回」是后续步骤（见 dsh-file-context-conversation 提案），本阶段只验证集成。
import { useEffect, useState } from "react";
import { ScanSearch, X } from "lucide-react";
import type { ClipItem } from "../App";
import type { TranslationKey } from "../i18n";
import { DSH_WEB_URL, getDshStatus, startDshDaemon } from "../agent/dsh-analysis";
import "./dsh-panel.css";

export interface DshPanelProps {
  /** 当前选中的剪贴板条目（后续链接步骤的写回目标；本阶段仅作上下文提示）。 */
  selectedClip?: ClipItem | null;
  /** 把分析出的标签写回到选中条目（后续步骤启用）。 */
  onApplyTags?: (tags: string[]) => void;
  /** 把建议分组写回到选中条目（后续步骤启用）。 */
  onApplyFolder?: (folder: string) => void;
  /** 关闭面板（回到 clipboard surface） */
  onClose: () => void;
  /** 点击结果标签时触发检索（后续步骤启用）。 */
  onSearchTag?: (tag: string) => void;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

type DaemonState = "loading" | "ready" | "error";

/**
 * DSH 悬浮面板：嵌入官方 Web UI 的兼容模式。
 * 复用现有 dsh surface 切换（activeSurface === "dsh"），与剪贴板面板同形态。
 */
export function DshPanel({ onClose, tr }: DshPanelProps) {
  const [state, setState] = useState<DaemonState>("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      // 确保守护进程在（开发期若未自动拉起则兜底启动一次）。
      try {
        const ok = await getDshStatus();
        if (!ok) await startDshDaemon();
      } catch {
        // 忽略，交给下方轮询判定
      }
      // 轮询直到端口可连（web carrier 启动约 3s）。
      for (let i = 0; i < 30; i++) {
        if (!alive) return;
        try {
          if (await getDshStatus()) {
            if (alive) setState("ready");
            return;
          }
        } catch {
          // 忽略单次失败
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (alive) setState("error");
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="dsh-panel" data-surface="dsh">
      <div className="dsh-panel-header">
        <span className="dsh-panel-title">
          <ScanSearch size={14} />
          AI 助手（DeepSeek Harness）
        </span>
        <button
          aria-label={tr("main.detail.close")}
          className="icon-button dsh-panel-close"
          onClick={onClose}
          title={tr("main.detail.close")}
          type="button"
        >
          <X size={14} />
        </button>
      </div>

      <div className="dsh-panel-body">
        {state === "ready" ? (
          <iframe className="dsh-web-frame" src={DSH_WEB_URL} title="DeepSeek Harness" />
        ) : state === "error" ? (
          <div className="dsh-panel-hint">
            守护进程未就绪：请检查 node sidecar 路径或 provider 配置（端口 3080）。
          </div>
        ) : (
          <div className="dsh-panel-hint">正在启动 DSH 守护进程…</div>
        )}
      </div>
    </div>
  );
}
