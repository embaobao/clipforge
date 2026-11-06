# prompt-template-management 规格

## ADDED Requirements

### Requirement: 模板注册与覆盖

提示词模板注册表 MUST 由「内置模板 + 能力包模板」组成;用户编辑 MUST 写入用户覆盖层,删除 MUST 恢复为上一层定义(能力包卸载后其模板自动注销)。

#### Scenario: 用户覆盖内置模板

- **WHEN** 用户在内置模板上保存修改
- **THEN** 覆盖层记录新文本,列表标记「已自定义」,恢复默认操作清掉覆盖层

#### Scenario: 导入导出

- **WHEN** 用户导出模板
- **THEN** 生成含全部模板与覆盖层的 JSON;导入时经同一覆盖层校验,冲突可逐条选择保留
