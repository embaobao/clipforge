# styling-architecture Specification

## Purpose

约束 ClipForge 前端样式的组织方式：全局语义 token 单源、组件样式用 Tailwind 语义类表达、surface 身份 marker 恒定，保证视觉重构与后续迭代不回退到多源 CSS 架构。

## ADDED Requirements

### Requirement: Global style single source

ClipForge SHALL keep `src/index.css` as the only global stylesheet, holding all semantic design tokens (`hsl(var(--token))`) and shared utility classes.

#### Scenario: No component-level stylesheets

- **GIVEN** the repository is checked out
- **WHEN** a developer searches for component-level CSS files (`*.css` outside `src/index.css`, including `*.module.css`)
- **THEN** none exist
- **AND** no component imports a deleted legacy stylesheet (`App.css`, `settings.css`, `theme/tokens.css`, `clipboard-panel.css`, `detail-page.css`, `dsh-panel.css`, `onboarding.css`)

#### Scenario: Tokens are consumed, not redefined

- **GIVEN** a component needs a color, radius, or shadow
- **WHEN** the developer writes its Tailwind classes
- **THEN** the classes map to semantic tokens (`bg-background`, `text-muted-foreground`, `border-border`, …)
- **AND** the component does not redefine token values locally

### Requirement: Surface identity markers

ClipForge SHALL keep a stable `data-surface` marker on every window surface root (clipboard / settings / workspace / dsh / onboarding) regardless of component refactoring.

#### Scenario: Surface survives component split

- **GIVEN** a surface root component is split into child components
- **WHEN** the app renders that surface
- **THEN** the root section still carries the original `data-surface="<name>"` marker
- **AND** the `verify-surface-boundaries` gate passes

### Requirement: Style-bearing files stay modular

ClipForge SHALL keep any file that carries markup and styles at or below 500 lines, splitting by domain into `src/<surface>/components/` when it grows.

#### Scenario: Oversized file is rejected

- **GIVEN** a source file exceeds 500 lines and is not in the exemption ledger
- **WHEN** the file-size gate (`verify-file-size.mjs`) runs
- **THEN** the check fails and names the offending file

#### Scenario: Exemption ledger only shrinks

- **GIVEN** a split slice for an exempted file is completed
- **WHEN** the file is back under the limit
- **THEN** its entry is removed from `scripts/file-size-exemptions.json`
- **AND** the ledger never gains new entries without a recorded reason in a proposal
