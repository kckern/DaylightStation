# Piano Video Sequential Learning — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-user course progress tracking, sequential episode locking, MIDI engagement gates, and playback speed/seek restrictions to the Piano kiosk's video mode.

**Architecture:** New backend routes in `piano.mjs` (`GET /piano/courses/:courseId/playable?userId=` and `POST /piano/users/:userId/video-log`) store per-user video progress in `data/users/{userId}/apps/piano/video-progress.yml`. `FitnessPlayableService` is injected into the piano router to reuse the existing Plex+watch-state enrichment pipeline; user progress is merged on top. Frontend: `usePianoCoursePlayable` hook calls the new endpoint; `useEngagementGate` watches MIDI inactivity and pauses video with an in-place `EngagementGate` overlay; `PianoVideoChrome` enforces sequential skip/rate restrictions.

**Tech Stack:** Express.js, `loadYaml`/`saveYaml` (from `#system/utils/FileIO.mjs`), `FitnessPlayableService` (Plex+watch enrichment), React hooks, `usePianoMidi` (from `PianoMidiContext.jsx`), `generateCardPitches`/`evaluateMatch` (from `PianoFlashcards/flashcardEngine.js`), Vitest + Testing Library (tests)

---

## REVISION (2026-06-26, post Opus review)

Three direction changes were made after Tasks 1–4 shipped. **Tasks 1, 2 stand. Tasks 3, 4 get refactored; Tasks 6, 7, 10 change.** Decision record:

**R1 — Write path: extend `POST /api/v1/play/log`, not a separate endpoint.**
The user's original ask was to extend the existing log API with an optional `userId`, keeping the device media-memory write live ("have one not override the other"). The standalone `POST /piano/users/:userId/video-log` from Task 4 is removed. Its storage logic moves into a new shared service, `UserVideoProgressStore`, which is injected into BOTH the play router (write side, via `play/log`) and the piano router (read side, via the courses-playable enrichment). When `play/log` receives a `userId`, it does its normal media-memory write AND delegates per-user progress to the store. One call, both layers updated, resume works for everyone.

