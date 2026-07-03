# Sheet Music Mode Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the piano kiosk's Sheet Music player with load/playback telemetry, a non-blocking (time-sliced) load, a redesigned chrome (breadcrumb top + pinned bottom transport bar), full-hand play-along with per-staff toggles, and MIDI note-light-up on the engraved score.

**Architecture:** Keep `ScorePlayer.jsx` as the orchestrator but extract growing concerns into hooks/components. Promote "which staves am I responsible for" to a single **active-parts** selection shared by Follow tracking, note light-up, and the keyboard. Split OSMD work into *paint* (fast, blocking-but-short) and *geometry extract* (yielded in slices) so the app stays responsive. All timing logged through the existing structured logging framework (logs-only).

**Tech Stack:** React 18, react-router, Vitest + @testing-library/react, OpenSheetMusicDisplay (OSMD, lazy-loaded), the project logging framework (`frontend/src/lib/logging/Logger.js`).

---

## Context the executor needs

**Where things live:**
- Mode host: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Routing: `.../SheetMusic/SheetMusic.jsx`
- Transport engine: `.../SheetMusic/useScoreTransport.js` (rAF + `performance.now()`; keep, instrument)
- Play-mode part helpers: `.../SheetMusic/playParts.js` (`partsOf`, `cyclePart`, `buildPlayTimeline`, `youMidisAt`)
- Timeline math: `frontend/src/modules/MusicNotation/scoreTimeline.js` (`buildTempoMap`, `msAtQuarter`, `buildStepTimeline`, `buildNoteTimeline`)
- OSMD adapter (ONLY file touching OSMD): `frontend/src/modules/MusicNotation/renderers/osmdRender.js` (`osmdRender`, `osmdReRender`, `extractEvents`, `collectOnsetNotes`, `pickMelodyNote`, `midiOfHalfTone`)
- React renderer wrapper: `frontend/src/modules/MusicNotation/renderers/MusicXmlRenderer.jsx`
- Breadcrumb bus: `.../PianoKiosk/PianoBreadcrumbContext.jsx` (`usePianoBreadcrumb`)
- Always-on header: `.../PianoKiosk/PianoChrome.jsx` (renders breadcrumb; do NOT duplicate a header in the mode)
- Keyboard: `frontend/src/modules/Piano/components/PianoKeyboard.jsx` (supports `activeNotes`/`targetNotes`/`wrongNotes` → `.active`/`.target`/`.wrong`)
- Styles: `frontend/src/Apps/PianoApp.scss` (search `piano-score`)
- Logging: `import getLogger from '.../lib/logging/Logger.js'; getLogger().child({ component })` then `logger.info/warn/debug/sampled(event, data)`

**Testing:**
- Run one file: `npx vitest run <path-to-test>` (config: `vitest.config.mjs`, jsdom env).
- rAF/timer pattern for transport-style tests — copy from `useScoreTransport.test.js` (fake timers + `performance.now` spy + rAF stub off `setTimeout`).
- Pure-logic modules (timelines, telemetry math, part derivation) get plain unit tests — no DOM.
- OSMD itself cannot be unit-tested in jsdom (no real layout). Keep OSMD calls behind thin pure functions and test THOSE with fake OSMD/DOM objects. Do not try to assert real engraving.

**Conventions:**
- Never use raw `console.*` for diagnostics — always the logging framework.
- `.js` frontend utils/hooks, `.jsx` components.
- Relative router navigation only (`navigate('..', { relative: 'path' })`).
- Commit after each task. TDD: failing test first.

**Verification-before-completion:** the final task drives the real app on the tablet/dev server. Do not claim "works" from unit tests alone.

---

## Phase 0 — Groundwork: active-parts model (pure logic, no UI)

### Task 1: `activeParts.js` — derive selectable staves and the responsibility set

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/activeParts.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/activeParts.test.js`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { staffLabels, defaultActiveParts, expectedMidisAtStep, isStepSatisfied } from './activeParts.js';

// notes: flat list from extractLayout, each { midi, staff, onsetQuarter }
const NOTES = [
  { midi: 60, staff: 0, onsetQuarter: 0 }, // RH
  { midi: 48, staff: 1, onsetQuarter: 0 }, // LH (same onset)
  { midi: 64, staff: 0, onsetQuarter: 1 },
];
// steps: one per onset, carrying its onsetQuarter and the midis at it (all staves)
const STEPS = [
  { onsetQuarter: 0, notes: [{ midi: 60, staff: 0 }, { midi: 48, staff: 1 }] },
  { onsetQuarter: 1, notes: [{ midi: 64, staff: 0 }] },
];

describe('activeParts', () => {
  it('labels staves RH/LH/P3…', () => {
    expect(staffLabels([0, 1, 2])).toEqual(['RH', 'LH', 'P3']);
  });

  it('defaults every staff to active (full hand)', () => {
    expect(defaultActiveParts(NOTES)).toEqual({ 0: true, 1: true });
  });

  it('expectedMidisAtStep filters to active staves', () => {
    expect(expectedMidisAtStep(STEPS[0], { 0: true, 1: true })).toEqual(new Set([60, 48]));
    expect(expectedMidisAtStep(STEPS[0], { 0: true, 1: false })).toEqual(new Set([60]));
  });

  it('isStepSatisfied requires ALL active-staff midis struck (all-notes rule)', () => {
    const need = new Set([60, 48]);
    expect(isStepSatisfied(need, new Set([60]))).toBe(false);
    expect(isStepSatisfied(need, new Set([60, 48]))).toBe(true);
    expect(isStepSatisfied(need, new Set([60, 48, 72]))).toBe(true); // extra ok
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/activeParts.test.js`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```javascript
/**
 * activeParts — the single "which staves am I responsible for" model shared by
 * Follow tracking, note light-up, and the keyboard target set. Staves are 0-indexed
 * (0 = top = RH, 1 = LH, …). "Active" = you must play it / it lights as a target.
 */
export function staffLabels(staves) {
  return staves.map((s) => (s === 0 ? 'RH' : s === 1 ? 'LH' : `P${s + 1}`));
}

/** Every staff present in `notes`, all switched on (full-hand default). */
export function defaultActiveParts(notes) {
  const out = {};
  for (const n of notes || []) out[n.staff] = true;
  return out;
}

/** Midis expected at a step, filtered to the active staves. */
export function expectedMidisAtStep(step, active) {
  const set = new Set();
  for (const n of step?.notes || []) if (active[n.staff]) set.add(n.midi);
  return set;
}

/** All-notes rule: every expected midi must be present in the struck set. */
export function isStepSatisfied(expected, struck) {
  for (const m of expected) if (!struck.has(m)) return false;
  return expected.size > 0;
}

export default { staffLabels, defaultActiveParts, expectedMidisAtStep, isStepSatisfied };
```

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/activeParts.test.js`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/activeParts.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/activeParts.test.js
git commit -m "feat(piano): active-parts model — full-hand default + per-staff responsibility set"
```

