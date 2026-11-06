// 引导窗口分步指示器：五步圆点（序号 + 当前态高亮），点击直达任意步骤。
// 边界：纯展示受控组件，步骤切换经 onStepClick 上抛（统一走 Wizard 的 goToStep，保证日志同源）；
// 视觉走 Tailwind 语义类，无独立 CSS。
import { STEPS } from "./components/onboarding-wizard-shared";
import type { TranslationKey } from "../i18n";

export interface OnboardingStepperProps {
  /** 当前步骤下标（0 起）。 */
  stepIndex: number;
  /** 点击第 index 步回调。 */
  onStepClick: (index: number) => void;
  /** i18n 注入（步骤标题用于 aria-label）。 */
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

/** 分步指示器：横向圆点列，当前步反色高亮，aria-current 标记。 */
export function OnboardingStepper({ stepIndex, onStepClick, tr }: OnboardingStepperProps) {
  return (
    <div aria-label={tr("settings.onboarding.stepperLabel")} className="flex gap-1.5" data-dev-probe="onboarding-stepper">
      {STEPS.map((item, index) => (
        <button
          aria-label={`${index + 1}. ${tr(item.titleKey)}`}
          aria-current={index === stepIndex ? "step" : undefined}
          className={`relative flex h-7 w-7 items-center justify-center rounded-full border text-[11px] transition-[color,background-color,border-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 before:absolute before:-inset-0.5 before:content-[''] ${index === stepIndex ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"}`}
          data-dev-probe={`onboarding-step:${item.key}`}
          key={item.key}
          onClick={() => onStepClick(index)}
          type="button"
        >
          <span>{index + 1}</span>
        </button>
      ))}
    </div>
  );
}

export default OnboardingStepper;
