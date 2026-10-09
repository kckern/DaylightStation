# Rep Completion Hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a child plays the last note of a rep correctly, the finished rep stays on screen for a short beat with every note shown completed, including the last one, before the next rep's notes replace it.

**Architecture:** Hold the display only, never the judge. The judge's cursor advances exactly as now, so notes played during the beat count toward the next rep. The rep window shown to `KeysAsk` comes from a new hook, `useRepCompletionHold`. When the live cursor crosses a rep boundary, the hook pins the window to the rep just finished, with the cursor past its end. The pin lasts `REP_HOLD_MS`, or until the child makes progress in the next rep, whichever comes first. Two pure helpers go in `deckProgress.js` beside `deckWindow`: one detects the crossing, one builds the held window.

**Tech Stack:** React 18 hooks, Vitest + Testing Library (jsdom), the structured frontend logger (`getLogger()` in `frontend/src/lib/logging/Logger.js`).

**Spec:** Owner request, 2026-10-09, in conversation: "it's the last NOTE of each rep, when it advances to the next one, not when the gate is open … there's never even a flash or an indication that he got that note right." The earlier 700 ms `RESOLVE_HOLD_MS` (commit `7e2a02c971`) covers only the end of the whole run. It stays, and this plan does not change it.

## Root cause

`frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx:1341`:

```js
const keysWindow = deckWindow(instance, visualCursor.index);
```

`deckWindow` (`deckProgress.js:167-175`) picks the rep by `Math.floor(cursor / unit) * unit`. When the last note of rep k is judged, `visualCursor.index` becomes the first event of rep k+1 in that same render. The window jumps to rep k+1, so `SvgSequenceStaff` never paints rep k's last column in its `done` state (`SvgSequenceStaff.jsx:324`, `index < cursorIndex ? 'done'`).

## Global Constraints

- Logging only through the structured logger. No `console.*` (CLAUDE.md "Logging").
- No new raw colours or motion. `npm run audit:ui` must stay at baseline.
- `npm run audit:layers` stays at baseline. This is frontend-only.
- The judge, scoring and the assessment cursor must not change. Only the window passed to `KeysAsk` changes.
- Timed runs (`timed === true`) are untouched. They have their own clock and window.
- Stages other than `'keys'` are untouched.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Never drive the real piano tablet or household screens. Do visual checks with a headless local render.

## Review Focus

1. **The child keeps playing during the beat.** They press the first note of the next rep 200 ms after the boundary. That press must count (the judge advances). The hold must end at once and show the new rep with that note done, so a correct note never disappears unseen.
2. **The last key is still held during the beat.** `activeNotes` still contains the last note's pitch. The held window must not paint it as a wrong ghost or a current attempt, because the cursor is past the end of the window.
3. **The last rep of the run.** The cursor reaches `events.length`. That is the run's end, not a rep boundary. The hook must not start a rep hold, because `RESOLVE_HOLD_MS` owns it, and `deckWindow` already clamps to the last rep with every note done.
4. **The run ends or remounts mid-hold.** If the runtime swaps or the component unmounts, the pending timer must be cleared. Nothing logs or sets state after unmount.
5. **Unit of 1, or no declared deck.** `deckWindow` returns the whole event list when `unit <= 1`, and a "rep boundary" then means every single note. No hold may happen, and behaviour stays exactly as today.

---

### Task 1: Pure helpers in deckProgress.js

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/deckProgress.js`. Add the two exports after `deckWindow` (line 175).
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/deckProgress.test.js`

**Interfaces:**
- Consumes: the existing private `declaredSets(instance)` in the same file.
- Produces:
  - `repBoundaryCrossed(instance, prevCursor, nextCursor) → null | { repOffset: number, repIndex: number, unit: number }`
  - `heldRepWindow(instance, repOffset) → { events: Event[], cursorIndex: number }`

- [ ] **Step 1: Write the failing tests**

Append to `deckProgress.test.js`, extending the existing import on line 2 to `import { deckSets, deckProjection, deckWindow, repBoundaryCrossed, heldRepWindow } from './deckProgress.js';`:

