# Piano Co-Progress Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a co-progress lock that prevents one student from getting more than N episodes ahead of their partner in a sequential piano course, plus disable video transport controls while the engagement gate overlay is open.

**Architecture:** Backend computes the lock server-side (reads both users' `UserVideoProgressStore` progress, returns a `coProgressLock` object alongside the existing playable response). Frontend reads the flag in `usePianoCoursePlayable`, `CourseDetail` renders a two-person icon and toast instead of the standard lock/play, and `PianoVideoChrome` disables all transport buttons when `gateOpen` is true.

**Tech Stack:** Node.js/Express (backend), React hooks + vitest + @testing-library/react (frontend)

---

## File Map

| File | Change |
|------|--------|
| `backend/src/4_api/v1/routers/piano.mjs` | Add co-progress computation block after `isSequential`, append `coProgressLock` to response |
| `backend/src/4_api/v1/routers/piano.courses.test.mjs` | Add `makeAppWith` helper + co-progress lock test suite |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.js` | Expose `coProgressLock` from hook return |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js` | Add two tests for `coProgressLock` passthrough |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.jsx` | Add co-progress lock logic + two-person icon + toast |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.test.jsx` | Add co-progress lock test suite |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx` | Accept `gateOpen` prop, disable all controls when true |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx` | Pass `gateOpen` to `PianoVideoChrome` |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx` | Add `gateOpen` transport-lock test suite |

---

## Task 1: Backend — Co-Progress Computation

**Files:**
- Modify: `backend/src/4_api/v1/routers/piano.mjs`
- Modify: `backend/src/4_api/v1/routers/piano.courses.test.mjs`

---

- [ ] **Step 1: Write failing tests for co-progress lock**

Add `makeAppWith` helper and the `co-progress lock` describe block at the bottom of `backend/src/4_api/v1/routers/piano.courses.test.mjs`, just before the final `});` that closes the outer describe:

```javascript
// ── Co-progress lock helpers ────────────────────────────────────────────────
const PARTNER_USER = 'partner-user';

const items6 = Array.from({ length: 6 }, (_, i) => ({
  plex: String(100 + i), label: `Lesson ${i + 1}`, itemIndex: i + 1,
  parentId: '10', isWatched: false, watchProgress: 0,
}));

function makePartnerStore(userWatched) {
  return {
    isKnownUser: (id) => id === MOCK_USER || id === PARTNER_USER,
    enrich: (items, userId) => {
      const watchedIds = new Set(userWatched[userId] || []);
      return items.map((it) => ({
        ...it,
        userWatched: watchedIds.has(it.plex),
        userPercent: watchedIds.has(it.plex) ? 92 : null,
        userPlayhead: watchedIds.has(it.plex) ? 480 : null,
        userEngaged: watchedIds.has(it.plex),
        userCompletedAt: watchedIds.has(it.plex) ? '2026-06-26T00:00:00Z' : null,
      }));
    },
  };
}

const coProgressConfig = {
  users: { primary: [MOCK_USER, PARTNER_USER] },
  videos: {
    sequential_labels: ['sequential'],
    co_progress: [{ courseId: `plex:${MOCK_SHOW}`, users: [MOCK_USER, PARTNER_USER], buffer: 5 }],
  },
};

