# 任务：系统级文件管理器右键

> ⛔ **已废弃（2026-09-11 盟哥拍板）**：pi sdk（github.com/earendil-works/pi）确立为 ClipForge
> Agent 能力基础，DSH 全链废弃删除。本提案不再推进；删除进度与能力替代见
> [pi-sdk-agent-foundation](../pi-sdk-agent-foundation/proposal.md)。归档待 DSH 代码删除完成后执行。


> 状态（2026-08-17 立项）：重原生扩展，后置。依赖 `dsh-file-context-conversation` 与 `deepseek-harness-embedding` Phase 6–7。应用内等价能力已具备，本提案只把入口外移到系统文件管理器。

## Phase 1：URL Scheme 桥接（主进程侧，前置）🟡

- [ ] 主进程用 Tauri `deep-link` 插件注册 `clipforge://` scheme（macOS `Info.plist` `CFBundleURLTypes` / Windows 注册表）。
- [ ] 解析 `clipforge://copy-path?path=` 与 `clipforge://dsh?path=`；`path` percent-decoding。
- [ ] 单实例保护（Tauri single-instance），确保回传落到运行中的主进程。
- [ ] `copy-path` → 写纯路径到剪贴板（复用 `dsh-file-context-conversation` 的 `filesAsPaths` 逻辑）。
- [ ] `dsh?path=` → `setActiveSurface("dsh")` + `fileContext`，触发文件感知分析（复用 Phase 3–4）。

## Phase 2：macOS Finder Sync Extension 🟡

- [ ] 新增 `FIFinderSyncExtension` target，随包分发并注册。
- [ ] 注入右键菜单「复制地址」「用 ClipForge 分析」；点击经 `clipforge://` scheme 回传主进程。
- [ ] 开发者 ID 签名 + 公证；确认店外分发路径（Finder Sync 不在 App Store 沙盒）。

## Phase 3：Windows Explorer Shell 扩展 🟡

- [ ] 实现上下文菜单 COM DLL（`IShellExtInit` + `IContextMenu`），注册表挂 `HKCR\*\shell\ClipForge\`。
- [ ] 点击调起 `clipforge.exe` 传 `--open-dsh "<path>"` 或 `clipforge://dsh?path=`。
- [ ] 代码签名；评估轻量注册表菜单替代方案成本。

## Phase 4：验收与降级 🟡

- [ ] 手动验收：Finder/资源管理器右键文件 → 复制地址 / 开始对话 均生效；主进程未运行能先启动再处理。
- [ ] DSH 未就绪时落到 dsh surface 降级态，不崩溃。
- [ ] `pnpm build:web` + `cargo check` + 对应平台打包验证。

## 关键技术坑

1. **Finder Sync 沙盒限制**：extension 不能直接调主进程内存，URL Scheme 是最稳桥接；`path` 必须 percent-encoding 防空格/中文截断。
2. **单实例**：必须用 single-instance，否则每次右键开一个新 ClipForge 窗口。
3. **签名/公证**：macOS Finder Sync 需开发者 ID + 公证，App Store 不可上，规划分发渠道。
4. **Windows COM 注册**：Shell 扩展 DLL 需正确注册表 + 代码签名，开发/测试环境需提权注册。
