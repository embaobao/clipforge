import { Component, type ErrorInfo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, RefreshCw } from "lucide-react";

/** 设置页错误兜底文案：区分根页面与单个页签的恢复提示。 */
export interface SettingsErrorBoundaryCopy {
  title: string;
  message: string;
  retryLabel: string;
}

/** 设置页错误边界参数：用 scope 写日志，用 resetKey 在切换页签时恢复渲染。 */
export interface SettingsErrorBoundaryProps extends SettingsErrorBoundaryCopy {
  children: ReactNode;
  resetKey?: string;
  scope: string;
}

interface SettingsErrorBoundaryState {
  errorMessage: string;
  resetCount: number;
}

function settingsErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function appendSettingsErrorLog(scope: string, error: Error, info?: ErrorInfo) {
  const context = JSON.stringify({
    scope,
    name: error.name,
    stack: error.stack,
    componentStack: info?.componentStack,
    location: window.location.href,
  }).slice(0, 8000);
  void invoke("append_app_log", {
    level: "error",
    message: `Settings surface failed: ${error.message}`,
    context,
  }).catch(() => {
    console.error("Settings surface failed", error, info?.componentStack);
  });
}

/** 设置页错误边界：隔离单个设置 tab 或根页面异常，避免整窗白屏或应用退出。 */
export class SettingsErrorBoundary extends Component<
  SettingsErrorBoundaryProps,
  SettingsErrorBoundaryState
> {
  state: SettingsErrorBoundaryState = { errorMessage: "", resetCount: 0 };

  static getDerivedStateFromError(error: Error) {
    return { errorMessage: settingsErrorMessage(error) };
  }

  componentDidUpdate(previous: SettingsErrorBoundaryProps) {
    if (previous.resetKey !== this.props.resetKey && this.state.errorMessage) {
      this.setState({ errorMessage: "" });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    appendSettingsErrorLog(this.props.scope, error, info);
  }

  render() {
    if (!this.state.errorMessage) {
      return <div key={this.state.resetCount}>{this.props.children}</div>;
    }

    return (
      <section className="settings-fallback" role="alert">
        <AlertTriangle size={18} />
        <div>
          <strong>{this.props.title}</strong>
          <p title={this.state.errorMessage}>{this.props.message}</p>
        </div>
        <button
          className="settings-action-button secondary"
          onClick={() =>
            this.setState((state) => ({
              errorMessage: "",
              resetCount: state.resetCount + 1,
            }))
          }
          type="button"
        >
          <RefreshCw size={13} />
          {this.props.retryLabel}
        </button>
      </section>
    );
  }
}