---

## Phase 1 — Geometry: per-step notes with staff + notehead boxes

### Task 2: `extractEvents` records per-step notes (all staves) with geometry

**Context:** Today `extractEvents` (in `osmdRender.js`) builds `events` from `pickMelodyNote` (top staff ONLY) — this is the root of right-hand-only follow. We add a `steps` array where each step carries EVERY onset note (all staves) with its midi/staff and on-screen box, without removing the existing `events`/`notes` outputs (Play mode still uses them this task; migrated later).

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/osmdRender.js` (`extractEvents`)
- Test: `frontend/src/modules/MusicNotation/renderers/extractSteps.test.js` (new — tests the pure grouping helper only)

**Step 1: Write the failing test for a pure helper**

Extract the grouping into a pure function `buildSteps(onsetRecords)` that we CAN test (the OSMD walk itself stays untested — jsdom has no layout).

```javascript
import { describe, it, expect } from 'vitest';
import { buildSteps } from './osmdRender.js';

// onsetRecords: what the OSMD walk collects per note, pre-grouping
const RECS = [
  { onsetQuarter: 0, midi: 60, staff: 0, x: 10, top: 5,  bottom: 20, width: 8 },
  { onsetQuarter: 0, midi: 48, staff: 1, x: 10, top: 40, bottom: 55, width: 8 },
  { onsetQuarter: 1, midi: 64, staff: 0, x: 30, top: 4,  bottom: 19, width: 8 },
];

