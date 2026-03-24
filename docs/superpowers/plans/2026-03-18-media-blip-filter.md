# Media Blip Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent brief media browse-past events (<10s) from being recorded as workout content in fitness sessions.

**Architecture:** Two-layer defense: (1) debounce `media_start` logging in `FitnessPlayer.jsx` so blips under 10s never enter the event stream, (2) filter short-lived media events (`end - start < 30s`) in `_consolidateEvents` during session save as a safety net. The 10s debounce catches most browse-past events; the 30s consolidation filter catches edge cases where content was briefly viewed but not a real workout. The summary builder already picks longest-duration media as primary — no changes needed there.

**Tech Stack:** React (hooks/refs), Jest unit tests, existing PersistenceManager test harness

**Threshold rationale:**
- **10s debounce (FitnessPlayer):** Prevents `media_start` from firing while user is browsing menus. 10s is long enough to catch browse-past but short enough that real content starts logging promptly.
- **30s consolidation filter (PersistenceManager):** Safety net. Content viewed 10-29s still gets logged at runtime but is cleaned up at save time. This covers edge cases like autoplay briefly landing on wrong content before correction.

**Bug report:** `docs/_wip/bugs/2026-03-18-media-blip-overwrites-actual-workout-content.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` | Modify | Debounce `media_start` logging (10s delay) |
| `frontend/src/hooks/fitness/PersistenceManager.js` | Modify | Filter consolidated media events with `end - start < MIN_MEDIA_MS` |
| `tests/unit/fitness/persistence-validation.test.mjs` | Modify | Add test cases for media blip filtering |
| `tests/unit/fitness/media-debounce.test.mjs` | Create | Unit tests for the debounce logic (isolated from React) |

---

### Task 1: Add media blip filter tests to PersistenceManager

**Files:**
- Modify: `tests/unit/fitness/persistence-validation.test.mjs`

This task adds tests that verify `_consolidateEvents` (exercised through `validateSessionPayload`) filters out short-lived media events.

- [ ] **Step 1: Write failing test — blip media event filtered out**

Add a new `describe` block after the existing `_consolidateEvents — voice memo consolidation` block:

