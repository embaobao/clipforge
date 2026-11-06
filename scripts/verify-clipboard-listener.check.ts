/** clipboard-changed 事件闸门行为校验（RS-51 P1 4.6 / tasks 5.2 的 B2 量化门禁）。
 *  由 scripts/verify-clipboard-listener.mjs 以 `node --experimental-strip-types` 直跑，
 *  断言失败即非零退出。覆盖：序号去重、in-flight 合并（风暴收敛）、排队补跑。 */
import { createClipboardEventGate } from "../src/clipboard/clipboard-event-gate.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`[verify-clipboard-listener] FAILED: ${message}`);
    process.exit(1);
  }
}

// 1) 首个事件放行；重复/乱序序号丢弃（Rust 序号从 1 开始单调递增）
{
  const gate = createClipboardEventGate<string>();
  assert(gate.submit(1, "a") === "run", "首个事件应立即执行");
  assert(gate.submit(1, "a") === "dropped", "重复序号应丢弃");
  assert(gate.submit(0, "old") === "dropped", "乱序（更小）序号应丢弃");
  assert(gate.finish() === null, "无排队时 finish 返回 null");
}

// 2) in-flight 合并：处理中收到的事件只保留最新一条排队（事件风暴收敛）
{
  const gate = createClipboardEventGate<string>();
  assert(gate.submit(1, "e1") === "run", "风暴首个事件立即执行");
  let queued = 0;
  for (let seq = 2; seq <= 50; seq += 1) {
    if (gate.submit(seq, `e${seq}`) === "queued") queued += 1;
  }
  assert(queued === 49, "处理中的并发事件都应排队");
  const next = gate.finish();
  assert(next !== null && next.seq === 50 && next.data === "e50", "排队只保留最新一条");
  assert(gate.finish() === null, "补跑一次后队列清空");
  assert(gate.submit(51, "e51") === "run", "空闲后新事件恢复立即执行");
}

// 3) 风暴量化：50 个并发事件 → 至多 2 次处理（当前 1 次 + 排队补跑 1 次），
//    即 search_clip_records 全量刷新调用次数从 50 收敛到 ≤2
{
  const gate = createClipboardEventGate<string>();
  let runs = 0;
  // 与 use-clipboard-list 的 dispatchChangedEvent 同构：处理路径含 await（IPC），
  // 事件在处理窗口内到达时只能排队
  const dispatch = async (seq: number): Promise<void> => {
    const decision = gate.submit(seq, `e${seq}`);
    if (decision !== "run") return;
    for (;;) {
      await Promise.resolve();
      runs += 1;
      const next = gate.finish();
      if (next === null) return;
    }
  };
  // 风暴：50 个事件在同一宏任务内连发（对应事件风暴下的监听器回调连调）
  for (let seq = 1; seq <= 50; seq += 1) void dispatch(seq);
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  await promise;
  assert(runs <= 2, `50 个事件的刷新次数应 ≤2（实际 ${runs}）`);
}

console.log("[verify-clipboard-listener] ok: seq 去重 + in-flight 合并断言全部通过");
