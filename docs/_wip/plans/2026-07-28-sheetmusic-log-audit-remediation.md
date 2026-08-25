# Sheet Music — Log-Audit Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the 14 defects found by `docs/_wip/audits/2026-07-28-sheetmusic-runtime-log-audit.md` (as corrected by adversarial review), so the sheet-music kiosk's telemetry is readable and its Learn/Polish practice ladder actually works.

**Architecture:** All changes live under `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/` plus `score/useScoreTransport.js`. Pure logic (thresholds, count-in math, range math) goes in the existing side-car modules that already have unit tests; React wiring goes in `ScorePlayer.jsx`. Every task is test-first with vitest.

**Tech Stack:** React 18 (hooks), vitest 4 + @testing-library/react, SCSS (`frontend/src/Apps/PianoApp.scss`), the in-house structured logger at `frontend/src/lib/logging/Logger.js`.

> **STATUS 2026-07-28: all 17 tasks implemented**, plus 7 further defects the implementers found while working. Branch `feat/sheetmusic-log-audit-remediation`, 27 commits from `d8232531f`. Suite: 247 files / 2607 tests green (`frontend/src/modules/Piano/` + `MusicNotation/` + `lib/logging/`), up from 241 tests in `SheetMusic/` at branch start.
>
> **NOT merged and NOT deployed. On-kiosk verification below is still outstanding** — every change is test-verified only. Three items specifically want eyes on the tablet: the pending-notehead outline (a hollow quarter-note head can read as a half note), the stuck prompt's placement against the keyboard strip, and the transposed-engrave gate, whose real timing window (a 15–24s engrave) is only modeled in tests.

**Test command (memorize this — it is the only one you need):**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/<file>.test.js
```

Do **not** pass `--reporter=line` — vitest 4 in this repo fails to load that reporter. Plain `npx vitest run <path>` works.

---

## Orientation — read this before Task 1

You have never seen this code. Five facts that will otherwise cost you an hour:

1. **The transport is a `setInterval` at `tickMs = 100` by design** (`score/useScoreTransport.js:34,99`). It is deliberately NOT `requestAnimationFrame` — rAF is OS-throttled on the kiosk tablet. So a ~100ms gap between ticks is *healthy*. Half the bugs below come from code that treats 100ms as a fault.
2. **Two planes.** The *audio plane* (`onSchedule`) hands notes to the Web MIDI service up to `lookaheadMs` early, so audio survives main-thread jank. The *visual plane* (`onEvent`/`onFire`) fires at musical due time and is allowed to be late. Never move MIDI sends into the visual plane.
3. **`ScorePlayer.jsx` reads live values through refs inside transport callbacks** (`stepRef`, `rangeRef`, `transportRef`, `gradesRef`). The transport tick closure is created once; reading `step` directly from the closure would be stale. Follow the existing ref pattern — do not "clean it up".
4. **Four modes:** `listen` (kiosk performs through the piano), `learn` (cursor waits for you to play every note), `polish` (auto-advances at tempo, grades you per measure), `perform` (music stand, no awareness). The transport only has a timeline in `polish`/`listen` (`ScorePlayer.jsx:277`).
5. **A "focus" is a practice loop** over measure INDICES, resolved to a step span `[lo, hi]` by `focusRange.js`. It applies in listen/learn/polish, never perform.

**Log-level rule:** default level is `info` (`Logger.js:22`), so `logger.debug(...)` is dropped in production and costs nothing. That is the correct home for per-tick diagnostics. `logger.sampled(...)` always emits at **info** (`Logger.js:185`) — it is NOT a way to demote an event, only to rate-limit one. This distinction matters in Task 2.

**Ordering is not negotiable.** Phase 1 makes the logs readable. Until it lands, 99.4% of log volume is noise and no later measurement can be trusted. Phases 2–5 are cheap, high-evidence fixes. Phase 6 fixes the Polish grader. Phase 7 is the Learn redesign — the largest change, deliberately last.

**Commit after every task.** Branch first:

```bash
git checkout -b feat/sheetmusic-log-audit-remediation
```

---

# Phase 1 — Make the logs readable

## Task 1: Tempo-relative stall threshold (pure function)

The stall predicate currently flags `driftMs >= 120 || gapMs >= 50`. Over 65,595 recorded warnings, `gapMs` alone triggered 95.1% and `driftMs` alone triggered **0%** — because `gapMs` p50 is exactly 100ms, the tick interval. Separately, a fixed 120ms drift budget is musically wrong at both ends: nothing at 60 BPM, half a beat at 216 BPM.

This task adds only the pure function. Task 2 wires it in.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreTelemetry.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreTelemetry.test.js`

**Step 1: Write the failing test**

Append to `scoreTelemetry.test.js` (keep the existing imports; add `stallThresholdMs` to the import list from `./scoreTelemetry.js`):

```javascript
describe('stallThresholdMs', () => {
  it('scales with the beat: slower tempo tolerates more drift', () => {
    expect(stallThresholdMs(60)).toBeGreaterThan(stallThresholdMs(180));
  });

  it('clamps to a sane ceiling at very slow tempo', () => {
    // 40bpm → beat 1500ms → quarter-beat 375ms, capped at 250
    expect(stallThresholdMs(40)).toBe(250);
  });

  it('clamps to a sane floor at very fast tempo', () => {
    // 600bpm → beat 100ms → quarter-beat 25ms, floored at 60
    expect(stallThresholdMs(600)).toBe(60);
  });

  it('is a quarter of a beat in the normal band', () => {
    // 120bpm → beat 500ms → 125ms
    expect(stallThresholdMs(120)).toBeCloseTo(125, 5);
  });

  it('falls back to 90bpm on a bad or missing tempo', () => {
    expect(stallThresholdMs(undefined)).toBeCloseTo(stallThresholdMs(90), 5);
    expect(stallThresholdMs(0)).toBeCloseTo(stallThresholdMs(90), 5);
    expect(stallThresholdMs(NaN)).toBeCloseTo(stallThresholdMs(90), 5);
  });
});
```

**Step 2: Run it to make sure it fails**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreTelemetry.test.js
```

Expected: FAIL — `stallThresholdMs is not a function`.

**Step 3: Implement**

In `scoreTelemetry.js`, add above `summarizeDrift`:

```javascript
// A stall is the VISUAL plane falling behind by a musically meaningful amount.
// A fixed ms budget is wrong at both ends of the tempo range — 120ms is
// inaudible at 60bpm and half a beat at 216bpm — so scale to the beat and clamp
// to a band that stays sane at extreme tempi.
const STALL_BEAT_FRACTION = 0.25;
const STALL_FLOOR_MS = 60;
const STALL_CEIL_MS = 250;

/** Drift (ms) past which a fire counts as a stall, at a given tempo. */
export function stallThresholdMs(bpm) {
  const b = Number.isFinite(bpm) && bpm > 0 ? bpm : 90;
  const quarterBeat = (60000 / b) * STALL_BEAT_FRACTION;
  return Math.min(STALL_CEIL_MS, Math.max(STALL_FLOOR_MS, quarterBeat));
}
```

Update the default export: `export default { summarizeDrift, classifyFollowHit, stallThresholdMs };`

**Step 4: Run tests to verify they pass**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreTelemetry.test.js
```

