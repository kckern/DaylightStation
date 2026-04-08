# Fitness Session Resume & Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow interrupted fitness sessions to be resumed instead of duplicated, and provide a merge API for existing duplicates.

**Architecture:** Frontend-driven resume — on session start, check the backend for a recent same-media session. If found, hydrate state from it instead of creating new. Backend gains a `/resumable` query endpoint and a `/sessions/merge` mutation endpoint. A `finalized` flag on sessions controls silent-resume vs prompted-resume behavior.

**Tech Stack:** Express.js backend (DDD layers), vanilla JS frontend (class-based hooks), YAML persistence, RLE-encoded timelines.

**Spec:** `docs/superpowers/specs/2026-04-03-session-resume-merge-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/src/2_domains/fitness/entities/Session.mjs` | Modify | Add `finalized` field to entity |
| `backend/src/2_domains/fitness/services/TimelineService.mjs` | Modify | Add `mergeTimelines()` helper |
| `backend/src/3_applications/fitness/services/SessionService.mjs` | Modify | Add `findResumable()` and `mergeSessions()` |
| `backend/src/4_api/v1/routers/fitness.mjs` | Modify | Add `GET /resumable` and `POST /sessions/merge` routes |
| `frontend/src/hooks/fitness/FitnessSession.js` | Modify | Add resume hydration in `ensureStarted()`, pass `finalized` on end |
| `frontend/src/hooks/fitness/FitnessTimeline.js` | Modify | Add `padWithNulls()` for gap-fill on resume |
| `frontend/src/hooks/fitness/PersistenceManager.js` | Modify | Include `finalized` in persist payload |

---

### Task 1: Add `finalized` field to Session entity

**Files:**
- Modify: `backend/src/2_domains/fitness/entities/Session.mjs:13-55`

- [ ] **Step 1: Add `finalized` to constructor**

In `backend/src/2_domains/fitness/entities/Session.mjs`, add `finalized` to the constructor destructuring and assignment. Insert after line 33 (`strava_notes = null`):

```javascript
// In constructor parameter destructuring (after strava_notes = null):
finalized = false
```

And in the assignment block (after `this.strava_notes = strava_notes;` on line 54):

```javascript
this.finalized = !!finalized;
```

- [ ] **Step 2: Include `finalized` in `toJSON()`**

Find the `toJSON()` method in Session.mjs. Add `finalized: this.finalized` to the returned object, alongside the other v3 fields like `strava`, `strava_notes`.

- [ ] **Step 3: Include `finalized` in `fromJSON()`**

Find the `fromJSON()` static method. The `finalized` field will flow through automatically since `fromJSON` passes the data object to the constructor, and the constructor now accepts `finalized`. Verify this by reading `fromJSON()` — if it cherry-picks fields, add `finalized: data.finalized`.

- [ ] **Step 4: Verify round-trip**

Start the dev server if not running, then test with curl:

```bash
# Save a session with finalized: true
curl -s -X POST http://localhost:3112/api/v1/fitness/save_session \
  -H "Content-Type: application/json" \
  -d '{"sessionData":{"sessionId":"test_finalized_001","version":3,"session":{"id":"test_finalized_001","date":"2026-04-03"},"startTime":"2026-04-03 10:00:00","endTime":"2026-04-03 10:30:00","finalized":true,"timeline":{"series":{},"events":[]},"participants":{}}}' | jq .

# Read it back
curl -s http://localhost:3112/api/v1/fitness/sessions/test_finalized_001 | jq '.session.finalized'
# Expected: true

# Clean up
curl -s -X DELETE http://localhost:3112/api/v1/fitness/sessions/test_finalized_001
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/fitness/entities/Session.mjs
git commit -m "feat(fitness): add finalized field to Session entity"
```

---

### Task 2: Add `mergeTimelines()` to TimelineService

**Files:**
- Modify: `backend/src/2_domains/fitness/services/TimelineService.mjs`

- [ ] **Step 1: Add `mergeTimelines` function**

Add this exported function before the `export default` block at line 266 of `TimelineService.mjs`:

