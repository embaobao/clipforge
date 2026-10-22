# TASK-6-B 派单：clipboard.merge MCP 工具（Rust，三处同步）

你只在 /Users/embaobao/workspace/idea/clipforge 工作。node 在 `~/.nvm/versions/node/v22.22.2/bin`，
bash 里先 `export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"`。

## 背景（直接采信，不必重新调研）

TASK-6-A 已完成（commit `aaee18f`）：前端 `src/clipboard/clipboard-domain.ts` 已有
`formatAggregate(items, options)` + `AggregateFormatOptions`（separator: blank/newline/space/custom、
numbered 开关、order: click/time 倒序；条目去尾部空白、空内容跳过；file→路径逐行、image→文件名降级）。
本轮做 TASK-6-B：把同样的拼接能力以 MCP 工具 `clipboard.merge` 暴露给外部 Agent（纯 Rust 侧）。
完整任务书：`backlog/tasks/task-6 - 多项拼接格式可定制-mcp-merge能力面.md`。

## 范围（只做这些）

1. `src-tauri/src/mcp/specs.rs`：在 vec 末尾新增第 41 条 spec `clipboard.merge`。
   inputSchema 建议：`{ ids: string[]（minItems 1, maxItems 50, required）, separator?: string
   （字面串，支持 \n 转义；默认 "\n\n"）, numbered?: boolean（默认 false）,
   order?: "click"|"time"（默认 click，time=createdAt 降序） }`。
   description 一句话说清：按 ids 取多条剪贴记录→纯文本拼接返回；不入库不写回。
2. `src-tauri/src/mcp/dispatch.rs`：加路由 `"clipboard.merge" => dispatch_clipboard_merge(&args)?`，
   新函数循环 `load_clip(&conn, id)`→按前端同款语义拼接（尾部空白去除、空条目跳过、
   编号前缀 `1. `、时间序稳定降序）。**红线：只返回拼接文本，绝不调用 capture_clip_record /
   write_clipboard_item，不写库不写回系统剪贴板**（写入选项本波不做）。
3. `src-tauri/src/mcp/mod.rs` golden_tests（约 286-346 行）：`specs.len()==40` 与 `tools.len()==40`
   两处字面量改 41；名称序列表把 `clipboard.merge` 追加在末尾并保持与 specs.rs 同序。
4. `scripts/verify-mcp-dispatch.mjs`：核对其工具清单，若有条数/名称硬编码则同步；若纯自动比对
   specs↔dispatch 则无需改。

## 不做

- 不动前端任何文件（formatAggregate 已就位，Rust 侧独立实现同款语义即可，不要求共享代码）。
- 不做 copyToClipboard/saveAsItem 参数、不做富格式合并。
- 不在 pi 侧 L2（clipForgeTools）注册。注意 AGENTS.md 铁律：MCP/L3 与 pi 侧 L2 属同源重复，
  若你自作主张双注册，必须同步在 openspec/changes/agent-extension-seams/tasks.md 追加计数条目；
  本波只注册 MCP 单侧，不新增该计数。

## 验证（必须真实跑，输出粘进报告）

1. `cd src-tauri && cargo check` 绿。
2. `cargo test golden` （mcp/mod.rs golden_tests 两条断言 + 名称序）绿。
3. `pnpm test:unit` 全绿（含 mcp dispatch 工具数核验，应从 40 变 41 并绿）。
4. 冒烟「真实调用返回拼接文本」：写一个临时 Rust 测试（或 #[cfg(test)] 内调用
   `dispatch_clipboard_merge`，用内存 sqlite fixture 塞 2-3 条记录，断言默认空行分隔、
   custom 分隔、numbered、order=time 输出）。跑绿后该测试可保留为正式单测（推荐）或删除。
   做不到 dispatch 级冒烟就在报告「未验证」节如实写，不得谎报。

## 硬性纪律（前两波任务死掉/超支的教训）

1. read/grep 合计 ≤12 次，上面的代码地图直接采信；开工 15 分钟内必须出现第一次文件写入。
2. 门禁全绿才 commit：`feat(mcp): clipboard.merge 拼接工具`，只 add 自己改的文件，禁 `git add -A`。
3. 阻塞（schema 字段对不上、load_clip 返回结构不明等）→ 写 `.work/supervisor/task6b-findings.md`
   说明卡点后暂停，不要 hack、不要扩大探索。
4. 完成后立刻写 `.work/supervisor/task6b-report.md`：已验证（粘关键命令输出）/未验证/风险 三段式。
