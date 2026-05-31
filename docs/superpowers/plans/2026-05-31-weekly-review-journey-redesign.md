# Weekly Review Journey Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rip-and-replace the WeeklyReview navigation model with the browsing-first, two-level design (week grid ⇄ day reel + on-demand context panel), driven by a pure, fully-tested input keymap covering every Shield-remote state.

**Architecture:** Two pure logic modules carry the design — `viewReducer.js` (the two-level reel state machine) and a new `keymap.js` (resolves any remote key, in any state, to reducer actions + intents; it *is* the spec's input matrix in code). The React layer becomes thin: `WeeklyReview.jsx` computes a media-context descriptor, calls `resolveKey`, and applies the result. The heavy "day dashboard" splits into a fullscreen `DayReel` (media + video playback) and a slide-up `DayContextPanel` (timeline/weather/people/stats). The recording pipeline (bootstrap, chunk upload, draft recovery, disconnect handling) is preserved unchanged. The recording bar becomes ambient (non-focusable).

**Tech Stack:** React (hooks + `useReducer`), Vitest 4 + `@testing-library/react` (jsdom env), existing logging framework. Spec: `docs/superpowers/specs/2026-05-31-weekly-review-journey-redesign.md`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `frontend/src/modules/WeeklyReview/state/viewReducer.js` | Two-level reel state machine (pure) | **Rewrite** |
| `frontend/src/modules/WeeklyReview/state/viewReducer.test.js` | Reducer unit tests | **Rewrite** |
| `frontend/src/modules/WeeklyReview/state/keymap.js` | Pure remote-input resolver — the full input matrix | **Create** |
| `frontend/src/modules/WeeklyReview/state/keymap.test.js` | Keymap unit tests (one block per state) | **Create** |
| `frontend/src/modules/WeeklyReview/state/modalReducer.js` | Overlay/modal state (exit gate + lifecycle overlays) | **Modify** |
| `frontend/src/modules/WeeklyReview/state/modalReducer.test.js` | Modal reducer tests | **Modify** |
| `frontend/src/modules/WeeklyReview/components/DayContextPanel.jsx` | Slide-up day facts: timeline, weather, people, stats | **Create** (extract from DayDetail) |
| `frontend/src/modules/WeeklyReview/components/DayContextPanel.test.jsx` | Context panel render tests | **Create** |
| `frontend/src/modules/WeeklyReview/components/DayReel.jsx` | Fullscreen current item (photo or video poster) + inline playback | **Create** |
| `frontend/src/modules/WeeklyReview/components/DayReel.test.jsx` | Reel render tests | **Create** |
| `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx` | Ambient status bar (remove focus/save-focus) | **Modify** |
| `frontend/src/modules/WeeklyReview/components/DayColumn.jsx` | Week-grid cell collage | **Keep** (unchanged) |
| `frontend/src/modules/WeeklyReview/components/PhotoWall.jsx` | Collage layout | **Keep** (unchanged) |
| `frontend/src/modules/WeeklyReview/components/FullscreenImage.jsx` | Single fullscreen photo | **Keep** (reused by DayReel) |
| `frontend/src/modules/WeeklyReview/components/PreFlightOverlay.jsx` | Mic warm-up / unavailable overlay | **Keep** (unchanged) |
| `frontend/src/modules/WeeklyReview/components/DayDetail.jsx` | Old dashboard screen | **Delete** (split into DayReel + DayContextPanel) |
| `frontend/src/modules/WeeklyReview/WeeklyReview.jsx` | Orchestration: data, recording (unchanged), keymap wiring, render | **Modify** |
| `docs/reference/life/weekly-review.md` | Endstate reference doc | **Update** |

**Test command (run from repo root):** `npx vitest run <path-to-test-file>`

---

## Design contracts (read before Task 1)

### viewReducer state shape
```js
{
  level: 'grid' | 'reel',   // two levels only
  dayIndex: 0,              // index into data.days
  itemIndex: 0,             // index into current day's media (reel)
  playing: false,           // is the focused video element active
  muted: true,              // video mute state
  contextOpen: false,       // day context panel overlay
}
```

### viewReducer actions
`SELECT_DAY {dayIndex}`, `GRID_MOVE {dir, cols, total}`, `OPEN_DAY`, `CROSS_DAY {dayIndex, itemIndex}`, `STEP_ITEM {delta, totalItems}`, `CLIMB`, `OPEN_CONTEXT`, `CLOSE_CONTEXT`, `PLAY_VIDEO`, `TOGGLE_MUTE`, `STOP_VIDEO`.

### keymap `resolveKey(input)` contract
Input: `{ view, modalType, modalFocus, preflight, key, now, cols, totalDays, media, lastEdge, doubleWindowMs }`
where `media = { itemCount, currentType:'photo'|'video'|'none', atFirst, atLast, hasPrevDay, hasNextDay, prevDayIndex, nextDayIndex, prevDayLastIndex }`.
Returns: `{ view:[actions], modal:[actions], intents:[strings], edge: null|{dir,at} }`.
Intent strings: `'exitWidget'`, `'saveAndExit'`, `'exitNoSave'`, `'finalizeDraft'`, `'retryMic'`.

### modal types
`'exitGate'` (was `stopConfirm`), `'finalizeError'`, `'preflightFailed'`, `'disconnect'`, `'resumeDraft'`.

---

## Task 1: Rewrite viewReducer (two-level reel state machine)

**Files:**
- Rewrite: `frontend/src/modules/WeeklyReview/state/viewReducer.js`
- Rewrite: `frontend/src/modules/WeeklyReview/state/viewReducer.test.js`

- [ ] **Step 1: Replace the test file with the new state-machine spec**

```js
// frontend/src/modules/WeeklyReview/state/viewReducer.test.js
import { describe, it, expect } from 'vitest';
import { viewReducer, initialViewState } from './viewReducer.js';

const grid = (over = {}) => ({ level: 'grid', dayIndex: 0, itemIndex: 0, playing: false, muted: true, contextOpen: false, ...over });
const reel = (over = {}) => ({ level: 'reel', dayIndex: 0, itemIndex: 0, playing: false, muted: true, contextOpen: false, ...over });

describe('viewReducer', () => {
  it('starts on the grid', () => {
    expect(initialViewState).toEqual(grid());
  });

  describe('SELECT_DAY', () => {
    it('sets focus dayIndex without leaving the grid', () => {
      expect(viewReducer(grid(), { type: 'SELECT_DAY', dayIndex: 3 })).toEqual(grid({ dayIndex: 3 }));
    });
  });

  describe('GRID_MOVE (4 cols)', () => {
    const g = (i) => grid({ dayIndex: i });
    it('right/left move within a row and hard-stop at column edges', () => {
      expect(viewReducer(g(0), { type: 'GRID_MOVE', dir: 'right', cols: 4, total: 8 }).dayIndex).toBe(1);
      expect(viewReducer(g(3), { type: 'GRID_MOVE', dir: 'right', cols: 4, total: 8 }).dayIndex).toBe(3); // edge
      expect(viewReducer(g(4), { type: 'GRID_MOVE', dir: 'left', cols: 4, total: 8 }).dayIndex).toBe(4); // edge
      expect(viewReducer(g(5), { type: 'GRID_MOVE', dir: 'left', cols: 4, total: 8 }).dayIndex).toBe(4);
    });
    it('down/up move between rows and hard-stop at grid edges', () => {
      expect(viewReducer(g(1), { type: 'GRID_MOVE', dir: 'down', cols: 4, total: 8 }).dayIndex).toBe(5);
      expect(viewReducer(g(5), { type: 'GRID_MOVE', dir: 'down', cols: 4, total: 8 }).dayIndex).toBe(5); // bottom edge
      expect(viewReducer(g(5), { type: 'GRID_MOVE', dir: 'up', cols: 4, total: 8 }).dayIndex).toBe(1);
      expect(viewReducer(g(1), { type: 'GRID_MOVE', dir: 'up', cols: 4, total: 8 }).dayIndex).toBe(1); // top edge
    });
    it('down hard-stops when the target cell has no day', () => {
      expect(viewReducer(g(2), { type: 'GRID_MOVE', dir: 'down', cols: 4, total: 6 }).dayIndex).toBe(2); // 2+4=6 out of range
    });
  });

  describe('OPEN_DAY', () => {
    it('enters the reel at item 0 with playback reset', () => {
      expect(viewReducer(grid({ dayIndex: 4 }), { type: 'OPEN_DAY' }))
        .toEqual(reel({ dayIndex: 4 }));
    });
  });

  describe('STEP_ITEM', () => {
    it('advances and clamps with no wrap, resetting playback', () => {
      expect(viewReducer(reel({ itemIndex: 2, playing: true, muted: false }), { type: 'STEP_ITEM', delta: 1, totalItems: 5 }))
        .toEqual(reel({ itemIndex: 3 }));
      expect(viewReducer(reel({ itemIndex: 4 }), { type: 'STEP_ITEM', delta: 1, totalItems: 5 }).itemIndex).toBe(4); // edge
      expect(viewReducer(reel({ itemIndex: 0 }), { type: 'STEP_ITEM', delta: -1, totalItems: 5 }).itemIndex).toBe(0); // edge
    });
  });

  describe('CROSS_DAY', () => {
    it('jumps to a given day + item with playback reset', () => {
      expect(viewReducer(reel({ dayIndex: 2, itemIndex: 3, playing: true }), { type: 'CROSS_DAY', dayIndex: 3, itemIndex: 0 }))
        .toEqual(reel({ dayIndex: 3, itemIndex: 0 }));
    });
  });

  describe('CLIMB (priority: context > playing > level)', () => {
    it('closes the context panel first', () => {
      expect(viewReducer(reel({ contextOpen: true, playing: true }), { type: 'CLIMB' }))
        .toEqual(reel({ contextOpen: false, playing: true }));
    });
    it('stops a playing video to the poster', () => {
      expect(viewReducer(reel({ playing: true, muted: false }), { type: 'CLIMB' }))
        .toEqual(reel({ playing: false, muted: true }));
    });
    it('reel climbs to the grid, resetting reel fields but keeping dayIndex', () => {
      expect(viewReducer(reel({ dayIndex: 5, itemIndex: 4 }), { type: 'CLIMB' }))
        .toEqual(grid({ dayIndex: 5 }));
    });
    it('grid is a no-op (caller raises the exit gate)', () => {
      expect(viewReducer(grid({ dayIndex: 2 }), { type: 'CLIMB' })).toEqual(grid({ dayIndex: 2 }));
    });
  });

  describe('context + video actions', () => {
    it('OPEN_CONTEXT / CLOSE_CONTEXT toggle the panel', () => {
      expect(viewReducer(reel(), { type: 'OPEN_CONTEXT' }).contextOpen).toBe(true);
      expect(viewReducer(reel({ contextOpen: true }), { type: 'CLOSE_CONTEXT' }).contextOpen).toBe(false);
    });
    it('PLAY_VIDEO starts muted; TOGGLE_MUTE flips; STOP_VIDEO stops', () => {
      expect(viewReducer(reel(), { type: 'PLAY_VIDEO' })).toEqual(reel({ playing: true, muted: true }));
      expect(viewReducer(reel({ playing: true, muted: true }), { type: 'TOGGLE_MUTE' }).muted).toBe(false);
      expect(viewReducer(reel({ playing: true }), { type: 'STOP_VIDEO' }).playing).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run frontend/src/modules/WeeklyReview/state/viewReducer.test.js`
Expected: FAIL — the old reducer exports `makeInitialView` and uses `level:'toc'`; new shape/actions are absent.

- [ ] **Step 3: Replace the reducer implementation**

```js
// frontend/src/modules/WeeklyReview/state/viewReducer.js
export const initialViewState = {
  level: 'grid',     // 'grid' | 'reel'
  dayIndex: 0,
  itemIndex: 0,
  playing: false,
  muted: true,
  contextOpen: false,
};

function clamp(n, min, max) {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// Reset reel-local fields when leaving the reel or changing item/day.
const REEL_RESET = { itemIndex: 0, playing: false, muted: true, contextOpen: false };

export function viewReducer(state, action) {
  switch (action.type) {
    case 'SELECT_DAY':
      return { ...state, dayIndex: action.dayIndex };

    case 'GRID_MOVE': {
      const { dir, cols, total } = action;
      const i = state.dayIndex;
      let next = i;
      if (dir === 'left'  && i % cols !== 0)        next = i - 1;
      if (dir === 'right' && i % cols !== cols - 1) next = i + 1;
      if (dir === 'up'    && i - cols >= 0)         next = i - cols;
      if (dir === 'down'  && i + cols < total)      next = i + cols;
      if (next < 0 || next >= total) next = i; // never land off-grid
      return { ...state, dayIndex: next };
    }

    case 'OPEN_DAY':
      return { ...state, level: 'reel', ...REEL_RESET };

    case 'CROSS_DAY':
      return { ...state, level: 'reel', dayIndex: action.dayIndex, itemIndex: action.itemIndex, playing: false, muted: true, contextOpen: false };

    case 'STEP_ITEM': {
      const next = clamp(state.itemIndex + action.delta, 0, Math.max(0, action.totalItems - 1));
      return { ...state, itemIndex: next, playing: false, muted: true };
    }

    case 'CLIMB': {
      if (state.contextOpen) return { ...state, contextOpen: false };
      if (state.playing)     return { ...state, playing: false, muted: true };
      if (state.level === 'reel') return { ...initialViewState, dayIndex: state.dayIndex };
      return state; // grid: no-op; caller opens the exit gate
    }

    case 'OPEN_CONTEXT':  return { ...state, contextOpen: true };
    case 'CLOSE_CONTEXT': return { ...state, contextOpen: false };
    case 'PLAY_VIDEO':    return { ...state, playing: true, muted: true };
    case 'TOGGLE_MUTE':   return { ...state, muted: !state.muted };
    case 'STOP_VIDEO':    return { ...state, playing: false };

    default: return state;
  }
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npx vitest run frontend/src/modules/WeeklyReview/state/viewReducer.test.js`
Expected: PASS (all blocks green).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/WeeklyReview/state/viewReducer.js frontend/src/modules/WeeklyReview/state/viewReducer.test.js
git commit -m "refactor(weekly-review): rewrite viewReducer as two-level reel state machine"
```

---

## Task 2: Create the keymap (the input matrix in code)

**Files:**
- Create: `frontend/src/modules/WeeklyReview/state/keymap.js`
- Create: `frontend/src/modules/WeeklyReview/state/keymap.test.js`

- [ ] **Step 1: Write the keymap test (one describe block per state)**

```js
// frontend/src/modules/WeeklyReview/state/keymap.test.js
import { describe, it, expect } from 'vitest';
import { resolveKey } from './keymap.js';

const base = (over = {}) => ({
  view: { level: 'grid', dayIndex: 7, itemIndex: 0, playing: false, muted: true, contextOpen: false },
  modalType: null, modalFocus: 0, preflight: 'ok',
  cols: 4, totalDays: 8, now: 1000, lastEdge: null, doubleWindowMs: 500,
  media: { itemCount: 3, currentType: 'photo', atFirst: true, atLast: false,
           hasPrevDay: true, hasNextDay: false, prevDayIndex: 6, nextDayIndex: -1, prevDayLastIndex: 2 },
  ...over,
});
const r = (input) => resolveKey(base(input));

describe('keymap — week grid', () => {
  const onGrid = (over) => ({ view: { level: 'grid', dayIndex: 5, itemIndex: 0, playing: false, muted: true, contextOpen: false }, ...over });
  it('arrows move focus via GRID_MOVE', () => {
    expect(r({ ...onGrid(), key: 'ArrowRight' }).view).toEqual([{ type: 'GRID_MOVE', dir: 'right', cols: 4, total: 8 }]);
  });
  it('Up from the top row raises the exit gate', () => {
    expect(r({ ...onGrid({ view: { level: 'grid', dayIndex: 1, itemIndex: 0, playing: false, muted: true, contextOpen: false } }), key: 'ArrowUp' }).modal)
      .toEqual([{ type: 'OPEN', modal: 'exitGate' }]);
  });
  it('Up from the bottom row just moves up a row', () => {
    expect(r({ ...onGrid(), key: 'ArrowUp' }).view).toEqual([{ type: 'GRID_MOVE', dir: 'up', cols: 4, total: 8 }]);
  });
  it('Enter opens the focused day', () => {
    expect(r({ ...onGrid(), key: 'Enter' }).view).toEqual([{ type: 'OPEN_DAY' }]);
  });
  it('Back raises the exit gate', () => {
    expect(r({ ...onGrid(), key: 'Escape' }).modal).toEqual([{ type: 'OPEN', modal: 'exitGate' }]);
  });
});

describe('keymap — reel, photo focused', () => {
  const onReel = (over = {}) => base({
    view: { level: 'reel', dayIndex: 4, itemIndex: 1, playing: false, muted: true, contextOpen: false },
    media: { itemCount: 3, currentType: 'photo', atFirst: false, atLast: false, hasPrevDay: true, hasNextDay: true, prevDayIndex: 5, nextDayIndex: 3, prevDayLastIndex: 4 },
    ...over,
  });
  it('Right steps to the next item', () => {
    expect(resolveKey(onReel({ key: 'ArrowRight' })).view).toEqual([{ type: 'STEP_ITEM', delta: 1, totalItems: 3 }]);
  });
  it('Enter also steps to the next item (photo has no other action)', () => {
    expect(resolveKey(onReel({ key: 'Enter' })).view).toEqual([{ type: 'STEP_ITEM', delta: 1, totalItems: 3 }]);
  });
  it('Up climbs to the grid', () => {
    expect(resolveKey(onReel({ key: 'ArrowUp' })).view).toEqual([{ type: 'CLIMB' }]);
  });
  it('Down opens the context panel', () => {
    expect(resolveKey(onReel({ key: 'ArrowDown' })).view).toEqual([{ type: 'OPEN_CONTEXT' }]);
  });
  it('Back climbs to the grid', () => {
    expect(resolveKey(onReel({ key: 'Escape' })).view).toEqual([{ type: 'CLIMB' }]);
  });
});

describe('keymap — reel edges + double-tap cross-day', () => {
  const atLast = (over = {}) => base({
    view: { level: 'reel', dayIndex: 4, itemIndex: 2, playing: false, muted: true, contextOpen: false },
    media: { itemCount: 3, currentType: 'photo', atFirst: false, atLast: true, hasPrevDay: true, hasNextDay: true, prevDayIndex: 5, nextDayIndex: 3, prevDayLastIndex: 4 },
    ...over,
  });
  it('Right at the last item bumps and records a right edge (no movement)', () => {
    const res = resolveKey(atLast({ key: 'ArrowRight', now: 1000, lastEdge: null }));
    expect(res.view).toEqual([]);
    expect(res.edge).toEqual({ dir: 'right', at: 1000 });
  });
  it('second Right within the window crosses to the next day, first item', () => {
    const res = resolveKey(atLast({ key: 'ArrowRight', now: 1300, lastEdge: { dir: 'right', at: 1000 } }));
    expect(res.view).toEqual([{ type: 'CROSS_DAY', dayIndex: 3, itemIndex: 0 }]);
    expect(res.edge).toBeNull();
  });
  it('second Right after the window expires only bumps again', () => {
    const res = resolveKey(atLast({ key: 'ArrowRight', now: 2000, lastEdge: { dir: 'right', at: 1000 } }));
    expect(res.view).toEqual([]);
    expect(res.edge).toEqual({ dir: 'right', at: 2000 });
  });
  it('double-Left at the first item crosses to the previous day, last item', () => {
    const atFirst = base({
      view: { level: 'reel', dayIndex: 4, itemIndex: 0, playing: false, muted: true, contextOpen: false },
      media: { itemCount: 3, currentType: 'photo', atFirst: true, atLast: false, hasPrevDay: true, hasNextDay: true, prevDayIndex: 5, nextDayIndex: 3, prevDayLastIndex: 4 },
      key: 'ArrowLeft', now: 1200, lastEdge: { dir: 'left', at: 1000 },
    });
    expect(resolveKey(atFirst).view).toEqual([{ type: 'CROSS_DAY', dayIndex: 5, itemIndex: 4 }]);
  });
  it('cannot cross past the last day (no next day)', () => {
    const res = resolveKey(atLast({ key: 'ArrowRight', now: 1200, lastEdge: { dir: 'right', at: 1000 }, media: { itemCount: 3, currentType: 'photo', atFirst: false, atLast: true, hasPrevDay: true, hasNextDay: false, prevDayIndex: 5, nextDayIndex: -1, prevDayLastIndex: 4 } }));
    expect(res.view).toEqual([]);
  });
});

describe('keymap — reel, video focused', () => {
  const onVideo = (over = {}) => base({
    view: { level: 'reel', dayIndex: 4, itemIndex: 1, playing: false, muted: true, contextOpen: false },
    media: { itemCount: 3, currentType: 'video', atFirst: false, atLast: false, hasPrevDay: true, hasNextDay: true, prevDayIndex: 5, nextDayIndex: 3, prevDayLastIndex: 4 },
    ...over,
  });
  it('Enter plays the video (muted)', () => {
    expect(resolveKey(onVideo({ key: 'Enter' })).view).toEqual([{ type: 'PLAY_VIDEO' }]);
  });
});

describe('keymap — video playing', () => {
  const playing = (over = {}) => base({
    view: { level: 'reel', dayIndex: 4, itemIndex: 1, playing: true, muted: true, contextOpen: false },
    media: { itemCount: 3, currentType: 'video', atFirst: false, atLast: false, hasPrevDay: true, hasNextDay: true, prevDayIndex: 5, nextDayIndex: 3, prevDayLastIndex: 4 },
    ...over,
  });
  it('Enter toggles mute', () => {
    expect(resolveKey(playing({ key: 'Enter' })).view).toEqual([{ type: 'TOGGLE_MUTE' }]);
  });
  it('Right steps to the next item (stops the video)', () => {
    expect(resolveKey(playing({ key: 'ArrowRight' })).view).toEqual([{ type: 'STEP_ITEM', delta: 1, totalItems: 3 }]);
  });
  it('Up/Back climb one level (stop video → poster)', () => {
    expect(resolveKey(playing({ key: 'ArrowUp' })).view).toEqual([{ type: 'CLIMB' }]);
    expect(resolveKey(playing({ key: 'Escape' })).view).toEqual([{ type: 'CLIMB' }]);
  });
  it('Down opens the context panel', () => {
    expect(resolveKey(playing({ key: 'ArrowDown' })).view).toEqual([{ type: 'OPEN_CONTEXT' }]);
  });
});

describe('keymap — context panel open', () => {
  const ctx = (over = {}) => base({
    view: { level: 'reel', dayIndex: 4, itemIndex: 1, playing: false, muted: true, contextOpen: true },
    media: { itemCount: 3, currentType: 'photo', atFirst: false, atLast: false, hasPrevDay: true, hasNextDay: true, prevDayIndex: 5, nextDayIndex: 3, prevDayLastIndex: 4 },
    ...over,
  });
  it('Down / Up / Back all close the panel', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Escape']) {
      expect(resolveKey(ctx({ key })).view).toEqual([{ type: 'CLOSE_CONTEXT' }]);
    }
  });
  it('Left / Right are inert while the panel is open', () => {
    expect(resolveKey(ctx({ key: 'ArrowRight' })).view).toEqual([]);
  });
});

