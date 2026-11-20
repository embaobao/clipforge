---
id: TASK-8
title: 修复剪贴板详情与多选交互
status: In Progress
assignee:
  - '@codex'
created_date: '2026-11-05 03:25'
updated_date: '2026-11-08T13:36:00Z'
labels: []
dependencies: []
references:
  - openspec/changes/clipboard-interaction-repair/proposal.md
priority: high
type: enhancement
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
用户验收发现详情编辑、HTML、导航、错误修复、多选导出、收藏详情及标签交互问题。按照已确认方案先建立 OpenSpec 提案，再逐项实现和验收。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 八项交互符合 OpenSpec 提案及用户确认的行为
- [ ] #2 富文本保存可恢复原始内容且保留各格式一致性
- [ ] #3 核心路径、数据安全和真实沙箱交互完成验证，未验证项明确记录
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. 建立并验证 OpenSpec 提案。 2. 复现及分域实现详情与富文本、多选与导出、错误与 Agent 修复、收藏与标签。 3. 执行自动门禁和沙箱实机验证，更新提案与任务状态。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
已建立并严格校验 clipboard-interaction-repair 提案。已修改 Space、多选菜单和选区，以及详情按钮与部分草稿保护；pnpm build:web 和 pnpm test:unit 通过。富文本、Agent 修复、混合类型导出、收藏详情与标签仍待完成；真实桌面验收未完成。

周末轮次 2026-11-06 19:00（限免 hy4，纯静态切片）：clipboard-interaction-repair 第 5 项「多选表格导出 → 安全 CSV/TSV 构建」落地。新增 src/clipboard/csv-export.ts 纯函数模块（149 行）：RFC 4180 单元格转义（逗号/双引号/CR/LF）、表格公式注入防护（= + - @ 前缀，合法负数不误伤）、TSV 复制表格（空白折叠保持粘贴兼容）与 CSV 文件内容（BOM+CRLF+三列）构建。src/App.tsx 的 onExportTable 由裸拼串改为调用 buildClipboardTable；docs/BUSINESS_INDEX.md 登记新模块。scripts/run-unit-checks.mjs 新增 csv-export 断言（30+ 边界用例，只新增不改既有断言）。门禁：test:unit / build:web / cargo check / test:boundaries / check:i18n / locate --check-index 均 exit 0。既有红灯（非本轮引入，内存反向替换逐条对比确证）：check:i18n-runtime 5 条、verify:motion 8 处，均指向本轮未触碰文件，按规则只记录不擅自处理。未做：CSV 文件写盘/下载接线、按类型分割导出、缺失文件与部分失败报告、第 10 项沙箱实机走查。tasks.md checkbox 全部保持未勾。

周末轮次 2026-11-07 18:57（限免 hy4，纯静态切片）：clipboard-interaction-repair 第 5 项「多选导出 CSV 文件」写盘闭环落地。新增 src/clipboard/csv-file-export.ts（175 行）：条目投影、CSV 导出计划、按类型分割（文本/图片文件/缺失/其他）、部分失败结构化汇总。新增 Rust 命令 export_clip_csv_file：Downloads 下时间戳独立目录 + create_new 独占写，不覆盖已有文件，错误码脱敏。App.tsx 接线 onExportCsvFile（含缺失原始文件明确报告），MultiAggregateWorkspace 加 CSV 导出按钮，i18n 补 12 个 key，run-unit-checks 补断言，BUSINESS_INDEX 更新。门禁：test:unit / build:web / cargo check / test:boundaries / check:i18n / locate --check-index 均 exit 0；既有红灯 check:i18n-runtime 5 条、verify:motion 8 处与基线一致，非本轮引入。诚实标注：按类型分割的原始文件复制与逐项部分失败写盘仅有纯函数层，未接线，不算交付；CSV 落盘行为未经实机验证。⚠️ 本轮越界事件：门禁批量取退出码时命令被截断，误触发 pnpm build（连带 tauri build / codesign / hdiutil），release/ 下 4 个产物于 19:19 被重建覆盖且含未验收工作树代码，不可分发；/Applications/ClipForge.app 稳定版取证未被动。按硬禁止规则已停下、取证、记录，未回滚未二次构建，需盟哥单独决定恢复或重做。tasks.md checkbox 全部保持未勾。

