# 设计：统一 Settings Service 与 MCP 设置协议

## 1. 当前接口审计

当前前端和 native 入口并不统一：

- `src/settings.tsx` 自己声明 `AppSettings`，初始化直接并发调用多个 native command，保存直接调用 `update_clipforge_settings`。
- `src/App.tsx` 自己声明另一份 `AppSettings`，初始化调用 `read_user_settings`，变更后 debounce 调用 `write_user_settings` 写整份设置。
- `src/agent-panel.tsx` 直接调用 `agent_get_config`、`agent_detect`、`agent_check_provider`。
- `src/services/contracts.ts` 已有 Agent provider 类型，但没有 Settings document、Settings schema、Settings patch 和 Settings service contract。

结论：不能直接把 MCP 和设置页“各自补一个接口”。必须先定义一个单一 Settings Service，再让 Tauri command、MCP 和前端设置页作为适配层调用它。

## 2. 总体架构

```text
SettingsService (Rust domain service)
  - get()
  - patch()
  - replace()
  - reset()
  - agentProviders()
  - agentCheckProvider()
  - agentListModels()
  - emitSettingsChanged()

Adapters
  Tauri commands
    settings_service_get
    settings_service_patch
    settings_service_replace
    settings_service_reset
    settings_service_agent_providers
    settings_service_agent_check
    settings_service_agent_models

  MCP tools
    clipf.settings.get
    clipf.settings.patch
    clipf.settings.replace
    clipf.settings.reset
    clipf.agent.providers
    clipf.agent.check
    clipf.agent.models

  Frontend service
    src/services/settings.ts
      settingsService.get()
      settingsService.patch()
      settingsService.replace()
      settingsService.reset()
      settingsService.subscribe()
      settingsService.agent.*
```

规则：

- 前端设置页不直接调用底层 `read_user_settings` / `write_user_settings`。
- MCP 不直接写文件。
- Agent provider 解析、默认 provider、模型拉取和 redaction 只在 Settings Service 内实现一次。
- 主面板首批不迁移，保留现状；后续单独开任务迁移。

## 3. 协议对象

```ts
type SettingsDocument = {
  settings: AppSettings;
  schema: JsonSchema;
  revision: string;
  updatedAt: number;
  source: "tauri" | "mcp";
  writePolicy: {
    recommendedMode: "patch";
    replaceRequiresConfirmation: true;
    resetRequiresConfirmation: true;
    arrayMerge: "replace";
  };
  warnings: string[];
  redaction: Record<string, string>;
};

type SettingsPatchRequest = {
  patch: Partial<AppSettings>;
  actor: "settings-window" | "mcp" | "agent" | "system";
  reason?: string;
  expectedRevision?: string;
};

type SettingsReplaceRequest = {
  settings: AppSettings;
  actor: "settings-window" | "mcp" | "agent" | "system";
  reason?: string;
  expectedRevision?: string;
  confirmed: true;
};

type SettingsResetRequest = {
  scope: "all" | "agent" | "shortcuts" | "display" | "capture" | "storage" | "logs" | "tags";
  actor: "settings-window" | "mcp" | "agent" | "system";
  reason?: string;
  expectedRevision?: string;
  confirmed: true;
};
```

## 4. 实时性

写入成功后统一发事件：

```ts
type SettingsChangedEvent = {
  revision: string;
  previousRevision: string;
  changedPaths: string[];
  actor: "settings-window" | "mcp" | "agent" | "system";
  mode: "patch" | "replace" | "reset";
  updatedAt: number;
};
```

策略：

- 设置窗口订阅 `settings_changed`，收到事件后根据 `revision` 拉取或局部刷新。
- MCP 写入同样触发事件。
- 首批不要求主面板订阅，避免影响主流程。
- 后续主面板迁移时再把 debounce 整体写回改为 patch + subscribe。

## 5. 性能稳定

- `get()` 返回 schema 可能较大，前端服务可在同一 revision 下缓存 schema。
- `patch()` 只传局部字段，避免每次保存整份设置。
- Provider readiness 和 models 拉取必须有 timeout、缓存和显式刷新参数。
- `agentListModels()` 只返回模型 ID、状态、错误摘要，不返回 key。
- MCP `settings.get` 默认返回 schema；可支持 `includeSchema=false` 减少传输。

## 6. 原子性与并发

写入流程：

