# Media Memory Data Model Redesign

## Problem Statement

The recent Plex ID backfill exposed fragility in the media_memory data model:
- **Title parsing** - Had to regex show/season from strings like "Episode (Show - Season)"
- **No library context** - Couldn't scope searches to the right library, got false matches

## Solution Overview

1. **Structured fields** - `parent`, `parentId`, `grandparent`, `grandparentId` instead of parsing
2. **Library scoping** - Library ID in filename and entries
3. **ID preservation** - `oldPlexIds` array to track backfilled IDs
4. **Daily validation** - Cron job to detect and auto-fix orphaned IDs

---

## New Data Model

### File Naming

```
media_memory/plex/
├── 14_fitness.yml      # Library ID 14 = "Fitness"
├── 1_movies.yml        # Library ID 1 = "Movies"
├── 2_tv.yml            # Library ID 2 = "TV Shows"
└── 10_music.yml        # Library ID 10 = "Music"
```

If a library is renamed in Plex, rename the file (ID stays stable).

### Entry Structure

```yaml
"673634":                              # Plex ratingKey
  title: "Morning Flow"                # Item title only (no parenthetical)
  parent: "30 Days of Yoga"            # Season/Album name
  parentId: 67890                      # Season/Album ratingKey
  grandparent: "Yoga With Adriene"     # Show/Artist name
  grandparentId: 12345                 # Show/Artist ratingKey
  libraryId: 14                        # Library section ID
  mediaType: "episode"                 # episode | movie | track | clip
  lastPlayed: "2025-01-15T10:30:00Z"
  playCount: 3
  progress: 1800                       # Seconds watched
  duration: 3600                       # Total duration
  oldPlexIds: [606037, 11570]          # Only present if backfilled
```

- For movies (no hierarchy): `parent`, `parentId`, `grandparent`, `grandparentId` are `null`
- `oldPlexIds` only included when populated (not empty array)

---

## Migration Script

**File:** `scripts/migrate-media-memory.mjs`

### What it does:
1. **Scan** existing files (`fitness.yml`, `movies.yml`, etc.)
2. **Query Plex** to get library ID for each file (match by library name)
3. **For each entry:**
   - Fetch fresh metadata from Plex using current ID
   - Extract `parent`, `parentId`, `grandparent`, `grandparentId` from Plex response
   - If ID is orphaned, attempt match by title → populate `oldPlexIds` with original
4. **Write** new files (`14_fitness.yml`, etc.)
5. **Archive** old files to `media_memory/plex/_archive/`

### Safety:
- `--dry-run` flag shows what would happen without writing
- Old files archived, not deleted
- Plex connectivity check before starting
- Transaction-style: write new file completely before archiving old

### Usage:
```bash
node scripts/migrate-media-memory.mjs --dry-run    # Preview
node scripts/migrate-media-memory.mjs              # Execute
```

---

## Daily Cron Job

**Add to:** `backend/routers/cron.mjs` → `cronDaily` array

**New file:** `backend/lib/mediaMemoryValidator.mjs`

### Logic:
```
1. Plex health check → abort if server unreachable
2. Load all media_memory files
3. Build verification list:
   - All entries with lastPlayed in last 30 days
   - 10% random sample of older entries
4. For each entry:
   - Verify ID exists in Plex
   - If missing:
     a. Search by title + parent + grandparent + libraryId
     b. If match confidence > 90%:
        - Update entry with new ID
        - Append old ID to oldPlexIds
        - Log the change
     c. If no confident match:
        - Log warning, leave entry unchanged
5. Save updated files (only if changes made)
6. Write work log if any changes/unresolved
```

### Safety:
- **Server down** → abort entirely, no changes
- **ID missing but no match** → leave alone (might be temp outage)
- **Never destructive** → always preserve old IDs in `oldPlexIds`

### Work Log

**File:** `media_memory/plex/_logs/YYYY-MM-DD.yml`

Only created if changes were made or unresolved orphans found.

```yaml
date: "2025-01-15"
runTime: "2025-01-15T04:30:12Z"
summary:
  checked: 45
  valid: 42
  backfilled: 2
  unresolved: 1

changes:
  - file: "14_fitness.yml"
    oldId: 606037
    newId: 789012
    title: "Morning Flow"
    parent: "30 Days of Yoga"
    grandparent: "Yoga With Adriene"
    confidence: 94
    timestamp: "2025-01-15T04:30:45Z"

unresolved:
  - file: "2_tv.yml"
    id: 55555
    title: "Some Episode"
    reason: "no confident match found"
```

---

## Code Changes Required

### Files to update:

**1. `backend/lib/mediaMemory.mjs`**
- `getMediaMemoryPath()` → handle `{libraryId}_{name}.yml` format
- Add `getMediaMemoryFiles()` → list all library files
- Add `parseLibraryIdFromFilename()` helper

**2. `backend/lib/plex.mjs`**
- Update `saveToMediaMemory()` → write new entry structure with parent/grandparent IDs
- Update `loadFromMediaMemory()` → read new structure
- Add `lookupByOldPlexId()` → check `oldPlexIds` arrays for backward compat

**3. `backend/routers/media.mjs`**
- `/playable` endpoint → include `parentId`, `grandparentId` in response
- Add query params: `?parentId=X` or `?grandparentId=X` for filtering

**4. `backend/routers/cron.mjs`**
- Add `"../lib/mediaMemoryValidator.mjs"` to `cronDaily` array

### New files:
- `scripts/migrate-media-memory.mjs` - one-time migration
- `backend/lib/mediaMemoryValidator.mjs` - daily cron validator

### Docs to update:
- `docs/ai-context/tv.md` - new data model

---

## Implementation Order

1. Create `migrate-media-memory.mjs` migration script
2. Update `mediaMemory.mjs` with new path helpers
3. Update `plex.mjs` to read/write new format
4. Run migration on prod data
5. Update `media.mjs` endpoints
6. Create `mediaMemoryValidator.mjs` cron job
7. Add to `cron.mjs` daily schedule
8. Update documentation