```javascript
describe('_consolidateEvents — media blip filtering', () => {
  it('should filter out media events watched less than 30 seconds', () => {
    const pm = new PersistenceManager();
    const now = Date.now();
    const sessionData = {
      startTime: now - 120000,
      endTime: now,
      roster: [{ id: 'alice', name: 'Alice' }],
      deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
      timeline: {
        timebase: { tickCount: 6 },
        series: { 'user:alice:heart_rate': [80, 85, 90, 88, 92, 95] },
        events: [
          // 2-second blip (browse-past)
          {
            timestamp: now - 100000,
            type: 'media_start',
            data: { contentId: 'plex:111', title: 'Dynamix', source: 'video_player' }
          },
          {
            timestamp: now - 98000, // 2s later
            type: 'media_end',
            data: { contentId: 'plex:111', source: 'video_player' }
          },
          // Actual workout (30+ min)
          {
            timestamp: now - 97000,
            type: 'media_start',
            data: { contentId: 'plex:222', title: 'Total Synergistics', source: 'video_player' }
          },
          {
            timestamp: now - 1000, // ~96s later
            type: 'media_end',
            data: { contentId: 'plex:222', source: 'video_player' }
          },
        ]
      }
    };

    pm.validateSessionPayload(sessionData);
    const mediaEvents = sessionData.timeline.events.filter(e => e.type === 'media');
    expect(mediaEvents).toHaveLength(1);
    expect(mediaEvents[0].data.contentId).toBe('plex:222');
    expect(mediaEvents[0].data.title).toBe('Total Synergistics');
  });

  it('should keep the blip if it is the only media event', () => {
    const pm = new PersistenceManager();
    const now = Date.now();
    const sessionData = {
      startTime: now - 120000,
      endTime: now,
      roster: [{ id: 'alice', name: 'Alice' }],
      deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
      timeline: {
        timebase: { tickCount: 6 },
        series: { 'user:alice:heart_rate': [80, 85, 90, 88, 92, 95] },
        events: [
          {
            timestamp: now - 100000,
            type: 'media_start',
            data: { contentId: 'plex:111', title: 'Dynamix', source: 'video_player' }
          },
          {
            timestamp: now - 98000,
            type: 'media_end',
            data: { contentId: 'plex:111', source: 'video_player' }
          },
        ]
      }
    };

    pm.validateSessionPayload(sessionData);
    const mediaEvents = sessionData.timeline.events.filter(e => e.type === 'media');
    // Keep it — better to have wrong media than no media
    expect(mediaEvents).toHaveLength(1);
    expect(mediaEvents[0].data.contentId).toBe('plex:111');
  });

  it('should keep all blips when no video exceeds threshold', () => {
    const pm = new PersistenceManager();
    const now = Date.now();
    const sessionData = {
      startTime: now - 120000,
      endTime: now,
      roster: [{ id: 'alice', name: 'Alice' }],
      deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
      timeline: {
        timebase: { tickCount: 6 },
        series: { 'user:alice:heart_rate': [80, 85, 90, 88, 92, 95] },
        events: [
          {
            timestamp: now - 100000,
            type: 'media_start',
            data: { contentId: 'plex:111', title: 'Short A', source: 'video_player' }
          },
          {
            timestamp: now - 95000, // 5s
            type: 'media_end',
            data: { contentId: 'plex:111', source: 'video_player' }
          },
          {
            timestamp: now - 90000,
            type: 'media_start',
            data: { contentId: 'plex:222', title: 'Short B', source: 'video_player' }
          },
          {
            timestamp: now - 85000, // 5s
            type: 'media_end',
            data: { contentId: 'plex:222', source: 'video_player' }
          },
        ]
      }
    };

    pm.validateSessionPayload(sessionData);
    const mediaEvents = sessionData.timeline.events.filter(e => e.type === 'media');
    // Both are short, but no longer video exists — keep all rather than drop everything
    expect(mediaEvents).toHaveLength(2);
  });

  it('should keep media events with no end timestamp (still playing)', () => {
    const pm = new PersistenceManager();
    const now = Date.now();
    const sessionData = {
      startTime: now - 120000,
      endTime: now,
      roster: [{ id: 'alice', name: 'Alice' }],
      deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
      timeline: {
        timebase: { tickCount: 6 },
        series: { 'user:alice:heart_rate': [80, 85, 90, 88, 92, 95] },
        events: [
          // Blip with end
          {
            timestamp: now - 100000,
            type: 'media_start',
            data: { contentId: 'plex:111', title: 'Blip', source: 'video_player' }
          },
          {
            timestamp: now - 98000,
            type: 'media_end',
            data: { contentId: 'plex:111', source: 'video_player' }
          },
          // Workout with no media_end (session ended while playing)
          {
            timestamp: now - 97000,
            type: 'media_start',
            data: { contentId: 'plex:222', title: 'Workout', source: 'video_player' }
          },
          // No media_end for plex:222
        ]
      }
    };

    pm.validateSessionPayload(sessionData);
    const mediaEvents = sessionData.timeline.events.filter(e => e.type === 'media');
    // Workout has no end → treated as Infinity duration → kept
    // Blip has 2s → filtered because a longer video exists
    expect(mediaEvents).toHaveLength(1);
    expect(mediaEvents[0].data.contentId).toBe('plex:222');
  });

  it('should not filter audio tracks regardless of duration', () => {
    const pm = new PersistenceManager();
    const now = Date.now();
    const sessionData = {
      startTime: now - 120000,
      endTime: now,
      roster: [{ id: 'alice', name: 'Alice' }],
      deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
      timeline: {
        timebase: { tickCount: 6 },
        series: { 'user:alice:heart_rate': [80, 85, 90, 88, 92, 95] },
        events: [
          {
            timestamp: now - 100000,
            type: 'media_start',
            data: { contentId: 'plex:333', title: 'Song', artist: 'Artist', source: 'music_player' }
          },
          {
            timestamp: now - 95000, // 5s
            type: 'media_end',
            data: { contentId: 'plex:333', source: 'music_player' }
          },
          {
            timestamp: now - 90000,
            type: 'media_start',
            data: { contentId: 'plex:222', title: 'Workout', source: 'video_player' }
          },
          {
            timestamp: now - 1000,
            type: 'media_end',
            data: { contentId: 'plex:222', source: 'video_player' }
          },
        ]
      }
    };

    pm.validateSessionPayload(sessionData);
    const mediaEvents = sessionData.timeline.events.filter(e => e.type === 'media');
    expect(mediaEvents).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/fitness/persistence-validation.test.mjs --verbose 2>&1 | tail -20`
Expected: The "should filter out media events watched less than 30 seconds" test FAILS (blip is not filtered yet).

- [ ] **Step 3: Commit test**

```bash
git add tests/unit/fitness/persistence-validation.test.mjs
git commit -m "test(fitness): add media blip filter tests for consolidation"
```

---

