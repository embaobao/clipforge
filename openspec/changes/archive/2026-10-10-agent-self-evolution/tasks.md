# Tasks:agent-self-evolution

## 1. 能力包运行时

- [ ] 1.1 power-pack manifest schema 定义与校验(zod 前端 + Rust serde 双侧)
- [ ] 1.2 power_pack Rust 模块:发现/安装/卸载/回滚(原子写,复用 settings_service 原子写模式)
- [ ] 1.3 MCP 工具 `powerpack.scaffold` + `powerpack.validate`(登记 agent-extension-seams 计数)

## 2. 界面插槽

- [ ] 2.1 悬浮窗底部工具条插槽渲染(图标按钮 + 动作分发)
- [ ] 2.2 pi-web tab 插槽(受控只读卡片/表单组件)
- [ ] 2.3 插槽空态与冲突处理(多能力包抢占同一插槽的排序规则)

## 3. 提示词模板

- [ ] 3.1 模板注册表(内置 + 能力包),Agent 对话模板选择器接入
- [ ] 3.2 设置页「提示词模板」分区:查看/编辑/导出/导入

## 4. 验收与门禁

- [ ] 4.1 能力包安装/回滚 golden 用例;manifest 非法输入拒绝用例
- [ ] 4.2 插槽渲染 surface 校验脚本接入 verify-runtime-boundaries
- [ ] 4.3 docs/BUSINESS_INDEX.md 登记 power-pack 域入口
