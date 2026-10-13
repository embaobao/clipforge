# panel-list-performance Specification

## Purpose
TBD - created by archiving change panel-list-perf. Update Purpose after archive.
## Requirements
### Requirement: 视图切换走缓存

ClipForge SHALL 按 view 缓存剪贴板列表;在底层查询条件未变时,history/favorites/trash 间切换 SHALL NOT 重新发起 `search_clip_records` IPC。

#### Scenario: history 与 favorites 互切零 IPC

- **WHEN** 用户在 history 与 favorites 之间来回切换
- **THEN** 目标视图由内存缓存直接服务,不产生新的 `search_clip_records` IPC 调用
- **AND** 各视图滚动位置恢复
- **AND** 切换过程无空态闪烁

#### Scenario: 写操作后缓存失效

- **WHEN** 用户对条目做收藏、删除、恢复、复制、粘贴或编辑
- **THEN** 受影响视图缓存被失效
- **AND** 下次进入该视图时重新从 Rust 拉取

### Requirement: 列表跨视图切换渲染稳定

ClipForge SHALL 在 activeView 变化时保持列表组件挂载并保留滚动位置。

#### Scenario: 切视图不重挂列表

- **WHEN** activeView 变化
- **THEN** 列表组件不被卸载重挂(渲染 key 不含 activeView)
- **AND** row-in 入场动画不整窗重放

#### Scenario: 滚动位置按视图恢复

- **WHEN** 用户离开某视图(已滚动到非零位置)后再返回
- **THEN** 列表同步恢复到先前保存的滚动位置

### Requirement: 列表载荷瘦身

`search_clip_records` SHALL 只返回列表渲染必需字段,SHALL NOT 逐条 `load_clip`(N+1);详情/编辑/复制粘贴所需完整字段 SHALL 按需单独获取。

#### Scenario: 列表批量取行

- **WHEN** `search_clip_records` 构建结果集
- **THEN** 使用单次 JOIN/查询而非按 id 循环 `load_clip`
- **AND** 载荷不含仅详情/复制/粘贴路径需要的字段

#### Scenario: 前端信任 Rust 分析字段

- **WHEN** 列表条目载荷含 Rust 落库的分析元数据
- **THEN** 前端 normalize 直接复用分析、标题、摘要、标签与 kind
- **AND** 不对每行重新跑内容分析

### Requirement: 刷新收敛

剪贴板变更事件与面板唤起 SHALL 最小化全量列表刷新。

#### Scenario: 纯列表视图收到复制事件

- **WHEN** 面板处于无搜索/无过滤的纯列表视图且收到 `clipboard-changed`
- **THEN** 仅在顶部增量合并最新条目
- **AND** 不强制把视图切到 history
- **AND** 不发起全量 `search_clip_records` 刷新

#### Scenario: 唤起面板无新条目

- **WHEN** 面板唤起时库内最新条目已是当前列表首条
- **THEN** `mergeTopClip` 跳过 `setClips`,不产生多余重渲染

### Requirement: 滚动死代码清除

App.tsx 中只写不读的滚动状态(`scrollOffset`/`searchCompact` 及其 handler)SHALL 被移除。

#### Scenario: 清理后滚动行为不变

- **WHEN** 移除 `setScrollOffset`/`setSearchCompact`/`handleScroll` 死代码
- **THEN** `VirtualList` 滚动行为保持不变,构建与运行时无错误

