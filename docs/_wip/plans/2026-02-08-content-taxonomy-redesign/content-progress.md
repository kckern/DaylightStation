# Content Progress

Content progress covers how the system tracks what users have watched, listened to, or interacted with. This data drives resume positions, watch state indicators, and intelligent content selection.

---

## MediaProgress Entity

Each interaction with playable content produces a progress record:

```json
{
  "contentId": "plex-main:12345",
  "source": "plex-main",
  "localId": "12345",
  "percent": 45,
  "playhead": 594,
  "duration": 1320,
  "lastPlayed": "2026-02-08T20:30:00Z",
  "playCount": 2,
  "isWatched": false
}
```

### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `contentId` | string | Full compound content ID |
| `percent` | number (0-100) | Completion percentage |
| `playhead` | number (seconds) | Last known position |
| `duration` | number (seconds) | Total content duration |
| `lastPlayed` | ISO timestamp | When the content was last accessed |
| `playCount` | number | How many times the content has been played |
| `isWatched` | boolean | Whether the content is considered "watched" |

---

## Classifiers

Classifiers determine when content transitions between states (unwatched, in-progress, watched). Different content types may use different thresholds.

### Default Classifier

| Condition | State |
|-----------|-------|
| `percent === 0` | unwatched |
| `0 < percent < 90` | in-progress |
| `percent >= 90` | watched |

### Custom Classifiers

Source instances or household configuration can override classifier thresholds. For example, fitness content might use a stricter threshold:

| Condition | State |
|-----------|-------|
| `percent === 0` | unwatched |
| `0 < percent < 95` | in-progress |
| `percent >= 95` | watched |

Classifiers are config-defined, not hardcoded per content type.

---

## Persistence

Progress data is persisted through multiple layers:

### Source-Level Progress

Some sources maintain their own progress tracking:
- **Plex**: Tracks watch state natively; synced bidirectionally
- **Audiobookshelf**: Tracks listening position natively

### Application-Level Progress

DaylightStation maintains its own progress records for:
- Cross-source consistency (unified watch state regardless of source)
- Sources that don't track progress natively (filesystem, singalong)
- Household-level aggregation

### Client-Level Progress

The frontend maintains transient progress in `localStorage` for:
- Watched duration within a session (survives page refreshes)
- Resume position when navigating away and returning

---

## Watch State Enrichment

When listing content (via the List API), items can be enriched with watch state data. This happens at the application layer — adapters return raw items, the application layer enriches.

```
Source adapter returns items
        │
        ▼
ContentQueryService.enrichWithWatchState(items, source)
        │
        ▼
Items now include: percent, playhead, lastPlayed, isWatched
```

Enriched fields are mapped to the API response contract:

| Domain Field | API Response Field |
|-------------|-------------------|
| `percent` | `watchProgress` |
| `playhead` | `watchSeconds` |
| `lastPlayed` | `watchedDate` / `lastPlayed` |

---

## ItemSelectionService

The ItemSelectionService uses progress data to intelligently select content from lists. It provides composable strategies for filtering and sorting.

### Strategies

| Strategy | Behavior |
|----------|----------|
| **unwatched-first** | Prioritize items with no watch history |
| **continue-watching** | Prioritize in-progress items |
| **most-recent** | Sort by lastPlayed descending |
| **least-recent** | Sort by lastPlayed ascending |
| **random** | Random selection from eligible items |

### Pipeline

The selection pipeline composes multiple stages:

```
All items
  → Filter (by watch state, scheduling rules, hold/skip flags)
  → Sort (by strategy)
  → Pick (first N items)
  → Fallback (if pipeline produces no results, relax filters)
  → Enrich (add watch state to selected items)
```

### Usage Contexts

| Context | Typical Strategy |
|---------|-----------------|
| Watchlist "next up" | unwatched-first with continue-watching |
| Program scheduling | Strategy defined per program in config |
| Queue building | Ordered by source, filtered by unwatched |
| Search results | Relevance-based, no watch state filtering |

---

## Progress for Non-Media Formats

### Singalong / Readalong

Progress is tracked by completion (did the user reach the end?). The scroller components report progress as the user scrolls through content.

### Apps (PlayableAppShell)

Apps report progress optionally via the Playable Contract:

```javascript
onPlaybackMetrics({ seconds: 15, duration: 30, isPaused: false })
```

If an app doesn't report progress, the queue treats it as 0% until it calls `advance()`, at which point it's marked 100%.

---

## Progress Logging

### API

**Route**: `POST /api/v1/play/log`

Logs a progress update from the frontend.

```json
{
  "contentId": "plex-main:12345",
  "percent": 45,
  "playhead": 594,
  "duration": 1320
}
```

### Automatic Logging

The Player component logs progress at regular intervals during playback. Progress is also logged on:
- Playback pause
- Queue advancement (current item marked with final position)
- Page unload (via `beforeunload` event)
