# Delta:调试模式与应用性能/内存可观测(debug-mode-performance-observability)

> W5 横切:把可观测性提为正式工作项,调试模式默认关闭、零开销。

## ADDED Requirements

### Requirement: 调试模式开关与实时指标

应用 SHALL 提供调试模式开关(设置页,落 settings,Rust 权威),默认关闭。开启后 SHALL 以 1s 粒度采样并展示:进程内存(RSS/phys_footprint,含 WKWebView 子进程归集方式说明)、SQLite 体积、图片缓存体积、采集吞吐(条/min)、监听线程健康状态(最近轮询时间/间隔)。关闭时 SHALL 停止采样且不产生可测后台开销。

#### Scenario: 调试模式开启后内存可见

- **WHEN** 用户在设置中开启调试模式
- **THEN** 调试面板 1s 内出现首个采样点,内存数值与活动监视器对照误差 <20%

#### Scenario: 关闭后零采样

- **WHEN** 用户关闭调试模式
- **THEN** 采样线程停止,后台 CPU 占用回到关闭前基线

### Requirement: 诊断包一键导出

调试模式 SHALL 提供一键导出诊断包:clipforge.jsonl + settings.json5 + 环境快照 + 采样快照 + 进程清单,打包 zip 落到桌面,供问题复盘附着到 issue。

#### Scenario: 导出可用

- **WHEN** 用户在调试面板点击导出
- **THEN** 桌面出现 zip,内含上述五类内容且 jsonl 可被日志查看器解析

### Requirement: 问题阈值告警不打断

调试面板 SHALL 对内存超阈值且持续增长、轮询间隔超时、写入失败率升高进行面板内高亮告警,SHALL NOT 弹系统通知打断用户。

#### Scenario: 异常高亮

- **WHEN** 采样发现内存连续 N 个点超阈值且单调增长
- **THEN** 调试面板对应指标高亮,不弹出任何系统通知
