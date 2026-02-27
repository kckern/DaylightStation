# Fitness Session Media Visibility Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the three bugs causing 41 of 49 recent fitness sessions to be invisible on the dashboard.

**Architecture:** The fix spans three layers: (1) the backend `Session` entity drops the `summary` block during persistence — add `summary` as a pass-through field; (2) the frontend dashboard filter is too strict — relax it to show sessions without media; (3) media events are lost because `media_end` is never emitted and consolidation consumes `media_start` events. The strategy is: fix the data loss bugs first (backend summary preservation + media event pipeline), then relax the frontend filter, then backfill existing sessions.

**Tech Stack:** React (frontend), Express + YAML persistence (backend), Node.js CLI scripts

---

## Task 1: Add `summary` field to Session entity

The **root cause of Bug 1**. `PersistenceManager` computes `summary` and sends it to the backend. `SessionService.saveSession()` calls `normalizePayload()` → `Session.fromJSON()` → `session.toJSON()`. But the `Session` constructor destructures known fields and ignores `summary`. Then `toJSON()` serializes only known fields — `summary` is silently dropped.

**Files:**
- Modify: `backend/src/2_domains/fitness/entities/Session.mjs:14-49` (constructor)
- Modify: `backend/src/2_domains/fitness/entities/Session.mjs:225-280` (toJSON)
- Test: `tests/` (existing Session entity tests, if any)

**Step 1: Write the failing test**

Create a test that verifies `Session.fromJSON()` → `toJSON()` preserves a `summary` block:

```javascript
// In whichever test file covers Session entity
import { Session } from '#domains/fitness/entities/Session.mjs';

test('Session round-trips summary through fromJSON/toJSON', () => {
  const data = {
    sessionId: '20260226054502',
    startTime: 1740556000000,
    version: 3,
    session: { id: '20260226054502', date: '2026-02-26' },
    participants: { kckern: { display_name: 'kckern', is_primary: true } },
    timeline: { series: {}, events: [] },
    summary: {
      participants: { kckern: { coins: 38, hr_avg: 120, hr_max: 155, hr_min: 85 } },
      media: [{ mediaId: '602156', title: 'Cardio Power', primary: true }],
      coins: { total: 38, buckets: {} },
      challenges: { total: 0, succeeded: 0, failed: 0 },
      voiceMemos: []
    }
  };

  const session = Session.fromJSON(data);
  const json = session.toJSON();

  expect(json.summary).toBeDefined();
  expect(json.summary.media).toHaveLength(1);
  expect(json.summary.media[0].primary).toBe(true);
  expect(json.summary.participants.kckern.coins).toBe(38);
});
```

**Step 2: Run test to verify it fails**

Run: the test above
Expected: FAIL — `json.summary` is undefined

**Step 3: Implement the fix**

In `Session` constructor (line ~30), add `summary = null` to destructured params and assign `this.summary = summary;`:

```javascript
constructor({
  sessionId,
  startTime,
  endTime = null,
  durationMs = null,
  timezone = null,
  roster = [],
  timeline = { series: {}, events: [] },
  snapshots = { captures: [], updatedAt: null },
  metadata = {},
  // v3 fields
  version = 3,
  events = [],
  participants = {},
  entities = [],
  treasureBox = null,
  session = null,
  summary = null   // <-- ADD THIS
}) {
  // ... existing assignments ...
  this.summary = summary;  // <-- ADD THIS
}
```

In `toJSON()` (after the metadata block, around line 277), add:

```javascript
// Summary block (computed by frontend, preserved through persistence)
if (this.summary) result.summary = this.summary;
```

**Step 4: Run test to verify it passes**

Run: the test from step 1
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_domains/fitness/entities/Session.mjs
git commit -m "fix(fitness): preserve summary block through Session entity persistence"
```

---

## Task 2: Relax the frontend dashboard filter

**Bug 3 fix.** The dashboard currently skips sessions without `media.primary`. This should be relaxed to show all sessions, using fallback display info when media is missing.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/useDashboardData.js:130-162`

**Step 1: Understand the current filter**

The current code at line 134:
```javascript
if (!s.media?.primary) continue; // Skip sessions without primary media
```

This drops sessions with:
- `media.others` but no `media.primary`
- No media at all but valid workout data (coins, HR, duration)

**Step 2: Remove the strict media filter and add fallback display logic**

Replace the `fetchRecentSessions` filtering loop (lines 131-162) with:

```javascript
  const sessions = [];
  for (const s of sessionSummaries) {
    if (sessions.length >= limit) break;

    // Convert participants keyed object → array for component consumption
    const participants = Object.entries(s.participants || {}).map(([id, p]) => ({
      id,
      displayName: p.displayName,
      coins: p.coins,
      hrAvg: p.hrAvg,
      hrMax: p.hrMax,
    }));

    // Build media object: prefer primary, fall back to first of others, or null
    let media = null;
    if (s.media?.primary) {
      media = {
        ...s.media.primary,
        others: s.media.others || [],
      };
    } else if (s.media?.others?.length > 0) {
      media = {
        ...s.media.others[0],
        others: s.media.others.slice(1),
      };
    }

    sessions.push({
      sessionId: s.sessionId,
      date: s.date || (s.startTime ? new Date(s.startTime).toISOString().split('T')[0] : null),
      startTime: s.startTime,
      durationMs: s.durationMs,
      timezone: s.timezone,
      participants,
      totalCoins: s.totalCoins || 0,
      media,
    });
  }
```

**Step 3: Verify the dashboard component handles null media gracefully**

Check the component that renders session cards to ensure it doesn't crash when `media` is null. The component should fall back to showing participant names or "Workout" when there's no media title.

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/useDashboardData.js
git commit -m "fix(fitness): show sessions without media on dashboard"
```

---

## Task 3: Emit `media_end` events from FitnessPlayer

**Bug 2 partial fix.** The video player emits `media_start` but never `media_end`. Without `media_end`, consolidated media events lack duration data. Also, when a new `media_start` fires for the next video, the previous media's end time should be recorded.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx`

**Step 1: Research current media_start emission**

The `media_start` event is emitted at line ~1015-1042 in a `useEffect` triggered by `currentMediaIdentity` changes. When the identity changes (new video), a new `media_start` fires — but the PREVIOUS video's `media_end` is never logged.

**Step 2: Add media_end emission on media change and close**

In the `useEffect` that fires `media_start` (around line 1015), add a cleanup function that logs `media_end` for the current media when the identity changes:

```javascript
// Inside the useEffect that logs media_start:
return () => {
  // Log media_end for the media that's being replaced
  if (currentMediaIdentity && session) {
    session.logEvent('media_end', {
      mediaId: currentMediaIdentity,
      source: 'video_player',
    });
  }
};
```

In `handleClose()` (around line 857), add `media_end` before cleanup:

```javascript
// At the top of handleClose, before any cleanup:
if (currentMediaIdentity && session) {
  session.logEvent('media_end', {
    mediaId: currentMediaIdentity,
    source: 'video_player',
  });
}
```

**Step 3: Test manually**

Start a fitness session, play a video, then either:
- Advance to next video (handleNext) → verify both media_end for old and media_start for new are in timeline.events
- Close the player (handleClose) → verify media_end is logged

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "fix(fitness): emit media_end events from video player"
```

---

## Task 4: Emit `media_end` events from FitnessMusicPlayer

Same issue as Task 3 but for the music player sidebar.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx`

**Step 1: Add media_end on track change**

In the `useEffect` that logs `media_start` (around line 278), add a cleanup function:

```javascript
return () => {
  if (currentTrackIdentity && sessionInstance) {
    sessionInstance.logEvent('media_end', {
      mediaId: currentTrackIdentity,
      source: 'music_player',
    });
  }
};
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/FitnessMusicPlayer.jsx
git commit -m "fix(fitness): emit media_end events from music player"
```

---

## Task 5: Investigate empty events in Feb 26 sessions

**Bug 2 deeper investigation.** The Feb 26 sessions have `events: []` — media_start events are never fired. This is separate from the missing media_end. Need to verify the live event pipeline is working.

**Files:**
- Read: `frontend/src/hooks/fitness/FitnessTimeline.js` (logEvent)
- Read: `frontend/src/hooks/fitness/useFitnessSession.js` or equivalent (how session.logEvent is exposed)
- Read: `frontend/src/modules/Fitness/FitnessPlayer.jsx` (the useEffect that fires media_start)

**Step 1: Add diagnostic logging to FitnessTimeline.logEvent**

In `FitnessTimeline.logEvent()` (line 105), add a debug log:

```javascript
logEvent(type, data = {}, timestamp = Date.now()) {
  const normalizedType = this._normalizeKey(type);
  if (!normalizedType) return null;
  // ... existing code ...
  this.events.push(entry);

  // Diagnostic: confirm events are being accumulated
  if (typeof console !== 'undefined' && (normalizedType === 'media_start' || normalizedType === 'media_end')) {
    console.debug(`[FitnessTimeline] logEvent: ${normalizedType}, total events: ${this.events.length}`);
  }

  return entry;
}
```

**Step 2: Verify the session instance reaches FitnessPlayer**

