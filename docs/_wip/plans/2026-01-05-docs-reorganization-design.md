# Docs Folder Reorganization Design

**Date:** 2026-01-05
**Status:** Approved
**Purpose:** Clean up docs folder with clear separation between WIP and timeless content

---

## Overview

Reorganize the docs folder to distinguish between:
- **Work-in-progress** (`_wip/`) - Date-prefixed, point-in-time documents
- **Timeless reference** - Evergreen, always-accurate documentation
- **Archive** (`_archive/`) - Historical/obsolete documents

---

## Folder Structure

```
docs/
├── _archive/                    # Obsolete/superseded docs (historical reference only)
├── _wip/                        # Work in progress (always YYYY-MM-DD prefixed)
│   ├── bugs/                    # Bug investigations
│   ├── audits/                  # Code audits, reviews
│   ├── analysis/                # Deep-dive analysis
│   ├── improvements/            # Enhancement proposals
│   ├── plans/                   # Implementation plans
│   ├── designs/                 # Design docs in progress
│   └── notes/                   # Miscellaneous working notes
├── ai-context/                  # Claude context files (timeless)
├── design/                      # Finalized architecture decisions (timeless)
├── features/                    # Feature documentation (timeless)
├── guides/                      # How-to guides (timeless)
└── ops/                         # Operational runbooks (timeless)
```

---

## File Migration Plan

### Move to `_archive/`
- `postmortem-entityid-migration-fitnessapp.md`
- `postmortem-governance-entityid-failure.md`
- `entityId-migration-complete.md`
- `entityId-migration-strategy.md`
- `logging-framework-evaluation.md`
- `logging-implementation-complete.md`
- `governance-bug-diagnosis.md`
- `governance-debug-status.md`
- `implementation-complete-identifier-consistency.md`
- `claude-code-best-practices.md` (superseded by ai-context/)

### Move to `design/`
- `PRD_MessageBus.md`
- `MidiWebSocketBroadcaster.Design.md`
- `WebsocketMessageBus.Readme.md`

### Move to `guides/`
- `HARVESTER_TESTS_QUICKSTART.md`
- `HARVEST_TESTS_README.md`

### Move existing folders to `_wip/`
- `bugs/` → `_wip/bugs/`
- `audits/` → `_wip/audits/`
- `analysis/` → `_wip/analysis/`
- `improvements/` → `_wip/improvements/`
- `plans/` → `_wip/plans/`
- `notes/` → `_wip/notes/`
- `reviews/` + `reivews/` → `_wip/audits/` (merge, fix typo)

---

## CLAUDE.md Addition

Add documentation management section:

```markdown
---

## Documentation Management

### Folder Structure
- **`_archive/`** - Obsolete/superseded docs (historical reference only)
- **`_wip/`** - Work in progress (brainstorms, investigations, plans)
- **Timeless folders** - `ai-context/`, `design/`, `features/`, `guides/`, `ops/`

### Rules

1. **New work goes to `_wip/`** - All brainstorms, designs, plans, bug investigations, audits, analysis
2. **Always date-prefix WIP files** - Format: `YYYY-MM-DD-topic-name.md`
3. **Use appropriate subfolder** - `_wip/bugs/`, `_wip/plans/`, `_wip/audits/`, etc.
4. **Graduate when stable** - Move to timeless folder (without date prefix) when doc becomes permanent reference
5. **Archive when obsolete** - Move to `_archive/` when superseded or no longer relevant
6. **No loose files** - Everything belongs in a subfolder
7. **Keep timeless docs current** - Update existing docs rather than creating new point-in-time snapshots
8. **No instance-specific data** - Never include paths, hostnames, ports, usernames, or environment-specific values in docs. These are public/open-source. Use placeholders like `{hosts.prod}` or reference `.claude/settings.local.json`
```

---

## Success Criteria

- [ ] No loose files at docs root
- [ ] All WIP folders under `_wip/` with date-prefixed files
- [ ] Timeless folders contain only evergreen, accurate reference docs
- [ ] CLAUDE.md instructs Claude on proper documentation practices
- [ ] `reivews/` typo folder removed