```javascript
/**
 * Merge two timelines by concatenating series with a null-filled gap.
 * Source timeline comes first (earlier), target second (later).
 * Both timelines must be in decoded (raw array) form.
 *
 * @param {Object} source - Earlier timeline (decoded series, events)
 * @param {Object} target - Later timeline (decoded series, events)
 * @param {number} gapTicks - Number of null ticks to insert between source and target
 * @returns {Object} Merged timeline with combined series, events, and updated metadata
 */
export function mergeTimelines(source, target, gapTicks = 0) {
  const sourceSeries = source.series || {};
  const targetSeries = target.series || {};
  const allKeys = new Set([...Object.keys(sourceSeries), ...Object.keys(targetSeries)]);

  const sourceTickCount = source.tick_count || 0;
  const targetTickCount = target.tick_count || 0;
  const totalTicks = sourceTickCount + gapTicks + targetTickCount;

  const gap = gapTicks > 0 ? new Array(gapTicks).fill(null) : [];
  const mergedSeries = {};

  for (const key of allKeys) {
    const srcArr = sourceSeries[key] || [];
    const tgtArr = targetSeries[key] || [];
    // Pad source to sourceTickCount if short
    const paddedSrc = srcArr.length < sourceTickCount
      ? [...srcArr, ...new Array(sourceTickCount - srcArr.length).fill(null)]
      : srcArr;
    // Pad target to targetTickCount if short
    const paddedTgt = tgtArr.length < targetTickCount
      ? [...tgtArr, ...new Array(targetTickCount - tgtArr.length).fill(null)]
      : tgtArr;
    mergedSeries[key] = [...paddedSrc, ...gap, ...paddedTgt];
  }

  // Merge events — adjust target event timestamps are already absolute, just combine and sort
  const sourceEvents = Array.isArray(source.events) ? source.events : [];
  const targetEvents = Array.isArray(target.events) ? target.events : [];
  const mergedEvents = [...sourceEvents, ...targetEvents].sort((a, b) => {
    const tsA = a?.timestamp || 0;
    const tsB = b?.timestamp || 0;
    return tsA - tsB;
  });

  return {
    series: mergedSeries,
    events: mergedEvents,
    interval_seconds: source.interval_seconds || target.interval_seconds || 5,
    tick_count: totalTicks,
    encoding: 'rle'
  };
}
```

- [ ] **Step 2: Add to default export**

Update the `export default` block at the end of the file to include `mergeTimelines`:

```javascript
export default {
  decodeSeries,
  encodeSeries,
  decodeSingleSeries,
  encodeSingleSeries,
  encodeToRLE,
  isAllNullSeries,
  parseToUnixMs,
  formatTimestamp,
  prepareTimelineForApi,
  prepareTimelineForStorage,
  mergeTimelines
};
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/2_domains/fitness/services/TimelineService.mjs
git commit -m "feat(fitness): add mergeTimelines helper to TimelineService"
```

---

### Task 3: Add `findResumable()` and `mergeSessions()` to SessionService

**Files:**
- Modify: `backend/src/3_applications/fitness/services/SessionService.mjs`

- [ ] **Step 1: Add import for `mergeTimelines`**

Update the import on line 9 to include `mergeTimelines`:

```javascript
import { prepareTimelineForApi, prepareTimelineForStorage, decodeSeries, mergeTimelines } from '#domains/fitness/services/TimelineService.mjs';
```

Also add `decodeSeries` if not already imported (check first).

- [ ] **Step 2: Add `findResumable()` method**

Add after the `endSession()` method (after line 284):

