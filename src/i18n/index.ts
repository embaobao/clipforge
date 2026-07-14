import { useMemo } from "react";
import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

export type AppLanguagePreference = "system" | "zh-CN" | "en-US";
export type AppLocale = "zh-CN" | "en-US";

export type TranslationKey = keyof typeof zhCN;

const dictionaries: Record<AppLocale, Record<TranslationKey, string>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

export function resolveAppLocale(preference: AppLanguagePreference, systemLanguage = navigator.language): AppLocale {
  if (preference === "zh-CN" || preference === "en-US") return preference;
  return systemLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function normalizeLanguagePreference(value: unknown): AppLanguagePreference {
  return value === "zh-CN" || value === "en-US" || value === "system" ? value : "system";
}

export function t(locale: AppLocale, key: TranslationKey, params: Record<string, string | number> = {}) {
  const value = dictionaries[locale][key] ?? dictionaries["zh-CN"][key];
  if (import.meta.env.DEV && !value) {
    console.warn(`[i18n] missing key: ${key}`);
  }
  return Object.entries(params).reduce((text, [name, replacement]) => text.split(`{${name}}`).join(String(replacement)), value);
}

export type CommandError = {
  raw: string;
  code: string | null;
  detail: string;
};

export function parseCommandError(error: unknown): CommandError {
  const raw = error instanceof Error ? error.message : String(error);
  const match = raw.match(/^([A-Z][A-Z0-9_]*):\s*(.*)$/);
  if (!match) {
    return { raw, code: null, detail: raw };
  }
  return { raw, code: match[1], detail: match[2] || raw };
}

export function formatCommandError(
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string,
  error: unknown,
) {
  const parsed = parseCommandError(error);
  if (!parsed.code) return parsed.detail;
  const specificKey = `main.error.command.${parsed.code}` as TranslationKey;
  if (specificKey in dictionaries["zh-CN"]) {
    return tr(specificKey, { code: parsed.code, detail: parsed.detail });
  }
  return tr("main.error.command.unknown", { code: parsed.code, detail: parsed.detail });
}

export function setDocumentLocale(locale: AppLocale) {
  document.documentElement.lang = locale;
}

export function useI18n(preference: AppLanguagePreference) {
  const locale = resolveAppLocale(preference);
  return useMemo(
    () => ({
      locale,
      t: (key: TranslationKey, params?: Record<string, string | number>) => t(locale, key, params),
    }),
    [locale],
  );
}
