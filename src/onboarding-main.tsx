import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { resolveAppLocale, t } from "./i18n";
import { OnboardingApp } from "./onboarding/OnboardingApp";
import { SettingsErrorBoundary } from "./settings/components/SettingsErrorBoundary";
import "./settings.css";
import "./onboarding/onboarding.css";

const root = document.getElementById("root");
if (root) {
  const locale = resolveAppLocale("system");
  createRoot(root).render(
    <StrictMode>
      <SettingsErrorBoundary
        message={t(locale, "settings.error.pageMessage")}
        retryLabel={t(locale, "settings.error.retry")}
        scope="onboarding-root"
        title={t(locale, "settings.error.pageTitle")}
      >
        <OnboardingApp />
      </SettingsErrorBoundary>
    </StrictMode>,
  );
}
