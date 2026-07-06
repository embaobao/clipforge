# ClipForge Brand Assets

本目录保存从根目录视觉源文件派生出的正式品牌资源。根目录原始图不直接改动；需要更新资源时，重新运行 `node scripts/extract-brand-icons.mjs`。

## Primary Assets

| Asset | Path | Usage |
| --- | --- | --- |
| Product banner | `assets/brand/clipforge-banner.png` | README 顶部封面、GitHub social preview 候选 |
| App icon light source | `assets/brand/clipforge-app-icon-light-source.png` | 当前启用的浅色应用图标母版，已用于生成 Tauri icon |
| App icon dark source | `assets/brand/clipforge-app-icon-source.png` | 深色应用图标备选母版，保留用于后续切换 |
| Dark app icon input | `assets/brand/source/app-icon-dark-input.png` | 用户提供的深色图标输入备份 |
| Light app icon input | `assets/brand/source/app-icon-light-input.png` | 用户提供的浅色图标输入备份 |
| Icon sheet source copy | `assets/brand/source/icons-sheet.png` | 图标集裁切母版备份 |

## Tauri App Icon Outputs

这些文件当前由 `pnpm tauri icon assets/brand/clipforge-app-icon-light-source.png` 生成，供应用包、Dock、状态栏和各平台安装包使用。深色版保留为备选，不删除。

| Output | Path |
| --- | --- |
| Main PNG | `src-tauri/icons/icon.png` |
| macOS ICNS | `src-tauri/icons/icon.icns` |
| Windows ICO | `src-tauri/icons/icon.ico` |
| 32px PNG | `src-tauri/icons/32x32.png` |
| 64px PNG | `src-tauri/icons/64x64.png` |
| 128px PNG | `src-tauri/icons/128x128.png` |
| 256px PNG | `src-tauri/icons/128x128@2x.png` |

## Icon Set

所有图标都输出为透明底 PNG，并统一居中到 256 和 512 方形画布。当前这套细节图标来自 `icons.png` 自动裁切，部分图标边界还需要后续人工复核；产品应用图标以 `clipforge-app-icon-source.png` 为准。

| Name | Slug | 256px | 512px | Source cell row/col |
| --- | --- | --- | --- | --- |
| 剪贴板历史 | `clipboard-history` | `assets/brand/icons/256/clipboard-history.png` | `assets/brand/icons/512/clipboard-history.png` | 1/1 |
| 文本 | `text` | `assets/brand/icons/256/text.png` | `assets/brand/icons/512/text.png` | 1/2 |
| 图片 | `image` | `assets/brand/icons/256/image.png` | `assets/brand/icons/512/image.png` | 1/3 |
| 代码 | `code` | `assets/brand/icons/256/code.png` | `assets/brand/icons/512/code.png` | 1/4 |
| 文件 | `file` | `assets/brand/icons/256/file.png` | `assets/brand/icons/512/file.png` | 1/5 |
| 链接 | `link` | `assets/brand/icons/256/link.png` | `assets/brand/icons/512/link.png` | 1/6 |
| 固定 | `pin` | `assets/brand/icons/256/pin.png` | `assets/brand/icons/512/pin.png` | 2/1 |
| 收藏 | `favorite` | `assets/brand/icons/256/favorite.png` | `assets/brand/icons/512/favorite.png` | 2/2 |
| 稍后查看 | `later` | `assets/brand/icons/256/later.png` | `assets/brand/icons/512/later.png` | 2/3 |
| 删除 | `delete` | `assets/brand/icons/256/delete.png` | `assets/brand/icons/512/delete.png` | 2/4 |
| 搜索 | `search` | `assets/brand/icons/256/search.png` | `assets/brand/icons/512/search.png` | 2/5 |
| 筛选 | `filter` | `assets/brand/icons/256/filter.png` | `assets/brand/icons/512/filter.png` | 2/6 |
| 同步 | `sync` | `assets/brand/icons/256/sync.png` | `assets/brand/icons/512/sync.png` | 3/1 |
| 多端设备 | `devices` | `assets/brand/icons/256/devices.png` | `assets/brand/icons/512/devices.png` | 3/2 |
| 跨平台 | `cross-platform` | `assets/brand/icons/256/cross-platform.png` | `assets/brand/icons/512/cross-platform.png` | 3/3 |
| 导入 | `import` | `assets/brand/icons/256/import.png` | `assets/brand/icons/512/import.png` | 3/4 |
| 导出 | `export` | `assets/brand/icons/256/export.png` | `assets/brand/icons/512/export.png` | 3/5 |
| 复制 | `copy` | `assets/brand/icons/256/copy.png` | `assets/brand/icons/512/copy.png` | 3/6 |
| 成功 | `success` | `assets/brand/icons/256/success.png` | `assets/brand/icons/512/success.png` | 4/1 |
| 信息 | `info` | `assets/brand/icons/256/info.png` | `assets/brand/icons/512/info.png` | 4/2 |
| 警告 | `warning` | `assets/brand/icons/256/warning.png` | `assets/brand/icons/512/warning.png` | 4/3 |
| 错误 | `error` | `assets/brand/icons/256/error.png` | `assets/brand/icons/512/error.png` | 4/4 |
| 加密 | `lock` | `assets/brand/icons/256/lock.png` | `assets/brand/icons/512/lock.png` | 4/5 |
| 安全 | `security` | `assets/brand/icons/256/security.png` | `assets/brand/icons/512/security.png` | 4/6 |
| Agent 访问 | `agent-access` | `assets/brand/icons/256/agent-access.png` | `assets/brand/icons/512/agent-access.png` | 5/1 |
| 对话 | `chat` | `assets/brand/icons/256/chat.png` | `assets/brand/icons/512/chat.png` | 5/2 |
| 集成 | `integration` | `assets/brand/icons/256/integration.png` | `assets/brand/icons/512/integration.png` | 5/3 |
| API | `api` | `assets/brand/icons/256/api.png` | `assets/brand/icons/512/api.png` | 5/4 |
| 数据 | `database` | `assets/brand/icons/256/database.png` | `assets/brand/icons/512/database.png` | 5/5 |
| 设置 | `settings` | `assets/brand/icons/256/settings.png` | `assets/brand/icons/512/settings.png` | 5/6 |
