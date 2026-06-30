# Piano Reference-Unit Exemption + Descending-Unit Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let config flag certain units in a sequential piano course as "reference/practice" so they are never locked, give no progression credit, are excluded from co-progress, and render in an always-open "Practice & Reference" section below the gated lessons — and render multi-unit lesson lists with the latest unit on top (episodes ascending within).

**Architecture:** Backend computes a per-course `referenceUnitIds` set (units whose Plex season title matches a configured `titlePatterns` entry, or whose id is in `unitIds`), tags each item `isReference`, excludes reference items from co-progress counts, and returns `referenceUnitIds`. The frontend hook passes `referenceUnitIds` through; `CourseDetail` partitions units into lesson vs reference, runs all gating math over lesson episodes only, renders lesson units in descending order, and renders reference units in a separate always-visible bottom section with no lock chrome.

**Tech Stack:** Node.js/Express (backend), React hooks + vitest + @testing-library/react (frontend), SCSS.

**Spec:** `docs/superpowers/specs/2026-06-29-piano-reference-unit-exemption-design.md`

---

## File Map

| File | Change |
|------|--------|
| `backend/src/4_api/v1/routers/piano.mjs` | Compute `referenceUnitIds`, tag `isReference`, exclude reference from co-progress counts, append `referenceUnitIds` to response |
| `backend/src/4_api/v1/routers/piano.courses.test.mjs` | Extend `makeAppWith` with a `parents` override; add `reference units` test suite |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.js` | Expose `referenceUnitIds` (default `[]`) |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js` | Add two passthrough tests |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.jsx` | Partition lesson/reference units; gate over lesson episodes only; descending lesson render; bottom Practice & Reference section |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.test.jsx` | Add `referenceUnitIds` to mocks; add reference + descending-order test suite |
| `frontend/src/Apps/PianoApp.scss` | Styles for `&__reference`, `&__reference-title`, `&__season--reference` |

---

## Task 1: Backend — Reference-Unit Computation

**Files:**
- Modify: `backend/src/4_api/v1/routers/piano.mjs`
- Modify: `backend/src/4_api/v1/routers/piano.courses.test.mjs`

---

- [ ] **Step 1: Extend the `makeAppWith` test helper to accept a `parents` override**

In `backend/src/4_api/v1/routers/piano.courses.test.mjs`, find the current helper:

```javascript
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
```

Replace it with (adds a `parents` parameter defaulting to the single-season map so existing callers are unaffected):

```javascript
const makeAppWith = ({ config, store, items, parents } = {}) => {
  const configSvc = config
    ? { ...mockConfigService, getHouseholdAppConfig: () => config }
    : mockConfigService;
  const svc = items
    ? {
        getPlayableEpisodes: vi.fn().mockResolvedValue({
          compoundId: `plex:${MOCK_SHOW}`,
          showId: MOCK_SHOW,
          items,
          parents: parents || { '10': { index: 1, title: 'Season 1', thumbnail: null } },
          info: { title: 'Piano Course', labels: ['sequential'], type: 'show' },
          containerItem: null,
        }),
      }
    : mockPlayableService;
```

- [ ] **Step 2: Write failing tests for reference-unit behavior**

Add this block at the END of `backend/src/4_api/v1/routers/piano.courses.test.mjs`, after the final `});` that closes the `co-progress lock` describe:

