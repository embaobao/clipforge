# animation-workbench Specification

## Purpose
定义 ClipForge 独立 Remotion 动效工作台的边界、初始 composition 和操作文档要求，确保视频素材生成能力不进入主 Tauri 应用运行时。
## Requirements
### Requirement: Isolated Remotion workbench

ClipForge SHALL host Remotion animation development in an isolated workspace that does not become part of the main Tauri runtime.

#### Scenario: Start animation studio

- **GIVEN** the Remotion workbench is installed
- **WHEN** a developer runs the root motion studio script
- **THEN** the script starts the workbench studio
- **AND** the main Tauri application runtime dependencies are not required to load Remotion at runtime

#### Scenario: Build main application

- **GIVEN** the Remotion workbench exists
- **WHEN** the main ClipForge app is built
- **THEN** Remotion runtime code is not bundled into the Tauri application
- **AND** clipboard core logic and Tauri configuration remain independent of video generation

### Requirement: Branded animation compositions

ClipForge SHALL provide initial Remotion compositions for product introduction and onboarding assets using real brand/application assets.

#### Scenario: Render feature intro

- **GIVEN** the `FeatureIntro` composition exists
- **WHEN** the workbench renders or previews it
- **THEN** the animation presents ClipForge core clipboard workflows
- **AND** it uses existing brand assets or real application screenshots rather than fake product UI

#### Scenario: Render onboarding guide

- **GIVEN** the `OnboardingGuide` composition exists
- **WHEN** the workbench renders or previews it
- **THEN** the animation presents onboarding or setup guidance
- **AND** the default global quick-open shortcut copy is `Control + V`

### Requirement: Workbench operation documentation

ClipForge SHALL document how to preview, render, and verify Remotion assets without polluting the main app workspace.

#### Scenario: Developer reads workbench README

- **GIVEN** a developer opens the Remotion workbench documentation
- **WHEN** they follow the documented commands
- **THEN** they can run studio preview, render compositions, and check still frames
- **AND** Remotion skills or generated helper files are scoped to the workbench rather than scattered in the main application root