```javascript
  /**
   * Find a resumable session for the given content ID.
   * A session is resumable if:
   * - Same date (today)
   * - Same media.primary.contentId
   * - Ended less than maxGapMs ago
   * 
   * @param {string} contentId - Media content ID (e.g., "plex:674227")
   * @param {string} householdId - Household ID
   * @param {Object} [options]
   * @param {number} [options.maxGapMs=1800000] - Max gap in ms (default 30 min)
   * @returns {Promise<{resumable: boolean, session?: Object, finalized?: boolean}>}
   */
  async findResumable(contentId, householdId, { maxGapMs = 30 * 60 * 1000 } = {}) {
    if (!contentId) return { resumable: false };
    const hid = this.resolveHouseholdId(householdId);
    const today = new Date().toISOString().split('T')[0];
    const now = Date.now();

    let sessions;
    try {
      sessions = await this.sessionStore.findByDate(today, hid);
    } catch {
      return { resumable: false };
    }

    if (!Array.isArray(sessions) || sessions.length === 0) return { resumable: false };

    // Filter: same contentId, ended within maxGapMs
    const candidates = sessions.filter(s => {
      const mediaId = s.media?.primary?.contentId
        || s.contentId
        || null;
      if (mediaId !== contentId) return false;

      // Must have an endTime (session is over, not active)
      const endTime = typeof s.endTime === 'number' ? s.endTime
        : (s.startTime && s.durationMs ? s.startTime + s.durationMs : null);
      if (!endTime) return false;

      return (now - endTime) < maxGapMs;
    });

    if (candidates.length === 0) return { resumable: false };

    // Take the most recent by endTime
    candidates.sort((a, b) => {
      const endA = typeof a.endTime === 'number' ? a.endTime : (a.startTime + (a.durationMs || 0));
      const endB = typeof b.endTime === 'number' ? b.endTime : (b.startTime + (b.durationMs || 0));
      return endB - endA;
    });

    const match = candidates[0];
    const sessionId = match.sessionId || match.session?.id;

    // Load full session data for the frontend to hydrate from
    const fullSession = await this.getSession(sessionId, hid, { decodeTimeline: true });
    if (!fullSession) return { resumable: false };

    return {
      resumable: true,
      session: fullSession.toJSON(),
      finalized: !!fullSession.finalized
    };
  }
```

- [ ] **Step 3: Add `mergeSessions()` method**

Add after `findResumable()`:

```javascript
  /**
   * Merge source session into target session.
   * Source timeline is prepended to target's with null-filled gap.
   * Source session file is deleted after merge.
   *
   * @param {string} sourceSessionId - Session to merge from (earlier)
   * @param {string} targetSessionId - Session to merge into (later, keeps its ID)
   * @param {string} householdId - Household ID
   * @returns {Promise<Object>} Merged session
   */
  async mergeSessions(sourceSessionId, targetSessionId, householdId) {
    const hid = this.resolveHouseholdId(householdId);
    const srcId = Session.sanitizeSessionId(sourceSessionId);
    const tgtId = Session.sanitizeSessionId(targetSessionId);
    if (!srcId || !tgtId) {
      throw new ValidationError('Both sourceSessionId and targetSessionId are required');
    }

    const source = await this.getSession(srcId, hid, { decodeTimeline: true });
    const target = await this.getSession(tgtId, hid, { decodeTimeline: true });
    if (!source) throw new EntityNotFoundError('Session', srcId);
    if (!target) throw new EntityNotFoundError('Session', tgtId);

    // Determine which is earlier
    const srcStart = source.startTime;
    const tgtStart = target.startTime;
    const [earlier, later] = srcStart <= tgtStart ? [source, target] : [target, source];

    // Calculate gap ticks
    const earlierEnd = earlier.endTime || (earlier.startTime + (earlier.durationMs || 0));
    const laterStart = later.startTime;
    const intervalMs = (earlier.timeline?.interval_seconds || 5) * 1000;
    const gapMs = Math.max(0, laterStart - earlierEnd);
    const gapTicks = Math.floor(gapMs / intervalMs);

    // Merge timelines (both already decoded from getSession with decodeTimeline: true)
    const merged = mergeTimelines(earlier.timeline, later.timeline, gapTicks);

    // Update target with merged data
    target.startTime = earlier.startTime;
    target.durationMs = (target.endTime || Date.now()) - earlier.startTime;
    target.replaceTimeline(prepareTimelineForStorage(merged));

    // Merge participants (union, target wins on conflict)
    if (earlier.participants && typeof earlier.participants === 'object') {
      for (const [key, val] of Object.entries(earlier.participants)) {
        if (!target.participants[key]) {
          target.participants[key] = val;
        }
      }
    }

    // Merge v3 events at root level
    if (Array.isArray(earlier.events) && earlier.events.length > 0) {
      target.events = [...earlier.events, ...(target.events || [])].sort(
        (a, b) => (a?.timestamp || 0) - (b?.timestamp || 0)
      );
    }

    // Merge treasureBox coins
    if (earlier.treasureBox && target.treasureBox) {
      target.treasureBox.totalCoins = (target.treasureBox.totalCoins || 0)
        + (earlier.treasureBox.totalCoins || 0);
    } else if (earlier.treasureBox && !target.treasureBox) {
      target.treasureBox = earlier.treasureBox;
    }

    // Update session block timestamps
    if (target.session) {
      target.session.duration_seconds = Math.round(target.durationMs / 1000);
    }

    // Merge strava (target wins)
    if (!target.strava && earlier.strava) target.strava = earlier.strava;
    if (!target.strava_notes && earlier.strava_notes) target.strava_notes = earlier.strava_notes;

    // Save merged target, delete source
    await this.sessionStore.save(target, hid);
    await this.sessionStore.delete(srcId, hid);

    return target;
  }
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/fitness/services/SessionService.mjs
git commit -m "feat(fitness): add findResumable and mergeSessions to SessionService"
```