Expected: PASS, all tests including the pre-existing ones.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreTelemetry.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreTelemetry.test.js
git commit -m "feat(piano): tempo-relative stall threshold for score telemetry"
```

---

## Task 2: Retire the false stall warning

Wire Task 1's threshold in, drop the tick-gap term's absolute budget, and demote the event from `warn` to `debug`. Also cap the `sched-late` warn storm (1,442 lines for one condition).

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx:68` (pass `tickMs`)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.test.js`

**Step 1: Write the failing tests**

The existing test at `useScoreTelemetry.test.js:26` asserts the OLD behavior (`warn` + `stalls: 1` from a 200/60 fire). Replace that whole `it(...)` block with:

```javascript
  it('does not flag a healthy tick gap as a stall', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x', tickMs: 100 }));
    // 100ms gap is the tick interval BY DESIGN; 40ms drift at 90bpm is well
    // inside the ~167ms budget. Neither is a stall.
    act(() => { result.current.recordFire({ step: 3 }, 40, 100, 90); });
    expect(logged.some(([, e]) => e === 'score.playback.stall')).toBe(false);
    act(() => result.current.flushPlayback('listen'));
    expect(logged.find(([, e]) => e === 'score.playback.stats')[2].stalls).toBe(0);
  });

  it('flags a gap that skipped whole ticks', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x', tickMs: 100 }));
    act(() => { result.current.recordFire({ step: 3 }, 10, 400, 90); });
    expect(logged.some(([, e]) => e === 'score.playback.stall')).toBe(true);
  });

  it('flags drift past the tempo-scaled budget, and emits it at debug', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x', tickMs: 100 }));
    // 200ms drift at 216bpm — budget there is ~69ms.
    act(() => { result.current.recordFire({ step: 3 }, 200, 100, 216); });
    const ev = logged.find(([, e]) => e === 'score.playback.stall');
    expect(ev).toBeTruthy();
    expect(ev[0]).toBe('debug'); // NOT warn — this fires per tick on a bad run
    act(() => result.current.flushPlayback('polish'));
    expect(logged.find(([, e]) => e === 'score.playback.stats')[2].stalls).toBe(1);
  });

  it('caps sched-late warns per run but counts them all in stats', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => {
      for (let i = 0; i < 20; i++) result.current.recordSchedule({ note: 60 }, -100);
      result.current.flushPlayback('listen');
    });
    const warns = logged.filter(([lvl, e]) => lvl === 'warn' && e === 'score.playback.sched-late');
    expect(warns.length).toBe(5);
    expect(logged.find(([, e]) => e === 'score.playback.stats')[2].schedLate).toBe(20);
  });
```

**Step 2: Run to verify failure**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.test.js
```

Expected: FAIL — stall still emits at `warn`, and 20 sched-late warns are emitted.

**Step 3: Implement**

In `useScoreTelemetry.js`:

Replace the imports and constants at the top:

```javascript
import { summarizeDrift, classifyFollowHit, stallThresholdMs } from './scoreTelemetry.js';

// The visual driver is a coarse setInterval at `tickMs` BY DESIGN (see
// useScoreTransport), so a gap of ~tickMs is healthy, not a stall. Only a gap
// that skipped whole ticks is worth a line. The old absolute 50ms budget could
// essentially never NOT fire: it produced 65,595 warnings in three days, 95% of
// them from this term alone, and drowned the log (audit H1).
const GAP_TICK_MULTIPLE = 2.5;
// Sched-late is a REAL condition, but 1,442 lines for one underlying problem is
// not information. Warn a handful per run; the full count ships in stats.
const SCHED_LATE_WARN_CAP = 5;
```

Change the hook signature:

```javascript
export function useScoreTelemetry({ id, tickMs = 100 }) {
```

Add two refs beside the existing collectors:

```javascript
  const stallMsRef = useRef(stallThresholdMs(90)); // latest tempo-scaled budget, for the flush
  const schedLateWarns = useRef(0);
```

Replace `recordFire`:

```javascript
  const recordFire = useCallback((ev, driftMs, gapMs, bpm) => {
    drifts.current.push(driftMs); gaps.current.push(gapMs);
    const stallMs = stallThresholdMs(bpm);
    stallMsRef.current = stallMs; // flushPlayback must count stalls by the same rule
    if (driftMs >= stallMs || gapMs >= tickMs * GAP_TICK_MULTIPLE) {
      stalls.current += 1;
      // debug, not warn: on a genuinely bad run this fires per tick. The count
      // lives in score.playback.stats; turn these on with
      // window.DAYLIGHT_LOG_LEVEL='debug' when investigating.
      logger.debug('score.playback.stall', {
        step: ev.step ?? ev.index,
        driftMs: Math.round(driftMs), gapMs: Math.round(gapMs),
        bpm, stallMs: Math.round(stallMs),
      });
    }
  }, [logger, tickMs]);
```

Replace `recordSchedule`:

```javascript
  const recordSchedule = useCallback((ev, leadMs) => {
    leads.current.push(leadMs);
    // A negative lead means the tick woke later than the event's due time — the
    // note was sent with a past timestamp (dispatches immediately, audibly late).
    if (leadMs < 0 && schedLateWarns.current < SCHED_LATE_WARN_CAP) {
      schedLateWarns.current += 1;
      logger.warn('score.playback.sched-late', { note: ev.note, leadMs: Math.round(leadMs) });
    }
  }, [logger]);
```

In `flushPlayback`, use the live threshold and reset the warn budget:

```javascript
    const d = summarizeDrift(drifts.current, { stallMs: stallMsRef.current });
```

and extend the reset line at the end of `flushPlayback`:

```javascript
    drifts.current = []; gaps.current = []; stalls.current = 0; leads.current = [];
    schedLateWarns.current = 0;
```

In `ScorePlayer.jsx:68`, pass the transport's tick rate so the two can never disagree:

```javascript
  const { logger, startSession, logLoad, recordFire, recordSchedule, flushPlayback, recordFollowHit, flushFollow, logMeasureGrade, logRunSummary, logFocus, logTranspose, logMode } = useScoreTelemetry({ id: scoreMeta.id, tickMs: TRANSPORT_TICK_MS });
```

and add near the top of the file, after the imports:

```javascript
// One source of truth for the transport's tick rate: the telemetry's stall rule
// is expressed as a MULTIPLE of it, so the two can never drift apart (audit H1).
const TRANSPORT_TICK_MS = 100;
```

Then pass it to the transport too — in the `useScoreTransport({ ... })` call (`ScorePlayer.jsx:276`), add `tickMs: TRANSPORT_TICK_MS,` beside `timeline:`.

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.test.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.telemetry.test.jsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.test.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx
git commit -m "fix(piano): stop the false stall warning drowning the sheet-music log"
```

---

## Task 3: Stop emitting empty playback stats

23 of 106 `score.playback.stats` records read `{events: 0, …}` — 6% of the entire info budget spent saying nothing. `flushPlayback` emits unconditionally and is called from mode changes, Restart, view changes and unmount.

**Files:**
- Modify: `.../SheetMusic/useScoreTelemetry.js`
- Test: `.../SheetMusic/useScoreTelemetry.test.js`

**Step 1: Write the failing test**

```javascript
  it('does not emit a stats record for a run that produced nothing', () => {
    const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
    act(() => result.current.flushPlayback('polish'));
    expect(logged.some(([, e]) => e === 'score.playback.stats')).toBe(false);
  });
```

**Step 2: Run to verify failure**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.test.js
```

Expected: FAIL — an empty stats record is emitted.

**Step 3: Implement**

At the top of `flushPlayback`, before computing `d`:

```javascript
  const flushPlayback = useCallback((mode) => {
    // A run that never fired and never scheduled has nothing to report. Mode
    // changes, Restart, view changes and unmount all call this unconditionally;
    // without the guard 22% of stats records were empty (audit M4).
    if (!drifts.current.length && !leads.current.length) return;
```