describe('buildSteps', () => {
  it('groups onset records into steps by onsetQuarter, keeping all staves', () => {
    const steps = buildSteps(RECS);
    expect(steps).toHaveLength(2);
    expect(steps[0].onsetQuarter).toBe(0);
    expect(steps[0].notes.map((n) => n.midi).sort()).toEqual([48, 60]);
    expect(steps[0].notes.find((n) => n.midi === 48)).toMatchObject({ staff: 1, top: 40 });
    expect(steps[1].notes).toHaveLength(1);
  });

  it('sorts steps by onsetQuarter', () => {
    const steps = buildSteps([RECS[2], RECS[0]]);
    expect(steps.map((s) => s.onsetQuarter)).toEqual([0, 1]);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/MusicNotation/renderers/extractSteps.test.js`
Expected: FAIL (`buildSteps` not exported).

**Step 3: Implement `buildSteps` and wire it into `extractEvents`**

Add the pure helper and export it:

```javascript
/**
 * Group flat onset records (one per note, all staves) into cursor steps keyed by
 * onsetQuarter. Each step carries every note sounding at that onset with its box,
 * so the light-up overlay and the active-parts tracker can work per staff.
 * @param {Array<{onsetQuarter:number, midi:number, staff:number, x:number, top:number, bottom:number, width:number}>} recs
 */
export function buildSteps(recs) {
  const byQuarter = new Map();
  for (const r of recs || []) {
    if (!byQuarter.has(r.onsetQuarter)) byQuarter.set(r.onsetQuarter, { onsetQuarter: r.onsetQuarter, notes: [] });
    byQuarter.get(r.onsetQuarter).notes.push({ midi: r.midi, staff: r.staff, x: r.x, top: r.top, bottom: r.bottom, width: r.width });
  }
  return [...byQuarter.values()].sort((a, b) => a.onsetQuarter - b.onsetQuarter);
}
```

In `extractEvents`, while walking the cursor, collect an `onsetRecords` array. For each onset note, read its notehead box. OSMD graphical note geometry: get the graphical note via `osmd.GraphicSheet` mapping, or read the SVG element bounding box relative to `host`. Implementation detail for the executor:

- Preferred: for each `Note` under the cursor, find its `GraphicalNote` via `osmd.GraphicSheet.GetGraphicalNoteFromNote?.(n)` (guard with `?.` — API varies by OSMD version) → `gnote.PositionAndShape.AbsolutePosition` gives OSMD units; convert to px: `px = unit * 10 * osmd.Zoom` (OSMD's unit = 10px at zoom 1). Box: `x = AbsolutePosition.x * 10 * zoom`, similar for y and size.
- Fallback if the graphical mapping is unavailable: reuse the cursor element box (`el.offsetLeft/offsetTop/offsetWidth/offsetHeight`) for ALL notes at that onset (they share the cursor's x band; y split can be approximated by staff index). This keeps the pipeline working; the light-up falls back to a per-step band marker (Phase 5 handles the fallback rendering).

Then: `const steps = buildSteps(onsetRecords);` and add `steps` to the returned object. Keep `events`, `notes`, `tempoEntries` as-is this task.

Return shape becomes `{ width, height, flow, events, notes, tempoEntries, steps, osmd }`.

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/MusicNotation/renderers/extractSteps.test.js`
Expected: PASS (2 tests). Also run the existing OSMD test to ensure no regression: `npx vitest run frontend/src/modules/MusicNotation/renderers/osmdRender.test.js`.

**Step 5: Commit**

```bash
git add frontend/src/modules/MusicNotation/renderers/osmdRender.js frontend/src/modules/MusicNotation/renderers/extractSteps.test.js
git commit -m "feat(notation): extract per-step notes across all staves with notehead geometry"
```

---

### Task 3: Thread `steps` through `MusicXmlRenderer.onLayout`

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/MusicXmlRenderer.jsx` (pass `steps` through — it already spreads the `osmdRender`/`osmdReRender` result into `onLayout`; verify `steps` is included)
- Modify: `frontend/src/modules/MusicNotation/renderers/osmdRender.js` (`osmdReRender` must also return `steps` — it calls `extractEvents`, so just include `steps` in its return object)

**Step 1–4:** No new unit test (pure plumbing verified by Task 2 + downstream tasks). Confirm by grep that `onLayout` consumers receive `steps`. Add `steps` to `osmdReRender`'s returned object: `return { width, height, flow: opts.flow, events, notes, tempoEntries, steps, osmd };`.

**Step 5: Commit**

```bash
git add frontend/src/modules/MusicNotation/renderers/osmdRender.js frontend/src/modules/MusicNotation/renderers/MusicXmlRenderer.jsx
git commit -m "feat(notation): surface per-step geometry through onLayout"
```

---

## Phase 2 — Telemetry (logs-only)

### Task 4: `scoreTelemetry.js` — pure timing math

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreTelemetry.js`
- Test: `.../SheetMusic/scoreTelemetry.test.js`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { summarizeDrift, classifyFollowHit } from './scoreTelemetry.js';

describe('scoreTelemetry', () => {
  it('summarizeDrift → mean/p95/max/stalls over fire deltas', () => {
    const s = summarizeDrift([2, 4, 6, 8, 200], { stallMs: 120 });
    expect(s.maxDriftMs).toBe(200);
    expect(s.stalls).toBe(1);
    expect(s.meanDriftMs).toBeCloseTo(44, 0);
    expect(s.p95DriftMs).toBe(200);
  });

  it('summarizeDrift handles empty input', () => {
    expect(summarizeDrift([], { stallMs: 120 })).toMatchObject({ maxDriftMs: 0, stalls: 0, meanDriftMs: 0 });
  });

  it('classifyFollowHit → signed drift vs expected interval (− rush, + drag)', () => {
    expect(classifyFollowHit({ expectedMs: 500, actualMs: 450 })).toMatchObject({ driftMs: -50, feel: 'rush' });
    expect(classifyFollowHit({ expectedMs: 500, actualMs: 560 })).toMatchObject({ driftMs: 60, feel: 'drag' });
    expect(classifyFollowHit({ expectedMs: 500, actualMs: 505 })).toMatchObject({ feel: 'tight' });
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreTelemetry.test.js`
Expected: FAIL.

**Step 3: Implement**

```javascript
/**
 * scoreTelemetry — pure timing math for the sheet-music player's logs-only
 * telemetry. No logging here (callers emit); this just turns raw deltas into the
 * numbers the log events carry, so it's unit-testable off the DOM.
 */
export function summarizeDrift(deltas, { stallMs = 120 } = {}) {
  const d = (deltas || []).filter((x) => Number.isFinite(x));
  if (!d.length) return { count: 0, meanDriftMs: 0, p95DriftMs: 0, maxDriftMs: 0, stalls: 0 };
  const sorted = [...d].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const sum = d.reduce((a, b) => a + b, 0);
  return {
    count: d.length,
    meanDriftMs: sum / d.length,
    p95DriftMs: p95,
    maxDriftMs: sorted[sorted.length - 1],
    stalls: d.filter((x) => x >= stallMs).length,
  };
}

const TIGHT_MS = 25;
export function classifyFollowHit({ expectedMs, actualMs }) {
  const driftMs = Math.round(actualMs - expectedMs);
  const feel = Math.abs(driftMs) <= TIGHT_MS ? 'tight' : driftMs < 0 ? 'rush' : 'drag';
  return { driftMs, feel };
}

export default { summarizeDrift, classifyFollowHit };
```

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreTelemetry.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreTelemetry.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreTelemetry.test.js
git commit -m "feat(piano): score telemetry timing math (drift summary + follow-hit feel)"
```

---

### Task 5: Instrument the transport for fire-jitter

**Context:** `useScoreTransport.tick` fires events when `pos = now − anchor >= t`. We add an optional `onFire(event, driftMs, frameGapMs)` callback so ScorePlayer can record jitter WITHOUT the transport knowing about logging.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTransport.js`
- Modify: `.../SheetMusic/useScoreTransport.test.js` (add a fire-jitter test)

**Step 1: Write the failing test**

```javascript
it('reports fire drift and frame gap via onFire', () => {
  const fires = [];
  const { result } = renderHook(() => useScoreTransport({
    timeline: [{ t: 0, index: 0 }, { t: 100, index: 1 }],
    onEvent: () => {},
    onFire: (e, driftMs, gapMs) => fires.push({ i: e.index, driftMs, gapMs }),
  }));
  act(() => result.current.play());
  act(() => vi.advanceTimersByTime(200));
  expect(fires.length).toBe(2);
  // drift is non-negative (fired at/after scheduled t); gaps are finite
  expect(fires.every((f) => f.driftMs >= 0 && Number.isFinite(f.gapMs))).toBe(true);
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTransport.test.js`
Expected: FAIL (`onFire` never called).

**Step 3: Implement**

Add `onFire` to the destructured props and a ref. Track last frame time. In `tick`, before firing an event compute `driftMs = pos - tl[idx].t`; compute `frameGapMs = pos - lastPosRef.current` once per tick. Call `onFireRef.current?.(tl[idx], driftMs, frameGapMs)` alongside `onEvent`.

```javascript
export function useScoreTransport({ timeline, onEvent, onFire, onDone }) {
  // ...existing refs...
  const onFireRef = useRef(onFire); onFireRef.current = onFire;
  const lastPosRef = useRef(0);

  const tick = useCallback(() => {
    const tl = timelineRef.current;
    const pos = performance.now() - anchorRef.current;
    const frameGapMs = pos - lastPosRef.current;
    lastPosRef.current = pos;
    while (idxRef.current < tl.length && tl[idxRef.current].t <= pos) {
      const ev = tl[idxRef.current];
      onFireRef.current?.(ev, pos - ev.t, frameGapMs);
      onEventRef.current?.(ev);
      idxRef.current += 1;
    }
    // ...unchanged tail...
  }, []);
  // in play(): lastPosRef.current = posRef.current;
```

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTransport.test.js`
Expected: PASS (all existing + new).

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTransport.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTransport.test.js
git commit -m "feat(piano): transport reports per-fire drift + frame gap (jitter telemetry hook)"
```

---

### Task 6: `useScoreTelemetry` hook — collect + emit log events

**Context:** One place that owns the child logger and the running collectors. ScorePlayer feeds it load phases, transport fires, and follow hits; it emits the events from Section 4 of the design.

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.js`
- Test: `.../SheetMusic/useScoreTelemetry.test.js`

**Step 1: Write the failing test** (mock the logger)

```javascript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const logged = [];
vi.mock('../../../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({
    info: (e, d) => logged.push(['info', e, d]),
    warn: (e, d) => logged.push(['warn', e, d]),
    debug: (e, d) => logged.push(['debug', e, d]),
    sampled: (e, d) => logged.push(['sampled', e, d]),
  }) }),
}));

import { useScoreTelemetry } from './useScoreTelemetry.js';

beforeEach(() => { logged.length = 0; });

describe('useScoreTelemetry', () => {
  it('emits score.load with phase breakdown', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => result.current.logLoad({ fetchMs: 10, parseMs: 5, engraveMs: 200, extractMs: 80, totalMs: 300, steps: 40, measures: 12, staves: 2, osmdWarm: true }));
    const ev = logged.find(([, e]) => e === 'score.load');
    expect(ev[2]).toMatchObject({ id: 'x', engraveMs: 200, totalMs: 300 });
  });

  it('emits a stall warn when a fire drifts past threshold, and a stats rollup', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => { result.current.recordFire({ step: 3 }, 200, 60, 90); });
    expect(logged.some(([lvl, e]) => lvl === 'warn' && e === 'score.playback.stall')).toBe(true);
    act(() => result.current.flushPlayback('play'));
    const stats = logged.find(([, e]) => e === 'score.playback.stats');
    expect(stats[2]).toMatchObject({ mode: 'play', maxDriftMs: 200, stalls: 1 });
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.test.js`
Expected: FAIL.

**Step 3: Implement** (uses `scoreTelemetry.js` math; keeps per-run collectors in refs)

```javascript
import { useMemo, useRef, useCallback } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { summarizeDrift, classifyFollowHit } from './scoreTelemetry.js';

const STALL_MS = 120;
const FRAME_GAP_MS = 50;

export function useScoreTelemetry({ id }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-score-player' }), []);
  const drifts = useRef([]);
  const gaps = useRef([]);
  const stalls = useRef(0);
  const follow = useRef([]);

  const logLoad = useCallback((phases) => logger.info('score.load', { id, ...phases }), [logger, id]);
  const logLoadFailed = useCallback((phase, error) => logger.warn('score.load.failed', { id, phase, error }), [logger, id]);

  const recordFire = useCallback((ev, driftMs, gapMs, bpm) => {
    drifts.current.push(driftMs); gaps.current.push(gapMs);
    if (driftMs >= STALL_MS || gapMs >= FRAME_GAP_MS) {
      stalls.current += 1;
      logger.warn('score.playback.stall', { step: ev.step ?? ev.index, driftMs: Math.round(driftMs), gapMs: Math.round(gapMs), bpm });
    }
  }, [logger]);

  const flushPlayback = useCallback((mode) => {
    const d = summarizeDrift(drifts.current, { stallMs: STALL_MS });
    logger.info('score.playback.stats', {
      mode, events: d.count,
      meanDriftMs: Math.round(d.meanDriftMs), p95DriftMs: Math.round(d.p95DriftMs), maxDriftMs: Math.round(d.maxDriftMs),
      stalls: stalls.current, maxFrameGapMs: Math.round(Math.max(0, ...gaps.current, 0)),
    });
    drifts.current = []; gaps.current = []; stalls.current = 0;
  }, [logger]);

  const recordFollowHit = useCallback(({ step, note, expectedMs, actualMs }) => {
    const c = classifyFollowHit({ expectedMs, actualMs });
    follow.current.push(c.driftMs);
    logger.sampled('score.follow.timing', { step, note, expectedMs: Math.round(expectedMs), actualMs: Math.round(actualMs), driftMs: c.driftMs, feel: c.feel }, { maxPerMinute: 20, aggregate: true });
  }, [logger]);

  const flushFollow = useCallback((hits, wrongs) => {
    const abs = follow.current.map(Math.abs);
    const mean = abs.length ? abs.reduce((a, b) => a + b, 0) / abs.length : 0;
    logger.info('score.follow.stats', {
      hits, wrongs, meanAbsDriftMs: Math.round(mean),
      rushPct: pct(follow.current, (x) => x < -25), dragPct: pct(follow.current, (x) => x > 25),
    });
    follow.current = [];
  }, [logger]);

  return { logLoad, logLoadFailed, recordFire, flushPlayback, recordFollowHit, flushFollow };
}

function pct(arr, pred) { return arr.length ? Math.round((arr.filter(pred).length / arr.length) * 100) : 0; }

export default useScoreTelemetry;
```

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.test.js
git commit -m "feat(piano): useScoreTelemetry — logs-only load/playback/follow timing events"
```

---

## Phase 3 — Non-blocking load (paint first, yield the extract)

### Task 7: Split OSMD into `osmdEngrave` (paint) + yielded extraction

**Context:** Section 3 of the design. Today `osmdRender` does load+render+extract in one blocking call. Split so paint returns first.

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/osmdRender.js`
- Test: `.../renderers/osmdChunk.test.js` (test the pure slicer, not OSMD)

**Step 1: Write the failing test for the slice scheduler**

Add a pure helper `runSliced(total, sliceSize, doSlice, yieldFn)` that processes `[0,total)` in slices, yielding between, calling `onProgress`. Test it with a synchronous fake yield.

```javascript
import { describe, it, expect } from 'vitest';
import { runSliced } from './osmdRender.js';

describe('runSliced', () => {
  it('processes all indices in order, in slices, reporting progress', async () => {
    const seen = [];
    const progress = [];
    const immediateYield = (cb) => cb();
    await runSliced(5, 2, (i) => seen.push(i), immediateYield, (p) => progress.push(p));
    expect(seen).toEqual([0, 1, 2, 3, 4]);
    expect(progress[progress.length - 1]).toBe(1); // finished at 100%
  });

  it('aborts mid-way when shouldAbort flips', async () => {
    const seen = [];
    let calls = 0;
    const immediateYield = (cb) => cb();
    await runSliced(10, 2, (i) => seen.push(i), immediateYield, () => {}, () => (++calls >= 2));
    expect(seen.length).toBeLessThan(10);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/MusicNotation/renderers/osmdChunk.test.js`
Expected: FAIL.

**Step 3: Implement `runSliced`, `osmdEngrave`, and a yielded `extractLayoutSliced`**

```javascript
/** Cooperative time-slicer: process [0,total) in slices, yielding between them. */
export async function runSliced(total, sliceSize, doSlice, yieldFn, onProgress, shouldAbort = () => false) {
  let i = 0;
  while (i < total) {
    if (shouldAbort()) return false;
    const end = Math.min(total, i + sliceSize);
    for (; i < end; i++) doSlice(i);
    onProgress?.(total ? i / total : 1);
    if (i < total) await new Promise((r) => yieldFn(r));
  }
  onProgress?.(1);
  return true;
}

/** Default yield: idle callback when available, else a macrotask. */
export function scheduleYield(cb) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => cb(), { timeout: 50 });
  else setTimeout(cb, 0);
}
```

- `osmdEngrave(host, xml, opts)`: everything in current `osmdRender` UP TO and INCLUDING `osmd.render()`, returning `{ osmd, width, height, flow }` — NO extraction. Fast paint.
- Refactor `extractEvents` so its per-cursor-step body is callable one step at a time, OR keep `extractEvents` but wrap the walk in `runSliced` via a new `extractLayoutSliced(osmd, { sliceSize, yieldFn, onProgress, shouldAbort })` that returns `{ events, notes, steps, tempoEntries }`. Because the OSMD cursor is stateful (`cursor.next()`), the slice body advances the cursor N times per slice. Preserve the `guard < 50000` bound.
- Keep the old synchronous `osmdRender`/`osmdReRender` exports working (they can call `osmdEngrave` then a synchronous full extract) so nothing else breaks yet; the wrapper migrates to sliced in Task 8.

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/MusicNotation/renderers/osmdChunk.test.js` and `npx vitest run frontend/src/modules/MusicNotation/renderers/osmdRender.test.js`
Expected: PASS (both).

**Step 5: Commit**

```bash
git add frontend/src/modules/MusicNotation/renderers/osmdRender.js frontend/src/modules/MusicNotation/renderers/osmdChunk.test.js
git commit -m "feat(notation): split engrave (paint) from sliced geometry extraction"
```

---

### Task 8: `MusicXmlRenderer` paints first, arms interactivity after (progress)

**Context:** Make the wrapper call `osmdEngrave` → set dims (paint) → run `extractLayoutSliced` with `onProgress` → call `onLayout` when complete. Expose progress + a "ready" flag so ScorePlayer can show a determinate bar and enable Follow/Play only when armed.

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/MusicXmlRenderer.jsx`

**Changes (no new unit test — jsdom can't drive OSMD; covered by the Task 7 slicer test + Task 14 live run):**
- New props: `onProgress?(fraction)`, `onReady?()`.
- Effect flow: `setRendering(true)` → `await osmdEngrave(...)` → if stale/abort return → `setDims`, paint is now visible, `setRendering(false)` (sheet shows; Manual usable) → then `await extractLayoutSliced(osmd, { sliceSize: 256, yieldFn: scheduleYield, onProgress, shouldAbort: stale })` → `onLayout(result)` + `onReady()`.
- Keep the cheap `osmdReRender` path for zoom/flow but run its extraction through the same sliced call.
- Add a small `.musicxml-renderer__progress` element driven by the progress fraction while extracting (styled in Task 11).

**Step: Commit**

```bash
git add frontend/src/modules/MusicNotation/renderers/MusicXmlRenderer.jsx
git commit -m "feat(notation): paint-first render with determinate extraction progress"
```

---

### Task 9: Prefetch OSMD when the score grid mounts

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/osmdRender.js` (export `prefetchOsmd()` that just calls the existing lazy `loadOsmd()`)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreGrid.jsx` (call `prefetchOsmd()` in a mount effect; guard for test env)

**Step 1: Add + call**

```javascript
// osmdRender.js
export function prefetchOsmd() { return loadOsmd(); }
```
```javascript
// ScoreGrid.jsx — mount effect
useEffect(() => { prefetchOsmd?.().catch(() => {}); }, []);
```

**Step 2: Commit**

```bash
git add frontend/src/modules/MusicNotation/renderers/osmdRender.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreGrid.jsx
git commit -m "perf(piano): warm the OSMD engine when the score grid mounts"
```

---

## Phase 4 — Chrome redesign (breadcrumb top, pinned bottom bar)

### Task 10: `ScoreTransportBar` component

**Context:** Section 2. Pull the top `__bar` controls into a pinned bottom bar. Mode tabs (left), playback cluster (center), view/parts (right). Mode-aware part chips.

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.jsx`
- Test: `.../SheetMusic/ScoreTransportBar.test.jsx`

**Step 1: Write the failing test** (render-only; assert structure + callbacks)

```javascript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScoreTransportBar from './ScoreTransportBar.jsx';

const base = {
  mode: 'follow', onMode: vi.fn(),
  running: false, onToggleRun: vi.fn(), onReset: vi.fn(),
  step: 0, total: 40,
  flow: 'wrapped', onToggleFlow: vi.fn(),
  scale: 1, onZoomIn: vi.fn(), onZoomOut: vi.fn(),
  parts: [{ staff: 0, label: 'RH' }, { staff: 1, label: 'LH' }],
  activeParts: { 0: true, 1: true }, roles: {}, onCyclePart: vi.fn(),
  keyboardVisible: true, onToggleKeyboard: vi.fn(),
  meta: { title: 'X', tempo: 90 },
};

describe('ScoreTransportBar', () => {
  it('renders the four mode tabs and fires onMode', () => {
    render(<ScoreTransportBar {...base} />);
    fireEvent.click(screen.getByRole('tab', { name: /metronome/i }));
    expect(base.onMode).toHaveBeenCalledWith('metronome');
  });

  it('shows one part chip per staff and cycles it', () => {
    render(<ScoreTransportBar {...base} />);
    fireEvent.click(screen.getByRole('button', { name: /LH/ }));
    expect(base.onCyclePart).toHaveBeenCalledWith(1);
  });

  it('shows position readout total', () => {
    render(<ScoreTransportBar {...base} />);
    expect(screen.getByText(/\/\s*40/)).toBeInTheDocument();
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.test.jsx`
Expected: FAIL.

**Step 3: Implement** the presentational component (all state lifted to props; no MIDI/logging here). Part chip label: Follow/Metronome → `RH ✓`/dimmed; Play → `RH: Play/You/Mute` via `roles`. ⓘ metadata button opens a popover (local `useState`). Keyboard toggle button. Reset/play only meaningful for metronome/play but render position always.

**Step 4: Run to verify it passes** — PASS (3 tests).

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.test.jsx
git commit -m "feat(piano): pinned bottom ScoreTransportBar (modes, playback, parts, view)"
```

---

### Task 11: Styles — bottom bar, note-light-up, progress, keyboard slot

**Files:**
- Modify: `frontend/src/Apps/PianoApp.scss` (search `piano-score`)

**Changes:**
- `.piano-score-player` becomes a flex column filling the mode area: header (chrome, outside) / `.piano-score-player__scroll` (flex:1) / optional `.piano-score-player__keys` / `.piano-score-transportbar` (flex:0, pinned bottom, safe-area padding).
- Remove/retire `.piano-score-player__bar`, `.piano-score-bodytitle*` rules (title now in breadcrumb).
- Add `.piano-score-transportbar` (segmented mode tabs, groups), `.piano-score-partchip--on/--off/--you/--mute`.
- Add `.piano-score-note` overlay chip states: `--target` (dim outline), `--hit` (solid, uses `--nh-color`), `--missed` (dim red flash). Reuse cursor palette variables.
- Add `.musicxml-renderer__progress` (thin determinate bar).
- Keyboard slot works in BOTH flows now (not horizontal-only).

**Step: Commit**

```bash
git add frontend/src/Apps/PianoApp.scss
git commit -m "style(piano): bottom transport bar, note light-up states, load progress"
```

---

## Phase 5 — Follow tracker + note light-up

### Task 12: `useFollowTracker` — full-hand matching + telemetry emit

**Context:** Section 1 + 5. Replaces the inline Follow effect in ScorePlayer. Consumes `steps` + `activeParts`; on each MIDI `note_on`, adds to the current step's struck set; when `isStepSatisfied`, advance and record a follow hit (timing vs `stepTimeline`); wrong notes flash + count.

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useFollowTracker.js`
- Test: `.../SheetMusic/useFollowTracker.test.js`

**Step 1: Write the failing test** (drive with a fake subscribe; assert advance requires all active-staff notes)

```javascript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFollowTracker } from './useFollowTracker.js';

function makeSubscribe() {
  let cb = null;
  const subscribe = (fn) => { cb = fn; return () => { cb = null; }; };
  return { subscribe, emit: (note) => cb?.({ type: 'note_on', velocity: 80, note }) };
}

const STEPS = [
  { onsetQuarter: 0, notes: [{ midi: 60, staff: 0 }, { midi: 48, staff: 1 }] },
  { onsetQuarter: 1, notes: [{ midi: 64, staff: 0 }] },
];

describe('useFollowTracker', () => {
  it('does NOT advance until all active-staff notes are struck', () => {
    const { subscribe, emit } = makeSubscribe();
    const onStep = vi.fn();
    renderHook(() => useFollowTracker({ enabled: true, steps: STEPS, activeParts: { 0: true, 1: true }, step: 0, subscribe, onStep, onHit: vi.fn(), onWrong: vi.fn() }));
    act(() => emit(60));
    expect(onStep).not.toHaveBeenCalled(); // LH 48 still needed
    act(() => emit(48));
    expect(onStep).toHaveBeenCalledWith(1);
  });

  it('advances on the melody note alone when LH is deactivated', () => {
    const { subscribe, emit } = makeSubscribe();
    const onStep = vi.fn();
    renderHook(() => useFollowTracker({ enabled: true, steps: STEPS, activeParts: { 0: true, 1: false }, step: 0, subscribe, onStep, onHit: vi.fn(), onWrong: vi.fn() }));
    act(() => emit(60));
    expect(onStep).toHaveBeenCalledWith(1);
  });

  it('flags a plausible wrong note (within 2 octaves, not expected)', () => {
    const { subscribe, emit } = makeSubscribe();
    const onWrong = vi.fn();
    renderHook(() => useFollowTracker({ enabled: true, steps: STEPS, activeParts: { 0: true, 1: true }, step: 0, subscribe, onStep: vi.fn(), onHit: vi.fn(), onWrong }));
    act(() => emit(61));
    expect(onWrong).toHaveBeenCalled();
  });
});
```

**Step 2: Run to verify it fails** — FAIL.

**Step 3: Implement** `useFollowTracker`. Maintain a `struck` ref reset when `step` changes. On `note_on`: compute `expected = expectedMidisAtStep(steps[step], activeParts)`; if the note is in `expected`, add to `struck`, call `onHit(note)` (drives light-up); if `isStepSatisfied(expected, struck)` → `onStep(step+1)` (capped) and reset struck. Else if not expected and `within 24 semitones of any expected` → `onWrong()`. Expose nothing (side-effect hook). ScorePlayer passes `onHit` to update the lit-note set and `onStep` to call the telemetry `recordFollowHit` with `expectedMs = stepTimeline[step].t - stepTimeline[prevStep].t`, `actualMs = now - lastHitWall`.

**Step 4: Run to verify it passes** — PASS (3 tests).

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useFollowTracker.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useFollowTracker.test.js
git commit -m "feat(piano): full-hand Follow tracker (active-parts, all-notes advance, wrong-note flag)"
```

---

### Task 13: `NoteHighlightLayer` + integrate everything into `ScorePlayer`

**Context:** The big integration. Rewrite `ScorePlayer.jsx` to: use `steps`/`activeParts`, render `ScoreTransportBar` at the bottom (delete `__bar` + `titleBlock`), render `NoteHighlightLayer` in the overlay, wire `useFollowTracker` + `useScoreTelemetry`, feed transport `onFire`, show keyboard when toggled (both flows).

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/NoteHighlightLayer.jsx`
- Create: `.../SheetMusic/NoteHighlightLayer.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Modify: `.../SheetMusic/ScorePlayer.test.jsx` (update for new structure)

**Step 1: Write the failing test for `NoteHighlightLayer`**

```javascript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import NoteHighlightLayer from './NoteHighlightLayer.jsx';

const step = { notes: [{ midi: 60, staff: 0, x: 10, top: 5, bottom: 20, width: 8 }, { midi: 48, staff: 1, x: 10, top: 40, bottom: 55, width: 8 }] };

describe('NoteHighlightLayer', () => {
  it('renders one chip per active-staff note with the right state', () => {
    const { container } = render(
      <NoteHighlightLayer step={step} activeParts={{ 0: true, 1: true }} struck={new Set([60])} scale={1} accent="#2ec46f" />,
    );
    const chips = container.querySelectorAll('.piano-score-note');
    expect(chips.length).toBe(2);
    expect(container.querySelector('.piano-score-note--hit')).toBeTruthy();    // 60 struck
    expect(container.querySelector('.piano-score-note--target')).toBeTruthy(); // 48 not yet
  });

  it('omits notes on deactivated staves', () => {
    const { container } = render(
      <NoteHighlightLayer step={step} activeParts={{ 0: true, 1: false }} struck={new Set()} scale={1} accent="#2ec46f" />,
    );
    expect(container.querySelectorAll('.piano-score-note').length).toBe(1);
  });
});
```

**Step 2: Run to verify it fails** — FAIL.

**Step 3: Implement** `NoteHighlightLayer` (pure: maps `step.notes` filtered by `activeParts` to absolutely-positioned chips; state = `struck.has(midi) ? 'hit' : 'target'`, plus a `missed` set prop for the flash; `--nh-color` from `accent`, box from note geometry × `scale`). Then rewrite `ScorePlayer.jsx`:
- State: `activeParts` (init `defaultActiveParts(layout.notes)` keyed to staff signature like today's `roles`), `struck` set (from `useFollowTracker.onHit`, cleared on step change), `keyboardVisible`.
- Derive `stepTimeline` and, in metronome/play, drive `struck`/lit notes off `note_on` events (bouncing ball).
- Replace inline Follow effect with `useFollowTracker`.
- Transport gets `onFire={(ev, drift, gap) => telemetry.recordFire(...)}`.
- On pause/done/stop → `telemetry.flushPlayback(mode)`; on leaving Follow / unmount → `telemetry.flushFollow(hits, wrongs)`.
- Delete `MODES` top-bar JSX + `titleBlock`; render `<ScoreTransportBar .../>` at bottom; keyboard block when `keyboardVisible`.
- `NotationScore` load timing: wrap the fetch in timers and pass phase deltas; the engrave/extract deltas come from `MusicXmlRenderer` via a new `onTiming` callback → `telemetry.logLoad`.

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/`
Expected: PASS (all SheetMusic tests, including updated `ScorePlayer.test.jsx`).

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
git commit -m "feat(piano): integrate light-up, full-hand follow, bottom bar, telemetry into ScorePlayer"
```

---

## Phase 6 — Verify & document

### Task 14: Live verification on the real player

**REQUIRED SUB-SKILL:** Use the `verify` skill (drive the actual app, observe behavior — not just unit tests).

**Steps:**
1. Ensure dev server is running (check `lsof -i :3111` first per CLAUDE.md; this tree may run a different Vite port — confirm from `dev.log`). Do NOT assume 5173.
2. Open the piano kiosk → Sheet Music → open a MusicXML score with a left-hand intro (e.g. anything with `staff 1` onsets before `staff 0`).
3. Confirm:
   - Sheet **paints fast**; a determinate progress bar covers "preparing follow"; the app stays responsive (breadcrumb/scroll work during load).
   - Top shows only the breadcrumb `🎹 › Sheet Music › {title}`; controls are in the **pinned bottom bar**.
   - **Follow** requires both hands when RH+LH active; deactivating LH via its chip lets RH alone advance; a LH-only intro advances.
   - Playing the correct note **lights the notehead** (green in Follow); target notes show faded; wrong notes flash.
   - Keyboard toggle shows/hides the keyboard in both flows.
   - Metronome/Play: noteheads light in sync (bouncing ball).
4. Confirm the logs (WebSocket/backend or browser console via `window.DAYLIGHT_LOG_LEVEL='debug'`) contain: `score.load` (with phase ms), `score.playback.stats` (and `score.playback.stall` if you force jank), `score.follow.timing` + `score.follow.stats`.
5. If per-notehead geometry looks wrong across zoom/flow, confirm the **fallback** (per-step band marker) still gives correct hit/target coloring and the keyboard stays note-precise.

**Do not claim done until every bullet is observed.** Record what you saw.

### Task 15: Update docs

**Files:**
- Modify/create: `docs/reference/piano/` — add a short "Sheet Music player" reference (modes, active-parts, telemetry event catalog, load pipeline). Cross-link from any piano index.
- Update `docs/docs-last-updated.txt`: `git rev-parse HEAD > docs/docs-last-updated.txt`.

**Commit:**

```bash
git add docs/
git commit -m "docs(piano): sheet-music player reference — modes, active-parts, telemetry, load pipeline"
```

---

## Telemetry event catalog (reference)

| Event | Level | Key fields |
|-------|-------|-----------|
| `score.load` | info | `id, flow, scale, staves, measures, steps, fetchMs, parseMs, engraveMs, extractMs, totalMs, osmdWarm` |
| `score.load.failed` | warn | `id, phase, error` |
| `score.playback.stall` | warn | `step, driftMs, gapMs, bpm` |
| `score.playback.stats` | info | `mode, events, meanDriftMs, p95DriftMs, maxDriftMs, stalls, maxFrameGapMs` |
| `score.follow.timing` | sampled | `step, note, expectedMs, actualMs, driftMs, feel` |
| `score.follow.stats` | info | `hits, wrongs, meanAbsDriftMs, rushPct, dragPct` |

All deltas measured with `performance.now()`; the framework stamps each event with wall-clock time for system-clock alignment.

## Design reference

Full design rationale in this session's brainstorm (not separately committed). Key decisions: logs-only telemetry; transport-jitter primary + Follow human-drift; noteheads-primary light-up (keyboard when visible); full-hand default with per-staff toggles; one integrated overhaul; paint-first + yielded extraction (Web Workers can't run OSMD's DOM-bound render/geometry).
