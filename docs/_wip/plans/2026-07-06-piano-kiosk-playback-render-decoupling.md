# Piano Kiosk Playback/Render Decoupling Implementation Plan

> **Status (2026-07-06): EXECUTED** on branch `worktree-piano-playback-decoupling`. All 12
> tasks done (Task 6/7 combined into an atomic R1 note-store migration). Unit suite green
> (157 files / 1583 tests); the 2 pre-existing `frontend/src/Apps/` failures are confirmed
> unrelated (they fail identically at the pre-branch baseline). Commit SHAs and the
> finding→commit map are in the audit's
> [Implementation status](../audits/2026-07-06-piano-kiosk-playback-render-decoupling-audit.md#implementation-status-2026-07-06).
> **On-device validation is still pending** — see that section's checklist. Task bodies below
> are the original plan, left as written.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make sheet-music MIDI playback rhythm immune to main-thread jank on the SM-T590 kiosk by moving audio timing onto timestamped Web-MIDI sends and the AudioContext clock, and by cutting the per-note React render cascade.

**Architecture:** "Two clocks" separation. The **audio plane** (MIDI note sends, metronome clicks) is scheduled ~400 ms ahead with explicit timestamps — Chromium's browser-process MIDI service and the WebAudio thread dispatch them on time no matter what the page's main thread is doing. The **visual plane** (cursor, note light-up, keyboard) fires at musical due-time from a coarse `setInterval` tick (never `requestAnimationFrame` — that's the throttled clock on this device) and is allowed to be late. Per-note whole-kiosk re-renders are eliminated by splitting the MIDI context into a stable command surface + a subscription-based live-note store.

**Tech Stack:** React 18, Web MIDI (`MIDIOutput.send(data, timestamp)`), WebAudio, OpenSheetMusicDisplay 2.0, vitest (`npx vitest run` from repo root), Playwright.

**Source spec:** [`docs/_wip/audits/2026-07-06-piano-kiosk-playback-render-decoupling-audit.md`](../audits/2026-07-06-piano-kiosk-playback-render-decoupling-audit.md) — findings T1–T4, R1–R5, E1. Read it before starting. Device background: [`docs/reference/piano/performance.md`](../../reference/piano/performance.md).

**Key paths (all under `frontend/src/`):**
- `modules/Piano/PianoKiosk/modes/SheetMusic/` — ScorePlayer, transport, click, overlays
- `modules/Piano/PianoKiosk/useWebMidiBLE.js` — the single MIDI authority
- `modules/Piano/PianoKiosk/PianoMidiContext.jsx` — context provider
- `modules/MusicNotation/renderers/` — MusicXmlRenderer.jsx, osmdRender.js

**Conventions:** run tests from the **repo root** with `npx vitest run <path>`. Tests are colocated (`foo.test.js` next to `foo.js`). Follow the existing ref-based hook patterns (callbacks read through refs so subscriptions never re-fire). Commit after every task (this is an isolated feature branch — per-task commits are authorized).

---

## Task 0: Preflight — sync check and worktree

The local tree is frequently behind the homeserver deploy tree (see `CLAUDE.local.md`). Building on a stale tree caused duplicate-implementation disasters before.

**Step 1: Check sync state**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
git fetch origin && git log --oneline origin/main..main | head
ssh homeserver.local 'cd /opt/Code/DaylightStation && git branch --show-current && git log --oneline origin/main..HEAD | head'
```

Expected: no unpushed homeserver commits touching `frontend/src/modules/Piano/` or `frontend/src/modules/MusicNotation/`. **If there are, STOP and integrate them first** (fetch the homeserver branch, merge into local main, push).

**Step 2: Create the worktree**

```bash
git worktree add .worktrees/piano-playback-decoupling -b feat/piano-playback-decoupling main
cd .worktrees/piano-playback-decoupling
npm install 2>/dev/null || true   # only if node_modules isn't shared/present
```

**Step 3: Baseline — confirm the touched suites are green before changing anything**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic frontend/src/modules/MusicNotation frontend/src/modules/Piano/PianoKiosk
```

Expected: all pass. If any fail pre-existing, record them in the commit message of Task 1 and do not try to fix them here.

---

## Task 1: Timestamped note senders in `useWebMidiBLE`

Web MIDI's `send(data, timestamp)` (timestamp in the `performance.now()` domain) is the decoupling primitive. `scheduleNotes()` at `useWebMidiBLE.js:328-338` already proves the pattern; we need single-note absolute-time variants that carry **no React state side effects** (unlike `pressNote`/`releaseNote`, which also mutate `activeNotes` — we must not light keys 400 ms early).

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.sendAt.test.js` (new)

**Step 1: Write the failing test**

Look at `useWebMidiBLE.noteOff.test.js` first and copy its MIDI-access mocking setup (it stubs `navigator.requestMIDIAccess` with fake input/output ports). Then:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebMidiBLE } from './useWebMidiBLE.js';

// ── reuse the requestMIDIAccess mock pattern from useWebMidiBLE.noteOff.test.js ──
// (fake access object with one input, one output; output.send = vi.fn())

describe('sendNoteAt / sendNoteOffAt', () => {
  it('sends note-on with the exact wall timestamp and no state side effects', async () => {
    const { result, output } = await connectHook(); // helper per the existing test file
    act(() => { result.current.sendNoteAt(60, 90, 12345.5); });
    expect(output.send).toHaveBeenCalledWith([0x90, 60, 90], 12345.5);
    // No applyNoteOn: the store/state must NOT contain the note
    expect(result.current.activeNotes.has?.(60) ?? false).toBe(false);
  });

  it('sends note-off with the exact wall timestamp', async () => {
    const { result, output } = await connectHook();
    act(() => { result.current.sendNoteOffAt(60, 23456.25); });
    expect(output.send).toHaveBeenCalledWith([0x80, 60, 0], 23456.25);
  });

  it('returns false when no output port exists', async () => {
    const { result } = await connectHook({ outputs: [] });
    expect(result.current.sendNoteAt(60, 90, 100)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.sendAt.test.js
```

Expected: FAIL — `result.current.sendNoteAt is not a function`.

**Step 3: Implement**

In `useWebMidiBLE.js`, next to `sendNote` (line ~303):

```js
/**
 * Timestamped note senders — the audio plane of the score transport. `atMs` is
 * an absolute performance.now()-domain time; Chromium queues the message in the
 * browser-process MIDI service and dispatches it on schedule regardless of
 * main-thread jank (the whole point — see the 2026-07-06 decoupling audit T2).
 * Deliberately NO applyNoteOn/applyNoteOff: scheduled notes must not light the
 * keyboard ahead of when they sound; visuals fire separately at due time.
 */
const sendNoteAt = useCallback((note, velocity = 80, atMs, channel = 0) => {
  const out = outputRef.current;
  if (!out) return false;
  out.send([0x90 | (channel & 0x0f), note & 0x7f, velocity & 0x7f], atMs);
  return true;
}, []);

const sendNoteOffAt = useCallback((note, atMs, channel = 0) => {
  const out = outputRef.current;
  if (!out) return false;
  out.send([0x80 | (channel & 0x0f), note & 0x7f, 0], atMs);
  return true;
}, []);
```

Add both to the returned object AND its `useMemo` dependency array (line ~392-413).

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.sendAt.test.js frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.noteOff.test.js
```

Expected: PASS (both files — the second proves no regression).

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.js frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.sendAt.test.js
git commit -m "feat(piano): timestamped sendNoteAt/sendNoteOffAt on the MIDI surface"
```

---

## Task 2: Lookahead transport — rewrite `useScoreTransport`

The core change (audit T1+T2). The transport gains an **audio plane**: an `onSchedule(ev, dueWallMs, leadMs)` callback invoked for note events up to `lookaheadMs` ahead of due time, and the driver moves from `requestAnimationFrame` to `setInterval(tick, tickMs)`. The **visual plane** (`onEvent`/`onFire`) is unchanged in shape: ALL events (steps *and* notes) still fire through `onEvent` at due time — notes flow through both planes; the consumer sends MIDI only from `onSchedule` and paints only from `onEvent`.

Two independent indices walk the same time-sorted array:
- `schedIdxRef` — advances to `t ≤ pos + lookaheadMs`, calls `onSchedule` for note events only (skips steps).
- `fireIdxRef` — advances to `t ≤ pos`, calls `onFire` + `onEvent` for everything. Completion (`onDone`) keys off `fireIdxRef`.

Pause/seek/stop reset `schedIdxRef = fireIdxRef` so resume re-schedules from the cursor. Already-dispatched future sends can't be recalled — that's the consumer's flush contract (Task 3).

**Files:**
- Rewrite: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTransport.js`
- Rewrite: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTransport.test.js`

**Step 1: Rewrite the test file (failing first)**

Replace the whole test file. The fake-timer setup gets SIMPLER — no rAF stubs needed, `setInterval` is natively driven by `vi.advanceTimersByTime`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useScoreTransport } from './useScoreTransport.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  vi.setSystemTime(0);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Steps (visual) and notes (audio) interleaved, time-sorted.
const STEPS = [
  { t: 0, index: 0, kind: 'step' }, { t: 500, index: 1, kind: 'step' },
  { t: 1000, index: 2, kind: 'step' }, { t: 1500, index: 3, kind: 'step' },
];
const MIXED = [
  { t: 0, index: 0, kind: 'step' },
  { t: 0, type: 'note_on', note: 60, velocity: 80 },
  { t: 480, type: 'note_off', note: 60 },
  { t: 500, index: 1, kind: 'step' },
  { t: 500, type: 'note_on', note: 64, velocity: 80 },
  { t: 980, type: 'note_off', note: 64 },
];

describe('useScoreTransport (lookahead scheduler)', () => {
  it('fires step events at their absolute due times', () => {
    const fired = [];
    const { result } = renderHook(() => useScoreTransport({ timeline: STEPS, onEvent: (e) => fired.push(e.index) }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(520));
    expect(fired).toEqual([0, 1]);
    act(() => vi.advanceTimersByTime(1100));
    expect(fired).toEqual([0, 1, 2, 3]);
  });

  it('schedules note events ahead with absolute wall timestamps', () => {
    const sched = [];
    const { result } = renderHook(() => useScoreTransport({
      timeline: MIXED,
      onEvent: () => {},
      onSchedule: (e, atWall, leadMs) => sched.push({ note: e.note, type: e.type, atWall, leadMs }),
      lookaheadMs: 400, tickMs: 100,
    }));
    act(() => result.current.play()); // immediate tick at pos=0: horizon=400 → t:0 and t:380- events
    // t=0 note_on scheduled at wall 0; t=480/500 not yet (beyond 400ms horizon)
    expect(sched.map((s) => [s.type, s.note, s.atWall])).toEqual([['note_on', 60, 0]]);
    act(() => vi.advanceTimersByTime(100)); // pos=100, horizon=500 → t:480 off + t:500 on
    expect(sched.map((s) => s.atWall)).toEqual([0, 480, 500]);
    // Lead time is positive (scheduled ahead) for the later events
    expect(sched[1].leadMs).toBeGreaterThan(0);
  });

  it('never routes step events through onSchedule, and still fires notes via onEvent at due time', () => {
    const sched = []; const fired = [];
    const { result } = renderHook(() => useScoreTransport({
      timeline: MIXED, onSchedule: (e) => sched.push(e), onEvent: (e) => fired.push(e),
    }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(1100));
    expect(sched.every((e) => e.type === 'note_on' || e.type === 'note_off')).toBe(true);
    expect(fired.length).toBe(MIXED.length); // steps AND notes fire visually at due time
  });

  it('pause rewinds the scheduling index so resume re-schedules pending notes', () => {
    const sched = [];
    const { result } = renderHook(() => useScoreTransport({
      timeline: MIXED, onEvent: () => {},
      onSchedule: (e, atWall) => sched.push({ note: e.note, type: e.type, atWall }),
      lookaheadMs: 400, tickMs: 100,
    }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(150)); // t:480/500 events scheduled (horizon 550)
    const before = sched.length;
    act(() => result.current.pause());      // pos ≈150; fired only t:0 events
    act(() => result.current.play());       // re-anchor; schedIdx was rewound to fireIdx
    act(() => vi.advanceTimersByTime(400));
    // The t=480/t=500 events appear AGAIN with NEW (later) wall timestamps
    const again = sched.slice(before).filter((s) => s.atWall > 480);
    expect(again.length).toBeGreaterThanOrEqual(2);
  });

  it('pause holds position; resume neither replays nor skips fired events', () => {
    const fired = [];
    const { result } = renderHook(() => useScoreTransport({ timeline: STEPS, onEvent: (e) => fired.push(e.index) }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(700));
    act(() => result.current.pause());
    act(() => vi.advanceTimersByTime(5000));
    expect(fired).toEqual([0, 1]);
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(320));
    expect(fired).toEqual([0, 1, 2]);
  });

  it('seek repositions both planes; the event AT the seek time fires', () => {
    const fired = [];
    const { result } = renderHook(() => useScoreTransport({ timeline: STEPS, onEvent: (e) => fired.push(e.index) }));
    act(() => result.current.seek(1000));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(40));
    expect(fired).toEqual([2]);
  });

  it('finishes when the FIRE index exhausts (not the schedule index)', () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useScoreTransport({ timeline: MIXED, onEvent: () => {}, onSchedule: () => {}, onDone }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(700)); // everything SCHEDULED by now, but t:980 not FIRED
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(500));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(result.current.playing).toBe(false);
  });

  it('stop resets to the top', () => {
    const fired = [];
    const { result } = renderHook(() => useScoreTransport({ timeline: STEPS, onEvent: (e) => fired.push(e.index) }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(700));
    act(() => result.current.stop());
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(40));
    expect(fired).toEqual([0, 1, 0]);
  });

  it('reports fire drift and tick gap via onFire; passes dueWall to onEvent', () => {
    const fires = []; const walls = [];
    const { result } = renderHook(() => useScoreTransport({
      timeline: [{ t: 0, index: 0, kind: 'step' }, { t: 100, index: 1, kind: 'step' }],
      onEvent: (e, dueWall) => walls.push(dueWall),
      onFire: (e, driftMs, gapMs) => fires.push({ driftMs, gapMs }),
    }));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(200));
    expect(fires.length).toBe(2);
    expect(fires.every((f) => f.driftMs >= 0 && Number.isFinite(f.gapMs))).toBe(true);
    expect(walls).toEqual([0, 100]); // anchor was wall 0
  });
});
```

**Step 2: Run to verify failures**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTransport.test.js
```

