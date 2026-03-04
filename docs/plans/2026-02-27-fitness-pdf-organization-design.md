# Fitness PDF Organization Design

**Date:** 2026-02-27
**Status:** Approved

## Problem

76 of 163 BODi/Beachbody programs in the Plex fitness library have PDFs (calendars, nutrition guides, worksheets, etc.) scattered across inconsistent folder structures (`_Docs/`, `docs/`, `Documents/`, `PDFs/`, `_PDF/`, program root) with inconsistent naming conventions.

## Goals

1. Consolidate all PDFs into a consistent `docs/` folder per program (or per season when applicable)
2. Rename PDFs to a category-prefixed kebab-case convention
3. Delete macOS `._` dot files
4. Remove empty source folders after migration

## Folder Structure Rules

- **Programs without seasons:** All PDFs go to `{program}/docs/`
- **Programs with season folders:** PDFs found inside a season folder go to `Season XX/docs/`. PDFs at program root or in top-level doc folders go to `{program}/docs/`
- A season folder is identified by matching `Season *` or `S[0-9]*` directory names

## Naming Convention

### Category Prefixes

| Prefix | Keyword triggers |
|--------|-----------------|
| `calendar-` | calendar, schedule, workout-calendar |
| `nutrition-` | nutrition, eating, meal, food, diet, portion, recipe, grocery |
| `guide-` | guide, start-here, get-started, welcome, quick-start, how-to |
| `worksheet-` | worksheet, tally, tracker, fit-test, measurements, journal, log |
| `reference-` | fallback for unmatched filenames |

### Filename Cleanup Rules

1. Strip program code prefixes (e.g. `10R_`, `DDPR-BOD-EN-US-`, `21DINS1203_`)
2. Strip locale suffixes (`_EN-US`, `_US`, `-en-us`)
3. Strip date stamps (`-112823`, `_5.20.19`, `_06082017`)
4. Convert to kebab-case (lowercase, hyphens)
5. If collision within same `docs/` folder, append `-2`, `-3`, etc.

### Example Transforms

```
10R_BOD_Get-Started-Guide_US.pdf        → guide-get-started.pdf
DDPR-BOD-EN-US-Dumbbell_Tracker-112823.pdf → worksheet-dumbbell-tracker.pdf
21DINS1203_21F_EatingPlan_BOD_022219.pdf → nutrition-eating-plan.pdf
P90X_Calendar.pdf                       → calendar-workout.pdf
SAN_FitTest.pdf                         → worksheet-fit-test.pdf
```

## Script Design

- **Location:** `cli/scripts/organize-fitness-pdfs.sh`
- **Runs inside:** Plex Docker container via `docker exec`
- **Default mode:** Dry-run — outputs `[source] → [destination]` table
- **`--execute` flag:** Performs the actual moves
- **Cleanup:** Deletes `._` files, removes empty source directories with `rmdir`

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| PDF scope | Per-season when seasons exist, else top-level | Preserves season context without over-nesting |
| Naming style | Category-prefixed kebab-case | Related docs sort together, clean and readable |
| Dot files | Delete | macOS artifacts, not useful |
| Duplicates | Keep all, dedupe names with `-2` suffix | Don't risk losing unique content |
| Empty dirs | Remove after move | Clean up clutter |
| Approach | Hybrid auto + dry-run review | Automated but verified before execution |
