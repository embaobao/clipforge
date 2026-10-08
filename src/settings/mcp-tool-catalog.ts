/** MCP 工具静态目录：设置页「MCP 与 Agent → 状态」tab 的人可读工具清单。
 *  边界：工具集合必须与 src-tauri/src/lib.rs 的 MCP_TOOLS（McpToolSpec 列表）一致，
 *  新增/删除 MCP 工具时同步维护本文件；描述文案走 i18n（settings.mcp.tool.*）。 */
import type { TranslationKey } from "../i18n";

export type McpToolCatalogEntry = {
  /** 工具全名，如 "clipf.list"。 */
  tool: string;
  /** 功能描述的 i18n key（一句话说明工具做什么）。 */
  descKey: TranslationKey;
};

export type McpToolCatalogGroup = {
  /** 分组标题 i18n key。 */
  titleKey: TranslationKey;
  tools: McpToolCatalogEntry[];
};

/** 按使用场景分组的工具目录，顺序即展示顺序。 */
export const MCP_TOOL_CATALOG: McpToolCatalogGroup[] = [
  {
    titleKey: "settings.mcp.group.clipboard",
    tools: [
      { tool: "clipf.capture", descKey: "settings.mcp.tool.capture" },
      { tool: "clipf.get", descKey: "settings.mcp.tool.get" },
      { tool: "clipf.list", descKey: "settings.mcp.tool.list" },
      { tool: "clipf.search", descKey: "settings.mcp.tool.search" },
      { tool: "clipf.analyze", descKey: "settings.mcp.tool.analyze" },
      { tool: "clipf.copy", descKey: "settings.mcp.tool.copy" },
      { tool: "clipf.update", descKey: "settings.mcp.tool.update" },
    ],
  },
  {
    titleKey: "settings.mcp.group.maintenance",
    tools: [
      { tool: "clipf.delete", descKey: "settings.mcp.tool.delete" },
      { tool: "clipf.export", descKey: "settings.mcp.tool.export" },
      { tool: "clipf.import", descKey: "settings.mcp.tool.import" },
    ],
  },
  {
    titleKey: "settings.mcp.group.settingsAgent",
    tools: [
      { tool: "clipf.settings.get", descKey: "settings.mcp.tool.settingsGet" },
      { tool: "clipf.settings.patch", descKey: "settings.mcp.tool.settingsPatch" },
      { tool: "clipf.settings.replace", descKey: "settings.mcp.tool.settingsReplace" },
      { tool: "clipf.settings.reset", descKey: "settings.mcp.tool.settingsReset" },
      { tool: "clipf.agent.providers", descKey: "settings.mcp.tool.agentProviders" },
      { tool: "clipf.agent.check", descKey: "settings.mcp.tool.agentCheck" },
      { tool: "clipf.agent.models", descKey: "settings.mcp.tool.agentModels" },
    ],
  },
];
