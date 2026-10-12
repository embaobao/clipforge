# ClipForge 插件 API 参考(agent-plugin-runtime)

> 状态:随提案 draft(未实施)。四件套——ctx 方法集 / manifest schema / 事件信封 / 能力分级——进 golden 测试,改动 = 显式交接。
> 开发流程与排障见 [PLUGIN_DEV_GUIDE.md](PLUGIN_DEV_GUIDE.md);语义细节见 [design.md](../design.md)。

## 1. ctx 方法集(插件唯一可见面)

```js
ctx.clipf.search({ q, limit?, tag?, since? })      // 异步,按声明存在
ctx.clipf.read({ id, maxLen? })                     // 异步,默认截断 256KB
ctx.clipf.tag.write({ id, tags, source? })          // 异步,元数据写级
ctx.on("clip.updated", (envelope) => { ... })       // 同步注册,仅已声明事件名生效
ctx.register.tool({ name, description, inputSchema, handler })
ctx.register.ui({ surface, title, icon?, order?, action })
ctx.register.template({ name, text, variables? })
ctx.log.debug|info|warn|error(msg, extra?)
```

- 未声明能力 = 对象不存在(`ctx.clipf.search` 为 undefined),不产生错误回执。
- `ctx.on` 收到未声明事件名:静默忽略。
- 阶段门:`activate` 内调 `ctx.clipf.*` → `PLUGIN_ACTIVATE_READONLY`;`activate` 外注册 → 阶段关闭。

## 2. 能力对象 clipf.*(首批)

| 能力 | 签名 | 返回 | 授权级 |
|---|---|---|---|
| `clipf.search` | `({ q, limit?=20, tag?, since? })` | `{ items: [{ id, preview, bytes, contentType, capturedAt, tags[] }], total }`(不含正文;`bytes` 供预过滤) | 读,启用即用 |
| `clipf.read` | `({ id, maxLen? })` | `{ id, content(≤maxLen), contentLength, truncated, contentType, metadata }`(过 L2 key redaction) | 读,启用即用 |
| `clipf.tag.write` | `({ id, tags[], source? })` | `{ ok, tags }` | 元数据写,安装时一次授权 |

- `read` 默认 `maxLen`=256KB,显式 opt-in 上限 `min(memoryLimit/4, 2MB)`,超上限报 `PLUGIN_CAPABILITY_OUTPUT_OVERSIZE`;大条目批处理用 `maxLen` 分页。

**能力分级授权**(进 golden):读 = 启用即可用;元数据写(打标)= 安装时一次性授权,无逐次 confirm;内容写/删除/粘贴回写 = 逐次 confirm(v1 未开放此级能力)。

二期能力(预留,未实施):`ai.invoke({ prompt, system?, maxTokens? }) → { text, usage }`——走宿主 provider 层,插件不可指定 endpoint。

## 3. 事件与信封

| 事件名 | 载荷信封 |
|---|---|
| `capture.finished` | `{ v: 1, type, clipId, tsMs, bytes, payloadKind }` |
| `clip.updated` | `{ v: 1, type, clipId, tsMs, bytes, payloadKind }` |
| `clip.trashed` / `clip.restored` | `{ v: 1, type, clipId, tsMs, bytes, payloadKind }` |

- `bytes`=条目正文字节数、`payloadKind`=内容类型标记;插件凭它先探大小再决定 read。

- 信封 schema 以 design §6 为唯一权威;事件名对齐 agent-extension-seams 已发布清单;插件侧载荷只读。
- 分发:有界队列(每插件 64),满载丢弃并计数;超 eventBudgetMs 该插件降级;绝不反压热路径。

## 4. 注册类型 ctx.register.*

### tool

```js
ctx.register.tool({
  name: "tag-stats",                    // 实际暴露为 plugin.<包名>.tag-stats(前缀宿主加)
  description: "按标签统计剪贴板历史",
  inputSchema: { /* JSON Schema draft-07 */ },
  async handler(input) { return { byTag: { ... } }; }  // 返回须 JSON 可序列化,≤1MB
});
```

### ui(surface 白名单)

| surface | 声明 | 行为 |
|---|---|---|
| `quick-panel-button` | `{ title, icon(lucide 名), order?, action }` | `action: { tool: "<自有工具名>" }`(宿主代调)或 `{ url }`;禁止 JS 点击回调 |
| `agent-tab` | `{ title, component: "readonly-list"|"form", props }` | 受控组件白名单;自定义组件二期 |

### template

```js
ctx.register.template({ name: "weekly-summary", text: "...", variables?: ["date"] });
// 命名空间 plugin.<包名>.weekly-summary;变量占位符编辑器内校验
```

## 5. powerpack.* 宿主工具(Agent 操作插件的唯一入口)

宿主固有 MCP 工具,不进插件命名空间;走 specs.rs 登记(golden 三处同步)。

| 工具 | 入参 | 返回/行为 | 门禁 |
|---|---|---|---|
| `powerpack.scaffold` | `{ id, name, slots?, capabilities? }` | 骨架 + **当前能力/事件清单** | 无 |
| `powerpack.validate` | `{ dir }` | 通过 → 暂存区;拒绝 → 错误码 + pointer | 不改生效状态 |
| `powerpack.pack` | `{ id }` | tar.gz + b3sum | 无 |
| `powerpack.install` | `{ package, checksum }` | 生效/拒绝 | **用户逐次确认**(capabilities 授权) |
| `powerpack.uninstall` | `{ id, purge? }` | 删包(config 默认保留) | 用户确认 |
| `powerpack.list` | `{}` | 各插件状态 + memoryUsage | 无 |
| `powerpack.logs` | `{ pluginId, level?, limit?=100 }` | 该插件日志行,tsMs 倒序 | 无 |
| `powerpack.config.get` | `{ id }` | 当前配置 | 无 |
| `powerpack.config.set` | `{ id, config }` | 校验 + 原子写 + 重启插件 | **用户逐次确认** |
| `powerpack.doctor` | `{}` | 注册表对账修复(孤儿/残留/损坏) | 无 |

