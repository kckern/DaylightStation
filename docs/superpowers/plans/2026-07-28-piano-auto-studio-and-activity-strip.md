# Piano Auto-Studio Entry + Menu Activity Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two approved specs: (1) sustained MIDI playing on the kiosk menu auto-opens Studio; (2) the menu grid anchors flush-bottom with a per-player course-activity strip above it.

**Architecture:** Feature 1 is frontend-only: a pure trigger detector + an arming-state hook mounted in `PianoShell`, config-gated via `piano.yml autoStudio`. Feature 2 adds a backend use case (`GetRecentCourseActivity`, mtime-cached) behind `GET /api/v1/piano/activity/recent`, and a `PianoMenuActivity` strip component that reuses the poster-chip ring/percent/stale language.

**Tech Stack:** React 18 (js/jsx, no TS), Vitest + @testing-library/react (happy-dom) for frontend; node:test for backend units.

## Global Constraints

- Specs (read for context if needed): `docs/superpowers/specs/2026-07-28-piano-auto-studio-design.md`, `docs/superpowers/specs/2026-07-28-piano-menu-activity-strip-design.md`.
- Frontend tests run from `/opt/Code/DaylightStation/frontend`: `npx vitest run <path>`. Backend node:test runs from repo root: `node --test <path>`.
- No raw `console.*` — use the structured logger patterns already in each file.
- Config defaults verbatim: `autoStudio: { enabled: true, minNotes: 8, minSpanSeconds: 3, windowSeconds: 10 }`.
- Log event names verbatim: `piano.auto-studio.enter` (info), `piano.auto-studio.disarm` / `piano.auto-studio.rearm` (debug).
- Note-history entries are `{ note, velocity, startTime, endTime }` (`handleNoteOn`, `frontend/src/modules/Piano/noteHistory.js:45-49`). The detector must compare timestamps ONLY against other entry timestamps (newest entry = "now") — never `Date.now()`, which is a different clock from the MIDI time base.
- Backend name resolution is always `display_name || username || id` — never `p.name`.
- KNOWN pre-existing test failures (do not fix, do not count): `src/Apps/PianoApp.test.jsx` → "shows the connect gate when Web MIDI is unavailable"; 3 Composer editor test files fail to LOAD on a `#frontend/modules/MusicNotation/parseMusicXml.js` alias.
- Commit after each task with the exact message given. Work directly on `main`. Do NOT deploy — the orchestrator deploys after all tasks land.

---

