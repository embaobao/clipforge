# 提案：项目功能演示动图生成流水线

## 状态

- 优先级：P3（工程/文档资产类，不阻塞功能提案）。
- 阶段：方案评审，暂不实现代码与不录制最终成品。
- 变更标识：`project-demo-gif-pipeline`。
- 关联：archived `remotion-animation-workbench`（已有 Remotion workbench）、`onboarding-standalone-page`（引导 tour 步骤引用演示素材）。

## Why

ClipForge 是一个强调“快速剪贴板工具”核心体验的桌面应用，但 README、发布物料和引导页都缺少直观的功能演示。现状：

- 项目**已有 Remotion workbench**（`package.json` 的 `motion:render:intro` / `motion:render:onboarding` / `motion:studio`），适合做品牌动画与引导过渡，来自 archived 的 `remotion-animation-workbench`。
- 项目**没有任何真实功能演示 gif/mp4**，README 无任何 demo/screenshot 引用。
- 没有**可重复的录制与转码工具链**：无 ffmpeg 脚本、无场景清单、无命名规范、无资产目录。

剪贴板工具的核心价值（快捷键唤起、历史、搜索、复制粘贴、跟随光标）用真实录屏最能传达；Remotion 代码化生成则适合品牌 intro 和引导过渡动画。本提案建立一条双轨、可重复、低噪声的演示动图流水线。

## 背景

现状坐标：

- Remotion 脚本：`package.json:19-22`（`motion:studio` / `motion:still` / `motion:render:intro` / `motion:render:onboarding`），filter 指向 `@clipforge/remotion-workbench`。
- 无 `assets/demos/`、`docs/demos/` 等资产目录；`examples/` 是 context-collector 示例，与演示素材无关。
- README 无 `gif/mp4/demo/screenshot` 引用。
- 无 ffmpeg / gifsicle / Kap 等录制转码工具配置。

## 目标

1. 定义双轨演示动图策略：真实录屏转 gif（主）+ Remotion 代码化渲染（辅，复用现有 workbench）。
2. 提供可重复的 ffmpeg 录屏→调色板→gif→gifsicle 转码流水线（脚本化）。
3. 定义功能演示场景清单（唤起 / 历史 / 搜索 / 复制粘贴 / 收藏 / 设置 / 引导）与每条的时长、重点、命名。
4. 定义资产目录、命名规范、尺寸/帧率/体积上限。
5. README 增加演示引用区。
6. 明确与 Remotion workbench 和 `onboarding-standalone-page` 的分工。

## 非目标

- 不在本提案录制最终成品（只搭流水线、规范与脚本指引）。
- 不替换或重写 Remotion workbench，只复用其渲染能力。
- 不引入专业视频生产管线（剪辑、配音、字幕），保持轻量。
- 不做自动 UI 操作机器人（E2E 自动录制），首版用人工操作 + 脚本转码。
- 不改变产品功能或 UI。

## 核心设计方向

### 1. 双轨策略

| 轨道 | 用途 | 工具 | 产出 |
| --- | --- | --- | --- |
| 真实录屏（主） | 剪贴板核心功能演示 | ffmpeg avfoundation / QuickTime 录屏 → ffmpeg 调色板两步法 → gifsicle | 功能 gif（README、发布） |
| Remotion（辅） | 品牌 intro、引导过渡动画 | 复用 `motion:render:intro` / `motion:render:onboarding` | mp4/gif（README 顶部、引导窗口） |

### 2. 真实录屏转 gif 流水线

- 录屏：`ffmpeg -f avfoundation -framerate 30 -i "1:" raw.mp4`（视频设备 `1` = 屏幕录制，无音频），或 QuickTime 手动录制后喂给脚本。
- 调色板两步法（高质量 gif 标准）：
  - `ffmpeg -i raw.mp4 -vf "fps=15,scale=960:-1:flags=lanczos,palettegen" palette.png`
  - `ffmpeg -i raw.mp4 -i palette.png -lavfi "fps=15,scale=960:-1:flags=lanczos [x]; [x][1:v] paletteuse" out.gif`
