import type { KeyboardEvent } from "react";
import { CheckCircle2, ClipboardList, ShieldCheck } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { ToggleSetting } from "../../settings/controls";
import { OnboardingFeatureCard } from "./OnboardingFeatureCard";
import { OnboardingStep } from "./OnboardingStep";
import {
  CAPTURE_FIELDS,
  FEATURE_CARDS,
  STEPS,
  formatRecordedShortcut,
  getAccessibilityStatusClass,
  getAccessibilityStatusKey,
  isEditableTarget,
  type OnboardingWizardProps,
} from "./onboarding-wizard-shared";

const primaryButtonClass = "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-foreground px-3.5 text-[12px] font-medium text-background transition-[color,background-color,border-color,transform] hover:bg-foreground/90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40";
const secondaryButtonClass = "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border/60 px-3.5 text-[12px] transition-[color,background-color,border-color,transform] hover:bg-black/[0.05] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.08]";
const settingRowClass = "flex flex-wrap items-center justify-between gap-3 text-[12px]";

/** 五步设置引导：权限、采集范围、快捷键和功能速览都在引导窗口内闭环。
 *  容器支持 ←/→/Enter 键盘导航（录制快捷键或焦点在可编辑控件时避让）；写入走调用方注入的 updateSettings。 */
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
        <div className="flex gap-3 rounded-lg bg-black/[0.02] p-3 dark:bg-white/[0.04]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ClipboardList size={20} />
          </span>
          <div className="min-w-0">
            <strong className="text-[13px]">{tr("settings.onboarding.welcome.title")}</strong>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{tr("settings.onboarding.welcome.body")}</p>
          </div>
        </div>
      );
    }

    if (step.key === "accessibility") {
      return (
        <div className="space-y-3" data-dev-probe="onboarding-accessibility-panel">
          <div className={`flex gap-2.5 rounded-lg border p-3 ${accessibilityStatusClass}`}>
            {accessibility?.canReadFocusedInput ? <CheckCircle2 className="mt-0.5 shrink-0" size={16} /> : <ShieldCheck className="mt-0.5 shrink-0" size={16} />}
            <div className="min-w-0">
              <strong className="text-[12px]">{tr(accessibilityStatusKey)}</strong>
              <p className="mt-0.5 text-[11px] leading-relaxed opacity-80">{accessibility?.message || tr("settings.onboarding.accessibility.fallbackMessage")}</p>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button className={primaryButtonClass} data-dev-probe="onboarding-accessibility-request" onClick={() => void openAccessibilitySettings()} type="button">
              <ShieldCheck size={13} />
              {tr("settings.onboarding.accessibility.request")}
            </button>
            <button className={secondaryButtonClass} data-dev-probe="onboarding-accessibility-refresh" onClick={() => void refreshAccessibilityStatus()} type="button">
              {tr("settings.onboarding.accessibility.refresh")}
            </button>
          </div>
        </div>
      );
    }

    if (step.key === "capture") {
      return (
        <div className="space-y-2" data-dev-probe="onboarding-capture-panel">
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2" data-dev-probe="onboarding-capture-toggles">
            {CAPTURE_FIELDS.map((field) => (
              <ToggleSetting
                checked={Boolean(settings[field.key])}
                key={field.key}
                label={tr(field.labelKey)}
                onChange={(checked) => updateSettings({ [field.key]: checked })}
              />
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">{tr("settings.onboarding.capture.note")}</p>
        </div>
      );
    }

    if (step.key === "shortcut") {
      return (
        <div className="space-y-2.5" data-dev-probe="onboarding-shortcut-panel">
          <div className={settingRowClass}>
            <span className="text-muted-foreground">{tr("settings.onboarding.shortcut.current")}</span>
            <div className="flex gap-1">
              {shortcutParts.map((part) => (
                <kbd className="rounded border bg-black/[0.03] px-1.5 py-0.5 font-mono text-[11px] dark:bg-white/[0.06]" key={part}>{part}</kbd>
              ))}
            </div>
          </div>
          <div className={settingRowClass}>
            <label className="text-muted-foreground" htmlFor={manualShortcutId}>{tr("settings.onboarding.shortcut.manual")}</label>
            <input
              className="h-8 w-44 rounded-md border border-border/60 bg-transparent px-2 text-[12px] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
              id={manualShortcutId}
              onChange={(event) => updateSettings({ globalShortcut: event.currentTarget.value })}
              type="text"
              value={settings.globalShortcut}
            />
          </div>
          <div className={settingRowClass}>
            <span className="text-muted-foreground">{tr("settings.onboarding.shortcut.record")}</span>
            <button
              className={recordingShortcut ? primaryButtonClass : secondaryButtonClass}
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
          <p className="text-[11px] text-muted-foreground">{tr("settings.onboarding.shortcut.note")}</p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {FEATURE_CARDS.map((feature) => (
          <OnboardingFeatureCard bodyKey={feature.bodyKey} icon={feature.icon} key={feature.titleKey} titleKey={feature.titleKey} tr={tr} />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-5 px-6 py-8 outline-none" data-dev-probe="onboarding-wizard" onKeyDown={handleWizardKeyDown} tabIndex={0}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{tr("settings.onboarding.eyebrow")}</span>
          <h2 className="mt-1 text-[17px] font-semibold">{tr("settings.onboarding.title")}</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">{tr("settings.onboarding.description")}</p>
        </div>
        {settings.onboardingCompleted ? (
          <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 size={15} />
            <span>{tr("settings.onboarding.completed.badge")}</span>
          </div>
        ) : null}
      </div>

      {settings.onboardingCompleted ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2 text-[12px] text-emerald-700 dark:text-emerald-400" role="status">
          <CheckCircle2 size={16} />
          <span>{tr("settings.onboarding.completed.description")}</span>
        </div>
      ) : null}

      <div aria-label={tr("settings.onboarding.stepperLabel")} className="flex gap-1.5" data-dev-probe="onboarding-stepper">
        {STEPS.map((item, index) => (
          <button
            aria-label={`${index + 1}. ${tr(item.titleKey)}`}
            aria-current={index === stepIndex ? "step" : undefined}
            className={`relative flex h-7 w-7 items-center justify-center rounded-full border text-[11px] transition-[color,background-color,border-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 before:absolute before:-inset-0.5 before:content-[''] ${index === stepIndex ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"}`}
            data-dev-probe={`onboarding-step:${item.key}`}
            key={item.key}
            onClick={() => setStepIndex(index)}
            type="button"
          >
            <span>{index + 1}</span>
          </button>
        ))}
      </div>

      <OnboardingStep
        descriptionKey={step.descriptionKey}
        stepKey={step.key}
        titleKey={step.titleKey}
        tr={tr}
      >
        {renderStepContent()}
      </OnboardingStep>

      <div className="flex items-center justify-end gap-1.5">
        <button
          className={secondaryButtonClass}
          disabled={isFirstStep}
          onClick={() => setStepIndex((current) => Math.max(current - 1, 0))}
          type="button"
        >
          {tr("settings.onboarding.action.back")}
        </button>
        {!settings.onboardingCompleted ? (
          <button className={secondaryButtonClass} data-dev-probe="onboarding-skip" onClick={skipWizard} type="button">
            {tr("settings.onboarding.action.skip")}
          </button>
        ) : null}
        <button className={primaryButtonClass} data-dev-probe="onboarding-primary" onClick={goNext} type="button">
          {primaryActionLabel}
        </button>
      </div>
    </div>
  );
}
