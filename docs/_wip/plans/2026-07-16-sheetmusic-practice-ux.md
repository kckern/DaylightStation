# Sheet Music Practice UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the three reported pain points in the Piano Kiosk Sheet Music mode — hard-to-set loop in/out points, confusing metronome, scattered bottom chrome — per the audit at `cli/audit/2026-07-16-sheetmusic-layout-usability-audit.md`.

**Architecture:** All work is inside `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/` plus its style block in `frontend/src/Apps/PianoApp.scss` (lines ~2410–2795). `ScorePlayer.jsx` owns all state; `ScoreTransportBar.jsx` is a purely presentational, heavily memoized bottom bar. We (1) fix loop correctness (restart, tint geometry, tap threshold), (2) promote the metronome to a labeled BPM toggle that also works in Learn, (3) rebuild the loop as a first-class transport control with endpoint nudging and Listen support, (4) freeze the bar into a stable three-zone grid with one button grammar.

**Tech Stack:** React 18 (JSX, hooks), vitest + @testing-library/react (colocated `*.test.jsx` files, run from repo root), SCSS. No new dependencies.

---

## Critical context for the executor

- **Test command (from repo root):** `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/<file>` — the root `vitest.config.mjs` wires React, jsdom-like env, and jest-dom matchers. Run the whole mode with `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/`.
- **ScorePlayer test harness:** `ScorePlayer.test.jsx` mocks the MIDI context, config, and the OSMD renderer (`MusicXmlRenderer` mock re-fires `onLayout` from `h.layoutExtras`). Simulate played notes with `play(midi)`; simulate taps with `fireEvent.click(document.querySelector('.piano-score-player__scroll'), { clientX, clientY })` (jsdom rects are all 0, so `clientX` maps directly to renderer-local x). Polish/Listen playback tests use `vi.useFakeTimers()` + rAF stubs — copy the `beforeEach/afterEach` blocks from the existing `Polish mode` describe.
- **Memoization is load-bearing:** `ScoreTransportBar` children are `React.memo`'d and must not receive fresh object/array/arrow identities per render. New callbacks in `ScorePlayer.jsx` must be `useCallback`; new arrays/objects must be `useMemo`. Do not add default `= {}` / `= []` params on the thin `ScoreTransportBar` shell (see the NOTE comment at `ScoreTransportBar.jsx:363`).
- **Vocabulary:** internal state keeps the name `focus`; every user-facing string changes from "Practice" to **"Loop"**.
- **SVG icons, not glyphs/emoji (KC directive 2026-07-16):** all pictorial button content uses the inline-SVG components from `icons.jsx` (created in Task 4b) — never text glyphs (`▶ ❚❚ ↺ ♩ ✕ ▾ ⋯`) or emoji (`🎉`). Icons are decorative (`aria-hidden`); every icon button gets its accessible name from `aria-label`. Consequence for tests: query buttons by role+name (`getByRole('button', { name: 'Play' })`), never by glyph text. Textual characters that are typography, not pictures (`−`, `+`, `…`, `·`), stay as text.
- **Key state today (`ScorePlayer.jsx`):** `focus` = `{ kind, inMeasure, outMeasure }` measure INDICES or null; `range` = memoized step span `[lo, hi]` or null (`rangeSteps`); `selecting` = two-tap state machine; `clickOn` = Polish metronome arm; readout shows `m X / Y` when `layout.measures` present.

### Pre-execution gates (do these before Task 0)

1. **Homeserver sync check** (per `CLAUDE.local.md`) — it failed on 2026-07-16 with `sign_and_send_pubkey: signing failed` (SSH agent problem). Fix the agent (`ssh-add`) or ask KC, then run:
   `ssh homeserver.local 'cd /opt/Code/DaylightStation && git branch --show-current && git log --oneline origin/main..HEAD | head'`
   If the homeserver tree has unpushed **piano/SheetMusic** commits, integrate them first. (Local main was already confirmed ahead of `origin/main`, not behind.)
2. Baseline suite must be green: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/` → all pass.

---

## Phase 0 — Setup

### Task 0: Worktree + baseline

**Step 1:** Create an isolated worktree (project rule: feature work in worktrees):

```bash
git worktree add .worktrees/sheetmusic-practice-ux -b feature/sheetmusic-practice-ux
cd .worktrees/sheetmusic-practice-ux
ln -s ../../node_modules node_modules 2>/dev/null || true
ln -s ../../../frontend/node_modules frontend/node_modules 2>/dev/null || true
```

(The root `vitest.config.mjs` already resolves frontend deps through the symlink — see its worktree comment.)

**Step 2:** Run the baseline: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/`
Expected: all tests PASS. If not, stop and report.

---

## Phase 1 — Correctness fixes (each independently shippable)

### Task 1: Restart honors the loop in-point (audit L5)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/focusRange.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (`reset`, ~line 742)
- Test: `focusRange.test.js`, `ScorePlayer.test.jsx`

**Step 1: Write the failing unit test** — append to `focusRange.test.js`:

```js
describe('homeStep', () => {
  it('returns the range in-point when a loop is active', () => {
    expect(homeStep([4, 9])).toBe(4);
  });
  it('returns 0 with no loop', () => {
    expect(homeStep(null)).toBe(0);
  });
});
```

Add `homeStep` to the existing import from `./focusRange.js`.

**Step 2:** `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/focusRange.test.js` — expect FAIL (`homeStep is not a function`).

**Step 3: Implement** — append to `focusRange.js` (and add to the default export object):

```js
/** Where Restart/reset should land: the loop in-point when a range is active, else 0. */
export function homeStep(range) {
  return range ? range[0] : 0;
}
```

**Step 4:** Re-run Step 2's command — expect PASS.

**Step 5: Write the failing component test** — append to `ScorePlayer.test.jsx`. Reuse the two-measure fixture from the existing "practice range persistence (J3)" describe (copy its `h.layoutExtras` — note its two steps have `x: 100` and `x: 160`):

```js
describe('ScorePlayer — Restart honors the loop in-point (L5)', () => {
  it('Restart returns to the loop in-point, not measure 1', () => {
    h.layoutExtras = {
      steps: [
        { onsetQuarter: 0, measure: 0, notes: [{ midi: 64, staff: 0, x: 100, top: 10, bottom: 200, width: 8 }] },
        { onsetQuarter: 1, measure: 1, notes: [{ midi: 62, staff: 0, x: 160, top: 10, bottom: 200, width: 8 }] },
      ],
      measures: [
        { index: 0, number: 1, firstStep: 0, lastStep: 0 },
        { index: 1, number: 2, firstStep: 1, lastStep: 1 },
      ],
    };
    renderPlayer();
    act(() => { screen.getByText('Polish').click(); });
    // Set a loop on measure 2 only (two selection taps at x=160 → step 1 → measure index 1).
    act(() => { fireEvent.click(screen.getByRole('button', { name: /practice:/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /select measures/i })); });
    const scroll = document.querySelector('.piano-score-player__scroll');
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
    expect(screen.getByText('m 2 / 2')).toBeTruthy(); // focus jump put the cursor at the in-point
    act(() => { fireEvent.click(screen.getByRole('button', { name: /restart/i })); });
    expect(screen.getByText('m 2 / 2')).toBeTruthy(); // NOT m 1 / 2
  });
});
```