```js
const ev = (midi) => ({ notes: [{ midi }] });
const deckOf = (unit, reps, sets = 1) => ({
  deck: { sets, reps, unit },
  events: Array.from({ length: sets * reps * unit }, (_, i) => ev(60 + i)),
});

describe('repBoundaryCrossed', () => {
  it('reports the finished rep when the cursor moves from its last note into the next rep', () => {
    const instance = deckOf(3, 3); // 9 events, reps at 0,3,6
    expect(repBoundaryCrossed(instance, 2, 3)).toEqual({ repOffset: 0, repIndex: 0, unit: 3 });
    expect(repBoundaryCrossed(instance, 5, 6)).toEqual({ repOffset: 3, repIndex: 1, unit: 3 });
  });
  it('is null inside a rep', () => {
    expect(repBoundaryCrossed(deckOf(3, 3), 0, 1)).toBeNull();
    expect(repBoundaryCrossed(deckOf(3, 3), 3, 4)).toBeNull();
  });
  it('is null at the end of the run (the resolve hold owns that)', () => {
    expect(repBoundaryCrossed(deckOf(3, 3), 8, 9)).toBeNull();
  });
  it('is null when the cursor moves backwards or jumps more than one rep', () => {
    expect(repBoundaryCrossed(deckOf(3, 3), 3, 2)).toBeNull();
    expect(repBoundaryCrossed(deckOf(3, 3), 2, 7)).toBeNull();
  });
  it('is null when there is no declared rep unit (unit <= 1 or no deck)', () => {
    expect(repBoundaryCrossed({ events: [ev(60), ev(62)] }, 0, 1)).toBeNull();
    expect(repBoundaryCrossed(deckOf(1, 4), 0, 1)).toBeNull();
  });
  it('is null for non-finite cursors', () => {
    expect(repBoundaryCrossed(deckOf(3, 3), -1, 0)).toBeNull();
    expect(repBoundaryCrossed(deckOf(3, 3), Number.NaN, 3)).toBeNull();
  });
});

describe('heldRepWindow', () => {
  it('returns the finished rep with the cursor past its last note', () => {
    const instance = deckOf(3, 3);
    const held = heldRepWindow(instance, 3);
    expect(held.events).toEqual(instance.events.slice(3, 6));
    expect(held.cursorIndex).toBe(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /opt/Code/DaylightStation && nice -n 19 npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Exercises/deckProgress.test.js`
Expected: FAIL. `repBoundaryCrossed` and `heldRepWindow` are not exported.

- [ ] **Step 3: Implement**

Add to `deckProgress.js`, immediately after `deckWindow`:

```js
/**
 * The rep a cursor step just FINISHED, or null.
 *
 * A step counts only when the cursor moves forward by one event from the last
 * note of a rep into the first note of the next rep. A jump, a step backwards
 * or a step inside a rep is not a completed rep. Neither is the step past the
 * final event: that is the end of the run, which the resolve hold owns.
 */
export function repBoundaryCrossed(instance, prevCursor, nextCursor) {
  const events = instance?.events ?? [];
  const unit = declaredSets(instance)?.[0]?.unit ?? 1;
  if (unit <= 1) return null;
  if (!Number.isInteger(prevCursor) || !Number.isInteger(nextCursor)) return null;
  if (prevCursor < 0 || nextCursor !== prevCursor + 1) return null;
  if (nextCursor >= events.length) return null;
  if (nextCursor % unit !== 0) return null;
  const repOffset = nextCursor - unit;
  return { repOffset, repIndex: repOffset / unit, unit };
}

/** The finished rep as a display window: every note done, nothing current. */
export function heldRepWindow(instance, repOffset) {
  const events = instance?.events ?? [];
  const unit = declaredSets(instance)?.[0]?.unit ?? 1;
  const slice = events.slice(repOffset, repOffset + unit);
  return { events: slice, cursorIndex: slice.length };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /opt/Code/DaylightStation && nice -n 19 npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Exercises/deckProgress.test.js`
