import type { LucideIcon } from "lucide-react";
import type { TranslationKey } from "../../i18n";

export type OnboardingFeatureCardProps = {
  icon: LucideIcon;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

/** 功能速览卡片：图标块 + 标题 + 一句话说明，用于引导向导的 tour 步。 */
export function OnboardingFeatureCard({ icon: Icon, titleKey, bodyKey, tr }: OnboardingFeatureCardProps) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-border/60 p-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-foreground dark:bg-white/[0.07]">
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <strong className="block text-[12px]">{tr(titleKey)}</strong>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{tr(bodyKey)}</p>
      </div>
    </div>
  );
}