```javascript
// ── Reference-unit helpers ──────────────────────────────────────────────────
// Two units: a lesson unit ('20') and an "Exercise Module" reference unit ('30').
const refParents = {
  '20': { index: 1, title: 'Welcome & Basics', thumbnail: null },
  '30': { index: 2, title: 'Exercise Module - C Position', thumbnail: null },
};
const refItems = [
  { plex: '201', label: 'Lesson A1', itemIndex: 1, parentId: '20', isWatched: false, watchProgress: 0 },
  { plex: '202', label: 'Lesson A2', itemIndex: 2, parentId: '20', isWatched: false, watchProgress: 0 },
  { plex: '301', label: '01 Drill', itemIndex: 1, parentId: '30', isWatched: false, watchProgress: 0 },
  { plex: '302', label: '02 Drill', itemIndex: 2, parentId: '30', isWatched: false, watchProgress: 0 },
];
const refConfig = (refRule) => ({
  users: { primary: [MOCK_USER, PARTNER_USER] },
  videos: {
    sequential_labels: ['sequential'],
    reference_units: [{ courseId: `plex:${MOCK_SHOW}`, ...refRule }],
  },
});

describe('reference units', () => {
  it('returns referenceUnitIds: [] and isReference:false on every item when no rule', async () => {
    const res = await request(makeAppWith({ items: refItems, parents: refParents }))
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable`);
    expect(res.status).toBe(200);
    expect(res.body.referenceUnitIds).toEqual([]);
    expect(res.body.items.every((it) => it.isReference === false)).toBe(true);
  });

  it('flags a unit whose title matches a titlePattern (case-insensitive)', async () => {
    const config = refConfig({ titlePatterns: ['exercise module'] });
    const res = await request(makeAppWith({ config, items: refItems, parents: refParents }))
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable`);
    expect(res.status).toBe(200);
    expect(res.body.referenceUnitIds).toEqual(['30']);
    const byId = Object.fromEntries(res.body.items.map((it) => [it.plex, it.isReference]));
    expect(byId['201']).toBe(false);
    expect(byId['202']).toBe(false);
    expect(byId['301']).toBe(true);
    expect(byId['302']).toBe(true);
  });

  it('flags a unit listed in unitIds regardless of title', async () => {
    const config = refConfig({ titlePatterns: [], unitIds: ['20'] });
    const res = await request(makeAppWith({ config, items: refItems, parents: refParents }))
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable`);
    expect(res.status).toBe(200);
    expect(res.body.referenceUnitIds).toEqual(['20']);
  });

  it('excludes reference episodes from the co-progress count', async () => {
    // milo watched 4 lessons + 5 reference; felix watched none. buffer 5.
    // Counting reference would make milo 9 ahead (lock); excluding it leaves 4 (no lock).
    const lessons = Array.from({ length: 6 }, (_, i) => ({
      plex: String(400 + i), label: `Lesson ${i + 1}`, itemIndex: i + 1, parentId: '20',
    }));
    const drills = Array.from({ length: 5 }, (_, i) => ({
      plex: String(500 + i), label: `Drill ${i + 1}`, itemIndex: i + 1, parentId: '30',
    }));
    const items = [...lessons, ...drills];
    const store = makePartnerStore({
      [MOCK_USER]: ['400', '401', '402', '403', '500', '501', '502', '503', '504'],
      [PARTNER_USER]: [],
    });
    const config = {
      users: { primary: [MOCK_USER, PARTNER_USER] },
      videos: {
        sequential_labels: ['sequential'],
        co_progress: [{ courseId: `plex:${MOCK_SHOW}`, users: [MOCK_USER, PARTNER_USER], buffer: 5 }],
        reference_units: [{ courseId: `plex:${MOCK_SHOW}`, titlePatterns: ['Exercise Module'] }],
      },
    };
    const res = await request(makeAppWith({ config, store, items, parents: refParents }))
      .get(`/api/v1/piano/courses/${MOCK_SHOW}/playable?userId=${MOCK_USER}`);
    expect(res.status).toBe(200);
    expect(res.body.referenceUnitIds).toEqual(['30']);
    expect(res.body.coProgressLock).toBeNull(); // 4 lesson-ahead < 5, reference excluded
  });
});
```

- [ ] **Step 3: Run the new tests — verify they fail**

```bash
cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/piano.courses.test.mjs 2>&1 | tail -30
```

Expected: the 4 new `reference units` tests fail (`referenceUnitIds` is `undefined`, `isReference` missing). The 12 pre-existing tests still pass.

- [ ] **Step 4: Implement reference computation in piano.mjs**

In `backend/src/4_api/v1/routers/piano.mjs`, find this exact block (the config read through the final `res.json`):

```javascript
    const pianoConfig = configService.getHouseholdAppConfig(null, 'piano') || {};
    const sequentialLabels = new Set(
      (pianoConfig.videos?.sequential_labels || []).map((l) => l.toLowerCase())
    );
    const isSequential = Array.isArray(playable.info?.labels) &&
      playable.info.labels.some((l) => sequentialLabels.has(String(l).toLowerCase()));

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

