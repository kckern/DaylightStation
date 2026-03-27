# Primary Media Selection & Strava Description Enrichment

**Date:** 2026-03-27
**Status:** Approved

## Problem

The current primary media selection in `buildSessionSummary.js` picks the media event with the longest duration across all types (audio + video). This leads to incorrect results:

- Warmup videos (e.g., "Ten minute warm-up") can edge out the actual workout by a few seconds
- Music tracks are eligible candidates despite never being the "workout"
- The Strava description only lists episodes watched >= 2 minutes, missing shorter legitimate content
- Music tracks are grouped under a "Playlist" header rather than listed individually

## Design

### 1. `selectPrimaryMedia` — Frontend

**File:** `frontend/src/hooks/fitness/selectPrimaryMedia.js`

Pure function that selects the primary media item from a session's media array.

```javascript
selectPrimaryMedia(mediaItems, warmupConfig) → mediaItem | null
```

**Parameters:**
- `mediaItems` — array of media summary objects (same shape as `buildSessionSummary` produces: `{ contentId, title, mediaType, showTitle, labels, description, durationMs, ... }`)
- `warmupConfig` — optional object:
  ```javascript
  {
    warmup_labels: ['Warmup', 'Cooldown'],         // match against item.labels[]
    warmup_description_tags: ['[Warmup]', '[Cooldown]', '[Stretch]'],  // substring match in description
    warmup_title_patterns: ['warm[\\s-]?up', 'cool[\\s-]?down', 'stretch', 'recovery']  // regex patterns (case-insensitive)
  }
  ```

**Algorithm:**
1. Filter out audio: remove items where `mediaType === 'audio'`
2. From remaining videos, filter out warmups by checking three signals:
   - `labels` array contains any entry from `warmupConfig.warmup_labels`
   - `description` contains any string from `warmupConfig.warmup_description_tags`
   - `title` matches any pattern from `warmupConfig.warmup_title_patterns` (case-insensitive regex)
3. Pick the item with the longest `durationMs` from surviving candidates
4. **Fallback:** if all videos were filtered out as warmups, pick the longest video overall (ignore warmup filter)
5. Return the selected item (caller marks it with `primary: true`)

**Built-in defaults:** If `warmupConfig` is null/undefined, the function still applies built-in regex patterns: `/warm[\s-]?up|cool[\s-]?down|stretch/i`. Config patterns extend (not replace) the built-ins.

### 2. `selectPrimaryMedia` — Backend

**File:** `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs`

Same algorithm, adapted for timeline event objects used by `buildStravaDescription.mjs`:
- Input items have shape `{ data: { title, durationSeconds, contentType, artist, labels, description, ... } }`
- Duration accessed via `data.durationSeconds` (not `durationMs`)
- Audio detection via `data.contentType === 'track' || !!data.artist`

Returns the selected event object (not just `.data`).

### 3. `buildStravaDescription.mjs` Changes

**Title construction:**
- Replace `_selectPrimaryEpisode()` calls with new `selectPrimaryMedia()` (warmup-aware)
- Name format unchanged: `Show — Episode`

**Description construction:**
- **Voice memos** first (unchanged): `🎙️ "transcript..."`
- **All episodes** in chronological order (by event timestamp, earliest first):
  - Format: `🖥️ Show — Episode\nDescription text`
  - Warmup episodes annotated: `🖥️ Show — Episode (warmup)\nDescription text`
  - No 2-minute minimum watch filter — all episode events are listed
- **Music tracks** one per line:
  - Format: `🎵 Artist — Title`
  - No "Playlist" header
  - Chronological order

**Example output:**
```
🎙️ "I used 20 lbs for the presses and 10 lbs for the flies..."

🖥️ Insanity — Ten minute warm-up (warmup)
Quick warmup from Pure Cardio

🖥️ 10 Minute Muscle — Shoulders 2
Controlled resistance work that adds roundness and strength to your shoulders without compromising balance.

🎵 ESPN — Harlem Shake (Workout Mix)
🎵 ESPN — Gangnam Style (Workout Mix)
🎵 ESPN — Wavin' Flag (Workout Mix)
```

**Removed:** `_selectPrimaryEpisode()` helper (replaced by `selectPrimaryMedia`).

### 4. Config Addition

**File:** `data/household/config/fitness.yml`

New keys under `plex:`, alongside existing label configs:

