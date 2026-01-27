# Bug Report: Fitness Watch History Not Syncing to Plex Media Log

**Date:** 2026-01-27
**Severity:** Medium
**Status:** Open
**Affected Component:** Fitness App → Media Watch History Integration

---

## Summary

Completed fitness workouts are not reflected in the media watch history. Users complete full workouts, sessions are saved correctly with heart rate and zone data, but the `/api/v1/fitness/show/{id}/playable` endpoint returns `lastViewedAt: null` for videos that were fully watched.

---

## Observed Behavior

User completed a full 57-minute HIIT workout (session `fs_20260127063318`), but the API shows no watch history:

```json
{
  "title": "HIIT Cardio",
  "lastViewedAt": null,
  "viewCount": null,
  "viewOffset": null
}
```

---

## Expected Behavior

After completing a fitness video, the watch history should reflect:
- `lastViewedAt`: timestamp of when video was watched
- `viewOffset`: playback position (or full duration if completed)
- Progress percentage visible in the show's episode list

---

## Root Cause Analysis

### Two Separate Systems

The fitness app has **two independent data flows** that are not connected:

| System | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| **Fitness Sessions** | `POST /api/fitness/save_session` | Save workout metrics (HR, zones, coins) | ✅ Working |
| **Media Watch Log** | `POST /api/play/log` | Track video playback progress | ❌ Not being called |

### Evidence

#### 1. Session Was Saved Successfully

File: `households/default/apps/fitness/sessions/2026-01-27/20260127063318.yml`

```yaml
session:
  id: '20260127063318'
  date: '2026-01-27'
  start: '2026-01-27 14:33:18.894'
  end: '2026-01-27 15:01:43.894'
  duration_seconds: 1705  # ~28 minutes of actual workout data

treasureBox:
  totalCoins: 398
  buckets:
    green: 155
    yellow: 198
    orange: 45

timeline:
  tick_count: 342
  series:
    kckern:hr: '[83,82,90,91,...]'  # Full heart rate data
    kckern:zone: '[["c",11],["a",7],...]'  # Zone transitions
```

#### 2. Watch History Empty

```bash
$ grep "449313" households/default/history/media_memory/plex/*.yml
# No results - episode not in any history file
```

The `14_fitness.yml` history file (123KB) contains entries for other videos but NOT 449313.

#### 3. No Play Log API Calls

Docker logs show extensive session activity but **zero** calls to `POST /api/play/log`:

```bash
$ docker logs daylight-station | grep -i "play/log"
# No results
```

#### 4. Session Validation Failures (Related Issue)

Logs show repeated validation errors that may be related:

```json
{
  "level": "error",
  "event": "console.error",
  "data": {
    "args": ["⚠️ VALIDATION_FAIL: fs_20260127063318, reason=\"device-assignments-required\""]
  }
}
```

#### 5. Media Not Governed Warnings

```json
{
  "level": "warn",
  "event": "governance.evaluate.media_not_governed",
  "data": {"mediaId": "449313"}
}
```

This suggests the governance system doesn't recognize the media, which may prevent watch progress from being logged.

---

## Technical Details

### How Watch History SHOULD Work

1. **PlexAdapter** provides `_loadViewingHistory()` which reads from YAML files:
   - Path: `households/{hid}/history/media_memory/plex/{libraryId}_{libraryName}.yml`
   - Fitness library: `14_fitness.yml`

2. **play.mjs router** handles `POST /api/play/log`:
   - Receives: `{ type: 'plex', media_key: '449313', percent: 100, seconds: 1705 }`
   - Writes to: `watchStore` → YAML files

3. **fitness.mjs router** reads history via `adapter._loadViewingHistory()` and merges into playable response

### Missing Link

The fitness frontend is **not calling** `POST /api/play/log` when videos complete. The session save flow (`save_session`) is separate and doesn't trigger watch history updates.

---

## Code Locations

| File | Purpose |
|------|---------|
| `backend/src/4_api/v1/routers/fitness.mjs:130-152` | Merges watch history into show playable response |
| `backend/src/4_api/v1/routers/play.mjs:141-200` | Handles play log POST endpoint |
| `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs:889-894` | Loads viewing history from YAML |
| `frontend/src/hooks/fitness/*` | Fitness session management (needs investigation) |

---

## Verification Commands

```bash
# Check session file exists
ls -la data/households/default/apps/fitness/sessions/2026-01-27/

# Check if episode in history
grep "449313" data/households/default/history/media_memory/plex/14_fitness.yml

# Check API response
curl -s "http://localhost:3111/api/v1/fitness/show/449307/playable" | jq '.items[] | select(.id == "plex:449313") | {title, lastViewedAt, watchProgress}'

# Check for play/log API calls
docker logs daylight-station --tail 5000 | grep -i "play/log"
```

---

## Proposed Fix Options

### Option A: Frontend Integration
Have the fitness frontend call `POST /api/play/log` when:
- Video playback reaches 90%+ completion
- Session ends with active media

### Option B: Backend Integration
Have `POST /api/fitness/save_session` trigger watch history update if session contains media reference:
```javascript
// In save_session handler
if (sessionData.mediaId) {
  await watchStore.set(`plex:${sessionData.mediaId}`, {
    playhead: sessionData.duration_seconds,
    duration: sessionData.media_duration,
    lastPlayed: nowTs24()
  });
}
```

### Option C: Session Entity Enhancement
Add `mediaId` tracking to the session entity so the relationship is explicit:
```yaml
session:
  id: '20260127063318'
  mediaId: 'plex:449313'  # Track which video was played
  ...
```

---

## Related Issues

1. **Validation failures** (`device-assignments-required`) - may be preventing normal flow
2. **Media not governed** warnings - suggests missing configuration for fitness library
3. **Legacy route deprecation** - `POST /api/fitness/save_session` hitting deprecated endpoint

---

## Additional Context

- Session file has empty `entities: []` - no media reference stored
- Two browser clients were active (MacBook + Linux) during the workout
- The session was actively saving data throughout (124 save_session calls logged)