Expected: PASS, including every existing `deckWindow` and `deckProjection` test.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Exercises/deckProgress.js frontend/src/modules/Piano/PianoKiosk/modes/Exercises/deckProgress.test.js
git commit -m "feat(piano): detect a completed rep and build its held display window

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The `useRepCompletionHold` hook

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/useRepCompletionHold.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/useRepCompletionHold.test.js`

**Interfaces:**
- Consumes: `repBoundaryCrossed` and `heldRepWindow` from Task 1.
- Produces:
  - `export const REP_HOLD_MS = 600;`
  - `export default function useRepCompletionHold({ instance, cursorIndex, enabled, logger, traceFields }) → null | { repOffset: number, repIndex: number, window: { events, cursorIndex } }`
  - `logger` is any object with `info(event, data)`.
  - `traceFields` is a plain object spread into the log.

- [ ] **Step 1: Write the failing tests**

```js
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useRepCompletionHold, { REP_HOLD_MS } from './useRepCompletionHold.js';

const ev = (midi) => ({ notes: [{ midi }] });
const instance = { deck: { sets: 1, reps: 3, unit: 3 }, events: Array.from({ length: 9 }, (_, i) => ev(60 + i)) };

function setup(initial) {
  const logger = { info: vi.fn() };
  const hook = renderHook((props) => useRepCompletionHold({ instance, enabled: true, logger, traceFields: { assessmentId: 'a1' }, ...props }), {
    initialProps: { cursorIndex: initial },
  });
  return { ...hook, logger };
}