Check that the `session` prop or context passed to `FitnessPlayer.jsx` is a live `FitnessTimeline` instance (not null/stale). The `currentMediaIdentity` useEffect has guards that may short-circuit:

- If `session` is null/undefined, `session.logEvent()` is never called
- If `currentMediaIdentity` is falsy, the effect returns early

Add a console.debug at the top of the media_start useEffect to confirm it fires.

**Step 3: Run a live test session**

Start a fitness session, play a video, and check browser console for the diagnostic logs. If `[FitnessTimeline] logEvent: media_start` appears, the pipeline works. If not, trace why the effect isn't firing.

**Step 4: Check if events are lost during persistence**

After the session ends, check the saved YAML file:
```bash
# Find the latest session file
ls -la /path/to/data/household/history/fitness/$(date +%Y-%m-%d)/
# Read it and check timeline.events
```

If `timeline.events` has media entries in the browser but the YAML file has `events: []`, the bug is in the persistence pipeline (PersistenceManager or SessionService).

**Step 5: Remove diagnostic logging once root cause is found**

**Step 6: Commit investigation findings**

Update the audit doc or create a follow-up doc with findings.

---

## Task 6: Backfill missing summaries for existing sessions

Run the existing backfill script to recover sessions that have `timeline.events` with media but no `summary` block. This must happen AFTER Task 1 (so the backend won't strip the summary on next save).

**Files:**
- Run: `cli/scripts/backfill-session-summaries.mjs`

**Step 1: Dry run to see what would change**

```bash
node cli/scripts/backfill-session-summaries.mjs
```

Review output: how many sessions will get summaries added?

**Step 2: Run with --write**

```bash
node cli/scripts/backfill-session-summaries.mjs --write
```

**Step 3: Verify recovery**

Check that previously-hidden sessions now appear on the dashboard:
- Session `20260225181217` (Feb 25, 2255 coins) should now be visible
- Session `20260224190930` (Feb 24, 1670 coins) should now be visible

**Step 4: Commit**

No code changes — this is a data operation. Document results in the audit file.

---

## Task 7: Backend fallback — compute summary from timeline.events on read

**Defense in depth.** Even after fixing the write path, old sessions without summaries will remain broken. Add a fallback in `YamlSessionDatastore.findByDate()` that computes a minimal media summary from `timeline.events` when `summary.media` is missing.

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs:249-266`

**Step 1: Add fallback media extraction**

In `findByDate()`, after the existing `summary.media` extraction (line 250-266), add:

```javascript
// Fallback: if no summary.media, try extracting from timeline.events
if (!media && data.timeline?.events?.length > 0) {
  const mediaEvents = (data.timeline.events || []).filter(e => e.type === 'media');
  if (mediaEvents.length > 0) {
    const formatFromEvent = (evt) => {
      const d = evt.data || {};
      return {
        mediaId: d.mediaId,
        title: d.title,
        showTitle: d.grandparentTitle,
        seasonTitle: d.parentTitle,
        grandparentId: d.grandparentId || null,
        parentId: d.parentId || null,
      };
    };
    // Pick longest-duration as primary
    let primaryIdx = 0;
    for (let i = 1; i < mediaEvents.length; i++) {
      const durI = (mediaEvents[i].data?.end || 0) - (mediaEvents[i].data?.start || 0);
      const durP = (mediaEvents[primaryIdx].data?.end || 0) - (mediaEvents[primaryIdx].data?.start || 0);
      if (durI > durP) primaryIdx = i;
    }
    media = {
      primary: formatFromEvent(mediaEvents[primaryIdx]),
      others: mediaEvents.filter((_, i) => i !== primaryIdx).map(formatFromEvent),
    };
  }
}
```

**Step 2: Test with a session that has events but no summary**

Verify that the API now returns media for sessions like `20260223185457` (which has timeline.events with media but no summary block).

**Step 3: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs
git commit -m "fix(fitness): fallback to timeline.events for media when summary is missing"
```

---

## Dependency Order

```
Task 1 (Session entity) ─────────────────────┐
Task 2 (Frontend filter) ─── can run parallel │
Task 3 (FitnessPlayer media_end) ─────────── │ ── all independent
Task 4 (MusicPlayer media_end) ───────────── │
                                              │
Task 5 (Investigate empty events) ──── needs live testing
                                              │
Task 6 (Backfill) ────────────── after Task 1 │
Task 7 (Backend fallback) ────── after Task 1 │
```

Tasks 1-4 are independent and can be done in parallel. Task 5 requires a live session. Task 6 depends on Task 1. Task 7 depends on Task 1.