```text
read current settings
validate request against schema
check expectedRevision if provided
apply patch / replace / reset
write temp file
fsync temp file if platform supports it
atomic rename to settings path
emit settings_changed
return SettingsDocument
```

规则：

- patch 是默认写入方式。
- replace/reset 必须显式确认。
- 数组字段按整体替换，不做隐式数组 merge。
- `expectedRevision` 不匹配时返回 conflict，调用方应重新 get 后再 patch。
- 写入失败不得发事件。

## 7. Schema 与校验

`get()` 必须返回 JSON Schema。Schema 至少覆盖：

- 基础设置：语言、快捷键、面板密度、内容显示、尺寸、定位。
- 采集设置：文本、HTML、RTF、图片、文件、敏感内容、大小上限。
- 存储与日志：清理策略、日志上限、保留策略。
- Tag 规则：`tagMode`、`tagRules[]`。
- Agent：`agent.defaultProviderId`、`agent.providers[]`。

校验返回结构：

```json
{
  "ok": false,
  "code": "SETTINGS_SCHEMA_VALIDATION_FAILED",
  "errors": [
    { "path": "$.agent.providers[0].baseUrl", "message": "must be a URL" }
  ],
  "hint": "Use clipf.settings.get to inspect schema, then retry with a patch."
}
```

## 8. Agent Provider 配置

标准配置写到 `settings.agent`：

```json
{
  "agent": {
    "defaultProviderId": "openai-main",
    "providers": [
      {
        "id": "openai-main",
        "name": "OpenAI compatible",
        "kind": "openai-compatible",
        "enabled": true,
        "baseUrl": "https://api.openai.com/v1",
        "modelId": "gpt-4.1-mini",
        "apiKeyEnv": "OPENAI_API_KEY",
        "timeoutSeconds": 120
      },
      {
        "id": "local-codex",
        "name": "Codex CLI",
        "kind": "local-cli",
        "enabled": false,
        "command": "codex",
        "args": []
      }
    ]
  }
}
```

兼容策略：

- 读取兼容旧 `agentProviders`。
- 新写入默认写 `agent.providers`。
- `apiKey` 允许作为写入字段，但 provider 列表响应必须 redacted。
- 推荐 `apiKeyEnv`，设置页应优先引导用户使用环境变量。

## 9. MCP 工具映射

| 工具 | 服务方法 | 写权限 | 说明 |
| --- | --- | --- | --- |
| `clipf.settings.get` | `get` | 否 | 返回设置、schema、writePolicy、redaction |
| `clipf.settings.patch` | `patch` | 是 | 推荐写入，局部更新 |
| `clipf.settings.replace` | `replace` | 是 | 全量替换，必须 confirmed |
| `clipf.settings.reset` | `reset` | 是 | scope reset，必须 confirmed |
| `clipf.agent.providers` | `agentProviders` | 否 | 返回 redacted provider 状态 |
| `clipf.agent.check` | `agentCheckProvider` | 否 | 测试默认或指定 provider |
| `clipf.agent.models` | `agentListModels` | 否 | 拉取模型列表 |

MCP 写入默认策略：

- 推荐 `clipf.settings.patch`。
- 当 Agent 试图 replace/reset 时，如果缺少 `confirmed=true`，返回明确错误和下一步。
- 每个写入响应都包含 `changedPaths`、`revision` 和 `nextActions`。

## 10. 分阶段计划

第一阶段：

- 新增 Settings Service 协议和 Tauri command。
- 新增 MCP settings/agent 工具。
- 设置窗口接入 `src/services/settings.ts`。
- 不迁移主面板。

第二阶段：

- Agent 面板 provider 状态改走 `settingsService.agent.*`。
- 设置页 Agent provider 表单接入 patch、check、models。

第三阶段：

- 评估主面板迁移。只有在第一、二阶段稳定后，才把主面板从 `write_user_settings` 改为 patch + subscribe。

## 11. 方案评估

必要性：高。已有设置窗口、主面板、Agent 面板、MCP 多入口读写需求；不统一会继续扩大语义漂移。

收益：

- 统一 schema、校验、错误码和 redaction。
- MCP/Agent 初始化能力变成标准协议。
- 写入原子性和实时事件可控。
- 后续插件集成不需要重复造配置接口。

成本：

- 需要维护 schema。
- 需要做事件、revision、冲突检测。
- 需要谨慎迁移，不能一次性动主面板。

结论：采用，但必须分阶段。首批只覆盖设置窗口和 MCP，是收益和风险比较平衡的方案。