Expected: FAIL (onSchedule never called; timing off since rAF driver gone from stubs).

**Step 3: Rewrite the hook**

Full replacement of `useScoreTransport.js`:

```js
import { useState, useRef, useCallback, useEffect } from 'react';

const isNote = (ev) => ev.type === 'note_on' || ev.type === 'note_off';

/**
 * useScoreTransport — two-plane playback over a flat, time-sorted event list
 * [{t, ...}] (ms from piece start), anchored to performance.now().
 *
 * AUDIO PLANE: note events ({type:'note_on'|'note_off'}) are handed to
 * `onSchedule(ev, dueWallMs, leadMs)` up to `lookaheadMs` BEFORE they are due,
 * so the consumer can send them with Web-MIDI timestamps. Once handed off, the
 * browser's MIDI service dispatches them on time regardless of main-thread
 * jank (2026-07-06 decoupling audit T1/T2).
 *
 * VISUAL PLANE: every event (steps AND notes) fires through `onEvent(ev,
 * dueWallMs)` at musical due time — late is fine, that's just a late frame.
 *
 * The driver is a coarse setInterval — NEVER requestAnimationFrame, which is
 * the OS-throttled clock on the kiosk tablet. A late tick only eats lookahead
 * margin; it cannot delay already-scheduled audio.
 *
 * Pause/seek rewind the schedule index to the fire index so resume re-schedules
 * pending notes with fresh timestamps. Already-dispatched future sends cannot
 * be recalled — the CONSUMER must flush (silence now + panic after the
 * lookahead window; see ScorePlayer's silenceScheduled).
 */
export function useScoreTransport({
  timeline, onEvent, onFire, onSchedule, onDone,
  lookaheadMs = 400, tickMs = 100,
}) {
  const [playing, setPlaying] = useState(false);
  const timelineRef = useRef(timeline); timelineRef.current = timeline || [];
  const onEventRef = useRef(onEvent); onEventRef.current = onEvent;
  const onFireRef = useRef(onFire); onFireRef.current = onFire;
  const onScheduleRef = useRef(onSchedule); onScheduleRef.current = onSchedule;
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone;
  const intervalRef = useRef(null);
  const anchorRef = useRef(0);   // wall time corresponding to position 0
  const posRef = useRef(0);      // position while paused (ms)
  const fireIdxRef = useRef(0);  // next event to FIRE (visual, at due time)
  const schedIdxRef = useRef(0); // next event to consider for audio scheduling
  const lastPosRef = useRef(0);  // position at previous tick (tick-gap jitter)

  const clearTimer = () => { if (intervalRef.current != null) { clearInterval(intervalRef.current); intervalRef.current = null; } };

  const tick = useCallback(() => {
    const tl = timelineRef.current;
    const pos = performance.now() - anchorRef.current;
    const gapMs = pos - lastPosRef.current;
    lastPosRef.current = pos;

    // Audio plane: hand note events to the MIDI service ahead of time.
    if (onScheduleRef.current) {
      const horizon = pos + lookaheadMs;
      while (schedIdxRef.current < tl.length && tl[schedIdxRef.current].t <= horizon) {
        const ev = tl[schedIdxRef.current];
        if (isNote(ev)) onScheduleRef.current(ev, anchorRef.current + ev.t, ev.t - pos);
        schedIdxRef.current += 1;
      }
    }

    // Visual plane: fire everything due now.
    while (fireIdxRef.current < tl.length && tl[fireIdxRef.current].t <= pos) {
      const ev = tl[fireIdxRef.current];
      onFireRef.current?.(ev, pos - ev.t, gapMs);
      onEventRef.current?.(ev, anchorRef.current + ev.t);
      fireIdxRef.current += 1;
    }

    if (fireIdxRef.current >= tl.length) {
      clearTimer();
      posRef.current = 0; fireIdxRef.current = 0; schedIdxRef.current = 0;
      setPlaying(false);
      onDoneRef.current?.();
    }
  }, [lookaheadMs]);

  const play = useCallback(() => {
    if (!timelineRef.current.length) return;
    anchorRef.current = performance.now() - posRef.current;
    lastPosRef.current = posRef.current;
    clearTimer();
    setPlaying(true);
    intervalRef.current = setInterval(tick, tickMs);
    tick(); // immediate: schedule the first window + fire anything already due
  }, [tick, tickMs]);

  const pause = useCallback(() => {
    clearTimer();
    posRef.current = performance.now() - anchorRef.current;
    schedIdxRef.current = fireIdxRef.current; // resume re-schedules from the cursor
    setPlaying(false);
  }, []);

  /** Reposition (works while playing or paused). Event at exactly `ms` will fire. */
  const seek = useCallback((ms) => {
    const pos = Math.max(0, ms);
    posRef.current = pos;
    const tl = timelineRef.current;
    const i = tl.findIndex((e) => e.t >= pos);
    fireIdxRef.current = i < 0 ? tl.length : i;
    schedIdxRef.current = fireIdxRef.current;
    anchorRef.current = performance.now() - pos;
  }, []);

  const stop = useCallback(() => {
    clearTimer();
    posRef.current = 0; fireIdxRef.current = 0; schedIdxRef.current = 0;
    setPlaying(false);
  }, []);

  useEffect(() => () => clearTimer(), []);
  return { playing, play, pause, seek, stop, lookaheadMs };
}

export default useScoreTransport;
```