- 优化：`gifsicle -O3 --colors 128 out.gif -o out.gif`
- 裁剪：录制或转码阶段裁剪到主面板/窗口区域，避免多余桌面。

### 3. 场景清单（建议）

| 场景 | 重点 | 时长 | 命名 |
| --- | --- | --- | --- |
| 唤起主面板 | 全局快捷键 → 面板浮出 → 跟随光标 | ~3s | `demo-quick-open.gif` |
| 剪贴板历史 | 复制几段文本 → 面板列表滚动 | ~5s | `demo-history.gif` |
| 搜索 | 输入关键词 → 命中高亮 → 选中 | ~4s | `demo-search.gif` |
| 复制粘贴 | 选中条目 → 写回剪贴板 → 粘贴到目标 | ~4s | `demo-copy-paste.gif` |
| 收藏与分类 | 收藏条目 → 切换分类 | ~4s | `demo-favorites.gif` |
| 设置侧边栏 | 打开设置 → sidebar 全量切换 | ~5s | `demo-settings.gif` |
| 引导窗口 | 独立引导窗口五步切换 | ~6s | `demo-onboarding.gif` |

### 4. 参数与体积

- 尺寸：宽 960（或面板真实宽度），高自适应。
- 帧率：15fps（演示足够，体积友好）。
- 调色板：128 色。
- 单 gif 体积目标：< 3–5MB；超出则进一步降帧率或裁剪。

### 5. 资产目录与命名

- 目录：`docs/demos/`（与文档同级，便于 README 相对引用）。
- 命名：`demo-<scenario>.gif`、`intro.mp4`、`onboarding.mp4`。
- 每个素材附同名 `.md` 说明（场景、录制版本、是否需要重录）。

### 6. README 引用

- README 顶部放一个主 demo（推荐 `demo-quick-open.gif` 或 Remotion intro）。
- “功能”段落放对应场景 gif。
- 引用相对路径 `./docs/demos/...`。

## 用户价值

1. README 与发布物料直观展示剪贴板核心体验，降低新用户认知成本。
2. 引导窗口的 tour 步骤可引用真实功能 gif，比静态截图更生动。
3. 可重复流水线：UI 变化时只需重录对应场景，不必每次手工摸索 ffmpeg 参数。
4. 明确分工：真实功能用录屏，品牌/引导用 Remotion，避免重复造轮子。

## 成功标准

1. `scripts/` 下有可运行的录屏→gif 转码脚本（或清晰的录制指引文档）。
2. 有场景清单（场景/时长/重点/命名）作为录制指引。
3. 资产目录与命名规范确定。
4. README 有演示引用区（至少一个主 demo 占位）。
5. 明确与 Remotion workbench、`onboarding-standalone-page` 的分工，不重复定义。
6. 至少一条场景的转码流程验证通过（ffmpeg 两步法 + gifsicle 产出可用 gif）。

## 与现有方案的关系

| 现有方案 | 关系 |
| --- | --- |
| archived `remotion-animation-workbench` | 复用其 Remotion workbench 与 `motion:render:*` 脚本做品牌/引导动画，不重写 |
| `onboarding-standalone-page` | 引导 tour 步骤引用本提案产出的功能 gif 或 Remotion onboarding 动画 |
| `github-release-update-distribution`（archived） | 发布物料可复用本提案的 demo gif |
| `frontend-surface-architecture-refactor` | 录制展示的 UI 以其 surface 契约为准；UI 变化时按 surface 重录 |

## 方案评审问题

- 主 demo 用真实录屏（`demo-quick-open.gif`）还是 Remotion intro。（推荐：真实录屏，更直观）
- 资产放 `docs/demos/` 还是 `assets/demos/`。（推荐：`docs/demos/`，README 相对引用方便）
- 是否首版就引入 `gifsicle` 依赖，还是只用 ffmpeg。（推荐：引入 gifsicle，体积优化明显）
- 是否做自动 E2E 录制（如 Playwright/tauri-driver 驱动）。（推荐：首版不做，人工操作 + 脚本转码即可）
- 演示是否覆盖 Windows/Linux。（推荐：首版只覆盖 macOS，跨平台素材后置）
