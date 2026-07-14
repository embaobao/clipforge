# search-filters Specification

## Purpose
TBD - created by archiving change search-filter-tags-filetypes. Update Purpose after archive.
## Requirements
### Requirement: Hashtag search token

ClipForge SHALL parse `#tag` as a first-class search token equivalent to `tag:tag`.

#### Scenario: Search with hashtag token

- **GIVEN** clips exist with the tag `工作`
- **WHEN** the user searches for `#工作 api`
- **THEN** ClipForge parses `工作` into the tag filters
- **AND** ClipForge keeps `api` as ordinary full-text search input
- **AND** the result set matches `tag:工作 api`

#### Scenario: Invalid hashtag token

- **GIVEN** the user types `#` or a hashtag token that exceeds the supported length
- **WHEN** the query parser runs
- **THEN** the invalid token is reported as an invalid token
- **AND** ordinary text search continues without crashing the search UI

### Requirement: Search from detail tags

ClipForge SHALL let users jump from a detail-page tag to a filtered search.

#### Scenario: Click tag in detail page

- **GIVEN** a clip detail page shows the tag `客户A`
- **WHEN** the user clicks that tag
- **THEN** ClipForge navigates back to the list
- **AND** the search field is set to `#客户A`
- **AND** the list shows clips matching that tag

### Requirement: AI tag search

ClipForge SHALL allow Agent-generated or Agent-applied clips to be found through `#AI`.

#### Scenario: Search Agent-generated clips

- **GIVEN** an Agent-generated clip was saved with the `AI` tag
- **WHEN** the user searches for `#AI`
- **THEN** the search results include that clip
- **AND** the active filter chip is shown as the `AI` tag