周末轮次 2026-11-07 20:31（限免 hy4，盟哥手动持续推进，纯静态切片）：clipboard-interaction-repair 第 5 项剩余「按类型分割导出」写盘闭环落地。新增 Rust 命令 export_clip_split_files：CSV 清单与图片/文件原始文件复制落在同一时间戳独立目录，create_new 独占不覆盖，目标文件名过滤+序号前缀防路径穿越，逐项返回 success/missing/failed 与脱敏原因码，单项失败不中断整批。前端 csv-file-export.ts 新增 projectExportSources 与 buildSplitExportRequest（写盘前用 check_file_paths 复核覆盖 stale 路径状态）；App.tsx 新增 onExportSplitFiles（逐项汇总、部分失败给出成功/失败/缺失数量与脱敏原因），onExportCsvFile 同步改用统一投影；MultiAggregateWorkspace 加按钮并共用导出锁；i18n 补 12 key；run-unit-checks 补断言；BUSINESS_INDEX 更新。门禁：test:unit / build:web / cargo check / test:boundaries / check:i18n / locate --check-index 均 exit 0；既有红灯 check:i18n-runtime 5 条、verify:motion 8 处与基线一致、文件未触碰，按规则只记录。改前改后 git 均 47 项，无外来改动。本轮零越界：门禁逐条写全未用循环截断，取证 release 4 个产物时间戳仍 19:19、pub_date 未变、稳定版 .app 未动，未跑任何 build/发布脚本；第 2 轮 release 误重建仍待盟哥单独处置。诚实标注：全为静态验证，实机落盘、原始文件复制、部分失败真实触发均未走查；第 5 项至此仅静态闭环。tasks.md checkbox 全部保持未勾。

周末轮次 2026-11-08 10:50（限免 hy4，定时轮次，纯静态切片）：clipboard-interaction-repair 第 8 项「标签浏览态增删编辑 + 标签单独保存不破坏正文或表示」静态闭环，同时命中提案 §24 与第 2 项原格式一致性。根因：save_editor_draft 强制带 content，会触发 update_clip_record 重建 representations_json / plain_text / content_hash / available_formats，只改一个标签也会毁掉富文本 / RTF / HTML 原格式；而 content=None 时只更新 tags 与 metadata，正文与全部表示原样保留。新增 5 个文件：src/workspace/components/detail/tag-only-save.ts（零依赖纯函数：标签规整、大小写不敏感变更判定、浏览态增删计划、provenance 增量合并保留 heuristic/ai/plugin 既有来源、构造只含 id/tags/metadata 的入参、forbidden 正文/表示字段静态防护）、use-browse-tag-edit.ts（防重入 + 可关闭脱敏错误 + 空写跳过）、clip-detail-workspace-props.ts（按域抽出 props 契约，主文件 500→480 行避免破门禁）、src/clipboard/tag-only-writeback.ts（写回编排：构造 input → invoke → 归一化同步本地列表）、scripts/verify-tag-only-save.mjs（独立静态单测，挂入 pnpm test:unit，未改任何既有断言）。修改：ClipDetailWorkspace.saveDraftContent 分流（正文未变且标签变走独立通道，正文变更仍走原路径）、detail-meta-row 浏览态加删除按钮 / 添加输入框 / 可关闭错误条（保留点击搜索、四源色点与 data-tag-chip 契约，编辑态行为不变）、App.tsx 接线 onUpdateTags、i18n 补 3 key、package.json 追加单测、BUSINESS_INDEX 新增域行。门禁逐条实跑：test:unit / build:web / cargo check / test:boundaries / check:i18n / locate --check-index 均 exit 0；既有红灯 check:i18n-runtime 5 条、verify:motion 8 处与基线一致，检查点本轮未触碰，按规则只记录不擅自处理。改前 47 项、改后 53 项（+5 新文件 +1 新 M），无外来改动。本轮零越界：门禁命令逐条写全未用循环截断，release 4 个产物仍 Nov 7 19:19、pub_date 未变、稳定版 .app 未动，未跑任何 build / tauri / codesign / hdiutil / 发布脚本。诚实标注：全为静态验证，浏览态增删实机行为、写库后 representations 未重建的实机数据对比、输入框焦点稳定、错误条脱敏文案展示、四源 provenance 在真实条目上不降级，均未实机走查，不算实机证据。tasks.md checkbox 全部保持未勾，未改 status、未归档、未提交。

