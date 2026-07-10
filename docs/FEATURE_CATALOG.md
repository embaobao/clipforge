# ClipForge 功能目录

功能目录的源数据在：

```text
release-assets/clipforge-feature-catalog.json
```

发布手册由脚本生成：

```bash
pnpm build:manual
```

生成结果：

```text
release-assets/CLIPFORGE_MUST_READ.html
```

打包脚本 `scripts/build-mac-release.sh` 会在构建 DMG 前自动运行生成脚本，因此后续新增功能、快捷键或 MCP 工具时，应先更新 `clipforge-feature-catalog.json`，再构建发布包。

当前功能分组：

- 剪贴板历史
- 悬浮面板
- 搜索与筛选
- 复制与快速键入
- 收藏与垃圾箱
- 详情与聚合
- 日志与清理
- 设置中心
- MCP 接口
