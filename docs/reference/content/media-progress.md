# Media Progress System

The Media Progress system tracks playback history across all media content in DaylightStation. It enables resume functionality, watched status display, and intelligent content selection.

---

## Purpose

**Core problems solved:**

1. **Resume playback** - Return to exact position when reopening content
2. **Track completion** - Know what's been watched vs. what's new
3. **Intelligent selection** - Prioritize unwatched content in queues and playlists
4. **Cross-session persistence** - Progress survives app restarts, device switches

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Domain Layer                                 │
├─────────────────────────────────────────────────────────────────────┤
│  MediaProgress (Entity)          IMediaProgressClassifier (Interface)│
│  - itemId                        - classify() → status               │
│  - playhead                                                          │
│  - duration                      DefaultMediaProgressClassifier      │
│  - watchTime                     FitnessProgressClassifier           │
│  - playCount                     (domain-specific implementations)   │
│  - lastPlayed                                                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Application Layer                              │
├─────────────────────────────────────────────────────────────────────┤
│  IMediaProgressMemory (Port Interface)                               │
│  - get(itemId, storagePath)                                          │
│  - set(progress, storagePath)                                        │
│  - getAll(storagePath)                                               │
│  - clear(storagePath)                                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Adapter Layer                                │
├─────────────────────────────────────────────────────────────────────┤
│  YamlMediaProgressMemory                                             │
│  - Persists to YAML files                                            │
│  - Organized by storagePath (e.g., plex/14_fitness.yml)              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## MediaProgress Entity

**Location:** `backend/src/1_domains/content/entities/MediaProgress.mjs`

The core data structure representing playback progress for a single media item.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `itemId` | string | Unique identifier (e.g., `"plex:662045"`) |
| `playhead` | number | Current position in seconds |
| `duration` | number | Total duration in seconds |
| `watchTime` | number | Actual seconds spent watching (not seeking) |
| `playCount` | number | Times playback was started |
| `lastPlayed` | string | ISO timestamp of last play |

### Computed Properties

| Property | Description |
|----------|-------------|
| `percent` | `(playhead / duration) * 100`, rounded to integer |

### Key Distinction: playhead vs. watchTime

- **playhead**: Where the video is positioned (can jump via seeking)
- **watchTime**: Actual seconds of playback (accumulates only while playing)

This distinction enables **anti-seeking protection** - preventing false "watched" status when users seek to preview content without actually watching it.

### Example

```javascript
const progress = new MediaProgress({
  itemId: 'plex:662045',
  playhead: 1530,      // 25:30 into video
  duration: 1800,      // 30:00 total
  watchTime: 1500,     // Actually watched 25 minutes
  playCount: 1,
  lastPlayed: '2026-01-28T10:30:00Z'
});

progress.percent;      // 85
progress.isWatched();  // false (< 90%)
progress.isInProgress(); // true
```

---

## Classification System

Classification determines whether content is **unwatched**, **in_progress**, or **watched**. Different content types have different rules.

### IMediaProgressClassifier Interface

**Location:** `backend/src/1_domains/content/services/IMediaProgressClassifier.mjs`

```javascript
class IMediaProgressClassifier {
  classify(progress, contentMeta = {}) → 'unwatched' | 'in_progress' | 'watched'
}
```

### DefaultMediaProgressClassifier

**Location:** `backend/src/1_domains/content/services/DefaultMediaProgressClassifier.mjs`

Standard classification for movies, TV episodes, and general media.

| Config | Default | Purpose |
|--------|---------|---------|
| `watchedPercentThreshold` | 90 | Standard content: 90% = watched |
| `shortformPercentThreshold` | 95 | Short content (<15 min): 95% = watched |
| `shortformDurationSeconds` | 900 | Threshold for "short" content (15 min) |
| `remainingSecondsThreshold` | 120 | If <2 min remaining, consider watched |
| `minWatchTimeSeconds` | 60 | Anti-seeking: must watch 60s minimum |

**Logic flow:**

```
1. playhead = 0?                    → 'unwatched'
2. watchTime < 60s?                 → 'in_progress' (anti-seeking)
3. duration < 15 min?               → use 95% threshold (shortform)
4. percent >= threshold?            → 'watched'
5. remaining < 2 min?               → 'watched'
6. otherwise                        → 'in_progress'
```

