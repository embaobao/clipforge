import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function assert(condition, message) {
  if (!condition) {
    console.error(`i18n runtime verification failed: ${message}`);
    process.exitCode = 1;
  }
}

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return "";
  return source.slice(startIndex, endIndex);
}

const i18n = read("src/i18n/index.ts");
const app = read("src/App.tsx");
const settings = read("src/settings.tsx");
const rust = read("src-tauri/src/lib.rs");
const zh = readJson("src/i18n/locales/zh-CN.json");
const en = readJson("src/i18n/locales/en-US.json");

const zhKeys = Object.keys(zh).sort();
const enKeys = Object.keys(en).sort();
assert(zhKeys.length === enKeys.length, "zh-CN and en-US dictionaries have different key counts");
assert(zhKeys.every((key, index) => key === enKeys[index]), "zh-CN and en-US dictionaries are not key-aligned");

assert(i18n.includes('export type AppLanguagePreference = "system" | "zh-CN" | "en-US"'), "language preference union is missing system/zh-CN/en-US");
assert(i18n.includes('export type AppLocale = "zh-CN" | "en-US"'), "app locale union is missing zh-CN/en-US");
assert(i18n.includes('preference === "zh-CN" || preference === "en-US"'), "explicit language preferences are not returned directly");
assert(i18n.includes('systemLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"'), "system language fallback does not map zh to zh-CN and non-zh to en-US");
assert(i18n.includes('value === "zh-CN" || value === "en-US" || value === "system" ? value : "system"'), "invalid language preferences do not normalize to system");
assert(i18n.includes("document.documentElement.lang = locale"), "setDocumentLocale does not write document.documentElement.lang");

const settingsBootstrap = sliceBetween(settings, "Promise.all([", "]);");
assert(settingsBootstrap.includes("settingsService.get(true)"), "settings window bootstrap does not load persisted settings through Settings Service");
assert(!settingsBootstrap.includes('"check_update"'), "settings window bootstrap still blocks on update check");
assert(settings.includes("const locale = resolveAppLocale(mergedSettings.language)"), "settings window does not resolve locale from persisted language");
assert(settings.includes("setDocumentLocale(locale)"), "settings window does not set document locale");
assert(settings.includes('window.document.title = t(locale, "window.settings.title")'), "settings document title is not localized");
assert(settings.includes('getCurrentWindow().setTitle(t(locale, "window.settings.title"))'), "settings window title is not localized");
const updateSettings = sliceBetween(settings, "function updateSettings", "async function refreshLogStats");
assert(updateSettings.includes("normalizeLanguagePreference(next.language)"), "settings updates do not normalize language preference");
assert(updateSettings.includes("const feedbackLocale = normalizedNext.language ? resolveAppLocale(normalizedNext.language) : locale"), "settings updates do not compute a target locale for immediate feedback");
assert(updateSettings.includes("setDocumentLocale(feedbackLocale)"), "settings language changes do not update document locale immediately");
assert(updateSettings.includes('window.document.title = t(feedbackLocale, "window.settings.title")'), "settings language changes do not update document title immediately");
assert(updateSettings.includes('getCurrentWindow().setTitle(t(feedbackLocale, "window.settings.title"))'), "settings language changes do not update window title immediately");
assert(updateSettings.includes('configStatus: t(feedbackLocale, "settings.status.configSynced")'), "settings language changes do not refresh config status copy in the target locale");
assert(updateSettings.includes('message: t(feedbackLocale, "settings.save.pending")'), "settings language changes do not refresh pending save copy in the target locale");
assert(updateSettings.includes('message: t(feedbackLocale, "settings.save.saved", { durationMs })'), "settings language changes do not refresh saved copy in the target locale");
const settingsChangedSubscription = sliceBetween(settings, "settingsService\n      .subscribe", ".catch(() =>");
assert(settingsChangedSubscription.includes("const nextSettings = normalizeAppSettings(document.settings)"), "settings_changed refresh does not normalize incoming settings");
assert(settingsChangedSubscription.includes("setDocumentLocale(locale)"), "settings_changed refresh does not update document locale");
assert(settingsChangedSubscription.includes('configStatus: t(locale, "settings.status.configSynced")'), "settings_changed refresh does not update config status copy");
assert(
  settingsChangedSubscription.includes('window.document.title = t(locale, "window.settings.title")'),
  "settings_changed refresh does not update settings document title",
);
assert(
  settingsChangedSubscription.includes('getCurrentWindow().setTitle(t(locale, "window.settings.title"))'),
  "settings_changed refresh does not update settings window title",
);

assert(app.includes("const initialLocale = resolveAppLocale(initialSettings.language)"), "main window initial locale is not resolved from saved settings");
assert(app.includes("const locale = resolveAppLocale(settings.language)"), "main window does not derive locale from current settings");
const appSettingsEffect = sliceBetween(app, "useEffect(() => {\n    settingsRef.current = settings;", "}, [settings]);");
assert(appSettingsEffect.includes("setDocumentLocale(locale)"), "main settings effect does not update document locale");
assert(appSettingsEffect.includes('window.document.title = t(locale, "window.main.title")'), "main settings effect does not update document title");
assert(appSettingsEffect.includes('getCurrentWindow().setTitle(t(locale, "window.main.title"))'), "main settings effect does not update localized window title");
assert(appSettingsEffect.includes('invoke<void>("write_user_settings", { settings })'), "main settings effect does not persist language/settings changes");

