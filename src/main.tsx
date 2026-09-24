// 必须在任何 @tauri-apps/api 使用之前安装 web mock 协议桥（dev-only 副作用导入）。
import "./services/tauri-web-mock";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <TooltipProvider delayDuration={300}>
    <App />
    <Toaster position="top-center" />
  </TooltipProvider>,
);
