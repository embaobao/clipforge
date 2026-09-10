/** 设置窗口「显示与面板」section（从 settings.tsx 切出的展示组件）。
 *  边界：状态与动作经 props 注入；文案映射表仅本组件使用故随组件走。 */
import type { ReactNode } from "react";
import type { TranslationKey } from "../../i18n";
import { NumberSetting, SegmentSetting, SettingGroup, SliderSetting, ToggleSetting } from "../controls";
import type { AppSettings } from "../settings-model";
import type { PanelTriggerPayload } from "../settings-model";
import type { SettingsTabId } from "../settings-field-catalog";

export type DisplayPanelSectionProps = {
  settings: AppSettings;
  panel: PanelTriggerPayload | null;
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string;
  updateSettings: (next: Partial<AppSettings>) => void;
  densityCopy: Record<AppSettings["panelDensity"], string>;
  displayModeCopy: Record<AppSettings["contentDisplayMode"], string>;
  positionStrategyCopy: Record<AppSettings["positionStrategy"], string>;
  testFloatingPanel: () => Promise<void> | void;
  refreshPanelStatus: () => Promise<void> | void;
  renderTabs: (panels: Partial<Record<SettingsTabId, ReactNode>>) => ReactNode;
};

/** 显示与面板 section（density/size/position/test 四个 tab）。 */
export function DisplayPanelSection({
  settings,
  panel,
  tr,
  updateSettings,
  densityCopy,
  displayModeCopy,
  positionStrategyCopy,
  testFloatingPanel,
  refreshPanelStatus,
  renderTabs,
}: DisplayPanelSectionProps) {
  return renderTabs({
    density: (
      <SettingGroup title={tr("settings.tab.density")}>
        <div className="flex items-center justify-between gap-8 py-3">
          <span>{tr("settings.display.density")}</span>
          <SegmentSetting
            label={tr("settings.display.density")}
            options={(["dense", "normal", "comfortable"] as AppSettings["panelDensity"][]).map((v) => ({
              value: v,
              label: densityCopy[v],
            }))}
            probeId="settings-control:panelDensity"
            selected={settings.panelDensity}
            onChange={(panelDensity) => updateSettings({ panelDensity })}
          />
        </div>
        <div className="flex items-center justify-between gap-8 py-3">
          <span>{tr("settings.display.contentMode")}</span>
          <SegmentSetting
            label={tr("settings.display.contentMode")}
            options={(["summary", "middle", "raw"] as AppSettings["contentDisplayMode"][]).map((v) => ({
              value: v,
              label: displayModeCopy[v],
            }))}
            selected={settings.contentDisplayMode}
            onChange={(contentDisplayMode) => updateSettings({ contentDisplayMode })}
          />
        </div>
        <NumberSetting
          label={tr("settings.display.quickItemLimit")}
          value={settings.quickItemLimit}
          min={4}
          max={30}
          probeId="settings-control:quickItemLimit"
          onChange={(quickItemLimit) => updateSettings({ quickItemLimit })}
        />
      </SettingGroup>
    ),
    size: (
      <SettingGroup title={tr("settings.tab.size")}>
        <NumberSetting
          label={tr("settings.display.panelWidth")}
          value={settings.panelWidth}
          min={320}
          max={600}
          onChange={(panelWidth) => updateSettings({ panelWidth })}
        />
        <NumberSetting
          label={tr("settings.display.panelHeight")}
          value={settings.panelHeight}
          min={300}
          max={1000}
          onChange={(panelHeight) => updateSettings({ panelHeight })}
        />
        <SliderSetting
          label={tr("settings.display.backgroundOpacity")}
          min={20}
          max={100}
          step={1}
          suffix="%"
          value={Math.round(settings.panelBackgroundOpacity * 100)}
          probeId="settings-control:panelBackgroundOpacity"
          onChange={(value) => updateSettings({ panelBackgroundOpacity: value / 100 })}
        />
      </SettingGroup>
    ),
    position: (
      <SettingGroup title={tr("settings.tab.position")}>
        <div className="flex items-center justify-between gap-8 py-3">
          <span>{tr("settings.display.positionStrategy")}</span>
          <SegmentSetting
            label={tr("settings.display.positionStrategy")}
            options={(["trayCenter", "followCursor", "center", "windowCenter", "lastPosition", "focusInput"] as AppSettings["positionStrategy"][]).map((v) => ({
              value: v,
              label: positionStrategyCopy[v],
            }))}
            selected={settings.positionStrategy}
            onChange={(positionStrategy) => updateSettings({ positionStrategy })}
          />
        </div>
      </SettingGroup>
    ),
    test: (
      <SettingGroup title={tr("settings.tab.test")}>
        <ToggleSetting
          label={tr("settings.display.autoHideDock")}
          checked={settings.enableScrollCollapse}
          probeId="settings-control:enableScrollCollapse"
          onChange={(enableScrollCollapse) => updateSettings({ enableScrollCollapse })}
        />
        <div className="rounded-lg bg-black/[0.03] p-4 dark:bg-white/[0.05]">
          <span>{tr("settings.integration.floating.title")}</span>
          <strong>
            {panel?.visible ? tr("settings.integration.floating.visible") : tr("settings.integration.floating.hidden")} · {panel?.focused ? tr("settings.integration.floating.focused") : tr("settings.integration.floating.unfocused")}
          </strong>
          <p>
            {tr("settings.integration.floating.sourceDetail", {
              source: panel?.source ?? "-",
              positionSource: panel?.positionSource ?? "-",
              inputSource: panel?.focusedInputSource || tr("settings.integration.floating.inputMiss"),
            })}
          </p>
          <p>
            {panel
              ? `x=${Math.round(panel.x)} y=${Math.round(panel.y)} ${Math.round(panel.width)}x${Math.round(panel.height)}`
              : tr("settings.integration.floating.notChecked")}
          </p>
          <div className="flex gap-2">
            <button className="flex h-7 items-center gap-1.5 rounded-md bg-black/[0.04] px-2.5 text-[12px] text-foreground transition-colors hover:bg-black/[0.06] dark:bg-white/[0.07] dark:hover:bg-white/[0.1]" onClick={() => void testFloatingPanel()} type="button">
              {tr("settings.integration.floating.test")}
            </button>
            <button className="flex h-7 items-center gap-1.5 rounded-md bg-black/[0.04] px-2.5 text-[12px] text-foreground transition-colors hover:bg-black/[0.06] dark:bg-white/[0.07] dark:hover:bg-white/[0.1]" onClick={() => void refreshPanelStatus()} type="button">
              {tr("settings.integration.floating.refresh")}
            </button>
          </div>
        </div>
      </SettingGroup>
    ),
  });
}
