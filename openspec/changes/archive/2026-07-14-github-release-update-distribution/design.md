# 设计：GitHub 分发与检查升级能力

## 分发模型

第一阶段使用 GitHub Releases 作为唯一远程分发源：

```text
GitHub Release
  ClipForge_<version>_macos_universal.dmg
  ClipForge_<version>_macos_universal.dmg.sig
  latest.json
  checksums.txt
  RELEASE_NOTES.md
```

`latest.json` 使用 Tauri updater 可消费的格式，同时保留 ClipForge 自己的展示字段：

```json
{
  "version": "0.1.1",
  "notes": "修复粘贴焦点恢复，新增图片剪贴板预览。",
  "pub_date": "2026-07-10T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "...",
      "url": "https://github.com/<owner>/<repo>/releases/download/v0.1.1/ClipForge_0.1.1_macos_aarch64.dmg"
    },
    "darwin-x86_64": {
      "signature": "...",
      "url": "https://github.com/<owner>/<repo>/releases/download/v0.1.1/ClipForge_0.1.1_macos_x86_64.dmg"
    }
  },
  "clipforge": {
    "channel": "stable",
    "minAppVersion": "0.1.0",
    "critical": false,
    "permissionsChanged": false
  }
}
```

## 应用内状态模型

```ts
export type UpdateCheckState = {
  status: "idle" | "checking" | "available" | "latest" | "downloading" | "ready" | "failed";
  currentVersion: string;
  availableVersion?: string;
  channel: "stable" | "prerelease";
  lastCheckedAt?: number;
  ignoredVersion?: string;
  releaseNotes?: string;
  downloadProgress?: number;
  errorCode?: string;
  errorMessage?: string;
};
```

该状态由 Rust update service 持久化到用户配置目录，前端只负责展示和触发命令。

## 更新检查流程

1. 应用启动后延迟 30 秒检查，避免影响快速面板。
2. 用户可在设置页/关于页手动检查。
3. Rust service 请求 `latest.json`，解析版本、平台、签名字段。
4. 若当前版本已是最新，写入 `latest` 状态。
5. 若存在新版本，写入 `available` 状态并展示 release notes。
6. 用户点击更新后才开始下载。
7. Tauri updater 验证签名并安装。
8. 失败时保留错误码、更新源 URL 和 traceId。

## UI 入口

- 设置页新增“更新”分组。
- 关于页展示当前版本、构建信息、检查更新按钮。
- 更新可用时显示紧凑提示，不弹出阻塞式窗口。
- 快速面板不展示更新营销文案，只允许一个低干扰状态入口。

## 日志与排障

更新相关日志字段：

- `traceId`
- `currentVersion`
- `availableVersion`
- `channel`
- `manifestUrl`
- `platform`
- `signaturePresent`
- `status`
- `errorCode`

## 与后续能力升级的关系

本提案只做应用更新。后续能力 manifest、插件和 Agent adapter 更新复用 `UpdateCheckState` 的状态风格，但必须独立权限确认，不混入应用 updater。
