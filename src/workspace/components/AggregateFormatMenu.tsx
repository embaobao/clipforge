// 聚合拼接格式弹出菜单（TASK-6-A）：分隔符档位 / 编号开关 / 条目顺序二选一。
// 挂在 MultiAggregateWorkspace 的「模板」占位按钮上，复制与预览共用同一份格式配置。
import { Check, FileText, ListOrdered } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import type { AggregateFormatOptions, AggregateOrder, AggregateSeparator } from "../../clipboard/clipboard-domain";
import type { TrFunction } from "../../clipboard/clipboard-domain";

const menuTriggerClass = "inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-[12px] transition-[color,background-color,border-color,transform] hover:bg-black/[0.05] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-white/[0.08]";
const menuItemClass = "cursor-pointer text-[12px]";
const menuLabelClass = "px-2 py-1 text-[11px] text-muted-foreground";

export interface AggregateFormatMenuProps {
  format: AggregateFormatOptions;
  tr: TrFunction;
  onChange: (next: AggregateFormatOptions) => void;
}

const SEPARATORS: { value: AggregateSeparator; labelKey: Parameters<TrFunction>[0] }[] = [
  { value: "blank", labelKey: "main.aggregate.separatorBlank" },
  { value: "newline", labelKey: "main.aggregate.separatorNewline" },
  { value: "space", labelKey: "main.aggregate.separatorSpace" },
  { value: "custom", labelKey: "main.aggregate.separatorCustom" },
];

const ORDERS: { value: AggregateOrder; labelKey: Parameters<TrFunction>[0] }[] = [
  { value: "selected", labelKey: "main.aggregate.orderSelected" },
  { value: "time", labelKey: "main.aggregate.orderTime" },
];

/** 聚合格式菜单：模板按钮作为入口；选中项由 radio/checkbox 指示器呈现。 */
export function AggregateFormatMenu({ format, tr, onChange }: AggregateFormatMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={menuTriggerClass} type="button">
        <FileText size={13} />
        {tr("main.aggregate.template")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[13rem]">
        <DropdownMenuLabel className={menuLabelClass}>{tr("main.aggregate.separator")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          onValueChange={(value) => onChange({ ...format, separator: value as AggregateSeparator })}
          value={format.separator}
        >
          {SEPARATORS.map((item) => (
            <DropdownMenuRadioItem className={menuItemClass} key={item.value} value={item.value}>
              {tr(item.labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {format.separator === "custom" ? (
          <div className="px-2 py-1.5">
            <input
              aria-label={tr("main.aggregate.customSeparator")}
              className="w-full rounded-md border border-border/60 bg-transparent px-2 py-1 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              onChange={(event) => onChange({ ...format, customSeparator: event.target.value })}
              placeholder={tr("main.aggregate.customSeparatorPlaceholder")}
              value={format.customSeparator}
            />
          </div>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={format.numbered}
          className={menuItemClass}
          onSelect={(event) => {
            // 阻止 radix 关闭菜单：勾选编号后仍可继续改其它选项。
            event.preventDefault();
            onChange({ ...format, numbered: !format.numbered });
          }}
        >
          <ListOrdered size={12} />
          {tr("main.aggregate.numbered")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className={menuLabelClass}>{tr("main.aggregate.order")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup onValueChange={(value) => onChange({ ...format, order: value as AggregateOrder })} value={format.order}>
          {ORDERS.map((item) => (
            <DropdownMenuRadioItem className={menuItemClass} key={item.value} value={item.value}>
              {tr(item.labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <p className="px-2 py-1 text-[11px] leading-relaxed text-muted-foreground">{tr("main.aggregate.nonTextHint")}</p>
        <p className="flex items-center gap-1 px-2 pb-1 text-[11px] text-muted-foreground">
          <Check size={11} className="shrink-0" />
          {tr("main.aggregate.formatSharedHint")}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default AggregateFormatMenu;
