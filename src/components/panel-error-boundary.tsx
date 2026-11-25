// 面板错误边界（S5 从 App.tsx 迁出）：App 根边界 + 工作区内容边界。
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Clipboard } from "lucide-react";
import { logAppError } from "../clipboard/panel-shared";

export type ErrorBoundaryCopy = {
  toastMessage: string;
  recoverLabel: string;
  panelTitle: string;
  panelMessage: string;
};

export class AppErrorBoundary extends Component<
  { children: ReactNode; copy: Pick<ErrorBoundaryCopy, "toastMessage" | "recoverLabel"> },
  { errorMessage: string | null; resetKey: number }
> {
  state = { errorMessage: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error) {
    return { errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError("error", error.message, info.componentStack);
  }

  render() {
    return (
      <>
        <div key={this.state.resetKey}>{this.props.children}</div>
        {this.state.errorMessage ? (
          <div className="runtime-error-toast" role="status">
            <Clipboard size={16} />
            <span>{this.props.copy.toastMessage}</span>
            <button
              className="text-button"
              onClick={() => this.setState((state) => ({ errorMessage: null, resetKey: state.resetKey + 1 }))}
              type="button"
            >
              {this.props.copy.recoverLabel}
            </button>
          </div>
        ) : null}
      </>
    );
  }
}

export class PanelContentBoundary extends Component<
  { children: ReactNode; copy: Pick<ErrorBoundaryCopy, "panelTitle" | "panelMessage">; resetKey: string },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError("error", `Panel content failed: ${error.message}`, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <Clipboard size={22} />
          <strong className="text-[13px] font-medium">{this.props.copy.panelTitle}</strong>
          <span className="text-[12px] text-muted-foreground">{this.props.copy.panelMessage}</span>
        </div>
      );
    }
    return this.props.children;
  }
}
