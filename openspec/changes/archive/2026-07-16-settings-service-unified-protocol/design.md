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

统一边界：

- 统一的是 Rust domain service、JSON schema、错误码、redaction、revision、事件和写入策略。
- 前端设置页通过 Tauri command 适配器调用 Settings Service。
- MCP 通过 tools/call 适配器调用同一个 Settings Service。
- 前端不通过 MCP stdio 调用本机设置服务；MCP 是给外部 Agent 的协议入口。
- 主面板热路径不调用 Settings Service；第一阶段只允许设置窗口和 Agent 配置面使用。

## 2.1 控制面与热路径拆分

ClipForge 需要把设置控制面和剪贴板热路径拆开：

```text
Control Plane
  Settings window
  Agent provider config
  MCP settings tools
  schema / validation / revision / redaction / provider check / model list

Hot Path
  global shortcut trigger
  quick panel show/hide/position
  clipboard listener
  virtual list scroll/selection
  copy/paste writeback
  search/filter in current panel
```

第一阶段 Settings Service 只进入 Control Plane。Hot Path 继续保留现有低延迟链路，避免每次快捷键、每次滚动、每次复制都等待 schema、磁盘、MCP 或网络 provider。

允许的连接：

- 设置窗口写入后触发 `settings_changed`，设置窗口刷新自己的状态。
- Agent 配置面按需调用 provider check / models。
- MCP settings 工具读写配置并返回 schema、revision、changedPaths。
- 后续主面板迁移只能作为单独提案，在初始化阶段读取轻量 snapshot，不进入每帧交互。

禁止的连接：

- 主面板打开时默认拉取完整 schema。
- 主面板打开时默认检查 provider readiness 或拉取 model list。
- 主面板选中行、滚动、搜索、复制回写同步调用 Settings Service。
- 前端设置页通过 MCP tools/call 调本机服务。

## 2.2 前端与 MCP 的统一协议方式

前端和 MCP 共享协议，但使用不同传输：

| 调用方 | 传输 | 目标 | 是否进入热路径 |
| --- | --- | --- | --- |
| 设置窗口 | Tauri command `settings_service_*` | Settings Service | 否 |
| Agent 面板配置区 | Tauri command `settings_service_agent_*` | Settings Service | 否 |
| MCP Agent | MCP tools `clipf.settings.*` / `clipf.agent.*` | Settings Service | 否 |
| 主面板 | 现有本地状态和现有 command | 剪贴板主能力 | 是，首批不迁移 |

因此“一致性”来自服务和协议对象，不来自所有调用方共用同一个 transport。

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
- 事件不能携带完整 schema，避免大 payload 造成不必要渲染压力。
- 事件消费者必须用 `revision` 去重；同 revision 不重复刷新。
- 主面板若后续订阅，只能把刷新放到 idle/debounce 队列，不能阻塞快捷键打开。

## 5. 性能稳定

- `get()` 返回 schema 可能较大，前端服务可在同一 revision 下缓存 schema。
- `patch()` 只传局部字段，避免每次保存整份设置。
- Provider readiness 和 models 拉取必须有 timeout、缓存和显式刷新参数。
- `agentListModels()` 只返回模型 ID、状态、错误摘要，不返回 key。
- MCP `settings.get` 默认返回 schema；可支持 `includeSchema=false` 减少传输。
- 前端设置页初次打开可 `includeSchema=true`；后续同 revision 刷新应复用缓存或 `includeSchema=false`。
- Agent provider check/model list 不应在设置页首屏同步串行执行，除非用户点击测试或刷新。
- MCP tools/list schema 只是工具 schema，不代表主面板要预加载完整 settings schema。

## 5.1 300ms 交互预算

统一服务必须服务于体验稳定，而不是制造新的等待链路。第一阶段采用 300ms 硬预算：

