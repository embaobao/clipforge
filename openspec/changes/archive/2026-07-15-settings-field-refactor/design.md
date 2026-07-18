# 设计：设置字段注册表方案收敛

## 1. 当前状态

`settings-field-refactor` 当前只有大型 `proposal.md`，并且与 `settings-interface-redesign` 高度重叠。为避免两个设置页重构提案并行扩张，本 change 定位为“字段注册表与 schema-driven 渲染方案评审”，不直接替代 `settings-interface-redesign` 的已验证 UI 重构边界。

## 2. 收敛决策

- 设置页视觉、Sidebar、Tabs、Tooltip、动作分层和语义控件映射继续由 `settings-interface-redesign` 承接。
- `settings-field-refactor` 只评估是否需要引入配置项 catalog / registry / schema-driven renderer。
- 第一阶段不得引入重型 json-render runtime，也不得把设置页做成通用表单平台。
- 评审结论：采用最小 `SettingFieldConfig` catalog，并合并进 `settings-interface-redesign`；不采用 `json-render`、`@json-render/*`、`zod` 或通用 schema-driven renderer。

## 3. 推荐拆法

```text
settings-interface-redesign
  UI shell
  component mapping
  tabs/sidebar/tooltip/code tabs

settings-service-unified-protocol
  settings document
  schema
  patch/replace/reset
  provider redaction

settings-field-refactor
  superseded decision record
  no independent implementation
  archive after validation
```

## 4. 最小字段声明

采用字段注册表时，只允许声明渲染所需的稳定信息：

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

校验 schema 和写入策略仍属于 Settings Service，不在 React 字段注册表中重复定义。

## 5. 退出标准

该 change 完成后的状态：

- 已合并：最小 catalog 决策写回 `settings-interface-redesign`。
- 已作废：本 change 标记为 superseded，不再单独实施。

不应让它长期作为独立 P0.7 实现线存在。
