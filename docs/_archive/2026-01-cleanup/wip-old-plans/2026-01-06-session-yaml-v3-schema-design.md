# Session YAML v3 Schema Design

> **Related code:** `frontend/src/hooks/fitness/FitnessSession.js`, `frontend/src/hooks/fitness/PersistenceManager.js`, `backend/routers/fitness.mjs`

## Problem Statement

The current session YAML format (v2) has accumulated technical debt:
- **~40-50% storage bloat** from duplicated events, series, and redundant fields
- **Missing participant entries** (users with series data but no participant block)
- **Inconsistent timestamps** (4 different formats)
- **Confusing structure** (flat keys with prefixes, mixed semantics)
- **Empty series persisted** (all-null arrays wasting space)

## Goals

1. Reduce storage bloat through deduplication
2. Improve queryability for future dashboards, PDF reports, thermal printer outputs
3. Achieve schema consistency with clear semantic organization
4. Support full fidelity: summary stats, timeline visualization, media played

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Backward compatibility | Not required | External tools not yet built |
| Events structure | Grouped by type | Easier to query "what music played" |
| Series taxonomy | Nested: participants, equipment, global | Separates who earned vs what recorded |
| Timestamps | Human-readable + timezone field | YAML stays readable when opened |
| Participant stats | All derived stats included | Reports don't need to parse RLE |
| Empty series | Drop entirely | Cleaner files, less noise |
| `is_guest` flag | Derived from household membership | Reliable, not dependent on assignment flow |
| Session boundaries | Based on HR activity | `first_hr`/`last_hr` define active window |

## Complete Schema (v3)

```yaml
version: 3

session:
  id: '20260106114853'
  date: '2026-01-06'
  start: '2026-01-06 19:48:53'           # Wall-clock start (first save)
  end: '2026-01-06 20:48:53'             # Wall-clock end (last save)
  duration_seconds: 3600                  # Wall-clock duration
  first_hr: '2026-01-06 19:48:58'        # First valid HR reading
  last_hr: '2026-01-06 20:31:42'         # Last valid HR reading
  active_seconds: 2564                    # Time between first/last HR
  timezone: America/Los_Angeles

totals:
  coins: 913
  buckets:
    blue: 0
    green: 270
    yellow: 400
    orange: 228
    red: 15

participants:
  kckern:
    display_name: Keith
    is_primary: true
    is_guest: false                       # Derived from household membership
    hr_device: '40475'
    cadence_device: '49904'
    coins_earned: 563
    active_seconds: 2564
    zone_summary:
      blue: 0
      green: 270
      yellow: 200
      orange: 93
      red: 0
    zone_time_seconds:
      blue: 90
      green: 810
      yellow: 1200
      orange: 464
      red: 0
    hr_stats:
      min: 71
      max: 134
      avg: 108
    total_beats: 4797

  alan:
    display_name: Alan
    is_primary: false
    is_guest: false
    hr_device: '28676'
    coins_earned: 350
    active_seconds: 1030
    zone_summary:
      blue: 0
      green: 47
      yellow: 20
      orange: 0
      red: 283
    zone_time_seconds:
      blue: 65
      green: 155
      yellow: 100
      orange: 0
      red: 710
    hr_stats:
      min: 91
      max: 193
      avg: 156
    total_beats: 2235

timeline:
  interval_seconds: 5
  tick_count: 721
  encoding: rle

  participants:
    kckern:
      hr: '[[71,2],75,74,76,77,...]'
      beats: '[5.9,11.8,18.1,...]'
      coins: '[[0,17],1,2,3,...]'
      zone: '[["c",18],["a",5],...]'
    alan:
      hr: '[[null,515],91,94,98,...]'
      beats: '[[null,512],[0,3],7.6,...]'
      coins: '[[null,512],[0,16],...]'
      zone: '[[null,515],["c",13],...]'

  equipment:
    bike-49904:
      rpm: '[[null,417],54,60,...]'
      rotations: '[[null,417],4.5,9.5,...]'

  global:
    coins: '[[0,17],1,2,3,...]'

events:
  audio:
    - at: '2026-01-06 19:52:33'
      title: Everybody Dance Now (Rock This Party) [Workout Mix]
      artist: ESPN
      album: Stadium Anthems
      plex_id: '140598'
      duration_seconds: 271
    # ... more audio entries

  video:
    - at: '2026-01-06 20:22:46'
      title: Schliersee Alpine Descent (Bavaria)
      show: Scenic Cycling
      season: Season 1
      plex_id: '672429'
      duration_seconds: 3
      labels:
        - NoMusic
    # ... more video entries

  voice_memos:
    - at: '2026-01-06 20:22:15'
      id: memo_1767730935589_v4h6stfn9
      duration_seconds: 133
      transcript: >
        I got distracted in the middle because of a screaming baby...

snapshots:
  updated_at: '2026-01-06 20:45:00'
  captures:
    - index: 6
      filename: 20260106114853_0006.jpg
      at: '2026-01-06 19:55:23'
      size_bytes: 45230
```

