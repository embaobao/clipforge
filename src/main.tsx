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
