# Plex CLI and Media Memory Backfill Design

## Problem Statement

Plex IDs were reset on the server side, causing media_memory history entries to reference non-existent IDs. Watch progress for fitness videos and other media is broken because the stored IDs (e.g., 606037, 11570-11578) no longer exist in Plex.

## Solution Overview

Two tools:
1. **`cli/plex.cli.mjs`** - Interactive CLI for Plex library search
2. **`scripts/backfill-plex-ids.mjs`** - Automated script to find and update orphaned IDs

---

## 1. plex.cli.mjs Design

### Commands

```
plex search <query>      # Search library by title (fuzzy)
plex search --exact <q>  # Exact title match
plex info <id>           # Show metadata for a Plex ID
plex verify <id>         # Check if ID exists in Plex
plex libraries           # List all library sections
plex shows [section]     # List shows in a section
```

### Implementation Details

**Authentication**: Reuse existing pattern from `Plex` class - get token from `configService.getHouseholdAuth('plex')`

**Search Endpoint**: Use `/library/sections/{key}/all?title={query}` for section-scoped search, or `/hubs/search?query={query}` for global search

**Output Formats**:
- Default: Human-readable table
- `--json`: JSON output for scripting
- `--ids-only`: Just output matching Plex IDs

### CLI Structure

```javascript
#!/usr/bin/env node
// Follows clickup.cli.mjs pattern:
// - createLogger for structured logging
// - axios for HTTP requests
// - Plex class reuse for auth/base URL
// - Command parsing via process.argv
```

---

## 2. backfill-plex-ids.mjs Design

### Algorithm

```
1. Load all media_memory YAML files
2. For each entry:
   a. Verify if plex ID still exists (GET /library/metadata/{id})
   b. If exists → skip (valid)
   c. If missing → mark as orphan
3. For each orphan:
   a. Extract title from stored history entry
   b. Search Plex library for matching title
   c. Present matches with confidence scores
   d. In auto mode: accept high-confidence matches (>90%)
   e. In interactive mode: prompt for selection
4. Update YAML files with new IDs
5. Generate report of changes
```

### Matching Strategy

**Title Normalization**:
- Strip parenthetical suffixes: "Episode Title (Show Name - Season)" → "Episode Title"
- Case-insensitive comparison
- Fuzzy matching with string-similarity library (already in package.json)

**Confidence Scoring**:
- 100%: Exact title match
- 90-99%: High similarity score
- 70-89%: Medium confidence (needs review)
- <70%: Low confidence (skip in auto mode)

### Command Options

```
node scripts/backfill-plex-ids.mjs           # Dry run, show what would change
node scripts/backfill-plex-ids.mjs --apply   # Apply changes
node scripts/backfill-plex-ids.mjs --interactive  # Prompt for each match
node scripts/backfill-plex-ids.mjs --library fitness  # Only process fitness.yml
```

### Output

```
Scanning media_memory...
Found 489 entries in fitness.yml
Verifying IDs against Plex...

Orphaned entries (ID no longer exists):
  606037: "Ninja Now 3 Workout For Kids: Toxic Order"
  11570: "Morning Yoga Flow"
  ...

Searching for matches...
  606037 → Found: 8542 "Ninja Now 3 Workout For Kids: Toxic Order" (100% match)
  11570 → Found: 9001 "Morning Yoga Flow" (98% match)
  11575 → No confident match found

Summary:
  Total entries: 489
  Valid: 450
  Orphaned: 39
  Matched: 35
  Unmatched: 4

Apply changes with: node scripts/backfill-plex-ids.mjs --apply
```

---

## Implementation Order

1. **Phase 1: plex.cli.mjs** (foundation)
   - Basic structure with auth
   - `libraries` command
   - `search` command
   - `info` and `verify` commands

2. **Phase 2: backfill-plex-ids.mjs**
   - Orphan detection
   - Title extraction/normalization
   - Search integration
   - Confidence scoring
   - YAML update logic

---

## Files to Create

| File | Purpose |
|------|---------|
| `cli/plex.cli.mjs` | Plex library search CLI |
| `scripts/backfill-plex-ids.mjs` | Media memory ID backfill |

## Dependencies

All already in package.json:
- `axios` - HTTP requests
- `js-yaml` / `yaml` - YAML parsing
- `string-similarity` - Fuzzy title matching

## Related Code

- `backend/lib/plex.mjs` - Existing Plex class (reuse for auth)
- `backend/lib/mediaMemory.mjs` - getMediaMemoryDir(), getMediaMemoryPath()
- `backend/lib/config/ConfigService.mjs` - Auth token access
- `cli/clickup.cli.mjs` - CLI structure reference