Note `lookaheadMs` is returned — Task 3's delayed flush needs it.

**Step 4: Run tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTransport.test.js
```

Expected: PASS (all 9).

**Step 5: Run the neighboring suites (ScorePlayer still compiles against the old wiring — it passes `onEvent`/`onFire` only, which are unchanged in shape)**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic
```

Expected: PASS. If `ScorePlayer.test.jsx` breaks on timing, its fake-timer advances may assume rAF cadence — adjust advances to ≥`tickMs` boundaries.

**Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTransport.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTransport.test.js
git commit -m "feat(piano): two-plane lookahead score transport (interval-driven, timestamped audio)"
```

---

## Task 3: Wire ScorePlayer — audio via `onSchedule`, visuals via `onEvent`, flush contract

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx` (extend)

**Behavior changes to encode (and their rationale — put this in the commit message):**
1. Listen-mode MIDI leaves via `sendNoteAt`/`sendNoteOffAt` with the transport's wall timestamp — **not** `pressNote`/`releaseNote`. Kiosk-performed notes therefore no longer light the on-screen **keyboard** as "active" (they were never human input); they still light the **noteheads** via `struck`, which now updates at due time from the visual plane. Human playing on the real piano lights the keyboard exactly as before.
2. Pause/seek/mode-change flush becomes **two-stage**: `silence()` immediately (releases everything believed sounding + panic), then one delayed `sendPanic()` after `lookaheadMs + 60` to kill notes whose scheduled note-ons dispatched after the first flush. All pending timestamps are ≤ pause-time + lookahead, so the delayed panic covers the entire tail.

**Step 1: Write failing tests**

Add to `ScorePlayer.test.jsx` (reuse its existing render/mock scaffolding — it already mocks `usePianoMidi`; extend the mock with `sendNoteAt: vi.fn()`, `sendNoteOffAt: vi.fn()`):

```js
it('listen mode sends scheduled notes with timestamps, not pressNote', async () => {
  // render in listen mode with a layout containing note events; press play;
  // advance past one note onset
  expect(midiMock.sendNoteAt).toHaveBeenCalled();
  const [note, vel, atWall] = midiMock.sendNoteAt.mock.calls[0];
  expect(typeof atWall).toBe('number');
  expect(midiMock.pressNote).not.toHaveBeenCalled();
});

it('pause sends an immediate flush AND a delayed panic after the lookahead window', async () => {
  // play in listen mode, advance, pause
  const panicsAtPause = midiMock.sendPanic.mock.calls.length;
  expect(panicsAtPause).toBeGreaterThanOrEqual(1);
  await act(() => vi.advanceTimersByTime(500)); // > lookaheadMs + 60
  expect(midiMock.sendPanic.mock.calls.length).toBeGreaterThan(panicsAtPause);
});
```

(Adapt to the file's existing harness style — it drives layout via the mocked renderer's `onLayout`.)