---

### Task 4: Add API routes for resumable and merge

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs`

- [ ] **Step 1: Add `GET /resumable` route**

Insert after the `DELETE /sessions/:sessionId` handler (after line 360), before the receipt route:

```javascript
  /**
   * GET /api/fitness/resumable - Check if a resumable session exists
   * Query params:
   * - contentId: media content ID (required)
   * - household: household ID
   */
  router.get('/resumable', asyncHandler(async (req, res) => {
    const { contentId, household } = req.query;
    if (!contentId) {
      return res.status(400).json({ error: 'contentId query param required' });
    }
    try {
      const result = await sessionService.findResumable(contentId, household);
      return res.json(result);
    } catch (err) {
      logger.error?.('fitness.resumable.error', { contentId, error: err?.message });
      return res.status(500).json({ error: 'Failed to check resumable session' });
    }
  }));
```

- [ ] **Step 2: Add `POST /sessions/merge` route**

Insert right after the `/resumable` route:

```javascript
  /**
   * POST /api/fitness/sessions/merge - Merge two sessions
   * Body: { sourceSessionId, targetSessionId, household }
   */
  router.post('/sessions/merge', asyncHandler(async (req, res) => {
    const { sourceSessionId, targetSessionId, household } = req.body;
    if (!sourceSessionId || !targetSessionId) {
      return res.status(400).json({ error: 'sourceSessionId and targetSessionId are required' });
    }
    try {
      const merged = await sessionService.mergeSessions(sourceSessionId, targetSessionId, household);
      logger.info?.('fitness.sessions.merged', {
        sourceSessionId,
        targetSessionId,
        mergedId: merged.sessionId?.toString()
      });
      return res.json({
        merged: true,
        sessionId: merged.sessionId?.toString(),
        startTime: merged.startTime,
        endTime: merged.endTime,
        durationMs: merged.durationMs
      });
    } catch (err) {
      logger.error?.('fitness.sessions.merge.error', {
        sourceSessionId, targetSessionId, error: err?.message
      });
      const status = err.name === 'EntityNotFoundError' ? 404 : 500;
      return res.status(status).json({ error: err.message || 'Failed to merge sessions' });
    }
  }));
```

- [ ] **Step 3: Update the JSDoc comment at the top of the file**

Add to the endpoint list in the file header comment (lines 1-28):

```
 * - GET  /api/fitness/resumable - Check for resumable session by contentId
 * - POST /api/fitness/sessions/merge - Merge two sessions into one