const makeAppWith = ({ config, store, items } = {}) => {
  const configSvc = config
    ? { ...mockConfigService, getHouseholdAppConfig: () => config }
    : mockConfigService;
  const svc = items
    ? {
        getPlayableEpisodes: vi.fn().mockResolvedValue({
          compoundId: `plex:${MOCK_SHOW}`,
          showId: MOCK_SHOW,
          items,
          parents: { '10': { index: 1, title: 'Season 1', thumbnail: null } },
          info: { title: 'Piano Course', labels: ['sequential'], type: 'show' },
          containerItem: null,
        }),
      }
    : mockPlayableService;
  const app = express();
  app.use(express.json());
  app.use('/api/v1/piano', createPianoRouter({
    configService: configSvc,
    fitnessPlayableService: svc,
    userVideoProgressStore: store || mockStore,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  return app;
};

describe('co-progress lock', () => {
  it('returns coProgressLock: null when no co_progress config exists', async () => {
    const res = await request(makeApp())
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=${MOCK_USER}`);
    expect(res.status).toBe(200);
    expect(res.body.coProgressLock).toBeNull();
  });

  it('returns coProgressLock: null when the gap is below the buffer (4 < 5)', async () => {
    const store = makePartnerStore({ [MOCK_USER]: ['100', '101', '102', '103'], [PARTNER_USER]: [] });
    const res = await request(makeAppWith({ config: coProgressConfig, store, items: items6 }))
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=${MOCK_USER}`);
    expect(res.status).toBe(200);
    expect(res.body.coProgressLock).toBeNull();
  });

  it('locks when the requesting user is ahead by exactly buffer episodes', async () => {
    const store = makePartnerStore({
      [MOCK_USER]: ['100', '101', '102', '103', '104'],
      [PARTNER_USER]: [],
    });
    const res = await request(makeAppWith({ config: coProgressConfig, store, items: items6 }))
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=${MOCK_USER}`);
    expect(res.status).toBe(200);
    expect(res.body.coProgressLock).toEqual({
      locked: true,
      aheadBy: 5,
      waitingForId: PARTNER_USER,
      buffer: 5,
    });
  });

  it('does not lock guest users (guest is always exempt)', async () => {
    const store = makePartnerStore({ guest: ['100', '101', '102', '103', '104'] });
    const res = await request(makeAppWith({ config: coProgressConfig, store, items: items6 }))
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=guest`);
    expect(res.status).toBe(200);
    expect(res.body.coProgressLock).toBeNull();
  });

  it('does not lock for a non-sequential course even with a matching rule', async () => {
    const nonSeqConfig = {
      ...coProgressConfig,
      videos: { ...coProgressConfig.videos, sequential_labels: [] },
    };
    const store = makePartnerStore({ [MOCK_USER]: ['100', '101', '102', '103', '104'] });
    const res = await request(makeAppWith({ config: nonSeqConfig, store, items: items6 }))
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=${MOCK_USER}`);
    expect(res.status).toBe(200);
    expect(res.body.coProgressLock).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail with the right error**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/piano.courses.test.mjs 2>&1 | tail -30
```

Expected: `co-progress lock` tests fail with `expect(received).toBeNull()` or similar — `coProgressLock` is missing from the response entirely.

- [ ] **Step 3: Implement co-progress computation in piano.mjs**

In `backend/src/4_api/v1/routers/piano.mjs`, locate the block that ends with:
```javascript
const isSequential = Array.isArray(playable.info?.labels) &&
  playable.info.labels.some((l) => sequentialLabels.has(String(l).toLowerCase()));

logger.info?.('piano.courses.playable', { courseId, userId: userId || null, isSequential });
res.json({ ...playable, isSequential });
```

Replace the `logger.info` and `res.json` lines with:

```javascript
    // Co-progress lock: in sequential courses with a configured user pair, block the
    // ahead user from the next episode until the gap falls below the buffer.
    let coProgressLock = null;
    if (isSequential && userId && !isGuest && userVideoProgressStore) {
      const rules = pianoConfig.videos?.co_progress || [];
      const compoundId = playable.compoundId || `plex:${courseId}`;
      const rule = rules.find(
        (r) => r.courseId === compoundId &&
               Array.isArray(r.users) &&
               r.users.includes(userId),
      );
      if (rule) {
        const myCount = (playable.items || []).filter((it) => it.userWatched).length;
        const partnerIds = rule.users.filter((u) => u !== userId);
        const partnerCounts = partnerIds.map((pid) => {
          if (!userVideoProgressStore.isKnownUser(pid)) return 0;
          const enriched = userVideoProgressStore.enrich(playable.items || [], pid);
          return enriched.filter((it) => it.userWatched).length;
        });
        if (partnerCounts.length) {
          const minPartnerCount = Math.min(...partnerCounts);
          const aheadBy = myCount - minPartnerCount;
          if (aheadBy >= rule.buffer) {
            const slowestIndex = partnerCounts.indexOf(minPartnerCount);
            coProgressLock = {
              locked: true,
              aheadBy,
              waitingForId: partnerIds[slowestIndex],
              buffer: rule.buffer,
            };
          }
        }
      }
    }

    logger.info?.('piano.courses.playable', { courseId, userId: userId || null, isSequential });
    res.json({ ...playable, isSequential, coProgressLock });
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/piano.courses.test.mjs 2>&1 | tail -20
```

Expected: All tests pass, including all 5 new `co-progress lock` tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/piano.mjs backend/src/4_api/v1/routers/piano.courses.test.mjs
git commit -m "feat(piano): compute co-progress lock in courses/playable endpoint"
```

---

## Task 2: Frontend — Hook + CourseDetail Co-Progress UI

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.test.jsx`

---

- [ ] **Step 1: Write failing tests for hook coProgressLock passthrough**

Add to `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js`, inside the existing `describe('usePianoCoursePlayable', ...)` block:

```javascript
  it('exposes coProgressLock from response', async () => {
    const lock = { locked: true, aheadBy: 5, waitingForId: 'felix', buffer: 5 };
    api.mockResolvedValue({ items: [], info: {}, isSequential: true, coProgressLock: lock });
    const { result } = renderHook(() => usePianoCoursePlayable('12345', 'milo'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.coProgressLock).toEqual(lock);
  });

  it('exposes coProgressLock: null when not present in response', async () => {
    api.mockResolvedValue({ items: [], info: {}, isSequential: true });
    const { result } = renderHook(() => usePianoCoursePlayable('12345', 'milo'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.coProgressLock).toBeNull();
  });
```

- [ ] **Step 2: Write failing tests for CourseDetail co-progress UI**

The existing mock in `CourseDetail.test.jsx` for `usePianoUser` only returns `{ currentUser, currentProfile }` — update it to also include `users`, and add `coProgressLock: null` to `baseHook`. Then add a new describe block.

Replace the top section of `CourseDetail.test.jsx` (everything before `import CourseDetail`) with:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let hookReturn;
vi.mock('./usePianoCoursePlayable.js', () => ({ usePianoCoursePlayable: () => hookReturn }));
vi.mock('../../PianoUserContext.jsx', () => ({
  usePianoUser: () => ({
    currentUser: 'milo',
    currentProfile: { name: 'Milo' },
    users: [
      { id: 'milo', name: 'Milo' },
      { id: 'felix', name: 'Felix' },
    ],
  }),
}));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));
vi.mock('../../PianoEmpty.jsx', () => ({ default: ({ loading, message }) => <div data-testid="empty">{loading ? 'loading' : message}</div> }));
```

Change `baseHook` to include `coProgressLock: null`:

```javascript
const baseHook = { items: null, info: {}, parents: null, isSequential: false, loading: false, error: null, coProgressLock: null };
```

Add this new describe block at the end of the file:

```javascript
describe('co-progress lock', () => {
  it('shows the two-person icon on the co-progress-locked episode, not the standard lock', () => {
    hookReturn = {
      ...baseHook,
      isSequential: true,
      coProgressLock: { locked: true, aheadBy: 5, waitingForId: 'felix', buffer: 5 },
      items: [
        { plex: '1', label: 'A', itemIndex: 1, userWatched: true },
        { plex: '2', label: 'B', itemIndex: 2, userWatched: false },
        { plex: '3', label: 'C', itemIndex: 3, userWatched: false },
      ],
    };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    // B is the first unwatched: co-progress-locked → two-person icon
    expect(screen.getByLabelText('Waiting for partner')).toBeTruthy();
    // C is sequentially locked → standard lock icon
    expect(screen.getByLabelText('Locked')).toBeTruthy();
  });

  it('shows a toast with the partner name on tap of the co-progress-locked episode', () => {
    const onPlay = vi.fn();
    hookReturn = {
      ...baseHook,
      isSequential: true,
      coProgressLock: { locked: true, aheadBy: 5, waitingForId: 'felix', buffer: 5 },
      items: [
        { plex: '1', label: 'A', itemIndex: 1, userWatched: true },
        { plex: '2', label: 'B', itemIndex: 2, userWatched: false },
        { plex: '3', label: 'C', itemIndex: 3, userWatched: false },
      ],
    };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={onPlay} />);
    fireEvent.click(screen.getByText('B').closest('button'));
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Felix');
    expect(screen.getByRole('status').textContent).toContain('5 episodes ahead');
  });

  it('does not apply the co-progress lock when coProgressLock is null', () => {
    const onPlay = vi.fn();
    hookReturn = {
      ...baseHook,
      isSequential: true,
      coProgressLock: null,
      items: [
        { plex: '1', label: 'A', itemIndex: 1, userWatched: true },
        { plex: '2', label: 'B', itemIndex: 2, userWatched: false },
      ],
    };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={onPlay} />);
    fireEvent.click(screen.getByText('B').closest('button'));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run tests — verify they fail**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.test.jsx 2>&1 | tail -30
```

Expected: The new `coProgressLock` and `co-progress lock` tests fail.

- [ ] **Step 4: Expose coProgressLock from usePianoCoursePlayable**

In `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.js`, update the return statement from:

```javascript
  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    items: state.data?.items ?? null,
    info: state.data?.info ?? {},
    parents: state.data?.parents ?? null,
    isSequential: state.data?.isSequential ?? false,
  };
```

to:

```javascript
  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    items: state.data?.items ?? null,
    info: state.data?.info ?? {},
    parents: state.data?.parents ?? null,
    isSequential: state.data?.isSequential ?? false,
    coProgressLock: state.data?.coProgressLock ?? null,
  };
```

- [ ] **Step 5: Implement co-progress lock in CourseDetail.jsx**

Replace the full contents of `CourseDetail.jsx` with:

```javascript
// CourseDetail.jsx
import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { lectureUserStatus } from './lectureMeta.js';
import LockIcon from '@/modules/Fitness/player/overlays/LockIcon.jsx';
import { usePianoCoursePlayable } from './usePianoCoursePlayable.js';
import { usePianoBreadcrumb } from '../../PianoBreadcrumbContext.jsx';
import { usePianoUser } from '../../PianoUserContext.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';

const idOf = (raw) => String(raw || '').replace(/^plex:/, '');

function fmtDuration(sec) {
  const s = Math.round(Number(sec));
  if (!Number.isFinite(s) || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function playUnlockChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      osc.start(t); osc.stop(t + 0.6);
    });
    setTimeout(() => ctx.close().catch(() => {}), 2000);
  } catch { /* no audio available */ }
}

// Two-person silhouette (Google Material "group" icon) — distinguishes the
// co-progress lock from the standard sequential padlock at a glance.
function CoProgressLockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ width: '1em', height: '1em' }}>
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
    </svg>
  );
}