**Step 2: Run to verify they fail**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx
```

**Step 3: Implement in ScorePlayer.jsx**

3a. Destructure the new senders (line ~62):

```js
const { activeNotes, subscribe, subscribeRaw, pressNote, releaseNote, sendNoteAt, sendNoteOffAt, sendPanic } = usePianoMidi();
```

3b. Replace the transport wiring (lines ~200-229). The note branch moves OUT of `onEvent` into `onSchedule`; `onEvent`'s note branch keeps only the `setStruck` light-up:

```js
const transport = useScoreTransport({
  timeline: mode === 'polish' || mode === 'listen' ? playTimeline : [],
  // AUDIO PLANE — runs up to lookaheadMs ahead; must touch NO React state
  // beyond the sounding ledger (used only for flush bookkeeping).
  onSchedule: (e, atWall, leadMs) => {
    if (e.type === 'note_on') {
      sendNoteAt?.(e.note, e.velocity ?? 80, atWall);
      soundingRef.current.add(e.note);
    } else {
      sendNoteOffAt?.(e.note, atWall);
      soundingRef.current.delete(e.note);
    }
    pendingPlaybackRef.current = true;
    recordSchedule(e, leadMs);
  },
  // VISUAL PLANE — fires at musical due time; allowed to be late.
  onEvent: (e, dueWall) => {
    if (e.kind === 'step' || e.type == null) {
      const r = rangeRef.current;
      if (r && e.index > r[1]) {
        transportRef.current?.seek((stepTimeline[r[0]]?.t ?? 0) / tempoMult);
        setStep(r[0]);
        setStruck(() => new Set());
        return;
      }
      stepStartRef.current = dueWall; // musical step start (audit T4) — not commit time
      setStep(e.index);
      setStruck(() => new Set());
      return;
    }
    if (e.type === 'note_on') {
      setStruck((prev) => { const n = new Set(prev); n.add(e.note); return n; }); // bouncing-ball light-up
    }
  },
  onFire: (ev, driftMs, gapMs) => { recordFire(ev, driftMs, gapMs, tempoMap[0]?.bpm); },
  onDone: () => { if (mode === 'listen') silenceScheduled(); flushPlaybackNow(); logger.info('score.transport.done', { mode, steps: events.length }); },
});
```

3c. Remove the now-redundant `useEffect(() => { stepStartRef.current = performance.now(); }, [step])` at line ~261 (dueWall stamping replaces it — audit T4). `driftForNote` is unchanged.

3d. Add the two-stage flush below `silence` (line ~189) and use it everywhere `silence()` guarded a listen-mode stop (in `onScoreClick` seek, `onMode`, `reset`, `toggleRun` pause, `onCyclePart`, the unmount effect at line ~506):

```js
// Scheduled sends already handed to the MIDI service can't be recalled
// (MIDIOutput.clear() is unreliable on this WebView) — flush twice: now for
// everything sounding, and once more after the lookahead window for note-ons
// that dispatch after the first flush. All pending timestamps are ≤
// pause-time + lookahead, so the delayed panic covers the whole tail.
const flushTimerRef = useRef(null);
const silenceScheduled = useCallback(() => {
  silence();
  clearTimeout(flushTimerRef.current);
  flushTimerRef.current = setTimeout(() => sendPanic?.(), (transportRef.current?.lookaheadMs ?? 400) + 60);
}, [silence, sendPanic]);
useEffect(() => () => clearTimeout(flushTimerRef.current), []);
```

Replace each listen-mode `silence()` call site with `silenceScheduled()` (grep: `rg -n "silence\(\)" ScorePlayer.jsx`). Keep plain `silence` only inside `silenceScheduled` itself.

3e. `recordSchedule` doesn't exist yet — stub it into the `useScoreTelemetry` destructure now and implement in Task 4 (or implement Task 4 first if you prefer strictly-green intermediate states; the stub `const recordSchedule = () => {}` is acceptable for one commit).

**Step 4: Run the suite**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic
```

Expected: PASS, including the two new tests.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx
git commit -m "feat(piano): ScorePlayer audio plane on timestamped sends; two-stage pause flush; musical-time step stamps"
```

---

## Task 4: Telemetry — scheduled-lead stats

Success criterion for the whole project: **scheduled drift ≈ 0 while wakeup drift stays ugly under throttle**. Make that measurable.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.test.js` (extend)

**Step 1: Failing test**

```js
it('collects schedule leads and reports them in playback stats', () => {
  const { result } = renderHook(() => useScoreTelemetry({ id: 'x' }));
  act(() => {
    result.current.recordSchedule({ note: 60 }, 350);
    result.current.recordSchedule({ note: 62 }, 120);
    result.current.recordSchedule({ note: 64 }, -20); // scheduled LATE — logs a warn
    result.current.flushPlayback('listen');
  });
  const stats = loggerMock.info.mock.calls.find(([evt]) => evt === 'score.playback.stats')[1];
  expect(stats.meanLeadMs).toBe(150);
  expect(stats.minLeadMs).toBe(-20);
  expect(stats.schedLate).toBe(1);
  expect(loggerMock.warn).toHaveBeenCalledWith('score.playback.sched-late', expect.objectContaining({ leadMs: -20 }));
});
```

(Match the file's existing logger-mock pattern.)

**Step 2: Run — FAIL** (`recordSchedule` is not a function).

**Step 3: Implement** in `useScoreTelemetry.js`:

```js
const leads = useRef([]);

const recordSchedule = useCallback((ev, leadMs) => {
  leads.current.push(leadMs);
  // A negative lead means the tick woke later than the event's due time —
  // the note was sent with a past timestamp (dispatches immediately, audibly
  // late). Rare by design; each one is worth a line.
  if (leadMs < 0) logger.warn('score.playback.sched-late', { note: ev.note, leadMs: Math.round(leadMs) });
}, [logger]);
```

Extend `flushPlayback` stats payload:

```js
const l = leads.current;
const meanLeadMs = l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : 0;
logger.info('score.playback.stats', {
  mode, events: d.count,
  meanDriftMs: ..., p95DriftMs: ..., maxDriftMs: ...,   // existing
  stalls: stalls.current, maxFrameGapMs: ...,            // existing
  scheduled: l.length, meanLeadMs, minLeadMs: l.length ? Math.round(Math.min(...l)) : 0,
  schedLate: l.filter((x) => x < 0).length,
});
leads.current = [];
```

Export `recordSchedule`; remove the Task-3 stub in ScorePlayer and destructure it for real.

**Step 4: Run**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTelemetry.test.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add -A frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic
git commit -m "feat(piano): schedule-lead telemetry (meanLeadMs/minLeadMs/schedLate) in playback stats"
```

---

## Task 5: Metronome click on the AudioContext clock

Replace the `setInterval → play-now` click (audit T3) with a lookahead beat scheduler: a coarse timer wakes every ~100 ms and schedules every beat due in the next ~300 ms via `osc.start(t)` on the **audio clock** — sample-accurate regardless of main-thread state.

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/clickScheduler.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/clickScheduler.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/click.js` (add `scheduleBlipAt`, keep `playClick` for any other caller)
- Rewrite: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useMetronomeClick.js` + its test
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (drop the `onTick: playClick` wiring)

**Step 1: Failing tests for the scheduler (pure logic, fully injectable)**

```js
// clickScheduler.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClickScheduler } from './clickScheduler.js';

function fakeCtx() { return { currentTime: 0, state: 'running', resume: vi.fn() }; }

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createClickScheduler', () => {
  it('schedules every beat inside the lookahead window on the AUDIO clock', () => {
    const ac = fakeCtx();
    const blips = [];
    const s = createClickScheduler({ getCtx: () => ac, scheduleBlip: (_ac, t) => blips.push(t), lookaheadS: 0.3, tickMs: 100 });
    s.start(120); // period 0.5s; first beat ~ +0.08
    // immediate tick: beats at 0.08 (0.58 is beyond 0.3 horizon)
    expect(blips.map((t) => +t.toFixed(2))).toEqual([0.08]);
    ac.currentTime = 0.4; vi.advanceTimersByTime(100);
    expect(blips.map((t) => +t.toFixed(2))).toEqual([0.08, 0.58]);
    s.stop();
  });

  it('never schedules the same beat twice even when ticks overlap windows', () => {
    const ac = fakeCtx();
    const blips = [];
    const s = createClickScheduler({ getCtx: () => ac, scheduleBlip: (_a, t) => blips.push(t), lookaheadS: 0.3, tickMs: 100 });
    s.start(120);
    vi.advanceTimersByTime(100); // audio clock hasn't moved — window unchanged
    expect(blips.length).toBe(1);
    s.stop();
  });

  it('setBpm changes spacing from the NEXT beat (keeps phase, no restart)', () => {
    const ac = fakeCtx();
    const blips = [];
    const s = createClickScheduler({ getCtx: () => ac, scheduleBlip: (_a, t) => blips.push(t), lookaheadS: 1.2, tickMs: 100 });
    s.start(60); // period 1s → beats 0.08, 1.08 within 1.2
    expect(blips.map((t) => +t.toFixed(2))).toEqual([0.08, 1.08]);
    s.setBpm(120); // period 0.5 from the next unscheduled beat
    ac.currentTime = 1.0; vi.advanceTimersByTime(100); // horizon 2.2 → 1.58, 2.08
    expect(blips.map((t) => +t.toFixed(2))).toEqual([0.08, 1.08, 1.58, 2.08]);
    s.stop();
  });

  it('stop halts future scheduling', () => {
    const ac = fakeCtx();
    const blips = [];
    const s = createClickScheduler({ getCtx: () => ac, scheduleBlip: (_a, t) => blips.push(t) });
    s.start(120);
    s.stop();
    ac.currentTime = 5; vi.advanceTimersByTime(1000);
    expect(blips.length).toBe(1);
  });
});
```

**Step 2: Run — FAIL** (module doesn't exist).

**Step 3: Implement `clickScheduler.js`**

```js
// clickScheduler.js — lookahead metronome beat scheduler ("a tale of two clocks").
//
// A coarse setInterval wakes every ~100 ms and schedules, via WebAudio, every
// beat that falls inside the next `lookaheadS` seconds — each at an exact
// AudioContext-clock time. Already-scheduled oscillators play from the audio
// thread, so click timing is sample-accurate no matter how badly the main
// thread janks (2026-07-06 decoupling audit T3). Never compute "now + period":
// beat times accumulate as t0 + n·period on the audio clock, so timer jitter
// can't drift the pulse.

