# Fitness Watch History Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix fitness watch history so completed workouts are reflected in the Plex media log via `POST /api/v1/play/log`.

**Architecture:** The fitness frontend already calls `postEpisodeStatus()` which invokes `/api/v1/play/log`, but the call is failing silently. We need to debug why the API isn't receiving/processing these calls, and ensure reliable logging occurs when videos complete.

**Tech Stack:** React hooks (frontend), Express router (backend), YAML-based watch store

---

## Root Cause Summary

The bug report shows:
1. `postEpisodeStatus()` in `FitnessPlayer.jsx` calls `POST /api/v1/play/log`
2. Docker logs show **zero** calls to this endpoint
3. The `computeEpisodeStatusPayload()` has conditions that can skip logging (stalled, < 10%, no media_key)

**Hypothesis:** Either the call is being skipped by frontend conditions, or the call is failing/rejected silently.

---

## Task 1: Add Diagnostic Logging to Frontend

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx:810-843`

**Step 1: Add console logging before API call**

In `postEpisodeStatus`, add logging to trace exactly what's happening:

```javascript
const postEpisodeStatus = useCallback(async ({ naturalEnd = false, reason = 'unknown' } = {}) => {
  const payload = computeEpisodeStatusPayload({ naturalEnd });
  console.log('[FitnessPlayer] postEpisodeStatus called', { naturalEnd, reason, payload });

  if (!payload) {
    console.warn('[FitnessPlayer] postEpisodeStatus skipped - no payload');
    return;
  }
  // Skip API call for stalled_near_end to avoid false completion logs (3C fix)
  if (payload.status === 'stalled_near_end') {
    console.log('[FitnessPlayer] Skipping status post - stalled near end', payload);
    return;
  }
  const now = Date.now();
  if (statusUpdateRef.current.inflight) {
    console.log('[FitnessPlayer] Skipping - already inflight');
    return;
  }
  if (now - statusUpdateRef.current.lastSent < 500) {
    console.log('[FitnessPlayer] Skipping - throttled (< 500ms since last)');
    return;
  }
  statusUpdateRef.current.inflight = true;
  console.log('[FitnessPlayer] Calling /api/v1/play/log with:', {
    title: payload.title,
    type: payload.type,
    media_key: payload.media_key,
    seconds: payload.positionSeconds,
    percent: payload.percent
  });
  try {
    const result = await DaylightAPI('api/v1/play/log', {
      title: payload.title,
      type: payload.type,
      media_key: payload.media_key,
      seconds: payload.positionSeconds,
      percent: payload.percent ?? undefined,
      status: payload.status,
      naturalEnd: payload.naturalEnd,
      duration: payload.durationSeconds,
      reason
    }, 'POST');
    console.log('[FitnessPlayer] /api/v1/play/log response:', result);
    statusUpdateRef.current.lastSent = now;
    if (payload.showId && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('fitness-show-refresh', { detail: { showId: payload.showId } }));
    }
  } catch (err) {
    console.error('[FitnessPlayer] Failed to post episode status', err);
  } finally {
    statusUpdateRef.current.inflight = false;
  }
}, [computeEpisodeStatusPayload]);
```

**Step 2: Verify logging appears during workout**

Run: Play a fitness video in the browser, watch for 30+ seconds, then close.
Expected: Console shows `[FitnessPlayer] postEpisodeStatus called` and subsequent logs.

**Step 3: Commit diagnostic changes**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "chore(fitness): add diagnostic logging to postEpisodeStatus

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add Backend Logging for play/log Endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/play.mjs:141-145`

**Step 1: Add request logging at endpoint entry**

```javascript
router.post('/log', async (req, res) => {
  logger.info?.('play.log.request_received', {
    body: req.body,
    headers: { 'content-type': req.headers['content-type'] }
  });
  try {
    const { type, media_key, percent, seconds, title, watched_duration } = req.body;
```

**Step 2: Verify logging appears**

Run: `docker logs daylight-station --tail 100 | grep play.log`
Expected: Shows `play.log.request_received` entries when frontend calls the endpoint.

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/play.mjs
git commit -m "chore(play): add request logging to /api/v1/play/log

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Test and Identify Failure Point

**Files:**
- None (manual testing)

**Step 1: Reproduce the bug with logging**

1. Start dev server: `./dev`
2. Open fitness app in browser
3. Play a video for 30+ seconds
4. Close the video

**Step 2: Check browser console for frontend logs**

Look for:
- `[FitnessPlayer] postEpisodeStatus called` - confirms function is invoked
- `[FitnessPlayer] postEpisodeStatus skipped` - shows early return
- `[FitnessPlayer] Calling /api/v1/play/log` - shows API call attempted
- `[FitnessPlayer] /api/v1/play/log response` - shows success
- `[FitnessPlayer] Failed to post episode status` - shows error

**Step 3: Check backend logs**

```bash
tail -f /tmp/dev.log | grep -i "play.log"
```

Look for:
- `play.log.request_received` - confirms request reached backend
- `play.log.error` - shows backend error
- `play.log.updated` - shows successful write

**Step 4: Document findings**

Record which step fails. Possible outcomes:
- A: Frontend never calls `postEpisodeStatus` → Fix call sites
- B: Payload is null/skipped → Fix `computeEpisodeStatusPayload`
- C: API call throws error → Fix network/URL issue
- D: Backend rejects request → Fix validation
- E: Backend errors → Fix backend logic

---

## Task 4: Fix Identified Issue (Backend Validation)

**Files:**
- Modify: `backend/src/4_api/v1/routers/play.mjs:151-153`