**R2 — Engagement = any play-along, gate is fallback.**
Completion no longer requires dismissing an engagement gate. The stored entry carries a sticky boolean `engaged` (replaces `engagementCount`). The frontend sets `engaged: true` once ANY MIDI note is played during the session (the gate's note-press also satisfies this naturally). `completedAt` is stamped when `percent >= threshold && engaged`. This fixes the flaw where a student who plays along continuously (never triggering the idle gate) could never complete a lesson.

**R3 — Future seasons are hidden, not just locked.**
Task 6 is reworked: CourseDetail groups episodes by season (from the `parents` map), renders seasons only up through the first per-user-incomplete season, and HIDES later seasons entirely. Within the visible current season, episodes after the first incomplete one are locked (sequential gate). Single-season courses keep the flat list + per-episode locks. The unlock toast+chime fires when a season transitions to complete, revealing the next.

**Smaller:** per-user resume prefers `lecture.userPlayhead` over the Plex `watchSeconds` (Task 10). User_3's backfilled `video-progress.yml` field `engagementCount: 0` becomes `engaged: false`.

**Revised stored entry shape** (`data/users/{userId}/apps/piano/video-progress.yml`):
```yaml
plex:{episodeId}:
  playhead: 480
  percent: 92
  duration: 520
  lastPlayed: "2026-06-26T..."
  engaged: true        # sticky: true once any play-along occurred
  completedAt: "..."   # set when percent>=threshold && engaged; never cleared
```

### Revised backend task sequence (replaces Tasks 3–4 internals)

- **Task R-A — `UserVideoProgressStore` service** (`backend/src/3_applications/piano/UserVideoProgressStore.mjs` + test): owns `record({userId, plexId, percent, seconds, duration, engaged})` (sticky-engaged + completion stamping) and `enrich(items, userId)` (adds `userPercent/userPlayhead/userWatched/userEngaged/userCompletedAt`). Tolerates legacy `engagementCount > 0` as engaged for back-compat. Single source of truth for completion logic.
- **Task R-B — extend `POST /play/log`**: inject the store into `createPlayRouter`; after the existing media-memory write, if `req.body.userId` present, call `store.record(...)`. Remove the standalone `/users/:userId/video-log` route from `piano.mjs` and migrate its tests to the store + play/log.
- **Task R-C — repoint courses-playable**: piano `GET /courses/:id/playable` uses `store.enrich(items, userId)` instead of inline merge; keep the `isSequential` computation. Wire the store into both routers in `app.mjs`. Update User_3's backfill file field.

---

### Task 1: Piano config — add sequential + engagement settings

**Files:**
- Modify: find with `find "$DAYLIGHT_BASE_PATH/data" -name "config.yml" -path "*/piano/*"`

**Step 1: Find and open the piano config**

```bash
find "$DAYLIGHT_BASE_PATH/data" -name "config.yml" -path "*/piano/*"
```

**Step 2: Add missing keys under the `videos` section (preserve existing values)**

```yaml
videos:
  plexCollection: ...   # keep existing value
  sequential_labels:
    - sequential
  engagement_timeout_seconds: 90
  completion_threshold_percent: 90
```

**Step 3: Smoke-test the running API**

```bash
curl -s http://localhost:3112/api/v1/piano/users | python3 -m json.tool
# Should still return the roster — confirms router is healthy
```

No automated test needed (YAML config only).

---

### Task 2: Backend — inject `fitnessPlayableService` into the piano router

**Files:**
- Modify: `backend/src/app.mjs` — move piano router instantiation, add dep
- Modify: `backend/src/4_api/v1/routers/piano.mjs:42` — update factory signature

**Context:** `fitnessPlayableService` is created at line ~1682 in `app.mjs`. The piano router is currently wired at line ~1306, before `fitnessPlayableService` exists. We move the piano router block to after line ~1688 and pass the service.

**Step 1: Remove the existing piano router block at line ~1306**

```javascript
// REMOVE this block (lines ~1304-1309):
// Piano kiosk API (studio take persistence). No MIDI here — the browser owns
// Web-MIDI; this is CRUD over data/household/apps/piano/studio.
v1Routers.piano = createPianoRouter({
  configService,
  logger: rootLogger.child({ module: 'piano-api' })
});
```

**Step 2: Add the piano router block after `fitnessPlayableService` is created (~line 1688)**

```javascript
// Piano kiosk API — per-user studio, preferences, lesson progress, and
// course video progress. fitnessPlayableService provides Plex enrichment
// for the /courses/:id/playable endpoint.
v1Routers.piano = createPianoRouter({
  configService,
  fitnessPlayableService,
  logger: rootLogger.child({ module: 'piano-api' })
});
```

**Step 3: Update piano router factory signature**

In `piano.mjs`, change line 42:
```javascript
// Before:
export function createPianoRouter({ configService, logger = console }) {

// After:
export function createPianoRouter({ configService, fitnessPlayableService = null, logger = console }) {
```

**Step 4: Restart dev server and verify**

```bash
curl -s http://localhost:3112/api/v1/piano/users | python3 -m json.tool
```

Expected: same roster response as before.

**Step 5: Commit**

```bash
git add backend/src/app.mjs backend/src/4_api/v1/routers/piano.mjs
git commit -m "feat(piano): inject fitnessPlayableService into piano router for course endpoint"
```

---

### Task 3: Backend — `GET /api/v1/piano/courses/:courseId/playable`

**Files:**
- Modify: `backend/src/4_api/v1/routers/piano.mjs`
- Create: `backend/src/4_api/v1/routers/piano.courses.test.mjs`

**Step 1: Write the failing tests**

```javascript
// piano.courses.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPianoRouter } from './piano.mjs';

const MOCK_USER = 'test-user';
const MOCK_SHOW = '12345';

const mockConfigService = {
  getUserProfile: (id) => id === MOCK_USER ? { id, name: 'Test' } : null,
  getUserDir: () => '/tmp/piano-test-user',
  getHouseholdAppConfig: () => ({
    users: { primary: [MOCK_USER] },
    videos: {
      sequential_labels: ['sequential'],
      completion_threshold_percent: 90,
      engagement_timeout_seconds: 90,
    },
  }),
};

const mockPlayableService = {
  getPlayableEpisodes: vi.fn().mockResolvedValue({
    compoundId: `plex:${MOCK_SHOW}`,
    showId: MOCK_SHOW,
    items: [
      { plex: '100', label: 'Lesson 1', itemIndex: 1, parentId: '10', isWatched: false, watchProgress: 0 },
      { plex: '101', label: 'Lesson 2', itemIndex: 2, parentId: '10', isWatched: false, watchProgress: 0 },
    ],
    parents: { '10': { index: 1, title: 'Season 1', thumbnail: null } },
    info: { title: 'Piano Course', labels: ['sequential'], type: 'show' },
    containerItem: null,
  }),
};

const makeApp = (withService = true) => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/piano', createPianoRouter({
    configService: mockConfigService,
    fitnessPlayableService: withService ? mockPlayableService : null,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  return app;
};

describe('GET /api/v1/piano/courses/:courseId/playable', () => {
  beforeEach(() => mockPlayableService.getPlayableEpisodes.mockClear());

  it('returns items and isSequential:true when course has sequential label', async () => {
    const res = await request(makeApp()).get(`/api/v1/piano/courses/${MOCK_SHOW}/playable`);
    expect(res.status).toBe(200);
    expect(res.body.isSequential).toBe(true);
    expect(res.body.items).toHaveLength(2);
  });

  it('adds userPercent/userWatched fields when userId provided', async () => {
    const res = await request(makeApp()).get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=${MOCK_USER}`);
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toHaveProperty('userPercent');
    expect(res.body.items[0]).toHaveProperty('userWatched');
  });

  it('returns 400 when userId is unknown', async () => {
    const res = await request(makeApp()).get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=ghost`);
    expect(res.status).toBe(400);
  });

  it('returns 503 when fitnessPlayableService is not configured', async () => {
    const res = await request(makeApp(false)).get(`/api/v1/piano/courses/${MOCK_SHOW}/playable`);
    expect(res.status).toBe(503);
  });
});
```

**Step 2: Run to verify fail**

```bash
npx vitest run backend/src/4_api/v1/routers/piano.courses.test.mjs
```

Expected: FAIL — route doesn't exist yet.

**Step 3: Add `asyncHandler` import to `piano.mjs` (if not already present)**

At the top of `piano.mjs`:
```javascript
import { asyncHandler } from '#system/http/middleware/index.mjs';
```

**Step 4: Implement the route — add before `return router;`**

```javascript
// ── Course video playable (per-user) ────────────────────────────────────────
router.get('/courses/:courseId/playable', asyncHandler(async (req, res) => {
  if (!fitnessPlayableService) {
    return res.status(503).json({ error: 'Piano course service not configured' });
  }

  const { courseId } = req.params;
  const { userId } = req.query;

  // Validate userId if provided (reuses existing knownUser guard)
  if (userId && !knownUser(userId)) {
    return res.status(400).json({ error: 'Invalid user' });
  }

  const playable = await fitnessPlayableService.getPlayableEpisodes(courseId);

  if (userId) {
    const dir = userPianoDir(userId);
    const userProgress = loadYaml(path.join(dir, 'video-progress')) || {};
    const pianoConfig = configService.getHouseholdAppConfig(null, 'piano') || {};
    const threshold = pianoConfig.videos?.completion_threshold_percent ?? 90;

    playable.items = playable.items.map((item) => {
      const rawId = String(item.plex || item.id).replace(/^plex:/, '');
      const key = `plex:${rawId}`;
      const up = userProgress[key] || {};
      const userWatched = !!(up.completedAt) ||
        ((up.percent ?? 0) >= threshold && (up.engagementCount ?? 0) > 0);
      return {
        ...item,
        userPercent: up.percent ?? null,
        userPlayhead: up.playhead ?? null,
        userWatched,
        userEngaged: (up.engagementCount ?? 0) > 0,
        userCompletedAt: up.completedAt || null,
      };
    });
  }

  const pianoConfig = configService.getHouseholdAppConfig(null, 'piano') || {};
  const sequentialLabels = new Set(
    (pianoConfig.videos?.sequential_labels || []).map((l) => l.toLowerCase())
  );
  const isSequential = Array.isArray(playable.info?.labels) &&
    playable.info.labels.some((l) => sequentialLabels.has(String(l).toLowerCase()));

  logger.info?.('piano.courses.playable', { courseId, userId: userId || null, isSequential });
  res.json({ ...playable, isSequential });
}));
```

**Step 5: Run tests**

```bash
npx vitest run backend/src/4_api/v1/routers/piano.courses.test.mjs
```

Expected: All PASS.

**Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/piano.mjs backend/src/4_api/v1/routers/piano.courses.test.mjs
git commit -m "feat(piano): GET /piano/courses/:id/playable — user-keyed progress + isSequential"
```

---

### Task 4: Backend — `POST /api/v1/piano/users/:userId/video-log`

**Files:**
- Modify: `backend/src/4_api/v1/routers/piano.mjs`
- Modify: `backend/src/4_api/v1/routers/piano.courses.test.mjs` (add test cases)

**Step 1: Add tests to `piano.courses.test.mjs`**

```javascript
describe('POST /api/v1/piano/users/:userId/video-log', () => {
  it('stamps completedAt when percent >= threshold AND engaged', async () => {
    const res = await request(makeApp())
      .post(`/api/v1/piano/users/${MOCK_USER}/video-log`)
      .send({ plexId: '100', percent: 92, seconds: 480, duration: 520, engaged: true });
    expect(res.status).toBe(200);
    expect(res.body.completedAt).toBeTruthy();
    expect(res.body.engagementCount).toBe(1);
  });

  it('does NOT stamp completedAt when threshold met but NOT engaged', async () => {
    const res = await request(makeApp())
      .post(`/api/v1/piano/users/${MOCK_USER}/video-log`)
      .send({ plexId: '100', percent: 95, seconds: 494, duration: 520, engaged: false });
    expect(res.status).toBe(200);
    expect(res.body.completedAt).toBeFalsy();
    expect(res.body.engagementCount).toBe(0);
  });

  it('does NOT stamp completedAt when engaged but below threshold', async () => {
    const res = await request(makeApp())
      .post(`/api/v1/piano/users/${MOCK_USER}/video-log`)
      .send({ plexId: '100', percent: 50, seconds: 260, duration: 520, engaged: true });
    expect(res.status).toBe(200);
    expect(res.body.completedAt).toBeFalsy();
  });

  it('preserves existing completedAt on subsequent posts', async () => {
    const app = makeApp();
    await request(app)
      .post(`/api/v1/piano/users/${MOCK_USER}/video-log`)
      .send({ plexId: '200', percent: 92, seconds: 480, duration: 520, engaged: true });
    const res2 = await request(app)
      .post(`/api/v1/piano/users/${MOCK_USER}/video-log`)
      .send({ plexId: '200', percent: 10, seconds: 50, duration: 520, engaged: false });
    expect(res2.body.completedAt).toBeTruthy(); // preserved from first post
  });

  it('returns 400 for unknown user', async () => {
    const res = await request(makeApp())
      .post('/api/v1/piano/users/ghost/video-log')
      .send({ plexId: '100', percent: 92 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when plexId is missing', async () => {
    const res = await request(makeApp())
      .post(`/api/v1/piano/users/${MOCK_USER}/video-log`)
      .send({ percent: 92, seconds: 480 });
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run to verify fail**

```bash
npx vitest run backend/src/4_api/v1/routers/piano.courses.test.mjs
```

Expected: new tests FAIL.

**Step 3: Implement the route — add before `return router;`**

```javascript
// ── User video progress log ──────────────────────────────────────────────────
router.post('/users/:userId/video-log', asyncHandler(async (req, res) => {
  const dir = userPianoDir(req.params.userId);
  if (!dir) return res.status(400).json({ error: 'Invalid user' });

  const { plexId, percent, seconds, duration, engaged } = req.body || {};
  if (!plexId || percent === undefined) {
    return res.status(400).json({ error: 'Missing required fields: plexId, percent' });
  }

  const pianoConfig = configService.getHouseholdAppConfig(null, 'piano') || {};
  const threshold = pianoConfig.videos?.completion_threshold_percent ?? 90;

  const rawId = String(plexId).replace(/^plex:/, '');
  const key = `plex:${rawId}`;

  const progress = loadYaml(path.join(dir, 'video-progress')) || {};
  const existing = progress[key] || {};

  const newEngagementCount = (existing.engagementCount || 0) + (engaged ? 1 : 0);
  const normalizedPercent = Math.round(parseFloat(percent) || 0);
  const completedAt = existing.completedAt ||
    (normalizedPercent >= threshold && newEngagementCount > 0
      ? new Date().toISOString()
      : null);

  progress[key] = {
    ...existing,
    playhead: Math.round(parseFloat(seconds) || 0),
    percent: normalizedPercent,
    duration: Math.round(parseFloat(duration) || 0),
    lastPlayed: new Date().toISOString(),
    engagementCount: newEngagementCount,
    completedAt,
  };

  saveYaml(path.join(dir, 'video-progress'), progress);
  logger.info?.('piano.video-log.updated', {
    userId: req.params.userId,
    plexId: key,
    percent: normalizedPercent,
    engaged: !!engaged,
    completed: !!completedAt,
  });
  res.json(progress[key]);
}));
```

**Step 4: Run tests**

```bash
npx vitest run backend/src/4_api/v1/routers/piano.courses.test.mjs
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/piano.mjs backend/src/4_api/v1/routers/piano.courses.test.mjs
git commit -m "feat(piano): POST /piano/users/:userId/video-log — engagement-gated completion"
```

---

### Task 5: Frontend — `usePianoCoursePlayable` hook

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js`

**Step 1: Write the failing test**

```javascript
// usePianoCoursePlayable.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const api = vi.fn();
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

import { usePianoCoursePlayable } from './usePianoCoursePlayable.js';

beforeEach(() => api.mockReset());

describe('usePianoCoursePlayable', () => {
  it('calls piano endpoint when userId provided', async () => {
    api.mockResolvedValue({ items: [], info: {}, isSequential: false });
    const { result } = renderHook(() => usePianoCoursePlayable('12345', 'alice'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api).toHaveBeenCalledWith('api/v1/piano/courses/12345/playable?userId=alice');
  });

  it('falls back to fitness endpoint when no userId', async () => {
    api.mockResolvedValue({ items: [], info: {} });
    const { result } = renderHook(() => usePianoCoursePlayable('12345', null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api).toHaveBeenCalledWith('api/v1/fitness/show/12345/playable');
  });

  it('exposes isSequential from response', async () => {
    api.mockResolvedValue({ items: [], info: {}, isSequential: true });
    const { result } = renderHook(() => usePianoCoursePlayable('12345', 'alice'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isSequential).toBe(true);
  });

  it('exposes error state on fetch failure', async () => {
    api.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => usePianoCoursePlayable('12345', 'alice'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('network error');
  });
});
```

**Step 2: Run to verify fail**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js
```

Expected: FAIL — module doesn't exist.

**Step 3: Implement the hook**

```javascript
// usePianoCoursePlayable.js
import { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import getLogger from '../../../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-course-playable' });
  return _logger;
}

export function usePianoCoursePlayable(courseId, userId) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    if (!courseId) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    const url = userId
      ? `api/v1/piano/courses/${courseId}/playable?userId=${encodeURIComponent(userId)}`
      : `api/v1/fitness/show/${courseId}/playable`;

    DaylightAPI(url)
      .then((r) => {
        if (!cancelled) setState({ data: r || { items: [] }, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ data: null, loading: false, error: err.message });
        logger().warn('piano.course-playable.failed', { courseId, error: err.message });
      });
    return () => { cancelled = true; };
  }, [courseId, userId]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    items: state.data?.items ?? null,
    info: state.data?.info ?? {},
    parents: state.data?.parents ?? null,
    isSequential: state.data?.isSequential ?? false,
  };
}
```

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.js frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js
git commit -m "feat(piano): usePianoCoursePlayable — user-aware course data hook"
```

---

### Task 6: Frontend — `lectureUserStatus` + update `CourseDetail`

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/lectureMeta.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.jsx`

**Step 1: Add `lectureUserStatus` to `lectureMeta.js`**

After the existing `lectureStatus` function, add:

```javascript
/**
 * User-specific watch status — prefers userWatched/userPercent over Plex scrobble
 * when the item carries user-keyed fields from the piano courses endpoint.
 */
export function lectureUserStatus(item) {
  if (item?.userPercent != null || item?.userWatched != null) {
    const percent = Math.max(0, Math.min(100, Math.round(item.userPercent ?? 0)));
    return { watched: !!item.userWatched, percent };
  }
  return lectureStatus(item);
}
```

**Step 2: Rewrite `CourseDetail.jsx`**

```jsx
import { useMemo, useState, useRef, useEffect } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { lectureUserStatus } from './lectureMeta.js';
import { usePianoCoursePlayable } from './usePianoCoursePlayable.js';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import { usePianoUser } from '../../PianoUserContext.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

export default function CourseDetail({ course, onPlay }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-video-detail' }), []);
  const { currentUser } = usePianoUser();
  const courseId = idOf(course?.id);
  const { items, info, parents, isSequential, loading, error } = usePianoCoursePlayable(courseId, currentUser);

  // Sequential: compute locked episode IDs (same algorithm as FitnessShow)
  const lockedIds = useMemo(() => {
    if (!isSequential || !items) return new Set();
    const parentMap = parents || {};
    const parentIndex = (parentId) => (parentMap[String(parentId)]?.index ?? 0);
    const sorted = [...items].sort((a, b) => {
      const si = parentIndex(a.parentId) - parentIndex(b.parentId);
      if (si !== 0) return si;
      return (a.itemIndex ?? Infinity) - (b.itemIndex ?? Infinity);
    });
    const locked = new Set();
    let gateClosed = false;
    for (const ep of sorted) {
      if (gateClosed) locked.add(ep.plex || ep.id);
      if (!gateClosed && !lectureUserStatus(ep).watched) gateClosed = true;
    }
    return locked;
  }, [isSequential, items, parents]);

  // Season unlock ceremony
  const [unlockedToast, setUnlockedToast] = useState(null);
  const prevCompleteRef = useRef(null);
  useEffect(() => {
    if (!isSequential || !items || !parents) return;
    const parentMap = parents || {};
    const sortedSeasonIds = Object.keys(parentMap).sort(
      (a, b) => (parentMap[a]?.index ?? 0) - (parentMap[b]?.index ?? 0)
    );
    const completeNow = new Set(
      sortedSeasonIds.filter((sid) => {
        const eps = items.filter((ep) => String(ep.parentId) === String(sid));
        return eps.length > 0 && eps.every((ep) => lectureUserStatus(ep).watched);
      })
    );
    const prev = prevCompleteRef.current;
    if (prev !== null) {
      for (const sid of [...completeNow]) {
        if (!prev.has(sid)) {
          const idx = sortedSeasonIds.indexOf(String(sid));
          const nextSid = sortedSeasonIds[idx + 1];
          const nextSeason = nextSid ? parentMap[nextSid] : null;
          if (nextSeason) {
            const name = nextSeason.title || `Season ${nextSeason.index || ''}`;
            setUnlockedToast(name);
            playUnlockChime();
            setTimeout(() => setUnlockedToast(null), 4000);
          }
        }
      }
    }
    prevCompleteRef.current = completeNow;
  }, [isSequential, items, parents]);

  const poster = info?.image || course?.image;
  const title = course?.title || info?.title || 'Course';
  usePianoBreadcrumb(useMemo(() => [{ label: title }], [title]));

  return (
    <section className="piano-mode--videos piano-course">
      <div className="piano-course__content">
        <aside className="piano-course__info">
          {poster && <img className="piano-course__poster" src={poster} alt="" />}
          <h2 className="piano-course__title">{title}</h2>
          {items?.length > 0 && <div className="piano-course__count">{items.length} lectures</div>}
          {info?.summary && <p className="piano-course__summary">{info.summary}</p>}
          {isSequential && <span className="piano-course__badge">Sequential</span>}
        </aside>
        <div className="piano-course__episodes">
          {loading && <PianoEmpty loading />}
          {!loading && items?.length === 0 && <PianoEmpty message={error || 'No lectures found.'} />}
          {!loading && items?.length > 0 && (
            <ul className="piano-episodes">
              {items.map((item) => {
                const st = lectureUserStatus(item);
                const img = item.image || item.thumbnail;
                const isLocked = lockedIds.has(item.plex || item.id);
                return (
                  <li key={item.plex || item.id}>
                    <button
                      type="button"
                      className={`piano-episode${isLocked ? ' piano-episode--locked' : ''}`}
                      onClick={() => !isLocked && onPlay(item)}
                      disabled={isLocked}
                      aria-disabled={isLocked}
                    >
                      <div className="piano-episode__thumb">
                        {img && <img src={img} alt="" loading="eager" decoding="async" />}
                        {isLocked && <span className="piano-episode__lock" aria-label="Locked">🔒</span>}
                        {!isLocked && st.watched && <span className="piano-episode__check" aria-label="Watched">✓</span>}
                        {!isLocked && !st.watched && st.percent > 0 && (
                          <span className="piano-episode__bar"><span style={{ width: `${st.percent}%` }} /></span>
                        )}
                      </div>
                      <div className="piano-episode__label">
                        {item.itemIndex != null && <span className="piano-episode__num">E{item.itemIndex}</span>}
                        <span className="piano-episode__title">{item.label || item.title}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {unlockedToast && (
        <div className="piano-course__unlock-toast" role="status">
          🎉 {unlockedToast} unlocked!
        </div>
      )}
    </section>
  );
}

function playUnlockChime() {
  try {
    const ctx = new AudioContext();
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.6);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.6);
    });
    setTimeout(() => ctx.close(), 2000);
  } catch { /* AudioContext unavailable in test/SSR */ }
}
```

**Step 3: Run existing tests (ensure nothing broken)**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/
```

Expected: All pre-existing tests PASS.

**Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/lectureMeta.js
git commit -m "feat(piano): CourseDetail — per-user locks, sequential badges, season unlock ceremony"
```

---

### Task 7: Frontend — `useEngagementGate` hook

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/useEngagementGate.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/useEngagementGate.test.js`

**Step 1: Write the failing test**

```javascript
// useEngagementGate.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.useFakeTimers();

const mockActiveNotes = { current: new Map() };
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ activeNotes: mockActiveNotes.current }),
}));

import { useEngagementGate } from './useEngagementGate.js';

beforeEach(() => { mockActiveNotes.current = new Map(); });

describe('useEngagementGate', () => {
  it('does not open gate when isSequential is false', () => {
    const mediaEl = { pause: vi.fn(), play: vi.fn(), paused: false };
    const { result } = renderHook(() =>
      useEngagementGate({ mediaEl, isSequential: false, timeoutSeconds: 2 })
    );
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.gateOpen).toBe(false);
    expect(mediaEl.pause).not.toHaveBeenCalled();
  });

  it('opens gate and pauses video after inactivity timeout', () => {
    const mediaEl = { pause: vi.fn(), play: vi.fn(), paused: false };
    const { result } = renderHook(() =>
      useEngagementGate({ mediaEl, isSequential: true, timeoutSeconds: 2 })
    );
    act(() => { vi.advanceTimersByTime(2100); });
    expect(result.current.gateOpen).toBe(true);
    expect(mediaEl.pause).toHaveBeenCalled();
  });

  it('dismissGate resumes video, resets gate, and calls onEngagementConfirmed', () => {
    const mediaEl = { pause: vi.fn(), play: vi.fn(), paused: true };
    const onConfirmed = vi.fn();
    const { result } = renderHook(() =>
      useEngagementGate({ mediaEl, isSequential: true, timeoutSeconds: 2, onEngagementConfirmed: onConfirmed })
    );
    act(() => { vi.advanceTimersByTime(2100); });
    expect(result.current.gateOpen).toBe(true);
    act(() => { result.current.dismissGate(); });
    expect(result.current.gateOpen).toBe(false);
    expect(mediaEl.play).toHaveBeenCalled();
    expect(onConfirmed).toHaveBeenCalled();
  });

  it('does not open gate while video is already paused', () => {
    const mediaEl = { pause: vi.fn(), play: vi.fn(), paused: true };
    const { result } = renderHook(() =>
      useEngagementGate({ mediaEl, isSequential: true, timeoutSeconds: 2 })
    );
    act(() => { vi.advanceTimersByTime(2100); });
    expect(result.current.gateOpen).toBe(false);
  });
});
```

**Step 2: Run to verify fail**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/useEngagementGate.test.js
```

**Step 3: Implement the hook**

```javascript
// useEngagementGate.js
import { useState, useEffect, useRef, useCallback } from 'react';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import getLogger from '../../../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-engagement-gate' });
  return _logger;
}

export function useEngagementGate({ mediaEl, isSequential, timeoutSeconds = 90, onEngagementConfirmed }) {
  const [gateOpen, setGateOpen] = useState(false);
  const { activeNotes } = usePianoMidi();
  const lastActivityRef = useRef(Date.now());
  const gateOpenRef = useRef(false);

  // Reset activity timer whenever MIDI notes are detected
  useEffect(() => {
    if (!isSequential) return;
    if (activeNotes && activeNotes.size > 0) {
      lastActivityRef.current = Date.now();
    }
  }, [activeNotes, isSequential]);

  // Poll once per second; open gate when idle too long and video is playing
  useEffect(() => {
    if (!isSequential || !mediaEl) return;
    const id = setInterval(() => {
      if (gateOpenRef.current || mediaEl.paused) return;
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= timeoutSeconds * 1000) {
        gateOpenRef.current = true;
        setGateOpen(true);
        try { mediaEl.pause(); } catch { /* element may be detached */ }
        logger().info('piano.engagement-gate.open', { idleMs });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [isSequential, mediaEl, timeoutSeconds]);

  const dismissGate = useCallback(() => {
    gateOpenRef.current = false;
    setGateOpen(false);
    lastActivityRef.current = Date.now();
    if (mediaEl && mediaEl.paused) {
      try { mediaEl.play(); } catch { /* autoplay policy */ }
    }
    logger().info('piano.engagement-gate.dismissed');
    onEngagementConfirmed?.();
  }, [mediaEl, onEngagementConfirmed]);

  return { gateOpen, dismissGate };
}
```

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/useEngagementGate.test.js
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/useEngagementGate.js frontend/src/modules/Piano/PianoKiosk/modes/Videos/useEngagementGate.test.js
git commit -m "feat(piano): useEngagementGate — MIDI inactivity gate for sequential lectures"
```

---

### Task 8: Frontend — `EngagementGate` overlay component

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/EngagementGate.jsx`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/EngagementGate.test.jsx`

**Step 1: Write the failing test**

```javascript
// EngagementGate.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const mockActiveNotes = { current: new Map() };
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ activeNotes: mockActiveNotes.current }),
}));

const mockEvaluate = vi.fn().mockReturnValue('idle');
vi.mock('../../../PianoFlashcards/flashcardEngine.js', () => ({
  generateCardPitches: () => [60],
  evaluateMatch: (...args) => mockEvaluate(...args),
}));

import EngagementGate from './EngagementGate.jsx';

beforeEach(() => {
  mockActiveNotes.current = new Map();
  mockEvaluate.mockReturnValue('idle');
});

describe('EngagementGate', () => {
  it('renders nothing when open is false', () => {
    render(<EngagementGate open={false} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('engagement-gate')).toBeFalsy();
  });

  it('renders the prompt dialog when open is true', () => {
    render(<EngagementGate open={true} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('engagement-gate')).toBeTruthy();
    expect(screen.getByText(/play this note/i)).toBeTruthy();
  });

  it('calls onDismiss when correct note is played', () => {
    mockEvaluate.mockReturnValue('correct');
    const onDismiss = vi.fn();
    render(<EngagementGate open={true} onDismiss={onDismiss} />);
    expect(onDismiss).toHaveBeenCalled();
  });

  it('does not call onDismiss when note is wrong', () => {
    mockEvaluate.mockReturnValue('wrong');
    const onDismiss = vi.fn();
    render(<EngagementGate open={true} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run to verify fail**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/EngagementGate.test.jsx
```

**Step 3: Implement the component**

```jsx
// EngagementGate.jsx
import { useMemo, useEffect } from 'react';
import { usePianoMidi } from '../../PianoMidiContext.jsx';
import { generateCardPitches, evaluateMatch } from '../../../PianoFlashcards/flashcardEngine.js';
import getLogger from '../../../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-engagement-gate' });
  return _logger;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiToName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

export default function EngagementGate({ open, onDismiss }) {
  const { activeNotes } = usePianoMidi();

  // Pick a random single note each time the gate opens (memo key: open)
  const targetPitches = useMemo(
    () => (open ? generateCardPitches([48, 72], 'single', false) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open]
  );

  useEffect(() => {
    if (!open || !targetPitches.length) return;
    const result = evaluateMatch(activeNotes, targetPitches);
    if (result === 'correct') {
      logger().info('piano.engagement-gate.correct');
      onDismiss?.();
    }
  }, [open, activeNotes, targetPitches, onDismiss]);

  if (!open) return null;

  return (
    <div
      className="piano-engagement-gate"
      data-testid="engagement-gate"
      role="dialog"
      aria-modal="true"
      aria-label="Play along to continue"
    >
      <div className="piano-engagement-gate__content">
        <p className="piano-engagement-gate__prompt">Still there? Play this note to continue:</p>
        <p className="piano-engagement-gate__target">{targetPitches.map(midiToName).join(' + ')}</p>
      </div>
    </div>
  );
}
```

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/EngagementGate.test.jsx
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/EngagementGate.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/EngagementGate.test.jsx
git commit -m "feat(piano): EngagementGate — in-place chord prompt overlay for sequential video"
```

---

### Task 9: Frontend — sequential restrictions in `PianoVideoChrome`

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx`

**Step 1: Add failing tests to `PianoVideoChrome.test.jsx`**

```javascript
// Add these describe blocks to the existing test file

describe('sequential mode restrictions', () => {
  const baseProps = {
    isPlaying: false, currentTime: 60, duration: 600, rate: 1, loop: {},
    playAlong: false,
    onToggle: vi.fn(), onSkip: vi.fn(), onCycleRate: vi.fn(),
    onMarkA: vi.fn(), onMarkB: vi.fn(), onToggleLoop: vi.fn(),
    onClearLoop: vi.fn(), onSeek: vi.fn(), onTogglePlayAlong: vi.fn(),
  };

  it('hides rate button when isSequential', () => {
    render(<PianoVideoChrome {...baseProps} isSequential furthestWatched={60} />);
    expect(screen.queryByLabelText('Playback speed')).toBeFalsy();
  });

  it('shows rate button when NOT sequential', () => {
    render(<PianoVideoChrome {...baseProps} isSequential={false} furthestWatched={60} />);
    expect(screen.getByLabelText('Playback speed')).toBeTruthy();
  });

  it('disables forward skip buttons when currentTime is at furthestWatched', () => {
    render(<PianoVideoChrome {...baseProps} isSequential furthestWatched={60} />);
    expect(screen.getByLabelText('Forward 15 seconds')).toBeDisabled();
    expect(screen.getByLabelText('Forward 30 seconds')).toBeDisabled();
  });

  it('enables forward skip when current time is behind furthestWatched', () => {
    render(<PianoVideoChrome {...baseProps} isSequential currentTime={30} furthestWatched={60} />);
    expect(screen.getByLabelText('Forward 15 seconds')).not.toBeDisabled();
    expect(screen.getByLabelText('Forward 30 seconds')).not.toBeDisabled();
  });

  it('backward skip is always enabled in sequential mode', () => {
    render(<PianoVideoChrome {...baseProps} isSequential currentTime={60} furthestWatched={60} />);
    expect(screen.getByLabelText('Back 15 seconds')).not.toBeDisabled();
    expect(screen.getByLabelText('Back 30 seconds')).not.toBeDisabled();
  });
});
```

**Step 2: Run to verify fail**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
```

**Step 3: Update `PianoVideoChrome.jsx`**

Add `isSequential` and `furthestWatched` to the props signature and use them:

```jsx
export default function PianoVideoChrome({
  isPlaying, currentTime, duration, rate, loop, playAlong,
  onToggle, onSkip, onCycleRate, onMarkA, onMarkB, onToggleLoop, onClearLoop, onSeek, onTogglePlayAlong,
  isSequential = false,
  furthestWatched = 0,
}) {
  // ... keep all existing variable declarations ...

  // Sequential: forward skip disabled when at/past furthest reached position
  const forwardDisabled = isSequential && currentTime >= furthestWatched - 1;

  // Sequential: seek is clamped to furthestWatched (can't seek forward past it)
  const seekFromEvent = (e) => {
    const el = barRef.current; if (!el || !dur) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX ?? 0) - rect.left;
    const pos = Math.max(0, Math.min(dur, (x / rect.width) * dur));
    onSeek(isSequential ? Math.min(pos, furthestWatched) : pos);
  };

  // ... rest of existing code ...

  return (
    <div className="piano-video-chrome" data-testid="piano-video-chrome">
      <div className="piano-video-chrome__bar" ref={barRef} onPointerDown={seekFromEvent}>
        {/* ... existing progress/mark spans ... */}
      </div>
      <div className="piano-video-chrome__row">
        {/* ... time display and spacer ... */}
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(-30)} aria-label="Back 30 seconds"><Icon name="skip-back-30" /> 30</button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(-15)} aria-label="Back 15 seconds"><Icon name="skip-back-15" /> 15</button>
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--play" onClick={onToggle} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Icon name="pause" /> : <Icon name="play" />}</button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(15)} disabled={forwardDisabled} aria-label="Forward 15 seconds"><Icon name="skip-forward-15" /> 15</button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(30)} disabled={forwardDisabled} aria-label="Forward 30 seconds"><Icon name="skip-forward-30" /> 30</button>
        {/* ... spacer ... */}
        {!isSequential && (
          <button type="button" className="piano-video-chrome__btn" onClick={onCycleRate} aria-label="Playback speed">{rate}×</button>
        )}
        {/* ... A/B loop buttons, MixControls, play-along button unchanged ... */}
      </div>
    </div>
  );
}
```

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
```

Expected: All PASS (new + existing).

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
git commit -m "feat(piano): PianoVideoChrome — disable forward skip + rate in sequential mode"
```

---

### Task 10: Frontend — wire everything into `PianoVideoPlayer` + update `Videos.jsx`

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoWatchLog.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/watchLog.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.jsx`

**Step 1: Update `watchLog.js` to accept `userId` and `engaged`**

```javascript
export function buildWatchLogPayload({ contentId, title, seconds, duration, reason, userId, engaged }) {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const d = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const percent = d ? Math.round((s / d) * 100) : 0;
  const naturalEnd = d > 0 && s >= d * 0.98;
  return {
    title: title || '',
    type: 'plex',
    assetId: contentId,
    seconds: Math.round(s),
    percent,
    status: naturalEnd ? 'completed' : (s > 0 ? 'in_progress' : 'none'),
    naturalEnd,
    duration: Math.round(d),
    reason: reason || 'progress',
    // User-keyed fields (only included when provided)
    ...(userId ? { userId } : {}),
    ...(engaged !== undefined ? { engaged } : {}),
  };
}
```

**Step 2: Update `usePianoWatchLog` to post to user endpoint when `userId` provided**

```javascript
// usePianoWatchLog.js — add userId and engagedRef params
export default function usePianoWatchLog({ mediaEl, contentId, title, resumeSeconds, userId, engagedRef }) {
  // ... (keep existing resume logic unchanged) ...

  useEffect(() => {
    if (!mediaEl || !contentId) return undefined;
    const post = (reason) => {
      if (!(mediaEl.currentTime >= 10)) return;
      const engaged = engagedRef?.current || false;

      if (userId) {
        // Post to user-keyed piano endpoint
        const rawId = String(contentId).replace(/^plex:/, '');
        const payload = {
          plexId: rawId,
          percent: mediaEl.duration > 0
            ? Math.round((mediaEl.currentTime / mediaEl.duration) * 100)
            : 0,
          seconds: Math.round(mediaEl.currentTime),
          duration: Math.round(mediaEl.duration || 0),
          engaged,
        };
        DaylightAPI(`api/v1/piano/users/${encodeURIComponent(userId)}/video-log`, payload)
          .then(() => logger.current.debug('piano.video.user-log-ok', { reason }))
          .catch((err) => logger.current.warn('piano.video.user-log-fail', { reason, error: err.message }));
      } else {
        // Fallback: device-level log (existing behavior)
        const payload = buildWatchLogPayload({ contentId, title, seconds: mediaEl.currentTime, duration: mediaEl.duration, reason });
        DaylightAPI('api/v1/play/log', payload)
          .then(() => logger.current.debug('piano.video.log-ok', { reason }))
          .catch((err) => logger.current.warn('piano.video.log-fail', { reason, error: err.message }));
      }
    };
    const id = setInterval(() => { if (!mediaEl.paused) post('progress'); }, LOG_INTERVAL_MS);
    return () => { clearInterval(id); post('close'); };
  }, [mediaEl, contentId, title, userId, engagedRef]);
}
```

**Step 3: Update `PianoVideoPlayer.jsx` — add `isSequential` prop, wire gate and logger**

Add these imports:
```javascript
import EngagementGate from './EngagementGate.jsx';
import { useEngagementGate } from './useEngagementGate.js';
import { usePianoUser } from '../../PianoUserContext.jsx';
```

In the component body, add:
```javascript
// Accept isSequential prop (passed from LecturePlayerRoute)
// Props signature: export default function PianoVideoPlayer({ lecture, source, onBack, isSequential = false })

const { currentUser } = usePianoUser();
const engagedRef = useRef(false);
const [furthestWatched, setFurthestWatched] = useState(resumeSeconds || 0);

// Wire engagement gate
const { gateOpen, dismissGate } = useEngagementGate({
  mediaEl,
  isSequential,
  timeoutSeconds: 90,
  onEngagementConfirmed: () => { engagedRef.current = true; },
});

// Replace existing usePianoWatchLog call:
usePianoWatchLog({ mediaEl, contentId, title, resumeSeconds, userId: currentUser, engagedRef });
```

In the `timeupdate` handler inside the `useEffect`, track furthest watched:
```javascript
const onTime = () => {
  const t = mediaEl.currentTime || 0;
  setCurrentTime(t);
  setFurthestWatched((prev) => Math.max(prev, t));
};
```

In the JSX, add the EngagementGate inside `piano-video-player__video`:
```jsx
<div className="piano-video-player__video" ref={videoWrapRef} onClick={toggleFullscreen} style={{ position: 'relative' }}>
  {playerEl}
  {gateOpen && <EngagementGate open={gateOpen} onDismiss={dismissGate} />}
</div>
```

Pass new props to `PianoVideoChrome`:
```jsx
<PianoVideoChrome
  // ... existing props ...
  isSequential={isSequential}
  furthestWatched={furthestWatched}
/>
```

**Step 4: Update `Videos.jsx` — `LecturePlayerRoute` uses `usePianoCoursePlayable`**

```javascript
import { usePianoCoursePlayable } from './usePianoCoursePlayable.js';
import { usePianoUser } from '../../PianoUserContext.jsx';

function LecturePlayerRoute() {
  const { courseId, lectureId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = usePianoUser();
  const { items, info, isSequential } = usePianoCoursePlayable(idOf(courseId), currentUser);
  const source = info?.title || '';
  const lecture = useMemo(
    () => (items || []).find((l) => String(lectureContentId(l)) === String(lectureId)) || null,
    [items, lectureId],
  );
  const goBack = useCallback(() => navigate('..', { relative: 'path' }), [navigate]);
  useKeepScreenAwake('video', true);

  if (items === null) return <div className="piano-mode__placeholder">Loading…</div>;
  if (!lecture) {
    return (
      <div className="piano-mode__placeholder">
        This lecture can't be played.{' '}
        <button type="button" onClick={goBack}>Back</button>
      </div>
    );
  }
  return <PianoVideoPlayer lecture={lecture} source={source} onBack={goBack} isSequential={isSequential} />;
}
```

**Step 5: Run all video tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/
```

Expected: All PASS.

**Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoWatchLog.js frontend/src/modules/Piano/PianoKiosk/modes/Videos/watchLog.js frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.jsx
git commit -m "feat(piano): wire engagement gate, sequential skip/seek, and user progress logging"
```

---

### Task 11: CSS — engagement gate and sequential UI styles

**Files:**
- Find the existing Videos SCSS file:
  ```bash
  find frontend/src/modules/Piano/PianoKiosk/modes/Videos -name "*.scss"
  ```
- Modify that file (or create `Videos.scss` if none exists)

**Step 1: Add styles**

```scss
// Engagement gate — overlays on paused video, no unmount needed
.piano-engagement-gate {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.88);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;

  &__content {
    text-align: center;
    color: #fff;
    padding: 2rem;
  }

  &__prompt {
    font-size: 1.1rem;
    opacity: 0.8;
    margin-bottom: 0.75rem;
  }

  &__target {
    font-size: 3.5rem;
    font-weight: 700;
    letter-spacing: 0.08em;
  }
}

// Sequential badge on course info panel
.piano-course__badge {
  display: inline-block;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 0.25rem;
  padding: 0.2em 0.5em;
  margin-top: 0.5rem;
}

// Locked episode card
.piano-episode--locked {
  opacity: 0.45;
  cursor: not-allowed;

  .piano-episode__thumb {
    position: relative;
  }
}

.piano-episode__lock {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 1.5rem;
  pointer-events: none;
}

// Season unlock toast
.piano-course__unlock-toast {
  position: fixed;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  background: #2a9;
  color: #fff;
  padding: 0.7rem 1.4rem;
  border-radius: 2rem;
  font-size: 1rem;
  z-index: 200;
  pointer-events: none;
  white-space: nowrap;
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/
git commit -m "feat(piano): CSS for engagement gate, locked episodes, sequential badge, unlock toast"
```

---

## Summary Table

| # | What | Key Files |
|---|------|-----------|
| 1 | Piano config: `sequential_labels`, `engagement_timeout_seconds`, `completion_threshold_percent` | `data/.../piano/config.yml` |
| 2 | Inject `fitnessPlayableService` into piano router | `app.mjs`, `piano.mjs` |
| 3 | `GET /piano/courses/:id/playable?userId=` | `piano.mjs`, `piano.courses.test.mjs` |
| 4 | `POST /piano/users/:userId/video-log` | `piano.mjs`, `piano.courses.test.mjs` |
| 5 | `usePianoCoursePlayable` hook | new file + test |
| 6 | `lectureUserStatus` + `CourseDetail` rewrite | `lectureMeta.js`, `CourseDetail.jsx` |
| 7 | `useEngagementGate` hook | new file + test |
| 8 | `EngagementGate` overlay component | new file + test |
| 9 | Sequential skip/rate restrictions in `PianoVideoChrome` | `PianoVideoChrome.jsx` + test |
| 10 | Wire all parts into `PianoVideoPlayer` + `Videos.jsx` | `PianoVideoPlayer.jsx`, `usePianoWatchLog.js`, `watchLog.js`, `Videos.jsx` |
| 11 | CSS for new UI elements | Videos SCSS |
