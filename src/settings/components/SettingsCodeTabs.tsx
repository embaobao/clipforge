import { CodeTabs } from "@/components/animate-ui/components/animate/code-tabs";

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
export function SettingsCodeTabs({
  tabs,
  copyLabel,
  onCopy,
  className,
}: SettingsCodeTabsProps) {
  return (
    <div className="settings-code-tabs-wrap" data-dev-probe="settings-code-tabs">
      <CodeTabs className={className} copyLabel={copyLabel} tabs={tabs} onCopy={onCopy} />
    </div>
  );
}