(Note: Task 8 renames `/practice:/i` → `/loop/i`; it updates this selector then.)

**Step 6:** `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx` — expect the new test FAIL (readout shows `m 1 / 2` after Restart).

**Step 7: Implement** — in `ScorePlayer.jsx`, import `homeStep` from `./focusRange.js`, then change `reset` (keep every other line of it as-is):

```js
const reset = useCallback(() => {
  countIn.cancel();
  setLearnDone(false);
  transport.stop();
  if (mode === 'listen') silenceScheduled();
  flushPlaybackNow();
  const home = homeStep(rangeRef.current); // loop in-point when a loop is active (audit L5)
  setStep(home);
  setStruck(() => new Set());
  setGrades({});
  setSummaryOpen(false);
  // The auto-follow effect scrolls to the new step; only a true top-of-piece
  // reset should force-scroll to the origin.
  if (home === 0) scrollRef.current?.scrollTo({ top: 0, left: 0 });
}, [transport, mode, silenceScheduled, flushPlaybackNow, countIn]);
```

**Step 8:** Re-run Step 6 — expect PASS. Then run the whole mode's suite — expect PASS.

**Step 9: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/focusRange.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/focusRange.test.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx
git commit -m "fix(piano-sheetmusic): Restart returns to the loop in-point, not measure 1 (audit L5)"
```

### Task 2: Loop tint draws per system, not one union rectangle (audit L4)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/FocusRangeLayer.jsx`
- Test: `FocusRangeLayer.test.jsx`

**Step 1: Write the failing test** — append to `FocusRangeLayer.test.jsx`:

```js
describe('FocusRangeLayer — multi-system ranges (audit L4)', () => {
  // Two systems in wrapped flow: steps 0-3 on system 1 (top 0), steps 4-5 on
  // system 2 (top 200). A new system is detected by the x reset (160 → 10).
  const measures = [
    { index: 0, firstStep: 0, lastStep: 1 },
    { index: 1, firstStep: 2, lastStep: 3 },
    { index: 2, firstStep: 4, lastStep: 5 },
  ];
  const boxes = [
    { x: 10, top: 0, bottom: 100 }, { x: 60, top: 0, bottom: 100 },
    { x: 110, top: 0, bottom: 100 }, { x: 160, top: 0, bottom: 100 },
    { x: 10, top: 200, bottom: 300 }, { x: 60, top: 200, bottom: 300 },
  ];

  it('draws one tint band per system for a range crossing a line break', () => {
    const { container } = render(
      <FocusRangeLayer measures={measures} stepBoxes={boxes} range={{ inMeasure: 1, outMeasure: 2 }} />,
    );
    const tints = [...container.querySelectorAll('.piano-score-range-tint')];
    expect(tints).toHaveLength(2);
    // Band 1: measure 1 on system 1 (x 110–160, top 0).
    expect(tints[0].style.left).toBe('110px');
    expect(tints[0].style.top).toBe('0px');
    // Band 2: measure 2 on system 2 (x from 10, top 200) — NOT a rect spanning both systems.
    expect(tints[1].style.left).toBe('10px');
    expect(tints[1].style.top).toBe('200px');
  });

  it('rangeBands: single-system range yields one band', () => {
    expect(rangeBands(measures, boxes, { inMeasure: 0, outMeasure: 1 })).toHaveLength(1);
  });
});
```

Add `rangeBands` to the import: `import FocusRangeLayer, { rangeBands } from './FocusRangeLayer.jsx';`

**Step 2:** `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/FocusRangeLayer.test.jsx` — expect FAIL.

**Step 3: Implement** — in `FocusRangeLayer.jsx`, add the exported helper and replace the single-tint render. Keep `measureExtent` (the brackets and pending path still use it).

```js
/**
 * Band rectangles for a measure range, one per engraved system. A step whose x
 * is LOWER than its predecessor starts a new system (wrapped-flow line break);
 * horizontal flow never resets x, so it always yields a single band. Covers
 * every step in the range — not just the endpoint measures (audit L4).
 */
export function rangeBands(measures, stepBoxes, { inMeasure, outMeasure }) {
  const inM = measures[inMeasure];
  const outM = measures[outMeasure];
  if (!inM || !outM) return [];
  const bands = [];
  let cur = null;
  let prevX = -Infinity;
  for (let i = inM.firstStep; i <= outM.lastStep; i++) {
    const b = stepBoxes[i];
    if (!b) continue;
    if (!cur || b.x < prevX) {
      cur = { left: b.x, right: b.x, top: b.top, bottom: b.bottom };
      bands.push(cur);
    } else {
      if (b.x < cur.left) cur.left = b.x;
      if (b.x > cur.right) cur.right = b.x;
      if (b.top < cur.top) cur.top = b.top;
      if (b.bottom > cur.bottom) cur.bottom = b.bottom;
    }
    prevX = b.x;
  }
  return bands;
}
```

In the committed-range render path, replace the single `.piano-score-range-tint` div with:

```jsx
{rangeBands(measures, stepBoxes, range).map((band, i) => (
  <div
    key={i}
    className="piano-score-range-tint"
    style={{ left: band.left, top: band.top, width: Math.max(band.right - band.left, 8), height: band.bottom - band.top }}
  />
))}
```

Keep the two bracket divs exactly as they are (`inExt.left - 4` / `outExt.right + 1`) — the endpoint brackets were already correct.

**Step 4:** Re-run the file's tests — the two new tests AND the three pre-existing ones must PASS (the pre-existing single-system test still expects ≥1 tint; it uses `querySelector`, which is satisfied).

**Step 5: Commit** — `git commit -m "fix(piano-sheetmusic): loop tint draws per system instead of one union rect (audit L4)"`

### Task 3: Selection taps get a miss threshold (audit L3)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/nearestEvent.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/nearestEvent.test.js`
- Modify: `ScorePlayer.jsx` (delete the local `nearestEvent` at lines 38-48; update `onScoreClick`)
- Test: `ScorePlayer.test.jsx`

**Step 1: Write the failing unit test** — create `nearestEvent.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { nearestEvent, SELECT_MAX_DIST } from './nearestEvent.js';

const events = [
  { x: 100, top: 0, bottom: 100 },
  { x: 200, top: 0, bottom: 100 },
];

describe('nearestEvent', () => {
  it('picks the nearest event by x-dominant distance', () => {
    expect(nearestEvent(events, 190, 50)).toBe(1);
    expect(nearestEvent(events, 110, 50)).toBe(0);
  });
  it('returns -1 when the tap is farther than maxDist from every event', () => {
    expect(nearestEvent(events, 900, 50, SELECT_MAX_DIST)).toBe(-1);
  });
  it('unlimited by default (seek taps keep tap-anywhere behavior)', () => {
    expect(nearestEvent(events, 900, 50)).toBe(1);
  });
  it('returns -1 for an empty event list', () => {
    expect(nearestEvent([], 10, 10)).toBe(-1);
  });
});
```

