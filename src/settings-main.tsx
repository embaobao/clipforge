// 必须在任何 @tauri-apps/api 使用之前安装 web mock 协议桥（dev-only 副作用导入）。
import "./services/tauri-web-mock";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SettingsApp } from "./settings";
import { resolveAppLocale, t } from "./i18n";
import { SettingsErrorBoundary } from "./settings/components/SettingsErrorBoundary";
import "./index.css";

const root = document.getElementById("root");
if (root) {
  const locale = resolveAppLocale("system");
  createRoot(root).render(
    <StrictMode>
      <SettingsErrorBoundary
        message={t(locale, "settings.error.pageMessage")}
        retryLabel={t(locale, "settings.error.retry")}
        scope="settings-root"
        title={t(locale, "settings.error.pageTitle")}
      >
        <SettingsApp />
      </SettingsErrorBoundary>
    </StrictMode>,
  );
}