### Task 1: `autoStudio` config defaults

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoConfig.jsx` (defaults object ~line 11; per-piano merge in `resolvePianoConfig` ~line 130)
- Test: `frontend/src/modules/Piano/PianoKiosk/PianoConfig.test.js` (exists — append)

**Interfaces:**
- Produces: `config.autoStudio = { enabled, minNotes, minSpanSeconds, windowSeconds }` with defaults `{ true, 8, 3, 10 }`, deep-merged (defaults ← shared ← per-piano). Tasks 3–4 consume these exact key names.

- [ ] **Step 1: Write the failing tests** — append to `PianoConfig.test.js`, following that file's existing call pattern for `resolvePianoConfig(raw, pianoId)` (read the file's existing tests first and mirror their arrange style exactly):

```js
describe('autoStudio config', () => {
  it('defaults enabled with 8 notes / 3s span / 10s window', () => {
    const cfg = resolvePianoConfig({}, null);
    expect(cfg.autoStudio).toEqual({ enabled: true, minNotes: 8, minSpanSeconds: 3, windowSeconds: 10 });
  });

  it('per-piano overrides merge over defaults', () => {
    const raw = { pianos: { p1: { autoStudio: { minNotes: 12 } } } };
    const cfg = resolvePianoConfig(raw, 'p1');
    expect(cfg.autoStudio.minNotes).toBe(12);
    expect(cfg.autoStudio.enabled).toBe(true);
    expect(cfg.autoStudio.windowSeconds).toBe(10);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/modules/Piano/PianoKiosk/PianoConfig.test.js` — expect the two new tests FAIL (`autoStudio` undefined).

- [ ] **Step 3: Implement** — in `PIANO_CONFIG_DEFAULTS` add:

```js
  // Auto-enter Studio from the menu when sustained playing is detected
  // (spec 2026-07-28-piano-auto-studio-design.md). Count AND span so a
  // key-brush, one chord, or a forearm bump never triggers.
  autoStudio: { enabled: true, minNotes: 8, minSpanSeconds: 3, windowSeconds: 10 },
```

In `resolvePianoConfig`, add alongside the other per-key merges (mirror the file's existing `?? shared ?? default` or spread style for object values — match whichever pattern sibling object keys like `screensaver` use):

```js
    autoStudio: { ...PIANO_CONFIG_DEFAULTS.autoStudio, ...(shared.autoStudio || {}), ...(p.autoStudio || {}) },
```

- [ ] **Step 4: Run to verify all pass** — same command.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/PianoKiosk/PianoConfig.jsx frontend/src/modules/Piano/PianoKiosk/PianoConfig.test.js
git commit -m "feat(piano): autoStudio config defaults"
```

---

### Task 2: Trigger detector (pure)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/autoStudioEntry.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/autoStudioEntry.test.js`

**Interfaces:**
- Produces: `shouldAutoEnterStudio(noteHistory, cfg) => boolean` where `noteHistory` is the live entry array (`{ startTime }` used) and `cfg` is `{ minNotes, minSpanSeconds, windowSeconds }`. The NEWEST entry's `startTime` is the reference clock. Task 3 consumes this exact signature.

- [ ] **Step 1: Write the failing tests**:

```js
import { describe, it, expect } from 'vitest';
import { shouldAutoEnterStudio } from './autoStudioEntry.js';

const CFG = { minNotes: 8, minSpanSeconds: 3, windowSeconds: 10 };
// Entries as the note store appends them ({note, velocity, startTime, endTime}).
const note = (startTime) => ({ note: 60, velocity: 90, startTime, endTime: null });

describe('shouldAutoEnterStudio', () => {
  it('fires on real playing: 8+ notes spread over 3+ seconds', () => {
    const h = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500].map(note);
    expect(shouldAutoEnterStudio(h, CFG)).toBe(true);
  });

  it('does not fire on a single chord (few notes, zero span)', () => {
    const h = [1000, 1000, 1000, 1001, 1001].map(note);
    expect(shouldAutoEnterStudio(h, CFG)).toBe(false);
  });

  it('does not fire on a fast glissando (many notes, span below minimum)', () => {
    const h = Array.from({ length: 15 }, (_, i) => note(1000 + i * 100)); // 1.4s span
    expect(shouldAutoEnterStudio(h, CFG)).toBe(false);
  });

  it('does not fire on slow noodling (span ok, too few notes in window)', () => {
    const h = [0, 2000, 4000, 6000, 8000].map(note); // 5 notes over 8s
    expect(shouldAutoEnterStudio(h, CFG)).toBe(false);
  });

  it('old notes fall out of the rolling window', () => {
    // 7 notes clustered long ago + 1 fresh note: window only sees the fresh one.
    const h = [...[0, 100, 200, 300, 400, 500, 600].map(note), note(60_000)];
    expect(shouldAutoEnterStudio(h, CFG)).toBe(false);
  });

  it('handles empty/short histories without firing', () => {
    expect(shouldAutoEnterStudio([], CFG)).toBe(false);
    expect(shouldAutoEnterStudio([note(0)], CFG)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/modules/Piano/PianoKiosk/autoStudioEntry.test.js` — FAIL (module missing).

- [ ] **Step 3: Implement**:

```js
/**
 * Auto-Studio trigger detector (pure). Fires when, within the rolling
 * `windowSeconds` ending at the NEWEST note, there are at least `minNotes`
 * note-ons whose first→last span is at least `minSpanSeconds`.
 *
 * The newest entry's own startTime is the reference clock — entry times come
 * from the MIDI/bridge time base, which is NOT comparable to Date.now().
 */
export function shouldAutoEnterStudio(noteHistory, cfg) {
  const { minNotes, minSpanSeconds, windowSeconds } = cfg || {};
  if (!Array.isArray(noteHistory) || noteHistory.length < (minNotes || 1)) return false;
  const newest = noteHistory[noteHistory.length - 1]?.startTime;
  if (!Number.isFinite(newest)) return false;
  const windowStart = newest - (windowSeconds || 0) * 1000;
  let count = 0;
  let oldestInWindow = newest;
  for (let i = noteHistory.length - 1; i >= 0; i -= 1) {
    const t = noteHistory[i]?.startTime;
    if (!Number.isFinite(t) || t < windowStart) break; // history is append-ordered
    count += 1;
    oldestInWindow = t;
  }
  return count >= minNotes && (newest - oldestInWindow) >= (minSpanSeconds || 0) * 1000;
}
```

- [ ] **Step 4: Run to verify all pass** — same command.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/PianoKiosk/autoStudioEntry.js frontend/src/modules/Piano/PianoKiosk/autoStudioEntry.test.js
git commit -m "feat(piano): auto-Studio trigger detector (notes + span in rolling window)"
```

---

### Task 3: `useAutoStudioEntry` arming hook

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/useAutoStudioEntry.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/useAutoStudioEntry.test.js`

**Interfaces:**
- Consumes: `shouldAutoEnterStudio(noteHistory, cfg)` (Task 2); config keys from Task 1.
- Produces: `useAutoStudioEntry({ pathname, basePath, noteHistory, autoStudio, inactivityMinutes, consumeIdleReturn, onEnter })` — no return value. Task 4 mounts it with exactly these prop names. `consumeIdleReturn` is `() => boolean` (true exactly once after an idle-driven return navigation).

- [ ] **Step 1: Write the failing tests**:

```js
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAutoStudioEntry } from './useAutoStudioEntry.js';

const CFG = { enabled: true, minNotes: 8, minSpanSeconds: 3, windowSeconds: 10 };
const note = (startTime) => ({ note: 60, velocity: 90, startTime, endTime: null });
const playing = (base = 0) => [0, 500, 1000, 1500, 2000, 2500, 3000, 3500].map((t) => note(base + t));

const base = {
  pathname: '/piano',
  basePath: '/piano',
  noteHistory: [],
  autoStudio: CFG,
  inactivityMinutes: 10,
  consumeIdleReturn: () => false,
};

function mount(props) {
  return renderHook((p) => useAutoStudioEntry(p), { initialProps: { ...base, ...props } });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useAutoStudioEntry', () => {
  it('fires onEnter once when sustained playing happens on the menu', () => {
    const onEnter = vi.fn();
    const { rerender } = mount({ onEnter });
    rerender({ ...base, onEnter, noteHistory: playing() });
    expect(onEnter).toHaveBeenCalledTimes(1);
    // More notes while still on the menu must not re-fire immediately
    rerender({ ...base, onEnter, noteHistory: [...playing(), note(4000)] });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('does not fire off the menu route', () => {
    const onEnter = vi.fn();
    const { rerender } = mount({ onEnter, pathname: '/piano/videos' });
    rerender({ ...base, onEnter, pathname: '/piano/videos', noteHistory: playing() });
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('does not fire when disabled', () => {
    const onEnter = vi.fn();
    const off = { ...CFG, enabled: false };
    const { rerender } = mount({ onEnter, autoStudio: off });
    rerender({ ...base, onEnter, autoStudio: off, noteHistory: playing() });
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('manual Studio→menu exit disarms; playing again does not re-fire', () => {
    const onEnter = vi.fn();
    const { rerender } = mount({ onEnter });
    rerender({ ...base, onEnter, pathname: '/piano/studio' });        // (auto or manual) entry
    rerender({ ...base, onEnter, pathname: '/piano' });               // manual exit → disarm
    rerender({ ...base, onEnter, noteHistory: playing(10_000) });
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('idle-flagged Studio→menu return does NOT disarm', () => {
    const onEnter = vi.fn();
    let idleFlag = false;
    const consumeIdleReturn = () => { const v = idleFlag; idleFlag = false; return v; };
    const props = { ...base, onEnter, consumeIdleReturn };
    const { rerender } = renderHook((p) => useAutoStudioEntry(p), { initialProps: props });
    rerender({ ...props, pathname: '/piano/studio' });
    idleFlag = true;
    rerender({ ...props, pathname: '/piano' });                       // idle return → stays armed
    rerender({ ...props, noteHistory: playing(10_000) });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('re-arms after inactivityMinutes of quiet', () => {
    const onEnter = vi.fn();
    const { rerender } = mount({ onEnter });
    rerender({ ...base, onEnter, pathname: '/piano/studio' });
    rerender({ ...base, onEnter, pathname: '/piano' });               // disarmed
    vi.advanceTimersByTime(10 * 60_000 + 1000);                       // quiet for inactivityMinutes
    rerender({ ...base, onEnter, noteHistory: playing(20_000) });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/modules/Piano/PianoKiosk/useAutoStudioEntry.test.js` — FAIL (module missing).

- [ ] **Step 3: Implement**:

```js
import { useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { shouldAutoEnterStudio } from './autoStudioEntry.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-auto-studio' });
  return _logger;
}

/**
 * Arms auto-entry into Studio from the kiosk menu (spec
 * 2026-07-28-piano-auto-studio-design.md). Armed + on the menu + sustained
 * playing (shouldAutoEnterStudio) → onEnter(). A MANUAL Studio→menu exit
 * disarms; an idle-driven return (consumeIdleReturn() true) does not. Re-arms
 * after `inactivityMinutes` with no notes (wall-clock timer — quiet means no
 * new noteHistory entries).
 */
export function useAutoStudioEntry({ pathname, basePath, noteHistory, autoStudio, inactivityMinutes, consumeIdleReturn, onEnter }) {
  const armedRef = useRef(true);
  const prevPathRef = useRef(pathname);
  const rearmTimerRef = useRef(null);
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const consumeRef = useRef(consumeIdleReturn);
  consumeRef.current = consumeIdleReturn;

  const menuPath = basePath;
  const studioPrefix = `${basePath}/studio`;

  const scheduleRearm = () => {
    if (rearmTimerRef.current) clearTimeout(rearmTimerRef.current);
    rearmTimerRef.current = setTimeout(() => {
      armedRef.current = true;
      logger().debug('piano.auto-studio.rearm', {});
    }, Math.max(1, inactivityMinutes || 10) * 60_000);
  };

  // Route transitions: a manual Studio→menu exit disarms until a fresh sitting.
  useEffect(() => {
    const prev = prevPathRef.current;
    prevPathRef.current = pathname;
    if (prev !== pathname && prev?.startsWith(studioPrefix) && pathname === menuPath) {
      if (!consumeRef.current?.()) {
        armedRef.current = false;
        logger().debug('piano.auto-studio.disarm', { reason: 'manual-exit' });
        scheduleRearm();
      }
    }
  }, [pathname, menuPath, studioPrefix]); // eslint-disable-line react-hooks/exhaustive-deps

  // Note activity: while disarmed, every new note pushes the quiet-gap
  // re-arm timer out; while armed on the menu, evaluate the trigger.
  useEffect(() => {
    if (!noteHistory?.length) return;
    if (!armedRef.current) { scheduleRearm(); return; }
    if (!autoStudio?.enabled || pathname !== menuPath) return;
    if (shouldAutoEnterStudio(noteHistory, autoStudio)) {
      armedRef.current = false; // the navigation satisfies the trigger; route-exit rules take over
      logger().info('piano.auto-studio.enter', { notes: noteHistory.length });
      onEnterRef.current?.();
    }
  }, [noteHistory, autoStudio, pathname, menuPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-arm when landing back on the menu via anything OTHER than a manual
  // studio exit is unnecessary — armedRef only goes false on manual exit or
  // on firing (and firing navigates INTO studio; leaving it re-evaluates).
  useEffect(() => () => { if (rearmTimerRef.current) clearTimeout(rearmTimerRef.current); }, []);
}

export default useAutoStudioEntry;
```

NOTE for the implementer: after firing, `armedRef` is set false so the trigger cannot loop while the navigation propagates; when the user later leaves Studio manually the route effect keeps it disarmed (with re-arm timer), and when they leave via idle-return `consumeIdleReturn()` returns true → the route effect does NOT disarm — but `armedRef` is already false from the fire. To satisfy the idle-return test above, the route effect must therefore RE-ARM on an idle-flagged studio→menu transition. Concretely, inside the transition branch use:

```js
      if (consumeRef.current?.()) {
        armedRef.current = true; // idle return = fresh sitting
        logger().debug('piano.auto-studio.rearm', { reason: 'idle-return' });
      } else {
        armedRef.current = false;
        logger().debug('piano.auto-studio.disarm', { reason: 'manual-exit' });
        scheduleRearm();
      }
```

- [ ] **Step 4: Run to verify all pass** — same command. If a timer test flakes under React 18 flushing, wrapping `vi.advanceTimersByTime` in `act(...)` per in-repo precedent is an accepted adaptation (assertions unchanged; document it).

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/PianoKiosk/useAutoStudioEntry.js frontend/src/modules/Piano/PianoKiosk/useAutoStudioEntry.test.js
git commit -m "feat(piano): useAutoStudioEntry arming hook"
```

---

### Task 4: Wire auto-Studio into PianoShell

**Files:**
- Modify: `frontend/src/Apps/PianoApp.jsx` (PianoShell, ~lines 239–290: imports, the `useInactivityReturn` callback, hook mount)

**Interfaces:**
- Consumes: `useAutoStudioEntry` (Task 3 signature), `config.autoStudio` + `config.inactivityMinutes` (Task 1).

- [ ] **Step 1: Implement** (no new test file — the hook's behavior is covered by Task 3; this is composition. The existing `PianoApp.test.jsx` suite must still pass). In `PianoShell`:

Add imports:

```js
import { useAutoStudioEntry } from '../modules/Piano/PianoKiosk/useAutoStudioEntry.js';
```

(`useRef` is already imported in the file — verify; add it to the React import if not.)

Add an idle-flag ref and set it inside the EXISTING `useInactivityReturn` callback, immediately before its `navigate(home)`:

```js
  const idleReturnRef = useRef(false);
```

```js
  useInactivityReturn(activeNotes, noteHistory.length, config.inactivityMinutes, () => {
    const home = basePath;
    if (location.pathname !== home) {
      logger.info('piano.inactivity-reset', { from: location.pathname, pianoId });
      idleReturnRef.current = true; // mark: the coming studio→menu transition is idle-driven
      navigate(home);
    }
  }, playing);
```

Mount the hook after it:

```js
  // Auto-enter Studio when someone sits down and plays on the menu
  // (spec 2026-07-28-piano-auto-studio-design.md).
  useAutoStudioEntry({
    pathname: location.pathname,
    basePath,
    noteHistory,
    autoStudio: config.autoStudio,
    inactivityMinutes: config.inactivityMinutes,
    consumeIdleReturn: () => { const v = idleReturnRef.current; idleReturnRef.current = false; return v; },
    onEnter: () => navigate(`${basePath}/studio`),
  });
```

(`noteHistory` is already destructured from `usePianoMidiNotes()` in PianoShell — verify; the variable is used by `useIdleGap`/`useInactivityReturn` already via `noteHistory.length`.)

- [ ] **Step 2: Run the app suites** — `npx vitest run src/Apps/PianoApp.test.jsx src/Apps/PianoApp.routing.test.jsx src/modules/Piano/PianoKiosk/useAutoStudioEntry.test.js` — everything passes except the one KNOWN connect-gate failure.

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/Apps/PianoApp.jsx
git commit -m "feat(piano): mount auto-Studio entry in the kiosk shell"
```

---

### Task 5: Backend — plex children seam + `GetRecentCourseActivity` use case

**Files:**
- Create: `backend/src/3_applications/piano/usecases/GetRecentCourseActivity.mjs`
- Modify: `backend/src/3_applications/piano/UserVideoProgressStore.mjs` (add `progressFileMtime`)
- Test: `backend/src/3_applications/piano/usecases/GetRecentCourseActivity.test.mjs`

**Interfaces:**
- Consumes: `userVideoProgressStore.summarize(items, userId) => { completed, total, lastPlayedAt }` (existing); `fitnessPlayableService.getPlayableEpisodes(bareRatingKey) => { info, items }` (existing); `configService.getHouseholdAppConfig(null,'piano')`, `getHouseholdUsers()`, `getUserProfile(id)` (existing); a `plexClient` with `children(ratingKey) => Promise<[{ ratingKey, title, thumb }]>` (injected; Task 6 builds the composition seam).
- Produces:
  - `UserVideoProgressStore.progressFileMtime(userId) => number` (fs mtimeMs, 0 when absent/unknown user).
  - `class GetRecentCourseActivity { constructor({ fitnessPlayableService, userVideoProgressStore, configService, plexClient, logger }) ; async execute() => { players: [{ userId, name, courseId, courseTitle, thumbnail, completed, total, percent, lastPlayedAt }] } }` — players sorted newest `lastPlayedAt` first; users with no lesson-course history omitted. Task 6 wires it; Task 7's endpoint returns its result verbatim.

- [ ] **Step 1: Add `progressFileMtime`** to `UserVideoProgressStore.mjs` (add `import fs from 'fs';` beside the existing `path` import):

```js
  /** mtimeMs of the user's progress file — cache key material. 0 when absent. */
  progressFileMtime(userId) {
    const dir = this.#userDir(userId);
    if (!dir) return 0;
    try { return fs.statSync(path.join(dir, `${this.#filename}.yml`)).mtimeMs; } catch { return 0; }
  }
```

IMPORTANT: check how `loadYaml(path.join(dir, this.#filename))` resolves the extension in this codebase (`FileIO.mjs` appends `.yml`). Mirror whatever the real on-disk name is — if `loadYaml` appends `.yml`, statSync needs the same suffix as written above; verify against an actual data file layout in the store's docblock (`data/users/{userId}/apps/{app}/{filename}.yml`).

- [ ] **Step 2: Write the failing use-case tests** (`node:test`, DI fakes — no fs, no Plex):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetRecentCourseActivity } from './GetRecentCourseActivity.mjs';

const PIANO_CFG = { videos: { collections: [
  { label: 'Music Lessons', plex: ['plex:100'] },
  { label: 'Music Appreciation', plex: ['plex:200'] },
] } };

function makeDeps({ summaries }) {
  // summaries: { [userId]: { [showId]: { completed, total, lastPlayedAt } } }
  return {
    configService: {
      getHouseholdAppConfig: () => PIANO_CFG,
      getHouseholdUsers: () => ['kc', 'learner2'],
      getUserProfile: (id) => ({ display_name: id.toUpperCase() }),
    },
    plexClient: {
      children: async (key) => (String(key) === '100'
        ? [{ ratingKey: '10', title: 'Course A', thumb: '/img/a' }, { ratingKey: '11', title: 'Course B', thumb: '/img/b' }]
        : [{ ratingKey: '20', title: 'Appreciation X', thumb: '/img/x' }]),
    },
    fitnessPlayableService: {
      getPlayableEpisodes: async (id) => ({ info: {}, items: [{ plex: `${id}-e1` }, { plex: `${id}-e2` }] }),
    },
    userVideoProgressStore: {
      progressFileMtime: () => 1,
      summarize: (items, userId) => {
        const showId = String(items[0].plex).split('-')[0];
        return summaries[userId]?.[showId] || { completed: 0, total: items.length, lastPlayedAt: null };
      },
    },
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
  };
}

test('picks each user newest lesson course, sorted most recent first, skipping no-history users', async () => {
  const uc = new GetRecentCourseActivity(makeDeps({ summaries: {
    learner2: {
      10: { completed: 1, total: 2, lastPlayedAt: '2026-07-20T00:00:00Z' },
      11: { completed: 2, total: 2, lastPlayedAt: '2026-07-25T00:00:00Z' },
    },
    kc: { 10: { completed: 1, total: 2, lastPlayedAt: '2026-07-26T00:00:00Z' } },
  } }));
  const { players } = await uc.execute();
  assert.equal(players.length, 2);
  assert.equal(players[0].userId, 'kc');                    // newest first
  assert.equal(players[1].courseId, 'plex:11');             // learner2's newest course
  assert.equal(players[1].courseTitle, 'Course B');
  assert.equal(players[1].completed, 2);
  assert.equal(players[1].percent, 100);
  assert.equal(players[0].name, 'KC');                      // display_name resolution
});

test('appreciation collections are out of scope', async () => {
  const uc = new GetRecentCourseActivity(makeDeps({ summaries: {
    kc: { 20: { completed: 5, total: 2, lastPlayedAt: '2026-07-26T00:00:00Z' } },
  } }));
  const { players } = await uc.execute();
  assert.equal(players.length, 0); // show 20 is in the appreciation group
});

test('caches on unchanged progress mtimes, recomputes on change', async () => {
  const deps = makeDeps({ summaries: { kc: { 10: { completed: 1, total: 2, lastPlayedAt: '2026-07-26T00:00:00Z' } } } });
  let mtime = 1;
  deps.userVideoProgressStore.progressFileMtime = () => mtime;
  let childrenCalls = 0;
  const origChildren = deps.plexClient.children;
  deps.plexClient.children = async (k) => { childrenCalls += 1; return origChildren(k); };
  const uc = new GetRecentCourseActivity(deps);
  await uc.execute();
  const callsAfterFirst = childrenCalls;
  await uc.execute();
  assert.equal(childrenCalls, callsAfterFirst); // cache hit — no re-walk
  mtime = 2;
  await uc.execute();
  assert.ok(childrenCalls > callsAfterFirst);   // mtime change → recompute
});
```

- [ ] **Step 3: Run to verify they fail** — from repo root: `node --test backend/src/3_applications/piano/usecases/GetRecentCourseActivity.test.mjs` — FAIL (module missing).

- [ ] **Step 4: Implement `GetRecentCourseActivity.mjs`**:

```js
/**
 * GetRecentCourseActivity — per-player most-recent lesson-course progress for
 * the kiosk menu activity strip (spec 2026-07-28-piano-menu-activity-strip).
 *
 * Scope: the FIRST group in piano.yml videos.collections (the Music Lessons
 * tab); legacy flat plexCollection when no groups exist. Results cached
 * in-memory keyed on the roster's progress-file mtimes (+ 6h hard TTL for
 * Plex metadata drift) so menu loads never re-walk Plex when nothing changed.
 */
const HARD_TTL_MS = 6 * 60 * 60 * 1000;

export class GetRecentCourseActivity {
  #fitnessPlayableService; #userVideoProgressStore; #configService; #plexClient; #logger;
  #cache = null; // { key, at, result }

  constructor({ fitnessPlayableService, userVideoProgressStore, configService, plexClient, logger = console } = {}) {
    this.#fitnessPlayableService = fitnessPlayableService;
    this.#userVideoProgressStore = userVideoProgressStore;
    this.#configService = configService;
    this.#plexClient = plexClient;
    this.#logger = logger;
  }

  #lessonCollectionIds() {
    const videos = (this.#configService.getHouseholdAppConfig(null, 'piano') || {}).videos || {};
    if (Array.isArray(videos.collections) && videos.collections.length) {
      const group = videos.collections[0];
      const list = Array.isArray(group?.plex) ? group.plex : [group?.plex];
      return list.filter(Boolean).map((id) => String(id).replace(/^plex:/, ''));
    }
    const flat = Array.isArray(videos.plexCollection) ? videos.plexCollection : [videos.plexCollection];
    return flat.filter(Boolean).map((id) => String(id).replace(/^plex:/, ''));
  }

  async execute() {
    const roster = (this.#configService.getHouseholdUsers?.() || []).map(String);
    const key = roster.map((id) => `${id}:${this.#userVideoProgressStore.progressFileMtime(id)}`).join('|');
    if (this.#cache && this.#cache.key === key && Date.now() - this.#cache.at < HARD_TTL_MS) {
      return this.#cache.result;
    }

    const shows = [];
    for (const collectionId of this.#lessonCollectionIds()) {
      try {
        const children = await this.#plexClient.children(collectionId);
        for (const c of children || []) shows.push({ id: String(c.ratingKey), title: c.title || '', thumb: c.thumb || null });
      } catch (err) {
        this.#logger.warn?.('piano.activity.children_failed', { collectionId, error: err.message });
      }
    }

    const perShowItems = new Map();
    for (const show of shows) {
      try {
        const playable = await this.#fitnessPlayableService.getPlayableEpisodes(show.id);
        perShowItems.set(show.id, playable?.items || []);
      } catch (err) {
        this.#logger.warn?.('piano.activity.playable_failed', { showId: show.id, error: err.message });
      }
    }

    const players = [];
    for (const userId of roster) {
      let best = null;
      for (const show of shows) {
        const items = perShowItems.get(show.id);
        if (!items?.length) continue;
        const s = this.#userVideoProgressStore.summarize(items, userId);
        if (!s.lastPlayedAt) continue;
        if (!best || String(s.lastPlayedAt) > String(best.lastPlayedAt)) {
          best = { show, ...s };
        }
      }
      if (!best) continue;
      const p = this.#configService.getUserProfile(userId);
      const percent = best.total > 0 && best.completed > 0
        ? Math.max(1, Math.round((best.completed / best.total) * 100)) : 0;
      players.push({
        userId,
        name: p?.display_name || p?.username || userId,
        courseId: `plex:${best.show.id}`,
        courseTitle: best.show.title,
        thumbnail: best.show.thumb,
        completed: best.completed,
        total: best.total,
        percent,
        lastPlayedAt: best.lastPlayedAt,
      });
    }
    players.sort((a, b) => String(b.lastPlayedAt).localeCompare(String(a.lastPlayedAt)));

    const result = { players };
    this.#cache = { key, at: Date.now(), result };
    this.#logger.info?.('piano.activity.computed', { players: players.length, shows: shows.length });
    return result;
  }
}

export default GetRecentCourseActivity;
```

- [ ] **Step 5: Run to verify all pass** — `node --test backend/src/3_applications/piano/usecases/GetRecentCourseActivity.test.mjs`.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/3_applications/piano/usecases/GetRecentCourseActivity.mjs backend/src/3_applications/piano/usecases/GetRecentCourseActivity.test.mjs backend/src/3_applications/piano/UserVideoProgressStore.mjs
git commit -m "feat(piano): GetRecentCourseActivity use case with mtime-keyed cache"
```

---

### Task 6: Container + composition wiring

**Files:**
- Modify: `backend/src/3_applications/piano/PianoContainer.mjs` (new optional `plexClient` dep + `getRecentCourseActivity()` accessor)
- Modify: `backend/src/app.mjs` (~line 1994 `new PianoContainer({...})`: build and pass a `children`-capable plex seam)

**Interfaces:**
- Consumes: Task 5's class and constructor signature.
- Produces: `pianoContainer.getRecentCourseActivity()` (lazy singleton, same pattern as `getCourseProgress()`); `pianoContainer.isActivityConfigured()` → true only when BOTH `fitnessPlayableService` and `plexClient` are wired. Task 7's router calls both.

- [ ] **Step 1: PianoContainer** — add `#plexClient` field + constructor param `plexClient = null`, plus:

```js
  /** Activity endpoint 503s without the Plex-backed services. */
  isActivityConfigured() {
    return !!this.#fitnessPlayableService && !!this.#plexClient;
  }

  getRecentCourseActivity() {
    if (!this.#getRecentCourseActivity) {
      this.#getRecentCourseActivity = new GetRecentCourseActivity({
        fitnessPlayableService: this.#fitnessPlayableService,
        userVideoProgressStore: this.#userVideoProgressStore,
        configService: this.#configService,
        plexClient: this.#plexClient,
        logger: this.#logger,
      });
    }
    return this.#getRecentCourseActivity;
  }
```

(with the matching `import { GetRecentCourseActivity } from './usecases/GetRecentCourseActivity.mjs';` and `#getRecentCourseActivity;` field declaration.)

- [ ] **Step 2: app.mjs seam** — immediately BEFORE the `new PianoContainer({...})` call (~line 1994), build a minimal children client over the registered Plex adapter. This intentionally mirrors the `schoolPlexClient.children` seam further down (~line 2041, including its thumb proxy-rewrite contract) — read that block first and reproduce the same rewrite:

```js
  // Minimal Plex children seam for the piano activity strip (collection →
  // shows). Same contract as schoolPlexClient.children below: thumbs come
  // back app-proxied.
  const pianoPlexAdapter = contentRegistry?.get('plex') || null;
  const pianoPlexClient = pianoPlexAdapter ? {
    children: async (ratingKey) => {
      if (!pianoPlexAdapter?.client) return [];
      const data = await pianoPlexAdapter.client.getContainer(`/library/metadata/${ratingKey}/children`);
      const items = data?.MediaContainer?.Metadata || [];
      const proxyPath = pianoPlexAdapter.proxyPath;
      return items.map((item) => {
        const rewritten = { ...item };
        if (typeof rewritten.thumb === 'string' && rewritten.thumb.startsWith('/')) {
          rewritten.thumb = `${proxyPath}${rewritten.thumb}`;
        }
        return rewritten;
      });
    },
  } : null;
```

then add `plexClient: pianoPlexClient,` to the `new PianoContainer({...})` args. IMPORTANT: verify `contentRegistry` is in scope at that point in app.mjs (the school block uses it later; if the piano block sits earlier and `contentRegistry` is not yet defined there, move the seam construction to just after `contentRegistry` exists and reference it at the PianoContainer call — the variable must be declared before use).

- [ ] **Step 3: Syntax check + existing backend piano tests** — `node --check backend/src/app.mjs && node --test backend/src/4_api/v1/routers/piano.courses.test.mjs backend/src/3_applications/piano/usecases/GetRecentCourseActivity.test.mjs` — all pass.

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/3_applications/piano/PianoContainer.mjs backend/src/app.mjs
git commit -m "feat(piano): wire plex children seam + recent-activity accessor into PianoContainer"
```

---

### Task 7: `GET /api/v1/piano/activity/recent` endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/piano.mjs` (add route near the `/courses/progress` route ~line 386; add one line to the router docblock route list)
- Test: `backend/src/4_api/v1/routers/piano.activity.test.mjs` (create — mirror the harness style of the existing `piano.courses.test.mjs`: read that file first and copy its router/app construction exactly, swapping in a fake container)

**Interfaces:**
- Consumes: `pianoContainer.isActivityConfigured()`, `pianoContainer.getRecentCourseActivity().execute()` (Task 6).
- Produces: `GET /activity/recent` → `200 { players: [...] }`, or `503 { error: 'Piano activity service not configured' }`.

- [ ] **Step 1: Write the failing router test** — following `piano.courses.test.mjs`'s exact harness (supertest-or-fetch pattern, fake `pianoContainer`), with two cases:

```js
// Shape only — copy the harness (imports, router mounting, request helper)
// from piano.courses.test.mjs verbatim, then:
test('GET /activity/recent returns the use case result', async () => {
  // fake container: isActivityConfigured: () => true,
  // getRecentCourseActivity: () => ({ execute: async () => ({ players: [{ userId: 'kc' }] }) })
  // assert 200 and body { players: [{ userId: 'kc' }] }
});
test('GET /activity/recent 503s when not configured', async () => {
  // fake container: isActivityConfigured: () => false
  // assert 503 and body.error === 'Piano activity service not configured'
});
```

(The final test file must contain real code, not these comments — the comments describe the two cases to write against the copied harness.)

- [ ] **Step 2: Run to verify it fails** — `node --test backend/src/4_api/v1/routers/piano.activity.test.mjs` — FAIL (route absent → 404).

- [ ] **Step 3: Implement the route** in `piano.mjs`, adjacent to `/courses/progress`:

```js
  // ── Menu activity strip: per-player most-recent lesson-course progress ──────
  router.get('/activity/recent', asyncHandler(async (req, res) => {
    if (!pianoContainer.isActivityConfigured()) {
      return res.status(503).json({ error: 'Piano activity service not configured' });
    }
    const result = await pianoContainer.getRecentCourseActivity().execute();
    res.json(result);
  }));
```

Add `GET /activity/recent → { players: [...] }` to the router's docblock route list (~lines 22–49).

- [ ] **Step 4: Run to verify all pass** — same command.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/4_api/v1/routers/piano.mjs backend/src/4_api/v1/routers/piano.activity.test.mjs
git commit -m "feat(piano): /activity/recent endpoint for the menu strip"
```

---

### Task 8: `PianoMenuActivity` strip component

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/PianoMenuActivity.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/PianoMenuActivity.test.jsx`

**Interfaces:**
- Consumes: `GET api/v1/piano/activity/recent` (Task 7 shape); `chipPercent(u)`, `chipIsStale(u)` exported from `./modes/Videos/CourseTile.jsx`; `ProfileAvatar` from `../../../lib/identity/ProfileAvatar.jsx`; `DaylightAPI` from `../../../lib/api.mjs`.
- Produces: `<PianoMenuActivity onOpenCourse={(courseId) => …} />` — renders nothing while loading/empty/on error. Exports pure helper `relativeTime(iso, now) => string` ("just now", "5m ago", "2h ago", "5d ago"). Task 9 mounts it.

- [ ] **Step 1: Write the failing tests**:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let response;
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.resolve(response)) }));
import { DaylightAPI } from '../../../lib/api.mjs';
import PianoMenuActivity, { relativeTime } from './PianoMenuActivity.jsx';

const NOW = Date.parse('2026-07-28T12:00:00Z');
const player = (over = {}) => ({
  userId: 'learner2', name: 'learner2', courseId: 'plex:11', courseTitle: 'Course B',
  thumbnail: '/img/b', completed: 13, total: 57, percent: 23,
  lastPlayedAt: '2026-07-28T10:00:00Z', ...over,
});

beforeEach(() => { DaylightAPI.mockClear(); response = { players: [] }; });

describe('relativeTime', () => {
  it('formats minutes, hours, days', () => {
    expect(relativeTime('2026-07-28T11:59:40Z', NOW)).toBe('just now');
    expect(relativeTime('2026-07-28T11:35:00Z', NOW)).toBe('25m ago');
    expect(relativeTime('2026-07-28T09:00:00Z', NOW)).toBe('3h ago');
    expect(relativeTime('2026-07-23T09:00:00Z', NOW)).toBe('5d ago');
  });
});

describe('PianoMenuActivity', () => {
  it('renders one card per player with ring percent, title, and relative time', async () => {
    response = { players: [player(), player({ userId: 'learner1', name: 'learner1', percent: 1, completed: 3, total: 344, courseTitle: 'Hoffman Academy' })] };
    render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(screen.getByText('Course B')).toBeTruthy());
    expect(screen.getByText('Hoffman Academy')).toBeTruthy();
    expect(screen.getByText('23%')).toBeTruthy();
    expect(document.querySelectorAll('.piano-menu-activity__card')).toHaveLength(2);
  });

  it('dims players idle beyond 7 days', async () => {
    response = { players: [player({ lastPlayedAt: '2026-07-10T00:00:00Z' })] };
    render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(document.querySelector('.piano-menu-activity__card')).toBeTruthy());
    expect(document.querySelector('.piano-menu-activity__card').className).toContain('is-stale');
  });

  it('tapping a card opens that course', async () => {
    const onOpenCourse = vi.fn();
    response = { players: [player()] };
    render(<PianoMenuActivity onOpenCourse={onOpenCourse} />);
    await waitFor(() => expect(screen.getByText('Course B')).toBeTruthy());
    fireEvent.click(screen.getByText('Course B').closest('button'));
    expect(onOpenCourse).toHaveBeenCalledWith('plex:11');
  });

  it('renders nothing when there are no players or the fetch fails', async () => {
    const { container } = render(<PianoMenuActivity onOpenCourse={() => {}} />);
    await waitFor(() => expect(DaylightAPI).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/modules/Piano/PianoKiosk/PianoMenuActivity.test.jsx` — FAIL (module missing).

- [ ] **Step 3: Implement**:

```jsx
import { useEffect, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import { chipPercent, chipIsStale } from './modes/Videos/CourseTile.jsx';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-menu-activity' });
  return _logger;
}

/** "just now" / "Nm ago" / "Nh ago" / "Nd ago" — coarse by design. */
export function relativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const mins = Math.floor(Math.max(0, now - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Menu course-activity strip (spec 2026-07-28-piano-menu-activity-strip):
 * one card per player with course history — avatar in a completion ring
 * (same language as the poster chips), course title, relative time. Tap →
 * that course. Renders nothing while loading, on error, or when empty.
 */
export default function PianoMenuActivity({ onOpenCourse }) {
  const [players, setPlayers] = useState(null);

  useEffect(() => {
    let cancelled = false;
    DaylightAPI('api/v1/piano/activity/recent')
      .then((r) => { if (!cancelled) setPlayers(Array.isArray(r?.players) ? r.players : []); })
      .catch((e) => {
        if (!cancelled) setPlayers([]);
        logger().warn('piano.menu-activity.load-failed', { error: e?.message });
      });
    return () => { cancelled = true; };
  }, []);

  if (!players?.length) return null;
  return (
    <div className="piano-menu-activity" aria-label="Recent course activity">
      {players.map((u) => {
        const pct = chipPercent(u);
        const stale = chipIsStale(u);
        return (
          <button
            type="button"
            key={u.userId}
            className={`piano-menu-activity__card${stale ? ' is-stale' : ''}`}
            onClick={() => onOpenCourse?.(u.courseId)}
            title={`${u.name}: ${u.completed}/${u.total}`}
          >
            <span className="piano-menu-activity__ring">
              <svg viewBox="0 0 36 36" aria-hidden="true">
                <circle className="piano-menu-activity__ring-track" cx="18" cy="18" r={100 / (2 * Math.PI)} />
                <circle
                  className="piano-menu-activity__ring-fill"
                  cx="18" cy="18" r={100 / (2 * Math.PI)}
                  strokeDasharray={`${pct} 100`}
                  transform="rotate(-90 18 18)"
                />
              </svg>
              <ProfileAvatar id={u.userId} name={u.name} />
            </span>
            <span className="piano-menu-activity__meta">
              <span className="piano-menu-activity__pct">{pct}%</span>
              <span className="piano-menu-activity__course">{u.courseTitle}</span>
              <span className="piano-menu-activity__when">{relativeTime(u.lastPlayedAt)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify all pass** — same command.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/PianoKiosk/PianoMenuActivity.jsx frontend/src/modules/Piano/PianoKiosk/PianoMenuActivity.test.jsx
git commit -m "feat(piano): menu activity strip component"
```

---

### Task 9: Menu layout — strip on top, grid flush-bottom

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoMenu.jsx` (mount the strip; add navigate handler)
- Modify: `frontend/src/Apps/PianoApp.scss` (`.piano-home__body` column layout; `.piano-menu-activity` card styles — place next to the `.piano-cover-progress` block whose ring styles it mirrors)
- Test: `frontend/src/modules/Piano/PianoKiosk/PianoMenu.modes.test.js` (exists — append a strip-presence test IF the harness renders `PianoMenu` (read it first); if that file only tests the `PIANO_MODES` array, add the render test to `PianoMenuActivity.test.jsx`'s file instead as an integration-lite case mounting `PianoMenu` with mocked contexts — whichever existing harness pattern reaches `PianoMenu` with least new mocking)

**Interfaces:**
- Consumes: `PianoMenuActivity` (Task 8), existing `idOf`-style stripping (`String(id).replace(/^plex:/, '')`).

- [ ] **Step 1: Mount** — in `PianoMenu.jsx`:

```js
import PianoMenuActivity from './PianoMenuActivity.jsx';
```

In the JSX, insert the strip as the first child of `.piano-home__body`, before the tiles `<ul>`:

```jsx
        <PianoMenuActivity
          onOpenCourse={(courseId) => {
            logger.info('piano.menu-activity.open-course', { courseId });
            navigate(`${basePath}/videos/${String(courseId).replace(/^plex:/, '')}`);
          }}
        />
```

- [ ] **Step 2: Layout SCSS** — locate the `.piano-home__body` rule in `PianoApp.scss` (grep for `piano-home__body`) and change it to a column that pushes the grid down:

```scss
  // Strip on top, tile wall anchored to the bottom (above the live keyboard)
  // with breathing room — spec 2026-07-28-piano-menu-activity-strip.
  .piano-home__body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding-bottom: var(--sp-4);
  }
```

(Preserve any existing properties on that rule that don't conflict — read the current rule first; `justify-content: flex-end` + the strip's `margin-bottom: auto` below produce strip-top/grid-bottom regardless of whether the strip rendered.)

Add the strip styles adjacent to `.piano-cover-progress` (they share the ring vocabulary):

```scss
  // ── Menu activity strip: per-player recent-course cards ─────────────────
  .piano-menu-activity {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-4);
    padding: var(--sp-3) var(--sp-4);
    margin-bottom: auto; // pins the strip to the top while the grid sits flush-bottom
    overflow-x: auto;

    &__card {
      display: inline-flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.5rem 0.9rem;
      border: 0;
      border-radius: var(--r-md, 0.75rem);
      background: rgba(255, 255, 255, 0.06);
      color: inherit;
      cursor: pointer;
      &.is-stale { opacity: 0.45; filter: grayscale(0.55); }
    }

    &__ring {
      position: relative;
      width: 2.6rem;
      height: 2.6rem;
      flex: 0 0 auto;
      svg { position: absolute; inset: 0; width: 100%; height: 100%; }
      &-track { fill: none; stroke: rgba(255, 255, 255, 0.28); stroke-width: 3.4; }
      &-fill { fill: none; stroke: #4ade80; stroke-width: 3.4; stroke-linecap: round; }
      .piano-avatar {
        position: absolute;
        top: 0.3rem;
        left: 0.3rem;
        width: calc(100% - 0.6rem);
        height: calc(100% - 0.6rem);
        font-size: 0.7rem;
      }
    }

    &__meta { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.25; }
    &__pct { font-weight: 700; font-variant-numeric: tabular-nums; }
    &__course { font-size: 0.85rem; opacity: 0.85; max-width: 14rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    &__when { font-size: 0.72rem; opacity: 0.6; }
  }
```

CRITICAL (learned the hard way this week): the avatar `<img>` inside the ring is absolutely positioned — it MUST have explicit width/height (as above), never `width: auto` (a replaced element resolves `auto` to intrinsic size and renders the full-resolution portrait over the page).

- [ ] **Step 3: Test** — per the Files note: add a test that `PianoMenu` renders the strip alongside the tiles using whatever existing harness reaches `PianoMenu` with the least new mocking. The assertion set:

```js
// With DaylightAPI mocked to { players: [player()] } (reuse Task 8's mock pattern):
// - screen.getByText('Course B') (strip card rendered)
// - screen.getByText('Courses') (tile wall still rendered)
```

(Real code in the final test — these lines specify the two assertions.)

- [ ] **Step 4: Run the kiosk menu + activity suites** — `npx vitest run src/modules/Piano/PianoKiosk/PianoMenuActivity.test.jsx src/modules/Piano/PianoKiosk/PianoMenu.modes.test.js src/Apps/PianoApp.test.jsx` — all pass except the KNOWN connect-gate failure.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/PianoKiosk/PianoMenu.jsx frontend/src/Apps/PianoApp.scss frontend/src/modules/Piano/PianoKiosk/PianoMenu.modes.test.js frontend/src/modules/Piano/PianoKiosk/PianoMenuActivity.test.jsx
git commit -m "feat(piano): menu strip mounted, tile wall flush-bottom"
```

---

### Task 10: Full sweep

**Files:** none (verification only)

- [ ] **Step 1: Frontend sweep** — `cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Piano src/Apps/PianoApp.test.jsx src/lib/identity` — everything passes except the KNOWN failures listed in Global Constraints.

- [ ] **Step 2: Backend sweep** — `cd /opt/Code/DaylightStation && node --test backend/src/3_applications/piano/usecases/GetRecentCourseActivity.test.mjs backend/src/4_api/v1/routers/piano.activity.test.mjs backend/src/4_api/v1/routers/piano.courses.test.mjs backend/src/0_system/config/ConfigService.reload.test.mjs` — all pass.

- [ ] **Step 3: Report** — any unexpected failure must be investigated and fixed (or reported BLOCKED), never committed over. No commit in this task unless fixes were needed.

---

## Post-plan (orchestrator only — NOT a subagent task)

Build (`./scripts/build-daylight.sh`), gate-check, `sudo deploy-daylight`, verify `/build.txt` + `GET /api/v1/piano/activity/recent` live, push `main`, reload the piano tablet FKB, and visually verify the menu with the headless screenshot script.
