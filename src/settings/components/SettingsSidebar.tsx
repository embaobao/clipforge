import type { ComponentType, ReactNode } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/animate-ui/components/radix/sidebar";

export type SettingsSidebarItem = {
  id: string;
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  badge?: ReactNode;
};

export type SettingsSidebarProps = {
  items: SettingsSidebarItem[];
  activeId: string;
  onChange: (id: string) => void;
  label: string;
  className?: string;
  collapsible?: "offcanvas" | "icon" | "none";
};

/** 设置页侧边栏：按 Animate UI Sidebar 组合组件组织一级分类导航。 */
export function SettingsSidebar({
  items,
  activeId,
  onChange,
  label,
  className,
  collapsible = "icon",
}: SettingsSidebarProps) {
  return (
    <Sidebar aria-label={label} className={className} collapsible={collapsible}>
      <SidebarHeader className="p-2">
        <div className="flex h-9 items-center gap-2 px-1 text-[13px] font-semibold text-foreground">
          <span className="grid size-7 place-items-center rounded-md border border-border bg-background text-[11px] shadow-sm">CF</span>
          <span className="truncate group-data-[collapsible=icon]:hidden">ClipForge</span>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-1">
        <SidebarGroup className="p-0">
          <SidebarGroupLabel className="px-2 text-[11px] font-medium text-muted-foreground">{label}</SidebarGroupLabel>
          <SidebarMenu className="m-0 list-none gap-1 p-0">
            {items.map((item) => {
              const Icon = item.icon;
              const active = item.id === activeId;
              return (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    className="h-8 rounded-md border-0 bg-transparent px-2 text-[13px] font-medium text-muted-foreground shadow-none data-[active=true]:bg-accent data-[active=true]:text-accent-foreground data-[active=true]:shadow-sm"
                    data-dev-probe={`settings-nav:${item.id}`}
                    isActive={active}
                    onClick={() => onChange(item.id)}
                    tooltip={item.label}
                  >
                    {Icon ? <Icon className="text-muted-foreground" size={16} /> : null}
                    <span className="truncate">{item.label}</span>
                    {item.badge ? (
                      <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="mt-auto h-2 p-2" />
      <SidebarRail aria-hidden className="border-0 bg-transparent p-0 shadow-none after:bg-border hover:after:bg-foreground/20" tabIndex={-1} />
    </Sidebar>
  );
}