Replace the WHOLE block above with (hoists `compoundId`, adds reference computation + tagging before co-progress, excludes reference from counts, appends `referenceUnitIds`):

```javascript
    const pianoConfig = configService.getHouseholdAppConfig(null, 'piano') || {};
    const compoundId = playable.compoundId || `plex:${courseId}`;
    const sequentialLabels = new Set(
      (pianoConfig.videos?.sequential_labels || []).map((l) => l.toLowerCase())
    );
    const isSequential = Array.isArray(playable.info?.labels) &&
      playable.info.labels.some((l) => sequentialLabels.has(String(l).toLowerCase()));

    // Reference units: config-flagged units (by title pattern or explicit id) that
    // are never gated, give no progression credit, and render in the always-open
    // Practice & Reference zone. Matched per course against unit (season) titles.
    const referenceUnitIds = new Set();
    const refRule = (pianoConfig.videos?.reference_units || []).find((r) => r.courseId === compoundId);
    if (refRule) {
      const patterns = (refRule.titlePatterns || []).map((p) => String(p).toLowerCase()).filter(Boolean);
      const explicit = new Set((refRule.unitIds || []).map(String));
      for (const [pid, parent] of Object.entries(playable.parents || {})) {
        const title = String(parent?.title || '').toLowerCase();
        if (explicit.has(String(pid)) || patterns.some((pat) => title.includes(pat))) {
          referenceUnitIds.add(String(pid));
        }
      }
    }
    if (Array.isArray(playable.items)) {
      playable.items = playable.items.map((it) => ({
        ...it,
        isReference: referenceUnitIds.has(String(it.parentId)),
      }));
    }

    // Co-progress lock: in sequential courses with a configured user pair, block the
    // ahead user from the next episode until the gap falls below the buffer. Reference
    // episodes give no credit, so they're excluded from both users' counts.
    let coProgressLock = null;
    if (isSequential && userId && !isGuest && userVideoProgressStore) {
      const rules = pianoConfig.videos?.co_progress || [];
      const rule = rules.find(
        (r) => r.courseId === compoundId &&
               Array.isArray(r.users) &&
               r.users.includes(userId),
      );
      if (rule) {
        const isCredit = (it) => it.userWatched && !referenceUnitIds.has(String(it.parentId));
        const myCount = (playable.items || []).filter(isCredit).length;
        const partnerIds = rule.users.filter((u) => u !== userId);
        const partnerCounts = partnerIds.map((pid) => {
          if (!userVideoProgressStore.isKnownUser(pid)) return 0;
          const enriched = userVideoProgressStore.enrich(playable.items || [], pid);
          return enriched.filter(isCredit).length;
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
    res.json({ ...playable, isSequential, coProgressLock, referenceUnitIds: [...referenceUnitIds] });
```

- [ ] **Step 5: Run the full file — verify all pass**

```bash
cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs backend/src/4_api/v1/routers/piano.courses.test.mjs 2>&1 | tail -20
```

Expected: ALL 16 tests pass (12 original + 4 new). The `enrich` helper preserves `parentId` (it spreads `...it`), so the `isCredit` filter works for partners too.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/4_api/v1/routers/piano.mjs backend/src/4_api/v1/routers/piano.courses.test.mjs
git commit -m "feat(piano): compute reference-unit exemption in courses/playable endpoint"
```

---

## Task 2: Frontend — Hook Passthrough

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js`

---

- [ ] **Step 1: Write failing tests for `referenceUnitIds` passthrough**

In `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js`, add these two tests inside the existing `describe('usePianoCoursePlayable', ...)` block, after the last `it(...)`:

```javascript
  it('exposes referenceUnitIds from response', async () => {
    api.mockResolvedValue({ items: [], info: {}, isSequential: true, referenceUnitIds: ['30', '40'] });
    const { result } = renderHook(() => usePianoCoursePlayable('12345', 'milo'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.referenceUnitIds).toEqual(['30', '40']);
  });

  it('exposes referenceUnitIds: [] when not present in response', async () => {
    api.mockResolvedValue({ items: [], info: {}, isSequential: true });
    const { result } = renderHook(() => usePianoCoursePlayable('12345', 'milo'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.referenceUnitIds).toEqual([]);
  });
```