```

- [ ] **Step 4: Test the resumable endpoint**

```bash
# Should return { resumable: false } (no recent sessions with this contentId)
curl -s "http://localhost:3112/api/v1/fitness/resumable?contentId=plex:999999" | jq .
# Expected: { "resumable": false }
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs
git commit -m "feat(fitness): add /resumable and /sessions/merge API endpoints"
```

---

### Task 5: Merge the existing duplicate sessions

This task uses the merge endpoint we just built to fix the April 1st duplicates.

- [ ] **Step 1: Merge the sessions**

The source (earlier, no voice memos) is `20260401142645`. The target (later, has voice memo) is `20260401145623`.

```bash
curl -s -X POST http://localhost:3112/api/v1/fitness/sessions/merge \
  -H "Content-Type: application/json" \
  -d '{"sourceSessionId":"20260401142645","targetSessionId":"20260401145623"}' | jq .
```

Expected: `{ merged: true, sessionId: "20260401145623", ... }`

- [ ] **Step 2: Verify the merged session**

```bash
# Check the merged session has combined duration
curl -s "http://localhost:3112/api/v1/fitness/sessions/20260401145623" | jq '{
  startTime: .session.startTime,
  endTime: .session.endTime,
  durationMs: .session.durationMs,
  coins: .session.treasureBox.totalCoins,
  participants: (.session.participants | keys),
  voiceMemos: (.session.events.voice_memos | length)
}'
```

Expected: combined coins (~1069), voice memo preserved, earlier startTime.

- [ ] **Step 3: Verify source session is deleted**

```bash
curl -s "http://localhost:3112/api/v1/fitness/sessions/20260401142645" | jq .
# Expected: { error: "Session not found" }
```

- [ ] **Step 4: No commit needed** — this is a data operation, not a code change.

---

### Task 6: Add `padWithNulls()` to FitnessTimeline

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessTimeline.js`

- [ ] **Step 1: Add `padWithNulls` method**

Add after the `reset()` method (after line 59 of FitnessTimeline.js):

```javascript
  /**
   * Pad all existing series with null values to simulate a gap.
   * Used when resuming a session after an interruption.
   * @param {number} count - Number of null ticks to append
   */
  padWithNulls(count) {
    if (!Number.isFinite(count) || count <= 0) return;
    for (const key of Object.keys(this.series)) {
      for (let i = 0; i < count; i++) {
        this.series[key].push(null);
      }
    }
    this.timebase.tickCount += count;
  }
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessTimeline.js
git commit -m "feat(fitness): add padWithNulls to FitnessTimeline for gap-fill on resume"
```

---

### Task 7: Add `finalized` to persist payload

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:909-923`

- [ ] **Step 1: Include `finalized` in the persist session data**

In `PersistenceManager.js`, find the `persistSessionData` object construction (around line 909). The spread `...sessionData` already includes whatever the summary provides, but we need to make sure `finalized` flows through.

Find the `session:` block (lines 915-921) and add `finalized`:

```javascript
    const persistSessionData = {
      ...sessionData,
      version: 3,
      timezone,
      startTime: startReadable,
      endTime: endReadable,
      session: {
        ...(numericSessionId ? { id: String(numericSessionId) } : {}),
        ...(sessionDate ? { date: sessionDate } : {}),
        ...(startReadable ? { start: startReadable } : {}),
        ...(endReadable ? { end: endReadable } : {}),
        ...(durationSeconds != null ? { duration_seconds: durationSeconds } : {}),
      },
      finalized: !!sessionData.finalized,
      participants
    };
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js
git commit -m "feat(fitness): include finalized flag in persist payload"
```

---

### Task 8: Add resume logic to FitnessSession

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js`

This is the core task — modifying `ensureStarted()` to check for a resumable session and hydrate from it.

- [ ] **Step 1: Add `_finalized` state field**

In the constructor (around line 276), add:

```javascript
    this._finalized = false;
```

- [ ] **Step 2: Set `_finalized = true` on explicit end**

In `endSession()` (line 1816), after `this.endTime = now;` (line 1827), add:

