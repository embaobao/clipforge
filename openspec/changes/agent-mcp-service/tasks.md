# 任务：Agent MCP 服务接口

## Phase 1：MCP Server 框架

- [ ] 定义 MCPServer 结构体
- [ ] 定义 MCPTool 结构体
- [ ] 实现 run_stdio 异步循环
- [ ] 实现 handle_request 方法
- [ ] 实现 tools/list 返回
- [ ] 实现 tools/call 调用

## Phase 2：Tool 定义

- [ ] 定义 capture_schema
- [ ] 定义 search_schema
- [ ] 定义 copy_schema
- [ ] 定义 update_schema
- [ ] 定义 delete_schema
- [ ] 定义 export_schema
- [ ] 定义 import_schema

## Phase 3：Tool 实现调用 ClipboardRepository

- [ ] 实现 capture（采集当前剪贴板）
- [ ] 实现 search（搜索历史）
- [ ] 实现 copy（写入剪贴板）
- [ ] 实现 update（更新条目属性）
- [ ] 实现 delete（删除条目）
- [ ] 实现 export（导出数据）
- [ ] 实现 import（导入数据）

## Phase 4：ClipboardRepository 扩展

- [ ] 实现 toggle_favorite 方法
- [ ] 实现 toggle_pin 方法
- [ ] 实现 update_note 方法
- [ ] 实现 soft_delete_item 批量删除
- [ ] 实现 list_items（Agent 调用）
- [ ] 实现 export_items
- [ ] 实现 import_items

## Phase 5：MCP Server 启动/停止命令

- [ ] 实现 start_mcp_server 命令
- [ ] 实现 stop_mcp_server 命令
- [ ] 实现 get_mcp_status 命令

## Phase 6：前端设置 UI

- [ ] 实现 MCPServerSettings 组件
- [ ] 启动/停止按钮
- [ ] 状态显示
- [ ] 帮助说明

## Phase 7：集成测试

- [ ] 测试：Claude Code 调用 clipboard.search
- [ ] 测试：Claude Code 调用 clipboard.copy
- [ ] 测试：MCP Server 启动/停止

## Phase 8：验证

- [ ] 测试：MCP Server stdio 启动
- [ ] 测试：tools/list 返回正确
- [ ] 测试：clipboard.search 搜索
- [ ] 测试：clipboard.copy 写入
- [ ] 测试：clipboard.export 导出
- [ ] `pnpm build` 通过
- [ ] `cd src-tauri && cargo check` 通过
- [ ] `pnpm tauri dev` 验证实际行为

## 依赖变更

### Cargo.toml

```toml
[dependencies]
serde_json = "1.0"
tokio = { version = "1.0", features = ["io-util", "io-std"] }
```

### package.json

无需新增依赖。

## 技术参考

### MCP 协议规范

- Anthropic MCP 文档
- Transport: stdio / SSE / WebSocket
- Tool 定义格式

### EcoPaste ExternalToolBridge

- 统一工具接口契约
- 与 UI 状态分离