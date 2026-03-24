# Bug: Brief media browse blip overwrites actual workout content

**Date:** 2026-03-18
**Severity:** Medium (incorrect content attribution in session history + Strava)
**Affected session:** `20260314114051` (March 14, P90X3 workout)
**Related:** `2026-03-13-summary-missing-grandparentId.md` (similar media pipeline issue)

## Symptoms

The March 14 fitness session recorded `plex:600171` (P90X3 — Dynamix) as the primary media, but the actual workout was `plex:53361` (P90X3 — Total Synergistics, ~32 min). The Dynamix event had `durationSeconds: 2` and a 4-second window (`end - start = 3885ms`), indicating a brief browse-past, not actual viewing.

The Strava activity was correctly named `P90X3—Total Synergistics` (enriched before the archive was captured), but the session YAML had the wrong content — meaning the session history, summary, and any UI displaying this session showed the wrong workout.

## Evidence

**Session media event (before fix):**
```yaml
contentId: plex:600171        # Dynamix
durationSeconds: 2            # 2-second detection
start: 1773512828573          # 11:27:08 PDT
end: 1773512832458            # 11:27:12 PDT (4s window)
```

**Session time:** 11:40:51 – 12:15:11 (34 min)
**Actual workout video:** Total Synergistics (ratingKey: 53361, duration: 1959744ms = ~33 min)

The media event timestamp (11:27) is 13 minutes *before* the session started, suggesting the content was detected during pre-session browsing — possibly selecting the workout from a menu.

## Root Cause

**No minimum watch duration filter exists in the media event pipeline.** When the fitness player detects a change in `currentMediaIdentity`, it immediately logs a `media_start` event regardless of how long the content was actually viewed.

### The detection chain

1. **`FitnessPlayer.jsx` (~line 1048):** A `useEffect` watches `currentMediaIdentity`. When it changes, it immediately calls `session.logEvent('media_start', {...})`. The only guard is a dedup check (`loggedVideoMediaRef.current === currentMediaIdentity`) — no time-based filtering.

2. **`PersistenceManager.js` (~line 280):** During session save, `media_start` events are consolidated with their `media_end` pairs. No filtering by watch duration — a 2-second and a 30-minute event are treated identically.

3. **`SessionSerializerV3.js` (~line 140):** All media events are serialized into the final YAML. No minimum threshold validation.

4. **Summary computation:** The summary picks the "primary" media from the events list — typically the first or longest. If only one media event exists (the blip), it becomes primary by default.

### Why only one event was recorded

In this session, the user browsed past Dynamix before starting the actual workout. The Player detected Dynamix, logged `media_start`, then the user navigated to Total Synergistics and started the workout. However, if the Player didn't detect the identity change to Total Synergistics (e.g., because it was the same show/season and the identity resolution didn't produce a new value, or because the content was loaded as a queue continuation rather than a fresh navigation), only the Dynamix blip was captured.

## Impact

- **Session history:** Shows wrong workout title and description
- **Strava enrichment:** `buildStravaDescription` reads the session's media events — if it runs after the blip is recorded but before correction, the wrong title propagates to Strava. In this case, the Strava title was correct (set by an earlier enrichment that used different data), but the session YAML was wrong.
- **Analytics:** Workout tracking attributes wrong content to sessions
- **Voice memo context:** If a voice memo references the workout, the associated media metadata is wrong

## Existing Mitigation (Partial)

`buildStravaDescription.mjs` has a `MIN_WATCH_MS = 2 * 60 * 1000` (2 min) filter that excludes episodes watched less than 2 minutes from the Strava description. However:
- This only applies to the Strava enrichment output, not the session YAML itself
- If the blip is the *only* media event, `_selectPrimaryEpisode` still picks it as primary for the title
- The session summary and history UI have no such filter

## Fix Applied

Manually corrected the session YAML: replaced `plex:600171` (Dynamix) with `plex:53361` (Total Synergistics) in both `timeline.events` and `summary.media`.

## Suggested Code Fixes

### Option A: Debounce media_start logging (recommended)

In `FitnessPlayer.jsx`, don't emit `media_start` immediately. Instead, start a debounce timer (e.g., 10 seconds). If `currentMediaIdentity` changes again before the timer fires, cancel the pending event and start a new timer for the new content. Only actually log `media_start` after the content has been stable for 10+ seconds.

```javascript
// Pseudocode
useEffect(() => {
  if (!currentMediaIdentity) return;
  if (loggedVideoMediaRef.current === currentMediaIdentity) return;

  const timer = setTimeout(() => {
    session.logEvent('media_start', { contentId: currentMediaIdentity, ... });
    loggedVideoMediaRef.current = currentMediaIdentity;
  }, 10_000); // 10s debounce

  return () => clearTimeout(timer);
}, [currentMediaIdentity]);
```

**Pros:** Prevents blips at the source. Clean, simple.
**Cons:** Legitimate short content (<10s) won't be logged. Acceptable tradeoff for fitness sessions.

### Option B: Post-hoc filtering in PersistenceManager

During session save, filter out media events where `end - start < MIN_WATCH_MS` (e.g., 30 seconds). If a media event has no `end`, use the next event's `start` as a proxy.

**Pros:** Doesn't change real-time behavior. Works retroactively.
**Cons:** The blip is still recorded in the live timeline, only removed at save time.

### Option C: Promote longest media in summary computation

When computing `summary.media`, always prefer the media event with the longest watch duration rather than the first event. This is already partially implemented in `buildStravaDescription` (`_selectPrimaryEpisode`) but not in the core summary builder.

**Pros:** Tolerates blips by deprioritizing them.
**Cons:** Doesn't remove the blip — it's still in the timeline.

### Recommended Approach

**Option A + C together.** Debounce prevents future blips from being logged. Longest-media-wins in the summary builder provides defense in depth for edge cases where brief detections still slip through.

## Resolution

**Implemented 2026-03-18:**

1. **Debounce in FitnessPlayer.jsx:** `media_start` events are now delayed by 10 seconds. If the user navigates away from content within 10s (browse-past), no event is logged. Uses refs to read volatile values (autoplay, governance, queueSize) without triggering effect re-runs.

2. **Post-hoc filter in PersistenceManager.js:** During session save, consolidated media events with `end - start < 30s` are filtered out (unless they're the only video media event). Audio tracks are never filtered. Events with no `end` timestamp (still playing at session end) are treated as Infinity duration and kept.

Both layers are tested (5 test cases in `persistence-validation.test.mjs`). The summary builder (`buildSessionSummary.js`) already selects the longest-duration media as primary, providing a third layer of defense.
