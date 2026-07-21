import ReactDOM from "react-dom/client";
import App from "./App";
import { TooltipProvider } from "@/components/animate-ui/primitives/radix/tooltip";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <TooltipProvider delayDuration={300}>
    <App />
  </TooltipProvider>,
);