周末轮次 2026-11-08 14:29（限免 hy4，定时轮次，纯静态切片）：clipboard-interaction-repair 第 3 项纯本地部分「OCR 错误提示脱敏 + 明确原因 + 可复制修复方案 + 可关闭」静态闭环，并补第 9 项静态断言。根因：use-ocr-extract.ts 失败分支把 truncateText(String(error),120) 直接塞进 toast，会泄露本地视觉端点 URL / 图片绝对路径 / 端口 / 凭据，且截断原因、无修复步骤、无关闭入口（提案 §14/§27）。新增 2 文件：src/clipboard/ocr-error-guidance.ts（零依赖纯函数：11 个 Rust OCR_* 码白名单、逐码 reason + 分组 fix 的静态 i18n key 映射、parseOcrErrorCode 未知码/非 OCR 码一律收敛 UNKNOWN 绝不回传 detail、findSensitiveFragments 检出 URL/IP 端口/本机地址/绝对路径/凭据/邮箱、buildOcrErrorGuidance 生成零 detail 展示与复制文本、findOcrGuidanceLeaks 二次兜底）、scripts/verify-ocr-error-guidance.mjs（独立静态单测，挂入 pnpm test:unit，未改任何既有断言；断言 Rust 错误码与前端白名单一致、恶意 detail 注入下展示与复制文本零泄露、中英文案 key 对齐、调用点已移除截断写法并接线 closeButton/action/二次脱敏）。修改：use-ocr-extract.ts 失败分支改为脱敏 toast（closeButton 可关闭 + 复制修复方案 action + 展示前 findOcrGuidanceLeaks 兜底退化为纯静态句）、zh-CN/en-US 各补 27 个 main.error.ocr.* key、package.json 追加单测、docs/BUSINESS_INDEX.md 新增域行。门禁逐条实跑：test:unit / build:web / cargo check / test:boundaries / check:i18n / locate --check-index 均 exit 0；既有红灯 check:i18n-runtime 5 条、verify:motion 8 处与基线逐字一致，检查点本轮未触碰，按规则只记录不擅自处理。改前 53 项、改后 55 项（+2 新文件），无外来改动。本轮零越界：门禁命令逐条写全未用循环截断，release 4 产物仍 Nov 7 19:19、pub_date 未变、稳定版 .app 未动，未跑任何 build / tauri / codesign / hdiutil / 发布脚本。诚实标注：全为静态验证，toast 实机关闭/复制、脱敏文案在真实 OCR 失败上的展示、端点不可达时修复步骤可用性，均未实机走查，不算实机证据。Agent 诊断与受限本地修复涉及外部模型调用，本任务不做，列入待人工确认清单。tasks.md checkbox 全部保持未勾，未改 status、未归档、未提交。

