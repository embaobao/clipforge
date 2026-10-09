# Delta:剪贴板数据完整性(clipboard-data-integrity)

> W1 数据完整性修复:去重软删碰撞 bug 与重复条目缺口。

## MODIFIED Requirements

### Requirement: 采集查重与复活语义

剪贴板采集入库时,系统 SHALL 按 content_hash 全局查重(含软删行):命中活行时 promote(刷新 last_seen_at/updated_at/source_app 元数据,不新增行);命中软删行时 SHALL 复活该行(deleted_at 置 NULL)并刷新元数据,而不是走 INSERT 撞 content_hash UNIQUE 索引失败丢条目;完全未命中时才 INSERT。该语义 SHALL 与 import 路径的 ON CONFLICT 复活行为保持一致。

#### Scenario: 删除后重采同内容复活

- **WHEN** 用户删除某条目后,再次复制与该条目 content_hash 相同的内容
- **THEN** 原条目复活回历史列表(deleted_at 置 NULL),刷新 last_seen_at 与 source_app,日志记录 status=promoted,不产生 CLIP_CAPTURE 唯一索引报错

#### Scenario: 活行重复复制仍 promote

- **WHEN** 已存在的活行对应内容被再次复制
- **THEN** 仅 UPDATE last_seen_at/updated_at/source_app,不新增行,copy_count 不变

#### Scenario: 新内容正常入库

- **WHEN** 复制的内容在 clips 表中不存在任何同 hash 行(含软删)
- **THEN** INSERT 新行,status=created

## ADDED Requirements

### Requirement: 已知重复行为文档化

因 representation 口径产生的用户可感知重复(富文本格式漂移、HTML vs plain 双格式、文件按路径不按内容)SHALL 在业务索引或设置页说明区记录为已知行为,避免用户误判为数据错误。

#### Scenario: 用户查阅已知行为

- **WHEN** 用户发现同一可见文本出现两条条目
- **THEN** 可在 docs/BUSINESS_INDEX.md 或设置页「采集与内容」说明区找到三类已知重复行为的解释
