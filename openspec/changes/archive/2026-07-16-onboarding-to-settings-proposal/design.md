# 设计：初次引导迁移到设置面板

## 1. 当前状态

该 change 已具备 `proposal.md`、`design.md`、`tasks.md` 和 `specs/onboarding/spec.md`。它作为主面板减负提案处理：让悬浮面板保持剪贴板工具热路径，把初始化、权限和功能说明迁移到设置窗口。

## 2. 产品边界

- 引导属于初始化和帮助能力，不属于快速剪贴板主流程。
- 悬浮面板首屏只保留历史、搜索、复制、收藏、删除、详情和 Agent 入口等工作流。
- 设置面板承载更长的说明、权限检查、快捷键与采集范围配置。
- 引导完成状态只决定是否自动打开设置面板，不改变剪贴板监听、搜索和写回语义。

## 3. 信息架构

设置面板新增一级分类 `onboarding`，显示为 `入门引导`。

```text
SettingsApp
  Sidebar
    入门引导
    快捷键与语言
    显示与面板
    采集与内容
    存储与日志
    MCP 与 Agent
  Content
    OnboardingWizard
      StepIndicator
      StepContent
      StepActions
```

`OnboardingWizard` 只负责引导流程和设置联动，不重新实现设置系统。它调用已有 settings read/write 能力、权限命令和快捷键配置控件。

## 4. 启动流程

```text
App setup
  read settings
  if onboardingCompleted === false
    open settings window with section=onboarding
  else
    keep main panel normal
```

如果当前 `open_settings_window` 不支持初始 section，应新增一个轻量命令或参数，不让前端通过隐藏全局状态硬切设置页。

## 5. 步骤设计

| 步骤 | 目标 | 主要操作 |
| --- | --- | --- |
| 欢迎 | 建立 ClipForge 是快速剪贴板工具的定位 | 下一步 |
| 权限 | 开启辅助功能权限并解释用途 | 打开系统设置、重新检查状态 |
| 采集 | 设置文本、HTML、RTF、图片、文件采集范围 | 修改现有采集开关 |
| 快捷键 | 查看或修改全局唤起快捷键 | 复用快捷键设置控件 |
| 功能速览 | 说明历史、搜索、收藏、垃圾桶、Agent 入口 | 完成引导 |

权限步骤必须允许用户暂时跳过。跳过引导代表不再自动弹出设置窗口，不代表权限已开启。

## 6. 状态与持久化

- `onboardingCompleted` 保持为设置字段。
- 完成和跳过都写入 `onboardingCompleted=true`。
- 重新查看引导不应把状态重置为 false。
- 引导中的采集、快捷键等设置变更走现有设置写入链路；如果 `settings-service-unified-protocol` 已落地，则改走 Settings Service。

## 7. 与其他提案关系

- 依赖 `settings-interface-redesign` 的侧边栏分类和 Tabs 结构，但可以在旧设置页上先落最小版本。
- 依赖 `app-internationalization-en-support` 的 i18n key 体系。
- 与 `top-nav-optimization` 一致移除主面板菜单中的独立 Onboarding 入口。
- 不依赖 `ai-model-plugin-productization` 或 Agent 插件体系。

## 8. 验证策略

自动化验证覆盖 TypeScript、i18n key、build 和 Rust command 编译；真实启动、系统权限跳转和首次启动自动打开设置页必须用 `pnpm tauri dev` 手动验证。
