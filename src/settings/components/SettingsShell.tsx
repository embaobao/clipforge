// 设置窗口外壳：标题栏 + 172px 侧栏 + 内容区。
// 按 design.md 规格 7 实现，仅负责布局，不承载业务状态。
import type { ComponentType, ReactNode } from "react";
import { Download, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SettingsNavItem {
  id: string;
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
}

export interface SettingsShellProps {
  /** 当前选中导航 id。 */
  activeId: string;
  /** 导航项列表。 */
  items: SettingsNavItem[];
  /** 导航点击回调。 */
  onSelect: (id: string) => void;
  /** 当前分类标题（显示在内容区顶部）。 */
  title: string;
  /** 版本号字符串，显示在底部左侧。 */
  version: string;
  /** 内容区子节点。 */
  children: ReactNode;
  /** 恢复默认按钮回调（可选）。 */
  onReset?: () => void;
  /** 导出数据按钮回调（可选）。 */
  onExport?: () => void;
  className?: string;
}

/** 设置窗口外壳：符合 design.md 规格 7。 */
export function SettingsShell({
  activeId,
  items,
  onSelect,
  title,
  version,
  children,
  onReset,
  onExport,
  className,
}: SettingsShellProps) {
  return (
    <div
      className={cn(
        "panel-in flex h-full w-full flex-col overflow-hidden rounded-[12px] bg-card window-shadow",
        className,
      )}
      data-surface="settings"
    >
      {/* 标题栏 */}
      <div className="relative flex h-11 items-center justify-center border-b border-black/[0.05] dark:border-white/[0.07]">
        <div className="absolute left-4 flex items-center gap-2">
          <span className="h-[11px] w-[11px] rounded-full bg-[#FF5F57]" />
          <span className="h-[11px] w-[11px] rounded-full bg-[#FEBC2E]" />
          <span className="h-[11px] w-[11px] rounded-full bg-[#28C840]" />
        </div>
        <span className="text-[13px] font-medium">{title}</span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 侧栏 */}
        <aside className="w-[200px] shrink-0 space-y-px border-r border-black/[0.05] bg-black/[0.02] p-2 dark:border-white/[0.07] dark:bg-white/[0.03]">
          {items.map(({ id, label, icon: Icon }) => {
            const active = id === activeId;
            return (
              <button
                key={id}
                className={cn(
                  "flex h-8 w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-[12.5px] transition-colors duration-100 active:scale-[0.98]",
                  active
                    ? "bg-black/[0.06] font-medium text-foreground dark:bg-white/[0.1]"
                    : "text-muted-foreground hover:bg-black/[0.03] dark:hover:bg-white/[0.05]",
                )}
                onClick={() => onSelect(id)}
                title={label}
                type="button"
              >
                {Icon ? <Icon className="h-[13px] w-[13px] flex-shrink-0" size={13} /> : null}
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </aside>

        {/* 内容 */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto px-5 py-2">{children}</div>

          {/* 底部 */}
          <div className="flex items-center justify-between border-t border-black/[0.05] px-5 py-3 dark:border-white/[0.07]">
            <span className="mono text-[10.5px] text-muted-foreground/70">{version}</span>
            <div className="flex gap-1">
              {onReset ? (
                <button
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
                  onClick={onReset}
                  type="button"
                >
                  <RotateCcw className="h-3 w-3" />
                  恢复默认
                </button>
              ) : null}
              {onExport ? (
                <button
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
                  onClick={onExport}
                  type="button"
                >
                  <Download className="h-3 w-3" />
                  导出数据…
                </button>
              ) : null}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default SettingsShell;
