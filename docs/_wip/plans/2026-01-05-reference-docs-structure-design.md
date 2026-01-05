# Reference Documentation Structure Design

**Date:** 2026-01-05
**Status:** Approved
**Purpose:** Standardize reference docs structure for discoverability, consistency, and maintainability

---

## Problem Statement

Current docs have three pain points:
1. **Discoverability** - Hard to find docs when needed (too many files, unclear naming)
2. **Consistency** - Each domain structured differently, no predictable layout
3. **Maintenance** - Hard to know if docs are complete/current because there's no expected structure

---

## Top-Level Structure

```
docs/
  ai-context/              # AI primers (unchanged)
  runbooks/                # Operational procedures (unchanged)
  reference/               # Domain reference documentation
    core/
    fitness/
    finance/
    tv/
    home/
    bots/
```

- **ai-context/** - Quick AI onboarding primers (unchanged)
- **runbooks/** - Operational procedures (unchanged)
- **reference/** - All domain reference docs with standardized structure

---

## Domain Structure

Each domain folder in `reference/` follows this standard:

```
reference/{domain}/
  1-use-cases.md
  2-architecture.md
  3-data-model.md
  4-codebase.md
  5-features.md
  features/
    {complex-feature}/
      1-use-cases.md
      2-architecture.md
      3-data-model.md
      4-codebase.md
    {simple-feature}.md
```

### Rules

- **Numbered prefixes** (1-, 2-, 3-, 4-, 5-) enforce reading order and enable completeness audits
- **Simple features** = single `feature-name.md` file in `features/`
- **Complex features** = subfolder with same 4-file structure in `features/`
- **Threshold for "complex"**: Feature has its own distinct data model
- **Structure is recursive** - a feature subfolder could have its own features/ if needed

---

## File Contents

### 1-use-cases.md
- Problem statements
- Requirements
- Solution descriptions (non-technical)
- UX flows and user experience
- *No technical implementation details*

### 2-architecture.md
- System design diagrams (ASCII or mermaid)
- Component relationships
- Data flow
- Integration points with other domains
- Key design decisions and rationale

### 3-data-model.md
- Entities and their relationships
- Sample YAML configs
- Schema definitions
- State machines if applicable
- Example payloads/structures

### 4-codebase.md
- Key file locations
- Function reference (javadoc-style)
- Exports and imports
- Naming conventions
- Where to add new code

### 5-features.md
- Index/TOC of all features in `features/`
- One-line description per feature
- Links to each feature file/folder
- Optional: status (stable, experimental, deprecated)

---

## Migration Plan

### Unchanged
- `ai-context/` stays as-is
- `runbooks/` stays as-is
- `_wip/` stays as-is
- `_archive/` stays as-is

### Reorganized
Current domain folders (fitness/, tv/, home/, core/, bots/, finance/) move to `reference/` and content gets reorganized.

---

## Detailed Migration Mapping

### fitness/ (12 files)

| Current File | Destination | Action |
|-------------|-------------|--------|
| fitness-data-flow.md | reference/fitness/2-architecture.md | Move, becomes primary |
| fitness-identifier-contract.md | reference/fitness/3-data-model.md | Move, becomes primary |
| fitness-entityid-nullability.md | reference/fitness/3-data-model.md | Merge into above |
| fitness-identifier-decision-tree.md | reference/fitness/3-data-model.md | Merge into above |
| short-id-migration.md | reference/fitness/3-data-model.md | Merge into above |
| fitness-navigation-redesign.md | reference/fitness/features/navigation.md | Move |
| fitness-chart-layout-manager.md | reference/fitness/features/chart-layout.md | Move |
| fitness-session-spec.md | reference/fitness/features/sessions.md | Move |
| guest-switch-session-transition.md | reference/fitness/features/sessions.md | Merge into above |
| session-entity-justification.md | reference/fitness/features/sessions.md | Merge into above |
| pose-data-layers.md | reference/fitness/features/pose-tracking.md | Move |
| vibration-sensors-fitness.md | reference/fitness/features/vibration-sensors.md | Move |

**Create new:**
- reference/fitness/1-use-cases.md (stub - extract from existing)
- reference/fitness/4-codebase.md (stub)
- reference/fitness/5-features.md (index of features/)

### tv/ (2 files)

| Current File | Destination | Action |
|-------------|-------------|--------|
| tv-menu-navigation-refactor.md | reference/tv/2-architecture.md | Move |
| tv-season-view-enhancement.md | reference/tv/features/season-view.md | Move |

**Create new:**
- reference/tv/1-use-cases.md (stub)
- reference/tv/3-data-model.md (stub)
- reference/tv/4-codebase.md (stub)
- reference/tv/5-features.md (index)

### home/ (4 files)

| Current File | Destination | Action |
|-------------|-------------|--------|
| ambient-led-configuration.md | reference/home/features/ambient-led.md | Move, becomes primary |
| ambient-led-fitness-zones-prd.md | reference/home/features/ambient-led.md | Merge into above |
| ambient-led-troubleshooting.md | reference/home/features/ambient-led.md | Merge into above |
| midi-websocket-broadcaster.md | reference/home/features/midi-broadcaster.md | Move |

**Create new:**
- reference/home/1-use-cases.md (stub)
- reference/home/2-architecture.md (stub)
- reference/home/3-data-model.md (stub)
- reference/home/4-codebase.md (stub)
- reference/home/5-features.md (index)

### bots/ (4 files)

| Current File | Destination | Action |
|-------------|-------------|--------|
| lifelog-extractors.md | reference/bots/3-data-model.md | Move, becomes primary |
| nutrition-goals-source-of-truth.md | reference/bots/3-data-model.md | Merge into above |
| telegram-integration-design.md | reference/bots/2-architecture.md | Move |
| debriefs-example.yml | reference/bots/3-data-model.md | Reference as example |

**Create new:**
- reference/bots/1-use-cases.md (stub)
- reference/bots/4-codebase.md (stub)
- reference/bots/5-features.md (index)

### finance/ (1 file)

| Current File | Destination | Action |
|-------------|-------------|--------|
| shopping-harvester.md | reference/finance/features/shopping-harvester.md | Move |

**Create new:**
- reference/finance/1-use-cases.md (stub)
- reference/finance/2-architecture.md (stub)
- reference/finance/3-data-model.md (stub)
- reference/finance/4-codebase.md (stub)
- reference/finance/5-features.md (index)

### core/ (9 files)

| Current File | Destination | Action |
|-------------|-------------|--------|
| three-tier-architecture.md | reference/core/2-architecture.md | Move, becomes primary |
| harvester-bifurcation.md | reference/core/2-architecture.md | Merge into above |
| websocket-message-bus.md | reference/core/features/websocket-bus.md | Move, becomes primary |
| message-bus-prd.md | reference/core/features/websocket-bus.md | Merge into above |
| harvester-testing.md | reference/core/4-codebase.md | Move, becomes primary |
| logging-code-auditor.md | reference/core/4-codebase.md | Merge into above |
| logging-file-auditor.md | reference/core/4-codebase.md | Merge into above |
| family-selector.md | reference/core/features/family-selector.md | Move |
| menu-selection-persistence.md | reference/core/features/menu-persistence.md | Move |

**Create new:**
- reference/core/1-use-cases.md (stub)
- reference/core/3-data-model.md (stub)
- reference/core/5-features.md (index)

---

## Execution Order

1. Create reference/ folder structure
2. Migrate fitness/ (largest domain, proves pattern)
3. Migrate remaining domains
4. Delete empty old folders
5. Update CLAUDE.md

---

## Benefits

1. **Discoverability** - Predictable structure means you always know where to look
2. **Consistency** - Every domain follows the same pattern
3. **Maintainability** - Numbered files make gaps obvious; 5-features.md provides index
4. **Scalability** - Recursive structure handles arbitrary complexity
