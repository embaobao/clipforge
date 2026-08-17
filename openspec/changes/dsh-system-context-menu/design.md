# 设计：系统级文件管理器右键

## 1. 总览

```
用户在 Finder/资源管理器右键文件
   └─ 原生扩展菜单项（复制地址 / 用 ClipForge 分析）
        └─ 回传路径给已运行的 ClipForge 主进程
             └─ 主进程：deep-link 解析 path
                  ├─ 复制地址 → 写纯路径到系统剪贴板（复用 dsh-file-context-conversation）
                  └─ 用 ClipForge 分析 → setActiveSurface("dsh") + fileContext
                       └─ 常驻 DSH 守护进程对话（deepseek-harness-embedding Phase 6）
```

## 2. macOS：Finder Sync Extension

- 独立 `NSExtension` target（`FIFinderSyncExtension`），随 Tauri 打包（`bundles`/external 资源），安装时系统注册。
- `FIFinderSyncController` 注入右键菜单项（复制地址 / 用 ClipForge 分析），`directoryURL` 作用域可限定或全量。
- 点击回调：通过 **URL Scheme `clipforge://dsh?path=<percent-encoded>`** 唤起主进程（Finder Sync 沙盒内直接调主进程受限，URL Scheme 是最稳桥接）；`path` 经 `percent-encoding`。
- 主进程用 Tauri `deep-link` 插件注册 `clipforge://` → 解析 → `setActiveSurface("dsh")` + `fileContext`。主进程未运行则系统先启动它再投递 scheme。
- 权限/签名：需开发者 ID + 公证；Finder Sync 不在 App Store 沙盒内，走店外分发。

## 3. Windows：Explorer Shell 扩展

- 上下文菜单 Handler（COM DLL，`IShellExtInit` + `IContextMenu`），注册表 `HKCR\*\shell\ClipForge\` 挂菜单 + 图标。
- 点击：启动/调起 `clipforge.exe` 并传 `--open-dsh "<path>"` 或 `clipforge://dsh?path=...`。
- 主进程参数/`deep-link` 解析同 macOS。
- 成本：COM DLL 开发与代码签名较重；可先评估用「发送到」或注册表轻量菜单替代。

## 4. 共同桥接：URL Scheme + 主进程处理

- Tauri `deep-link` 插件注册 `clipforge` scheme（macOS `Info.plist` `CFBundleURLTypes` / Windows 注册表）。
- 主进程解析：
  - `clipforge://copy-path?path=...` → 写纯路径到剪贴板（复用 `getFilePathsFromClip` 风格逻辑 / `ClipContextMenu` 的 `filesAsPaths`）。
  - `clipforge://dsh?path=...` → `setActiveSurface("dsh")` + `fileContext={ path, isDir }` → 触发文件感知分析（走 `dsh-file-context-conversation` Phase 3–4）。
- 单实例保护：Tauri 单例（已有或 `tauri-plugin-single-instance`）确保回传落到运行中的主进程，不双开。

## 5. 复用清单（不重复造）

- 复制地址逻辑：`dsh-file-context-conversation` Phase 1 的 `filesAsPaths` 纯路径写入。
- 文件感知分析：`dsh-file-context-conversation` Phase 2–3 的 `read_file_for_analysis` 宿主侧读取 + 任务构造。
- 悬浮对话：`deepseek-harness-embedding` Phase 6–7 的常驻守护进程 + `dsh` surface。
- 快速唤起基座：`deepseek-harness-embedding` 既有全局快捷键 + 托盘。

## 6. 降级

- 主进程未运行 + 系统唤起失败 → 仅「复制地址」仍可本地完成；「开始对话」提示先启动 ClipForge。
- DSH 未就绪 → 落到 `dsh` surface 的降级态（见 `deepseek-harness-embedding` 降级契约）。