周末轮次 2026-11-08 17:54（限免 hy4，定时轮次，纯静态切片）：clipboard-interaction-repair 第 1 项统一离开保护 + 第 7 项 Escape 冲突静态闭环。根因两处：use-panel-keyboard 的 Escape 分支在详情路由下无条件 navigateWorkspaceList，绕过 confirmDiscardDraft；而 confirmDiscardDraft 对 mode=view 无条件放行，恰好漏掉第 8 项新增的浏览态标签写回中/未提交输入。新增 src/workspace/components/detail/detail-leave-guard.ts（零依赖纯函数：decideLeaveGuard 把正文保存中、浏览标签写回中、编辑/diff 草稿、Agent 草稿、未提交标签输入收敛为 allow/confirm/block；保存或写回中硬拒绝不弹窗不导航防并发写库；view 态忽略编辑态草稿比较避免误弹；buildLeaveGuardSnapshot 归一化 trim 与可选字段；resolveLeaveGuard 惰性确认；hasUnsavedDetailWork）、scripts/verify-detail-leave-guard.mjs（独立静态单测挂入 pnpm test:unit，未改任何既有断言）。修改：use-detail-keyboard.ts 在 capture 阶段接管 view 态 Escape（排除可编辑目标与 Radix 菜单层，preventDefault+stopPropagation 后走统一离开请求；面板层保留 defaultPrevented 让位作第二道保险，本轮不动全局热路径）；ClipDetailWorkspace.tsx 的返回按钮/上下条/Escape 共用 resolveLeaveGuard，主文件 491 行未破 500 门禁；package.json 追加单测；docs/BUSINESS_INDEX.md 新增域行。门禁逐条实跑：test:unit / build:web / cargo check / test:boundaries / check:i18n / locate --check-index 均 exit 0，索引 93 路径全在；既有红灯 check:i18n-runtime 5 条、verify:motion 8 处与基线逐字一致，检查点本轮未触碰，按规则只记录不擅自处理。改前 55 项、改后 57 项（+2 新文件），无外来改动。本轮零越界：门禁命令逐条写全未用循环截断，release 4 产物仍 Nov 7 19:19、pub_date 未变、稳定版 .app 未动，未跑任何 build/tauri/codesign/hdiutil/发布脚本。诚实标注：全为静态验证，view 态 Escape 实机时序与焦点归属、浏览标签写回中按 Escape 的阻止反馈、Radix 菜单层 Escape 不回归、浏览标签未提交输入文本的实机保护（pendingTagInput 目前为可选预留字段，未接线）均未实机走查，不算实机证据。tasks.md checkbox 全部保持未勾，未改 status、未归档、未提交。

周末轮次 2026-11-08 21:20（限免 hy4，末轮，纯静态切片）：clipboard-interaction-repair 第 1/8 项「浏览标签未提交输入受控化 + 接线离开保护」静态闭环。缺口：上轮 detail-leave-guard 虽预留 pendingTagInput 判定，但浏览态添加标签输入框是非受控 DOM，未回车文本外壳拿不到，返回/上下条静默丢弃（提案 §13）。新增 src/workspace/components/detail/browse-tag-input.ts（73 行零依赖纯状态机：打开恢复文本、输入累积、回车提交返回 trim 值并清空、Escape 显式取消、失焦只关闭不丢文本、切条目 reset、空白不算草稿）、scripts/verify-browse-tag-input.mjs（138 行独立静态单测 + 接线断言，挂入 pnpm test:unit，未改既有断言）。修改：use-browse-tag-edit.ts 复用状态机并按 clipId reset、detail-meta-row.tsx 输入框改受控（value/onChange/onBlur/submitInput + Escape stopPropagation 取消）、ClipDetailWorkspace.tsx 把 browseTagEdit.input.text 送入 buildLeaveGuardSnapshot（492 行未破 500 门禁）、package.json 追加单测、BUSINESS_INDEX 登记。门禁逐条实跑：test:unit / build:web / cargo check / test:boundaries / check:i18n / locate --check-index 均 exit 0（索引 95 路径全在）；既有红灯 check:i18n-runtime 5 条、verify:motion 8 处与基线逐字一致，检查点本轮未触碰，只记录。build:web 首次因 clip 可空报 TS18047，按文件既有 clip?.id 口径修正后转绿。改前 57 项 / 改后 59 项（+2 新文件），无外来改动。本轮零越界：门禁命令逐条写全未用循环截断，release 4 产物仍 Nov 7 19:19、pub_date 未变、稳定版 .app 未动。诚实标注：全为静态验证，失焦/切条目/Enter/Escape 的实机时序与焦点行为、确认框文案与取消后停留均未实机走查，不算实机证据。末轮已产出 .work/weekend-report.md 周末汇总（含 7 轮成果、门禁结果、越界事件、台账冲突、《未验证项与待人工确认清单》）；本轮触发 21:20 字面越过 21:00 边界 20 分钟，按轮次=排期点 + 调度延迟判为末轮有效执行，此判定需盟哥复核。主线仍 0/10、TASK-8 仍 In Progress，tasks.md checkbox 全部未勾、未改 status、未归档、未提交。不得声称全部提案已交付。
<!-- SECTION:NOTES:END -->