## 6. 错误码(稳定前缀,进 golden)

MCP 层回 JSON-RPC error `{code, message, data}`;code:-32602 参数错 / -32000 内部错;`data` 带 `{pluginId?, pointer?, stack?}`。

| 错误码 | 触发 | Agent 自愈 |
|---|---|---|
| `PLUGIN_NOT_FOUND` | 操作不存在的 id | 查 `powerpack.list` |
| `PLUGIN_ALREADY_INSTALLED` | install 时 id 占位 | 先 uninstall |
| `PLUGIN_MANIFEST_INVALID` | manifest 不合 schema | 按 data.pointer 修 |
| `PLUGIN_SLOTS_MISMATCH` | runtime 注册 ⊄ manifest.slots | 对齐声明 |
| `PLUGIN_CAPABILITY_UNKNOWN` | 声明未发布能力/事件 | 读 scaffold 清单 |
| `PLUGIN_PATH_ESCAPE` | realpath 逃逸 | 修源路径 |
| `PLUGIN_CHECKSUM_MISMATCH` | 校验和不符 | 重新 pack |
| `PLUGIN_ACTIVATE_READONLY` | activate 内调能力 | 移到回调/handler |
| `PLUGIN_TOOL_TIMEOUT` | handler 超时 | 减计算、拆步骤 |
| `PLUGIN_TOOL_OUTPUT_OVERSIZE` | 返回 >1MB | 分页 |
| `PLUGIN_INPUT_OVERSIZE` | 入参 >256KB | 减参 |
| `PLUGIN_EVENT_DROPPED` | 队列满/预算超限 | 降频 |
| `PLUGIN_EVENT_PAYLOAD_OVERSIZE` | 事件载荷 >64KB | —(宿主侧拒投) |
| `PLUGIN_MEMORY_EXCEEDED` | 内存三层链任一命中 | 查泄漏、降数据量 |
| `PLUGIN_NOT_CONFIRMED` | 未经用户确认(-32602) | 停止,不改状态 |
| `PLUGIN_LOG_RATE_EXCEEDED` | ctx.log 限流溢出 | —(丢弃计数) |
| `PLUGIN_CONFIG_INVALID` | 配置不合 schema | 按 pointer 修 |
| `PLUGIN_CONFIG_SELF_HEALED` | config.json 损坏回退 default | —(warn) |
| `PLUGIN_APPLY_FAILED` | activate/dry-run 抛异常(非桥兜底码) | 看 data.stack 修码 |
| `PLUGIN_REGISTRY_DRIFT` | doctor 检出注册表漂移 | 跑 `powerpack.doctor` |
| `PLUGIN_CAPABILITY_OUTPUT_OVERSIZE` | 能力返回超 opt-in 上限 | 用 maxLen 分页 |
| `PLUGIN_TOO_MANY_PLUGINS` | 启用数 >16 / 聚合内存 >128MB | 停用不用的插件 |

JS 异常(非桥错误):message + stack 原样透传,不套前缀。

## 7. 预算与上限速查

| 项 | 默认 | 上限 |
|---|---|---|
| memoryLimit(QuickJS 分配记账口径) | 8MB | 32MB |
| toolTimeoutMs | 5000 | 30000 |
| eventBudgetMs | 100 | 100(不可调高) |
| 事件队列深度 | 64 | 64 |
| 栈 | 256KB | 宿主固定 |
| 单包体积 | — | 10MB |
| 能力调用返回(read 等) | 256KB(默认截断) | min(memoryLimit/4, 2MB)(显式 opt-in) |
| 启用插件数 | — | 16 |
| 聚合内存(启用插件 memoryLimit 之和) | — | 128MB |
| ctx.log | 100 行/分 | 突发 1000 |

超时机制为双层看门狗(interrupt handler 管 CPU 循环 + tokio timeout 管 await 挂起),任一层命中即超时。

## 8. manifest schema 全表

| 字段 | 必填 | 校验 |
|---|---|---|
| `api` | 是 | 契约版本,当前 `1`;宿主支持 N 与 N-1 |
| `id` | 是 | 反向 DNS,全局唯一,装包即占位 |
| `name` / `version` | 是 | 展示名 / semver |
| `entry` | 否 | 默认 `main.js` |
| `capabilities.clipf` | 否 | ⊆ 已发布能力清单,越界拒绝 |
| `capabilities.events` | 否 | ⊆ 已发布事件清单 |
| `slots.tools[]` | 否 | `{ name, description }` |
| `slots.ui[]` | 否 | `{ surface, title, icon?, order? }` |
| `slots.templates[]` | 否 | `{ name }` |
| `config` | 否 | JSON Schema(draft-07 子集),顶层属性必须带 default |
| `memoryLimit` | 否 | 默认 8MB,上限 32MB |
| `toolTimeoutMs` | 否 | 默认 5000,上限 30000 |
| `eventBudgetMs` | 否 | 默认 100,不可调高 |
| `source` | 否 | 预留(additive),v1 不实现拉取 |

生命周期钩子 = `export function activate(ctx, config)`(必须,同步)+ `export async function deactivate(ctx)`(可选)。
