# 任务：应用国际化与英文支持

## Phase 1：基础设施

- [x] 新建 `src/i18n/` 目录和字典结构
- [x] 定义 `AppLanguagePreference` 与 `AppLocale`
- [x] 实现 `t()` 和 `useI18n()`
- [x] 支持简单参数替换
- [x] 缺失 key 在开发环境输出 warning
- [x] 增加 `zh-CN` / `en-US` key 对齐检查

## Phase 2：设置与启动

- [x] settings JSON 增加 `language`
- [x] 设置页新增语言选择：跟随系统 / 中文 / English
- [x] 启动时解析系统语言并确定实际 locale
- [x] 切换语言后刷新 UI
- [x] 重启后保持用户选择
- [x] 设置 `document.documentElement.lang`
- [x] 设置主窗口和设置窗口标题

## Phase 3：前端 UI 文案迁移

- [x] 快速面板文案接入 i18n
- [x] 设置页文案接入 i18n
- [x] 详情页基础动作接入 i18n
- [x] 空状态、错误状态、toast 接入 i18n
- [x] 按钮 tooltip 和菜单项接入 i18n
- [ ] 检查英文文案长度不破坏快速面板布局

## Phase 4：原生菜单与系统提示

- [x] 托盘菜单文案接入语言设置
- [x] 暂停/恢复监听文案随语言刷新
- [x] 权限提示文案接入 i18n
- [x] 更新检查相关文案预留 key
- [x] 前端新增 `CODE: detail` 原生命令错误解析与 i18n 格式化，详情编辑保存错误已接入
- [x] Rust command 错误保留错误码，UI 层负责翻译可读提示

## Phase 5：收口检查

- [x] 新增硬编码用户文案扫描脚本
- [x] 白名单排除日志字段、错误码、测试、文档和用户内容
- [x] 新增 key 引用存在性检查
- [x] 在发版 checklist 中加入 i18n 检查
- [x] 文档化新增功能必须同步补中文和英文文案

## Phase 6：验证

- [x] `pnpm build` 通过
- [x] `cd src-tauri && cargo check` 通过
- [ ] 验证默认跟随系统
- [ ] 验证中文切换
- [ ] 验证英文切换
- [ ] 验证重启后语言保持
- [ ] 验证托盘菜单语言刷新
- [ ] 验证英文长文案不导致按钮、列表、设置表单溢出
