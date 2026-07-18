/** 支持渲染的场景语言；默认 composition 使用中文，英文用于后续本地化渲染。 */
export type SceneLocale = "zh-CN" | "en-US";

/** Remotion 工作台的场景配置，覆盖首页介绍、三大功能场景和安装引导。 */
export interface ClipForgeSceneConfig {
  locale: SceneLocale;
  globalShortcut: string;
  intro: {
    headline: [string, string];
    body: string;
    label: string;
    tagline: string;
  };
  featureScenarios: Array<{
    label: string;
    detail: string;
  }>;
  onboarding: Array<{
    title: string;
    body: string;
  }>;
}

/** ClipForge 动画场景文案，不包含任何平台专属默认全局快捷键。 */
export const clipForgeScenes: Record<SceneLocale, ClipForgeSceneConfig> = {
  "zh-CN": {
    locale: "zh-CN",
    globalShortcut: "Control + V",
    intro: {
      headline: ["复制、搜索、回写", "都更快"],
      body: "ClipForge 把剪贴板历史变成一个低打扰的快速工作面板。",
      label: "快速剪贴板工具",
      tagline: "少打断，多完成",
    },
    featureScenarios: [
      { label: "键盘快速选择", detail: "Control + V 唤起，方向键定位，Cmd+数字直达当前页条目" },
      { label: "键盘快速预览", detail: "翻页、预览、进入详情各有边界，不误触打开链接或路径" },
      { label: "AI 智能", detail: "Agent 面板、MCP 安装提示、安全摘要和本地上下文边界" },
    ],
    onboarding: [
      { title: "完成安装", body: "遇到 Gatekeeper 提示时按安装说明右键打开应用。" },
      { title: "授权辅助功能", body: "开启权限后才能稳定读取焦点和触发快速面板。" },
      { title: "唤起面板", body: "默认使用 Control + V 打开剪贴板历史，后续可在设置中修改。" },
      { title: "复制回写", body: "搜索、选择、回写都留在本机剪贴板路径内。" },
      { title: "安全策略", body: "敏感采集、AI 上下文和 MCP 能力都需要明确开关。" },
    ],
  },
  "en-US": {
    locale: "en-US",
    globalShortcut: "Control + V",
    intro: {
      headline: ["Copy, search, paste back", "with less friction"],
      body: "ClipForge turns clipboard history into a focused quick-access panel.",
      label: "Fast clipboard utility",
      tagline: "Less interruption, more flow",
    },
    featureScenarios: [
      { label: "Keyboard selection", detail: "Open with Control + V, move with arrows, jump with Cmd+number" },
      { label: "Keyboard preview", detail: "Paging, preview, and details stay separate from open-target actions" },
      { label: "AI assist", detail: "Agent panel, MCP setup hints, safety summaries, and local context boundaries" },
    ],
    onboarding: [
      { title: "Finish install", body: "If Gatekeeper blocks launch, follow the guide and open the app with right-click." },
      { title: "Grant permission", body: "Accessibility permission keeps focused input and quick panel behavior reliable." },
      { title: "Open the panel", body: "Use Control + V by default, then customize it later in Settings." },
      { title: "Paste back", body: "Search, select, and write back through the local clipboard path." },
      { title: "Safety policy", body: "Sensitive capture, AI context, and MCP access all stay behind explicit controls." },
    ],
  },
};

/** 当前默认渲染场景，保持中文工作台输出。 */
export const defaultClipForgeScene = clipForgeScenes["zh-CN"];
