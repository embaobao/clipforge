# 任务：GitHub 分发与检查升级能力

## Phase 1：发布契约

- [x] 确定 GitHub Release artifact 命名规则
- [x] 定义 `latest.json` 模板和平台字段
- [x] 在 release 脚本中生成 `checksums.txt`
- [x] 在 release 脚本中输出 release notes 输入位置
- [x] 文档化 stable / prerelease 的发布规则

## Phase 2：Tauri updater 配置

- [x] 配置 Tauri updater endpoint
- [x] 配置签名公钥与 artifact 签名流程
- [x] 本地验证 updater 能读取测试 manifest
- [x] 失败时输出可读错误码

## Phase 3：Rust UpdateService

- [x] 新增 `UpdateCheckState`
- [x] 新增 `check_update` command
- [x] 新增 `download_update` / `install_update` command
- [x] 将最近检查状态持久化到用户配置目录
- [x] 写入结构化日志

## Phase 4：前端入口

- [x] 设置页新增“更新”分组
- [x] 关于页展示当前版本与构建信息
- [x] 增加手动检查按钮和更新可用状态
- [x] 增加下载进度与失败提示
- [x] 支持忽略当前版本

## Phase 5：验证

- [x] `pnpm build` 通过
- [x] `cd src-tauri && cargo check` 通过
- [x] 使用本地状态验证“已是最新”
- [x] 使用本地/测试 manifest 验证“发现新版本”
- [x] 验证网络失败、平台不匹配、签名缺失的错误状态
