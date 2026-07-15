// 设置页通用控件组件集合。
// 从 src/settings.tsx 抽出，保持 props 签名不变，调用方无需改动。
// - SegmentSetting 已升级为 Animate UI ToggleGroup 原语（方向键导航 / roving focus / 滑动高亮由原语提供）。
// - 其余控件为纯展示组件，逻辑与原实现一致。

import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/animate-ui/components/animate/toggle-group";

/** 设置分组容器：标题 + 内容体 */
export function SettingGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="setting-group">
      <h3>{title}</h3>
      <div className="setting-group-body">{children}</div>
    </div>
  );
}

/**
 * 单选分段控件。
 *
 * Inc3 升级：改用 Animate UI 的 ToggleGroup 原语（底层 Radix ToggleGroupPrimitive）。
 * - 方向键导航、roving focus、ARIA radiogroup 语义、滑动高亮动效全部由原语提供，无需手写 onKeyDown。
 * - 设置项不允许反选：onValueChange 收到空串（取消选中）时直接忽略。
 * - props 签名（label?/options/selected/onChange）保持不变，调用方无需改动。
 */
export function SegmentSetting<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label?: string;
  options: Array<{ value: T; label: string }>;
  selected: T;
  onChange: (value: T) => void;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={selected}
      onValueChange={(value) => {
        // 设置项不允许反选：原语在取消选中时会回传空串，这里再次忽略，双重保险。
        if (value) onChange(value as T);
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** 代码 Tabs 控件：多 tab 展示安装提示 / 命令 / 工具示例等，每 tab 可复制 */
export function CodeTabsSetting({
  tabs,
  onCopy,
}: {
  tabs: Array<{ value: string; label: string; language: string; content: string }>;
  onCopy: (label: string, content: string) => void;
}) {
  const defaultValue = tabs[0]?.value ?? "";

  return (
    <Tabs className="settings-code-tabs" defaultValue={defaultValue}>
      <TabsList className="settings-code-tabs-list">
        {tabs.map((tab) => (
          <TabsTrigger className="settings-code-tabs-trigger" key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContents className="settings-code-tabs-contents">
        {tabs.map((tab) => (
          <TabsContent className="settings-code-tab-panel" key={tab.value} value={tab.value}>
            <div className="settings-code-tab-toolbar">
              <span>{tab.language}</span>
              <button className="secondary-button" onClick={() => onCopy(tab.label, tab.content)} type="button">
                <Copy size={13} />
                复制
              </button>
            </div>
            <pre>{tab.content}</pre>
          </TabsContent>
        ))}
      </TabsContents>
    </Tabs>
  );
}

/** 数字输入控件 */
export function NumberSetting({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <input
        max={max}
        min={min}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        type="number"
        value={value}
      />
    </div>
  );
}

/** 滑块控件（带数值后缀展示） */
export function SliderSetting({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <div className="slider-setting">
        <input
          max={max}
          min={min}
          step={step ?? 1}
          type="range"
          value={value}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
        <span>
          {value}
          {suffix}
        </span>
      </div>
    </div>
  );
}

/** 开关按钮控件 */
export function ToggleSetting({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <button
        className={checked ? "toggle-button active" : "toggle-button"}
        onClick={() => onChange(!checked)}
        type="button"
      >
        <span />
      </button>
    </div>
  );
}

/** 内容识别能力说明卡片 */
export function CheckItem({ body, icon, title }: { body: string; icon: ReactNode; title: string }) {
  return (
    <div className="check-item">
      <span className="check-item-icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
}