const currentNativeLocale = sliceBetween(rust, "fn current_native_locale()", "fn native_tr");
assert(currentNativeLocale.includes('.get("language")'), "native locale resolver does not read language from settings");
assert(currentNativeLocale.includes('"zh-CN" => "zh-CN"'), "native locale resolver does not honor zh-CN");
assert(currentNativeLocale.includes('"en-US" => "en-US"'), "native locale resolver does not honor en-US");
assert(currentNativeLocale.includes("_ => system_native_locale()"), "native system locale resolver does not use shared system fallback");
const systemNativeLocale = sliceBetween(rust, "fn system_native_locale()", "fn native_tr");
assert(systemNativeLocale.includes("fn native_system_language()"), "native system language helper is missing");
assert(systemNativeLocale.includes("macos_user_language()"), "native system language does not prefer macOS GUI language");
assert(systemNativeLocale.includes('std::env::var("LANG")'), "native system locale fallback does not read LANG");
assert(systemNativeLocale.includes('std::env::var("LC_ALL")'), "native system locale fallback does not read LC_ALL");
assert(systemNativeLocale.includes('std::env::var("LC_MESSAGES")'), "native system locale fallback does not read LC_MESSAGES");
assert(systemNativeLocale.includes('native_system_language().starts_with("zh")'), "native system locale fallback does not map zh locales");
assert(systemNativeLocale.includes('std::process::Command::new("defaults")'), "macOS native locale does not read AppleLanguages/AppleLocale");
assert(systemNativeLocale.includes('"AppleLanguages"'), "macOS native locale does not read AppleLanguages");
assert(systemNativeLocale.includes('"AppleLocale"'), "macOS native locale does not read AppleLocale");

const nativeTr = sliceBetween(rust, "fn native_tr", "#[tauri::command]\nfn append_app_log");
for (const key of [
  "window.settings.title",
  "tray.openQuick",
  "tray.preferences",
  "tray.pauseListening",
  "tray.resumeListening",
  "tray.quit",
]) {
  assert(nativeTr.includes(`(true, "${key}")`), `native_tr is missing zh mapping for ${key}`);
  assert(nativeTr.includes(`(false, "${key}")`), `native_tr is missing en mapping for ${key}`);
}

const trayMenu = sliceBetween(rust, "fn build_tray_menu", "fn setup_app");
assert(trayMenu.includes('native_tr("tray.openQuick")'), "tray openQuick label is not localized");
assert(trayMenu.includes('native_tr("tray.preferences")'), "tray preferences label is not localized");
assert(trayMenu.includes('native_tr("tray.resumeListening")'), "tray resume label is not localized");
assert(trayMenu.includes('native_tr("tray.pauseListening")'), "tray pause label is not localized");
assert(trayMenu.includes('native_tr("tray.quit")'), "tray quit label is not localized");

const legacySettingsUpdate = sliceBetween(rust, "fn update_clipforge_settings", "#[tauri::command]\nfn write_user_settings");
assert(legacySettingsUpdate.includes("build_tray_menu(&app)"), "legacy settings update does not rebuild tray menu after language changes");
assert(legacySettingsUpdate.includes("tray.set_menu(Some(menu))"), "legacy settings update does not apply rebuilt tray menu");
assert(legacySettingsUpdate.includes("emit_settings_changed("), "legacy settings update does not emit settings_changed after language changes");

assert(rust.includes("fn refresh_tray_menu_after_settings_write"), "Settings Service tray refresh helper is missing");
assert(rust.includes('log_dev_i18n_window_snapshot(app.clone(), "initial")'), "i18n dev probe does not record initial startup locale snapshot");
assert(rust.includes("documentLang: document.documentElement.lang"), "dev perf probe does not report document language");
assert(rust.includes("documentOverflowX"), "dev perf probe does not report document horizontal overflow");
assert(rust.includes("controlOverflowCount"), "dev perf probe does not report control overflow");
for (const [functionName, reason] of [
  ["settings_service_patch", "settings-service-patch"],
  ["settings_service_replace", "settings-service-replace"],
  ["settings_service_reset", "settings-service-reset"],
]) {
  const serviceWrite = sliceBetween(rust, `fn ${functionName}`, "let updated_at = now_millis()?");
  assert(
    serviceWrite.includes(`refresh_tray_menu_after_settings_write(&app, "${reason}")`),
    `${functionName} does not rebuild tray menu after language changes`,
  );
}

assert(zh["window.main.title"] && en["window.main.title"], "main window title keys are missing");
assert(zh["window.settings.title"] && en["window.settings.title"], "settings window title keys are missing");
assert(zh["settings.language.system"] && en["settings.language.system"], "language selector system labels are missing");
assert(zh["settings.language.zh"] && en["settings.language.zh"], "language selector zh labels are missing");
assert(zh["settings.language.en"] && en["settings.language.en"], "language selector en labels are missing");

if (!process.exitCode) {
  console.log("i18n runtime verification passed");
}