```javascript
    // Mark as finalized when user explicitly ends (not timeout/empty_roster)
    this._finalized = (reason === 'manual' || reason === 'user_initiated');
```

- [ ] **Step 3: Include `finalized` in the summary getter**

In the `get summary()` method (around line 2530), add `finalized` to the returned object:

```javascript
        return {
          sessionId: this.sessionId,
          startTime,
          endTime: derivedEndTime,
          durationMs,
          finalized: this._finalized,
          roster: this.roster.length > 0 ? this.roster : (this._lastKnownGoodRoster || []),
          // ... rest unchanged
```

- [ ] **Step 4: Add `_checkResumable()` method**

Add a new private method near the session lifecycle methods (before `ensureStarted`, around line 1298):

```javascript
  /**
   * Check if there's a resumable session for the given content.
   * @param {string} contentId - Media content ID
   * @returns {Promise<{resumable: boolean, session?: Object, finalized?: boolean}>}
   */
  async _checkResumable(contentId) {
    if (!contentId) return { resumable: false };
    try {
      const resp = await DaylightAPI.get(`api/v1/fitness/resumable?contentId=${encodeURIComponent(contentId)}`);
      return resp || { resumable: false };
    } catch (err) {
      getLogger().warn('fitness.session.resumable_check_failed', { contentId, error: err?.message });
      return { resumable: false };
    }
  }
```

- [ ] **Step 5: Add `_hydrateFromSession()` method**

Add after `_checkResumable`:

```javascript
  /**
   * Hydrate session state from a previous session's data (for resume).
   * @param {Object} sessionData - Full session data from the API
   */
  _hydrateFromSession(sessionData) {
    const sessionId = sessionData.sessionId || sessionData.session?.id;
    if (!sessionId) return false;

    const now = Date.now();

    // Set session identity
    this.sessionTimestamp = String(sessionId).replace(/^fs_/, '');
    this.sessionId = sessionId.startsWith('fs_') ? sessionId : `fs_${sessionId}`;
    this.startTime = typeof sessionData.startTime === 'number'
      ? sessionData.startTime
      : now;
    this.endTime = null; // Session is being resumed — no longer ended
    this.lastActivityTime = now;

    // Create timeline with original start time
    this.timeline = new FitnessTimeline(this.startTime, this.timebase.intervalMs || 5000);

    // Restore timeline series from the saved session
    const savedTimeline = sessionData.timeline || {};
    const savedSeries = savedTimeline.series || {};
    const savedTickCount = savedTimeline.tick_count || savedTimeline.timebase?.tickCount || 0;

    // Set tick count to match saved data
    this.timeline.timebase.tickCount = savedTickCount;

    // Restore series data
    for (const [key, values] of Object.entries(savedSeries)) {
      if (Array.isArray(values)) {
        this.timeline.series[key] = [...values];
      }
    }

    // Restore events
    const savedEvents = savedTimeline.events || sessionData.events || [];
    if (Array.isArray(savedEvents)) {
      this.timeline.events = [...savedEvents];
    }

    // Calculate gap and pad with nulls
    const previousEndTime = typeof sessionData.endTime === 'number'
      ? sessionData.endTime
      : (this.startTime + (sessionData.durationMs || 0));
    const gapMs = Math.max(0, now - previousEndTime);
    const intervalMs = this.timeline.timebase.intervalMs || 5000;
    const gapTicks = Math.floor(gapMs / intervalMs);

    if (gapTicks > 0) {
      this.timeline.padWithNulls(gapTicks);
    }

    // Restore treasureBox
    if (sessionData.treasureBox) {
      if (!this.treasureBox) {
        this.treasureBox = new FitnessTreasureBox(this);
      }
      this.treasureBox.restore(sessionData.treasureBox);
    }

    getLogger().info('fitness.session.resumed', {
      sessionId: this.sessionId,
      previousEndTime,
      gapMs,
      gapTicks,
      restoredTickCount: savedTickCount,
      restoredSeriesKeys: Object.keys(savedSeries).length
    });

    return true;
  }
```

