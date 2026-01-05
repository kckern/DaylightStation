# Reference Documentation Structure Design

**Date:** 2026-01-05
**Status:** Draft
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

### Reorganized
Current domain folders (fitness/, tv/, home/, core/, bots/, finance/) move to `reference/` and content gets reorganized:

**Example: fitness/**
```
Current:                              → Becomes:
fitness-data-flow.md                  → reference/fitness/2-architecture.md
fitness-session-spec.md               → reference/fitness/features/sessions/ (4-file)
fitness-identifier-contract.md        → reference/fitness/3-data-model.md (merged)
fitness-navigation-redesign.md        → reference/fitness/1-use-cases.md (merged)
pose-data-layers.md                   → reference/fitness/features/pose-tracking.md
```

---

## Benefits

1. **Discoverability** - Predictable structure means you always know where to look
2. **Consistency** - Every domain follows the same pattern
3. **Maintainability** - Numbered files make gaps obvious; 5-features.md provides index
4. **Scalability** - Recursive structure handles arbitrary complexity