describe('keymap — exit gate modal', () => {
  const gate = (focus, key) => base({ modalType: 'exitGate', modalFocus: focus, key });
  it('arrows toggle focus', () => {
    expect(resolveKey(gate(0, 'ArrowRight')).modal).toEqual([{ type: 'TOGGLE_FOCUS' }]);
    expect(resolveKey(gate(0, 'ArrowUp')).modal).toEqual([{ type: 'TOGGLE_FOCUS' }]);
  });
  it('Enter on "Keep going" closes; on "Save & end" closes + saveAndExit', () => {
    expect(resolveKey(gate(0, 'Enter')).modal).toEqual([{ type: 'CLOSE' }]);
    const save = resolveKey(gate(1, 'Enter'));
    expect(save.modal).toEqual([{ type: 'CLOSE' }]);
    expect(save.intents).toEqual(['saveAndExit']);
  });
  it('Back cancels (closes)', () => {
    expect(resolveKey(gate(0, 'Escape')).modal).toEqual([{ type: 'CLOSE' }]);
  });
});

describe('keymap — recording-lifecycle overlays', () => {
  it('preflight acquiring: Back exits without saving; arrows fall through to grid', () => {
    const acq = base({ preflight: 'acquiring', view: { level: 'grid', dayIndex: 5, itemIndex: 0, playing: false, muted: true, contextOpen: false } });
    expect(resolveKey({ ...acq, key: 'Escape' }).intents).toEqual(['exitNoSave']);
    expect(resolveKey({ ...acq, key: 'ArrowRight' }).view).toEqual([{ type: 'GRID_MOVE', dir: 'right', cols: 4, total: 8 }]);
  });
  it('preflightFailed: Enter focus 0 retries, focus 1 exits; Back exits', () => {
    expect(resolveKey(base({ modalType: 'preflightFailed', modalFocus: 0, key: 'Enter' })).intents).toEqual(['retryMic']);
    expect(resolveKey(base({ modalType: 'preflightFailed', modalFocus: 1, key: 'Enter' })).intents).toEqual(['exitWidget']);
    expect(resolveKey(base({ modalType: 'preflightFailed', modalFocus: 0, key: 'Escape' })).intents).toEqual(['exitWidget']);
  });
  it('disconnect: all keys inert', () => {
    for (const key of ['ArrowUp', 'Enter', 'Escape']) {
      const res = resolveKey(base({ modalType: 'disconnect', key }));
      expect(res).toEqual({ view: [], modal: [], intents: [], edge: null });
    }
  });
  it('resumeDraft: Enter finalizes; arrows fall through to grid; Back defers (close)', () => {
    const d = base({ modalType: 'resumeDraft', view: { level: 'grid', dayIndex: 5, itemIndex: 0, playing: false, muted: true, contextOpen: false } });
    const enter = resolveKey({ ...d, key: 'Enter' });
    expect(enter.intents).toEqual(['finalizeDraft']);
    expect(enter.modal).toEqual([{ type: 'CLOSE' }]);
    expect(resolveKey({ ...d, key: 'ArrowRight' }).view).toEqual([{ type: 'GRID_MOVE', dir: 'right', cols: 4, total: 8 }]);
    expect(resolveKey({ ...d, key: 'Escape' }).modal).toEqual([{ type: 'CLOSE' }]);
  });
  it('finalizeError: Enter focus 1 exits; Back closes', () => {
    expect(resolveKey(base({ modalType: 'finalizeError', modalFocus: 1, key: 'Enter' })).intents).toEqual(['exitWidget']);
    expect(resolveKey(base({ modalType: 'finalizeError', modalFocus: 0, key: 'Enter' })).modal).toEqual([{ type: 'CLOSE' }]);
    expect(resolveKey(base({ modalType: 'finalizeError', modalFocus: 0, key: 'Escape' })).modal).toEqual([{ type: 'CLOSE' }]);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run frontend/src/modules/WeeklyReview/state/keymap.test.js`
Expected: FAIL — `keymap.js` does not exist (`Failed to resolve import`).

- [ ] **Step 3: Implement the keymap**

```js
// frontend/src/modules/WeeklyReview/state/keymap.js
// Pure remote-input resolver. Given a full snapshot + a key, returns the
// reducer actions and side-effect intents to apply. This module is the
// single source of truth for the input matrix (see the redesign spec).

const EMPTY = () => ({ view: [], modal: [], intents: [], edge: null });
const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function gridMove(dir, cols, total) {
  return { type: 'GRID_MOVE', dir, cols, total };
}

export function resolveKey(input) {
  const { view, modalType, modalFocus, preflight, key, now, cols, totalDays, media, lastEdge, doubleWindowMs } = input;
  const isEnter = key === 'Enter';
  const isBack = key === 'Escape';
  const dir = ARROWS[key];
  const twoButton = modalType === 'exitGate' || modalType === 'finalizeError' || modalType === 'preflightFailed';
  const out = EMPTY();

  // ---- Modal layer (overrides everything except fall-through cases) ----
  if (modalType === 'disconnect') return out; // informational — swallow all keys

  if (modalType) {
    if (twoButton && (dir === 'left' || dir === 'right' || dir === 'up' || dir === 'down')) {
      out.modal.push({ type: 'TOGGLE_FOCUS' });
      return out;
    }
    if (modalType === 'exitGate') {
      if (isBack) { out.modal.push({ type: 'CLOSE' }); return out; }
      if (isEnter) {
        out.modal.push({ type: 'CLOSE' });
        if (modalFocus === 1) out.intents.push('saveAndExit');
        return out;
      }
    }
    if (modalType === 'finalizeError') {
      if (isBack) { out.modal.push({ type: 'CLOSE' }); return out; }
      if (isEnter) { out.modal.push({ type: 'CLOSE' }); if (modalFocus === 1) out.intents.push('exitWidget'); return out; }
    }
    if (modalType === 'preflightFailed') {
      if (isBack) { out.intents.push('exitWidget'); return out; }
      if (isEnter) { out.intents.push(modalFocus === 0 ? 'retryMic' : 'exitWidget'); return out; }
    }
    if (modalType === 'resumeDraft') {
      if (isEnter) { out.modal.push({ type: 'CLOSE' }); out.intents.push('finalizeDraft'); return out; }
      if (isBack) { out.modal.push({ type: 'CLOSE' }); return out; } // defer
      // arrows fall through to the grid underneath
    } else {
      return out; // any unhandled key on a modal is inert
    }
  }

  // ---- Preflight "acquiring": soft gate over the grid ----
  if (preflight === 'acquiring' && isBack) { out.intents.push('exitNoSave'); return out; }

  // ---- Main hierarchy ----
  if (view.level === 'grid') {
    if (dir) {
      const onTopRow = view.dayIndex < cols;
      if (dir === 'up' && onTopRow) { out.modal.push({ type: 'OPEN', modal: 'exitGate' }); return out; }
      out.view.push(gridMove(dir, cols, totalDays));
      return out;
    }
    if (isEnter) { out.view.push({ type: 'OPEN_DAY' }); return out; }
    if (isBack)  { out.modal.push({ type: 'OPEN', modal: 'exitGate' }); return out; }
    return out;
  }

  // view.level === 'reel'
  if (view.contextOpen) {
    if (dir === 'down' || dir === 'up' || isBack) { out.view.push({ type: 'CLOSE_CONTEXT' }); return out; }
    return out; // left/right/enter inert while panel open
  }

  if (isBack || dir === 'up') { out.view.push({ type: 'CLIMB' }); return out; }
  if (dir === 'down') { out.view.push({ type: 'OPEN_CONTEXT' }); return out; }

  if (isEnter) {
    if (view.playing) { out.view.push({ type: 'TOGGLE_MUTE' }); return out; }
    if (media.currentType === 'video') { out.view.push({ type: 'PLAY_VIDEO' }); return out; }
    if (media.currentType === 'photo') { out.view.push({ type: 'STEP_ITEM', delta: 1, totalItems: media.itemCount }); return out; }
    return out; // empty day
  }

  if (dir === 'left' || dir === 'right') {
    const goingRight = dir === 'right';
    const atEdge = goingRight ? media.atLast : media.atFirst;
    if (!atEdge) {
      out.view.push({ type: 'STEP_ITEM', delta: goingRight ? 1 : -1, totalItems: media.itemCount });
      return out;
    }
    // At the edge: cross day if this is a second tap within the window, else bump + record edge.
    const armed = lastEdge && lastEdge.dir === dir && (now - lastEdge.at) < doubleWindowMs;
    const canCross = goingRight ? media.hasNextDay : media.hasPrevDay;
    if (armed && canCross) {
      const dayIndex = goingRight ? media.nextDayIndex : media.prevDayIndex;
      const itemIndex = goingRight ? 0 : media.prevDayLastIndex;
      out.view.push({ type: 'CROSS_DAY', dayIndex, itemIndex });
      out.edge = null;
      return out;
    }
    out.edge = { dir, at: now };
    return out;
  }

  return out;
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npx vitest run frontend/src/modules/WeeklyReview/state/keymap.test.js`
Expected: PASS (every state block green).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/WeeklyReview/state/keymap.js frontend/src/modules/WeeklyReview/state/keymap.test.js
git commit -m "feat(weekly-review): add pure keymap resolver covering the full input matrix"
```

---

## Task 3: Update modalReducer (exit gate + priorities)

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/state/modalReducer.js`
- Modify: `frontend/src/modules/WeeklyReview/state/modalReducer.test.js`

- [ ] **Step 1: Update the test to use `exitGate` and the new priority order**

Replace the contents of `modalReducer.test.js` with:

```js
// frontend/src/modules/WeeklyReview/state/modalReducer.test.js
import { describe, it, expect } from 'vitest';
import { modalReducer, initialModalState, OVERLAY_PRIORITY } from './modalReducer.js';

describe('modalReducer', () => {
  it('starts closed', () => {
    expect(initialModalState).toEqual({ type: null, focusIndex: 0, payload: null });
  });

  it('OPEN sets type, resets focus, carries payload', () => {
    expect(modalReducer(initialModalState, { type: 'OPEN', modal: 'exitGate' }))
      .toEqual({ type: 'exitGate', focusIndex: 0, payload: null });
    expect(modalReducer(initialModalState, { type: 'OPEN', modal: 'resumeDraft', payload: { sessionId: 'x' } }).payload)
      .toEqual({ sessionId: 'x' });
  });

  it('a lower-priority OPEN cannot displace a higher-priority modal', () => {
    const failed = modalReducer(initialModalState, { type: 'OPEN', modal: 'preflightFailed' });
    expect(modalReducer(failed, { type: 'OPEN', modal: 'exitGate' })).toEqual(failed);
  });

  it('equal-priority OPEN replaces (disconnect phase transitions)', () => {
    const reconnecting = modalReducer(initialModalState, { type: 'OPEN', modal: 'disconnect', payload: { phase: 'reconnecting' } });
    const finalizing = modalReducer(reconnecting, { type: 'OPEN', modal: 'disconnect', payload: { phase: 'finalizing' } });
    expect(finalizing.payload).toEqual({ phase: 'finalizing' });
  });

  it('priority order: preflightFailed > disconnect > finalizeError > exitGate > resumeDraft', () => {
    expect(OVERLAY_PRIORITY.preflightFailed).toBeGreaterThan(OVERLAY_PRIORITY.disconnect);
    expect(OVERLAY_PRIORITY.disconnect).toBeGreaterThan(OVERLAY_PRIORITY.finalizeError);
    expect(OVERLAY_PRIORITY.finalizeError).toBeGreaterThan(OVERLAY_PRIORITY.exitGate);
    expect(OVERLAY_PRIORITY.exitGate).toBeGreaterThan(OVERLAY_PRIORITY.resumeDraft);
  });

  it('CLOSE resets; TOGGLE_FOCUS flips 0↔1', () => {
    const open = modalReducer(initialModalState, { type: 'OPEN', modal: 'exitGate' });
    expect(modalReducer(open, { type: 'CLOSE' })).toEqual(initialModalState);
    expect(modalReducer(open, { type: 'TOGGLE_FOCUS' }).focusIndex).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run frontend/src/modules/WeeklyReview/state/modalReducer.test.js`
Expected: FAIL — `OVERLAY_PRIORITY` still keys `stopConfirm`, not `exitGate`.

- [ ] **Step 3: Rename `stopConfirm` → `exitGate` in the priority map**

In `frontend/src/modules/WeeklyReview/state/modalReducer.js`, change the `OVERLAY_PRIORITY` object so the `stopConfirm: 70` line reads:

```js
export const OVERLAY_PRIORITY = {
  preflightFailed: 100,
  disconnect:      90,
  finalizeError:   80,
  exitGate:        70,
  resumeDraft:     60,
};
```

(The reducer body — `OPEN`/`CLOSE`/`TOGGLE_FOCUS`/`SET_FOCUS` logic — is unchanged.)

- [ ] **Step 4: Run the test, expect pass**

Run: `npx vitest run frontend/src/modules/WeeklyReview/state/modalReducer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/WeeklyReview/state/modalReducer.js frontend/src/modules/WeeklyReview/state/modalReducer.test.js
git commit -m "refactor(weekly-review): rename stopConfirm modal to exitGate"
```

---

## Task 4: Extract DayContextPanel (the on-demand day facts)

**Files:**
- Create: `frontend/src/modules/WeeklyReview/components/DayContextPanel.jsx`
- Create: `frontend/src/modules/WeeklyReview/components/DayContextPanel.test.jsx`

This moves the timeline/weather/people/summary content out of the old `DayDetail` sidebar into a standalone slide-up panel. The `buildTimeline` helper and the weather/time helpers come straight from `DayDetail.jsx` (lines 16–165) — copy them verbatim into this file.

- [ ] **Step 1: Write the render test**

```jsx
// frontend/src/modules/WeeklyReview/components/DayContextPanel.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import DayContextPanel from './DayContextPanel.jsx';

const day = {
  date: '2026-04-21',
  weather: { code: 0, high: 22, low: 12, precip: 0 },
  calendar: [{ time: '8:30 AM', summary: 'Standup' }],
  fitness: [{ sessionId: '20260421073000', durationMs: 1800000, media: { primary: { title: 'Peloton' } }, participants: {} }],
  photos: [{ id: 'p1', people: ['Mara'], type: 'image', takenAt: '2026-04-21T14:30:00Z' }],
  photoCount: 1,
  sessions: [],
};

describe('DayContextPanel', () => {
  it('renders timeline, weather, people, and summary when open', () => {
    render(<DayContextPanel day={day} open={true} />);
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('Standup')).toBeInTheDocument();
    expect(screen.getByText('Weather')).toBeInTheDocument();
    expect(screen.getByText('Mara')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<DayContextPanel day={day} open={false} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run frontend/src/modules/WeeklyReview/components/DayContextPanel.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the panel**

```jsx
// frontend/src/modules/WeeklyReview/components/DayContextPanel.jsx
import React, { useMemo } from 'react';

const WMO_ICONS = {
  0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️', 45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌦', 55: '🌧', 61: '🌧', 63: '🌧', 65: '🌧',
  71: '🌨', 73: '🌨', 75: '❄️', 77: '❄️', 80: '🌦', 81: '🌧', 82: '🌧',
  85: '🌨', 86: '❄️', 95: '⛈', 96: '⛈', 99: '⛈',
};
const WMO_DESC = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Foggy', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Light snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Hail storm', 99: 'Heavy hail',
};
function cToF(c) { return Math.round(c * 9 / 5 + 32); }
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

function buildTimeline(day) {
  const items = [];
  function to24h(timeStr) {
    if (!timeStr || timeStr === 'All day') return '00:00';
    const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return '99:99';
    let h = parseInt(match[1], 10);
    const m = match[2];
    const ampm = match[3].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}`;
  }
  for (const event of (day.calendar || [])) {
    items.push({ type: 'calendar', time: event.allDay ? 'All day' : event.time, endTime: event.endTime, label: event.summary, sortKey: to24h(event.time) || (event.allDay ? '00:00' : '99:99') });
  }
  for (const session of (day.fitness || [])) {
    let timeStr = ''; let sortKey = '99:99';
    if (session.sessionId && session.sessionId.length >= 12) {
      const hh = parseInt(session.sessionId.slice(8, 10), 10);
      const mm = session.sessionId.slice(10, 12);
      const ampm = hh >= 12 ? 'PM' : 'AM';
      const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
      timeStr = `${h12}:${mm} ${ampm}`; sortKey = `${String(hh).padStart(2, '0')}:${mm}`;
    }
    const durationMin = session.durationMs ? Math.round(session.durationMs / 60000) : null;
    const title = session.media?.primary?.showTitle || session.media?.primary?.title || 'Workout';
    items.push({ type: 'fitness', time: timeStr, label: `${title}${durationMin ? ` (${durationMin} min)` : ''}`, sortKey, participants: session.participants });
  }
  for (const session of (day.sessions || [])) {
    items.push({ type: 'photo', time: session.timeRange || '', label: plural(session.count, 'photo'), sortKey: to24h(session.timeRange?.split(' – ')[0]) || '99:99' });
  }
  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return items;
}

export default function DayContextPanel({ day, open }) {
  // Hooks must run unconditionally — compute before any early return.
  const timeline = useMemo(() => (day ? buildTimeline(day) : []), [day]);
  const allPeople = useMemo(() => {
    const set = new Set();
    for (const photo of (day?.photos || [])) for (const p of (photo.people || [])) set.add(p);
    return [...set];
  }, [day]);

  if (!open || !day) return null;

  const weather = day.weather;
  const videoCount = day.photos?.filter(p => p.type === 'video').length || 0;
  const imageCount = (day.photoCount || 0) - videoCount;

  return (
    <div className="weekly-review-context-panel" role="dialog" aria-modal="true" aria-label="Day details">
      <div className="context-panel-inner">
        {weather && (
          <div className="context-section">
            <h3 className="context-section-title">Weather</h3>
            <div className="context-weather">
              <span className="weather-icon-lg">{WMO_ICONS[weather.code] || '🌡'}</span>
              <span className="weather-temps">{cToF(weather.high)}° / {cToF(weather.low)}°</span>
              <span className="weather-desc">{WMO_DESC[weather.code] || ''}</span>
              {weather.precip > 0 && <span className="weather-detail">Precip: {weather.precip.toFixed(1)}mm</span>}
            </div>
          </div>
        )}
        {timeline.length > 0 && (
          <div className="context-section">
            <h3 className="context-section-title">Timeline</h3>
            <div className="context-timeline">
              {timeline.map((item, i) => (
                <div key={i} className={`timeline-item timeline-item--${item.type}`}>
                  <span className="timeline-time">{item.time}{item.endTime ? ` – ${item.endTime}` : ''}</span>
                  <span className="timeline-label">{item.label}</span>
                  {item.participants && Object.keys(item.participants).length > 0 && (
                    <span className="timeline-people">{Object.values(item.participants).map(p => p.displayName).join(', ')}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {allPeople.length > 0 && (
          <div className="context-section">
            <h3 className="context-section-title">People</h3>
            <div className="context-people">{allPeople.map(p => <span key={p} className="person-tag">{p}</span>)}</div>
          </div>
        )}
        <div className="context-section">
          <h3 className="context-section-title">Summary</h3>
          <div className="context-stats">
            {imageCount > 0 && <span className="stat">{plural(imageCount, 'photo')}</span>}
            {videoCount > 0 && <span className="stat">{plural(videoCount, 'video')}</span>}
            {(day.calendar?.length || 0) > 0 && <span className="stat">{plural(day.calendar.length, 'event')}</span>}
            {(day.fitness?.length || 0) > 0 && <span className="stat">{plural(day.fitness.length, 'workout')}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npx vitest run frontend/src/modules/WeeklyReview/components/DayContextPanel.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/WeeklyReview/components/DayContextPanel.jsx frontend/src/modules/WeeklyReview/components/DayContextPanel.test.jsx
git commit -m "feat(weekly-review): add on-demand DayContextPanel (timeline/weather/people/stats)"
```

---

## Task 5: Create DayReel (fullscreen item + inline video playback)

**Files:**
- Create: `frontend/src/modules/WeeklyReview/components/DayReel.jsx`
- Create: `frontend/src/modules/WeeklyReview/components/DayReel.test.jsx`

The reel renders the single focused media item. Photos reuse `FullscreenImage`. Videos show a poster + `▶ Enter` hint when not playing, and an inline `<video>` element when playing (muted state driven by props; pauses when `paused` is true so the context panel can suspend it).

- [ ] **Step 1: Write the render test**

```jsx
// frontend/src/modules/WeeklyReview/components/DayReel.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import DayReel from './DayReel.jsx';

const photo = { id: 'p1', type: 'image', original: '/o.jpg', thumbnail: '/t.jpg', takenAt: '2026-04-21T14:30:00Z', people: ['Mara'] };
const video = { id: 'v1', type: 'video', original: '/v.mp4', thumbnail: '/vt.jpg', takenAt: '2026-04-21T15:00:00Z', people: [] };
const dayLabel = 'Tuesday, April 21';

describe('DayReel', () => {
  it('shows a fullscreen photo with index indicator', () => {
    render(<DayReel item={photo} index={0} total={3} dayLabel={dayLabel} playing={false} muted paused={false} />);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText(dayLabel)).toBeInTheDocument();
  });

  it('shows a play hint on a video poster when not playing', () => {
    render(<DayReel item={video} index={1} total={3} dayLabel={dayLabel} playing={false} muted paused={false} />);
    expect(screen.getByText(/Enter/)).toBeInTheDocument();
  });

  it('renders a video element when playing', () => {
    const { container } = render(<DayReel item={video} index={1} total={3} dayLabel={dayLabel} playing={true} muted paused={false} onEnded={() => {}} />);
    expect(container.querySelector('video')).not.toBeNull();
  });

  it('renders an empty state when there is no item', () => {
    render(<DayReel item={null} index={0} total={0} dayLabel={dayLabel} playing={false} muted paused={false} />);
    expect(screen.getByText(/No photos or videos/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npx vitest run frontend/src/modules/WeeklyReview/components/DayReel.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reel**

```jsx
// frontend/src/modules/WeeklyReview/components/DayReel.jsx
import React, { useEffect, useRef } from 'react';
import FullscreenImage from './FullscreenImage.jsx';
import getLogger from '@/lib/logging/Logger.js';

const logger = getLogger().child({ component: 'weekly-review-reel' });

function ReelVideo({ item, muted, paused, onEnded }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onErr = () => logger.error('reel.video-error', { error: el.error?.message || 'unknown' });
    const onEnd = () => { logger.info('reel.video-ended'); onEnded?.(); };
    el.addEventListener('error', onErr);
    el.addEventListener('ended', onEnd);
    return () => { el.removeEventListener('error', onErr); el.removeEventListener('ended', onEnd); };
  }, [onEnded]);

  useEffect(() => { if (ref.current) ref.current.muted = muted; }, [muted]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (paused) el.pause();
    else el.play().catch(err => logger.warn('reel.play-rejected', { error: err.message }));
  }, [paused]);

  return (
    <video
      ref={ref}
      src={item.original}
      className="reel-video"
      autoPlay
      playsInline
      muted={muted}
    />
  );
}

export default function DayReel({ item, index, total, dayLabel, playing, muted, paused, onEnded }) {
  if (!item) {
    return (
      <div className="weekly-review-reel weekly-review-reel--empty">
        <div className="reel-empty">No photos or videos this day</div>
        <div className="reel-day-label">{dayLabel}</div>
      </div>
    );
  }

  if (item.type === 'video') {
    return (
      <div className="weekly-review-reel weekly-review-reel--video">
        {playing ? (
          <ReelVideo item={item} muted={muted} paused={paused} onEnded={onEnded} />
        ) : (
          <div className="reel-video-poster" style={{ backgroundImage: `url(${item.thumbnail})` }}>
            <div className="reel-play-hint">▶ Enter to play</div>
          </div>
        )}
        <div className="reel-overlay">
          <div className="reel-day-label">{dayLabel}</div>
          <div className="reel-index">{index + 1} / {total}</div>
          {playing && <div className="reel-mute-state">{muted ? '🔇 Enter to unmute' : '🔊'}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="weekly-review-reel weekly-review-reel--photo">
      <FullscreenImage photo={item} index={index} total={total} dayLabel={dayLabel} />
    </div>
  );
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npx vitest run frontend/src/modules/WeeklyReview/components/DayReel.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/WeeklyReview/components/DayReel.jsx frontend/src/modules/WeeklyReview/components/DayReel.test.jsx
git commit -m "feat(weekly-review): add DayReel fullscreen media + inline video playback"
```

---

## Task 6: Make the RecordingBar ambient (non-focusable)

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx`

The bar is no longer a navigable focus row. Remove the focus class and the focusable Save button; keep all status (week label, mic indicator, timer, VU meter, sync badge).

- [ ] **Step 1: Remove the `isFocused`/`canSave`/`onSave` props and the Save button**

In `RecordingBar.jsx`, delete `isFocused`, `canSave`, `onSave` from the destructured props (lines 9–25 region). Then replace the `<button className="recording-bar__save" …>…</button>` block (lines ~93–101) with nothing (delete it). The bar now ends after the `uploading` status span.

- [ ] **Step 2: Verify the module still imports cleanly via the suite (no dedicated test exists)**

Run: `npx vitest run frontend/src/modules/WeeklyReview/`
Expected: PASS for existing WeeklyReview tests; no reference errors from RecordingBar. (If a stale import of removed props exists anywhere, fix it now — only `WeeklyReview.jsx` consumes this component, and Task 7 rewrites that consumer.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/WeeklyReview/components/RecordingBar.jsx
git commit -m "refactor(weekly-review): make RecordingBar ambient status only (remove focus/save button)"
```

---

## Task 7: Rewire WeeklyReview.jsx onto the keymap + two-level render

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`

**Keep verbatim** (these recording-pipeline pieces are unchanged): the imports of hooks/uploader/chunkDb; `sessionIdRef`; `useChunkUploader` wiring; `handleChunk`; `useAudioRecorder`; `preflightStatus`/`preflightStatusRef`; `onExitWidget`; `onSaveAndExit`; `onPreflightRetry`/`onPreflightExit`; all bootstrap/auto-start/recover/draft-recovery/pagehide effects; `finalizePriorDraft`; `modalTypeRef`; the pop-guard effect; `weekLabel`; loading/error returns. Only **three** things change: the imports of view/components, the keyboard `useEffect`, and the returned JSX.

- [ ] **Step 1: Swap component + reducer imports**

Replace the component imports (top of file) so they read:

```js
import DayColumn from './components/DayColumn.jsx';
import DayReel from './components/DayReel.jsx';
import DayContextPanel from './components/DayContextPanel.jsx';
import PreFlightOverlay from './components/PreFlightOverlay.jsx';
import RecordingBar from './components/RecordingBar.jsx';
import { resolveKey } from './state/keymap.js';
```

(Delete the `DayDetail` and `FullscreenImage` imports — the reel owns both now. Keep the `useAudioRecorder`, `useChunkUploader`, `chunkDb`, `modalReducer`, `viewReducer` imports.)

- [ ] **Step 2: Add the media-context helper and the double-tap edge ref**

Immediately after the `view`/`dispatchView` reducer line, add:

```js
// Most-recent-8-day grid is 4 columns wide.
const GRID_COLS = 4;
const DOUBLE_EDGE_WINDOW_MS = 500;
const lastEdgeRef = useRef(null); // { dir, at } for double-tap cross-day

// Derive everything the keymap needs about the focused media item.
const mediaCtx = useMemo(() => {
  const days = data?.days || [];
  const day = days[view.dayIndex];
  const items = day?.photos || [];
  const itemCount = items.length;
  const cur = items[view.itemIndex];
  const currentType = !cur ? 'none' : (cur.type === 'video' ? 'video' : 'photo');
  const prevDayIndex = view.dayIndex - 1;
  const nextDayIndex = view.dayIndex + 1;
  const hasPrevDay = prevDayIndex >= 0;
  const hasNextDay = nextDayIndex < days.length;
  const prevDayLastIndex = hasPrevDay ? Math.max(0, (days[prevDayIndex]?.photos?.length || 1) - 1) : 0;
  return {
    itemCount, currentType,
    atFirst: view.itemIndex <= 0,
    atLast: view.itemIndex >= itemCount - 1,
    hasPrevDay, hasNextDay, prevDayIndex, nextDayIndex, prevDayLastIndex,
  };
}, [data, view.dayIndex, view.itemIndex]);
```

- [ ] **Step 3: Replace the entire keyboard `useEffect` with the keymap-driven handler**

Replace the existing `// 4-level keyboard navigation hierarchy` effect (the large `handleKeyDown` block) with:

```js
useEffect(() => {
  const handleKeyDown = (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!data?.days) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();

    const result = resolveKey({
      view,
      modalType: modal.type,
      modalFocus: modal.focusIndex,
      preflight: preflightStatusRef.current,
      key: e.key,
      now: Date.now(),
      cols: GRID_COLS,
      totalDays: data.days.length,
      media: mediaCtx,
      lastEdge: lastEdgeRef.current,
      doubleWindowMs: DOUBLE_EDGE_WINDOW_MS,
    });

    lastEdgeRef.current = result.edge; // null clears it; {dir,at} arms the next tap
    result.view.forEach(a => dispatchView(a));
    result.modal.forEach(a => dispatchModal(a));
    for (const intent of result.intents) {
      if (intent === 'saveAndExit') onSaveAndExit();
      else if (intent === 'exitWidget' || intent === 'exitNoSave') onExitWidget();
      else if (intent === 'retryMic') onPreflightRetry();
      else if (intent === 'finalizeDraft') finalizePriorDraft();
    }
  };

  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [data, view, modal, mediaCtx,
    finalizePriorDraft, onExitWidget, onSaveAndExit, onPreflightRetry]);
```

- [ ] **Step 4: Update the bootstrap dispatch to the new action**

In the bootstrap effect, change the post-fetch dispatch from `dispatchView({ type: 'SELECT_DAY', index: 0, totalDays: result.days?.length })` to focus the most recent day:

```js
dispatchView({ type: 'SELECT_DAY', dayIndex: Math.max(0, (result.days?.length || 1) - 1) });
```

- [ ] **Step 5: Update the pop-guard to the two-level model**

In the pop-guard effect, replace the inner guard body so it climbs/exits with the new model:

```js
menuNav.setPopGuard(() => {
  logger.info('nav.pop-guard', { isRecording: isRecordingRef.current, viewLevel: viewLevelRef.current, modalType: modalTypeRef.current });
  if (modalTypeRef.current === 'exitGate') { dispatchModal({ type: 'CLOSE' }); return false; }
  if (viewLevelRef.current === 'reel') { dispatchView({ type: 'CLIMB' }); return false; }
  dispatchModal({ type: 'OPEN', modal: 'exitGate' });
  return false;
});
```

- [ ] **Step 6: Replace the returned JSX render tree**

Replace everything from the first `return (` of the component's main render (the `<div className="weekly-review">` block) down to its closing, with:

```jsx
return (
  <div className="weekly-review">
    {/* Resume-draft overlay */}
    {modal.type === 'resumeDraft' && !isRecording && (
      <div className="weekly-review-confirm-overlay">
        <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="wr-resume-label">
          <div className="confirm-message" id="wr-resume-label">
            A previous recording was not finalized.<br/>
            <small>{modal.payload?.source === 'server' ? `Server draft · ${Math.round((modal.payload?.totalBytes || 0) / 1024)} KB` : `Local-only draft · ${modal.payload?.chunkCount || 0} chunks`}</small>
          </div>
          <div className="confirm-actions">
            <button className="confirm-btn confirm-btn--save focused" onClick={finalizePriorDraft}>Finalize Previous</button>
          </div>
        </div>
      </div>
    )}

    {/* Two-level surface: reel over grid */}
    {view.level === 'reel' && data?.days?.[view.dayIndex] ? (() => {
      const day = data.days[view.dayIndex];
      const items = day.photos || [];
      const safeIdx = Math.min(view.itemIndex, Math.max(0, items.length - 1));
      const dt = new Date(`${day.date}T12:00:00Z`);
      const dayLabel = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      return (
        <>
          <DayReel
            item={items[safeIdx] || null}
            index={safeIdx}
            total={items.length}
            dayLabel={dayLabel}
            playing={view.playing}
            muted={view.muted}
            paused={view.contextOpen}
            onEnded={() => dispatchView({ type: 'STOP_VIDEO' })}
          />
          <DayContextPanel day={day} open={view.contextOpen} />
        </>
      );
    })() : (
      <div className="weekly-review-grid">
        {data.days.slice(-8).map((day, i) => {
          const offset = Math.max(0, data.days.length - 8);
          const realIndex = offset + i;
          return (
            <DayColumn
              key={day.date}
              day={day}
              isFocused={realIndex === view.dayIndex}
              onClick={() => dispatchView({ type: 'OPEN_DAY' })}
            />
          );
        })}
      </div>
    )}

    {/* Finalize-error dialog */}
    {modal.type === 'finalizeError' && !isRecording && (
      <div className="weekly-review-confirm-overlay">
        <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="wr-error-label">
          <div className="confirm-message" id="wr-error-label">
            Save failed: {modal.payload}<br/>
            <small>Your recording is safe — stored locally and on the server.</small>
          </div>
          <div className="confirm-actions">
            <button className={`confirm-btn confirm-btn--save${modal.focusIndex === 0 ? ' focused' : ''}`}>Dismiss</button>
            <button className={`confirm-btn confirm-btn--continue${modal.focusIndex === 1 ? ' focused' : ''}`}>Exit (save later)</button>
          </div>
        </div>
      </div>
    )}

    {/* Exit gate */}
    {modal.type === 'exitGate' && (
      <div className="weekly-review-confirm-overlay">
        <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="wr-exit-label">
          <div className="confirm-message" id="wr-exit-label">End weekly review recording?</div>
          <div className="confirm-actions">
            <button className={`confirm-btn confirm-btn--continue${modal.focusIndex === 0 ? ' focused' : ''}`}>Keep going</button>
            <button className={`confirm-btn confirm-btn--save${modal.focusIndex === 1 ? ' focused' : ''}`}>Save &amp; end</button>
          </div>
        </div>
      </div>
    )}

    {/* Disconnect modal */}
    {modal.type === 'disconnect' && (
      <div className="weekly-review-confirm-overlay">
        <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="wr-disc-label" aria-live="polite">
          <div className="confirm-message" id="wr-disc-label">
            {modal.payload?.phase === 'reconnecting' && (<>Microphone dropped — reconnecting…<br/><small>Please hold tight.</small></>)}
            {modal.payload?.phase === 'finalizing' && (<>Microphone disconnected.<br/><small>Saving your recording…</small></>)}
          </div>
        </div>
      </div>
    )}

    <PreFlightOverlay
      status={preflightStatus}
      focusIndex={modal.focusIndex}
      onRetry={onPreflightRetry}
      onExit={onExitWidget}
    />

    <RecordingBar
      weekLabel={weekLabel}
      isRecording={isRecording}
      duration={recordingDuration}
      micLevelRef={micLevelRef}
      silenceWarning={silenceWarning}
      uploading={uploading}
      micConnected={isRecording && !disconnected}
      existingRecording={data.recording}
      error={recorderError}
      syncStatus={uploaderStatus}
      pendingCount={uploaderPendingCount}
      lastAckedAt={uploaderLastAckedAt}
    />
  </div>
);
```

> Note: modal buttons here are driven by the remote (keymap), so the dialog `<button>`s are visual/focus indicators and don't need `onClick`. Mouse activation is out of scope for the Shield; the keymap is the sole driver.

- [ ] **Step 7: Run the full WeeklyReview test folder + a build check**

Run: `npx vitest run frontend/src/modules/WeeklyReview/`
Expected: PASS (reducers, keymap, components).

Run: `npx vite build --config frontend/vite.config.* 2>&1 | tail -5` *(if a frontend vite config path differs, use the repo's standard `npm run build`)*
Expected: build completes with no unresolved-import errors for WeeklyReview.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.jsx
git commit -m "feat(weekly-review): rewire onto keymap + two-level grid/reel render"
```

---

## Task 8: Delete the old DayDetail and confirm no dangling references

**Files:**
- Delete: `frontend/src/modules/WeeklyReview/components/DayDetail.jsx`

- [ ] **Step 1: Confirm nothing imports DayDetail anymore**

Run: `grep -rn "DayDetail" frontend/src/ tests/`
Expected: no matches (Task 7 removed the import). If any remain, fix them before deleting.

- [ ] **Step 2: Delete the file**

```bash
git rm frontend/src/modules/WeeklyReview/components/DayDetail.jsx
```

- [ ] **Step 3: Re-run the suite to confirm nothing broke**

Run: `npx vitest run frontend/src/modules/WeeklyReview/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(weekly-review): remove obsolete DayDetail screen (split into reel + context panel)"
```

---

## Task 9: Add the SCSS for the new surfaces

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.scss`

The new components reference classes that don't exist yet: `.weekly-review-reel`, `.reel-video`, `.reel-video-poster`, `.reel-play-hint`, `.reel-overlay`, `.reel-index`, `.reel-day-label`, `.reel-mute-state`, `.reel-empty`, `.weekly-review-context-panel`, `.context-panel-inner`, `.context-section`, `.context-section-title`, `.context-timeline`, `.context-people`, `.context-stats`, `.person-tag`, `.stat`.

- [ ] **Step 1: Append styles for the reel and context panel**

Add to the end of `WeeklyReview.scss`:

```scss
.weekly-review-reel {
  position: absolute; inset: 0; background: #000;
  display: flex; align-items: center; justify-content: center;

  .reel-video { width: 100%; height: 100%; object-fit: contain; background: #000; }

  .reel-video-poster {
    width: 100%; height: 100%;
    background-size: contain; background-position: center; background-repeat: no-repeat;
    display: flex; align-items: center; justify-content: center;
  }
  .reel-play-hint {
    font-size: 1.4rem; color: #fff; background: rgba(0,0,0,0.55);
    padding: 0.6em 1.1em; border-radius: 0.4em;
  }
  .reel-overlay {
    position: absolute; left: 0; right: 0; bottom: 0;
    display: flex; gap: 1.5rem; align-items: baseline;
    padding: 1rem 1.5rem; color: #fff;
    background: linear-gradient(to top, rgba(0,0,0,0.75), transparent);
    .reel-index { opacity: 0.8; }
    .reel-mute-state { margin-left: auto; opacity: 0.85; }
  }
  &--empty { flex-direction: column; gap: 1rem; color: #aaa; }
}

.weekly-review-context-panel {
  position: absolute; left: 0; right: 0; bottom: 0;
  max-height: 55%; overflow-y: auto;
  background: rgba(12, 14, 18, 0.96);
  border-top: 2px solid rgba(255,255,255,0.12);
  animation: wr-context-rise 160ms ease-out;
  color: #e8e8e8;

  .context-panel-inner { display: flex; flex-wrap: wrap; gap: 2rem; padding: 1.5rem 2rem; }
  .context-section-title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; margin: 0 0 0.5rem; }
  .context-timeline { display: flex; flex-direction: column; gap: 0.35rem; }
  .timeline-time { opacity: 0.7; margin-right: 0.6em; }
  .context-people, .context-stats { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .person-tag, .stat { background: rgba(255,255,255,0.08); border-radius: 0.3em; padding: 0.15em 0.55em; font-size: 0.9rem; }
}

@keyframes wr-context-rise { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
```

- [ ] **Step 2: Build to confirm SCSS compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: build succeeds (no SCSS syntax errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.scss
git commit -m "style(weekly-review): styles for day reel + context panel surfaces"
```

---

## Task 10: Update the reference doc to the new endstate

**Files:**
- Update: `docs/reference/life/weekly-review.md`

The reference doc currently describes the old three-level model. Rewrite its navigation/command sections to match the shipped two-level model so the reference stays endstate-accurate.

- [ ] **Step 1: Replace the navigation/command sections**

In `docs/reference/life/weekly-review.md`, replace the "Navigation Model" and per-level command tables with the two-level model and the input matrix from the spec (`docs/superpowers/specs/2026-05-31-weekly-review-journey-redesign.md` §4). Keep the doc's present-tense, endstate voice; do not mention component or file names in the body (a directory-pointer footer is fine). Update the "Where It Runs" and "Recording Bar" sections to note the bar is ambient (non-focusable) and that exit is reached from the grid via ↑-past-top / Back.

- [ ] **Step 2: Verify internal links still resolve**

Run: `grep -n "weekly-review\|life-domain" docs/reference/life/weekly-review.md`
Expected: the See-Also footer still points to `frontend/src/modules/WeeklyReview/` and `life-domain-architecture.md`.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/life/weekly-review.md
git commit -m "docs(weekly-review): update reference to two-level browsing model"
```

---

## Task 11: Full verification pass

- [ ] **Step 1: Run the whole module's tests**

Run: `npx vitest run frontend/src/modules/WeeklyReview/`
Expected: all reducer, keymap, and component tests PASS.

- [ ] **Step 2: Production build**

Run: `npm run build 2>&1 | tail -15`
Expected: clean build, no WeeklyReview import/SCSS errors.

- [ ] **Step 3: Manual smoke on the dev server (per CLAUDE.md dev workflow)**

Start the dev server if not running (`node backend/index.js` per CLAUDE.local.md), open `/app/weekly-review` (or the screen widget), and verify with a keyboard (arrows = D-pad, Enter, Escape = Back):
- Grid: arrows move focus; Enter opens a day; ↑ from top row and Esc raise "End review & save?".
- Reel: ←/→ step media and hard-stop at edges; double-→ at the end crosses to the next day; ↑/Esc return to the grid; ↓ opens the context panel; ↓/↑/Esc close it.
- Video: Enter plays muted, Enter again unmutes; ←/→ leave to adjacent items; video end returns to the poster.
- The recording bar shows live status and is never focusable.

- [ ] **Step 4: Confirm no stray references to removed symbols**

Run: `grep -rn "stopConfirm\|DayDetail\|focusRow\|makeInitialView\|viewLevel === 'fullscreen'" frontend/src/modules/WeeklyReview/`
Expected: no matches (all replaced). `viewLevelRef` (the pop-guard ref) is fine; the search targets the old string literals.

- [ ] **Step 5: Final commit (if the manual pass required tweaks)**

```bash
git add -A frontend/src/modules/WeeklyReview/
git commit -m "test(weekly-review): verification pass for journey redesign"
```

---

## Self-review notes (verified during planning)

- **Spec coverage:** Every state in spec §4 maps to a keymap block in Task 2 (grid, photo, empty day, video poster, video playing, context panel, exit gate, preflight acquiring/failed, disconnect, resume-draft, finalize-error). The two-level model (§2) is Task 1; ambient bar (§3) is Task 6; "what changes" (§6) is realized across Tasks 1, 6, 7, 8.
- **Type consistency:** Action names are identical across reducer (Task 1), keymap (Task 2), and wiring (Task 7): `GRID_MOVE/OPEN_DAY/CROSS_DAY/STEP_ITEM/CLIMB/OPEN_CONTEXT/CLOSE_CONTEXT/PLAY_VIDEO/TOGGLE_MUTE/STOP_VIDEO/SELECT_DAY`. Modal type `exitGate` is consistent across Tasks 2, 3, 7. Intent strings (`saveAndExit/exitWidget/exitNoSave/retryMic/finalizeDraft`) match between keymap and the Task 7 intent dispatcher.
- **Carried-over code:** Task 7 explicitly preserves the recording pipeline and lists exactly the three changed regions.
- **Known follow-ups (deferred per spec §7):** video seeking, timeline→media jump, grid day-ordering. Not in scope.
```
