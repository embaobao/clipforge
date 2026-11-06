---
id: TASK-3
title: 实施 agent-plugin-runtime 插件运行时(Phase 1 桥接 spike 起步)
status: Done
assignee: []
created_date: '2026-10-10 05:46'
updated_date: '2026-10-27 12:58'
labels:
  - feature
  - agent
dependencies: []
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
按 openspec/changes/agent-plugin-runtime/ 提案实施插件化 Agent 能力运行时。入口:Phase 1 桥接 spike(任务 1.0-1.3,时间盒 1 周):cordis-rs ="=0.11.1" 精确 pin + rquickjs,plugin_runtime 门面模块(cordis 类型不出模块),闸门=一个 Fiber 内嵌 QuickJS Runtime 跑通 ctx 四组接口桥(clipf/on/register/log,对齐 tasks 1.1)+dispose 回收+内存上限;失败按 1.3 降级门面内自研(接口不变)。1.3 收口时三个回写勿漏:闸门结论回写提案风险节、cordis update 可行性回写 design §12、每实例内存基线(memory_usage)回写 design §18.2。完整计划/接口契约/验收见 proposal.md、design.md(20 节,含 §15 错误码契约/§16 开发调试/§17 发布分发/§18 内存细则/§19 全链路预演)、tasks.md(5 Phase)、specs/ 三份 spec;openspec validate --strict 已绿(改动后需重跑)。纪律:golden 冻结 ctx 方法集/manifest schema/事件信封/能力分级/PLUGIN_* 错误码;宿主 mcp/specs.rs 40 条不动;门禁 pnpm build + cargo check。
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
闸门过闸(2026-10-27):修复 checkpoint 遗留的 11 个编译错误——①tokio/futures 补直接依赖(cordis apply future 强制 Send,QuickJS episode 改为 apply 内 block_on 单次 poll 收敛);②MutFn 'static 约束:JS 回调容器维护移入 JS shim,Rust 侧只留订阅计数钩子;③Ctx 不能作 JS 入参,fixture 改传桥接好的 ctx 对象;④clipf 存根改同步闭包(Async 存根返回 Promise,fixture 拿不到字符串);⑤set_memory_limit 必须在 Context 建成后设置(裸 Context 创建分配>64KB);⑥桥接 Fiber 上限用默认 8MB,64KB 只留烧内存用例。新增 update(PreparedChange) 换代探针。实测基线 27808 字节。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Phase 1 桥接 spike(1.0-1.3)过闸:bridge_spike_gate 四断言全绿(四组接口桥通/dispose 回收观测/64KB 上限强制中断/超限 Fiber 收敛 Failed 可 dispose)+ update 输入替换换代成功,基线 27808 字节。验证:cargo test --lib plugin_runtime 2 passed;cargo check 0 warning;pnpm build 成功。三处回写完成:提案风险节(过闸结论+两条实测约束)、design §12(update 可用但 v1 维持 dispose→spawn 重启)、design §18.1/§18.2(Send 组合模式+内存基线)。tasks.md 1.0-1.3 勾选,openspec validate --strict 绿。
<!-- SECTION:FINAL_SUMMARY:END -->