### Task 2: Implement media blip filter in `_consolidateEvents`

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js:445-471`

Add a post-filter after the consolidated media events are built. Filter out video media events that were watched less than 30 seconds, unless they're the only media event.

- [ ] **Step 1: Add MIN_MEDIA_MS constant**

At the top of the file, near other constants (look for existing constant declarations):

```javascript
const MIN_MEDIA_MS = 30 * 1000; // 30s — filter brief browse-past blips
```

- [ ] **Step 2: Add blip filter after media event construction**

In `_consolidateEvents`, after the `for...of mediaMap` loop that builds `mediaEvents` (after line 471), add:

```javascript
  // ── Filter brief video blips (browse-past) ──
  // Keep short events if they're the only video media, so sessions aren't left empty.
  const videoEvents = mediaEvents.filter(e => {
    const d = e.data || {};
    const isAudio = d.contentType === 'track' || !!d.artist;
    if (isAudio) return true; // never filter audio
    const watchMs = (d.end != null && d.start != null) ? d.end - d.start : Infinity;
    return watchMs >= MIN_MEDIA_MS;
  });
  const hasLongerVideo = videoEvents.some(e => {
    const d = e.data || {};
    return !(d.contentType === 'track' || !!d.artist);
  });
  const filteredMedia = hasLongerVideo ? videoEvents : mediaEvents;
```

Then update the final `return [...results].sort(...)` statement to use `filteredMedia` instead of `mediaEvents`. Find the line that spreads `mediaEvents` into the results array (it will look like `...mediaEvents`) and replace with `...filteredMedia`.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx jest tests/unit/fitness/persistence-validation.test.mjs --verbose 2>&1 | tail -20`
Expected: All 3 new media blip tests PASS. All existing tests still PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js
git commit -m "fix(fitness): filter brief media browse-past blips in event consolidation"
```

---

### Task 3: Debounce media_start logging in FitnessPlayer

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx:1048-1109`

Replace the immediate `media_start` logging with a 10-second debounce. If the user browses past content in under 10s, no event is logged.

The original effect has a wide dependency array (`autoplayEnabled`, `queueSize`, etc.) which causes re-runs on non-identity changes. To avoid spurious `media_end` events, we split this into two effects: one for the debounce (keyed only on identity), and one for reading current metadata via refs.

- [ ] **Step 1: Add refs**

Near line 239 where `loggedVideoMediaRef` is declared, add:

```javascript
const mediaDebounceRef = useRef(null);
const currentMediaRef = useRef(null);    // tracks enhancedCurrentItem || currentItem
const autoplayRef = useRef(false);
const governanceRef = useRef(null);
const queueSizeRef = useRef(0);
```

- [ ] **Step 2: Add ref-sync effect**

Add a small effect that keeps the refs in sync with the render values. Place it before the main media logging effect:

```javascript
// Keep refs in sync so the debounce callback reads fresh values without
// needing them in its dependency array (avoids spurious cleanup/re-runs).
useEffect(() => {
  currentMediaRef.current = enhancedCurrentItem || currentItem;
}, [enhancedCurrentItem, currentItem]);

useEffect(() => {
  autoplayRef.current = autoplayEnabled;
}, [autoplayEnabled]);

useEffect(() => {
  governanceRef.current = effectiveGovernanceState;
}, [effectiveGovernanceState]);

useEffect(() => {
  queueSizeRef.current = queueSize;
}, [queueSize]);
```

- [ ] **Step 3: Replace the media_start useEffect**

Replace the `useEffect` at lines 1048-1109 with:

```javascript
useEffect(() => {
  const session = fitnessSessionInstance;
  if (!session || typeof session.logEvent !== 'function') {
    return;
  }
  if (!currentMediaIdentity) {
    loggedVideoMediaRef.current = null;
    return;
  }
  if (loggedVideoMediaRef.current === currentMediaIdentity) {
    return;
  }

  // Debounce: wait 10s before logging media_start.
  // If currentMediaIdentity changes within 10s (browse-past), the effect
  // cleanup cancels the timer and starts fresh for the new content.
  if (mediaDebounceRef.current) {
    clearTimeout(mediaDebounceRef.current);
    mediaDebounceRef.current = null;
  }

  const capturedIdentity = currentMediaIdentity;
  mediaDebounceRef.current = setTimeout(() => {
    mediaDebounceRef.current = null;

    // Read fresh values from refs (not stale closure captures)
    const media = currentMediaRef.current;
    if (!media) return;

    const durationSeconds = normalizeDuration(
      media.duration,
      media.length,
      media.metadata?.duration
    );
    const gov = governanceRef.current;
    const logged = session.logEvent('media_start', {
      source: 'video_player',
      contentId: capturedIdentity,
      title: media.title || media.label || null,
      grandparentTitle: media.grandparentTitle || null,
      parentTitle: media.parentTitle || null,
      grandparentId: media.grandparentId || null,
      parentId: media.parentId || null,
      plexId: media.plex || media.id || null,
      mediaKey: media.assetId || null,
      durationSeconds,
      resumeSeconds: Number.isFinite(media.seconds) ? Math.round(media.seconds) : null,
      autoplay: autoplayRef.current,
      governed: gov?.isGoverned ?? Boolean(gov?.videoLocked),
      labels: Array.isArray(media.labels) ? media.labels : [],
      type: media.type || media.mediaType || 'video',
      description: media.summary || media.episodeDescription || null,
      queueSize: queueSizeRef.current
    });

    getLogger().info('fitness.media_start.autoplay', {
      contentId: capturedIdentity,
      autoplay: autoplayRef.current,
      videoLocked: gov?.videoLocked ?? null,
      isGoverned: gov?.isGoverned ?? null,
      governancePhase: gov?.status ?? null,
      labels: Array.isArray(media.labels) ? media.labels : []
    });

    if (logged) {
      loggedVideoMediaRef.current = capturedIdentity;
    }
  }, 10_000);

  return () => {
    // Cleanup fires only when fitnessSessionInstance or currentMediaIdentity changes.
    // Cancel pending debounce timer.
    if (mediaDebounceRef.current) {
      clearTimeout(mediaDebounceRef.current);
      mediaDebounceRef.current = null;
    }
    // Log media_end for the previously logged content (if any).
    if (loggedVideoMediaRef.current && session) {
      session.logEvent('media_end', {
        contentId: loggedVideoMediaRef.current,
        source: 'video_player',
      });
    }
  };
}, [fitnessSessionInstance, currentMediaIdentity]);
```

Key changes from the original:
- **Narrow dependency array:** Only `[fitnessSessionInstance, currentMediaIdentity]` — cleanup only fires when media identity actually changes, preventing spurious `media_end` events
- **Refs for volatile values:** `autoplayRef`, `governanceRef`, `queueSizeRef`, `currentMediaRef` provide fresh values inside the debounce callback without triggering effect re-runs
- **10s debounce:** `setTimeout(fn, 10_000)` delays `media_start` logging; cleanup cancels the timer if identity changes before it fires
- **No stale closures:** The callback reads from refs, not closure-captured variables

- [ ] **Step 4: Verify no lint errors**

Run: `npx eslint frontend/src/modules/Fitness/player/FitnessPlayer.jsx --quiet 2>&1 | tail -10`
Expected: No new errors (warnings are acceptable).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git commit -m "fix(fitness): debounce media_start logging to prevent browse-past blips"
```

---

### Task 4: Manual smoke test

**Files:** None (verification only)

- [ ] **Step 1: Start dev server**

Check if already running: `lsof -i :3112`
If not: `node backend/index.js` (or per dev environment setup)

- [ ] **Step 2: Open fitness screen and start a session**

Navigate to the fitness screen. Start a session with HR. Browse through a few videos quickly (< 10s each), then settle on one for > 10s.

- [ ] **Step 3: Verify in dev tools console**

After settling on a video for > 10s, check for the `fitness.media_start.autoplay` log entry. Confirm:
- The logged `contentId` matches the video you settled on
- No log entries exist for the briefly-browsed videos

- [ ] **Step 4: End session and check saved YAML**

End the session. Check the saved session YAML in `data/household/history/fitness/`. Confirm:
- Only the settled-on video appears in `timeline.events`
- No blip events from the brief browses

---

### Task 5: Update bug report

**Files:**
- Modify: `docs/_wip/bugs/2026-03-18-media-blip-overwrites-actual-workout-content.md`

- [ ] **Step 1: Add resolution section**

Append to the end of the bug report:

```markdown
## Resolution

**Implemented 2026-03-18:**

1. **Debounce in FitnessPlayer.jsx:** `media_start` events are now delayed by 10 seconds. If the user navigates away from content within 10s (browse-past), no event is logged.

2. **Post-hoc filter in PersistenceManager.js:** During session save, consolidated media events with `end - start < 30s` are filtered out (unless they're the only video media event). This is a safety net for edge cases the debounce doesn't catch.

Both layers are tested. The summary builder (`buildSessionSummary.js`) already selects the longest-duration media as primary, providing a third layer of defense.
```

- [ ] **Step 2: Commit**

```bash
git add docs/_wip/bugs/2026-03-18-media-blip-overwrites-actual-workout-content.md
git commit -m "docs: update media blip bug report with resolution"
```