import { audioContext, scheduleBlipAt } from './click.js';

export function createClickScheduler({
  getCtx = audioContext,
  scheduleBlip = scheduleBlipAt,
  lookaheadS = 0.3,
  tickMs = 100,
} = {}) {
  let timer = null;
  let nextBeat = 0;   // AudioContext-clock time of the next unscheduled beat
  let periodS = 0.5;

  const tick = () => {
    const ac = getCtx();
    if (!ac) return;
    const horizon = ac.currentTime + lookaheadS;
    while (nextBeat < horizon) {
      scheduleBlip(ac, nextBeat);
      nextBeat += periodS;
    }
  };

  return {
    start(bpm) {
      const ac = getCtx();
      if (!ac) return; // no WebAudio (jsdom) — silent no-op, same as playClick
      if (ac.state === 'suspended') ac.resume();
      periodS = 60 / bpm;
      nextBeat = ac.currentTime + 0.08; // first click essentially immediately
      tick();
      timer = setInterval(tick, tickMs);
    },
    setBpm(bpm) { if (bpm > 0) periodS = 60 / bpm; },
    stop() { if (timer != null) { clearInterval(timer); timer = null; } },
  };
}

export default createClickScheduler;
```

In `click.js`: export the existing lazy `audioContext()` (it's currently module-private) and add the timed blip (same envelope as `playClick`, parameterized start):

```js
export { audioContext };

/** Schedule the standard ~1kHz/40ms blip at an exact AudioContext time. */
export function scheduleBlipAt(ac, t) {
  try {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'square';
    osc.frequency.value = 1000;
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.045);
  } catch { /* audio device gone — ignore */ }
}
```

**Step 4: Rewrite `useMetronomeClick`** (and its test — inject a fake scheduler factory):

```js
import { useEffect, useRef } from 'react';
import { createClickScheduler } from './clickScheduler.js';

/**
 * useMetronomeClick — audio-clock metronome. While `enabled`, beats are
 * scheduled ahead on the AudioContext clock (see clickScheduler.js) so the
 * click stays locked under main-thread jank. bpm changes retune the period
 * live WITHOUT restarting (phase is kept).
 */
export function useMetronomeClick({ enabled, bpm, createScheduler = createClickScheduler }) {
  const schedRef = useRef(null);
  const bpmRef = useRef(bpm); bpmRef.current = bpm;

  useEffect(() => {
    if (!enabled || !(bpmRef.current > 0)) return undefined;
    const s = createScheduler();
    schedRef.current = s;
    s.start(bpmRef.current);
    return () => { s.stop(); schedRef.current = null; };
  }, [enabled, createScheduler]);

  useEffect(() => { if (bpm > 0) schedRef.current?.setBpm(bpm); }, [bpm]);
}

export default useMetronomeClick;
```

Test (rewrite `useMetronomeClick.test.js`): fake scheduler `{start, stop, setBpm}` spies; assert start-on-enable, stop-on-disable/unmount, `setBpm` (not restart) on bpm change.

**Step 5: Update ScorePlayer** — remove `import { playClick } from './click.js'` and the `onTick: playClick` option; the hook signature no longer takes `onTick`:

```js
useMetronomeClick({ enabled: clickOn && (mode === 'learn' || mode === 'listen'), bpm: clickBpm });
```

**Step 6: Run everything touched**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic
```

Expected: PASS.

**Step 7: Commit**

```bash
git add -A frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic
git commit -m "feat(piano): metronome click scheduled on the AudioContext clock (lookahead, jank-proof)"
```

---

## Task 6: Live-note store — extract volatile MIDI state from React state

Audit R1, part 1: `useWebMidiBLE`'s `activeNotes`/`noteHistory`/`sustainPedal` move from `useState` into an external store, so the hook's returned surface (and the context value) becomes **identity-stable** across note events. Consumers that display live notes subscribe via `useSyncExternalStore` (Task 7); everyone else stops re-rendering per note.

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/noteStore.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/noteStore.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoMidiContext.jsx` (add `usePianoMidiNotes`)
- Modify: existing `useWebMidiBLE.*.test.js` files (read state via the store)

**Step 1: Failing store tests**

```js
// noteStore.test.js
import { describe, it, expect, vi } from 'vitest';
import { createNoteStore } from './noteStore.js';

