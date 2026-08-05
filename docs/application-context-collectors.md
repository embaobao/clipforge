# 应用上下文采集器兼容指南

> 当前文档只描述现有 `clipforge.application-context.collector.v1` 兼容入口。新的外部脚本能力已经收敛到 `external-hook-plugin-runtime` 提案，正式实现前以该提案的生命周期、沙盒和 Proposal/Apply 规则为准。

## 当前协议边界

旧 collector 是只读上下文适配器，脚本通过 JSON stdio 工作：

- stdin：一个 collector input JSON 对象。
- stdout：一个 collector output JSON 对象。
- 不直接访问 SQLite、React state、Tauri AppHandle 或系统剪贴板写接口。
- 外部执行默认关闭，必须显式开启 `enableExternalContextCollectors`。
- 输出会经过 JSON、大小、超时、路径和敏感字段校验。

旧 collector 的能力只包括 `context.read` 和 `context.patch`，不会因为迁移到 Hook Runtime 自动获得内容回写能力。

## 安装目录

macOS：

```text
~/Library/Application Support/ClipForge/context-collectors/<collector>/
```

兼容目录中的最小文件：

```text
collector.json
collector.sh
```

Manifest 示例：

```json
{
  "schemaVersion": 1,
  "id": "browser.chrome.example",
  "name": "Chrome active tab example",
  "version": "0.1.0",
  "enabled": true,
  "command": "./collector.sh",
  "args": [],
  "match": {
    "bundleIds": ["com.google.Chrome"]
  },
  "permissions": ["automation"],
  "timeoutMs": 500,
  "maxOutputBytes": 65536
}
```

ClipForge 不使用 shell 拼接执行命令，`command` 必须解析到 collector 目录内部的文件。

## 输出示例

```json
{
  "schemaVersion": 1,
  "context": {
    "browser": {
      "url": "https://example.com",
      "title": "Example"
    }
  },
  "signals": ["chrome-active-tab"],
  "permissions": {
    "automation": "used"
  },
  "confidence": "high"
}
```

禁止输出 Prompt、transcript、token、password、cookie、authorization、secret 或 API key。敏感字段即使由脚本输出，也会在宿主边界被递归替换为 `null`。

## MCP 兼容入口

- `clipboard.context.collector.contract`：查看当前 v1 契约。
- `clipboard.context.collectors.list`：查看内置和外部 collector。
- `clipboard.context.live`：获取实时应用上下文。
- `clipboard.context.collector.debug`：使用当前应用或 fixture 调试 collector。

新的 Hook 运行时将增加 `clipboard.hook.*` 工具，用于多 Hook 洋葱执行、内容 proposal 和确认回写。外部脚本不能直接写入内容，必须由 Host Apply Service 执行。

## 迁移指引

1. 现有 collector 继续通过 `clipboard.context.*` 运行。
2. 新能力使用 `application-hook.v1` manifest 和 `clipboard.hook.*`。
3. 多个同应用适配器按 `priority` 顺序执行，后层通过 `collectedContext` 获取前层结果。
4. 内容转换只能返回 `contentProposal`，不能直接覆盖历史或系统剪贴板。
5. 剪贴板捕获后的外部 Hook 采用异步补写，基础条目不等待脚本完成。

完整设计见 [`external-hook-plugin-runtime`](../openspec/changes/external-hook-plugin-runtime/proposal.md)、[`design.md`](../openspec/changes/external-hook-plugin-runtime/design.md) 和 [`tasks.md`](../openspec/changes/external-hook-plugin-runtime/tasks.md)。

