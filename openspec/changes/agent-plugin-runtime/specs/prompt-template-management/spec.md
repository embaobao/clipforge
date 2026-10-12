# prompt-template-management 规格增量

## ADDED Requirements

### Requirement: 提示词模板统一注册表

系统 SHALL 维护统一的提示词模板注册表:内置模板为基线,插件模板经 `ctx.register` 加入并命名空间隔离(`plugin.<包名>.<模板名>`),用户自定义模板为最高优先级覆盖层。

#### Scenario: 用户覆盖内置模板

- **WHEN** 用户编辑与内置模板同名的自定义模板并启用
- **THEN** Agent 对话模板选择器解析到用户版本,内置版本保留可恢复

### Requirement: 模板管理界面

设置页 SHALL 提供模板分区:查看(内置/插件/自定义三来源标记)、编辑、导出、导入;模板含变量占位符时 SHALL 在编辑器中可校验。

#### Scenario: 插件模板被卸载后清理

- **WHEN** 贡献模板的插件被卸载
- **THEN** 其命名空间模板从注册表移除;若某对话配置引用了该模板,引用降级为默认模板而非报错
