# onboarding Spec Delta

## ADDED Requirements

### Requirement: Settings-hosted onboarding

ClipForge SHALL host first-run onboarding inside the settings window instead of overlaying onboarding content on the quick clipboard panel.

#### Scenario: First run opens onboarding settings

- **GIVEN** `onboardingCompleted` is false
- **WHEN** ClipForge starts
- **THEN** ClipForge opens the settings window
- **AND** the onboarding section is selected
- **AND** the quick panel remains focused on clipboard history and search when opened

#### Scenario: Completed onboarding does not interrupt quick use

- **GIVEN** `onboardingCompleted` is true
- **WHEN** ClipForge starts
- **THEN** ClipForge does not automatically show onboarding
- **AND** opening the quick panel does not render an onboarding overlay

### Requirement: Onboarding wizard steps

ClipForge SHALL provide a settings-hosted onboarding wizard covering welcome, permissions, capture scope, shortcuts and core feature overview.

#### Scenario: User navigates onboarding steps

- **GIVEN** the onboarding wizard is open
- **WHEN** the user selects next, back or skip
- **THEN** the wizard updates the current step without leaving the settings window
- **AND** the current step is visibly indicated
- **AND** keyboard navigation remains available

#### Scenario: Permission step checks accessibility state

- **GIVEN** the permission step is visible
- **WHEN** the user requests accessibility permission
- **THEN** ClipForge calls the existing native permission command
- **AND** the wizard can refresh and display the latest permission state

### Requirement: Onboarding completion state

ClipForge SHALL persist onboarding completion through the settings document.

#### Scenario: Complete onboarding

- **GIVEN** the user reaches the final onboarding step
- **WHEN** the user completes onboarding
- **THEN** ClipForge writes `onboardingCompleted=true`
- **AND** future launches do not automatically open onboarding

#### Scenario: Reopen onboarding from settings

- **GIVEN** onboarding was completed
- **WHEN** the user opens the onboarding section from settings
- **THEN** ClipForge shows the wizard or completed state
- **AND** reopening onboarding does not reset `onboardingCompleted` to false