| 场景 | 预算 | 证明方式 | 失败处理 |
| --- | --- | --- | --- |
| 快捷键触发到主面板可交互 | P95 <= 300ms，热缓存目标 <= 150ms | `performance.mark` / native log 记录 trigger、window show、first interactive | 不接入 Settings Service；回退现有主面板链路 |
| 主面板选中、滚动、复制/粘贴反馈 | P95 <= 300ms | 前端交互 mark + native copy/writeback log | 禁止等待 schema、settings patch、MCP 或 provider |
| 设置页 sidebar/tab 切换 | P95 <= 300ms | 前端 mark route/section switch | schema/cache 后台刷新，UI 先切换 |
| 设置页开关、输入、局部保存反馈 | P95 <= 300ms | mark input -> optimistic/local saved state -> command response | 300ms 内先给 pending/saved/error 状态，慢写入后台完成 |
| `settings.get(includeSchema=false)` | P95 <= 300ms | Tauri command duration log | schema 分离缓存，避免重复序列化大 schema |
| `settings.patch/reset` 本地写入 | P95 <= 300ms | command duration + changedPaths | patch 小对象，atomic write；超过预算必须标记慢操作 |
| MCP `clipf.settings.get includeSchema=false` | P95 <= 300ms | stdio handler duration log | includeSchema 默认可关闭，schema 单独按需获取 |

不适用 300ms 同步完成的场景：

- provider readiness check。
- OpenAI-compatible model list。
- 网络模型调用。
- Tauri updater / release check。
- 导出诊断包、批量导入导出、日志清理。

这些场景必须满足“300ms 内有可见状态反馈”，但真实完成时间可以超过 300ms。它们不能阻塞主面板打开、列表滚动、复制回写或设置页切换。

## 5.2 必要校验与防回归

实现必须增加以下防线：

- 前端 `settingsService` 对每个调用记录 `startedAt`、`endedAt`、`durationMs`，开发环境超 300ms 输出 warn。
- native Settings Service 对 get/patch/replace/reset/MCP handler 记录 duration，超 300ms 写入 app log。
- `settings_changed` 事件只广播小 payload，禁止携带完整 settings 或 schema。
- 设置页 schema 缓存按 `revision` 复用，不能每个表单控件 mount 都拉 schema。
- 主面板代码中不得出现 `settings_service_get`、`settings_service_patch`、`clipf.settings.*`、provider check/model list 的同步调用。
- provider check/model list 必须有 loading 状态、timeout 和取消/忽略过期结果策略。
- 自动化验证至少覆盖：MCP tools/list 不破坏、settings get/patch 基本路径、主面板打开路径没有新增设置服务调用。

## 5.3 主面板性能风险评估

| 风险 | 触发条件 | 处理策略 |
| --- | --- | --- |
| 快捷键打开变慢 | 打开面板时同步读 schema / provider / models | 第一阶段禁止主面板接入 Settings Service |
| 列表滚动卡顿 | `settings_changed` 触发整页重渲染 | 首批主面板不订阅；后续订阅需 revision 去重 + debounce |
| 复制回写延迟 | copy/paste 等待 settings patch 或 MCP 写入 | copy/paste 继续走现有 clipboard writeback |
| MCP 异常影响 UI | MCP tool handler 共享全局锁或阻塞主线程 | MCP 只通过服务函数读写配置，不触发 UI 操作 |
| provider 检查阻塞 | 网络模型检查在面板打开时自动执行 | readiness/models 必须用户触发或后台缓存，默认不跑 |

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
- 验证主面板快捷键打开、列表滚动、复制回写不新增 settings/schema/provider 调用。

第二阶段：

- Agent 面板 provider 状态改走 `settingsService.agent.*`。
- 设置页 Agent provider 表单接入 patch、check、models。
- provider check / models 默认按需，不随面板打开自动串行触发。

第三阶段：

- 评估主面板迁移。只有在第一、二阶段稳定后，才把主面板从 `write_user_settings` 改为 patch + subscribe。
- 如果迁移，必须先定义主面板 `SettingsSnapshot`，只包含主面板需要的轻量字段，不携带 schema、provider secret、model list。

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
