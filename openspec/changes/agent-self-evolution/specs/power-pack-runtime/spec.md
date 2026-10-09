# power-pack-runtime 规格

## ADDED Requirements

### Requirement: 能力包生命周期

能力包 MUST 以目录为单位(`power-packs/<id>/power-pack.json` + 资源),生命周期为 `discovered → validated → installed → disabled → uninstalled`;安装与卸载 MUST 经用户确认,写入 MUST 为原子替换(临时文件 + rename),任何一步失败 MUST 回滚到前一状态。

#### Scenario: 安装合法能力包

- **WHEN** 用户确认安装一个通过 manifest 校验的能力包
- **THEN** 目录原子落盘,三插槽(悬浮窗按钮/pi-web tab/提示词模板)按声明生效
- **AND** 日志记录 `[power-pack] installed id=<id> slots=[...]`

#### Scenario: 回滚失败的安装

- **WHEN** 安装过程中 schema 校验或插槽注册失败
- **THEN** 已写入的目录被移除,宿主状态保持安装前,错误信息返回给发起的 Agent 工具调用

### Requirement: manifest 校验

`power-pack.json` MUST 声明 `id`(kebab-case 唯一)、`version`、`slots`(0-3 类插槽声明)。缺失必填字段、id 冲突、未声明的插槽类型 MUST 拒绝安装并给出可定位错误。

#### Scenario: 非法 manifest 被拒绝

- **WHEN** manifest 缺少 `id` 或声明了不存在的插槽类型
- **THEN** 校验失败,错误含字段路径,不产生任何目录写入

### Requirement: 插槽渲染契约

宿主 MUST 只暴露声明式插槽:悬浮窗按钮(icon + label + action)、pi-web tab(title + 受控组件声明)、提示词模板(name + text)。能力包 MUST NOT 注入任意 DOM、脚本或 eval;动作仅限调用已注册 L2 工具或打开声明过的 URL。

#### Scenario: 悬浮窗插槽按钮触发工具

- **WHEN** 用户点击能力包声明的悬浮窗按钮
- **THEN** 宿主调用该按钮绑定的 L2 工具并把结果按面板交互规范展示

# prompt-template-management 规格

## ADDED Requirements

### Requirement: 模板注册与覆盖

提示词模板注册表 MUST 由「内置模板 + 能力包模板」组成;用户编辑 MUST 写入用户覆盖层,删除 MUST 恢复为上一层定义(能力包卸载后其模板自动注销)。

#### Scenario: 用户覆盖内置模板

- **WHEN** 用户在内置模板上保存修改
- **THEN** 覆盖层记录新文本,列表标记「已自定义」,恢复默认操作清掉覆盖层

#### Scenario: 导入导出

- **WHEN** 用户导出模板
- **THEN** 生成含全部模板与覆盖层的 JSON;导入时经同一 manifest/覆盖层校验,冲突可逐条选择保留
