# external-hook-runtime Specification

## Purpose

定义 ClipForge 外部 Hook 插件运行时（Block A：读取侧）、洋葱执行、沙盒隔离、节流、熔断和异步上下文补写边界。Hook 是采集器和上下文补全器的统一上位能力；Block A 不开放任何写入 capability，外部进程不能直接写入宿主状态。写入侧（Proposal / Apply）由 Block B 在解冻后另行扩展。

## ADDED Requirements

### Requirement: Hook lifecycle and isolation

ClipForge SHALL manage every external Hook through `enabled`, `disabled`, `error`, and `circuit-broken` lifecycle states, and SHALL isolate execution failures so they never affect the clipboard listener, main panel, search, detail, or copy paths.

#### Scenario: Hook fails during execution

- **GIVEN** a Hook is matched for the current application
- **WHEN** the process exits non-zero, times out, or returns invalid JSON
- **THEN** ClipForge records a structured failure with `traceId`, `hookId`, duration, and error code
- **AND** transitions the Hook to `error` (or `circuit-broken` after the configured failure threshold)
- **AND** the current clipboard, main panel, search, detail, and copy paths remain available

### Requirement: Multiple Hooks per application

ClipForge SHALL allow multiple enabled Hooks to match one application and SHALL execute them in ascending `priority` order within a bounded chain.

#### Scenario: Onion context enrichment

- **GIVEN** two enabled Hooks match Google Chrome
- **WHEN** the first Hook returns a valid `contextPatch`
- **THEN** the second Hook receives that patch under `collectedContext`
- **AND** the final snapshot preserves each Hook result, order, and provenance

### Requirement: Safe context merge

ClipForge SHALL merge Hook context patches without allowing an external Hook to overwrite higher-trust host fields. Host base fields are authoritative; external patches may only add missing leaves.

#### Scenario: Context field conflict

- **GIVEN** the host already has a browser URL
- **WHEN** an external Hook returns a different browser URL
- **THEN** the host value remains authoritative and the external value is ignored
- **AND** the result preserves layered provenance so each Hook's contribution is still attributable

### Requirement: Sandboxed external execution

ClipForge SHALL execute external Hook commands without shell composition and SHALL enforce executable path, environment, timeout, stdin, stdout, stderr, and capability limits.

#### Scenario: Output exceeds the limit

- **GIVEN** a Hook output exceeds the configured or host maximum
- **WHEN** the Runner reads the output
- **THEN** the Runner terminates or rejects the execution with `OUTPUT_LIMIT_EXCEEDED`
- **AND** no context or content result is applied

### Requirement: Hook throttling

ClipForge SHALL bound the number of Hooks triggered by a single clipboard capture, the total chain duration, and the minimum trigger interval, so rapid copies cannot spawn an unbounded number of subprocesses.

#### Scenario: Rapid copies do not overload Hooks

- **GIVEN** the user copies several times within the throttle interval
- **WHEN** each capture would trigger the Hook chain
- **THEN** ClipForge coalesces or skips Hook executions according to the configured maximum concurrent chains and minimum interval
- **AND** the base clipboard record is still persisted for every capture

### Requirement: Circuit breaker

ClipForge SHALL temporarily disable a Hook that fails repeatedly within a configured window and SHALL leave built-in Hooks and clipboard functionality unaffected while it is broken.

#### Scenario: Hook trips the breaker

- **GIVEN** a Hook has failed the configured number of times within the window
- **WHEN** the next matching event arrives
- **THEN** the Hook is skipped with state `circuit-broken`
- **AND** other Hooks and the clipboard capture path continue normally

### Requirement: Delayed context enrichment

ClipForge SHALL persist the basic clipboard record before running external Hooks for delayed enrichment.

#### Scenario: Delayed Hook completes

- **GIVEN** external capture is explicitly enabled
- **WHEN** a clipboard item is captured
- **THEN** the base item is returned immediately with collector state `pending`
- **AND** the background Hook chain later updates the same item to `complete`, `partial`, or `failed` using revision-safe persistence

### Requirement: MCP Hook surface (Block A)

ClipForge SHALL expose a single MCP tool `clipboard.hook.run` to discover and trial-run Hooks, returning structured context and diagnostics. Legacy `clipboard.context.*` tools SHALL remain available with a documented deprecation timeline.

#### Scenario: Agent trial-runs a Hook

- **GIVEN** an MCP client is connected
- **WHEN** it calls `clipboard.hook.run`
- **THEN** the response includes `traceId`, `businessChain`, `permissionDecision`, and `redactedFields`
- **AND** the tool performs no write and returns no write capability

### Requirement: Collector compatibility

ClipForge SHALL continue to support `clipforge.application-context.collector.v1` through a read-only compatibility adapter while the Hook protocol is introduced.

#### Scenario: Existing collector remains installed

- **GIVEN** a valid v1 collector manifest exists
- **WHEN** Hook Registry discovers external capabilities
- **THEN** the collector can still run through the legacy `clipboard.context.*` tools
- **AND** it does not receive any write capability automatically