- [ ] **Step 2: Run the hook tests — verify the new ones fail**

```bash
cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js 2>&1 | tail -20
```

Expected: the 2 new tests fail (`referenceUnitIds` is `undefined`); the 7 pre-existing tests pass.

- [ ] **Step 3: Expose `referenceUnitIds` from the hook**

In `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.js`, find the return object:

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

Replace it with:

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
    referenceUnitIds: state.data?.referenceUnitIds ?? [],
  };
```

- [ ] **Step 4: Run the hook tests — verify all pass**

```bash
cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js 2>&1 | tail -10
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.js frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js
git commit -m "feat(piano): expose referenceUnitIds from usePianoCoursePlayable"
```

---

## Task 3: Frontend — CourseDetail Partition, Descending Order, Reference Section

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.test.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss`

---

- [ ] **Step 1: Add `referenceUnitIds` to test mocks + write failing tests**

In `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.test.jsx`, first update `baseHook` to include `referenceUnitIds`. Find:

```javascript
const baseHook = { items: null, info: {}, parents: null, isSequential: false, loading: false, error: null, coProgressLock: null };
```

Replace with:

```javascript
const baseHook = { items: null, info: {}, parents: null, isSequential: false, loading: false, error: null, coProgressLock: null, referenceUnitIds: [] };
```

Then add this new describe block at the END of the file (sibling to the others):

