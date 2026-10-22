//! 插件运行时门面（agent-plugin-runtime Phase 1 spike）。
//!
//! 本模块是插件能力的唯一对外出口：宿主其它域只允许 import 本模块导出的类型与函数，
//! **不允许**在本模块之外出现 cordis/rquickjs 的任何路径（红线：cordis 类型不出
//! `plugin_runtime` 模块）。Phase 1 只做闸门验证（一个 Fiber 内嵌 rquickjs Runtime，
//! 把 ctx 四组接口桥成 JS 可见对象 + dispose 确定性回收 + 内存上限强制），因此本模块
//! 当前只提供 spike 所需的门面类型与驱动入口，生产生命周期（manifest schema、registry、
//! 落盘安装、powerpack.* MCP 工具）属 Phase 2+，不在此处预留半成品。
//!
//! # Phase 1 布局
//! - `spike`：桥接闸门的全部实现与测试（1.1 四组接口 + 1.2 内存上限 + dispose 回收）。
//! - `budget`：内存上限相关的常量与 manifest fixture 解析（64 字节 fixture 用）。
//!
//! # 设计依据
//! 生命周期六态/dispose/收敛语义见 design §3；ctx 四组接口面见 design §4；
//! 内存三层强制链见 design §18.2；线程模型（一插件一线程 + AsyncRuntime + Context）
//! 见 design §18.1。

pub mod budget;
pub mod spike;

/// 门面对外暴露的 spike 运行结果：无论过闸与否，调用方只依赖本结构，不接触
/// cordis/rquickjs 类型。
#[derive(Debug, Clone)]
pub struct SpikeOutcome {
    /// 是否四组接口全部桥通且 JS 侧调用成功。
    pub bridge_ok: bool,
    /// dispose 后 Runtime 与监听是否确定性回收（计数探针归零）。
    pub reclaimed: bool,
    /// 空 Runtime 固定内存基线（`memory_usage().malloc_size` 口径，字节）。
    pub baseline_bytes: i64,
    /// 内存上限强制是否生效（超限分配被引擎中断而非宿主崩溃）。
    pub memory_limit_enforced: bool,
    /// 超限后 Fiber 是否收敛为 Failed 且可 dispose。
    pub converged_failed: bool,
}
