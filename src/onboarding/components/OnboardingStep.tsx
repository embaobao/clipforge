import { ClipboardList, FileImage, Keyboard, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { TranslationKey } from "../../i18n";
import type { OnboardingStepKey } from "./onboarding-wizard-shared";

export type OnboardingStepProps = {
  stepKey: OnboardingStepKey;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  children: ReactNode;
};

/** 步骤卡外壳：按步骤语义选择图标，展示标题/描述并承载步骤内容（key 切换触发重挂载动画位）。 */
export function OnboardingStep({ stepKey, titleKey, descriptionKey, tr, children }: OnboardingStepProps) {
  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-card/50 p-4">
      <div className="flex gap-2.5">
        {stepKey === "accessibility" ? (
          <ShieldCheck className="mt-0.5 shrink-0 text-muted-foreground" size={18} />
        ) : stepKey === "capture" ? (
          <FileImage className="mt-0.5 shrink-0 text-muted-foreground" size={18} />
        ) : stepKey === "shortcut" ? (
          <Keyboard className="mt-0.5 shrink-0 text-muted-foreground" size={18} />
        ) : (
          <ClipboardList className="mt-0.5 shrink-0 text-muted-foreground" size={18} />
        )}
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium">{tr(titleKey)}</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{tr(descriptionKey)}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
