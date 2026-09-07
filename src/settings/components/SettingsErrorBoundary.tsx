import { Component, type ErrorInfo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

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
      <section className="flex flex-col items-center justify-center gap-3 py-12 text-center" role="alert">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-black/[0.04] dark:bg-white/[0.07]">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <p className="text-[13px] font-medium text-foreground">{this.props.title}</p>
          <p className="mt-1 max-w-[320px] text-[12px] text-muted-foreground" title={this.state.errorMessage}>
            {this.props.message}
          </p>
        </div>
        <Button
          className="h-7 gap-1.5 rounded-md text-[12px]"
          onClick={() =>
            this.setState((state) => ({
              errorMessage: "",
              resetCount: state.resetCount + 1,
            }))
          }
          size="sm"
          variant="outline"
        >
          <RefreshCw size={13} />
          {this.props.retryLabel}
        </Button>
      </section>
    );
  }
}
