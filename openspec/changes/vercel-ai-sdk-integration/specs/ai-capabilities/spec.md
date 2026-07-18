# ai-capabilities Spec Delta

## ADDED Requirements

### Requirement: AI summary as explicit enhancement

ClipForge SHALL provide AI-generated summaries only through explicit user-triggered or detail-surface-triggered actions in the first implementation phase.

#### Scenario: Generate summary for one clip

- **GIVEN** a clip is open in detail view
- **WHEN** the user requests an AI summary
- **THEN** ClipForge starts an asynchronous AI job
- **AND** the UI shows pending state within 300ms
- **AND** the original clip content is not overwritten

#### Scenario: Provider missing

- **GIVEN** no usable AI provider is configured
- **WHEN** the user requests an AI summary
- **THEN** ClipForge shows a configuration-required state
- **AND** the quick panel remains usable

### Requirement: AI provenance and privacy

ClipForge SHALL attach provenance to AI outputs and avoid logging prompt or output bodies.

#### Scenario: Summary succeeds

- **GIVEN** an AI summary job completes
- **WHEN** ClipForge stores the result
- **THEN** the result includes providerId, modelId, generatedAt and status
- **AND** logs omit prompt and generated output bodies

#### Scenario: User did not authorize full history

- **GIVEN** the user requests a summary for the current clip
- **WHEN** ClipForge prepares provider input
- **THEN** ClipForge sends only the selected clip content and required metadata
- **AND** it does not include unrelated clipboard history

### Requirement: Similar recommendations remain non-blocking

ClipForge SHALL show similar clip recommendations as an optional detail enhancement that does not block clipboard operations.

#### Scenario: Recommendation fails

- **GIVEN** the recommendation service fails
- **WHEN** the user continues using the quick panel
- **THEN** search, selection, copy, paste and detail editing remain available
- **AND** only the recommendation surface shows an error or empty state