## Field Reference

### session

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Session ID (YYYYMMDDHHmmss) |
| `date` | string | Date portion (YYYY-MM-DD) |
| `start` | string | Wall-clock start time |
| `end` | string | Wall-clock end time (updated on each save) |
| `duration_seconds` | int | Wall-clock duration |
| `first_hr` | string | First valid HR reading timestamp |
| `last_hr` | string | Last valid HR reading timestamp |
| `active_seconds` | int | Duration between first/last HR |
| `timezone` | string | IANA timezone (e.g., America/Los_Angeles) |

### participants.{id}

| Field | Type | Description |
|-------|------|-------------|
| `display_name` | string | Human-readable name |
| `is_primary` | bool | Primary session owner |
| `is_guest` | bool | Not a household member |
| `hr_device` | string | HR monitor device ID |
| `cadence_device` | string | Cadence sensor device ID (optional) |
| `coins_earned` | int | Total coins earned |
| `active_seconds` | int | Time with valid HR data |
| `zone_summary` | object | Coins earned per zone |
| `zone_time_seconds` | object | Seconds spent in each zone |
| `hr_stats` | object | `{min, max, avg}` heart rate |
| `total_beats` | float | Cumulative heartbeats |

### timeline

| Field | Type | Description |
|-------|------|-------------|
| `interval_seconds` | int | Tick interval (default: 5) |
| `tick_count` | int | Total ticks in session |
| `encoding` | string | Series encoding (`rle`) |
| `participants.{id}.hr` | string | RLE heart rate series |
| `participants.{id}.beats` | string | RLE cumulative beats |
| `participants.{id}.coins` | string | RLE cumulative coins |
| `participants.{id}.zone` | string | RLE zone ID series |
| `equipment.{id}.rpm` | string | RLE cadence series |
| `equipment.{id}.rotations` | string | RLE cumulative rotations |
| `global.coins` | string | RLE total coins across all |

### events

| Section | Fields |
|---------|--------|
| `audio[]` | `at`, `title`, `artist`, `album`, `plex_id`, `duration_seconds` |
| `video[]` | `at`, `title`, `show`, `season`, `plex_id`, `duration_seconds`, `labels[]` |
| `voice_memos[]` | `at`, `id`, `duration_seconds`, `transcript` |

### snapshots

| Field | Type | Description |
|-------|------|-------------|
| `updated_at` | string | Last snapshot save time |
| `captures[].index` | int | Screenshot index |
| `captures[].filename` | string | File name |
| `captures[].at` | string | Capture timestamp |
| `captures[].size_bytes` | int | File size |

## Migration Notes

### Removed Fields (v2 -> v3)

| Removed | Reason |
|---------|--------|
| `sessionId` (top-level) | Moved to `session.id` |
| `startTime`, `endTime`, `durationMs` (top-level) | Moved to `session.*` |
| `treasureBox` | Renamed to `totals` |
| `entities` | Was always empty |
| `deviceAssignments` | Embedded in participants |
| `timeline.events` | Moved to `events.*` (grouped) |
| `device:*:heart-rate` series | Redundant with participant HR |
| `interval_seconds`, `tick_count`, `encoding` (top-level) | Moved to `timeline.*` |

### Behavioral Changes

1. **Session start**: Triggered by first valid HR reading (not device ping)
2. **Session end**: Each autosave updates `end` defensively (handles browser refresh)
3. **`is_guest`**: Derived from household membership, not assignment method
4. **Empty series**: Dropped entirely (no all-null arrays)

## Estimated Impact

| Metric | Before | After |
|--------|--------|-------|
| File size | ~15KB | ~8KB |
| Event count | 34 (duplicated) | 17 |
| Series count | 12 | 8 |
| Timestamp formats | 4 | 1 |

## Implementation Tasks

1. Update `PersistenceManager.js` to emit v3 format
2. Update `backend/routers/fitness.mjs` to read/write v3
3. Add derived stats computation (zone_time, hr_stats, etc.)
4. Filter empty series before persistence
5. Group events by type during serialization
6. Update `loadSessionDetail` to handle v3 format
7. Add v2 -> v3 migration script for existing sessions (optional)
