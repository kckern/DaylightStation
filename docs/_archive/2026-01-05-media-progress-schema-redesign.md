# Media Progress Schema Redesign

## Problem

The media progress data model evolved organically, resulting in:
- Confusing field names (`progress` stores seconds, not percentage)
- Inconsistent schemas (old: `percent`/`seconds`, new: `progress`/`duration`)
- Readers must handle multiple formats

## Decision

Rename fields to be self-documenting. Big-bang migration.

## New Schema

```yaml
'672460':
  # Identity (from Plex metadata)
  title: Legs & Glutes 1
  parent: Phase 1
  parentId: 672448
  grandparent: Dig In
  grandparentId: 672445
  libraryId: 14
  mediaType: episode

  # Playback state
  playhead: 1503           # seconds - where to resume
  mediaDuration: 2123      # seconds - content length

  # History
  watchTime: 1842.5        # seconds - cumulative engagement
  playCount: 3
  lastPlayed: 2025-11-26 07.04.49
```

## Field Semantics

| Field | Type | Description |
|-------|------|-------------|
| `playhead` | int | Playhead position in seconds (where to resume) |
| `mediaDuration` | int | Total media content length in seconds |
| `watchTime` | float | Cumulative time spent watching (includes rewatches) |
| `playCount` | int | Number of play sessions |
| `lastPlayed` | string | Timestamp in local timezone: `YYYY-MM-DD HH.MM.SS` |

## Calculated Values (not stored)

```javascript
const percent = (playhead / mediaDuration) * 100;
const isWatched = percent >= 90 || (mediaDuration - playhead) <= 20;
```

## Migration Mapping

| Old Field | New Field |
|-----------|-----------|
| `progress` | `playhead` |
| `seconds` (legacy) | `playhead` |
| `duration` | `mediaDuration` |
| `percent` (legacy) | *dropped - calculated* |
| `watched_duration_lifetime` | `watchTime` |
| `watched_duration_last_session` | *dropped - runtime only* |
| `lastPlayed` | `lastPlayed` (format standardized) |

## Files to Update

### Migration Script
- `scripts/migrate-media-progress-schema.mjs` - one-time migration

### Writers
- `backend/routers/media.mjs` - `/log` endpoint

### Readers
- `backend/routers/media.mjs` - list endpoint progress display
- `backend/lib/utils.mjs` - `categorizeByWatchStatus()`
- `backend/lib/plex.mjs` - `loadPlexViewingHistory()` consumers

## Rollback

Keep `_archive/` folder with pre-migration backups (already exists).
