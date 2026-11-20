# Delta: 主面板无效片段入口清除 (remove-dead-snippet-tab)

> 只清理未实现「片段」功能留下的可见占位，保留数据契约与产品方向表述。参照 [settings-status-bar-and-dead-ai-cleanup](../../settings-status-bar-and-dead-ai-cleanup/specs/settings-status-bar-and-dead-ai-cleanup/spec.md) 的「死残清除」写法。

## ADDED Requirements

### Requirement: 主面板视图切换区不得包含不可用入口

主面板顶部工具栏 SHALL 只呈现可响应点击的视图切换控件（历史、收藏、更多菜单）。未绑定 `onViewChange` 且 `disabled` 的「片段」剪刀按钮 SHALL NOT 出现在界面上；其 `aria-label`、Tooltip 与 `data-dev-probe="top-scope-snippets"` SHALL 一并移除，避免自动化探针命中一个不存在的控件。文件头注释 SHALL 与实际按钮集合一致。

#### Scenario: 顶部工具栏无剪刀图标

- **WHEN** 用户通过全局快捷键或托盘打开快速面板
- **THEN** 顶部视图区只有 时钟（历史）/ 星标（收藏）/ 更多（菜单）三个可交互按钮，不存在灰色不可点的剪刀图标，历史与收藏的切换行为不变

### Requirement: 命令菜单与列表空态不得承诺未实现的动作

⌘K 命令菜单 SHALL NOT 包含「新建片段」项，列表空态 SHALL NOT 渲染「新建片段」按钮；与之配套的 `onCreateSnippet` 回调链（组件 props、透传、App 层 handler）以及 `mod+N` / `⌘N` 快捷键提示 SHALL 一并移除。仅由这些入口引用的 i18n 键（`main.dock.snippets`、`main.empty.createSnippet`）SHALL 在 zh-CN 与 en-US 中对称删除。

#### Scenario: 列表空态不再出现「开发中」按钮

- **WHEN** 主列表无条目（首次启动或搜索无结果）
- **THEN** 空态只显示标题与说明文案，不出现「新建片段」按钮与 `⌘N` 提示，回收站空态保持原样

#### Scenario: 命令菜单不再出现「开发中」项

- **WHEN** 用户点开底部 ⌘K 命令菜单
- **THEN** 菜单不含「新建片段」，其余项（粘贴为纯文本 / 固定到顶部 / 收藏 / 移到文件夹 / 删除）及其可用性判定不变

### Requirement: 片段数据契约与产品方向保持不变

`ClipBucket` 的 `snippet` 分支、`search-query.ts` 的 bucket 过滤、Rust 侧相关契约 SHALL 保持原样，不因可见入口移除而改动。`AGENTS.md` 与 `openspec/project.md` 中「片段」作为第一阶段 Clipy 等价能力的表述 SHALL 不由本清除动作改写；若后续要落地片段功能，SHALL 另立提案重新设计入口与数据链路。

#### Scenario: 搜索 bucket 仍可解析

- **WHEN** 搜索逻辑收到 `bucket="snippet"` 参数
- **THEN** 解析与过滤行为与清除前一致，不因 UI 入口移除而报错或抛异常

#### Scenario: 示例数据不受影响

- **WHEN** 加载 `tauri-web-mock-store` 的示例标签数据
- **THEN** `["代码", "片段"]` 仍作为普通标签文本存在，不被当作 UI 入口清理
