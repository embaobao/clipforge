# 设计：Remotion 动效工作台

## 边界

工作台位于 `workbenches/remotion`，是私有 workspace package。它可以依赖 Remotion、React、TypeScript 和素材生成相关 dev 工具，但主应用 `clipforge` 不能从该 package import 任何运行时代码。

根项目只承担命令转发：

```bash
pnpm motion:studio
pnpm motion:still
pnpm motion:render:intro
pnpm motion:render:onboarding
```

## 技术方案

- Remotion 版本：使用当前 npm latest `4.0.489`。
- 入口：`src/index.ts` 通过 `registerRoot()` 注册 `RemotionRoot`。
- 组合：`src/Root.tsx` 定义横版和竖版 composition。
- 动画：使用 `useCurrentFrame()`、`useVideoConfig()` 和 `interpolate()`，不使用 CSS animation / transition 作为可渲染动效主路径。
- 素材：通过静态 import 引用仓库已有品牌图和真实截图，避免复制二进制文件。
- 验证：至少执行 TypeScript 检查、Remotion 单帧 still、主项目 `pnpm build`。

## 视觉方向

Design read：ClipForge 的动效不是营销页炫技，而是生产力工具的功能说明和上手引导。画面要让用户快速理解“唤起、搜索、复制回写、整理”这些动作。

参数：

- `DESIGN_VARIANCE 5`：克制但不呆板，使用偏移布局和明确层级。
- `MOTION_INTENSITY 6`：有顺序揭示、位移和缩放，但不做眩目循环。
- `VISUAL_DENSITY 4`：每帧一个主信息，辅助信息最多两项。

视觉约束：

- 主题：浅色中性工具风格，带少量深色高对比画面。
- 强调色：青绿色为主，橙色只用于最终行动点，不能混成多色彩虹。
- 字体：系统无衬线 + 等宽数字，不引入装饰性衬线字体。
- 文案：短句、功能导向、避免夸张营销词。
- 图片：优先使用真实 ClipForge 品牌图和截图。
- 动效：每个动画必须服务信息顺序、状态变化或视觉聚焦。

## 默认快捷键约束

- 全局唤起默认快捷键只使用 `Control + V`。
- 设置页可以说明用户可自定义快捷键，但默认文档、安装引导、README、发布手册、GIF 和视频标题卡不得把 `Command + Shift + V` 或其他组合写成默认唤起入口。
- `Cmd+数字`、方向键、`Cmd+J` 等只能作为面板内操作快捷键出现，不能和全局唤起快捷键混写。
- 中英文场景配置需要共享同一套快捷键 token，避免语言切换时出现默认值漂移。

## 场景规划

- 首页介绍：快速说明 ClipForge 是本地优先的高频剪贴板工具，聚焦“打开面板、找到内容、复制回写、继续工作”。
- 场景 1：键盘快速选择。展示 `Control + V` 唤起悬浮面板，方向键定位，`Cmd+数字` 触发当前页条目。
- 场景 2：键盘快速预览。展示翻页、当前项预览、进入详情，强调快速浏览和下钻边界。
- 场景 3：AI 智能。展示 Agent 悬浮面板、MCP 安装提示、安全摘要和本地上下文访问边界。
- 安装引导：基于安装文档解释 Gatekeeper、右键打开、辅助功能权限、默认唤起快捷键和安全策略。

## Remotion skills 命令

用户侧可以在工作台目录执行：

```bash
npx remotion skills add
```

如果当前 npm 环境无法解析该入口，则使用 Remotion 官方 skills 包形式：

```bash
npx skills add remotion-dev/skills
```

这类命令只应在 `workbenches/remotion` 下运行，不在仓库根目录运行。

## 验收标准

- `pnpm --filter @clipforge/remotion-workbench typecheck` 通过。
- `pnpm motion:still` 能输出代表帧。
- `pnpm motion:studio` 能打开 Remotion Studio 预览。
- `pnpm build` 仍能完成主项目构建。
- 新增依赖只进入 Remotion 工作台，不新增主应用运行依赖。