### FitnessProgressClassifier

**Location:** `backend/src/1_domains/fitness/services/FitnessProgressClassifier.mjs`

Specialized classification for workout content with different viewing patterns.

| Config | Default | Purpose |
|--------|---------|---------|
| `shortThresholdPercent` | 50 | Short workouts (≤45 min): 50% = watched |
| `longThresholdPercent` | 95 | Long workouts (>45 min): 95% = watched |
| `longDurationSeconds` | 2700 | Threshold for "long" content (45 min) |
| `minWatchTimeSeconds` | 30 | Anti-seeking: must watch 30s minimum |

**Why different thresholds?**

| Scenario | Default | Fitness | Reason |
|----------|---------|---------|--------|
| 30-min HIIT, stopped at 85% | in_progress | **watched** | User completed workout, skipped cooldown |
| 2-hour cycling video at 60% | in_progress | in_progress | Multi-session content, preserve resume position |
| Seeked to preview, 10s actual watch | in_progress | in_progress | Anti-seeking prevents false completion |

**Example scenarios:**

```javascript
const classifier = new FitnessProgressClassifier();

// 30-min workout, user at 85% (skipped cooldown)
classifier.classify({ playhead: 1530, percent: 85, watchTime: 1500 }, { duration: 1800 })
// → 'watched' (85% >= 50% short threshold)

// 2-hour Mario Kart longplay, at 60% across multiple days
classifier.classify({ playhead: 4320, percent: 60, watchTime: 4000 }, { duration: 7200 })
// → 'in_progress' (60% < 95% long threshold, preserves resume)

// User previewed workout by seeking around, only 10s actual playback
classifier.classify({ playhead: 1620, percent: 90, watchTime: 10 }, { duration: 1800 })
// → 'in_progress' (watchTime 10s < 30s anti-seeking threshold)
```

---

## Persistence

### IMediaProgressMemory Interface

**Location:** `backend/src/3_applications/content/ports/IMediaProgressMemory.mjs`

Port interface defining how progress is stored and retrieved.

| Method | Description |
|--------|-------------|
| `get(itemId, storagePath)` | Get progress for single item |
| `set(progress, storagePath)` | Save progress for item |
| `getAll(storagePath)` | Get all progress for a storage path |
| `clear(storagePath)` | Delete all progress for a storage path |

### YamlMediaProgressMemory

**Location:** `backend/src/2_adapters/persistence/yaml/YamlMediaProgressMemory.mjs`

YAML file-based implementation. Organizes data by `storagePath`.

**Storage structure:**

```
{householdDir}/history/media_memory/
├── plex.yml                    # General Plex content
├── plex/
│   ├── 14_fitness.yml          # Fitness library (section 14)
│   └── 7_movies.yml            # Movies library (section 7)
├── media.yml                   # Local media files
└── local-content.yml           # Local content adapter
```

**File format:**

```yaml
# plex/14_fitness.yml
662045:
  playhead: 1530
  duration: 1800
  percent: 85
  playCount: 1
  lastPlayed: '2026-01-28T10:30:00Z'
  watchTime: 1500

662046:
  playhead: 0
  duration: 2400
  percent: 0
  playCount: 0
```

### Storage Path Convention

Each content adapter provides a `getStoragePath()` method returning where its progress should be stored:

| Adapter | Storage Path | Resulting File |
|---------|--------------|----------------|
| PlexAdapter (general) | `'plex'` | `plex.yml` |
| PlexAdapter (library 14) | `'plex/14_fitness'` | `plex/14_fitness.yml` |
| FilesystemAdapter | `'media'` | `media.yml` |
| LocalContentAdapter | `'local-content'` | `local-content.yml` |

---

## Data Flow

### Recording Progress (Player → Storage)

```
1. Player reports playback position every N seconds
2. POST /api/v1/play/log { itemId, playhead, duration, ... }
3. play.mjs router receives request
4. Creates/updates MediaProgress entity
5. Calls mediaProgressMemory.set(progress, storagePath)
6. YamlMediaProgressMemory writes to YAML file
```