describe('useRepCompletionHold', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('holds the finished rep, every note done, when the cursor crosses into the next rep', () => {
    const { result, rerender, logger } = setup(2);
    expect(result.current).toBeNull();
    rerender({ cursorIndex: 3 });
    expect(result.current).toMatchObject({ repOffset: 0, repIndex: 0 });
    expect(result.current.window.events).toEqual(instance.events.slice(0, 3));
    expect(result.current.window.cursorIndex).toBe(3);
    expect(logger.info).toHaveBeenCalledWith('piano.exercise-rep-completed', expect.objectContaining({ repIndex: 0, unit: 3, holdMs: REP_HOLD_MS, assessmentId: 'a1' }));
  });

  it('releases after REP_HOLD_MS and logs how it ended', () => {
    const { result, rerender, logger } = setup(2);
    rerender({ cursorIndex: 3 });
    act(() => { vi.advanceTimersByTime(REP_HOLD_MS); });
    expect(result.current).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('piano.exercise-rep-hold-released', expect.objectContaining({ repIndex: 0, endedBy: 'timer' }));
  });

  it('releases at once when the child makes progress in the next rep (no correct note is ever hidden)', () => {
    const { result, rerender, logger } = setup(2);
    rerender({ cursorIndex: 3 });
    rerender({ cursorIndex: 4 });
    expect(result.current).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('piano.exercise-rep-hold-released', expect.objectContaining({ repIndex: 0, endedBy: 'next-input' }));
  });

  it('does not hold inside a rep, at the end of the run, or when disabled', () => {
    const { result, rerender } = setup(0);
    rerender({ cursorIndex: 1 });
    expect(result.current).toBeNull();
    rerender({ cursorIndex: 8 });
    rerender({ cursorIndex: 9 });
    expect(result.current).toBeNull();
    const off = renderHook((p) => useRepCompletionHold({ instance, enabled: false, logger: { info: vi.fn() }, traceFields: {}, ...p }), { initialProps: { cursorIndex: 2 } });
    off.rerender({ cursorIndex: 3 });
    expect(off.result.current).toBeNull();
  });

  it('clears its timer on unmount', () => {
    const { rerender, unmount, logger } = setup(2);
    rerender({ cursorIndex: 3 });
    unmount();
    logger.info.mockClear();
    act(() => { vi.advanceTimersByTime(REP_HOLD_MS * 2); });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('a new instance (runtime swap) drops any hold', () => {
    const { result, rerender } = setup(2);
    rerender({ cursorIndex: 3 });
    const fresh = { ...instance, events: [...instance.events] };
    rerender({ cursorIndex: 0, instance: fresh });
    expect(result.current).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /opt/Code/DaylightStation && nice -n 19 npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Exercises/useRepCompletionHold.test.js`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement**

```js
import { useEffect, useRef, useState } from 'react';
import { heldRepWindow, repBoundaryCrossed } from './deckProgress.js';

/**
 * How long a finished rep stays on screen, every note done, before the next
 * rep's notes replace it. Long enough to see the last note go green, short
 * enough that a child playing straight on is never made to wait: any progress
 * in the next rep ends the hold at once.
 */
export const REP_HOLD_MS = 600;

/**
 * DISPLAY ONLY. The judge's cursor is never held. Notes played during the beat
 * count toward the next rep exactly as before. This hook only decides which
 * rep the staff shows.
 */
export default function useRepCompletionHold({ instance, cursorIndex, enabled, logger, traceFields }) {
  const [hold, setHold] = useState(null);
  const prevRef = useRef({ instance, cursorIndex });
  const timerRef = useRef(null);
  const holdRef = useRef(null);
  const loggerRef = useRef(logger);
  const traceRef = useRef(traceFields);
  loggerRef.current = logger;
  traceRef.current = traceFields;

  const release = (endedBy) => {
    if (timerRef.current) { globalThis.clearTimeout(timerRef.current); timerRef.current = null; }
    const current = holdRef.current;
    if (!current) return;
    holdRef.current = null;
    setHold(null);
    if (endedBy) loggerRef.current?.info?.('piano.exercise-rep-hold-released', { ...traceRef.current, repIndex: current.repIndex, endedBy });
  };

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { instance, cursorIndex };
    if (prev.instance !== instance || !enabled) { release(null); return; }
    if (holdRef.current && cursorIndex !== prev.cursorIndex) release('next-input');
    const crossed = repBoundaryCrossed(instance, prev.cursorIndex, cursorIndex);
    if (!crossed) return;
    const next = { repOffset: crossed.repOffset, repIndex: crossed.repIndex, window: heldRepWindow(instance, crossed.repOffset) };
    holdRef.current = next;
    setHold(next);
    loggerRef.current?.info?.('piano.exercise-rep-completed', { ...traceRef.current, repIndex: crossed.repIndex, unit: crossed.unit, holdMs: REP_HOLD_MS });
    timerRef.current = globalThis.setTimeout(() => { timerRef.current = null; release('timer'); }, REP_HOLD_MS);
  }, [instance, cursorIndex, enabled]);

  useEffect(() => () => { if (timerRef.current) globalThis.clearTimeout(timerRef.current); }, []);

  return hold;
}
```

Note on the `'next-input'` test: rerendering from 3 to 4 releases the hold (`cursorIndex !== prev.cursorIndex`). `repBoundaryCrossed(3, 4)` is then null, so no new hold starts.

- [ ] **Step 4: Run to verify it passes**

Run: `cd /opt/Code/DaylightStation && nice -n 19 npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Exercises/useRepCompletionHold.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Exercises/useRepCompletionHold.js frontend/src/modules/Piano/PianoKiosk/modes/Exercises/useRepCompletionHold.test.js
git commit -m "feat(piano): useRepCompletionHold keeps a finished rep on screen for a beat

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Wire it into ExerciseRun and KeysAsk

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx` (around line 1341, where `keysWindow` is defined; and around lines 1553-1569, where `KeysAsk` is rendered)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/KeysAsk.jsx` (lines 41-56: props and `currentEvent`)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Exercises/KeysAsk.test.jsx` and `ExerciseRun.component.test.jsx`

**Interfaces:**
- Consumes: `useRepCompletionHold` and `REP_HOLD_MS` from Task 2.
- Produces:
  - `KeysAsk` gains the prop `completed?: boolean` (default `false`). When `true`, no key is lit as a target.
  - `ExerciseRun` re-exports `REP_HOLD_MS` for tests.

- [ ] **Step 1: Write the failing KeysAsk test**

Add to `KeysAsk.test.jsx` (follow the file's existing render helpers and imports):

```js
it('a completed window lights no target key and draws every note done', () => {
  const events = [60, 62, 64].map((midi) => ({ notes: [{ midi }] }));
  const { container } = render(<KeysAsk events={events} cursorIndex={3} completed showStaff />);
  expect(container.querySelectorAll('.keys-ask__badge.is-done')).toHaveLength(3);
  expect(container.querySelector('.keys-ask__badge.is-current')).toBeNull();
  // The keyboard lights targets via the `.is-target` class (check the class
  // name the existing tests in this file assert and use that exact one).
  expect(container.querySelector('.is-target')).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /opt/Code/DaylightStation && nice -n 19 npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Exercises/KeysAsk.test.jsx`
Expected: FAIL. Clamping lights the last note as the target key.

- [ ] **Step 3: Implement the KeysAsk change**

In `KeysAsk.jsx`, add `completed = false,` to the destructured props (after `windowOpen = undefined,`), and change `currentEvent`:

```js
  const currentEvent = completed
    ? null
    : isSequence
      ? events[Math.min(Math.max(cursorIndex, 0), events.length - 1)]
      : events[0];
```

`targetNotes` already handles `currentEvent?.notes || []`, so a null event lights nothing.

- [ ] **Step 4: Write the failing ExerciseRun test**

Add to `ExerciseRun.component.test.jsx`. Use the file's existing harness (the `h` hoisted mocks, `keysInstance`, and the helper that drives the snapshot cursor). Mirror the existing `RESOLVE_HOLD_MS` tests for driving `eventIndex` forward:

```js
describe('rep completion hold', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the finished rep with its last note done before the next rep replaces it', async () => {
    // A 3-note rep x 3 deck (sets:1, reps:3, unit:3). Build it with the same
    // helper the RESOLVE_HOLD_MS tests use, passing deck { sets: 1, reps: 3, unit: 3 }.
    // Drive the judge cursor 0 -> 1 -> 2 -> 3 (the last note of rep 1 judged).
    // ...existing helper call that advances the mocked snapshot to eventIndex 3...
    const badges = () => [...document.querySelectorAll('.keys-ask__badge')];
    expect(badges()).toHaveLength(3);
    expect(badges().every((b) => b.classList.contains('is-done'))).toBe(true); // rep 1, all done
    act(() => { vi.advanceTimersByTime(REP_HOLD_MS); });
    expect(badges()[0].classList.contains('is-current')).toBe(true); // rep 2, first note current
  });

  it('the judge is not held: a note played during the beat advances the next rep and ends the hold', async () => {
    // ...advance to eventIndex 3 (hold active), then to eventIndex 4 before REP_HOLD_MS elapses...
    const badges = () => [...document.querySelectorAll('.keys-ask__badge')];
    expect(badges()[0].classList.contains('is-done')).toBe(true);
    expect(badges()[1].classList.contains('is-current')).toBe(true);
  });
});
```

The implementer must replace the two `...existing helper...` comments with the real call this test file already uses to advance the mocked assessment snapshot's `eventIndex`. Find it with `grep -n "eventIndex" ExerciseRun.component.test.jsx` and copy its exact form; do not invent a new mechanism.

- [ ] **Step 5: Run to verify it fails**

Run: `cd /opt/Code/DaylightStation && nice -n 19 npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.component.test.jsx -t "rep completion hold"`
Expected: FAIL. At eventIndex 3 the badges already show rep 2.

- [ ] **Step 6: Implement the ExerciseRun wiring**

Import at the top of `ExerciseRun.jsx`:

```js
import useRepCompletionHold, { REP_HOLD_MS } from './useRepCompletionHold.js';
export { REP_HOLD_MS };
```

Replace line 1341 (`const keysWindow = deckWindow(instance, visualCursor.index);`) with:

```js
  // THE REP COMPLETION HOLD (owner, 2026-10-09). The window used to jump to the
  // next rep in the same render that judged the last note, so that note never
  // painted done. Display-only: the judge's cursor is untouched.
  const repHold = useRepCompletionHold({
    instance,
    cursorIndex: visualCursor.index,
    enabled: !timed && Boolean(instance),
    logger,
    traceFields: traceFieldsRef.current,
  });
  const keysWindow = repHold ? repHold.window : deckWindow(instance, visualCursor.index);
```

Check that this line runs on every render path that reaches it. Hooks must not be called after an early `return`. If `keysWindow` is computed after the early returns (around lines 1232-1235 there are `return <PianoEmpty …/>` guards), move the `useRepCompletionHold` call above the first early return. Keep only `const keysWindow = …` at line 1341. Use `visualCursor` only where it is defined: compute `const repCursor = …` before the returns using the same expression as `visualCursor`, or call the hook with `progress`-based values available there. The test in Step 4 tells you if this is wrong (React will throw "Rendered fewer hooks than expected").

In the `KeysAsk` render (around line 1553), pass the held flag and keep the verdict offset aligned:

```jsx
          <KeysAsk
            events={keysWindow.events}
            cursorIndex={keysWindow.cursorIndex}
            completed={Boolean(repHold)}
            activeNotes={repHold ? new Map() : feedbackNotes}
            wrongMidi={repHold || countingDown ? null : lastWrong?.midi ?? null}
            {...(verdicts ? {
              verdicts: windowOfVerdicts(verdicts, repHold ? repHold.repOffset : visualCursor.index - keysWindow.cursorIndex, keysWindow.events.length),
              windowOpen,
            } : {})}
```

`activeNotes` is emptied during the hold so the still-held last key does not paint a ghost or an attempt on a window whose cursor is past its end (Review Focus 2).

- [ ] **Step 7: Run to verify it passes, plus the neighbours**

Run: `cd /opt/Code/DaylightStation && nice -n 19 npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Exercises frontend/src/modules/MusicNotation frontend/src/modules/Piano/PianoKiosk/modes/Games`
Expected: PASS. If an existing test asserted the immediate jump to the next rep, change it to advance `REP_HOLD_MS` first, and record the change in the commit message.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.jsx frontend/src/modules/Piano/PianoKiosk/modes/Exercises/KeysAsk.jsx frontend/src/modules/Piano/PianoKiosk/modes/Exercises/KeysAsk.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/Exercises/ExerciseRun.component.test.jsx
git commit -m "fix(piano): a rep's last note shows done before the next rep replaces it

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Verify the render, document, merge

**Files:**
- Modify: `docs/reference/piano/` — the reference doc that covers exercise runs and reps. Find it with `grep -rl "deckWindow\|RESOLVE_HOLD_MS" docs/reference/piano`. If none mentions them, add the section to the doc that covers the match gate, `docs/reference/piano/games-budget-gate.md`.

- [ ] **Step 1: Headless render check**

Follow `/home/ds/.claude/projects/-opt-Code-DaylightStation/memory/reference_headless_playwright_screenshot.md` (never a household screen). Render a keys-stage gate run with a 3-note rep deck, play the three notes of rep 1, and take two screenshots:
- about 200 ms after the third note: `rep-hold-mid.png`. Expect three green (done) notes, three done badges and no lit target key.
- after `REP_HOLD_MS`: `rep-hold-after.png`. Expect rep 2 with its first note current.

Save them under `/tmp/claude-1001/-opt-Code-DaylightStation/8dba974a-50eb-4ec5-832a-982bfeb7704e/scratchpad/shots/`. **Look at both images** and describe them in the report.

- [ ] **Step 2: Document**

Add a short section, "Rep completion hold":
- the cause (the window jumping in the same render);
- the rule (display-only, 600 ms, ends early on next-rep progress, never at the end of the run);
- the log events: `piano.exercise-rep-completed {repIndex, unit, holdMs}` and `piano.exercise-rep-hold-released {repIndex, endedBy: timer|next-input}`.

- [ ] **Step 3: Audits**

Run: `cd /opt/Code/DaylightStation && npm run audit:ui && npm run audit:layers`
Expected: every row at or under baseline.

- [ ] **Step 4: Commit, merge, push, clean up**

```bash
git add docs/reference/piano/<the doc>.md
git commit -m "docs(piano): rep completion hold

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Then, from the main checkout, merge only if it has no uncommitted changes in the touched files: `git -C /opt/Code/DaylightStation merge --no-ff <branch>`. Push. Record the branch in `docs/_archive/deleted-branches.md`, delete it, and remove the worktree. Do not build or deploy; the orchestrator deploys through `./scripts/deploy-gate.sh`.
