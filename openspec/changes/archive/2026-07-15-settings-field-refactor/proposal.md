# 提案：设置字段注册表方案收敛

## 状态

Superseded / merged into `settings-interface-redesign`。

本 change 不再作为独立实现线推进。设置页视觉、Sidebar、Tabs、Tooltip、Code Tabs、动作分层和语义控件映射统一由 `settings-interface-redesign` 承接；字段注册表只保留为该提案内部的最小 catalog 决策。

## 背景

`settings-field-refactor` 原本尝试把设置页改造成基于 Animate UI + schema-driven renderer 的通用配置平台，但它与 `settings-interface-redesign` 高度重叠：

- Sidebar、Tabs、Toggle Group、Code Tabs、Tooltip、动作分层都已由 `settings-interface-redesign` 定义。
- Settings Service 已负责 JSON Schema、revision、patch/replace/reset 写入策略和 provider redaction。
- 继续独立推进会导致两条设置页重构线同时修改 `src/settings.tsx`，并重复定义配置项语义。

## 最终决策

1. `settings-interface-redesign` 是设置页改版唯一实现入口。
2. 不采用 `json-render`、`@json-render/*`、`zod` 或通用 schema-driven renderer。
3. 不把设置页做成通用表单平台。
4. 只采用最小 `SettingFieldConfig` catalog，用于 UI 分组、排序、控件类型和 i18n key 映射。
5. React catalog 不重复定义 schema 校验、默认值、写入策略或 provider 解析。
6. 本 change 完成验证后可归档；后续不在 roadmap 中作为独立 P0.7 实现项出现。

## 合并到 `settings-interface-redesign` 的内容

最小字段声明：

```ts
type SettingFieldConfig = {
  id: string;
  section: string;
  tab: string;
  type: "toggle" | "switch" | "number" | "slider" | "readonly" | "code" | "action";
  labelKey: string;
  descriptionKey?: string;
  order: number;
};
```

该 catalog 的边界：

- 只描述 UI 放置、控件类型、文案 key 和排序。
- 不保存默认值，不做校验，不定义 patch/replace/reset 行为。
- 不直接从 JSON Schema 自动生成 UI；schema 只作为校验和边界参考。

## 非目标

- 不改变 `AppSettings` 字段名、Rust command 或配置持久化语义。
- 不新增设置项，不新增 Dev 模式，不新增日志控制台。
- 不扩大 MCP 能力面，不改变 `clipf.*` 工具命名。
- 不引入重型运行时或新的 schema 校验依赖。

## 用户价值

- 避免设置页重构分叉，减少后续实现冲突。
- 保留最小 catalog 带来的排序、分组和控件映射收益。
- 把校验和写入策略继续留在 Settings Service，避免 React UI 与服务协议漂移。

## 成功标准

- `settings-interface-redesign/design.md` 包含最小 `SettingFieldConfig` catalog 决策。
- `settings-interface-redesign/tasks.md` 明确不引入 `json-render` 或第二套 schema runtime。
- `settings-field-refactor/tasks.md` 标记为完成，`openspec validate settings-field-refactor --strict` 通过。
- `docs/PROPOSAL_ROADMAP.md` 不再把本 change 作为独立实现队列。
