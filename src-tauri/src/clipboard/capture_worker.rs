//! 采集工作线程：把「设置过滤 → 入库 → 应用上下文 → 事件推送」从 clipboard-rs 的轮询回调里搬出来。
//!
//! 为什么：轮询循环没有队列，回调不返回就不读剪贴板；同步采集实测每次阻塞 331–807ms，
//! 期间出现两条以上不同内容时前一条永远读不到（2026-11-24 生产日志 143/143 次）。
//! 边界：只负责排队与派发并保证先进先出；读剪贴板、指纹去重、暂停与写回抑制判定仍在轮询线程。

use std::sync::mpsc::{Receiver, SyncSender, TrySendError};
use std::thread::{self, JoinHandle};
use std::time::Instant;

use super::StandardClipboardPayload;

/// 排队上限：单条采集最慢约 1s，64 条足以吸收一分钟内的连续复制，不构成真实背压。
pub const CAPTURE_QUEUE_CAPACITY: usize = 64;

/// 一次待入库的剪贴板变化。
pub struct CaptureJob {
    pub payload: StandardClipboardPayload,
    /// 轮询线程算好的原始指纹：设置过滤跳过时的日志要用，工作线程不重复哈希。
    pub raw_fingerprint: String,
    /// 检测序号，与日志 `detected change` / `recorded` 行一一对应。
    pub seq: u64,
    pub detected_at: Instant,
    /// 用户复制的时刻（毫秒时间戳）：条目 id 与列表排序取检测时刻，而不是入库时刻。
    pub observed_at: i64,
}

/// 非阻塞入队。队列满或 worker 已退出时把任务原样退回，由调用方同步处理——
/// 宁可退回旧行为（阻塞轮询），也不丢用户刚复制的内容。
pub fn enqueue(tx: &SyncSender<CaptureJob>, job: CaptureJob) -> Result<(), CaptureJob> {
    tx.try_send(job).map_err(|error| match error {
        TrySendError::Full(job) | TrySendError::Disconnected(job) => job,
    })
}

/// 启动工作线程，按入队顺序逐条处理，直到所有发送端关闭。
pub fn spawn<F>(rx: Receiver<CaptureJob>, mut handler: F) -> std::io::Result<JoinHandle<()>>
where
    F: FnMut(CaptureJob) + Send + 'static,
{
    thread::Builder::new()
        .name("clipforge-capture-worker".to_string())
        .spawn(move || {
            for job in rx {
                handler(job);
            }
        })
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use super::super::payload::TextPayload;
    use super::*;

    fn job(seq: u64) -> CaptureJob {
        CaptureJob {
            payload: StandardClipboardPayload::Text(TextPayload {
                text: format!("job-{seq}"),
                html: None,
                rtf: None,
            }),
            seq,
            detected_at: Instant::now(),
            raw_fingerprint: format!("fp-{seq}"),
            observed_at: seq as i64,
        }
    }

    /// 轮询线程不被慢采集拖住：handler 卡住时入队必须立即返回，且处理顺序等于复制顺序。
    #[test]
    fn enqueue_does_not_wait_for_handler_and_preserves_order() {
        let (tx, rx) = mpsc::sync_channel(CAPTURE_QUEUE_CAPACITY);
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let handled = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&handled);
        let worker = spawn(rx, move |job| {
            // 模拟慢采集：直到测试放行，第一条都处理不完。
            let _ = release_rx.recv_timeout(Duration::from_secs(3));
            sink.lock().expect("handled lock").push(job.seq);
        })
        .expect("spawn worker");

        let started = Instant::now();
        for seq in 1..=5 {
            assert!(enqueue(&tx, job(seq)).is_ok(), "queue has room");
        }
        let spent = started.elapsed();
        drop(release_tx);
        // worker 的接收循环只在全部发送端释放后才结束，测试侧的 tx 必须先于 join 丢弃。
        drop(tx);
        worker.join().expect("worker join");

        assert!(
            spent < Duration::from_secs(1),
            "enqueue blocked behind handler: {spent:?}"
        );
        assert_eq!(*handled.lock().expect("handled lock"), vec![1, 2, 3, 4, 5]);
    }

    /// worker 退出后不能静默丢任务：入队把任务退回，调用方据此同步处理。
    #[test]
    fn enqueue_returns_job_when_worker_is_gone() {
        let (tx, rx) = mpsc::sync_channel(CAPTURE_QUEUE_CAPACITY);
        drop(rx);
        assert_eq!(enqueue(&tx, job(7)).unwrap_err().seq, 7);
    }

    #[test]
    fn enqueue_returns_job_when_queue_is_full() {
        let (tx, _rx) = mpsc::sync_channel(1);
        assert!(enqueue(&tx, job(1)).is_ok(), "first job fits");
        assert_eq!(enqueue(&tx, job(2)).unwrap_err().seq, 2);
    }
}