```javascript
describe('reference units + descending order', () => {
  it('renders multi-unit LESSON units in descending order (latest on top)', () => {
    hookReturn = {
      ...baseHook,
      isSequential: false,
      parents: { s1: { index: 1, title: 'Unit 1' }, s2: { index: 2, title: 'Unit 2' } },
      items: [
        { plex: '1', label: 'A', itemIndex: 1, parentId: 's1', userWatched: false },
        { plex: '2', label: 'B', itemIndex: 1, parentId: 's2', userWatched: false },
      ],
    };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    const titles = Array.from(document.querySelectorAll('.piano-course__season-title')).map((e) => e.textContent);
    expect(titles).toEqual(['Unit 2', 'Unit 1']); // descending
  });

  it('renders reference units in a Practice & Reference section, not gated', () => {
    const onPlay = vi.fn();
    hookReturn = {
      ...baseHook,
      isSequential: true,
      referenceUnitIds: ['s3'],
      parents: { s1: { index: 1, title: 'Unit 1' }, s3: { index: 3, title: 'Exercise Module' } },
      items: [
        { plex: '1', label: 'L1', itemIndex: 1, parentId: 's1', userWatched: false },
        { plex: '2', label: 'L2', itemIndex: 2, parentId: 's1', userWatched: false },
        { plex: '9', label: 'Drill', itemIndex: 1, parentId: 's3', userWatched: false },
      ],
    };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={onPlay} />);
    // The reference section header is present.
    expect(screen.getByText(/Practice & Reference/)).toBeTruthy();
    // The reference episode is clickable (not disabled) and plays directly.
    const drill = screen.getByText('Drill').closest('button');
    expect(drill).not.toBeDisabled();
    fireEvent.click(drill);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('keeps the lesson gate working while reference units stay open', () => {
    const onPlay = vi.fn();
    hookReturn = {
      ...baseHook,
      isSequential: true,
      referenceUnitIds: ['s3'],
      parents: { s1: { index: 1, title: 'Unit 1' }, s3: { index: 3, title: 'Exercise Module' } },
      items: [
        { plex: '1', label: 'L1', itemIndex: 1, parentId: 's1', userWatched: false },
        { plex: '2', label: 'L2', itemIndex: 2, parentId: 's1', userWatched: false },
        { plex: '9', label: 'Drill', itemIndex: 1, parentId: 's3', userWatched: false },
      ],
    };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={onPlay} />);
    // L2 is a locked lesson (after the first unwatched lesson L1) → disabled.
    expect(screen.getByText('L2').closest('button')).toBeDisabled();
    // The reference drill is NOT locked even though it has no watched prereqs.
    expect(screen.getByText('Drill').closest('button')).not.toBeDisabled();
  });

  it('shows no Practice & Reference section when referenceUnitIds is empty', () => {
    hookReturn = {
      ...baseHook,
      isSequential: true,
      parents: { s1: { index: 1, title: 'Unit 1' }, s2: { index: 2, title: 'Unit 2' } },
      items: [
        { plex: '1', label: 'A', itemIndex: 1, parentId: 's1', userWatched: true },
        { plex: '2', label: 'B', itemIndex: 1, parentId: 's2', userWatched: false },
      ],
    };
    render(<CourseDetail course={{ id: 'plex:99' }} onPlay={vi.fn()} />);
    expect(screen.queryByText(/Practice & Reference/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run CourseDetail tests — verify the new ones fail**

```bash
cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.test.jsx 2>&1 | tail -30
```

Expected: the 4 new tests fail (no descending order, no reference section); the 11 pre-existing tests pass.

- [ ] **Step 3: Replace `CourseDetail.jsx` with the partitioned version**

Replace the FULL contents of `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.jsx` with:

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

// Lecture length for the thumb corner badge. `duration` arrives in seconds;
// render M:SS (or H:MM:SS for the rare hour-plus lecture). Null when unknown.
function fmtDuration(sec) {
  const s = Math.round(Number(sec));
  if (!Number.isFinite(s) || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Best-effort ascending C-E-G chime when a new unit unlocks. Silent if no AudioContext.
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

// Two-person silhouette — distinguishes the co-progress lock from the standard
// sequential padlock at a glance.
function CoProgressLockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ width: '1em', height: '1em' }}>
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
    </svg>
  );
}

/**
 * Course landing page. Per-user watch state (✓ / progress) rides on each
 * thumbnail. Sequential courses lock episodes after the first unwatched LESSON one
 * and, when multi-unit, hide lesson units beyond the first incomplete one. Lesson
 * units render newest-on-top (descending), episodes ascending within. Config-flagged
 * "reference" units (exercise/practice/walkthrough banks) are never locked, give no
 * credit, and render in an always-open "Practice & Reference" section at the bottom.
 */
export default function CourseDetail({ course, onPlay }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-video-detail' }), []);
  const { currentUser, currentProfile, users } = usePianoUser();
  const courseId = idOf(course?.id);
  const { items, info, parents, isSequential, loading, error, coProgressLock, referenceUnitIds } = usePianoCoursePlayable(courseId, currentUser);

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

  // Reference units (config-flagged): split out from the gated lesson flow.
  const referenceUnitIdSet = useMemo(() => new Set(referenceUnitIds || []), [referenceUnitIds]);
  const lessonSeasons = useMemo(
    () => seasons.filter((s) => !referenceUnitIdSet.has(s.id)),
    [seasons, referenceUnitIdSet],
  );
  const referenceSeasons = useMemo(
    () => seasons.filter((s) => referenceUnitIdSet.has(s.id)),
    [seasons, referenceUnitIdSet],
  );

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

  // Lesson episodes only — all sequencing math (lock/current/reveal) ignores reference.
  const lessonItems = useMemo(
    () => (items || []).filter((ep) => !referenceUnitIdSet.has(String(ep.parentId))),
    [items, referenceUnitIdSet],
  );

  // Visible lesson units: sequential multi-unit shows through the FIRST incomplete
  // unit then stops (hiding later ones); otherwise all lesson units are visible.
  const visibleSeasons = useMemo(() => {
    if (!isSequential || lessonSeasons.length <= 1) return lessonSeasons;
    const out = [];
    for (const s of lessonSeasons) {
      out.push(s);
      if (!seasonComplete(s.id)) break;
    }
    return out;
  }, [isSequential, lessonSeasons, seasonComplete]);

  // Linear locked set for sequential courses: every LESSON episode after the first
  // not-yet-watched lesson episode (ordered by unit index, then itemIndex).
  const lockedIds = useMemo(() => {
    if (!isSequential || !lessonItems.length) return new Set();
    const seasonIndex = (parentId) => seasons.find((s) => String(s.id) === String(parentId))?.index ?? 0;
    const sorted = [...lessonItems].sort((a, b) => {
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
  }, [isSequential, lessonItems, seasons]);

  // The "current" lesson: the first not-yet-watched LESSON episode (linear order) —
  // the one the gate sits at and the student should play next. Goldenrod. Null for
  // non-sequential courses.
  const currentId = useMemo(() => {
    if (!isSequential || !lessonItems.length) return null;
    const seasonIndex = (parentId) => seasons.find((s) => String(s.id) === String(parentId))?.index ?? 0;
    const sorted = [...lessonItems].sort((a, b) => {
      const si = seasonIndex(a.parentId) - seasonIndex(b.parentId);
      if (si !== 0) return si;
      return (a.itemIndex ?? Infinity) - (b.itemIndex ?? Infinity);
    });
    const next = sorted.find((ep) => !lectureUserStatus(ep).watched);
    return next ? (next.plex || next.id) : null;
  }, [isSequential, lessonItems, seasons]);

  // Co-progress lock: if the backend says the user is too far ahead, the first
  // available (unwatched) LESSON episode gets a navigation gate instead of playing.
  const coProgressLockedId = useMemo(() => {
    if (!coProgressLock?.locked || !isSequential || !lessonItems.length) return null;
    const seasonIndex = (parentId) => seasons.find((s) => String(s.id) === String(parentId))?.index ?? 0;
    const sorted = [...lessonItems].sort((a, b) => {
      const si = seasonIndex(a.parentId) - seasonIndex(b.parentId);
      if (si !== 0) return si;
      return (a.itemIndex ?? Infinity) - (b.itemIndex ?? Infinity);
    });
    const next = sorted.find((ep) => !lectureUserStatus(ep).watched);
    return next ? (next.plex || next.id) : null;
  }, [coProgressLock, isSequential, lessonItems, seasons]);

  // Unlock ceremony: when the complete lesson-unit set grows, toast + chime the newly
  // revealed next lesson unit. Skips the first render (no "prev" to compare against).
  const [unlockedToast, setUnlockedToast] = useState(null);
  const [coProgressToast, setCoProgressToast] = useState(null);
  const prevCompleteRef = useRef(null);
  useEffect(() => {
    if (!isSequential || lessonSeasons.length <= 1 || !items) return;
    const completeNow = new Set(lessonSeasons.filter((s) => seasonComplete(s.id)).map((s) => s.id));
    const prev = prevCompleteRef.current;
    if (prev) {
      for (let i = 0; i < lessonSeasons.length; i += 1) {
        const s = lessonSeasons[i];
        if (completeNow.has(s.id) && !prev.has(s.id)) {
          const next = lessonSeasons[i + 1];
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
  }, [isSequential, lessonSeasons, items, seasonComplete, logger]);

  const poster = info?.image || course?.image;
  const title = course?.title || info?.title || 'Course';
  usePianoBreadcrumb(useMemo(() => [{ label: title }], [title]));

  const renderEpisode = (item, opts = {}) => {
    const reference = !!opts.reference;
    const st = lectureUserStatus(item);
    const img = item.image || item.thumbnail;
    const key = item.plex || item.id;
    const isSequentiallyLocked = !reference && lockedIds.has(key);
    const isCoProgressLocked = !reference && key === coProgressLockedId;
    const isLocked = isSequentiallyLocked || isCoProgressLocked;
    // Not "current" if co-progress locked or a reference episode.
    const isCurrent = !reference && key === currentId && !isCoProgressLocked;
    const duration = fmtDuration(item.duration);

    const handleClick = () => {
      if (isSequentiallyLocked) return;
      if (isCoProgressLocked) {
        const name = (users || []).find((u) => u.id === coProgressLock.waitingForId)?.name
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
            {!isLocked && !reference && !st.watched && st.percent > 0 && (
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

  // Lesson zone is "multi-unit" when there's more than one lesson unit.
  const isMultiSeason = lessonSeasons.length > 1;

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
            <>
              {isMultiSeason ? (
                [...visibleSeasons].reverse().map((s) => {
                  const eps = [...episodesOf(s.id)].sort((a, b) => (a.itemIndex ?? 0) - (b.itemIndex ?? 0));
                  if (!eps.length) return null;
                  return (
                    <div className="piano-course__season" key={s.id}>
                      <h3 className="piano-course__season-title">{s.title || `Unit ${s.index}`}</h3>
                      <ul className="piano-episodes">{eps.map((ep) => renderEpisode(ep))}</ul>
                    </div>
                  );
                })
              ) : (
                <ul className="piano-episodes">{lessonItems.map((ep) => renderEpisode(ep))}</ul>
              )}

              {referenceSeasons.length > 0 && (
                <div className="piano-course__reference">
                  <h3 className="piano-course__reference-title">Practice &amp; Reference · open anytime</h3>
                  {referenceSeasons.map((s) => {
                    const eps = [...episodesOf(s.id)].sort((a, b) => (a.itemIndex ?? 0) - (b.itemIndex ?? 0));
                    if (!eps.length) return null;
                    return (
                      <div className="piano-course__season piano-course__season--reference" key={s.id}>
                        <h4 className="piano-course__season-title">{s.title || `Unit ${s.index}`}</h4>
                        <ul className="piano-episodes">{eps.map((ep) => renderEpisode(ep, { reference: true }))}</ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
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

- [ ] **Step 4: Run CourseDetail tests — verify all pass**

```bash
cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.test.jsx 2>&1 | tail -20
```

Expected: all 15 tests pass (11 original + 4 new). If the existing "reveals the next season once the prior one is complete" test fails on ordering, note it uses `getByText` (order-independent) so it should pass.

- [ ] **Step 5: Add SCSS for the reference section**

In `frontend/src/Apps/PianoApp.scss`, find the `&__unlock-toast {` rule inside `.piano-course` and the closing of that block:

```scss
  &__unlock-toast {
    position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%);
    background: var(--piano-accent); color: var(--piano-accent-ink);
    padding: 0.7rem 1.4rem; border-radius: 2rem; font-size: 1rem; font-weight: 700;
    z-index: 200; pointer-events: none; white-space: nowrap;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    animation: piano-unlock-pop 0.3s ease-out;
  }
}
```

Replace it with (adds the reference section styles before the closing brace of `.piano-course`):

```scss
  &__unlock-toast {
    position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%);
    background: var(--piano-accent); color: var(--piano-accent-ink);
    padding: 0.7rem 1.4rem; border-radius: 2rem; font-size: 1rem; font-weight: 700;
    z-index: 200; pointer-events: none; white-space: nowrap;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    animation: piano-unlock-pop 0.3s ease-out;
  }

  /* Practice & Reference: always-open, non-gated units below the lesson flow. */
  &__reference {
    margin-top: 1.5rem; padding-top: 1.25rem;
    border-top: 2px solid var(--piano-border, rgba(255, 255, 255, 0.12));
  }
  &__reference-title {
    font-size: 0.78rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--piano-muted); margin: 0 0 1rem;
  }
  &__season--reference { opacity: 0.92; }
}
```

- [ ] **Step 6: Run the full changed test suite together**

```bash
cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs \
  backend/src/4_api/v1/routers/piano.courses.test.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoCoursePlayable.test.js \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.test.jsx 2>&1 | tail -15
