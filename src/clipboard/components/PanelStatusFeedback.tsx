// 主面板状态提示条（frontend-surface-architecture-refactor Phase B）
// 原 App.tsx 内 StatusLine 抽出，保持默认快捷键提示与自定义状态文案。
import type { TrFunction } from "../clipboard-domain";

export interface PanelStatusFeedbackProps {
  /** 自定义状态文案；为空时显示默认快捷键提示。 */
  status: string;
  tr: TrFunction;
}

/** 主面板底部/工具栏状态提示：自定义状态或默认快捷键说明。 */
export function PanelStatusFeedback({ status, tr }: PanelStatusFeedbackProps) {
  return (
    <span className="toolbar-status">
      {status || (
        <>
          <kbd>Tab</kbd> {tr("main.statusLine.navigate")} · <kbd>Enter</kbd> {tr("main.statusLine.paste")} ·{" "}
          <kbd>→</kbd> {tr("main.statusLine.detail")} · <kbd>Ctrl/Cmd</kbd>+<kbd>J</kbd>{" "}
          {tr("main.statusLine.openTarget")} · <kbd>Ctrl/Cmd</kbd>+<kbd>P</kbd> {tr("main.statusLine.pin")}
        </>
      )}
    </span>
  );
}

export default PanelStatusFeedback;
