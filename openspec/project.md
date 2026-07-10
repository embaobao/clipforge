# ClipForge 项目说明

## 目标

建设一个跨平台剪贴板工具，第一阶段完整覆盖 Clipy 的剪贴板历史、复制回写、片段、文件夹和快速唤起；后续再提供搜索增强、归档、语义检索和 MCP 工具接口。

## 当前范围

- Tauri v2 + React + TypeScript 应用骨架
- 原生文本剪贴板读取与写入
- 快速粘贴主入口
- 即时搜索
- 历史、归档、片段视图
- 收藏、复制、归档、删除、全选当前结果删除
- 后续 MCP 标准工具接口
- 图片、文件、富文本剪贴板历史（已立项，见 [file-image-clipboard-support](./changes/file-image-clipboard-support/proposal.md)）

## 非目标

- 第一阶段优先实现 Clipy 等价能力，但快速菜单可以先用窗口内面板模拟，后续再接原生菜单/托盘。
- 不在第一阶段实现系统级粘贴模拟；复制回系统剪贴板优先，粘贴由用户或后续快捷键模块触发。
- 不在第一阶段接入远程云同步。

## 架构原则

- 快速菜单负责高频粘贴，窗口负责搜索和整理，托盘和快捷键负责唤起。
- 原生能力收敛在 Rust command 层，前端通过稳定命令调用。
- 数据层先保持轻量，后续以 SQLite 和本地向量索引替换 localStorage。
- MCP 作为标准工具接口暴露，不和 UI 状态强耦合。

## 活跃提案

| 提案 | 状态 | 说明 |
|------|------|------|
| [file-image-clipboard-support](./changes/file-image-clipboard-support/proposal.md) | 待实现 | 引入 clipboard-rs，支持图片、文件、HTML/RTF 富文本剪贴板历史 |
| [context-plugin-agent-runtime](./changes/context-plugin-agent-runtime/proposal.md) | 提案中 | 上下文快照、插件边界、Agent/AG-UI 桥、MCP 工具面与自动升级能力 |
| [detail-rich-editor-agent-bridge](./changes/detail-rich-editor-agent-bridge/proposal.md) | 提案中 | 详情页 Tiptap 富文本编辑、变量上下文、MCP/Agent 扩展桥 |