**Likely Issue:** The `seconds < 10` validation rejects legitimate requests where playhead position is low.

**Step 1: Write failing test**

```javascript
// backend/tests/routers/play.test.mjs
import { describe, it, expect } from 'vitest';

describe('POST /api/v1/play/log', () => {
  it('should accept requests with seconds >= 10', async () => {
    const response = await fetch('http://localhost:3112/api/v1/play/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'plex',
        media_key: '449313',
        percent: 50,
        seconds: 100
      })
    });
    expect(response.ok).toBe(true);
  });

  it('should reject requests with seconds < 10', async () => {
    const response = await fetch('http://localhost:3112/api/v1/play/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'plex',
        media_key: '449313',
        percent: 1,
        seconds: 5
      })
    });
    expect(response.status).toBe(400);
  });
});
```

**Step 2: Run test to verify current behavior**

Run: `npm test -- backend/tests/routers/play.test.mjs`
Expected: Tests pass with current implementation (validation exists).

**Step 3: Adjust validation if too strict**

If the issue is that `seconds` is being sent as 0 or undefined, add fallback:

```javascript
// In play.mjs POST /log handler
const normalizedSeconds = parseInt(seconds, 10) || 0;

// Change validation to be less strict for completed videos
if (normalizedSeconds < 10 && percent < 90) {
  return res.status(400).json({ error: 'Invalid request: seconds < 10 for non-completed video' });
}
```

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/play.mjs backend/tests/routers/play.test.mjs
git commit -m "fix(play): relax seconds validation for completed videos

Allow logging completed videos (percent >= 90) even if seconds is low.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Ensure postEpisodeStatus is Called on Video End

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx`

**Step 1: Find where video end is handled**

Search for `naturalEnd` and `handleNext` to find video completion handling.

**Step 2: Verify postEpisodeStatus is called with naturalEnd=true**

Check that when a video reaches 100%, `postEpisodeStatus({ naturalEnd: true })` is called.

Look for pattern:
```javascript
// In handlePlayerProgress or similar
if (percent >= 99.5 || naturalEndTriggered) {
  postEpisodeStatus({ naturalEnd: true, reason: 'video_complete' });
}
```

**Step 3: Add explicit call if missing**

If video end doesn't trigger the call, add it to the player progress handler:

```javascript
const handlePlayerEnd = useCallback(() => {
  console.log('[FitnessPlayer] Video ended naturally');
  postEpisodeStatus({ naturalEnd: true, reason: 'video_ended' });
}, [postEpisodeStatus]);
```

Wire this to the player's `onEnded` event.

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "fix(fitness): ensure postEpisodeStatus called on video end

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Verify Fix End-to-End

**Files:**
- None (manual testing)

**Step 1: Play and complete a fitness video**

1. Open fitness app
2. Select a short video (< 5 min)
3. Watch to completion OR skip to near-end

**Step 2: Check watch history API**

```bash
curl -s "http://localhost:3112/api/v1/fitness/show/449307/playable" | jq '.items[] | select(.id == "plex:449313") | {title, lastViewedAt, watchProgress}'
```

Expected: `lastViewedAt` should now have a timestamp.

**Step 3: Check history file**

```bash
grep "449313" /data/households/default/history/media_memory/plex/14_fitness.yml
```

Expected: Entry exists for the media ID.

**Step 4: Commit verification notes**

```bash
git add docs/_wip/bugs/2026-01-27-fitness-watch-history-not-syncing.md
git commit -m "docs: update bug report with fix verification

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Remove Diagnostic Logging

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx:810-843`
- Modify: `backend/src/4_api/v1/routers/play.mjs:141-145`

**Step 1: Remove verbose console.log statements**

Keep only essential error logging, remove debug traces:
- Remove `console.log('[FitnessPlayer] postEpisodeStatus called'...)`
- Remove `console.log('[FitnessPlayer] Calling /api/v1/play/log'...)`
- Keep `console.error('[FitnessPlayer] Failed to post episode status'...)`

**Step 2: Commit cleanup**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx backend/src/4_api/v1/routers/play.mjs
git commit -m "chore: remove diagnostic logging from watch history fix

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Update Bug Report Status

**Files:**
- Modify: `docs/_wip/bugs/2026-01-27-fitness-watch-history-not-syncing.md`

**Step 1: Update status to Resolved**

Add resolution section:

```markdown
---

## Resolution

**Status:** Resolved
**Fixed in:** [commit hash]

**Root Cause:** [describe actual root cause found]

**Fix:** [describe what was changed]

**Verification:**
- [x] Watch history API returns `lastViewedAt` after video completion
- [x] History file contains entry for watched episode
- [x] Frontend console shows no errors during playback
```

**Step 2: Commit**

```bash
git add docs/_wip/bugs/2026-01-27-fitness-watch-history-not-syncing.md
git commit -m "docs: close fitness watch history bug report

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add frontend diagnostic logging | FitnessPlayer.jsx |
| 2 | Add backend diagnostic logging | play.mjs |
| 3 | Test and identify failure point | (manual) |
| 4 | Fix backend validation | play.mjs + test |
| 5 | Ensure postEpisodeStatus called on end | FitnessPlayer.jsx |
| 6 | Verify end-to-end | (manual) |
| 7 | Remove diagnostic logging | FitnessPlayer.jsx, play.mjs |
| 8 | Update bug report | bug report md |

**Key insight:** This is a debugging-first plan. Tasks 1-3 establish visibility before making fixes. The actual fix (Tasks 4-5) depends on what the diagnostics reveal.
