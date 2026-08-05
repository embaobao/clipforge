# 任务：项目功能演示动图生成流水线

## Phase 0：方案评审与边界冻结

- [ ] 确认主 demo 用真实录屏还是 Remotion intro（推荐：真实录屏）
- [ ] 确认资产目录 `docs/demos/` vs `assets/demos/`（推荐：`docs/demos/`）
- [ ] 确认是否引入 gifsicle 依赖（推荐：引入）
- [ ] 确认首版是否做自动 E2E 录制（推荐：不做，人工 + 脚本）
- [ ] 确认首版平台范围（推荐：仅 macOS，跨平台后置）
- [ ] 确认本提案只搭流水线与规范，不录制全部最终成品

## Phase 1：工具链与转码脚本

- [ ] 新增 `scripts/render-demo-gif.mjs`（入参 input/output/crop/fps/width）
- [ ] 实现 palettegen → paletteuse → gifsicle 封装
- [ ] 检测 `ffmpeg` / `gifsicle` 可用性，缺失给出 `brew install` 提示
- [ ] 输出体积报告与超体降级建议
- [ ] 单元验证：一条样例 mp4 走通完整流水线产出可读 gif

## Phase 2：场景清单与录制指引

- [ ] 新增 `docs/demos/RECORDING.md`
- [ ] 写入场景清单（quick-open / history / search / copy-paste / favorites / settings / onboarding）
- [ ] 每场景：操作步骤、重点、时长、命名、重录触发条件
- [ ] 录制环境约定（macOS 版本、分辨率、主题、受控假数据）

## Phase 3：资产目录与 README

- [ ] 新增 `docs/demos/` 目录与 `docs/demos/README.md`（素材清单 + 版本记录）
- [ ] 定义命名规范 `demo-<scenario>.gif` / `intro.mp4` / `onboarding.mp4`
- [ ] 改造 `README.md` 增加演示引用区（相对路径）
- [ ] 至少放一个主 demo 占位（`demo-quick-open.gif`）

## Phase 4：Remotion 辅路径对齐

- [ ] 确认 `motion:render:intro` / `motion:render:onboarding` 仍可渲染（回归）
- [ ] 约定 Remotion 产物输出到 `docs/demos/intro.mp4` / `onboarding.mp4`
- [ ] 如需 gif，复用 `render-demo-gif.mjs` 将 mp4 转 gif

## Phase 5：引导/发布联动

- [ ] 在 `onboarding-standalone-page` design 的“演示素材关联”小节确认引用口径
- [ ] 发布物料（`release-assets/`）引用同一批 gif，避免多份维护

## Phase 6：验证与发布门禁

- [ ] `pnpm build` 通过（脚本与 README 改动不破坏构建）
- [ ] `pnpm openspec validate project-demo-gif-pipeline --strict`
- [ ] 验证 ffmpeg + gifsicle 流水线在 macOS 走通一条场景
- [ ] 验证 README 相对路径在 GitHub 与本地预览均可显示
- [ ] 验证录制内容不含真实敏感剪贴板内容
- [ ] 记录未完成的跨平台与其他场景录制，不虚报完成
