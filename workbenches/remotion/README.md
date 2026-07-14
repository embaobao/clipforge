# ClipForge Remotion Workbench

独立 Remotion dev workspace，用于生成 ClipForge 功能介绍和新手引导动画。这里的依赖不进入 Tauri 主应用运行时。

## 使用

```bash
pnpm motion:studio
pnpm motion:still
pnpm motion:render:intro
pnpm motion:render:onboarding
```

也可以在当前目录直接运行：

```bash
pnpm studio
pnpm still
pnpm render:intro
pnpm render:onboarding
```

输出文件写入 `workbenches/remotion/out/`。

## Remotion skills

如需安装 Remotion AI skills，只在本目录执行：

```bash
npx remotion skills add
```

如果 npm 无法解析该入口，使用：

```bash
npx skills add remotion-dev/skills
```

不要在仓库根目录执行 skills 安装命令，避免把生成文件混入主应用工程。

## 视觉规则

- 真实产品资产优先：品牌图、真实截图、功能目录。
- 每帧只表达一个主要信息。
- 使用 `useCurrentFrame()` + `interpolate()`，不要用 CSS animation 或 transition 做可渲染主动画。
- 避免 AI 紫色渐变、三等分功能卡、夸张营销词和假产品 UI。
- 主题保持高效、克制、清晰，符合剪贴板工具气质。