- [ ] **Step 6: Wire resume into `ensureStarted()`**

This is the trickiest part. The `ensureStarted()` method (line 1299) is synchronous, but the resume check is async. We need to handle this carefully.

Find the `_maybeStartSessionFromBuffer` method (line 1074). This is the entry point that calls `ensureStarted()`. Modify it to check resumable BEFORE calling `ensureStarted()`.

Add a new method `_maybeStartSessionFromBufferAsync` and change the buffer threshold path to use it:

At line 1137, replace:
```javascript
    const started = this.ensureStarted({ reason: 'buffer_threshold_met' });
```

With:
```javascript
    // Check for resumable session before starting
    this._startWithResumeCheck('buffer_threshold_met');
    const started = !!this.sessionId;
```

Then add the async method:

```javascript
  /**
   * Start a session, checking for a resumable one first.
   * Fire-and-forget — if a resumable session is found after the sync start,
   * it will hydrate the session state asynchronously.
   * @param {string} reason - Start reason
   */
  async _startWithResumeCheck(reason) {
    // Get the current content ID from the active media
    const contentId = this._getCurrentContentId();

    if (!contentId) {
      // No content to check — just start normally
      if (!this.sessionId) this.ensureStarted({ reason });
      return;
    }

    const result = await this._checkResumable(contentId);

    if (!result.resumable) {
      // No resumable session — start fresh if not already started
      if (!this.sessionId) this.ensureStarted({ reason });
      return;
    }

    if (result.finalized) {
      // Session was explicitly ended — this needs a user prompt
      // Emit an event that the UI can listen for
      this._pendingResumePrompt = result.session;
      this._notifyResumePromptNeeded(result.session);
      // Don't start yet — wait for user decision
      return;
    }

    // Auto-resume silently
    this.ensureStarted({ reason: 'resumed' });
    this._hydrateFromSession(result.session);
  }

  /**
   * Get the current primary content ID from active media.
   * @returns {string|null}
   */
  _getCurrentContentId() {
    // Check snapshot for current media
    const playlist = this.snapshot?.mediaPlaylists?.video;
    if (Array.isArray(playlist) && playlist.length > 0) {
      return playlist[0]?.contentId || playlist[0]?.id || null;
    }
    return null;
  }

  /**
   * Notify listeners that a resume prompt is needed.
   * The UI should show "Resume previous session?" and call
   * acceptResume() or declineResume().
   * @param {Object} sessionData - The resumable session data
   */
  _notifyResumePromptNeeded(sessionData) {
    if (this._onResumePrompt) {
      this._onResumePrompt(sessionData);
    }
  }

  /**
   * Register callback for resume prompt events.
   * @param {Function} callback - Called with session data when resume prompt is needed
   * @returns {Function} Unsubscribe function
   */
  onResumePrompt(callback) {
    this._onResumePrompt = callback;
    return () => { this._onResumePrompt = null; };
  }

  /**
   * Accept resume — hydrate from the pending session.
   */
  acceptResume() {
    if (!this._pendingResumePrompt) return false;
    this.ensureStarted({ reason: 'resumed_after_prompt', force: true });
    this._hydrateFromSession(this._pendingResumePrompt);
    this._pendingResumePrompt = null;
    return true;
  }

  /**
   * Decline resume — start a fresh session.
   */
  declineResume() {
    this._pendingResumePrompt = null;
    this.ensureStarted({ reason: 'fresh_after_decline', force: true });
    return true;
  }
```

- [ ] **Step 7: Initialize resume state in constructor**

In the constructor (around line 276), add:

```javascript
    this._pendingResumePrompt = null;
    this._onResumePrompt = null;
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js
git commit -m "feat(fitness): add session resume logic with auto-resume and prompted resume"
```

---

### Task 9: Handle TreasureBox restore

**Files:**
- Modify: `frontend/src/hooks/fitness/TreasureBox.js` (or wherever FitnessTreasureBox is defined)

- [ ] **Step 1: Find TreasureBox class**