```

Expected: all tests pass across the three files.

- [ ] **Step 7: Run the full Videos directory to confirm no regressions**

```bash
cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/ --exclude '**/.claire/**' 2>&1 | tail -8
```

Expected: all files pass (the `.claire` worktree is excluded to avoid a known broken nested copy).

- [ ] **Step 8: Commit**

```bash
cd /opt/Code/DaylightStation
git add \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.jsx \
  frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.test.jsx \
  frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): reference-unit Practice section + descending-unit ordering in CourseDetail"
```

---

## Post-Implementation (operator steps — not part of TDD tasks)

These are deploy/config steps to perform after all three tasks land and pass; they are not code and have no tests.

- [ ] **Add the `reference_units` rule to the live `piano.yml`.** Insert under `videos:` (the served `data/household/config/piano.yml`). Target Better Piano System (`plex:676075`); only takes effect if/when that course is also made sequential, but the Practice & Reference grouping + descending order apply regardless:

  ```yaml
  videos:
    reference_units:
      - courseId: plex:676075
        titlePatterns: ["Exercise Module", "Practice Guide", "Walkthrough", "30-Day Challenge"]
        unitIds: []
  ```

- [ ] **Build + deploy** (run the deploy gate first; do not deploy during a live session/video).
- [ ] **Reload the piano kiosk** so the FKB tablet picks up the new bundle.
