# TASK-3 派单：插件运行时 Phase 1 桥接 spike（Rust，时间盒内做多少写多少）

你只在 /Users/embaobao/workspace/idea/clipforge 工作。node 在 `~/.nvm/versions/node/v22.22.2/bin`，
bash 里先 `export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"`。

## 背景（直接采信）

TASK-4/5/6 已全部验收（见 git log）。本任务是全队列最后一单：插件运行时 Phase 1 spike。
权威依据：`openspec/changes/agent-plugin-runtime/tasks.md` Phase 1（1.0-1.3）+ `design.md`
（§3 生命周期、§4 ctx 四组接口、§18 内存细则）。backlog 任务书：
`backlog/tasks/task-3 - 实施-agent-plugin-runtime-插件运行时Phase-1-桥接-spike-起步.md`。

## 目标（spike，不是生产功能）

Phase 1 是**闸门验证**：证明 cordis-rs Fiber 内嵌 rquickjs 能把宿主能力桥成 JS 可见对象。
做不通也要拿到结论（1.3 降级裁决），所以**代码可弃、结论必须留**。

按序做，每步完成即 commit：

1. **1.0 骨架**：`src-tauri/Cargo.toml` 加 `cordis-rs = "=0.11.1"` 精确 pin + rquickjs
   （版本以 cordis 0.11.1 实际依赖为准，`cargo add --dry-run` 先探测）。新建
   `src-tauri/src/plugin_runtime/` 门面模块（`mod.rs` + 子文件骨架）。**红线：cordis 类型
   不出 `plugin_runtime` 模块**（对外只暴露门面自有类型）。依赖装不进 / 与现有 tauri
   tokio 树冲突 → 立即写 findings 暂停，这是 spike 本身的有效结论。
2. **1.1 桥接闸门**：一个测试（`#[cfg(test)]` 或 `tests/`）里起一个 cordis Fiber 内嵌
   rquickjs Runtime，把 `ctx.clipf.*`（能力对象，stub 实现即可，返回假数据）、`ctx.on`、
   `ctx.register.*`、`ctx.log` 四组桥为 JS 可见对象；JS 侧能调通四组各至少 1 个方法，
   dispose 后断言 Runtime 与全部监听确定性回收（用 rquickjs `memory_usage` 或计数探针）。
3. **1.2 内存上限**：rquickjs `memory_limit` 按 manifest 声明值（测试里用一个 64 字节
   fixture manifest 的 memoryLimit）强制；JS 里 `while(true){}` + 大数组分配，断言超限
   中断、宿主不崩、Fiber 收敛 Failed 可 dispose。顺带实测空 Runtime 固定内存基线。
4. **1.3 裁决回写**：把闸门结论（过/不过/部分过）、内存基线数值、cordis `update` 可行性
   （试调 `FiberHandle::update` 换输入，记录行为）回写 `openspec/changes/agent-plugin-runtime/`
   的 tasks.md 勾选状态与风险节 + design.md §12/§18.2 对应小节。**只允许改这两处的
   结论段落，不许重排文档其它内容**。

## 不做

- Phase 2+ 任何内容（manifest schema 完整实现、落盘生命周期、registry、powerpack.* MCP
  工具、事件 bus 生产接线、设置页）。能力对象一律测试内 stub。
- 不动 `src-tauri/src/mcp/specs.rs`（41 条冻结）与任何前端文件。
- 不新增 MCP 工具、不新增 #[tauri::command]。

## 验证（粘进报告）

1. 每步 `cd src-tauri && cargo check` 绿；测试用 `cargo test plugin_runtime`（或你的测试
   filter）实跑输出。
2. 收尾 `pnpm test:unit` 全绿（含 500 行门禁——plugin_runtime 每个新文件 ≤500 行）+
   `pnpm build:web` 绿 + `cd src-tauri && cargo check` 绿 + `openspec validate --all --strict`
   绿（你改了提案文档，必须重跑）。
3. spike 测试保留为 `#[cfg(test)]`（它同时是降级裁决后的接口活文档），门禁依赖它。

## 硬性纪律

1. read/grep 合计 ≤12 次：上面代码地图 + design §3/§4/§18 直读，不翻 lib.rs。
2. 时间盒优先于完整度：1.0-1.2 任一步卡 >30 分钟就跳下一步；整体卡死按 findings 处理。
3. 依赖装不进/编译体系冲突 → 写 `.work/supervisor/task3-findings.md`（含 cargo 报错原文
   关键段）暂停。**不得为绕冲突去改动现有依赖版本**——冲突结论本身就是交付物。
4. 门禁全绿才 commit，只 add 明确路径，禁 `git add -A`。提交信息 `spike(plugin-runtime): …`。
5. 完成后写 `.work/supervisor/task3-report.md`：已验证（粘输出）/ 未验证 / 闸门裁决建议
   三段式。