```yaml
plex:
  nomusic_labels:
    - NoMusic
  governed_labels:
    - KidsFun
  warmup_labels:
    - Warmup
    - Cooldown
  warmup_description_tags:
    - "[Warmup]"
    - "[Cooldown]"
    - "[Stretch]"
  warmup_title_patterns:
    - "warm[\\s-]?up"
    - "cool[\\s-]?down"
    - "stretch"
    - "recovery"
```

All matching is case-insensitive.

### 5. Integration Points

**`buildSessionSummary.js`** (frontend):
- New signature: `buildSessionSummary({ participants, series, events, treasureBox, intervalSeconds, warmupConfig })`
- Add `labels` to the media item mapping (currently stripped during the `mediaEvents.map()` at line 66-82). Add: `...(Array.isArray(d.labels) && d.labels.length ? { labels: d.labels } : {})`
- Replace lines 84-93 (inline longest-duration loop) with call to `selectPrimaryMedia(media, warmupConfig)`

**`PersistenceManager.js`** (frontend):
- Thread `warmupConfig` into the `buildSessionSummary()` call at line ~1093
- Add `warmupConfig` to the `summaryInputs` object constructed at line ~1012-1017 (this is the natural injection point — avoids changing the PersistenceManager constructor)
- Extract `warmup_labels`, `warmup_description_tags`, `warmup_title_patterns` from the plex config available via the session's fitness configuration

**`buildStravaDescription.mjs`** (backend):
- New signature: `buildStravaDescription(session, currentActivity, warmupConfig)`
- Replace the three-tier fallback chain (`_selectPrimaryEpisode(watchedEpisodes) ?? _selectPrimaryEpisode(episodeEvents) ?? summary?.media?.find(...)`) with a single `selectPrimaryMedia(episodeEvents, warmupConfig)` call. The summary.media fallback is removed — `selectPrimaryMedia` already handles fallback internally (if all videos are warmups, pick longest video)
- Since `selectPrimaryMedia` returns the full event object (not `.data`), update title construction to access `.data.grandparentTitle`, `.data.title`, etc.
- Rewrite description builder to list all episodes chronologically + music one-per-line
- Remove `_selectPrimaryEpisode()` helper entirely
- `warmupConfig` sourced from fitness config at the call site (`FitnessActivityEnrichmentService`)

**`FitnessActivityEnrichmentService.mjs`** (backend):
- Read warmup config from `configService.getAppConfig('fitness')?.plex` (extracting `warmup_labels`, `warmup_description_tags`, `warmup_title_patterns`)
- Pass as third argument: `buildStravaDescription(session, currentActivity, warmupConfig)`

**Strava description length:** Strava has a ~700-character description limit. With per-track music emoji lines, long sessions could exceed this. If the assembled description exceeds 700 chars, truncate by dropping music tracks from the bottom first, then trim episode descriptions to one line each. Keep all episode titles.

### 6. Notes

- **Older sessions** may lack `labels` on media events. The title/description pattern fallback handles this gracefully — label-based matching is additive, not required.
- **Backend return type change:** `selectPrimaryMedia` returns the full event object (not `.data`), unlike the current `_selectPrimaryEpisode`. All consumers in `buildStravaDescription` must update property access accordingly.

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/hooks/fitness/selectPrimaryMedia.js` | **New** — primary selection function (frontend) |
| `frontend/src/hooks/fitness/buildSessionSummary.js` | Add `labels` to media mapping, replace inline primary selection with `selectPrimaryMedia()` call, accept `warmupConfig` parameter |
| `frontend/src/hooks/fitness/PersistenceManager.js` | Thread `warmupConfig` from plex config into `buildSessionSummary()` call |
| `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs` | **New** — primary selection function (backend) |
| `backend/src/1_adapters/fitness/buildStravaDescription.mjs` | New signature with `warmupConfig`, use `selectPrimaryMedia()`, rewrite description format |
| `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs` | Read warmup config from `configService`, pass to `buildStravaDescription` |
| `data/household/config/fitness.yml` | Add `warmup_labels`, `warmup_description_tags`, `warmup_title_patterns` under `plex:` |

## Out of Scope

- Retroactive re-summarization of existing session YAMLs (existing `primary` flags stay as-is)
- UI changes to display warmup annotations
- Plex label tagging workflow
