    use super::run_bridge_spike;

    /// 1.1/1.2 闸门主用例：一次跑完桥接 + 回收 + 内存上限三组断言。
    #[test]
    fn bridge_spike_gate() {
        let outcome = run_bridge_spike().expect("spike should produce a verdict");
        assert!(
            outcome.bridge_ok,
            "四组 ctx 接口未全部桥通：{:?}",
            outcome
        );
        assert!(
            outcome.reclaimed,
            "dispose 后监听/事件探针未达可回收观测：{:?}",
            outcome
        );
        assert!(
            outcome.memory_limit_enforced,
            "64KB memoryLimit 未强制：{:?}",
            outcome
        );
        assert!(
            outcome.converged_failed,
            "超限后 Fiber 未收敛 Failed：{:?}",
            outcome
        );
        eprintln!(
            "[plugin-runtime spike] baseline_bytes={} bridge_ok={} reclaimed={} limit={} failed={}",
            outcome.baseline_bytes,
            outcome.bridge_ok,
            outcome.reclaimed,
            outcome.memory_limit_enforced,
            outcome.converged_failed
        );
    }
