# Weekly Review — Design Spec

**Date:** 2026-03-30
**Status:** Approved

## Overview

A screen-framework widget for weekly family memory capture. Every week, the family sits down and reviews an 8-day visual grid (today + 7 days back) populated with photos from Immich and calendar events. A built-in audio recorder lets the family narrate their week in one free-form recording. The audio is saved and transcribed for archival as a primary source.

## Core Concepts

- **One widget:** `weekly-review`, registered as a screen-framework module
- **Device-agnostic:** Primary target is living room TV (Shield/FKB with keyboard nav), but no device-specific assumptions baked in
- **Free-form recording:** One audio recording per week, no per-day or per-user attribution
- **Archival-first:** Clean transcripts with good metadata, designed to feed a future primary source database

## Screen Integration

**Screen config:** `data/household/screens/weekly-review.yml`

```yaml
screen: weekly-review
route: /weekly-review
theme:
  panel-bg: rgba(0,0,0,0.6)
  panel-radius: 8px
  font-color: "#e0e0e0"
layout:
  children:
    - widget: weekly-review
config:
  immich:
    priority_people: ["Felix", "Alan", "Soren", "Milo"]  # Immich person IDs/names
  calendars:
    primary: "family"
    fallback: ["personal", "work"]
```

Configuration for family face tags, calendar sources, and content prioritization lives directly in the screen YAML under `config`.

## Frontend Module

**Location:** `frontend/src/modules/WeeklyReview/`

### Widget Registration

```
frontend/src/modules/WeeklyReview/
  index.js                          # Side-effect registration with widget registry
  WeeklyReview.jsx                  # Main widget component
  WeeklyReview.scss                 # Styles
  components/
    DayColumn.jsx                   # Single day column with photos + calendar
    PhotoWall.jsx                   # Masonry photo layout within a day
    RecordingBar.jsx                # Bottom bar with record controls + VU meter
```

Registered as `weekly-review` via `getWidgetRegistry().register()` in `index.js`.

### Layout: Full Week Grid (All Days Visible)

8 columns side by side, each representing one day (7 days back + today, left to right, oldest first).

**Column sizing:** Proportional width based on content density. A day with 12 photos gets more horizontal space than a day with 1. Empty days collapse to a narrow strip showing just the date header.

**Day column structure (top to bottom):**
1. **Day header:** Day name + date number (e.g., "Sun 23")
2. **Calendar chips:** Small badges for calendar events (e.g., "Soccer 10am", "Birthday")
3. **Photo area:** Masonry-style grid
   - Photos prioritized by face tags of configured family members
   - Grouped by session (Immich time-proximity clusters)
   - First session's best face-tagged photo becomes **hero** (spans 2 grid rows) if the day has enough photos
   - Remaining photos fill as thumbnails
   - Session groups get subtle visual grouping (border or spacing)
4. Columns scroll vertically if content overflows, but layout aims to fit without scrolling

**Photo selection logic (backend-driven):**
- Face-tagged photos of configured family members sort first
- Within face-tagged: prefer photos with multiple family members > single
- Within non-face: prefer landscapes > other
- Within each tier: prefer recency
- Group by time proximity into sessions (Immich clustering or 2-hour window)
- Mark best photo per session as hero candidate
- Backend sends pre-sorted, pre-marked data; frontend just renders

### Recording Controls

Persistent bottom bar across the full widget width.

**Idle state:**
```
[Week of Mar 23 – 30]                              [● Record]
```
If a previous recording exists: show duration badge (e.g., "5:42 recorded").

**Recording state:**
```
[● 02:34  ▐▐▐▐▐▐░░░░]                             [■ Stop]
```
- **Pulsing red dot:** Standard recording indicator
- **Timer:** Elapsed time counter (MM:SS), ticking up
- **VU meter:** Real-time audio level bar using Web Audio API `AnalyserNode`. Horizontal bar showing current mic input level. Gives immediate visual confidence that the mic is on and picking up sound.
- **Mic warning:** If VU meter flatlines (silence) for ~5 seconds, bottom bar tints amber as a subtle warning. No popup or modal.

**On stop:**
- Audio sent as base64 to backend for storage + transcription
- If a recording already exists for this week, prompt for confirmation before replacing

**Audio capture:**
- `MediaRecorder` API with `audio/webm` (or `audio/ogg` fallback)
- `AudioContext` + `AnalyserNode` for real-time VU meter (does not affect recording)
- Keyboard accessible: record/stop bound to a key action via screen-framework input system

## Data Aggregation API

### `GET /api/v1/weekly-review/bootstrap`

**Query params:**
- `week` (optional): ISO date of the week start (Monday). Defaults to current week.