describe('createNoteStore', () => {
  it('noteOn/noteOff maintain activeNotes and isPlaying with immutable snapshots', () => {
    const s = createNoteStore();
    const before = s.getSnapshot();
    s.noteOn(60, 90, 1000);
    const after = s.getSnapshot();
    expect(after).not.toBe(before);                       // new snapshot identity
    expect(after.activeNotes.get(60)).toEqual({ velocity: 90, timestamp: 1000 });
    expect(after.isPlaying).toBe(true);
    s.noteOff(60, 1200);
    expect(s.getSnapshot().activeNotes.has(60)).toBe(false);
    expect(s.getSnapshot().isPlaying).toBe(false);
  });

  it('notifies subscribers once per mutation; unsubscribe works', () => {
    const s = createNoteStore();
    const fn = vi.fn();
    const un = s.subscribe(fn);
    s.noteOn(60, 90, 0);
    expect(fn).toHaveBeenCalledTimes(1);
    un();
    s.noteOff(60, 1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('tracks noteHistory open/close and sustain', () => {
    const s = createNoteStore();
    s.noteOn(60, 90, 0);
    s.noteOff(60, 500);
    const h = s.getSnapshot().noteHistory;
    expect(h.length).toBe(1);
    expect(h[0].endTime).toBe(500);
    s.sustain(true);
    expect(s.getSnapshot().sustainPedal).toBe(true);
  });

  it('sweepStale closes lost notes and does not notify when nothing changed', () => {
    const s = createNoteStore();
    const fn = vi.fn();
    s.subscribe(fn);
    s.sweepStale(Date.now());         // empty — no change
    expect(fn).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run — FAIL.**

**Step 3: Implement `noteStore.js`** (reuses ALL existing pure logic from `noteHistory.js` — check its import path: `useWebMidiBLE.js` imports from `../noteHistory.js`, so the store next to it uses the same):

```js
// noteStore.js — external store for high-churn live-note state (activeNotes,
// noteHistory, sustain). Kept OUT of React state so a note-on/off re-renders
// only useSyncExternalStore subscribers (the keyboard, the waterfall, the
// monitor) instead of every usePianoMidi() consumer in the kiosk
// (2026-07-06 decoupling audit R1). Snapshots are immutable-per-change, as
// useSyncExternalStore requires.

import {
  STALE_NOTE_MS, findLastActive, closeNote, trimHistory,
  handleNoteOn, handleNoteOff,
} from '../noteHistory.js';

export function createNoteStore() {
  let snapshot = { activeNotes: new Map(), sustainPedal: false, noteHistory: [], isPlaying: false };
  const listeners = new Set();

  const commit = (patch) => {
    const activeNotes = patch.activeNotes ?? snapshot.activeNotes;
    snapshot = { ...snapshot, ...patch, activeNotes, isPlaying: activeNotes.size > 0 };
    for (const fn of listeners) { try { fn(); } catch { /* a bad listener must not break input */ } }
  };

  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot: () => snapshot,

    noteOn(note, velocity, time) {
      commit({
        activeNotes: new Map(snapshot.activeNotes).set(note, { velocity, timestamp: time }),
        noteHistory: handleNoteOn(snapshot.noteHistory, note, velocity, time),
      });
    },

    noteOff(note, time) {
      const patch = {};
      if (snapshot.activeNotes.has(note)) {
        const next = new Map(snapshot.activeNotes);
        next.delete(note);
        patch.activeNotes = next;
      }
      const idx = findLastActive(snapshot.noteHistory, note);
      if (idx >= 0) patch.noteHistory = closeNote(snapshot.noteHistory, idx, time);
      if (Object.keys(patch).length) commit(patch);
    },

    sustain(down) { if (down !== snapshot.sustainPedal) commit({ sustainPedal: down }); },

    /** Close lost notes / trim display history. Notifies only on real change. */
    sweepStale(now, staleMs = STALE_NOTE_MS) {
      let activeChanged = false;
      const nextActive = new Map(snapshot.activeNotes);
      for (const [note, { timestamp }] of snapshot.activeNotes) {
        if (now - timestamp > staleMs) { nextActive.delete(note); activeChanged = true; }
      }
      let history = snapshot.noteHistory;
      for (let i = history.length - 1; i >= 0; i--) {
        if (!history[i].endTime && now - history[i].startTime > staleMs) history = closeNote(history, i, now);
      }
      const trimmed = trimHistory(history, now);
      const historyChanged = trimmed !== snapshot.noteHistory && (trimmed.length !== snapshot.noteHistory.length || history !== snapshot.noteHistory);
      if (!activeChanged && !historyChanged) return;
      commit({
        ...(activeChanged ? { activeNotes: nextActive } : {}),
        ...(historyChanged ? { noteHistory: trimmed } : {}),
      });
    },
  };
}

export default createNoteStore;
```

**Step 4: Run store tests — PASS. Commit the store alone** (keeps the risky rewiring in its own diff):

```bash
git add frontend/src/modules/Piano/PianoKiosk/noteStore.js frontend/src/modules/Piano/PianoKiosk/noteStore.test.js
git commit -m "feat(piano): external note store for live MIDI state (R1 groundwork)"
```

**Step 5: Rewire `useWebMidiBLE` onto the store**

- Delete the `useState` lines for `activeNotes`, `sustainPedal`, `noteHistory` (lines ~97-99).
- Add: `const storeRef = useRef(null); if (!storeRef.current) storeRef.current = createNoteStore();`
- `applyNoteOn` → `storeRef.current.noteOn(note, velocity, startTime); emit({...});` (drop both setStates). Same for `applyNoteOff` → `store.noteOff`. Sustain branch in `handleRawMidi` → `store.sustain(isSustainDown(v))`.
- The 2 s stale sweeper effect (lines ~341-364) → `storeRef.current.sweepStale(Date.now())`.
- Return surface: **remove** `activeNotes`, `sustainPedal`, `noteHistory`, `isPlaying` from the object and the memo deps; **add** `notes: storeRef.current`. The memo now depends only on `status`, `inputName`, and the stable callbacks → identity churn per note is gone.

**Step 6: Add the subscriber hook** in `PianoMidiContext.jsx`:

```js
import { useSyncExternalStore } from 'react';

/**
 * Live-note state (activeNotes / sustainPedal / noteHistory / isPlaying) via
 * subscription. ONLY components that render live notes should use this — it
 * re-renders per note event by design. Everything else uses usePianoMidi(),
 * whose value is identity-stable across note traffic.
 */
export function usePianoMidiNotes() {
  const { notes } = usePianoMidi();
  return useSyncExternalStore(notes.subscribe, notes.getSnapshot, notes.getSnapshot);
}
```

**Step 7: Fix the direct hook tests**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk
```

Expected failures in `useWebMidiBLE.*.test.js` wherever they read `result.current.activeNotes` — change those reads to `result.current.notes.getSnapshot().activeNotes` (behavioral assertions stay identical). **Do not migrate component consumers yet** — that's Task 7; expect component suites that destructure `activeNotes` from `usePianoMidi()` to fail. Run only the hook tests here:

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.statechange.test.js frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.noteOff.test.js frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.localControl.test.js frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.sendAt.test.js frontend/src/modules/Piano/PianoKiosk/noteStore.test.js
```

Expected: PASS.

**Step 8: Commit** (note: the tree is intentionally mid-migration; Task 7 lands in the next commit minutes later)

```bash
git add -A frontend/src/modules/Piano/PianoKiosk
git commit -m "refactor(piano): useWebMidiBLE volatile state → note store; stable context identity (R1 1/2)"
```

---

## Task 7: Migrate consumers + `LiveKeyboard`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/LiveKeyboard.jsx`
- Modify: every consumer of the removed fields.

**Step 1: Enumerate the blast radius**

```bash
cd frontend/src
rg -l "usePianoMidi\(\)" | xargs rg -l "activeNotes|noteHistory|sustainPedal|isPlaying" 
```

Expected (from the audit's survey — re-verify, don't trust this list blindly): `ScorePlayer.jsx`, `PianoKeyboardPanel.jsx`, `PianoMidiMonitor.jsx`, `usePianoScreensaver.jsx`, `useAutoMidiHistory.js`, `useWhoIsPlaying.js`, Studio/Games/Lessons/Producer mode files, `PianoMenu.jsx`, `MusicPlayer.jsx`, `EngagementGate.jsx`/`useEngagementGate.js`.

**Step 2: Create the leaf keyboard wrapper**

```jsx
// LiveKeyboard.jsx — PianoKeyboard bound to the live-note store. The
// subscription re-renders THIS leaf per note event; parents stay still
// (2026-07-06 decoupling audit R1). Use this instead of passing activeNotes
// down from a usePianoMidi() consumer.
import { usePianoMidiNotes } from './PianoMidiContext.jsx';
import { PianoKeyboard } from '../components/PianoKeyboard.jsx';

export default function LiveKeyboard(props) {
  const { activeNotes } = usePianoMidiNotes();
  return <PianoKeyboard activeNotes={activeNotes} {...props} />;
}
```

**Step 3: Migrate mechanically, one consumer at a time**

Rules:
- Component renders live notes/history → switch the volatile reads to `usePianoMidiNotes()`; if it only forwarded `activeNotes` into `PianoKeyboard`, use `LiveKeyboard` instead and drop the read entirely (this is the ScorePlayer case — `ScorePlayer.jsx:62` drops `activeNotes`, and the `<PianoKeyboard activeNotes={activeNotes} …>` block at ~718-724 becomes `<LiveKeyboard targetNotes={targetNotes} dimTarget={mode === 'learn'} startNote={kb.startNote} endNote={kb.endNote} />`).
- Non-note hooks/effects that need history/isPlaying (screensaver, auto-history, who-is-playing) → `usePianoMidiNotes()` (they re-render per note; they did before too — no regression, but note any that could later read the store imperatively inside callbacks instead).
- Anything reading only commands/status: no change (that's the win).

**Step 4: Full kiosk suite**

```bash
npx vitest run frontend/src/modules/Piano
```

Expected: PASS. Fix any missed consumer the failures reveal (the error is always `activeNotes is undefined` from a `usePianoMidi()` destructure).

**Step 5: Grep for stragglers**

```bash
rg -n "usePianoMidi\(\)" frontend/src --include="*.jsx" --include="*.js" -A2 | grep -E "activeNotes|noteHistory|sustainPedal|isPlaying" 
```

Expected: no hits outside `PianoMidiContext.jsx`/`LiveKeyboard.jsx`/tests.

**Step 6: Commit**

```bash
git add -A frontend/src
git commit -m "refactor(piano): consumers on usePianoMidiNotes/LiveKeyboard; per-note re-render scoped to leaves (R1 2/2)"
```

---

## Task 8: Time-boxed OSMD geometry extraction

Audit E1.1: `extractLayoutSliced`'s 256-step slices each do a forced reflow per step; on the tablet one slice can block for hundreds of ms. Switch from count-based to **time-boxed** slices (~8 ms budget), yielding between.

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/osmdRender.js` (`extractLayoutSliced`, lines ~301-350)
- Test: find the existing extraction test (`rg -l "extractLayoutSliced" frontend/src/modules/MusicNotation`) and extend it; if none exists, create `osmdRender.sliced.test.js` with a stub OSMD (fake cursor whose `next()` advances a counter — mirror whatever `MusicXmlRenderer` tests stub).

**Step 1: Failing test**

```js
it('yields by TIME BUDGET, not step count', async () => {
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const osmd = stubOsmd({ steps: 100, onStep: () => { clock += 3; } }); // 3ms per step
  const yields = [];
  const res = await extractLayoutSliced(osmd, {
    budgetMs: 8,
    yieldFn: (cb) => { yields.push(clock); cb(); },
  });
  expect(res.steps.length).toBeGreaterThan(0);
  // 3ms/step with an 8ms budget → a yield roughly every 3 steps, NOT every 256
  expect(yields.length).toBeGreaterThan(20);
});
```

**Step 2: Run — FAIL** (`budgetMs` unsupported; zero yields for 100 steps).

**Step 3: Implement** — in `extractLayoutSliced`, replace the `sliceSize` modulo check:

```js
export async function extractLayoutSliced(osmd, opts = {}) {
  const {
    budgetMs = 8,          // max main-thread time per slice — keeps the tablet's
                           // transport tick + input handling breathing (audit E1.1)
    yieldFn = scheduleYield,
    onProgress,
    shouldAbort = () => false,
  } = opts;
  // ... unchanged setup ...
  let done = 0;
  let sliceStart = performance.now();
  try {
    if (shouldAbort()) return null;
    cursor.show();
    cursor.reset();
    let guard = 0;
    while (!cursor.Iterator.EndReached && guard++ < 50000) {
      walk.processStep();
      cursor.next();
      done++;
      if (performance.now() - sliceStart > budgetMs) {
        reportProgress(done);
        await new Promise((r) => yieldFn(r));
        if (shouldAbort()) return null;
        sliceStart = performance.now();
      }
    }
  } finally { /* unchanged */ }
  // ... unchanged finalize ...
}
```

Remove the `sliceSize` option (grep callers: only `MusicXmlRenderer.jsx` calls it, passing neither).

**Step 4: Run**

```bash
npx vitest run frontend/src/modules/MusicNotation
```

Expected: PASS.

**Step 5: Commit**

```bash
git add -A frontend/src/modules/MusicNotation
git commit -m "perf(notation): time-boxed (8ms) extraction slices instead of 256-step slices"
```

---

## Task 9: Defer re-extraction while playing + stale-layout overlay guard

Audit E1.2. Zoom/resize/flow mid-playback currently kicks off the expensive geometry walk while the transport runs. Paint immediately (cheap repaint path), but **hold extraction until playback pauses**. Guard the overlays against the stale-geometry window this creates (extends the existing `layout.flow` guard with `scale`).

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/MusicXmlRenderer.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Tests: `MusicXmlRenderer` test file (extend) + `ScorePlayer.test.jsx` (overlay guard)

**Step 1: Failing renderer test** — render with `holdExtraction={true}`, trigger the effect, assert `onLayout` NOT called after paint; flip the prop to `false`, assert extraction then runs and `onLayout` fires.

**Step 2: Implement in `MusicXmlRenderer.jsx`:**

- New prop `holdExtraction = false`; mirror into a ref (`holdRef`), and a `pendingExtractRef = useRef(false)`.
- In the render effect, wrap BOTH `extractLayoutSliced` call sites:

```js
if (holdRef.current) {
  pendingExtractRef.current = true;   // paint happened; geometry deferred
} else {
  const res = await extractLayoutSliced(/* unchanged */);
  if (stale() || !res) return;
  publish(res, ...);
}
```

- Release effect (deliberately NOT part of the main effect's deps — a play/pause flip must not re-run the whole render effect unless an extraction is actually owed):

```js
useEffect(() => {
  if (!holdExtraction && pendingExtractRef.current) {
    pendingExtractRef.current = false;
    setResizeKey((k) => k + 1);   // re-run the effect: cheap repaint + the owed extraction
  }
}, [holdExtraction]);
```

- Include `scale` in the published layout: `publish` already spreads `res` and adds `width/height/flow` — add `scale` the same way (`onLayout?.({ ...res, width, height, flow: engFlow, scale })`).

**Step 3: Wire ScorePlayer:**

```jsx
<MusicXmlRenderer ... holdExtraction={running} onLayout={onLayout} onReady={onReady}>
```

And extend the freshness guard. Where the cursor/overlays render (line ~683) and where auto-scroll bails (line ~387), define once:

```js
// Overlay geometry must match what's on screen: after a zoom/flow change the
// sheet repaints immediately but extraction may be deferred (holdExtraction) —
// until onLayout catches up, cursor/notehead coordinates belong to the OLD
// engrave and must not be drawn.
const layoutFresh = (!layout.flow || layout.flow === flow) && (layout.scale == null || layout.scale === scale);
```

Gate: cursor div (`mode !== 'perform' && current && layoutFresh`), `NoteHighlightLayer`, `MeasureGradeLayer`, and replace the auto-scroll effect's `if (layout.flow && layout.flow !== flow) return;` with `if (!layoutFresh) return;`.

**Step 4: Run both suites**

```bash
npx vitest run frontend/src/modules/MusicNotation frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic
```

Expected: PASS.

**Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "perf(piano): defer OSMD geometry extraction while transport is playing; stale-layout overlay guard"
```

---

## Task 10: `ScoreTransportBar` — memoized body, isolated step readout

Audit R3: the 455-line bar re-renders on every cursor step because it takes `step`, and `React.memo` alone can't help while ScorePlayer passes fresh inline arrows.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (stabilize inline handler props)
- Test: `ScoreTransportBar.test.jsx` (extend)

**Step 1: Stabilize ScorePlayer's inline props** — these are currently inline arrows (ScorePlayer.jsx ~739-763); convert each to `useCallback` (empty or minimal deps):

```js
const onToggleFlow = useCallback(() => setFlow((f) => (f === 'wrapped' ? 'horizontal' : 'wrapped')), []);
const onTogglePlayAlong = useCallback(() => setPlayAlong((v) => !v), []);
const onToggleKeyboard = useCallback(() => setKeyboardVisible((v) => !v), []);
const onToggleClick = useCallback(() => setClickOn((v) => !v), []);
const onToggleScoring = useCallback(() => setScoringOn((v) => !v), []);
```

**Step 2: Restructure the bar.** Read the file first. Locate the step/position readout JSX. Split:

- `BarBody` — everything EXCEPT the readout, wrapped in `React.memo`, receiving all current props except `step` (and `page`/`pages` if the readout owns them).
- `StepReadout` — tiny component receiving `{step, total, page, pages, mode}` rendering the existing readout markup.
- The exported `ScoreTransportBar(props)` becomes a thin composition: `<BarBody {...rest}>` with the readout slotted where it was (pass `readout={<StepReadout …/>}` as a prop into BarBody so DOM structure is unchanged — an element prop with changing identity would defeat the memo, so instead render `StepReadout` OUTSIDE BarBody if the DOM allows, or give BarBody a stable `renderReadout` are-we-overcomplicating check: simplest correct structure is BarBody renders `{children}` where the readout sat, and the thin wrapper passes `<StepReadout/>` as children — `React.memo` with a `children` element prop re-renders, so DON'T do that either. **Correct approach:** `StepReadout` subscribes to nothing; the thin outer renders `<><BarBody {...stable}/><StepReadout step={…}/></>` and CSS keeps the readout visually positioned in the bar (absolute within the bar container). If the existing DOM makes that ugly, fall back to: memoize the expensive SUB-TREES inside the bar (mode pills row, parts row, meta popover) as `React.memo` children and let the bar shell re-render cheaply per step — same win, less surgery. Choose whichever the file's structure makes cleaner and note the choice in the commit.)

**Step 3: Test** — assert via a render-count probe (`vi.fn` in a test-only prop or a spy on a child) that advancing `step` does NOT re-render the memoized body but DOES update the readout text.

**Step 4: Run**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic
```

**Step 5: Commit**

```bash
git add -A frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic
git commit -m "perf(piano): memoize transport bar body; per-step re-render reduced to the position readout"
```

---

## Task 11: Compositor-friendly cursor + note-highlight positioning

Audit R4: cursor and chips move via `left/top` (layout properties) inside a several-thousand-node SVG document. Move positioning to `transform: translate3d` (compositor-only for the transition). Width/height stay as inline styles (they vary per step; documented residual cost).

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (cursor style, ~687-694)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/NoteHighlightLayer.jsx` (chip style, ~37-43)
- Modify: the `.piano-score-cursor` / `.piano-score-note` rules — find with `rg -n "piano-score-cursor" frontend/src --include="*.scss"` (expected in `PianoApp.scss` ~2036)
- Tests: `NoteHighlightLayer.test.jsx`, `ScorePlayer.test.jsx` — update any `style.left/top` assertions to `style.transform`

**Step 1: Update failing tests first** (assert `transform: translate3d(...)`), run, see FAIL.

**Step 2: Implement**

Cursor:

```js
style={{
  transform: `translate3d(${current.x - 9 * scale}px, ${current.top}px, 0)`,
  width: Math.round(18 * scale),
  height: Math.max(40 * scale, current.bottom - current.top),
  '--cursor-color': cursorColor,
}}
```

SCSS: on `.piano-score-cursor` set `left: 0; top: 0; will-change: transform;` and change the 140 ms transition property from `left, top` to `transform`; `is-jump` continues to suppress the transition (teleport on system breaks — semantics unchanged).

`NoteHighlightLayer` chips: same pattern (`transform: translate3d(${box.x - w/2}px, ${box.top}px, 0)`, `left:0; top:0` via the class). Chips have no transition; add `contain: layout paint` to `.piano-score-note` in SCSS.

**Step 3: Run**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic
```

**Step 4: Commit**

```bash
git add -A frontend/src
git commit -m "perf(piano): cursor/note chips positioned via transform (compositor path)"
```

---

## Task 12: Full verification, docs, and handoff

**Step 1: Full frontend unit sweep**

```bash
npx vitest run frontend/src/modules/Piano frontend/src/modules/MusicNotation
```

Expected: ALL PASS.

**Step 2: Live smoke (dev server).** Check `lsof -i :3111` first (per CLAUDE.md); start `npm run dev` if nothing is running. Then drive the real flow with Playwright (headless is fine; Web MIDI will be denied — expected; use the same Für Elise fixture the 2026-07-02 plan used):

- Open the sheet-music mode → pick the `.musicxml` score → engraves.
- Switch to **Listen**, press ▶ — cursor advances at tempo; console shows `score.playback.stats` on pause with `scheduled: 0` (no MIDI output headless — the schedule path no-ops on a missing port, which exercise the `sendNoteAt → false` branch).
- Toggle the metronome click on in Learn — no errors (AudioContext may be suspended headless; the scheduler no-ops).
- Zoom while Listen is playing — sheet repaints, overlays hide until pause, then geometry catches up (Task 9 behavior).
- **Use the verify skill** (`/verify`) for this step rather than hand-rolling, if available in the session.

**Step 3: Update docs (required by CLAUDE.md):**

- `docs/reference/piano/performance.md` — in the "Playback timing vs. rendering" section added 2026-07-06, append: implementation landed (branch/commits), the two-plane transport design, the two-stage flush contract, and the new telemetry fields (`meanLeadMs`/`minLeadMs`/`schedLate`).
- `docs/_wip/audits/2026-07-06-piano-kiosk-playback-render-decoupling-audit.md` — add a status header (like the 2026-07-02 audit has): finding → commit map for T1–T4, R1, R3, R4, E1; mark R2 as "absorbed by interval-tick batching + R1", R5/E1.3 deferred.
- This plan file — mark completed tasks.

**Step 4: Commit docs**

```bash
git add docs
git commit -m "docs(piano): decoupling implementation status — audit map + performance.md update"
```

**Step 5: On-device validation checklist (manual — requires the physical tablet; do NOT skip writing it into the audit status):**

1. Deploy the branch build to the tablet's URL (or point FKB at the dev host).
2. **Aged-page protocol** (performance.md): wait >30 min, screen on, no touch ≥2 min.
3. Play a dense score in Listen at ♩≥120: (a) hands off, (b) while pinch-zooming.
4. Pull `score.playback.stats` from the piano-sheetmusic session log: success = `meanLeadMs` ≈ 300–400, `schedLate` ≈ 0, and **audibly steady rhythm during visual jank**.
5. Ear-test pause: tail ≤ ~0.5 s, no stuck notes on the MDG-400 (two-stage flush working through the Jamcorder).
6. Metronome click steady while scrolling the score with a finger.
7. If notes are audibly jittery DESPITE `schedLate≈0` → Web MIDI timestamps are not being honored over Android BLE-MIDI on this WebView (the audit's open question) — fall back experiment: raise `lookaheadMs` to 50 (near-immediate sends) and compare; escalate findings into the audit doc.

---

## Deferred (explicitly out of scope — YAGNI until measured)

- **E1.3** reflow-free notehead geometry (fallback-box reads from `cursorElement.style` instead of rects) — measure first-open time after Task 8 before touching it.
- **R5** memoized target/lit Sets — moot after R1 unless profiling says otherwise.
- Web-Worker transport tick — unnecessary once sends are timestamped; revisit only if on-device `schedLate` counts stay high.
- `MIDIOutput.clear()` on pause — feature-detect experiment for a future pass; the two-stage flush covers correctness.