Search for the FitnessTreasureBox class definition:

```bash
grep -rn "class FitnessTreasureBox" frontend/src/hooks/fitness/
```

- [ ] **Step 2: Add `restore()` method**

Add a method that sets internal state from saved data:

```javascript
  /**
   * Restore TreasureBox state from saved session data.
   * @param {Object} saved - { totalCoins, buckets, perUser }
   */
  restore(saved) {
    if (!saved) return;
    if (typeof saved.totalCoins === 'number') {
      this.totalCoins = saved.totalCoins;
    }
    if (saved.buckets && typeof saved.buckets === 'object') {
      this.buckets = { ...saved.buckets };
    }
  }
```

The exact implementation depends on TreasureBox's internal structure — read the class first and adapt. The key requirement is that `this.treasureBox.restore(sessionData.treasureBox)` from Task 8 Step 5 must work.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/TreasureBox.js
git commit -m "feat(fitness): add restore method to TreasureBox for session resume"
```

---

### Task 10: Integration testing

- [ ] **Step 1: Test auto-resume flow end-to-end**

This requires a running dev server and the fitness UI. Manual test:

1. Start a fitness session with a workout video
2. Let it run for 30+ seconds (enough ticks)
3. Navigate away or close the fitness app (triggers empty-roster timeout)
4. Within 30 minutes, start a new session with the same video
5. Verify: session ID is the same, timeline continues with null gap, coins are preserved

- [ ] **Step 2: Test explicit-end + resume prompt**

1. Start a fitness session
2. Click "End Session" (explicit end)
3. Start a new session with the same video within 30 minutes
4. Verify: a resume prompt appears
5. Accept → verify same session ID
6. (Or decline → verify new session ID)

- [ ] **Step 3: Test merge API**

```bash
# Create two test sessions
curl -s -X POST http://localhost:3112/api/v1/fitness/save_session \
  -H "Content-Type: application/json" \
  -d '{"sessionData":{"sessionId":"test_merge_src","version":3,"session":{"id":"test_merge_src","date":"2026-04-03"},"startTime":"2026-04-03 10:00:00","endTime":"2026-04-03 10:15:00","timeline":{"series":{},"events":[],"interval_seconds":5,"tick_count":180},"participants":{"kckern":{"display_name":"KC"}},"treasureBox":{"totalCoins":100}}}'

curl -s -X POST http://localhost:3112/api/v1/fitness/save_session \
  -H "Content-Type: application/json" \
  -d '{"sessionData":{"sessionId":"test_merge_tgt","version":3,"session":{"id":"test_merge_tgt","date":"2026-04-03"},"startTime":"2026-04-03 10:30:00","endTime":"2026-04-03 10:50:00","timeline":{"series":{},"events":[],"interval_seconds":5,"tick_count":240},"participants":{"kckern":{"display_name":"KC"}},"treasureBox":{"totalCoins":200}}}'

# Merge
curl -s -X POST http://localhost:3112/api/v1/fitness/sessions/merge \
  -H "Content-Type: application/json" \
  -d '{"sourceSessionId":"test_merge_src","targetSessionId":"test_merge_tgt"}' | jq .
# Expected: merged: true, totalCoins: 300 (after we verify)

# Check merged
curl -s "http://localhost:3112/api/v1/fitness/sessions/test_merge_tgt" | jq '.session.treasureBox.totalCoins'
# Expected: 300

# Check source deleted
curl -s "http://localhost:3112/api/v1/fitness/sessions/test_merge_src" | jq .
# Expected: error

# Clean up
curl -s -X DELETE "http://localhost:3112/api/v1/fitness/sessions/test_merge_tgt"
```

- [ ] **Step 4: Test 30-minute boundary**

```bash
# Test that a session older than 30 min is NOT resumable
curl -s "http://localhost:3112/api/v1/fitness/resumable?contentId=plex:674227" | jq .
# Expected: { resumable: false } — the April 1st sessions are >24h old
```

- [ ] **Step 5: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix(fitness): integration test fixes for session resume/merge"
```
