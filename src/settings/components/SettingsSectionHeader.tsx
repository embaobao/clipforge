import type { ComponentType, ReactNode } from "react";

export type SettingsSectionHeaderProps = {
  title: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  leading?: ReactNode;
  children?: ReactNode;
};

/** 设置内容区标题：为每个一级分类提供稳定的当前位置和状态承载点。 */
export function SettingsSectionHeader({
  title,
  icon: Icon,
  leading,
  children,
}: SettingsSectionHeaderProps) {
  return (
    <header className="sticky top-[-20px] z-10 flex min-h-10 items-center justify-between gap-3 bg-background/95 pb-2 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        {leading}
        {Icon ? <Icon className="text-muted-foreground" size={17} /> : null}
        <h2 className="truncate text-xl font-semibold leading-tight text-foreground">{title}</h2>
      </div>
      {children ? <div className="flex min-w-0 items-center justify-end">{children}</div> : null}
    </header>
  );
}