**Step 4: Run tests** — same command, expect PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.test.js
git commit -m "fix(piano): skip empty score.playback.stats records"
```

---

# Phase 2 — The most-repeated failed interaction

## Task 4: Return the cursor home when a run completes

When a piece finishes, the transport rewinds internally (`useScoreTransport.js:87`) but React's `step` state stays parked on the final step. `toggleRun` then seeks to `stepTimeline[step]` — the end — so Play produces ~1.6s of the last measure. The logs show one user doing this **fourteen times in one session**, in four clusters separated by deliberate seeks.

**Files:**
- Modify: `.../SheetMusic/ScorePlayer.jsx` (the `onDone` no-loop branch, ~line 358-364)
- Test: `.../SheetMusic/ScorePlayer.test.jsx`

**Step 1: Write the failing test**

Read `ScorePlayer.test.jsx` first to match its existing harness (it mocks `MusicXmlRenderer`, the MIDI/playback/config contexts, and drives the transport).

**The observable is the transport bar's position readout.** `ScoreTransportBar.jsx:465` renders `<span className="piano-score-position tabular-nums">`, and its text is measures — `m 1 / 24` when a measure count exists, falling back to `${step + 1} / ${total}` when it does not (`:427-431`). The test fixture's layout has no `measures`, so expect the **step** form. Add `data-testid="score-position"` to that span as part of this task — the class is styling, not a contract.

```javascript
  it('returns the cursor home when a run completes, so Play replays the piece', async () => {
    vi.useFakeTimers();
    render(<MemoryRouter><ScorePlayer score={scoreFixture} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    await act(async () => { vi.advanceTimersByTime(5000); }); // run past the final event
    // Back at the top: "1 / 2" for the 2-event fixture, not "2 / 2".
    expect(screen.getByTestId('score-position')).toHaveTextContent('1 / 2');
    vi.useRealTimers();
  });
```

> Confirm the fixture's event count and whether `layout.measures` is populated before asserting an exact string — read the mock's `onLayout` payload at the top of `ScorePlayer.test.jsx` rather than trusting this line.

**Step 2: Run to verify failure**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx
```

Expected: FAIL — the readout sits at the final step.

**Step 3: Implement**

In `ScorePlayer.jsx`, in `onDone`, after `logger.info('score.transport.done', ...)`:

```javascript
      logger.info('score.transport.done', { mode, steps: events.length });
      // The run is OVER — put the cursor back where a run starts (the loop
      // in-point when one is active, else the top). Without this, `step` stays
      // parked on the final step while the transport has already rewound, so the
      // next Play seeks to the end and plays ~1.6s of the last measure. Users hit
      // that fourteen times in one session (audit H2). Mirrors what reset() does.
      const home = homeStep(rangeRef.current);
      setStep(home);
      setStruck(() => new Set());
      if (home === 0) scrollRef.current?.scrollTo({ top: 0, left: 0 });
```

`homeStep` is already imported (`ScorePlayer.jsx:15`).

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
```

Expected: PASS across the whole directory (this touches shared state; run everything).

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
git commit -m "fix(piano): reset the score cursor when a run completes"
```

---

# Phase 3 — See what users actually press

## Task 5: Log Restart, tap-to-seek, Perform tap-scroll, and loop-nudge origin

Restart is plausibly the most-pressed control in the mode and emits nothing — it is only inferable from a ~40-record statistical artifact. Tap-to-seek is the primary navigation gesture and is invisible. Perform's tap-to-scroll is unlogged, which is why the audit's first draft wrongly called Perform "abandoned". And the ±1 nudge emits a bare `focus.set` indistinguishable from a two-tap selection.

**Files:**
- Modify: `.../SheetMusic/ScorePlayer.jsx`
- Modify: `.../SheetMusic/useScoreTelemetry.js` (add `origin` to `logFocus`)
- Test: `.../SheetMusic/ScorePlayer.telemetry.test.jsx`

**Step 1: Write the failing tests**

In `ScorePlayer.telemetry.test.jsx`, add assertions that clicking Restart emits `score.transport.restart`, and that a tap on the score in `learn` emits `score.seek.tap`. Follow the file's existing pattern for reading emitted events.

**Step 2: Run to verify failure** — expect FAIL, neither event exists.

**Step 3: Implement**

(a) `useScoreTelemetry.js` — carry the focus origin:

```javascript
  const logFocus = useCallback(({ kind, inMeasure, outMeasure, origin }) => logger.info('score.focus.set', { kind, inMeasure, outMeasure, origin }), [logger]);
```

(b) `ScorePlayer.jsx` — add a ref next to the other refs:

```javascript
  // What CAUSED the next focus change, so score.focus.set is attributable. The
  // two-tap flow, the ±1 nudge and a section pick all commit the same event
  // shape; without this the log cannot tell them apart (audit T1).
  const focusOriginRef = useRef('restore');
```

In the focus effect (~line 818), pass and reset it:

```javascript
    logFocus({ kind: focus.kind, inMeasure: focus.inMeasure, outMeasure: focus.outMeasure, origin: focusOriginRef.current });
    focusOriginRef.current = 'restore';
```

Set it at each call site:
- `onScoreClick`, the two-tap commit (before `setFocus({ kind: 'custom', ... })`): `focusOriginRef.current = 'select';`
- `onPickSection` (before `setFocus`): `focusOriginRef.current = 'section';`
- `onNudge`: `focusOriginRef.current = 'nudge';` as the first statement.
- `onDrillWorst` (before `setFocus`): `focusOriginRef.current = 'drill';`

(c) `reset()` — log the Restart:

```javascript
    const home = homeStep(rangeRef.current);
    logger.info('score.transport.restart', { from: stepRef.current, to: home, mode });
    tapIntent('restart');
    setStep(home);
```

Add `logger` and `tapIntent` to `reset`'s dep array.

(d) `onScoreClick`, the normal-seek branch (after `const target = ...`):

```javascript
    logger.info('score.seek.tap', { from: stepRef.current, to: target, mode });
    tapIntent('seek');
```

(e) `onScoreClick`, the Perform branch (after the `el.scrollBy(...)`):

```javascript
      logger.info('score.perform.tapscroll', { axis: flow === 'horizontal' ? 'x' : 'y' });
      tapIntent('perform-scroll');
```

Add `tapIntent` to `onScoreClick`'s dep array.

> **Move `tapIntent` above `onScoreClick`.** `tapIntent` is currently declared at line ~606 and `onScoreClick` at ~745, so it is already in scope. `reset` is at ~912, also fine. No reordering needed — verify by running the tests, not by reading.

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
git commit -m "feat(piano): log Restart, tap-to-seek, perform scroll and focus origin"
```

---

# Phase 4 — Loop selection and persistence

## Task 6: Expire loop-selection arming and give feedback on a rejected tap

Two defects. **(a)** A selection tap farther than `SELECT_MAX_DIST` from any note returns with no feedback (`ScorePlayer.jsx:767-768`) — on a kiosk that is indistinguishable from a dead screen; four selection attempts in the corpus never registered a first tap. **(b)** `selecting` is cleared only by mode change, cancel, clear, section pick, or new document — never by Play, Restart or time. One user armed a selection, played for 30 seconds, tapped the score to seek, and got a 10-measure loop instead; `onScoreClick` checks `selecting` before the seek branch, so tap-to-seek is dead for as long as the state persists.

**Files:**
- Modify: `.../SheetMusic/ScorePlayer.jsx`
- Modify: `.../SheetMusic/SelectBanner.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss`
- Create: `.../SheetMusic/SelectBanner.test.jsx` — this file does **not** exist yet; `SelectBanner.jsx` currently has no test at all
- Test: `.../SheetMusic/ScorePlayer.test.jsx`

**Step 1: Write the failing tests**

Create `SelectBanner.test.jsx` with the standard header used by the other component tests in this directory:

```javascript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SelectBanner from './SelectBanner.jsx';

describe('SelectBanner', () => {
  it('renders nothing without a stage', () => {
    const { container } = render(<SelectBanner onCancel={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a rejection message when a tap missed every note', () => {
    render(<SelectBanner stage="first" rejects={1} onCancel={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent(/closer to a note/i);
  });

  it('reverts to the instruction when no rejection has happened', () => {
    render(<SelectBanner stage="first" rejects={0} onCancel={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent(/FIRST measure/i);
  });
});
```

**Step 2: Run to verify failure**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/SelectBanner.test.jsx
```

**Step 3: Implement**

(a) `SelectBanner.jsx` — accept a reject counter and shake:

```javascript
import React from 'react';

/**
 * SelectBanner — the on-score guidance shown during the guided measure-selection
 * flow (Loop → Select measures…). Tells the user exactly what to tap next and
 * offers Cancel, so the two-tap flow is never a mystery (audit J5/M3).
 *
 * `rejects` is a counter, not a boolean: re-keying on it restarts the shake
 * animation for every rejected tap, so a second miss is as visible as the first.
 * A tap that lands too far from any note is otherwise silently swallowed, which
 * on a kiosk reads as a dead screen (audit H4a).
 *
 * @param {object} p
 * @param {'first'|'last'} p.stage
 * @param {number} [p.rejects] - count of taps rejected as too far from a note
 * @param {() => void} p.onCancel
 */
export default function SelectBanner({ stage, rejects = 0, onCancel }) {
  if (!stage) return null;
  const text = rejects > 0
    ? 'Tap closer to a note'
    : stage === 'first'
      ? 'Tap the FIRST measure of your loop'
      : 'Now tap the LAST measure';
  return (
    <div
      key={rejects}
      className={`piano-score-select-banner${rejects > 0 ? ' is-reject' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="piano-score-select-banner__text">{text}</span>
      <button type="button" className="piano-score-btn piano-score-select-cancel" onClick={onCancel}>Cancel</button>
    </div>
  );
}
```

(b) `PianoApp.scss` — after the existing `.piano-score-select-banner` block (~line 2833), add:

```scss
// A rejected selection tap (too far from any note) shakes the banner and turns
// it amber — the kiosk has no other way to say "I heard you, try again".
.piano-score-select-banner.is-reject {
  background: rgba(232, 163, 61, 0.95);
  animation: piano-select-shake 320ms ease-out;
}
@keyframes piano-select-shake {
  0%, 100% { transform: translateX(-50%); }
  25%      { transform: translateX(calc(-50% - 7px)); }
  75%      { transform: translateX(calc(-50% + 7px)); }
}
```

(c) `ScorePlayer.jsx` — reject feedback and expiry. Add state beside `selecting`:

```javascript
  const [selectRejects, setSelectRejects] = useState(0);
```

In `onScoreClick`'s selection branch, replace the silent return:

```javascript
      const si = nearestEvent(events, e.clientX - r.left, e.clientY - r.top, SELECT_MAX_DIST * scale);
      if (si < 0) { setSelectRejects((n) => n + 1); return; } // too far — say so, don't swallow it
      setSelectRejects(0);
```

Set the origin and commit as in Task 5, then reset rejects when arming starts. In `onStartSelect`:

```javascript
  const onStartSelect = useCallback(() => {
    setSelecting({ stage: 'first' });
    setSelectRejects(0);
    logger.info('score.focus.select-start', {});
  }, [logger]);
```

Add an idle expiry effect (place it next to the other focus effects):

```javascript
  // Arming must not outlive the user's intent. `selecting` gates the seek branch
  // of onScoreClick, so a forgotten arm silently disables tap-to-seek — one user
  // armed, played for 30s, tapped to seek and got a 10-measure loop (audit H4b).
  useEffect(() => {
    if (!selecting) return undefined;
    const t = setTimeout(() => {
      setSelecting(null);
      logger.info('score.focus.select-timeout', { stage: selecting.stage });
    }, SELECT_IDLE_MS);
    return () => clearTimeout(t);
  }, [selecting, logger]);
```

with a constant near `TRANSPORT_TICK_MS`:

```javascript
const SELECT_IDLE_MS = 15000;
```

And cancel arming on the two actions that clearly mean "I'm doing something else": add `setSelecting(null);` as the first statement of both `toggleRun` and `reset`.

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ frontend/src/Apps/PianoApp.scss
git commit -m "fix(piano): expire loop arming and surface rejected selection taps"
```

---

## Task 7: Stop persisting the practice loop across sessions

A loop set once on 07-28 at 16:08 was still in force six page loads later — the piece opened 10 measures in and looped m11–m69 every time, and only two `focus.clear` events exist in the whole corpus. Tempo and hands are worth restoring; an indefinite loop is not.

**Files:**
- Modify: `.../SheetMusic/scoreSettings.js`
- Modify: `.../SheetMusic/ScorePlayer.jsx`
- Test: `.../SheetMusic/scoreSettings.test.js`

**Step 1: Write the failing test**

```javascript
  it('never returns a persisted focus, even if an old build stored one', () => {
    window.localStorage.setItem('daylight.piano.sm.s1', JSON.stringify({
      v: 1, mode: 'polish', tempoMult: 1.25, focus: { kind: 'custom', inMeasure: 10, outMeasure: 68 },
    }));
    const s = loadScoreSettings('s1');
    expect(s.focus).toBeUndefined();
    expect(s.mode).toBe('polish');       // the useful settings still restore
    expect(s.tempoMult).toBe(1.25);
  });
```

**Step 2: Run to verify failure**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreSettings.test.js
```

**Step 3: Implement**

In `scoreSettings.js`, in `loadScoreSettings`, retire the key on read:

```javascript
    // `focus` was persisted through v1 and is deliberately RETIRED: an indefinite
    // loop means the piece silently opens mid-score and never plays from the top,
    // which the field logs show confusing users across six sessions (audit M1).
    // Stripping on read also cleans up values written by older builds.
    const { v, focus, ...rest } = obj;
    return rest;
```

In `ScorePlayer.jsx`:

- Drop `focus` from the save patch (line ~418):

```javascript
    saveScoreSettings(scoreMeta.id, { mode, tempoMult, activeParts, myStaves: [...myStaves], clickOn });
```
  and remove `focus` from that effect's dep array.

- Initialize `focus` as always-null (replace the `useState` initializer at ~line 97):

```javascript
  // Practice loops are per-session by design — never restored (audit M1).
  const [focus, setFocus] = useState(null);
```

- The `firstDocRef` guard existed only to protect a restored focus. Remove the ref declaration (~line 1057) and simplify the document effect:

```javascript
    // A new document resets the practice range (measure indices don't carry over).
    setFocus(null);
    setSelecting(null);
```

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
git commit -m "fix(piano): stop persisting the sheet-music practice loop across sessions"
```

---

# Phase 5 — Resume after a re-engrave

## Task 8: One resume mechanism for part changes and view changes

Two callers pause a running transport and never resume it:

- **Listen "My part"** (`disruptListenPlayback`, `ScorePlayer.jsx:1007-1011`) — choosing a part stops the music. All four `listen.mypart` events in the corpus were reverted to "none" within 90 seconds, both times. Pressing Play again then triggers a surprise count-in.
- **Zoom / flow / transpose** (`pauseForViewChange`, `:888-895`) — correct to pause (the geometry is stale mid-re-engrave), but the user must find their place again by hand; the resume lands somewhere else every time.

**Files:**
- Modify: `.../SheetMusic/ScorePlayer.jsx`
- Test: `.../SheetMusic/ScorePlayer.test.jsx`

**Step 1: Write the failing test**

Assert that in `listen` mode, with playback running, changing the hands/my-part control leaves the transport playing (or resumes it within a tick) rather than leaving it paused.

**Step 2: Run to verify failure** — expect FAIL, playback stays paused.

**Step 3: Implement**

Add the shared state near the other transport refs:

```javascript
  // A pause taken purely to rebuild the timeline or re-engrave is not a user
  // decision — remember where we were and resume there once the layout is fresh.
  // Both the Listen part-change (audit H5) and the zoom/flow/transpose pause
  // (audit M3) go through this; without it, choosing a part reads as "this button
  // breaks the song" and a zoom costs the user their place.
  const resumeAfterRef = useRef(null);
  const [resumeTick, setResumeTick] = useState(0);
```

Replace `pauseForViewChange` with a reason-carrying version, and route `disruptListenPlayback` through the same code:

```javascript
  const pauseForRebuild = useCallback((reason) => {
    clearWrapDwell(); // BEFORE the playing check — during the dwell nothing plays
    if (!transportRef.current?.playing) return;
    transport.pause();
    silenceScheduled();
    flushPlaybackNow();
    resumeAfterRef.current = { step: stepRef.current };
    setResumeTick((t) => t + 1);
    logger.info('score.viewchange.pause', { reason, step: stepRef.current });
  }, [clearWrapDwell, transport, silenceScheduled, flushPlaybackNow, logger]);

  const pauseForViewChange = useCallback(() => pauseForRebuild('view'), [pauseForRebuild]);
```

and:

```javascript
  const disruptListenPlayback = useCallback(() => {
    pauseForRebuild('part');
    silenceScheduled(); // also flush when nothing was playing (a stale schedule may still be queued)
  }, [pauseForRebuild, silenceScheduled]);
```

Add the resume effect after the auto-follow effect:

```javascript
  // Resume a rebuild-pause once the engraving matches the current flow/scale.
  // For a part change `layoutFresh` is already true, so this fires on the very
  // next commit (the music barely hiccups); for a zoom/flow change it waits for
  // the re-engrave. Deliberately bypasses toggleRun so no count-in fires — the
  // user never asked to start a run, they asked to change a setting.
  useEffect(() => {
    const pending = resumeAfterRef.current;
    if (!pending || !layoutFresh || !events.length) return;
    resumeAfterRef.current = null;
    const target = rangeRef.current ? clampStepToRange(pending.step, rangeRef.current) : pending.step;
    setStep(target);
    setStruck(() => new Set());
    transportRef.current?.seek((stepTimeline[target]?.t ?? 0) / tempoMult);
    transportRef.current?.play();
    logger.info('score.transport.resume', { step: target });
  }, [resumeTick, layoutFresh, events.length, stepTimeline, tempoMult, logger]);
```

Cancel a pending resume wherever the user takes explicit control — add `resumeAfterRef.current = null;` as an early statement in `toggleRun`, `reset`, `onMode`, and the normal-seek branch of `onScoreClick`.

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
git commit -m "feat(piano): resume playback after a part change or re-engrave"
```

---

# Phase 6 — The Polish grader (the real bug)

> **Context you need.** The audit's first draft concluded Polish was "unreachable, dead in the field". That was wrong — it is reachable from the transport bar like every other mode (`ScoreTransportBar.jsx:8-13,52` renders all four unconditionally) and was entered directly three times. The corpus contains one **real Polish run**: `countin.go {step: 19, mode: "polish"}` at 02:22:51 over a loop set to `{inMeasure: 2, outMeasure: 2}`, then `playback.stats {mode: "polish", events: 17}` 5.5 seconds later. The evaluator was enabled (`ScorePlayer.jsx:467`) for 17 note events and graded nothing. Tasks 9 and 10 are why.

## Task 9: Grade the measure when a single-measure loop wraps

`useScoreEvaluator` grades only when `currentMeasure` **changes** (`useScoreEvaluator.js:84-112`). `currentMeasure` is derived from the cursor (`ScorePlayer.jsx:434`). In a one-measure loop the cursor wraps from the end of measure N back to the start of measure N — `currentMeasure` never changes, so no grade ever fires, for the entire run, no matter how long it plays. That is exactly the 07-26 run.

**Files:**
- Modify: `.../SheetMusic/useScoreEvaluator.js`
- Modify: `.../SheetMusic/ScorePlayer.jsx`
- Test: `.../SheetMusic/useScoreEvaluator.test.js`

**Step 1: Write the failing test**

```javascript
  it('grades the repeated measure when a single-measure loop wraps', () => {
    const onMeasureGrade = vi.fn();
    let fire;
    const subscribe = (fn) => { fire = fn; return () => {}; };
    const { rerender } = renderHook(
      ({ boundary }) => useScoreEvaluator({
        enabled: true,
        cfg: { silentMeasuresToStop: 4 },
        subscribe,
        currentMeasure: 2,          // NEVER changes — a one-measure loop
        boundary,
        expectedForMeasure: () => [60, 62],
        driftForNote: () => 0,
        onMeasureGrade,
        onSilentStop: vi.fn(),
      }),
      { initialProps: { boundary: 0 } },
    );
    act(() => { fire({ type: 'note_on', note: 60, velocity: 90 }); });
    expect(onMeasureGrade).not.toHaveBeenCalled();   // mid-measure, nothing yet
    rerender({ boundary: 1 });                        // the loop wrapped
    expect(onMeasureGrade).toHaveBeenCalledTimes(1);
    expect(onMeasureGrade.mock.calls[0][0].measure).toBe(2);
  });
```

**Step 2: Run to verify failure**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreEvaluator.test.js
```

Expected: FAIL — `onMeasureGrade` is never called.

**Step 3: Implement**

In `useScoreEvaluator.js`, add `boundary = 0` to the destructured params and document it:

```javascript
 * @param {number}   [p.boundary]        - bump this to force an end-of-measure
 *   grade without a measure-index change (a loop wrapping onto the SAME measure).
```

Add a ref beside the others:

```javascript
  const prevBoundaryRef = useRef(boundary);
```

Replace the advance-driven grading effect:

```javascript
  // Grade the measure that just ended: normally when `currentMeasure` advances,
  // but ALSO when `boundary` bumps. A single-measure loop wraps from the end of
  // measure N back to its start, so currentMeasure never changes and the advance
  // rule alone would never grade — the field logs show a 5.5s Polish run over a
  // one-measure loop producing 17 note events and zero grades.
  useEffect(() => {
    if (!enabled) return;
    const prev = prevMeasureRef.current;
    const wrapped = boundary !== prevBoundaryRef.current;
    prevBoundaryRef.current = boundary;
    const ending = (prev != null && currentMeasure !== prev)
      ? prev
      : (wrapped ? currentMeasure : null);

    if (ending != null) {
      const g = gradeMeasure(
        { expected: expectedForMeasureRef.current?.(ending) || [], hits: hitsRef.current },
        cfgRef.current || {},
      );
      onMeasureGradeRef.current?.({ measure: ending, ...g });

      if (g.silent) {
        silentRunRef.current += 1;
        const limit = cfgRef.current?.silentMeasuresToStop;
        if (Number.isFinite(limit) && silentRunRef.current >= limit && !stoppedRef.current) {
          stoppedRef.current = true;
          onSilentStopRef.current?.();
        }
      } else {
        silentRunRef.current = 0;
      }

      hitsRef.current = [];
    }
    prevMeasureRef.current = currentMeasure;
  }, [enabled, currentMeasure, boundary]);
```

Reset `prevBoundaryRef.current = boundary;` in both the disabled-reset effect and the unmount effect, alongside the other refs.

In `ScorePlayer.jsx`, count the wraps. Add state near `grades`:

```javascript
  // Every loop wrap is an end-of-measure for grading purposes, even when the loop
  // is one measure long and the measure index never changes (audit: Polish).
  const [loopWraps, setLoopWraps] = useState(0);
```

Bump it in **both** wrap paths — in the transport's `onEvent` wrap branch, right after `setStruck(() => new Set());`:

```javascript
          setLoopWraps((n) => n + 1);
```

and inside `onDone`'s `restart` closure, after its `setStruck(() => new Set());`:

```javascript
          setLoopWraps((n) => n + 1);
```

Pass it to the evaluator (`ScorePlayer.jsx:466`):

```javascript
  const evaluator = useScoreEvaluator({
    enabled: mode === 'polish' && transport.playing, // grade only during real playback
    boundary: loopWraps,
    cfg: resolvedScoringCfg,
    ...
```

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
git commit -m "fix(piano): grade Polish measures when a single-measure loop wraps"
```

---

## Task 10: Grade and summarize when a Polish run is paused

Pausing a Polish run calls `transport.pause()` and nothing else (`ScorePlayer.jsx:970-975`) — no `finalize`, no summary. Combined with Task 9's bug, that left the only recorded Polish run with no output of any kind. There is a second defect in the same area: both existing summary call sites read `gradesRef.current`, which is assigned during **render**, so a summary opened in the same tick as `finalize()` tallies without the measure just graded.

**Files:**
- Modify: `.../SheetMusic/useScoreEvaluator.js` (return the grade from `finalize`)
- Modify: `.../SheetMusic/ScorePlayer.jsx`
- Test: `.../SheetMusic/useScoreEvaluator.test.js`

**Step 1: Write the failing test**

```javascript
  it('finalize returns the grade it produced so a same-tick summary can include it', () => {
    const onMeasureGrade = vi.fn();
    let fire;
    const { result } = renderHook(() => useScoreEvaluator({
      enabled: true,
      cfg: { silentMeasuresToStop: 4 },
      subscribe: (fn) => { fire = fn; return () => {}; },
      currentMeasure: 3,
      expectedForMeasure: () => [60],
      driftForNote: () => 0,
      onMeasureGrade,
      onSilentStop: vi.fn(),
    }));
    act(() => { fire({ type: 'note_on', note: 60, velocity: 90 }); });
    let returned;
    act(() => { returned = result.current.finalize(); });
    expect(returned).toBeTruthy();
    expect(returned.measure).toBe(3);
    expect(onMeasureGrade).toHaveBeenCalledTimes(1);
  });
```

**Step 2: Run to verify failure** — `finalize` returns `undefined`.

**Step 3: Implement**

In `useScoreEvaluator.js`, make `finalize` return what it graded:

```javascript
  const finalize = useCallback(() => {
    if (!enabledRef.current || finalizedRef.current) return undefined;
    finalizedRef.current = true;
    const m = currentMeasureRef.current;
    const expected = expectedForMeasureRef.current?.(m) || [];
    if (expected.length === 0 && hitsRef.current.length === 0) return undefined; // nothing to grade
    const g = gradeMeasure({ expected, hits: hitsRef.current }, cfgRef.current || {});
    const graded = { measure: m, ...g };
    onMeasureGradeRef.current?.(graded);
    hitsRef.current = [];
    // Returned so a caller opening the run summary in the SAME tick can fold this
    // in: gradesRef is assigned during render, so it does not yet contain it.
    return graded;
  }, []);
```

In `ScorePlayer.jsx`, teach `openRunSummary` to accept the just-graded measure:

```javascript
  const openRunSummary = useCallback((extra) => {
    setSummaryOpen(true);
    // `extra` is the measure finalize() just graded — gradesRef.current is a
    // render-time snapshot and does not include it yet, so a summary opened in
    // the same tick would under-count by one measure.
    const all = extra ? { ...gradesRef.current, [extra.measure]: extra } : gradesRef.current;
    const t = tallyGrades(all);
    logRunSummary({ greens: t.green, yellows: t.yellow, reds: t.red, overall: t.overall });
  }, [logRunSummary]);
```

Update the existing completion path in `onDone` (line ~362):

```javascript
      if (mode === 'polish') { openRunSummaryRef.current?.(finalizeRef.current?.()); }
```

And add the pause path in `toggleRun`, **before** `transport.pause()` (the evaluator's `enabled` is derived from `transport.playing`, so finalize must run while it is still true):

```javascript
    if (transport.playing) {
      // A paused Polish run is still a run: grade what was played and show the
      // summary. Without this a user who works a passage and stops gets nothing
      // at all — no grade, no summary, no reason to come back (audit: Polish).
      if (mode === 'polish') openRunSummaryRef.current?.(finalizeRef.current?.());
      transport.pause();
```

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
git commit -m "fix(piano): grade and summarize a paused Polish run"
```

---

# Phase 7 — Learn

## Task 11: Fix the Learn timing artifact and stop classifying self-paced hits

Two problems in `onFollowHit` (`ScorePlayer.jsx:488-496`). **(a)** `lastAdvanceRef` starts at `0`, so `actualMs = now - (0 || now)` = `0` on the first hit after entering Learn → maximum negative drift → `feel: "rush"`. Seven of 31 records are this artifact and one whole `follow.stats` inherited it (`{hits: 2, wrongs: 4, meanAbsDriftMs: 400, rushPct: 100}`). **(b)** Learn is self-paced — the cursor waits for the player — so measuring "drift" against the written note duration is a category error: `expectedMs` is 94ms in most records, so any human response is `drag`, and `TIGHT_MS = 25` can never be satisfied. 24 of 31 records are `drag`, up to 47,039ms.

**Files:**
- Modify: `.../SheetMusic/ScorePlayer.jsx`
- Modify: `.../SheetMusic/useScoreTelemetry.js`
- Modify: `.../SheetMusic/scoreTelemetry.js`
- Test: `.../SheetMusic/scoreTelemetry.test.js`, `.../SheetMusic/useScoreTelemetry.test.js`

**Step 1: Write the failing test**

In `scoreTelemetry.test.js`:

```javascript
describe('summarizeStepIntervals', () => {
  it('reports median and p95 of the user\'s own step intervals', () => {
    const s = summarizeStepIntervals([100, 200, 300, 400, 10000]);
    expect(s.medianStepMs).toBe(300);
    expect(s.p95StepMs).toBe(10000);
    expect(s.count).toBe(5);
  });

  it('is empty-safe', () => {
    expect(summarizeStepIntervals([])).toMatchObject({ count: 0, medianStepMs: 0, p95StepMs: 0 });
  });
});
```

**Step 2: Run to verify failure**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreTelemetry.test.js
```

**Step 3: Implement**

(a) `scoreTelemetry.js` — add the replacement summary and retire the misuse:

```javascript
/**
 * Learn is SELF-PACED: the cursor waits for the player, so "drift" against the
 * written note duration is meaningless there (expectedMs is ~94ms, so every human
 * response classifies as `drag` and `tight` is unreachable). Summarize the user's
 * own step-to-step intervals instead — a median and a tail, no verdict.
 */
export function summarizeStepIntervals(intervals) {
  const d = (intervals || []).filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!d.length) return { count: 0, medianStepMs: 0, p95StepMs: 0 };
  return {
    count: d.length,
    medianStepMs: Math.round(d[Math.floor(d.length / 2)]),
    p95StepMs: Math.round(d[Math.min(d.length - 1, Math.floor(d.length * 0.95))]),
  };
}
```

Keep `classifyFollowHit` exported (Polish may want it later), but stop calling it from the Learn path.

(b) `useScoreTelemetry.js` — record raw intervals:

```javascript
  const recordFollowHit = useCallback(({ step, note, sinceAdvanceMs }) => {
    follow.current.push(sinceAdvanceMs);
    logger.sampled('score.follow.timing', { step, note, sinceAdvanceMs: Math.round(sinceAdvanceMs) }, { maxPerMinute: 20, aggregate: true });
  }, [logger]);

  const flushFollow = useCallback((hits, wrongs) => {
    const s = summarizeStepIntervals(follow.current);
    logger.info('score.follow.stats', { hits, wrongs, ...s });
    follow.current = [];
  }, [logger]);
```

Import `summarizeStepIntervals` and drop the now-unused `classifyFollowHit` import. Delete the local `pct` helper if nothing else uses it.

(c) `ScorePlayer.jsx` — initialize the ref on entering Learn and skip the first hit:

```javascript
  // Stamp the reference point when Learn is ENTERED. Left at 0, the first hit
  // computes an interval of 0 and poisons the run's stats (audit M5a).
  useEffect(() => { if (mode === 'learn') lastAdvanceRef.current = performance.now(); }, [mode]);

  const onFollowHit = useCallback((note) => {
    setStruck((prev) => { const n = new Set(prev); n.add(note); return n; });
    followHitsRef.current += 1;
    if (!lastAdvanceRef.current) return; // no reference point yet — don't invent one
    recordFollowHit({ step: stepRef.current, note, sinceAdvanceMs: performance.now() - lastAdvanceRef.current });
  }, [recordFollowHit]);
```

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
git commit -m "fix(piano): measure Learn pacing honestly instead of misclassifying it"
```

---

## Task 12: Show which notes Learn is still waiting for

`useFollowTracker` advances only when **every** active-staff note of the step has been struck (`useFollowTracker.js:63`). When you play one of two required notes it lights green — which reads as success — and then nothing happens, forever. The corpus has a user hammering a *correct* note six times in eight seconds with the cursor frozen, then 47 seconds on the next step, in a session that ended `{hits: 48, wrongs: 236}`.

`NoteHighlightLayer` already receives both the expected set (via `step.notes` + `activeParts`) and the struck set, so this is a rendering change only.

**Files:**
- Modify: `.../SheetMusic/NoteHighlightLayer.jsx`
- Modify: `.../SheetMusic/ScorePlayer.jsx` (pass the new prop)
- Modify: `frontend/src/Apps/PianoApp.scss`
- Test: `.../SheetMusic/NoteHighlightLayer.test.jsx`

**Step 1: Write the failing test**

```javascript
  it('marks expected-but-unstruck notes as pending when asked', () => {
    const a = mkNoteEl(); const b = mkNoteEl();
    render(<NoteHighlightLayer
      step={{ notes: [{ midi: 60, staff: 0, el: a }, { midi: 48, staff: 1, el: b }] }}
      activeParts={{ 0: true, 1: true }}
      struck={new Set([60])}
      showPending
    />);
    expect(a.classList.contains('piano-note-hit')).toBe(true);
    expect(a.classList.contains('piano-note-pending')).toBe(false);
    expect(b.classList.contains('piano-note-pending')).toBe(true);
  });

  it('does not mark pending notes when showPending is off', () => {
    const b = mkNoteEl();
    render(<NoteHighlightLayer
      step={{ notes: [{ midi: 48, staff: 1, el: b }] }}
      activeParts={{ 1: true }}
      struck={new Set()}
    />);
    expect(b.classList.contains('piano-note-pending')).toBe(false);
  });
```

(Reuse the existing file's helper for building a fake note element; if it has none, `const mkNoteEl = () => document.createElement('div');` is sufficient — the layer only touches `classList` and `style`.)

**Step 2: Run to verify failure**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/NoteHighlightLayer.test.jsx
```

**Step 3: Implement**

In `NoteHighlightLayer.jsx`:

```javascript
const LIT = 'piano-note-lit';         // upcoming / expected note at the cursor
const HIT = 'piano-note-hit';         // struck correctly (adds a glow)
const PENDING = 'piano-note-pending'; // expected here, still outstanding (Learn)
```

Add `showPending = false` to the props, document it, and extend the loop:

```javascript
 * @param {boolean} [p.showPending] - mark expected-but-unstruck noteheads. Learn
 *   advances only when EVERY active-staff note of the step is struck; without
 *   this the struck note lights green and the user has no way to see they still
 *   owe the other hand (audit H3).
```

```javascript
      el.classList.add(LIT);
      if (struck?.has(note.midi)) el.classList.add(HIT);
      else if (showPending) el.classList.add(PENDING);
```

and in the cleanup: `el.classList.remove(LIT, HIT, PENDING);`

Add `showPending` to the effect's dep array.

In `ScorePlayer.jsx`, pass it (the `NoteHighlightLayer` usage at ~line 1159):

```javascript
              showPending={mode === 'learn'}
```

In `PianoApp.scss`, after the `.piano-note-hit` rule (~line 2654), inside the same parent block:

```scss
  // Expected at this step but not yet struck (Learn's all-notes rule). Outlined
  // and pulsing rather than filled, so "you still owe me the left hand" is legible
  // without competing with the green hit colour.
  .piano-note-pending {
    path, rect, ellipse, text {
      fill: none;
      stroke: var(--nh-color, #2ec46f);
      stroke-width: 1.2;
    }
    animation: piano-note-pending-pulse 1.1s ease-in-out infinite;
  }
```

and at top level, beside the other keyframes:

```scss
@keyframes piano-note-pending-pulse {
  0%, 100% { opacity: 0.45; }
  50%      { opacity: 1; }
}
```

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): show Learn's outstanding notes instead of deadlocking silently"
```

---

## Task 13: Offer the hands split when Learn gets stuck

The designed escape hatch from a two-hand deadlock is narrowing to one hand — and `score.hands` and `score.active-part` have fired **zero** times in three days. Nobody has found it: it lives in the right-hand cluster of the transport bar, spatially distant from the score, and nothing in Learn suggests it exists.

**Files:**
- Create: `.../SheetMusic/StuckPrompt.jsx`
- Create: `.../SheetMusic/StuckPrompt.test.jsx`
- Modify: `.../SheetMusic/ScorePlayer.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss`

**Step 1: Write the failing test**

`StuckPrompt.test.jsx`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StuckPrompt from './StuckPrompt.jsx';

describe('StuckPrompt', () => {
  it('renders nothing when not open', () => {
    const { container } = render(<StuckPrompt open={false} onPick={() => {}} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers one hand at a time and reports the pick', () => {
    const onPick = vi.fn();
    render(<StuckPrompt open onPick={onPick} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /right hand/i }));
    expect(onPick).toHaveBeenCalledWith('rh');
  });

  it('can be dismissed', () => {
    const onDismiss = vi.fn();
    render(<StuckPrompt open onPick={() => {}} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /keep both/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
```

**Step 2: Run to verify failure** — module does not exist.

**Step 3: Implement**

`StuckPrompt.jsx`:

```javascript
import React from 'react';

/**
 * StuckPrompt — the on-score offer that appears when Learn has been waiting on
 * the same step for a while. Learn's all-notes rule deadlocks on multi-note steps
 * until every active-staff note is struck; the way out is to practise one hand at
 * a time, but that control lives in the transport bar and the field logs show it
 * has NEVER been used (zero score.hands events in three days — audit H3).
 * Discovery of a bar control must not be the gate on Learn being usable, so the
 * offer comes to the user, on the score, at the moment it is relevant.
 *
 * @param {object} p
 * @param {boolean} p.open
 * @param {(value: 'rh'|'lh') => void} p.onPick
 * @param {() => void} p.onDismiss
 */
export default function StuckPrompt({ open, onPick, onDismiss }) {
  if (!open) return null;
  return (
    <div className="piano-score-stuck" role="status" aria-live="polite">
      <span className="piano-score-stuck__text">Stuck? Try one hand.</span>
      <button type="button" className="piano-score-btn" onClick={() => onPick('rh')}>Right hand</button>
      <button type="button" className="piano-score-btn" onClick={() => onPick('lh')}>Left hand</button>
      <button type="button" className="piano-score-btn piano-score-stuck__dismiss" onClick={onDismiss}>Keep both</button>
    </div>
  );
}
```

In `ScorePlayer.jsx`, import it and add the stuck detector after the follow-tracker wiring:

```javascript
  // Surface the hands split after the cursor has sat on one multi-note step for a
  // while. Only when a split would actually help: a grand staff, both hands
  // active, and this step genuinely needs both.
  const [stuckOpen, setStuckOpen] = useState(false);
  const stuckDismissedRef = useRef(false);
  useEffect(() => { setStuckOpen(false); }, [step, mode]);
  useEffect(() => {
    if (mode !== 'learn' || stuckDismissedRef.current) return undefined;
    const staves = new Set((steps[step]?.notes || []).filter((n) => activeParts[n.staff]).map((n) => n.staff));
    if (!grandStaff || staves.size < 2) return undefined;
    const t = setTimeout(() => {
      setStuckOpen(true);
      logger.info('score.learn.stuck-prompt', { step, staves: staves.size });
    }, STUCK_PROMPT_MS);
    return () => clearTimeout(t);
  }, [mode, step, steps, activeParts, grandStaff, logger]);

  const onStuckPick = useCallback((v) => {
    setStuckOpen(false);
    onHandsChange(v);
    logger.info('score.learn.stuck-resolved', { value: v });
  }, [onHandsChange, logger]);
  const onStuckDismiss = useCallback(() => {
    setStuckOpen(false);
    stuckDismissedRef.current = true; // asked and answered — don't nag for the rest of the session
    logger.info('score.learn.stuck-dismissed', {});
  }, [logger]);
```

with a constant beside `SELECT_IDLE_MS`:

```javascript
const STUCK_PROMPT_MS = 5000;
```

> **Ordering matters:** `onHandsChange` and `grandStaff` are declared at ~line 1033-1050, *after* the follow-tracker block. Place this new block **after** `onHandsChange` (i.e. just below line 1050) so the reference resolves. Do not hoist `onHandsChange` — it depends on `disruptListenPlayback`.

Render it inside the scroll container, next to `SelectBanner` (~line 1168):

```javascript
        <StuckPrompt open={stuckOpen && mode === 'learn'} onPick={onStuckPick} onDismiss={onStuckDismiss} />
```

`PianoApp.scss`, beside the select banner:

```scss
// Learn's "stuck on this step" offer — same pinned-to-the-score position as the
// selection banner, so the user's eyes never leave the notation.
.piano-score-stuck {
  position: absolute; bottom: 0.8rem; left: 50%; transform: translateX(-50%); z-index: 22;
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.5rem 0.9rem; border-radius: var(--r-md, 12px);
  background: rgba(20, 24, 30, 0.94); color: #eaf2ff; font-weight: 600;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  .piano-score-stuck__dismiss { opacity: 0.75; }
}
```

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
```

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): offer the hands split when Learn stalls on a step"
```

---

## Task 14: Enter Learn at a sane place

`onMode` doesn't reset the cursor (`ScorePlayer.jsx:856-875`), so Listen→Learn drops the user wherever the Listen playhead happened to be — the 01:49 session entered Learn at **step 32**, mid-piece.

**Files:**
- Modify: `.../SheetMusic/ScorePlayer.jsx`
- Test: `.../SheetMusic/ScorePlayer.test.jsx`

**Step 1: Write the failing test** — assert that switching to `learn` after seeking mid-piece puts the step readout back at the start (or at the loop in-point when a loop is active).

**Step 2: Run to verify failure.**

**Step 3: Implement** — in `onMode`, before `setMode(id)`:

```javascript
    // Learn is a from-the-top (or from-the-loop) exercise: entering it should not
    // strand the user wherever the Listen playhead stopped (audit H3.3).
    if (id === 'learn') {
      const home = homeStep(id === 'perform' ? null : rangeRef.current);
      setStep(home);
      lastAdvanceRef.current = performance.now();
      if (home === 0) scrollRef.current?.scrollTo({ top: 0, left: 0 });
    }
```

**Step 4: Run tests.** **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
git commit -m "fix(piano): enter Learn at the loop in-point or the top"
```

---

# Phase 8 — Remaining small defects

## Task 15: Make the count-in countable at fast tempi

`countInPlan` clicks at the quarter-note pulse × `tempoMult` (`countIn.js:16-18`). Observed in the field: `{bpm: 216, tempoMult: 1.25}` → **270 BPM**, 222ms per beat, four beats in 0.89 seconds. One user cancelled a count-in 1.1 seconds after it started.

**Files:**
- Modify: `.../SheetMusic/countIn.js`
- Test: `.../SheetMusic/countIn.test.js`

**Step 1: Write the failing test**

```javascript
  it('counts in half-notes above the countable rate', () => {
    const p = countInPlan({ beats: 4, bpm: 216, tempoMult: 1.25 }); // 270 effective bpm
    expect(p.subdivision).toBe(2);
    expect(p.beats).toBe(2);
    expect(p.periodMs).toBeCloseTo(444.4, 1);
  });

  it('leaves a normal tempo on the quarter-note pulse', () => {
    const p = countInPlan({ beats: 4, bpm: 90, tempoMult: 1 });
    expect(p.subdivision).toBe(1);
    expect(p.beats).toBe(4);
    expect(p.periodMs).toBeCloseTo(666.7, 1);
  });
```

**Step 2: Run to verify failure.**

**Step 3: Implement**

```javascript
// Above this effective tempo a quarter-note count-in stops being countable and
// becomes a buzz — 216bpm × 1.25 gives four clicks in 0.89s (audit M2).
const MAX_COUNTABLE_BPM = 140;

export function countInPlan({ beats, bpm, tempoMult = 1 }) {
  const b = Number.isFinite(beats) && beats >= 2 && beats <= 12 ? beats : 4; // sane meter, else common time
  const effBpm = (bpm > 0 ? bpm : 90) * (tempoMult > 0 ? tempoMult : 1);
  // Halve the pulse (count in half-notes) rather than shortening the count-in:
  // same musical length, half the clicks, actually countable.
  const subdivision = effBpm > MAX_COUNTABLE_BPM ? 2 : 1;
  const periodMs = (60000 / effBpm) * subdivision;
  const clicks = Math.max(2, Math.ceil(b / subdivision));
  return { beats: clicks, periodMs, totalMs: clicks * periodMs, subdivision };
}
```

**Step 4: Run tests** across the directory — `useCountIn`/`CountInOverlay` consume `beats`, so verify they still pass.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
git commit -m "fix(piano): count in half-notes above 140bpm"
```

---

## Task 16: Stop opening two session logs per score

54 `session-log.start` for 27 score opens. `Logger.js:218` emits one automatically when the `sessionLog` child is created (carrying `app` only), and `ScorePlayer.jsx:1066` emits a second ~300ms later carrying `scoreId`. The first opens a backend session file that never receives another line — seven 416-byte orphans sit in the log directory.

**Files:**
- Modify: `.../SheetMusic/ScorePlayer.jsx`
- Test: `.../SheetMusic/ScorePlayer.telemetry.test.jsx`

**Step 1: Write the failing test** — mount `ScorePlayer` once and assert exactly one `session-log.start` for `app: 'piano-sheetmusic'`. (The `Composer.test.jsx` file at line 78-87 has the pattern for counting these.)

**Step 2: Run to verify failure** — two are emitted.

**Step 3: Implement**

The child logger already opens the session at mount; ScorePlayer only needs to open a *fresh* one when the document changes. Add a ref and guard:

```javascript
  const firstSessionRef = useRef(true);
```

and in the document effect (~line 1066):

```javascript
    // The sessionLog child logger already opened a session file at mount
    // (Logger.js), so opening another here would strand the first as a 416-byte
    // orphan (audit L1). Only a SUBSEQUENT document needs a fresh file.
    if (firstSessionRef.current) firstSessionRef.current = false;
    else startSession(scoreMeta.id);
```

> Note this loses the `scoreId` on the first session's start line. If that matters, the better fix is to add `scoreId` to the child logger's context at `ScorePlayer.jsx:68` — but the child is memoized with `[]` deps, so it would only ever carry the first score's id. Prefer the guard above; the `score.load` event that follows carries the id.

**Step 4: Run tests.** **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
git commit -m "fix(piano): stop opening an orphan session log per score"
```

---

## Task 17: Wire up (or delete) `logLoadFailed`

`logLoadFailed` is defined and returned from `useScoreTelemetry` (`:30,86`) and never called anywhere. `score.load.failed` has never been emitted. Load failures surface only via `SheetMusic.jsx`'s separate `piano.score-open-failed` on a different logger, which does not land in the session log.

**Files:**
- Modify: `.../SheetMusic/SheetMusic.jsx`
- Test: `.../SheetMusic/SheetMusic.test.jsx`

**Step 1: Read `SheetMusic.jsx` first** and find the catch block that emits `piano.score-open-failed` (around line 154). Decide from what you see: if the failure path can reach a mounted `ScorePlayer`, wire `logLoadFailed`; if the failure happens before `ScorePlayer` mounts (likely — the fetch is in `SheetMusic.jsx`), then the honest fix is to **delete** `logLoadFailed` from `useScoreTelemetry` and route the existing `piano.score-open-failed` call through a `sessionLog` child logger instead, so it lands in the same file as everything else.

**Step 2: Write the test** for whichever path you chose — assert that a failed score open produces exactly one event in the session log.

**Step 3–4: Implement and verify.**

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
git commit -m "fix(piano): route score load failures into the session log"
```

---

# After the plan

## Verify the whole module

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
npx vitest run frontend/src/modules/Piano/PianoKiosk/
```

Both must be green before this branch is considered done.

## On-kiosk verification (required — this module has burned us before)

Per `feedback_dont_ask_check_yourself` and the module's history, unit tests are not sufficient evidence for this component. On the piano tablet (10.0.0.245):

1. Open a heavy score (creature-trainer-battle) and confirm the log file for one session is now **hundreds** of lines, not tens of thousands:
   ```bash
   ssh {env.prod_host} "cd {dropbox}/Apps/DaylightStation/media/logs/piano-sheetmusic && wc -l \$(ls -t *.jsonl | head -1)"
   ```
2. Play a piece to the end, then press Play again — it must play the piece, not 1.6s of the final measure.
3. Set a **one-measure** loop in Polish, play it, pause — a run summary must appear with a grade. This is the exact scenario that produced nothing in the field.
4. In Listen, start playback and change "My part" — the music must resume by itself within a beat.
5. In Learn on a grand-staff piece, play one note of a two-note step — the outstanding notehead must pulse, and after ~5s the hands prompt must appear.

## Not in this plan (deliberately)

- **H6 (engrave time / renderer deaths).** Big scores take 15–24s to engrave and the app restarts mid-run. The audit itself says this crosses into the kiosk watchdog's territory and needs a cross-check against `/diagnostics` and CrashLog before attributing cause. Fixing Task 2 removes ~65k log objects per session from the renderer's allocation path — **re-measure `openToReadyMs` after this branch ships before designing an engrave cache.**
- **Perform's pedal page-turn.** Zero `score.perform.pageturn` in three days. This is a device test against the Jamcorder MIDI path (`advancePedalCC: 67`, `backPedalCC: 66`), not a code change. Run it separately.
- **Re-collecting logs.** After Phase 1 lands, collect a fresh week before judging anything else in the module. Every measurement taken before it is contaminated.
