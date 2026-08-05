# demo-assets Specification

## Purpose

定义 ClipForge 功能演示动图流水线、资产目录、README 引用和隐私边界。真实录屏是主路径，Remotion workbench 是辅助路径；该 change 不改变产品功能，不阻塞 onboarding 或剪贴板核心交付。

## ADDED Requirements

### Requirement: Repeatable demo GIF pipeline

ClipForge SHALL provide a repeatable workflow for turning a local screen recording into an optimized demo GIF using a high-quality palette workflow and optional size optimization.

#### Scenario: Developer converts a recording

- **GIVEN** a local `mp4` or `mov` recording exists
- **WHEN** the demo conversion script is run with an output path
- **THEN** it generates a GIF through palette generation and palette use
- **AND** it reports the output size
- **AND** it gives a clear missing-tool message if `ffmpeg` or the optimizer is unavailable

### Requirement: Demo asset catalog

ClipForge SHALL maintain demo assets under a documented demos directory with stable names, scenario descriptions, and re-recording guidance.

#### Scenario: README references a demo

- **GIVEN** a demo asset is used in README or release notes
- **WHEN** a reader opens the document locally or on GitHub
- **THEN** the reference points to `docs/demos/`
- **AND** the related demo documentation explains the scenario, recording version, and when it should be re-recorded

### Requirement: Real recording primary, Remotion secondary

ClipForge SHALL use real screen recordings for product workflow demonstrations and reserve the Remotion workbench for brand, intro, or onboarding transition media.

#### Scenario: Creating a quick-open demo

- **GIVEN** the team needs to demonstrate quick panel launch
- **WHEN** a demo asset is selected
- **THEN** the primary asset is based on an actual ClipForge recording
- **AND** Remotion is used only for supporting intro or onboarding animation unless a real workflow recording is unavailable

### Requirement: Demo privacy boundary

ClipForge SHALL require demo recordings to use controlled sample clipboard content and avoid real secrets, credentials, private documents, prompts, transcripts, and personal data.

#### Scenario: Preparing a recording

- **GIVEN** a contributor is recording a ClipForge demo
- **WHEN** the recording checklist is followed
- **THEN** notifications and sensitive desktop context are hidden
- **AND** clipboard items shown in the demo are controlled sample data
- **AND** the resulting asset can be published without exposing private information
