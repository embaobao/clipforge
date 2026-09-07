import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

export type SettingsCodeTab = {
  value: string;
  label: string;
  language: "text" | "bash" | "json";
  content: string;
};

export type SettingsCodeTabsProps = {
  tabs: SettingsCodeTab[];
  copyLabel: string;
  onCopy: (tab: SettingsCodeTab) => void;
  className?: string;
};

/** MCP / Agent 示例专用 Code Tabs：代码内部滚动，复制动作贴近当前 tab。 */
export function SettingsCodeTabs({ tabs, copyLabel, onCopy, className }: SettingsCodeTabsProps) {
  const [activeTab, setActiveTab] = useState(tabs[0]?.value ?? "");
  const [copiedTab, setCopiedTab] = useState<string | null>(null);

  const handleCopy = () => {
    const tab = tabs.find((item) => item.value === activeTab) ?? tabs[0];
    if (!tab) return;
    onCopy(tab);
    setCopiedTab(tab.value);
    window.setTimeout(() => setCopiedTab(null), 1400);
  };

  return (
    <div className={className} data-dev-probe="settings-code-tabs">
      <Tabs defaultValue={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between gap-2">
          <TabsList className="inline-flex gap-1 rounded-lg bg-black/[0.04] p-0.5 dark:bg-white/[0.07]">
            {tabs.map((tab) => (
              <TabsTrigger
                className="h-7 rounded-[7px] px-2.5 text-[12px] font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm dark:data-[state=active]:bg-white/[0.14]"
                key={tab.value}
                value={tab.value}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button
            className="h-7 gap-1.5 rounded-md text-[12px]"
            onClick={handleCopy}
            size="sm"
            variant="ghost"
          >
            {copiedTab ? <Check size={13} /> : <Copy size={13} />}
            {copiedTab ? "已复制" : copyLabel}
          </Button>
        </div>
        {tabs.map((tab) => (
          <TabsContent className="mt-2" key={tab.value} value={tab.value}>
            <pre className="max-h-64 overflow-auto rounded-lg bg-black/[0.03] p-3 text-[12px] leading-relaxed dark:bg-white/[0.05]">
              <code>{tab.content}</code>
            </pre>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