**Response:**
```json
{
  "week": "2026-03-23",
  "days": [
    {
      "date": "2026-03-23",
      "label": "Sun",
      "dayOfWeek": 0,
      "calendar": [
        {
          "summary": "Soccer Practice",
          "time": "10:00",
          "endTime": "11:30",
          "calendar": "family",
          "allDay": false
        }
      ],
      "photos": [
        {
          "id": "immich-asset-id",
          "thumbnail": "/proxy/immich/assets/{id}/thumbnail",
          "original": "/proxy/immich/assets/{id}/original",
          "people": ["Felix", "Alan"],
          "isHero": true,
          "sessionIndex": 0,
          "takenAt": "2026-03-23T14:32:00Z"
        }
      ],
      "photoCount": 12,
      "sessions": [
        { "index": 0, "count": 5, "timeRange": "2:00 PM – 3:15 PM" }
      ]
    }
  ],
  "recording": {
    "exists": true,
    "recordedAt": "2026-03-29T19:30:00Z",
    "duration": 342
  }
}
```

**Backend aggregation steps:**
1. Determine 8-day date range (today – 7 days)
2. Query Immich API for assets in date range, filtered to images
3. For each asset, check person/face tags against configured `priority_people`
4. Group assets by date, then by time proximity into sessions (2-hour window)
5. Within each day: sort face-tagged first (multi-face > single > none), then by recency
6. Mark hero candidates (best photo per session, only if day has 3+ photos)
7. Fetch calendar events for date range using existing `CalendarExtractor` pattern
8. Check for existing recording in data store
9. Return merged response

### `POST /api/v1/weekly-review/recording`

**Request body:**
```json
{
  "audioBase64": "...",
  "mimeType": "audio/webm",
  "week": "2026-03-23",
  "duration": 342
}
```

**Backend steps:**
1. Decode base64 audio → save to media volume as `weekly-review/{week}/recording.webm`
2. Send audio buffer to existing OpenAI adapter (Whisper transcription)
3. Send raw transcript to GPT-4o for cleanup (reuse fitness voice memo two-stage pattern)
4. Save transcript to data volume as `weekly-review/{week}/transcript.yml`
5. Save manifest to data volume as `weekly-review/{week}/manifest.yml` (snapshot of what content was available that week)
6. Return `{ ok: true, transcript: { raw, clean, duration } }`

## Data Storage

### File Layout

**Media volume** (large binaries):
```
media/weekly-review/
  2026-03-23/
    recording.webm
```

**Data volume** (structured, queryable):
```
data/household/common/weekly-review/
  2026-03-23/
    transcript.yml
    manifest.yml
```

### `transcript.yml`
```yaml
week: "2026-03-23"
recordedAt: "2026-03-29T19:30:00Z"
duration: 342
transcriptRaw: "so this week felix had soccer on sunday and then..."
transcriptClean: "This week, Felix had soccer on Sunday and then..."
```

### `manifest.yml`
```yaml
week: "2026-03-23"
generatedAt: "2026-03-29T19:30:00Z"
days:
  - date: "2026-03-23"
    photoCount: 12
    calendarEvents: ["Soccer Practice"]
  - date: "2026-03-24"
    photoCount: 1
    calendarEvents: []
  # ... 8 days
totalPhotos: 34
totalEvents: 5
```

## Backend Architecture

| Layer | File | Purpose |
|-------|------|---------|
| Adapter | `1_adapters/weekly-review/WeeklyReviewImmichAdapter.mjs` | Query Immich for date range, filter by face tags, group into sessions |
| Domain | `2_domains/weekly-review/WeeklyReviewAggregator.mjs` | Merge calendar + photos, pick heroes, compute column weights |
| Application | `3_applications/weekly-review/WeeklyReviewService.mjs` | Orchestrate bootstrap, handle recording storage + transcription |
| API | `4_api/v1/routers/weekly-review.mjs` | `GET /bootstrap`, `POST /recording` |

**Reused components:**
- `CalendarExtractor` (existing) — calendar event queries
- `OpenAIAdapter` (existing) — Whisper transcription + GPT-4o cleanup
- Immich proxy (existing) — photo URL passthrough via `/proxy/immich/*`
- `VoiceMemoTranscriptionService` pattern (existing) — two-stage transcription flow

## Keyboard Navigation

Follows screen-framework input system. Primary interactions:

- **Left/Right arrows:** Navigate between day columns (visual focus indicator on selected column)
- **Enter/Select:** Toggle recording start/stop
- **Escape:** Exit widget (standard screen-framework behavior)

Day column focus is visual only (highlight border) — serves as a reading aid while narrating, not a functional selection. All days remain visible regardless of focus.

## Out of Scope

- Per-day or per-user recording attribution
- Downstream consumers (future primary source database integration)
- Photo editing or annotation
- Video recording
- Fitness session integration (beyond family-relevant entries if added later)
- Playback of previous recordings in the widget (data is archived, accessed elsewhere)
