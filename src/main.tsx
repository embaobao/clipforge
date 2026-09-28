// 必须在任何 @tauri-apps/api 使用之前安装 web mock 协议桥（dev-only 副作用导入）。
import "./services/tauri-web-mock";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { installAnimFreezeGuard } from "./clipboard/anim-freeze-guard";
import "./index.css";

// 后台 app 的 WKWebView 可能冻结 CSS 动画时间轴（面板/toast 卡入场帧），启动即检测并挂守卫。
installAnimFreezeGuard();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <TooltipProvider delayDuration={300}>
    <App />
    <Toaster
      position="top-center"
      duration={1400}
      toastOptions={{
        style: {
          background: "hsl(var(--popover))",
          color: "hsl(var(--popover-foreground))",
          border: "none",
          borderRadius: "8px",
          boxShadow:
            "0 0 0 0.5px rgb(0 0 0 / 0.06), 0 8px 24px -8px rgb(0 0 0 / 0.18)",
          fontSize: "12px",
          padding: "6px 12px",
        },
      }}
    />
  </TooltipProvider>,
);