/**
 * Course landing page. Per-user watch state (✓ / progress) rides on each
 * thumbnail. Sequential courses lock episodes after the first unwatched one and,
 * when multi-season, hide seasons beyond the first incomplete one — revealing the
 * next with a toast + chime as the student completes a unit.
 *
 * Co-progress lock: when the backend reports the current user is too far ahead of
 * their paired partner, the "next available" episode gets a navigation gate: tapping
 * it shows an explanatory toast rather than launching the video.
 */
export default function CourseDetail({ course, onPlay }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-video-detail' }), []);
  const { currentUser, currentProfile, users } = usePianoUser();
  const courseId = idOf(course?.id);
  const { items, info, parents, isSequential, loading, error, coProgressLock } = usePianoCoursePlayable(courseId, currentUser);

  const seasons = useMemo(() => {
    if (!parents || typeof parents !== 'object') return [];
    return Object.entries(parents)
      .map(([id, p]) => ({
        id: String(id),
        index: Number.isFinite(p?.index) ? p.index : (parseInt(p?.index, 10) || 0),
        title: p?.title || null,
        thumbnail: p?.thumbnail || null,
      }))
      .sort((a, b) => a.index - b.index);
  }, [parents]);

  const episodesOf = useCallback(
    (seasonId) => (items || []).filter((ep) => String(ep.parentId) === String(seasonId)),
    [items],
  );

  const seasonComplete = useCallback(
    (seasonId) => {
      const eps = episodesOf(seasonId);
      return eps.length > 0 && eps.every((ep) => lectureUserStatus(ep).watched);
    },
    [episodesOf],
  );

  const visibleSeasons = useMemo(() => {
    if (!isSequential || seasons.length <= 1) return seasons;
    const out = [];
    for (const s of seasons) {
      out.push(s);
      if (!seasonComplete(s.id)) break;
    }
    return out;
  }, [isSequential, seasons, seasonComplete]);

  // Linear locked set: all episodes after the first unwatched (sequential order).
  const lockedIds = useMemo(() => {
    if (!isSequential || !items) return new Set();
    const seasonIndex = (parentId) => seasons.find((s) => String(s.id) === String(parentId))?.index ?? 0;
    const sorted = [...items].sort((a, b) => {
      const si = seasonIndex(a.parentId) - seasonIndex(b.parentId);
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
  }, [isSequential, items, seasons]);

  // The episode the student should play next (first unwatched, linear order).
  const currentId = useMemo(() => {
    if (!isSequential || !items) return null;
    const seasonIndex = (parentId) => seasons.find((s) => String(s.id) === String(parentId))?.index ?? 0;
    const sorted = [...items].sort((a, b) => {
      const si = seasonIndex(a.parentId) - seasonIndex(b.parentId);
      if (si !== 0) return si;
      return (a.itemIndex ?? Infinity) - (b.itemIndex ?? Infinity);
    });
    const next = sorted.find((ep) => !lectureUserStatus(ep).watched);
    return next ? (next.plex || next.id) : null;
  }, [isSequential, items, seasons]);

  // Co-progress lock: if the backend says the user is too far ahead, the first
  // available (unwatched) episode gets a navigation gate instead of playing.
  const coProgressLockedId = useMemo(() => {
    if (!coProgressLock?.locked || !isSequential || !items) return null;
    const seasonIndex = (parentId) => seasons.find((s) => String(s.id) === String(parentId))?.index ?? 0;
    const sorted = [...items].sort((a, b) => {
      const si = seasonIndex(a.parentId) - seasonIndex(b.parentId);
      if (si !== 0) return si;
      return (a.itemIndex ?? Infinity) - (b.itemIndex ?? Infinity);
    });
    const next = sorted.find((ep) => !lectureUserStatus(ep).watched);
    return next ? (next.plex || next.id) : null;
  }, [coProgressLock, isSequential, items, seasons]);

  const [unlockedToast, setUnlockedToast] = useState(null);
  const [coProgressToast, setCoProgressToast] = useState(null);

  const prevCompleteRef = useRef(null);
  useEffect(() => {
    if (!isSequential || seasons.length <= 1 || !items) return;
    const completeNow = new Set(seasons.filter((s) => seasonComplete(s.id)).map((s) => s.id));
    const prev = prevCompleteRef.current;
    if (prev) {
      for (let i = 0; i < seasons.length; i += 1) {
        const s = seasons[i];
        if (completeNow.has(s.id) && !prev.has(s.id)) {
          const next = seasons[i + 1];
          if (next) {
            const name = next.title || `Unit ${next.index}`;
            setUnlockedToast(name);
            playUnlockChime();
            logger.info('piano.season-unlocked', { season: next.id, name });
            setTimeout(() => setUnlockedToast(null), 4000);
          }
        }
      }
    }
    prevCompleteRef.current = completeNow;
  }, [isSequential, seasons, items, seasonComplete, logger]);

  const poster = info?.image || course?.image;
  const title = course?.title || info?.title || 'Course';
  usePianoBreadcrumb(useMemo(() => [{ label: title }], [title]));

  const renderEpisode = (item) => {
    const st = lectureUserStatus(item);
    const img = item.image || item.thumbnail;
    const key = item.plex || item.id;
    const isSequentiallyLocked = lockedIds.has(key);
    const isCoProgressLocked = key === coProgressLockedId;
    const isLocked = isSequentiallyLocked || isCoProgressLocked;
    // Not "current" if it's co-progress locked (not actually playable right now).
    const isCurrent = key === currentId && !isCoProgressLocked;
    const duration = fmtDuration(item.duration);

    const handleClick = () => {
      if (isSequentiallyLocked) return;
      if (isCoProgressLocked) {
        const name = users.find((u) => u.id === coProgressLock.waitingForId)?.name
          || coProgressLock.waitingForId;
        setCoProgressToast(
          `You're ${coProgressLock.aheadBy} episodes ahead of ${name} — let them catch up first.`,
        );
        setTimeout(() => setCoProgressToast(null), 4000);
        return;
      }
      onPlay(item);
    };

    return (
      <li key={key}>
        <button
          type="button"
          className={[
            'piano-episode',
            isLocked && 'piano-episode--locked',
            isCurrent && 'piano-episode--current',
          ].filter(Boolean).join(' ')}
          onClick={handleClick}
          disabled={isSequentiallyLocked}
          aria-disabled={isLocked}
          aria-current={isCurrent ? 'true' : undefined}
        >
          <div className="piano-episode__thumb">
            {img && <img src={img} alt="" loading="eager" decoding="async" />}
            {isSequentiallyLocked && (
              <span className="piano-episode__lock" aria-label="Locked"><LockIcon /></span>
            )}
            {isCoProgressLocked && (
              <span className="piano-episode__lock piano-episode__lock--co-progress" aria-label="Waiting for partner">
                <CoProgressLockIcon />
              </span>
            )}
            {!isLocked && st.watched && <span className="piano-episode__check" aria-label="Watched">✓</span>}
            {!isLocked && !st.watched && st.percent > 0 && (
              <span className="piano-episode__bar"><span style={{ width: `${st.percent}%` }} /></span>
            )}
            {duration && <span className="piano-episode__duration">{duration}</span>}
          </div>
          <div className="piano-episode__label">
            {item.itemIndex != null && <span className="piano-episode__num">E{item.itemIndex}</span>}
            <span className="piano-episode__title">{item.label || item.title}</span>
          </div>
        </button>
      </li>
    );
  };

  const isMultiSeason = seasons.length > 1;

  return (
    <section className="piano-mode--videos piano-course">
      <div className="piano-course__content">
        <aside className="piano-course__info">
          {poster && <img className="piano-course__poster" src={poster} alt="" />}
          <h2 className="piano-course__title">{title}</h2>
          {items?.length > 0 && <div className="piano-course__count">{items.length} lectures</div>}
          {isSequential && (
            <div className="piano-course__learner">
              <span className="piano-course__badge">Sequential</span>
              {currentProfile?.name && (
                <span className="piano-course__learner-name">Learning as {currentProfile.name}</span>
              )}
            </div>
          )}
          {info?.summary && <p className="piano-course__summary">{info.summary}</p>}
        </aside>

        <div className="piano-course__episodes">
          {loading && <PianoEmpty loading />}
          {!loading && (!items || items.length === 0) && <PianoEmpty message={error || 'No lectures found.'} />}
          {!loading && items?.length > 0 && (
            isMultiSeason ? (
              visibleSeasons.map((s) => {
                const eps = [...episodesOf(s.id)].sort((a, b) => (a.itemIndex ?? 0) - (b.itemIndex ?? 0));
                if (!eps.length) return null;
                return (
                  <div className="piano-course__season" key={s.id}>
                    <h3 className="piano-course__season-title">{s.title || `Unit ${s.index}`}</h3>
                    <ul className="piano-episodes">{eps.map(renderEpisode)}</ul>
                  </div>
                );
              })
            ) : (
              <ul className="piano-episodes">{items.map(renderEpisode)}</ul>
            )
          )}
        </div>
      </div>
      {unlockedToast && (
        <div className="piano-course__unlock-toast" role="status">🎉 {unlockedToast} unlocked!</div>
      )}
      {coProgressToast && (
        <div className="piano-course__unlock-toast piano-course__co-progress-toast" role="status">
          {coProgressToast}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Run all four test files — verify all pass**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.test.jsx 2>&1 | tail -20
```

Expected: All tests pass. Existing CourseDetail and hook tests are not broken.

- [ ] **Step 7: Commit**

```bash
git add \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.js \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.jsx \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.test.jsx
git commit -m "feat(piano): co-progress lock UI — two-person icon + toast in CourseDetail"
```

---

## Task 3: Engagement Gate Transport Lock

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx`

---

- [ ] **Step 1: Write failing tests for gateOpen transport lock**

Add a new describe block at the end of `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx`:

```javascript
describe('engagement gate transport lock', () => {
  it('all core transport buttons are disabled when gateOpen is true', () => {
    render(<PianoVideoChrome {...baseProps} gateOpen={true} />);
    expect(screen.getByLabelText('Pause')).toBeDisabled();
    expect(screen.getByLabelText('Restart from beginning')).toBeDisabled();
    expect(screen.getByLabelText('Back 15 seconds')).toBeDisabled();
    expect(screen.getByLabelText('Forward 15 seconds')).toBeDisabled();
  });

  it('core transport buttons are enabled when gateOpen is false', () => {
    render(<PianoVideoChrome {...baseProps} gateOpen={false} />);
    expect(screen.getByLabelText('Pause')).not.toBeDisabled();
    expect(screen.getByLabelText('Restart from beginning')).not.toBeDisabled();
    expect(screen.getByLabelText('Back 15 seconds')).not.toBeDisabled();
  });

  it('seek bar does not call onSeek when gateOpen is true', () => {
    const onSeek = vi.fn();
    render(<PianoVideoChrome {...baseProps} gateOpen={true} onSeek={onSeek} />);
    const bar = screen.getByTestId('piano-video-chrome').querySelector('.piano-video-chrome__bar');
    fireEvent.pointerDown(bar, { clientX: 50 });
    expect(onSeek).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx 2>&1 | tail -20
```

Expected: The `engagement gate transport lock` tests fail (no `gateOpen` prop yet).

- [ ] **Step 3: Implement gateOpen in PianoVideoChrome.jsx**

Replace the full contents of `PianoVideoChrome.jsx` with:

```javascript
// PianoVideoChrome.jsx
import { useRef, useState } from 'react';
import Icon from '../../icons/Icon.jsx';
import { usePianoMix } from '../../PianoMixContext.jsx';
import MixControls from '../../MixControls.jsx';

const fmt = (s) => {
  let v = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), sec = v % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? `${h}:` : '') + `${mm}:${String(sec).padStart(2, '0')}`;
};

export default function PianoVideoChrome({
  isPlaying, currentTime, duration, rate, loop,
  onToggle, onSkip, onRestart, onCycleRate, onMarkA, onMarkB, onToggleLoop, onClearLoop, onSeek,
  isSequential = false,
  furthestWatched = 0,
  gateOpen = false,
}) {
  const barRef = useRef(null);
  const [mixOpen, setMixOpen] = useState(false);
  const { pianoLevel, mediaLevel, setPianoLevel, setMediaLevel } = usePianoMix();
  const dur = duration > 0 ? duration : 0;
  const pct = dur ? Math.min(100, (currentTime / dur) * 100) : 0;
  const markPos = (v) => (dur && Number.isFinite(v) ? `${Math.min(100, (v / dur) * 100)}%` : null);
  const forwardDisabled = isSequential && currentTime >= furthestWatched - 1;
  const seekFromEvent = (e) => {
    if (gateOpen) return;
    const el = barRef.current; if (!el || !dur) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX ?? 0) - rect.left;
    const pos = Math.max(0, Math.min(dur, (x / rect.width) * dur));
    onSeek(isSequential ? Math.min(pos, furthestWatched) : pos);
  };
  const hasLoop = loop?.a != null || loop?.b != null;
  const bothMarks = loop?.a != null && loop?.b != null;
  const loopActive = !!loop?.active;

  return (
    <div className="piano-video-chrome" data-testid="piano-video-chrome">
      <div className="piano-video-chrome__bar" ref={barRef} onPointerDown={seekFromEvent}>
        <div className="piano-video-chrome__progress" style={{ width: `${pct}%` }} />
        {markPos(loop?.a) && <span className="piano-video-chrome__mark piano-video-chrome__mark--a" style={{ left: markPos(loop.a) }} />}
        {markPos(loop?.b) && <span className="piano-video-chrome__mark piano-video-chrome__mark--b" style={{ left: markPos(loop.b) }} />}
      </div>
      <div className="piano-video-chrome__row">
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--restart" onClick={onRestart} disabled={gateOpen} aria-label="Restart from beginning"><Icon name="previous" /></button>
        <span className="piano-video-chrome__time">{fmt(currentTime)} / {fmt(dur)}</span>
        <div className="piano-video-chrome__spacer" />
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(-15)} disabled={gateOpen} aria-label="Back 15 seconds"><Icon name="skip-back-15" /></button>
        <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--play" onClick={onToggle} disabled={gateOpen} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Icon name="pause" /> : <Icon name="play" />}</button>
        <button type="button" className="piano-video-chrome__btn" onClick={() => onSkip(15)} disabled={gateOpen || forwardDisabled} aria-label="Forward 15 seconds"><Icon name="skip-forward-15" /></button>
        <div className="piano-video-chrome__spacer" />
        {!isSequential && (
          <button type="button" className="piano-video-chrome__btn piano-video-chrome__btn--rate" onClick={onCycleRate} disabled={gateOpen} aria-label="Playback speed">{rate}×</button>
        )}
        <div className={`piano-video-chrome__loop-group${hasLoop ? ' has-marks' : ''}`}>
          <button type="button" className={`piano-video-chrome__btn${loop?.a != null && loop?.b == null ? ' is-arming' : ''}`} onClick={onMarkA} disabled={gateOpen} aria-label="Mark loop start"><Icon name="loop-a" /></button>
          <button type="button" className="piano-video-chrome__btn" onClick={onMarkB} disabled={gateOpen} aria-label="Mark loop end"><Icon name="loop-b" /></button>
          <button type="button" className={`piano-video-chrome__btn${loopActive ? ' is-on' : ''}`} onClick={onToggleLoop} disabled={gateOpen || !bothMarks} aria-label="Toggle A-B loop"><Icon name="repeat" /></button>
          <button type="button" className="piano-video-chrome__btn" onClick={onClearLoop} disabled={gateOpen || !hasLoop} aria-label="Clear loop"><Icon name="clear-loop" /></button>
        </div>
        <div className="piano-video-chrome__mix-wrap">
          <button type="button" className={`piano-video-chrome__btn${mixOpen ? ' is-on' : ''}`} onClick={() => setMixOpen((v) => !v)} disabled={gateOpen} aria-label="Toggle mix controls"><Icon name="volume-up" /></button>
          {mixOpen && (
            <div className="piano-video-chrome__mix-flyout">
              <MixControls
                pianoLevel={pianoLevel}
                mediaLevel={mediaLevel}
                onPiano={(d) => setPianoLevel(pianoLevel + d)}
                onMedia={(d) => setMediaLevel(mediaLevel + d)}
                btnClass="piano-video-chrome__btn"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass gateOpen to PianoVideoChrome in PianoVideoPlayer.jsx**

In `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx`, locate the `<PianoVideoChrome` JSX block and add `gateOpen={gateOpen}` after `furthestWatched`:

```jsx
          <PianoVideoChrome
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            rate={rate}
            loop={loop}
            isSequential={isSequential}
            furthestWatched={furthestWatched}
            gateOpen={gateOpen}
            onToggle={ctrl.toggle}
            onRestart={handleRestart}
            onSkip={handleSkip}
            onCycleRate={handleCycleRate}
            onMarkA={loop.markA}
            onMarkB={loop.markB}
            onToggleLoop={loop.toggle}
            onClearLoop={loop.clear}
            onSeek={ctrl.seek}
          />
```

- [ ] **Step 5: Run all tests — verify all pass**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx 2>&1 | tail -20
```

Expected: All tests pass, including the 3 new `engagement gate transport lock` tests and all pre-existing tests.

- [ ] **Step 6: Run the full changed test suite together**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  backend/src/4_api/v1/routers/piano.courses.test.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.test.jsx \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx 2>&1 | tail -20
```

Expected: All tests pass across all 4 files.

- [ ] **Step 7: Commit**

```bash
git add \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
git commit -m "fix(piano): disable transport controls while engagement gate is open"
```
