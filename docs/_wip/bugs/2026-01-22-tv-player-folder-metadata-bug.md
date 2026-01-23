# Bug Report: TV Player Shows Spinner Instead of Video for Plex Collections

**Date Discovered:** 2026-01-22  
**Severity:** High  
**Status:** Open  
**Component:** Frontend - Player / TV App  

---

## Summary

When selecting a Plex collection (e.g., "Bible Project") from the TV app menu, the Player component fails to render video content and displays either:
1. A perpetual loading spinner
2. Debug JSON output in a `<pre>` tag

This only occurs in local development. Production correctly plays the first video in the collection queue.

---

## Steps to Reproduce

### Method 1: Manual Testing
1. Navigate to http://localhost:3111/tv
2. Use arrow keys to navigate to "Bible Project" (row 4, col 0 in the menu grid)
3. Press Enter to select

**Expected:** Video starts playing  
**Actual:** Loading spinner appears indefinitely, or JSON debug data is displayed

### Method 2: Automated Test
```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
npx playwright test tests/runtime/tv-app/tv-video-select-play.runtime.test.mjs --reporter=list
```

### Method 3: Standalone Script
```bash
node tests/runtime/tv-app/tv-prod-test.mjs
```
Change `BASE_URL` to compare local vs production behavior.

---

## Expected Behavior (Production ✅)

Tested against `https://daylightlocal.kckern.net/tv`:

```
After selection:
  - Video elements: 1
  - Audio elements: 0
  - Player components: 2

Player state:
  - hasPreDebug: false (no JSON debug shown)
  - loadingVisible: false (spinner hidden)

Video info:
  - Source: blob:https://daylightlocal.kckern.net/...
  - Time: 5.37s (actively playing)
  - Paused: false
  - ReadyState: 4 (HAVE_ENOUGH_DATA)
```

---

## Actual Behavior (Local Dev ❌)

Tested against `http://localhost:3111/tv`:

```
After selection:
  - Video elements: 0
  - Audio elements: 0  
  - Player components: 1

Player state:
  - hasPreDebug: true (JSON debug visible!)
  - loadingVisible: true (spinner stuck!)
  - jsonData: {
      "listkey": "463232",
      "key": "463232", 
      "title": "New Testament",
      "media_url": null,  // <-- Missing!
      "thumb_id": "463232",
      ...
    }
```

---

## Technical Analysis

### Root Cause

When a Plex collection is selected, the data flow differs between production and local dev:

| Step | Production | Local Dev |
|------|------------|-----------|
| 1. Selection | `plex:463232` selected | `plex:463232` selected |
| 2. Queue creation | 32 episodes queued | Queue created |
| 3. First item data | Proper video metadata with `media_url` | Folder metadata with `media_url: null` |
| 4. Player render | VideoPlayer with blob URL | Falls through to debug `<pre>` tag |

### Code Path

1. **Menu Selection** → [frontend/src/modules/Menu/Menu.jsx](../../frontend/src/modules/Menu/Menu.jsx)
   - `onSelect` callback triggers with item data

2. **Player Component** → [frontend/src/modules/Player/Player.jsx](../../frontend/src/modules/Player/Player.jsx)
   - Receives `play` or `queue` prop with the selected item

3. **SinglePlayer Fallback** → [frontend/src/modules/Player/components/SinglePlayer.jsx:349-351](../../frontend/src/modules/Player/components/SinglePlayer.jsx#L349-L351)
   ```jsx
   {isReady && !['dash_video', 'video', 'audio'].includes(mediaInfo.media_type) && (
     <pre>
       {JSON.stringify(mediaInfo, null, 2)}
     </pre>
   )}
   ```
   - When `media_type` is missing or unrecognized, debug JSON is shown

### Backend Logs

The backend logs show the queue is created correctly:
```json
{
  "event": "playback.queue-track-changed",
  "data": {
    "payload": {
      "title": "New Testament Overview",
      "queueLength": 32,
      "queuePosition": 0
    }
  }
}
```

But also shows a remount failure:
```json
{
  "event": "playback.player-remount",
  "data": {
    "reason": "startup-deadline-exceeded",
    "conditions": {
      "mediaElementPresent": false
    }
  }
}
```

---

## Affected Files

| File | Issue |
|------|-------|
| `frontend/src/modules/Player/components/SinglePlayer.jsx` | Shows debug JSON for unknown media types |
| `frontend/src/modules/Player/Player.jsx` | May not be receiving proper media data |
| `frontend/src/modules/Menu/Menu.jsx` | Fixed: was calling wrong logging endpoint |

---

## Environment

- **OS:** macOS
- **Node:** v20.17.0
- **Browser:** Chrome 143 / Playwright headless
- **Local Dev Port:** 3111
- **Production:** daylightlocal.kckern.net

---

## Evidence

### Screenshot
Test screenshots saved at:
- `test-results/tv-app-tv-video-select-pla-42e9e--to-and-play-Bible-Project-/test-failed-1.png`

### Test Files
- Runtime test: `tests/runtime/tv-app/tv-video-select-play.runtime.test.mjs`
- Standalone prod test: `tests/runtime/tv-app/tv-prod-test.mjs`

### Backend Logs
```bash
grep -E "(463232|Bible|New Testament)" backend/dev.log | tail -30
```

---

## Related Issues

1. **Menu Logging Endpoint** (fixed in this investigation)
   - `Menu.jsx` was calling `/api/v1/play/log` instead of `/api/content/menu-log`
   - Now returns 501 (not configured) but doesn't block playback

---

## Suggested Investigation

1. Compare the API response for `/api/list/folder/TVApp` between local and production
2. Check if the `useQueueController` hook properly expands collection items
3. Verify `SinglePlayer` receives `media_type` field from the queue
4. Check if the Plex adapter is returning different data locally

---

## Workaround

None currently known. Selecting individual videos (not collections) may work.

---

## References

- Test output: `/tmp/prod-test-output.log`
- Local test log: `test-bible-detailed.log`