### Loading Progress (Storage → UI)

```
1. UI requests content list (e.g., GET /api/v1/fitness/show/123)
2. Router loads items from content adapter
3. Adapter calls mediaProgressMemory.getAll(storagePath)
4. YamlMediaProgressMemory reads YAML file
5. Router merges progress into item response
6. Classifier computes isWatched for each item
7. Response includes watchProgress, watchSeconds, isWatched
8. UI displays progress bars and watched badges
```

---

## Use Cases

### Resume Playback

When user opens previously-watched content:

1. Load `MediaProgress` for item
2. If `playhead > 0`, offer "Resume from X:XX" option
3. Player seeks to `playhead` position on start

### Progress Display

In content grids and lists:

- **Progress bar**: Shows `percent` for in-progress items
- **Watched badge**: Shows checkmark/date for completed items
- **Unwatched indicator**: No decoration for new content

### Queue Selection

When auto-selecting next episode or workout:

1. Load all progress for container (show/playlist)
2. Classify each item
3. Filter to `unwatched` or `in_progress`
4. Select first unwatched, or resume in-progress

### Multi-Session Content

For long content watched across multiple sessions (e.g., cycling longplays):

1. High threshold (95%) prevents premature "watched" status
2. Progress preserved for days/weeks
3. Resume exactly where left off
4. Only marked watched when truly complete

---

## Domain Boundaries

### Content Domain (Upstream)

- Owns `MediaProgress` entity
- Owns `IMediaProgressClassifier` interface
- Provides `DefaultMediaProgressClassifier`
- Has no knowledge of fitness-specific rules

### Fitness Domain (Downstream)

- Implements `FitnessProgressClassifier` using Content's interface
- Applies fitness-specific thresholds
- Content domain remains pure

This follows DDD **Customer-Supplier** pattern: Fitness depends on Content's interface, Content doesn't know Fitness exists.

---

## Configuration

### Default Classifier (Content)

No configuration needed - uses sensible defaults.

### Fitness Classifier

**Location:** `data/households/{hid}/apps/fitness/config.yml`

```yaml
progressClassification:
  shortThresholdPercent: 50
  longThresholdPercent: 95
  longDurationSeconds: 2700
  minWatchTimeSeconds: 30
```

All values optional - defaults used if not specified.

---

## API Reference

### POST /api/v1/play/log

Record playback progress.

**Request:**
```json
{
  "itemId": "plex:662045",
  "playhead": 1530,
  "duration": 1800,
  "storagePath": "plex/14_fitness"
}
```

**Response:**
```json
{
  "success": true,
  "progress": {
    "itemId": "plex:662045",
    "playhead": 1530,
    "duration": 1800,
    "percent": 85,
    "watchTime": 1500,
    "playCount": 1,
    "lastPlayed": "2026-01-28T10:30:00Z"
  }
}
```

### GET /api/v1/fitness/show/:id

Returns episodes with progress and classification.

**Response includes per-episode:**
```json
{
  "items": [
    {
      "id": "plex:662045",
      "title": "Week 1 Day 1: Lower Body",
      "duration": 1800,
      "watchProgress": 85,
      "watchSeconds": 1530,
      "watchedDate": "2026-01-28T10:30:00Z",
      "isWatched": true
    }
  ]
}
```

---

## Files Reference

| File | Layer | Purpose |
|------|-------|---------|
| `1_domains/content/entities/MediaProgress.mjs` | Domain | Core entity |
| `1_domains/content/services/IMediaProgressClassifier.mjs` | Domain | Classification interface |
| `1_domains/content/services/DefaultMediaProgressClassifier.mjs` | Domain | Standard classification |
| `1_domains/fitness/services/FitnessProgressClassifier.mjs` | Domain | Fitness classification |
| `3_applications/content/ports/IMediaProgressMemory.mjs` | Application | Storage interface |
| `2_adapters/persistence/yaml/YamlMediaProgressMemory.mjs` | Adapter | YAML persistence |
| `4_api/v1/routers/play.mjs` | API | Progress recording endpoint |
| `4_api/v1/routers/fitness.mjs` | API | Fitness content with classification |