**Step 2:** Run it — FAIL (module not found).

**Step 3: Implement** — create `nearestEvent.js` (this is the existing function from `ScorePlayer.jsx:38-48`, extracted, plus the threshold):

```js
/**
 * nearestEvent — nearest melody event to a tap at renderer-local (x, y). Y is
 * down-weighted (x dominates within a system). With `maxDist`, taps farther than
 * that (weighted px, at scale 1) from every event return -1 — used by the guided
 * loop selection so a stray margin tap can't silently commit a far-away measure
 * (audit L3). Seek taps pass no maxDist: tap-anywhere-to-seek is intentional.
 */
export function nearestEvent(events, x, y, maxDist = Infinity) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const midY = (e.top + e.bottom) / 2;
    const d = Math.hypot(x - e.x, (y - midY) * 0.45);
    if (d < bestD) { bestD = d; best = i; }
  }
  return bestD <= maxDist ? best : -1;
}

/** Max weighted distance (px at scale 1) a SELECTION tap may be from a note. */
export const SELECT_MAX_DIST = 90;

export default nearestEvent;
```

**Step 4:** Run — PASS.

**Step 5: Write the failing component test** — append to `ScorePlayer.test.jsx` (same fixture as Task 1's test):

```js
describe('ScorePlayer — selection tap threshold (L3)', () => {
  it('ignores a margin tap during loop selection instead of committing a far measure', () => {
    h.layoutExtras = { /* same steps/measures fixture as the L5 test */ };
    renderPlayer();
    act(() => { screen.getByText('Learn').click(); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /practice:/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /select measures/i })); });
    const scroll = document.querySelector('.piano-score-player__scroll');
    // A tap 800px right of the last note (margin) must NOT arm an in-point.
    act(() => { fireEvent.click(scroll, { clientX: 960, clientY: 100 }); });
    expect(screen.getByText(/tap the first measure/i)).toBeInTheDocument(); // still stage 'first'
    // A tap on a real note proceeds normally.
    act(() => { fireEvent.click(scroll, { clientX: 100, clientY: 100 }); });
    expect(screen.getByText(/now tap the last/i)).toBeInTheDocument();
  });
});
```

**Step 6:** Run `ScorePlayer.test.jsx` — new test FAILS (banner advanced to 'last').

**Step 7: Implement** — in `ScorePlayer.jsx`:
1. Delete the local `nearestEvent` function (lines 38-48) and add `import { nearestEvent, SELECT_MAX_DIST } from './nearestEvent.js';`
2. In `onScoreClick`, restructure the selection branch to use the threshold, scaled by zoom. Replace the block from `const i = nearestEvent(...)` through the `if (selecting) {...}` with:

```js
// Guided loop selection (Learn/Polish): selection taps require the tap to be
// NEAR a note (audit L3) — a margin tap is ignored, not committed.
if (selecting) {
  const si = nearestEvent(events, e.clientX - r.left, e.clientY - r.top, SELECT_MAX_DIST * scale);
  if (si < 0) return; // too far from any note — ignore
  const mi = measureIndexOfStep(si);
  if (selecting.stage === 'first') {
    setSelecting({ stage: 'last', inMeasure: mi });
    logger.info('score.focus.arm', { inMeasure: mi });
  } else {
    const inMeasure = Math.min(selecting.inMeasure, mi);
    const outMeasure = Math.max(selecting.inMeasure, mi);
    setSelecting(null);
    setFocus({ kind: 'custom', inMeasure, outMeasure });
  }
  return;
}
const i = nearestEvent(events, e.clientX - r.left, e.clientY - r.top);
if (i < 0) return;
```

Add `scale` to `onScoreClick`'s dependency array.

**Step 8:** Run the whole mode's suite — PASS.

**Step 9: Commit** — `git commit -m "fix(piano-sheetmusic): margin taps no longer commit far-away loop endpoints (audit L3)"`

---

## Phase 2 — Metronome (audit M1–M4)

### Task 4: Persist the metronome arm state (M3)

**Files:** Modify `ScorePlayer.jsx` (~line 113 and the save effect ~line 366). Test: `ScorePlayer.test.jsx`.

**Step 1: Failing test** — append inside the existing `per-score persistence (Task 2.5)` describe (it already clears localStorage in `beforeEach`):

```js
it('restores the metronome arm state for a given score id (M3)', () => {
  const { unmount } = renderScore();
  act(() => { screen.getByText('Polish').click(); });
  const click = screen.getByRole('button', { name: /metronome/i });
  expect(click).toHaveAttribute('aria-pressed', 'true'); // default ON
  act(() => { fireEvent.click(click); }); // turn it off
  unmount();
  renderScore();
  act(() => { screen.getByText('Polish').click(); });
  expect(screen.getByRole('button', { name: /metronome/i })).toHaveAttribute('aria-pressed', 'false');
});
```

**Step 2:** Run — FAIL (aria-pressed true after re-render).

**Step 3: Implement** — in `ScorePlayer.jsx`:

```js
const [clickOn, setClickOn] = useState(() => restored.clickOn !== false); // Polish metronome — on unless turned off
```

and extend the persistence effect:

```js
useEffect(() => {
  saveScoreSettings(scoreMeta.id, { mode, tempoMult, focus, activeParts, myStaves: [...myStaves], clickOn });
}, [scoreMeta.id, mode, tempoMult, focus, activeParts, myStaves, clickOn]);
```

**Step 4:** Run — PASS. **Step 5: Commit** — `git commit -m "feat(piano-sheetmusic): persist metronome arm state per score (audit M3)"`

### Task 4b: Shared SVG icon set (replaces all glyph/emoji button content)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/icons.jsx`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/icons.test.jsx`

**Step 1: Failing test** — `icons.test.jsx`:

```js
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PlayIcon, PauseIcon, RestartIcon, QuarterNoteIcon, CloseIcon, ChevronDownIcon } from './icons.jsx';

describe('icons', () => {
  it.each([
    ['PlayIcon', PlayIcon], ['PauseIcon', PauseIcon], ['RestartIcon', RestartIcon],
    ['QuarterNoteIcon', QuarterNoteIcon], ['CloseIcon', CloseIcon], ['ChevronDownIcon', ChevronDownIcon],
  ])('%s renders a decorative currentColor svg', (_, Cmp) => {
    const { container } = render(<Cmp />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('fill')).toBe('currentColor');
  });
});
```

**Step 2:** Run — FAIL (no module).

**Step 3: Implement `icons.jsx`:**

```jsx
/**
 * icons — inline SVG icons for the sheet-music chrome. Pictorial button content
 * is ALWAYS one of these components, never a text glyph or emoji (KC directive):
 * icons inherit the button's color (currentColor), scale with font size, and are
 * decorative (aria-hidden) — the button's aria-label carries the accessible name.
 */
const Icon = ({ children, ...rest }) => (
  <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="currentColor" aria-hidden="true" focusable="false" {...rest}>
    {children}
  </svg>
);

export const PlayIcon = () => <Icon><path d="M8 5v14l11-7z" /></Icon>;
export const PauseIcon = () => <Icon><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></Icon>;
export const RestartIcon = () => (
  <Icon><path d="M12 5V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" /></Icon>
);
export const QuarterNoteIcon = () => (
  <Icon><path d="M14.5 3H16v13.5a3.5 3.5 0 1 1-1.5-2.88z" /></Icon>
);
export const CloseIcon = () => (
  <Icon><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" /></Icon>
);
export const ChevronDownIcon = () => (
  <Icon><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z" /></Icon>
);
```

**Step 4:** Run — PASS. Add SCSS so icons center in buttons: `.piano-score-btn svg { display: block; }` in the score-bar region of `PianoApp.scss`.

**Step 5: Commit** — `git commit -m "feat(piano-sheetmusic): shared inline-SVG icon set for chrome buttons"`

### Task 5: Labeled metronome with BPM readout, available in Learn (M1, M2, M4)

Design (from the audit): the ♩ button becomes `♩ 68` (live BPM = base tempo × multiplier), `aria-label="Metronome"`. In **Polish** it arms the click for runs (existing `clickOn`). In **Learn** the button IS the metronome: toggling ON starts a free-running click at the practice tempo immediately (session-local `learnClick` state, default OFF, deliberately not persisted so a walk-up user never inherits a ticking room). Tempo control becomes available in Learn too (it now has something to control). Listen keeps no metronome (its own performance is the beat) — geography handled in Task 11.

**Files:** Modify `ScorePlayer.jsx`, `ScoreTransportBar.jsx`. Test: `ScorePlayer.test.jsx`.

**Step 1: Add a click-scheduler spy to the harness** — in `ScorePlayer.test.jsx`, add to the `vi.hoisted` holder: `clickSched: { start: vi.fn(), stop: vi.fn(), setBpm: vi.fn() }`, add a mock next to the others:

```js
vi.mock('./clickScheduler.js', () => ({ createClickScheduler: () => h.clickSched }));
```

and clear the three spies in the top-level `beforeEach`.

**Step 2: Failing tests:**

```js
describe('ScorePlayer — metronome in Learn (M1/M2/M4)', () => {
  it('shows a labeled BPM toggle in Learn; toggling starts/stops the click immediately', () => {
    renderPlayer();
    enterLearn();
    const btn = screen.getByRole('button', { name: /metronome/i });
    expect(btn).toHaveTextContent('90'); // parsed default tempo 90 × 100% (note icon is SVG, aria-hidden)
    expect(btn.querySelector('svg')).not.toBeNull(); // QuarterNoteIcon
    expect(btn).toHaveAttribute('aria-pressed', 'false'); // Learn defaults OFF
    expect(h.clickSched.start).not.toHaveBeenCalled();
    act(() => { fireEvent.click(btn); });
    expect(h.clickSched.start).toHaveBeenCalledWith(90); // free-running click starts NOW
    act(() => { fireEvent.click(btn); });
    expect(h.clickSched.stop).toHaveBeenCalled();
  });

  it('Learn metronome follows the tempo control', () => {
    renderPlayer();
    enterLearn();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^tempo/i })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /50%/ })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /metronome/i })); });
    expect(h.clickSched.start).toHaveBeenCalledWith(45); // 90 × 0.5
  });
});
```

**Step 3:** Run — FAIL (no metronome button in Learn; no Tempo in Learn).

**Step 4: Implement in `ScorePlayer.jsx`:**

```js
const [learnClick, setLearnClick] = useState(false); // Learn free-run — explicit opt-in per session
const clickActive = mode === 'learn' ? learnClick : clickOn;
const clickBpm = Math.round((tempoMap[0]?.bpm || 90) * tempoMult);

useMetronomeClick({
  // Polish: reference beat while a graded run plays. Learn: free-running
  // practice beat the moment the user toggles it on (audit M2).
  enabled: (mode === 'polish' && clickOn && transport.playing) || (mode === 'learn' && learnClick),
  bpm: clickBpm,
});

const onToggleClick = useCallback(() => {
  if (mode === 'learn') setLearnClick((v) => !v);
  else setClickOn((v) => !v);
}, [mode]);
```

(Replace the existing `useMetronomeClick` call and `onToggleClick`; remove the old `const [clickOn...]`? No — keep `clickOn` from Task 4.) Thread two new bar props: `clickOn={clickActive}` and `bpm={clickBpm}`.

**Step 5: Implement in `ScoreTransportBar.jsx`:**
- `ScoreViewControls`: accept `bpm = 90`; change `hasClick` to `mode === 'polish' || mode === 'learn'`; change `hasTempo` to `mode !== 'perform'`; change the click button to:

```jsx
<button
  type="button"
  className={`piano-score-btn piano-score-click${clickOn ? ' is-on' : ''}`}
  aria-label="Metronome"
  aria-pressed={clickOn}
  onClick={onToggleClick}
>
  <QuarterNoteIcon />
  <span className="tabular-nums">{bpm}</span>
</button>
```

(import `QuarterNoteIcon` from `./icons.jsx`)

- Shell: accept `bpm` prop (no default — memo discipline) and pass it through to `ScoreViewControls`.
- Update the comment block at lines 161-172 to match the new gating.

**Step 6:** Run the whole mode suite. The existing Listen test `tempo control scales…` uses `{ name: '50%' }` — it still passes (exact-name lookup unaffected until Task 7). Everything must PASS.

**Step 7: Commit** — `git commit -m "feat(piano-sheetmusic): labeled BPM metronome, free-running in Learn (audit M1/M2/M4)"`

### Task 6: Tempo steps show resulting BPM (M4)

**Files:** Modify `ScoreTransportBar.jsx` (TEMPO_STEPS render), `ScorePlayer.jsx` (thread `baseBpm`). Test: `ScorePlayer.test.jsx`.

**Step 1: Failing test:**

```js
it('tempo steps show the resulting BPM (M4)', () => {
  renderPlayer(); // Listen
  act(() => { fireEvent.click(screen.getByRole('button', { name: /^tempo/i })); });
  expect(screen.getByRole('button', { name: /50%.*45/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /100%.*90/ })).toBeInTheDocument();
});
```

**Step 2:** Run — FAIL.

**Step 3: Implement** — `ScorePlayer.jsx`: pass `baseBpm={Math.round(tempoMap[0]?.bpm || 90)}`. `ScoreTransportBar.jsx`: `ScoreViewControls` accepts `baseBpm = 90`; the step button content becomes (icon, not a ♩ glyph):

```jsx
{s.label}
<span className="piano-score-step__bpm tabular-nums"><QuarterNoteIcon /> {Math.round(baseBpm * s.value)}</span>
```

SCSS: `.piano-score-step__bpm { display: inline-flex; align-items: center; gap: 0.15rem; opacity: 0.75; font-size: 0.85em; }`

**Step 4:** Run the whole suite. Update the two existing tests that click tempo steps by exact name (`{ name: '50%' }` in the Listen describe, `{ name: '125%' }` size steps are in ViewMenu and unaffected): change to `{ name: /50%/ }`. Expect PASS.

**Step 5: Commit** — `git commit -m "feat(piano-sheetmusic): tempo steps show resulting BPM (audit M4)"`

---

## Phase 3 — Loop as a first-class control (audit L1, L2, L6)

### Task 7: Rename PracticeScope → LoopControl with active-state label + one-tap clear (L1)

**Files:**
- Create: `LoopControl.jsx` + `LoopControl.test.jsx` (replaces `PracticeScope.jsx` + `PracticeScope.test.jsx` — `git rm` the old pair)
- Modify: `ScoreTransportBar.jsx`, `ScorePlayer.jsx` (scopeLabel), `ScorePlayer.test.jsx` (selector updates)

**Step 1: Write `LoopControl.test.jsx`** (failing):

```js
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LoopControl from './LoopControl.jsx';

describe('LoopControl', () => {
  it('inactive: shows "Loop" with a chevron and no clear button', () => {
    render(<LoopControl active={false} scopeLabel="" sections={[]} />);
    const trigger = screen.getByRole('button', { name: /^loop/i });
    expect(trigger).toHaveTextContent('Loop');
    expect(trigger.querySelector('svg')).not.toBeNull(); // ChevronDownIcon
    expect(screen.queryByRole('button', { name: /clear loop/i })).toBeNull();
  });

  it('active: shows the range in the trigger and a one-tap clear (L2)', () => {
    const onClear = vi.fn();
    render(<LoopControl active scopeLabel="m9–m16" sections={[]} onClearFocus={onClear} />);
    expect(screen.getByRole('button', { name: /loop m9/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /clear loop/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it('menu offers sections, Select measures…, and (when active) Clear loop', () => {
    const onPick = vi.fn();
    render(<LoopControl active scopeLabel="A" sections={[{ label: 'A' }]} onPickSection={onPick} onStartSelect={() => {}} onClearFocus={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /loop a/i }));
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    expect(onPick).toHaveBeenCalledWith({ label: 'A' });
  });
});
```

**Step 2:** Run — FAIL (no module).

**Step 3: Implement `LoopControl.jsx`** — start from `PracticeScope.jsx` and change:

```jsx
import React, { useState, memo } from 'react';
import { ChevronDownIcon, CloseIcon } from './icons.jsx';

/**
 * LoopControl — the loop is a first-class transport control (audit L1). The
 * trigger reads "Loop" + chevron (inactive) or "Loop m9–m16" (active) with a
 * one-tap clear beside it (audit L2). The popover offers rehearsal-mark sections,
 * "Select measures…" (guided two-tap), endpoint nudging (Task 8), and Clear.
 * Presentational; the parent owns focus/selection state. Memoized on its props.
 */
const LoopControl = memo(function LoopControl({ active = false, scopeLabel = '', sections = [], onPickSection, onStartSelect, onClearFocus }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const pick = (fn, arg) => { fn?.(arg); close(); };

  return (
    <div className="piano-score-loop-wrap">
      <button
        type="button"
        className={`piano-score-btn piano-score-loop-trigger${active ? ' is-on' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {active ? `Loop ${scopeLabel}` : 'Loop'}
        {!active && <ChevronDownIcon />}
      </button>
      {active && (
        <button type="button" className="piano-score-btn piano-score-loop-clear" aria-label="Clear loop" onClick={() => onClearFocus?.()}>
          <CloseIcon />
        </button>
      )}
      {open && (
        <>
          <button type="button" className="piano-score-popover-backdrop" aria-label="Close" onClick={close} />
          <div className="piano-score-loop-menu" role="dialog" aria-label="Loop range">
            {sections.map((s) => (
              <button key={s.label} type="button" className="piano-score-btn piano-score-loop-opt" onClick={() => pick(onPickSection, s)}>
                {s.label}
              </button>
            ))}
            <button type="button" className="piano-score-btn piano-score-loop-opt" onClick={() => pick(onStartSelect)}>
              Select measures…
            </button>
            {active && (
              <button type="button" className="piano-score-btn piano-score-loop-opt" onClick={() => pick(onClearFocus)}>
                Clear loop
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
});

export default LoopControl;
```

**Step 4:** In `ScoreTransportBar.jsx`: replace the `PracticeScope` import/usage with `LoopControl`, passing `active={scopeLabel !== 'Whole piece' && !!scopeLabel}`… **No — cleaner:** change `ScorePlayer.jsx` to pass `scopeLabel={focus ? (focus.label || \`m${focus.inMeasure + 1}–m${focus.outMeasure + 1}\`) : ''}` and a new `loopActive={!!focus}` prop; thread `loopActive` through the shell to `ScoreViewControls` (no default) and hand `LoopControl` `active={loopActive}`. Delete the old `scopeLabel = 'Whole piece'` fallback in `ScorePlayer.jsx` (~line 682).

**Step 5:** Update selectors in `ScorePlayer.test.jsx`: every `{ name: /practice:/i }` → `{ name: /^loop/i }`; the J3 test's `practice: m1` assertion → `{ name: /loop m1/i }`; its final Listen assertion stays for now (Task 9 flips it). `git rm frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/PracticeScope.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/PracticeScope.test.jsx`. Copy the SCSS classes `.piano-score-practice-wrap/-menu/-opt` in `PianoApp.scss` to `.piano-score-loop-wrap/-menu/-opt` (keep layout identical; Task 11 moves the anchor to `left: 50%; transform: translateX(-50%)` when it lands in the center zone — for now keep `left: 0`).

**Step 6:** Run the whole suite — PASS. **Step 7: Commit** — `git commit -m "feat(piano-sheetmusic): loop is a first-class labeled control with one-tap clear (audit L1/L2)"`

### Task 8: Endpoint nudging (L2)

**Files:** Modify `focusRange.js` (+test), `LoopControl.jsx` (+test), `ScorePlayer.jsx`, `ScoreTransportBar.jsx` (thread `onNudge`).

**Step 1: Failing unit tests** — append to `focusRange.test.js`:

```js
describe('nudgeRange', () => {
  const f = { kind: 'custom', inMeasure: 4, outMeasure: 8 };
  it('moves an edge by delta, returning a custom-kind focus', () => {
    expect(nudgeRange(f, 'in', -1, 20)).toEqual({ kind: 'custom', inMeasure: 3, outMeasure: 8 });
    expect(nudgeRange(f, 'out', +1, 20)).toEqual({ kind: 'custom', inMeasure: 4, outMeasure: 9 });
  });
  it('clamps: in ≥ 0, out ≤ count-1, in ≤ out', () => {
    expect(nudgeRange({ ...f, inMeasure: 0 }, 'in', -1, 20)).toEqual({ ...f, inMeasure: 0 });
    expect(nudgeRange({ ...f, outMeasure: 19 }, 'out', +1, 20)).toEqual({ kind: 'custom', inMeasure: 4, outMeasure: 19 });
    expect(nudgeRange({ kind: 'custom', inMeasure: 5, outMeasure: 5 }, 'in', +1, 20).inMeasure).toBe(5);
  });
  it('a section focus becomes custom when nudged (label no longer true)', () => {
    expect(nudgeRange({ kind: 'section', label: 'A', inMeasure: 2, outMeasure: 6 }, 'out', +1, 20)).toEqual({ kind: 'custom', inMeasure: 2, outMeasure: 7 });
  });
  it('null focus is a no-op', () => {
    expect(nudgeRange(null, 'in', 1, 20)).toBeNull();
  });
});
```

**Step 2:** Run — FAIL. **Step 3: Implement** in `focusRange.js`:

```js
/**
 * Nudge one edge of a focus by ±delta measures, clamped to [0, measureCount-1]
 * and to in ≤ out. Any nudge yields a plain custom range (a section label would
 * no longer describe the measures). Returns the same object if nothing changed.
 */
export function nudgeRange(focus, edge, delta, measureCount) {
  if (!focus) return focus;
  let { inMeasure, outMeasure } = focus;
  if (edge === 'in') inMeasure = Math.min(outMeasure, Math.max(0, inMeasure + delta));
  else outMeasure = Math.min(measureCount - 1, Math.max(inMeasure, outMeasure + delta));
  if (inMeasure === focus.inMeasure && outMeasure === focus.outMeasure) return focus;
  return { kind: 'custom', inMeasure, outMeasure };
}
```

**Step 4:** PASS. **Step 5: Failing component test** — append to `LoopControl.test.jsx`:

```js
it('active menu offers endpoint nudging that does not close the menu (L2)', () => {
  const onNudge = vi.fn();
  render(<LoopControl active scopeLabel="m9–m16" sections={[]} onNudge={onNudge} onStartSelect={() => {}} onClearFocus={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /loop m9/i }));
  fireEvent.click(screen.getByRole('button', { name: /start earlier/i }));
  expect(onNudge).toHaveBeenCalledWith('in', -1);
  expect(screen.getByRole('button', { name: /end later/i })).toBeInTheDocument(); // menu still open
});
```

**Step 6:** FAIL. **Step 7: Implement** — in `LoopControl.jsx`, inside the menu, above "Select measures…":

```jsx
{active && (
  <div className="piano-score-loop-nudge" role="group" aria-label="Adjust loop">
    <span className="piano-score-loop-nudge__label">Start</span>
    <button type="button" className="piano-score-btn" aria-label="Loop start earlier" onClick={() => onNudge?.('in', -1)}>−</button>
    <button type="button" className="piano-score-btn" aria-label="Loop start later" onClick={() => onNudge?.('in', +1)}>+</button>
    <span className="piano-score-loop-nudge__label">End</span>
    <button type="button" className="piano-score-btn" aria-label="Loop end earlier" onClick={() => onNudge?.('out', -1)}>−</button>
    <button type="button" className="piano-score-btn" aria-label="Loop end later" onClick={() => onNudge?.('out', +1)}>+</button>
  </div>
)}
```

Add `onNudge` to the component's props. In `ScorePlayer.jsx`:

```js
const onNudge = useCallback((edge, delta) => {
  setFocus((f) => nudgeRange(f, edge, delta, layout.measures?.length || 0));
}, [layout.measures]);
```

(import `nudgeRange`; note the existing focus effect will jump the cursor to the new in-point and re-log — desired.) Thread `onNudge` through `ScoreTransportBar` shell → `ScoreViewControls` → `LoopControl`. SCSS: `.piano-score-loop-nudge { display: flex; align-items: center; gap: 0.3rem; &__label { font-size: 0.8rem; opacity: 0.7; } }`.

**Step 8:** Whole suite PASS. **Step 9: Commit** — `git commit -m "feat(piano-sheetmusic): nudge loop endpoints by ±1 measure from the Loop menu (audit L2)"`

### Task 9: The loop follows you into Listen (L6) and survives at the end of the piece

Behavior: the loop persists across Listen/Learn/Polish (cleared only on entering Perform or opening a new score); in Listen the kiosk plays only the looped measures, wrapping with a silence flush; Play always starts inside the loop; a loop that reaches the piece's final step wraps instead of finishing.

**Files:** Modify `ScorePlayer.jsx`. Test: `ScorePlayer.test.jsx`.

**Step 1: Update the J3 test** (expected behavior change): in `practice range persistence (J3)`, replace the final two assertions with:

```js
// Switch to Listen — the loop now FOLLOWS (audit L6).
act(() => { screen.getByText('Listen').click(); });
expect(screen.getByRole('button', { name: /loop m1/i })).toBeInTheDocument();
// Perform releases it.
act(() => { screen.getByText('Perform').click(); });
act(() => { screen.getByText('Listen').click(); });
expect(screen.getByRole('button', { name: /^loop$/i })).toHaveTextContent(/^Loop$/); // back to inactive trigger
```

**Step 2: New failing playback test** — inside the Listen describe (fake-timer harness already there):

```js
it('Listen plays only the loop and wraps at the out-point with a silence flush (L6)', async () => {
  h.layoutExtras = {
    tempoEntries: [{ onsetQuarter: 0, bpm: 60 }],
    steps: [
      { onsetQuarter: 0, measure: 0, notes: [{ midi: 64, staff: 0, x: 100, top: 10, bottom: 200, width: 8 }] },
      { onsetQuarter: 1, measure: 1, notes: [{ midi: 62, staff: 0, x: 160, top: 10, bottom: 200, width: 8 }] },
    ],
    measures: [
      { index: 0, number: 1, firstStep: 0, lastStep: 0 },
      { index: 1, number: 2, firstStep: 1, lastStep: 1 },
    ],
  };
  renderPlayer();
  screen.getByText('Listen').click();
  await act(async () => {});
  // Loop measure 2 only (tail measure — exercises the onDone wrap path).
  act(() => { fireEvent.click(screen.getByRole('button', { name: /^loop/i })); });
  act(() => { fireEvent.click(screen.getByRole('button', { name: /select measures/i })); });
  const scroll = document.querySelector('.piano-score-player__scroll');
  act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
  act(() => { fireEvent.click(scroll, { clientX: 160, clientY: 100 }); });
  expect(screen.getByText('m 2 / 2')).toBeTruthy();
  screen.getByText('▶').click(); // My part = None → plays immediately
  await act(async () => {});
  act(() => vi.advanceTimersByTime(1100)); // past the final step @60bpm → would normally finish
  expect(screen.getByText('❚❚')).toBeTruthy(); // still playing — wrapped, not done
  expect(screen.getByText('m 2 / 2')).toBeTruthy(); // back at the loop in-point
});
```

**Step 3:** Run — FAIL (loop cleared entering Listen / transport finishes).

**Step 4: Implement in `ScorePlayer.jsx`:**

1. **Range in Listen** — change the `range` memo condition (~line 159) from `(mode === 'learn' || mode === 'polish')` to `mode !== 'perform'`, and the same for `hasFocus` gating in `ScoreTransportBar.jsx` (`ScoreViewControls`, ~line 172): `const hasFocus = mode !== 'perform';`.
2. **Mode switch** — in `onMode`, replace the `PRACTICE_PAIR` block with:

```js
// The loop follows Listen↔Learn↔Polish (hear it, drill it, prove it — audit
// L6/J3); only Perform (music-stand mode) releases it. Loop-arming always resets.
if (id === 'perform') setFocus(null);
```

3. **Wrap flush** — in the transport `onEvent` wrap branch (~line 300), after the `seek`, add `if (mode === 'listen') silenceScheduled();` (skipped note-offs must not drone).
4. **Tail-range wrap** — at the top of `onDone`, before anything else:

```js
// A loop that includes the final step reaches onDone instead of the past-the-
// out-point wrap — loop it here rather than finishing the run.
const r = rangeRef.current;
if (r && (mode === 'listen' || mode === 'polish')) {
  if (mode === 'listen') silenceScheduled();
  transportRef.current?.seek((stepTimeline[r[0]]?.t ?? 0) / tempoMult);
  setStep(r[0]);
  setStruck(() => new Set());
  transportRef.current?.play();
  return;
}
```

5. **Play starts inside the loop** — in `toggleRun`'s play path and in `countIn`'s `onGo`, clamp the start step:

```js
const startStep = rangeRef.current ? clampStepToRange(stepRef.current, rangeRef.current) : stepRef.current;
if (startStep !== stepRef.current) setStep(startStep);
transport.seek((stepTimeline[startStep]?.t ?? 0) / tempoMult);
```

(import `clampStepToRange` — already exported from `focusRange.js`.)
6. Update the mode-comment at the top of the `focus` state and the `sections`/range comment block to say Listen participates.

**Step 5:** Run the whole suite. The Polish `onDone → RunSummary (H1)` test has no range, so it still finishes. All PASS.

**Step 6: Commit** — `git commit -m "feat(piano-sheetmusic): loop follows into Listen and wraps at the piece end (audit L6)"`

---

## Phase 4 — Bar geography & grammar (audit C1–C5)

### Task 10: Stable three-zone bar; transport controls exist in every practice mode (C1, C2)

Target geography (Listen/Learn/Polish — Perform keeps tabs + page indicator only):

```
| Listen Learn Polish Perform |  ♩ 90   ↺   ▶   Loop ▾   m 3 / 24  |  Hands: Both RH LH   Key − 0 +   Tempo 100% ▾   View ▾ |
```

- **Center zone** (new home): metronome, Restart, Play/Pause, LoopControl, position readout. Restart renders always (disabled until `canRestart`); Play renders in Learn but disabled with `aria-label="Learn advances as you play"`. Metronome renders in Learn/Polish; in Listen it renders disabled (dimmed — Listen's performance is the beat).
- **Right zone:** Hands/parts, Key (disabled+dimmed outside Listen), Tempo ▾, View ▾. `flex-wrap` removed.

**Files:** Modify `ScoreTransportBar.jsx` (structural), `PianoApp.scss`. Test: new `describe` in `ScoreTransportBar.test.jsx` (render the bar directly with props — read that file's existing idiom first and copy its prop scaffolding).

**Step 1: Failing tests** — add to `ScoreTransportBar.test.jsx` (adapt prop scaffolding from its existing tests):

```js
describe('ScoreTransportBar — stable geography (C2)', () => {
  it('Learn renders Restart, a disabled Play, the metronome, and the Loop control', () => {
    render(<ScoreTransportBar mode="learn" onMode={() => {}} step={0} total={4} measure={1} measureTotal={2} ready canRestart={false} />);
    expect(screen.getByRole('button', { name: /restart/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /learn advances as you play/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /metronome/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^loop/i })).toBeInTheDocument();
  });
  it('Listen renders the metronome disabled (the performance is the beat)', () => {
    render(<ScoreTransportBar mode="listen" onMode={() => {}} step={0} total={4} ready />);
    expect(screen.getByRole('button', { name: /metronome/i })).toBeDisabled();
  });
  it('Perform renders only tabs and the page indicator', () => {
    render(<ScoreTransportBar mode="perform" onMode={() => {}} page={2} pages={5} />);
    expect(screen.queryByRole('button', { name: /^loop/i })).toBeNull();
    expect(screen.getByLabelText('Page')).toHaveTextContent('2 / 5');
  });
  it('Learn/Polish keep Key rendered but disabled (in-place gating)', () => {
    render(<ScoreTransportBar mode="polish" onMode={() => {}} step={0} total={4} ready />);
    expect(screen.getByRole('button', { name: /transpose up/i })).toBeDisabled();
  });
});
```

**Step 2:** Run — FAIL.

**Step 3: Restructure `ScoreTransportBar.jsx`:**

1. `ScoreTransportButtons`: render for every mode except perform; Restart becomes icon-only (`<RestartIcon />`, `aria-label="Restart"`) with `disabled={!canRestart}` (no more unmount); Play (icons from `./icons.jsx`, never glyph text):

```jsx
const isLearn = mode === 'learn';
const runLabel = isLearn ? 'Learn advances as you play' : !ready ? 'Preparing' : running ? 'Pause' : 'Play';
// …
<button
  type="button"
  className={`piano-score-btn piano-score-run${!ready ? ' is-preparing' : ''}`}
  aria-label={runLabel}
  aria-pressed={running}
  disabled={isLearn || !ready}
  onClick={onToggleRun}
>
  {isLearn ? <PlayIcon /> : !ready ? '…' : running ? <PauseIcon /> : <PlayIcon />}
</button>
```

1b. **Test-selector sweep (required by the SVG switch):** `ScorePlayer.test.jsx` clicks transport buttons via glyph text in many places — replace every `screen.getByText('▶')` with `screen.getByRole('button', { name: 'Play' })`, every `screen.getByText('❚❚')` with `screen.getByRole('button', { name: 'Pause' })`, and `screen.queryByText('▶')` with `screen.queryByRole('button', { name: 'Play' })`. The two assertions `expect(screen.getByText('❚❚')).toBeTruthy()` / `expect(screen.getByText('▶')).toBeTruthy()` (playing/paused state checks in the H2 and L6 tests) become the same role+name queries.

2. Extract the metronome button + `LoopControl` out of `ScoreViewControls` into a new memoized `ScorePracticeCluster` component rendered in the shell's `.piano-score-playback` div (between the transport buttons and the position readout), with props `mode, clickOn, bpm, onToggleClick, loopActive, scopeLabel, sections, onPickSection, onStartSelect, onClearFocus, onNudge`. Metronome: `disabled={mode === 'listen'}`; whole cluster `null` in perform.
3. `ScoreViewControls` keeps: parts/Hands, Key (now rendered for all non-perform modes, buttons `disabled={mode !== 'listen'}`, wrapper class gains `is-dimmed` when disabled), Tempo, View. Remove `hasListenExtras`/`hasClick`/`hasFocus` gating that unmounted things; keep `isPerform` early-null.
4. Update the shell's JSDoc mode-cluster table.

**Step 4: CSS (`PianoApp.scss`):**

```scss
.piano-score-transportbar {
  flex: 0 0 auto; width: 100%;
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 1rem;
  // (keep existing padding/background/border-top lines)
}
.piano-score-modes { justify-self: start; }
.piano-score-playback { justify-self: center; display: flex; align-items: center; gap: 0.5rem; }
.piano-score-view { justify-self: end; display: flex; align-items: center; gap: 0.5rem; flex-wrap: nowrap; }
.piano-score-key.is-dimmed { opacity: 0.35; }
.piano-score-loop-menu { left: 50%; transform: translateX(-50%); } // now anchored under the center zone
```

**Step 5:** Run the whole suite; fix any test that located the metronome/Loop inside the old cluster (queries are role-based, so most survive). All PASS.

**Step 6: Commit** — `git commit -m "feat(piano-sheetmusic): stable three-zone transport bar, in-place mode gating (audit C1/C2)"`

### Task 11: One button grammar (C3, C4, C5)

**Files:** `PianoApp.scss`, `ScoreTransportBar.jsx` (View trigger), `ViewMenu.test.jsx` if it asserts the `⋯` glyph.

**Step 1:** Change the View trigger's content from `'⋯'` to `<>View <ChevronDownIcon /></>` (keep `aria-label="View options"` — existing tests query by that name). Change the Tempo trigger's content to `` <>{`Tempo ${Math.round(tempoMult * 100)}%`} <ChevronDownIcon /></> ``. Also remove the `🎉` emoji from `LearnComplete.jsx` — headline becomes `You played every note!` (no icon needed; the card itself is the celebration).

**Step 2: CSS grammar pass** (`PianoApp.scss`, the score-bar region):

```scss
.piano-score-btn { min-height: 3rem; }                    // 48px touch floor (C5)
.piano-score-mode-tab { min-height: 3rem; }
.piano-score-part-chip { border-radius: var(--r-md, 12px); min-height: 3rem; } // one radius family (C3)
.piano-score-section-chip { border-radius: var(--r-md, 12px); }
```

Toggle-color rule (document it as a comment where `.piano-score-btn.is-on` is defined): **blue `is-on` = a setting is enabled; green = transport is running (`.piano-score-run[aria-pressed=true]`) — nothing else is green.** Delete the now-dead `.piano-score-loop.is-on` green rule and the dead `.piano-score-focus`, `.piano-score-focus-readout`, `.piano-score-scoring`, `.piano-score-size-wrap/-modal`, `.piano-score-info-wrap/-popover` rules if nothing references them (`grep -rn "piano-score-focus\|piano-score-scoring\|piano-score-size-modal\|piano-score-info" frontend/src --include="*.jsx"` first — delete only zero-hit classes).

**Step 3:** Run the whole SheetMusic suite + `npx vitest run frontend/src/modules/Piano/` — PASS.

**Step 4: Commit** — `git commit -m "style(piano-sheetmusic): one button grammar — 48px targets, unified radii, semantic toggle colors (audit C3-C5)"`

---

## Phase 5 — Docs & verification

### Task 12: Docs + full suite

**Step 1:** Check `ls docs/reference/piano/`. If a sheet-music doc exists, update its controls/modes section; otherwise create `docs/reference/piano/sheetmusic-mode.md` (½ page: the four modes, the loop model — follows Listen/Learn/Polish, cleared by Perform/new score — metronome semantics per mode, bar zones). No hostnames/ports (project doc rule).

**Step 2:** Append a short "Remediation" note to `cli/audit/2026-07-16-sheetmusic-layout-usability-audit.md` mapping finding IDs → this plan (L1✓ L2✓ L3✓ L4✓ L5✓ L6✓ M1–M4✓ C1–C5✓; out of scope: L7 re-count-in between Polish reps, L8, M5 visual beat, C6 popover unification, C7 About relocation, C8 palette rework).

**Step 3:** `npx vitest run frontend/src/modules/Piano/` — all PASS.

**Step 4: Commit** — `git commit -m "docs(piano-sheetmusic): sheet-music mode reference + audit remediation notes"`

### Task 13: On-kiosk verification (manual gate — do NOT skip; do NOT auto-deploy)

Per project memory, Sheet Music changes must be live-verified on the piano tablet (SM-T590 kiosk, FKB WebView). This task produces evidence, not code. Deploy per the household's normal flow only when KC authorizes (commit/deploy policy: no auto-deploy from this plan).

Checklist (each item gets a screenshot via FKB REST `getScreenshot`, or a photo from KC):

1. Open a multi-line score → set a loop crossing a line break → tint covers exactly the looped measures on both systems (L4).
2. `Loop ▾` visible next to Play; set loop → trigger reads `Loop m9–m16` with ✕; nudge End + and watch the bracket move (L1/L2).
3. Restart while looping → cursor lands on the loop's first measure (L5).
4. Listen with a loop → kiosk plays only those measures, repeats cleanly, no stuck notes on the piano (L6).
5. Learn → tap `♩ 90` → click starts immediately at practice tempo; change Tempo to 75% → label and click rate follow (M1/M2/M4).
6. Bar in each mode: no wrapped second row at kiosk width; Play/Restart/Loop never move between Listen/Learn/Polish (C1/C2).
7. All bar buttons comfortably tappable from the bench (C5).

Failures here reopen the corresponding task; when all pass, follow `superpowers:finishing-a-development-branch` (merge to main per repo policy, record the worktree branch in `docs/_archive/deleted-branches.md` when deleting).

---

## Out of scope (recorded, deliberately not in this plan — YAGNI)

- L7 (re-count-in / gap between Polish loop reps), L8 (auto-sections without rehearsal marks)
- M5 (visual beat pulse)
- C6 (single popover manager), C7 (move About out of ViewMenu), C8 (full semantic palette rework)
- Draggable bracket handles (nudge chips chosen instead — WebView drag on the SVG overlay is high-risk, low marginal value over nudging)
