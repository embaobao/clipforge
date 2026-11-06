/** clipboard-changed 前端事件闸门（RS-51 P1 4.6，对应缺陷 U1/U2）。
 *
 *  Rust 端 changeCount 已改为进程内单调递增序号（见 src-tauri clipboard/watcher.rs
 *  的 CHANGE_SEQ）。闸门在此之上做两件事：
 *  1. 序号去重：`seq <= lastSeq` 的事件（乱序/重复投递）直接丢弃；
 *  2. in-flight 合并：处理中收到的新事件只保留最新一条排队，当前处理完成后自动
 *     补跑一次——事件风暴下最坏也只多跑一次，而不是每个事件一次全量刷新。
 *
 *  边界：不做时间窗节流。并发合并天然覆盖突发风暴，且无定时器、行为确定、可单测
 *  （scripts/verify-clipboard-listener.mjs 直跑本文件断言）。 */

/** submit 的三种结果：立即执行 / 排队（已有处理在跑）/ 丢弃（序号不新）。 */
export type GateDecision = "run" | "queued" | "dropped";

/** 事件闸门：泛型 T 为事件数据（payload），seq 为 Rust 端单调序号。 */
export type ClipboardEventGate<T> = {
  /** 提交一个事件：序号不新返回 dropped；空闲返回 run（调用方开始处理）；
   *  忙碌返回 queued（已存为待处理，处理完由 finish 取走）。 */
  submit(seq: number, data: T): GateDecision;
  /** 当前事件处理完成：返回排队的最新事件（调用方继续处理），无排队则返回 null。 */
  finish(): { seq: number; data: T } | null;
};

/** 创建事件闸门。lastSeq 初始为 0：Rust 序号从 1 开始，首个事件必然放行。 */
export function createClipboardEventGate<T>(): ClipboardEventGate<T> {
  let lastSeq = 0;
  let running = false;
  let pending: { seq: number; data: T } | null = null;
  return {
    submit(seq: number, data: T): GateDecision {
      if (seq <= lastSeq) return "dropped";
      lastSeq = seq;
      if (running) {
        pending = { seq, data };
        return "queued";
      }
      running = true;
      return "run";
    },
    finish(): { seq: number; data: T } | null {
      const next = pending;
      pending = null;
      running = next !== null;
      return next;
    },
  };
}
