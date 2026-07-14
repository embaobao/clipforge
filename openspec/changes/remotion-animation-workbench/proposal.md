# 提案：Remotion 动效工作台

## 为什么

ClipForge 需要一套快速生成功能介绍和新手引导动画的开发工作台，用于发布页、安装说明、引导页面和后续 App 内短动效素材。当前主应用是 Tauri + Vite 单包结构，如果直接把视频生成依赖塞进主应用，会增加运行依赖边界、打包风险和维护噪音。

Remotion 应作为独立 dev workspace 引入，只服务素材预览和视频生成，不进入主应用运行时。

## 变更内容

- 新增 `workbenches/remotion` pnpm workspace，独立管理 Remotion、React、TypeScript 和视频脚本。
- 根项目只提供转发脚本，例如 `pnpm motion:studio`、`pnpm motion:render:intro`。
- 提供两个初始 composition：
  - `FeatureIntro`：横版功能介绍，用于 README、发布页和社媒预览。
  - `OnboardingGuide`：竖版引导动画，用于 onboarding 页面或安装后的快速引导。
- 引导文案中的默认全局唤起快捷键统一为 `Control + V`；设置允许用户修改，但 README、安装文档、发布手册和动效默认文案不得再出现其他默认唤起快捷键。
- 复用仓库已有品牌资产和真实应用截图，不手写假产品 UI。
- 视觉风格保持高效、简洁、工具感：中性底色、强对比、单一青绿色品牌强调、清晰节奏、短文本。
- 在工作台文档中记录 `npx remotion skills add` / skills fallback 的使用边界，避免在主应用根目录误散落 agent skill 文件。

## 非目标

- 不在主应用内嵌 Remotion runtime。
- 不把视频生成接入 Tauri 打包流程。
- 不引入复杂营销站或重型动画框架。
- 不在此提案内实现用户可编辑的视频模板系统。

## 影响

- `pnpm-workspace.yaml` 将加入 `workbenches/*`。
- 根 `package.json` 将新增 motion 相关脚本。
- `pnpm-lock.yaml` 会新增 Remotion 工作台依赖。
- 主应用运行依赖、Tauri 配置和剪贴板核心逻辑不应发生变化。
