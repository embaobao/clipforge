import { Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/primitives/animate/tooltip";

/** Code Tabs 的单个代码片段描述。 */
export type CodeTab = {
  value: string;
  label: string;
  language: "text" | "bash" | "json";
  content: string;
};

/** Code Tabs 组件参数，复制动作由调用方接业务剪贴板逻辑。 */
export type CodeTabsProps = {
  tabs: CodeTab[];
  copyLabel: string;
  onCopy: (tab: CodeTab) => void;
  className?: string;
};

/**
 * Animate UI Code Tabs 的本地 vendored 组件。
 *
 * 用现有 Animate Tabs 原语承载 tab 切换，组件只负责代码展示、语言标记和复制入口；
 * 长代码内部滚动，避免设置页被代码示例撑高。
 */
export function CodeTabs({
  tabs,
  copyLabel,
  onCopy,
  className,
}: CodeTabsProps) {
  const defaultValue = tabs[0]?.value ?? "";

  return (
    <Tabs className={cn("animate-code-tabs", className)} data-slot="code-tabs" defaultValue={defaultValue}>
      <TabsList className="animate-code-tabs-list" data-slot="code-tabs-list">
        {tabs.map((tab) => (
          <TabsTrigger className="animate-code-tabs-trigger" data-slot="code-tabs-trigger" key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContents className="animate-code-tabs-contents" data-slot="code-tabs-contents">
        {tabs.map((tab) => (
          <TabsContent className="animate-code-tabs-panel" data-slot="code-tabs-panel" key={tab.value} value={tab.value}>
            <div className="animate-code-tabs-toolbar" data-slot="code-tabs-toolbar">
              <span>{tab.language}</span>
              <Tooltip side="left" sideOffset={8}>
                <TooltipTrigger asChild>
                  <button
                    aria-label={`${copyLabel}: ${tab.label}`}
                    className="secondary-button"
                    data-dev-probe={`settings-code-copy:${tab.value}`}
                    data-slot="code-tabs-copy"
                    onClick={() => onCopy(tab)}
                    title={`${copyLabel}: ${tab.label}`}
                    type="button"
                  >
                    <Copy size={13} />
                    {copyLabel}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="settings-tooltip-content">
                  {copyLabel}: {tab.label}
                </TooltipContent>
              </Tooltip>
            </div>
            <pre className="animate-code-tabs-pre" data-slot="code-tabs-pre">{tab.content}</pre>
          </TabsContent>
        ))}
      </TabsContents>
    </Tabs>
  );
}
