// 设置窗口外壳：系统原生标题栏 + 常驻侧栏 + 内容区 + 底部栏。
// 仅负责布局，不承载业务状态；红绿灯、拖拽和窗口标题由原生标题栏（decorations: true）提供。
// 视觉契约：内部不画竖向/底部分割线，侧栏与内容用背景色差分隔，底部用留白分隔。
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
  /** 版本号字符串，显示在底部左侧。 */
  version: string;
  /** 版本补充信息（发布渠道等），跟在版本号后以 · 分隔。 */
  versionMeta?: string;
  /** 底部常驻更新状态徽标（数据由调用方从 Rust update 检查结果计算）。 */
  updateBadge?: { tone: "idle" | "checking" | "ok" | "available" | "error"; label: string; detail?: string };
  /** 内容区子节点。 */
  children: ReactNode;
  /** 固定在滚动区外的底部状态条（保存反馈/后台状态），内容短也贴底。 */
  statusBar?: ReactNode;
  /** 恢复默认按钮回调（可选）。 */
  onReset?: () => void;
  /** 导出数据按钮回调（可选）。 */
  onExport?: () => void;
  /** 恢复默认按钮文案（i18n 由调用方注入，外壳不硬编码语言）。 */
  resetLabel?: string;
  /** 导出数据按钮文案。 */
  exportLabel?: string;
  className?: string;
}

/** 设置窗口外壳：原生标题栏 + 固定宽度常驻侧栏 + 留白分隔的内容区。 */
export function SettingsShell({
  activeId,
  items,
  onSelect,
  version,
  versionMeta,
  updateBadge,
  children,
  statusBar,
  onReset,
  onExport,
  resetLabel,
  exportLabel,
  className,
}: SettingsShellProps) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col overflow-hidden bg-card",
        className,
      )}
      data-surface="settings"
    >
      <div className="flex min-h-0 flex-1">
        {/* 侧栏：固定宽度常驻（icon + 文案），与内容区用背景色差分隔，不画竖线 */}
        <aside className="w-[172px] shrink-0 space-y-0.5 bg-black/[0.02] p-2 dark:bg-white/[0.03]">
          {items.map(({ id, label, icon: Icon }) => {
            const active = id === activeId;
            return (
              <button
                key={id}
                aria-label={label}
                className={cn(
                  "flex h-8 w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-[12.5px] transition-colors active:scale-[0.98]",
                  active
                    ? "bg-black/[0.06] font-medium text-foreground dark:bg-white/[0.1]"
                    : "text-muted-foreground hover:bg-black/[0.03] dark:hover:bg-white/[0.05]",
                )}
                onClick={() => onSelect(id)}
                title={label}
                type="button"
              >
                {Icon ? <Icon className="h-[14px] w-[14px] flex-shrink-0" size={14} /> : null}
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </aside>

        {/* 内容 */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto px-6 py-4">{children}</div>
          {/* 状态条固定在滚动区外，内容再短也贴底 */}
          {statusBar}

          {/* 底部：留白分隔，不画分割线 */}
          <div className="flex items-center justify-between gap-3 px-6 pb-2.5 pt-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="mono text-[10.5px] text-muted-foreground/70">{version}</span>
              {versionMeta ? (
                <span className="text-[10.5px] text-muted-foreground/70">· {versionMeta}</span>
              ) : null}
              {updateBadge ? (
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px]",
                    updateBadge.tone === "error" && "text-destructive",
                    updateBadge.tone === "ok" && "text-emerald-700 dark:text-emerald-400",
                    updateBadge.tone === "available" && "bg-black/[0.05] text-foreground dark:bg-white/[0.08]",
                    (updateBadge.tone === "idle" || updateBadge.tone === "checking") && "text-muted-foreground",
                  )}
                  title={updateBadge.detail}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      updateBadge.tone === "error" ? "bg-destructive" : null,
                      updateBadge.tone === "ok" ? "bg-emerald-600 dark:bg-emerald-400" : null,
                      updateBadge.tone === "available" ? "bg-foreground" : null,
                      updateBadge.tone === "idle" ? "bg-muted-foreground/50" : null,
                      updateBadge.tone === "checking" ? "animate-pulse bg-muted-foreground" : null,
                    )}
                  />
                  {updateBadge.label}
                </span>
              ) : null}
            </div>
            <div className="flex gap-1">
              {onReset ? (
                <button
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
                  onClick={onReset}
                  type="button"
                >
                  <RotateCcw className="h-3 w-3" />
                  {resetLabel ?? "恢复默认"}
                </button>
              ) : null}
              {onExport ? (
                <button
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
                  onClick={onExport}
                  type="button"
                >
                  <Download className="h-3 w-3" />
                  {exportLabel ?? "导出数据…"}
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
