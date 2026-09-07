import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import type { TranslationKey } from "@/i18n";

export interface WorkspaceCrumbProps {
  children?: ReactNode;
  onBack: () => void;
  subtitle?: string;
  title: string;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

/** 详情/聚合页面包屑：标题 + 副标题 + 操作区 + 关闭按钮。 */
export function WorkspaceCrumb({ children, onBack, subtitle, title, tr }: WorkspaceCrumbProps) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-black/[0.05] px-4 py-3 dark:border-white/[0.07]">
      <div className="min-w-0">
        <h1 className="truncate text-[13px] font-medium text-foreground">{title}</h1>
        {subtitle ? (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      <div aria-hidden="true" className="flex-1 cursor-grab active:cursor-grabbing" data-tauri-drag-region />
      <div className="flex items-center gap-1">
        {children}
        <Button
          aria-label={tr("main.detail.close")}
          className="h-7 w-7 rounded-md"
          onClick={onBack}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <X size={14} />
        </Button>
      </div>
    </header>
  );
}
