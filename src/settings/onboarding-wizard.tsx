import type { KeyboardEvent } from "react";
import { useId, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ClipboardList,
  FileImage,
  Heart,
  Keyboard,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { ToggleSetting } from "./controls";
import type { TranslationKey } from "../i18n";

type OnboardingStepKey = "welcome" | "accessibility" | "capture" | "shortcut" | "tour";

interface OnboardingSettings {
  onboardingCompleted: boolean;
  captureTextEnabled: boolean;
  captureHtmlEnabled: boolean;
  captureRtfEnabled: boolean;
  captureImageEnabled: boolean;
  captureFileEnabled: boolean;
  captureSensitiveEnabled: boolean;
  globalShortcut: string;
}

interface OnboardingAccessibility {
  canReadFocusedInput: boolean;
  status: "granted" | "missing" | "denied" | "unsupported";
  message: string;
}

/** 设置页初次引导组件的入参：只复用设置页已有状态与写入能力，不直接调用 Tauri 命令。 */
export interface OnboardingWizardProps {
  settings: OnboardingSettings;
  updateSettings: (next: Partial<OnboardingSettings>) => void;
  accessibility: OnboardingAccessibility | null;
  openAccessibilitySettings: () => void | Promise<void>;
  refreshAccessibilityStatus: () => void | Promise<void>;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const STEPS: Array<{ key: OnboardingStepKey; titleKey: TranslationKey; descriptionKey: TranslationKey }> = [
  {
    key: "welcome",
    titleKey: "settings.onboarding.step.welcome.title",
    descriptionKey: "settings.onboarding.step.welcome.description",
  },
  {
    key: "accessibility",
    titleKey: "settings.onboarding.step.accessibility.title",
    descriptionKey: "settings.onboarding.step.accessibility.description",
  },
  {
    key: "capture",
    titleKey: "settings.onboarding.step.capture.title",
    descriptionKey: "settings.onboarding.step.capture.description",
  },
  {
    key: "shortcut",
    titleKey: "settings.onboarding.step.shortcut.title",
    descriptionKey: "settings.onboarding.step.shortcut.description",
  },
  {
    key: "tour",
    titleKey: "settings.onboarding.step.tour.title",
    descriptionKey: "settings.onboarding.step.tour.description",
  },
];

const CAPTURE_FIELDS: Array<{
  key: keyof Pick<
    OnboardingSettings,
    | "captureTextEnabled"
    | "captureHtmlEnabled"
    | "captureRtfEnabled"
    | "captureImageEnabled"
    | "captureFileEnabled"
    | "captureSensitiveEnabled"
  >;
  labelKey: TranslationKey;
}> = [
  { key: "captureTextEnabled", labelKey: "settings.onboarding.capture.text" },
  { key: "captureHtmlEnabled", labelKey: "settings.onboarding.capture.html" },
  { key: "captureRtfEnabled", labelKey: "settings.onboarding.capture.rtf" },
  { key: "captureImageEnabled", labelKey: "settings.onboarding.capture.image" },
  { key: "captureFileEnabled", labelKey: "settings.onboarding.capture.file" },
  { key: "captureSensitiveEnabled", labelKey: "settings.onboarding.capture.sensitive" },
];

const FEATURE_CARDS: Array<{ icon: typeof ClipboardList; titleKey: TranslationKey; bodyKey: TranslationKey }> = [
  {
    icon: Search,
    titleKey: "settings.onboarding.feature.search.title",
    bodyKey: "settings.onboarding.feature.search.body",
  },
  {
    icon: Heart,
    titleKey: "settings.onboarding.feature.favorite.title",
    bodyKey: "settings.onboarding.feature.favorite.body",
  },
  {
    icon: Trash2,
    titleKey: "settings.onboarding.feature.trash.title",
    bodyKey: "settings.onboarding.feature.trash.body",
  },
  {
    icon: Bot,
    titleKey: "settings.onboarding.feature.agent.title",
    bodyKey: "settings.onboarding.feature.agent.body",
  },
];

function getAccessibilityStatusKey(accessibility: OnboardingAccessibility | null): TranslationKey {
  if (!accessibility) return "settings.onboarding.accessibility.status.loading";
  if (accessibility.canReadFocusedInput || accessibility.status === "granted") {
    return "settings.onboarding.accessibility.status.granted";
  }
  if (accessibility.status === "denied") return "settings.onboarding.accessibility.status.denied";
  if (accessibility.status === "unsupported") return "settings.onboarding.accessibility.status.unsupported";
  return "settings.onboarding.accessibility.status.missing";
}

function getAccessibilityStatusClass(accessibility: OnboardingAccessibility | null): string {
  if (!accessibility) return "loading";
  if (accessibility.canReadFocusedInput || accessibility.status === "granted") return "granted";
  return accessibility.status;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || target.isContentEditable;
}

function formatRecordedShortcut(event: KeyboardEvent<HTMLElement>): string | null {
  const key = event.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return null;
  const parts: string[] = [];
  if (event.metaKey) parts.push("Command");
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Option");
  if (event.shiftKey) parts.push("Shift");
  const normalizedKey =
    key === " "
      ? "Space"
      : key.length === 1
        ? key.toUpperCase()
        : key.replace(/^Arrow/, "");
  if (!parts.includes(normalizedKey)) parts.push(normalizedKey);
  return parts.join("+");
}

/** 五步设置引导：权限、采集范围、快捷键和功能速览都在设置页内闭环。 */
export function OnboardingWizard({
  settings,
  updateSettings,
  accessibility,
  openAccessibilitySettings,
  refreshAccessibilityStatus,
  tr,
}: OnboardingWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const manualShortcutId = useId();
  const step = STEPS[stepIndex] ?? STEPS[0];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === STEPS.length - 1;
  const accessibilityStatusKey = getAccessibilityStatusKey(accessibility);
  const accessibilityStatusClass = getAccessibilityStatusClass(accessibility);
  const primaryActionLabel = isLastStep
    ? tr(settings.onboardingCompleted ? "settings.onboarding.action.done" : "settings.onboarding.action.finish")
    : tr("settings.onboarding.action.next");
  const shortcutParts = useMemo(
    () => settings.globalShortcut.split("+").filter(Boolean),
    [settings.globalShortcut],
  );

  function markCompleted() {
    updateSettings({ onboardingCompleted: true });
  }

  function skipWizard() {
    setStepIndex(STEPS.length - 1);
    markCompleted();
  }

  function goNext() {
    if (isLastStep) {
      markCompleted();
      return;
    }
    setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
  }

  function handleWizardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (recordingShortcut || isEditableTarget(event.target)) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setStepIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter" && event.target === event.currentTarget) {
      event.preventDefault();
      goNext();
    }
  }

  function handleShortcutRecording(event: KeyboardEvent<HTMLButtonElement>) {
    if (!recordingShortcut) return;
    event.preventDefault();
    event.stopPropagation();
    const nextShortcut = formatRecordedShortcut(event);
    if (!nextShortcut) return;
    updateSettings({ globalShortcut: nextShortcut });
    setRecordingShortcut(false);
  }

  function renderStepContent() {
    if (step.key === "welcome") {
      return (
        <div className="onboarding-panel onboarding-welcome-panel">
          <div className="onboarding-panel-icon">
            <ClipboardList size={20} />
          </div>
          <div>
            <strong>{tr("settings.onboarding.welcome.title")}</strong>
            <p>{tr("settings.onboarding.welcome.body")}</p>
          </div>
        </div>
      );
    }

    if (step.key === "accessibility") {
      return (
        <div className="onboarding-panel" data-dev-probe="onboarding-accessibility-panel">
          <div className={`onboarding-permission-status ${accessibilityStatusClass}`}>
            {accessibility?.canReadFocusedInput ? <CheckCircle2 size={16} /> : <ShieldCheck size={16} />}
            <div>
              <strong>{tr(accessibilityStatusKey)}</strong>
              <p>{accessibility?.message || tr("settings.onboarding.accessibility.fallbackMessage")}</p>
            </div>
          </div>
          <div className="button-row">
            <button className="primary-button" data-dev-probe="onboarding-accessibility-request" onClick={() => void openAccessibilitySettings()} type="button">
              <ShieldCheck size={13} />
              {tr("settings.onboarding.accessibility.request")}
            </button>
            <button className="secondary-button" data-dev-probe="onboarding-accessibility-refresh" onClick={() => void refreshAccessibilityStatus()} type="button">
              {tr("settings.onboarding.accessibility.refresh")}
            </button>
          </div>
        </div>
      );
    }

    if (step.key === "capture") {
      return (
        <div className="onboarding-panel" data-dev-probe="onboarding-capture-panel">
          <div className="onboarding-field-grid" data-dev-probe="onboarding-capture-toggles">
            {CAPTURE_FIELDS.map((field) => (
              <ToggleSetting
                checked={Boolean(settings[field.key])}
                key={field.key}
                label={tr(field.labelKey)}
                onChange={(checked) => updateSettings({ [field.key]: checked })}
              />
            ))}
          </div>
          <p className="onboarding-note">{tr("settings.onboarding.capture.note")}</p>
        </div>
      );
    }

    if (step.key === "shortcut") {
      return (
        <div className="onboarding-panel" data-dev-probe="onboarding-shortcut-panel">
          <div className="setting-row onboarding-shortcut-row">
            <span>{tr("settings.onboarding.shortcut.current")}</span>
            <div className="kbd-row">
              {shortcutParts.map((part) => (
                <kbd key={part}>{part}</kbd>
              ))}
            </div>
          </div>
          <div className="setting-row onboarding-shortcut-row">
            <label htmlFor={manualShortcutId}>{tr("settings.onboarding.shortcut.manual")}</label>
            <input
              id={manualShortcutId}
              onChange={(event) => updateSettings({ globalShortcut: event.currentTarget.value })}
              type="text"
              value={settings.globalShortcut}
            />
          </div>
          <div className="setting-row onboarding-shortcut-row">
            <span>{tr("settings.onboarding.shortcut.record")}</span>
            <button
              className={recordingShortcut ? "primary-button" : "secondary-button"}
              onClick={(event) => {
                setRecordingShortcut(true);
                event.currentTarget.focus();
              }}
              onKeyDown={handleShortcutRecording}
              type="button"
            >
              {recordingShortcut
                ? tr("settings.onboarding.shortcut.recording")
                : tr("settings.onboarding.shortcut.startRecording")}
            </button>
          </div>
          <p className="onboarding-note">{tr("settings.onboarding.shortcut.note")}</p>
        </div>
      );
    }

    return (
      <div className="onboarding-feature-grid">
        {FEATURE_CARDS.map((feature) => {
          const Icon = feature.icon;
          return (
            <div className="onboarding-feature-card" key={feature.titleKey}>
              <span className="onboarding-feature-icon">
                <Icon size={16} />
              </span>
              <div>
                <strong>{tr(feature.titleKey)}</strong>
                <p>{tr(feature.bodyKey)}</p>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="onboarding-wizard" data-dev-probe="onboarding-wizard" onKeyDown={handleWizardKeyDown} tabIndex={0}>
      <div className="onboarding-wizard-header">
        <div>
          <span className="onboarding-eyebrow">{tr("settings.onboarding.eyebrow")}</span>
          <h2>{tr("settings.onboarding.title")}</h2>
          <p>{tr("settings.onboarding.description")}</p>
        </div>
        {settings.onboardingCompleted ? (
          <div className="onboarding-completed-badge">
            <CheckCircle2 size={15} />
            <span>{tr("settings.onboarding.completed.badge")}</span>
          </div>
        ) : null}
      </div>

      {settings.onboardingCompleted ? (
        <div className="onboarding-completed-state" role="status">
          <CheckCircle2 size={16} />
          <span>{tr("settings.onboarding.completed.description")}</span>
        </div>
      ) : null}

      <div className="onboarding-stepper" aria-label={tr("settings.onboarding.stepperLabel")} data-dev-probe="onboarding-stepper">
        {STEPS.map((item, index) => (
          <button
            aria-label={`${index + 1}. ${tr(item.titleKey)}`}
            aria-current={index === stepIndex ? "step" : undefined}
            className={index === stepIndex ? "active" : ""}
            data-dev-probe={`onboarding-step:${item.key}`}
            key={item.key}
            onClick={() => setStepIndex(index)}
            type="button"
          >
            <span>{index + 1}</span>
          </button>
        ))}
      </div>

      <section className="onboarding-step-card" key={step.key}>
        <div className="onboarding-step-title">
          {step.key === "accessibility" ? (
            <ShieldCheck size={18} />
          ) : step.key === "capture" ? (
            <FileImage size={18} />
          ) : step.key === "shortcut" ? (
            <Keyboard size={18} />
          ) : (
            <ClipboardList size={18} />
          )}
          <div>
            <h3>{tr(step.titleKey)}</h3>
            <p>{tr(step.descriptionKey)}</p>
          </div>
        </div>
        {renderStepContent()}
      </section>

      <div className="onboarding-actions">
        <button
          className="secondary-button"
          disabled={isFirstStep}
          onClick={() => setStepIndex((current) => Math.max(current - 1, 0))}
          type="button"
        >
          {tr("settings.onboarding.action.back")}
        </button>
        {!settings.onboardingCompleted ? (
          <button className="secondary-button" data-dev-probe="onboarding-skip" onClick={skipWizard} type="button">
            {tr("settings.onboarding.action.skip")}
          </button>
        ) : null}
        <button className="primary-button" data-dev-probe="onboarding-primary" onClick={goNext} type="button">
          {primaryActionLabel}
        </button>
      </div>
    </div>
  );
}
