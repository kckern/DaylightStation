# Piano Chess Pick-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Piano Chess playable. A live session on 2026-08-12 completed zero moves in eight minutes: the double-play that was supposed to pick a piece up instead selected and immediately deselected it, and a held piece showed nothing about where it could go.

**Why this plan exists in this shape:** the previous wave removed the automatic reveal of legal destinations on principle, and the replacement — destinations labelled with the chord that reaches them — was specced but never built. Half a design shipped. Every task below is either that missing half or something the same session exposed.

**Architecture:** A pure selection machine sits between the chord cursor and the game state. `advanceCursor` is untouched — it already emits exactly the events needed. The component stops calling `applySquare` on every commit and routes commits through the machine instead, which decides hover, pick-up, drop or refuse. Two presentation changes follow: marching ants on the held square, and a corner badge naming the chord that reaches each eligible square.

**Tech Stack:** React 18, Vitest, SCSS, the existing `chordAddress` addresser and `chessGameState` reducer.

**Design spec:** `docs/superpowers/specs/2026-08-12-piano-chess-pickup-design.md`

## Global Constraints

- Frontend `.jsx`/`.js`; colocated tests; `npx vitest run <path>`.
- Never raw `console.*` — the frontend logging framework only.
- **Nothing may size itself off `vh` or `vw`.** `PianoDesignScale` lays the kiosk out at a fixed design size and scales the whole canvas, so viewport units measure the physical screen while the layout only ever gets the design box. Use container-query units or rem.
- **The double window is 800ms, measured from the first chord's RELEASE to the moment the second chord is RECOGNISED** — not to its release. A player who holds the second chord to study the board must never silently fail the double.
- **The piece lifts while the second chord is still held**, so the release that follows must be swallowed — otherwise it registers as a third hover on the square the piece just left.
- **Hovering an ineligible square while holding a piece is silent.** Refusals shrink to genuinely wrong acts: double-playing an empty square or an opponent's piece.
- The octave "put it back" gesture must keep working unchanged at every stage. It is the visible escape.
- Animate `background-position`, never `filter` — an animated filter is a known paint-cost trap on the 2018 tablet. Honour `prefers-reduced-motion`.
- **No test may be written that cannot fail.** This project has repeatedly shipped tests that could not — one asserting on a React warning that no longer exists, one using a FEN lacking the piece it named, one property test that stayed green when its bug was reintroduced. Prove each new test red-before / green-after by running it, and report observed output rather than a prediction.

## File Structure

| File | Responsibility |
|---|---|
| `PianoChessGame/chordSelection.js` (new) | Pure: previous selection state + a commit → next state and one action |
| `PianoChessGame/PianoChessGame.jsx` | Routes commits through the machine instead of straight to `applySquare` |
| `PianoChessGame/chessBadges.js` (new) | Pure: game + scheme → `{ [square]: chordSymbol }` for eligible squares |
| `Chess/ChessBoard.jsx` | Renders `heldSquare` ants and `squareLabels` badges |
| `Chess/ChessBoard.scss` | Ants keyframes, badge styling, reduced-motion fallback |
| `PianoChessGame/ChessSettingsPanel.jsx` | Fourth control: destination labels on/off |
| `PianoChessGame/chessCues.js` | Carries `showDestinationLabels` from config |

---

### Task 1: The selection machine

**Files:**
- Create: `frontend/src/modules/Piano/PianoChessGame/chordSelection.js`
- Test: `frontend/src/modules/Piano/PianoChessGame/chordSelection.test.js`

**Interfaces:**
- Consumes: nothing. Pure module, no imports from the game state.
- Produces: `createSelection()` → `{ lastSquare: null, lastAt: 0, swallowNextCommit: false }`.
  `applyEvent(selection, { type, square, at, holdingPiece, isEligible })` → `{ selection, action }`.
  `type` is `'preview'` or `'commit'`. `action` is one of `{ type: 'none' }`,
  `{ type: 'hover', square }`, `{ type: 'pickup', square }`, `{ type: 'drop', square }`,
  `{ type: 'refuse', square }`, `{ type: 'swallowed' }`.
  `DOUBLE_WINDOW_MS = 800`.

**The machine sees BOTH cursor events, and this is the crux of the design.** `advanceCursor` emits
`preview` when a chord is recognised — while the fingers are still down — and `commit` when it is
released. The window runs from the first chord's **release** to the second chord's **recognition**,
so:

- A `commit` records the square and the release time, and produces the hover, drop or refusal.
- A `preview` matching that square inside the window produces the **pick-up** — which is why the
  piece lifts under the player's fingers, and why the release that follows must be swallowed.

Firing pick-up on the release instead would mean a player who holds the second chord to study the
board waits with nothing happening, and would make the swallow unnecessary — a different, worse feel
than the one specified.

The caller supplies `holdingPiece` (whether a piece is already in hand) and `isEligible` (whether
this square is a legal destination for it). The machine itself knows nothing about chess.

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, expect, it } from 'vitest';
import { applyEvent, createSelection, DOUBLE_WINDOW_MS } from './chordSelection.js';

const ev = (sel, type, square, at, extra = {}) =>
  applyEvent(sel, { type, square, at, holdingPiece: false, isEligible: false, ...extra });

/** One complete play: recognised at `at`, released 100ms later. */
const play = (sel, square, at, extra = {}) => {
  const preview = ev(sel, 'preview', square, at, extra);
  if (preview.action.type === 'pickup') return preview;      // lifts under the fingers
  return ev(preview.selection, 'commit', square, at + 100, extra);
};

describe('with no piece in hand', () => {
  it('treats a single chord as a hover, committing nothing', () => {
    expect(play(createSelection(), 'e4', 1000).action).toEqual({ type: 'hover', square: 'e4' });
  });

  it('a preview alone does nothing until it is released', () => {
    expect(ev(createSelection(), 'preview', 'e4', 1000).action).toEqual({ type: 'none' });
  });

  it('picks the piece up when the same square is RECOGNISED again inside the window', () => {
    const first = play(createSelection(), 'e4', 1000);        // released at 1100
    const second = ev(first.selection, 'preview', 'e4', 1100 + DOUBLE_WINDOW_MS - 1);
    expect(second.action).toEqual({ type: 'pickup', square: 'e4' });
  });

  it('does not pick up when the second recognition is outside the window', () => {
    const first = play(createSelection(), 'e4', 1000);
    const second = ev(first.selection, 'preview', 'e4', 1100 + DOUBLE_WINDOW_MS + 1);
    expect(second.action).toEqual({ type: 'none' });
  });

  it('resets when a different square is played in between', () => {
    let s = play(createSelection(), 'e4', 1000).selection;
    s = play(s, 'd4', 1300).selection;
    const back = ev(s, 'preview', 'e4', 1500);
    expect(back.action).toEqual({ type: 'none' });
  });

  it('swallows the release that follows a pick-up, so it is not a third hover', () => {
    const first = play(createSelection(), 'e4', 1000);
    const pick = ev(first.selection, 'preview', 'e4', 1400);
    expect(pick.action.type).toBe('pickup');
    const release = ev(pick.selection, 'commit', 'e4', 1600);
    expect(release.action).toEqual({ type: 'swallowed' });
  });

  it('is ready for a normal hover after the swallowed release', () => {
    let s = play(createSelection(), 'e4', 1000).selection;
    s = ev(s, 'preview', 'e4', 1400).selection;   // pickup
    s = ev(s, 'commit', 'e4', 1600).selection;    // swallowed
    expect(play(s, 'd4', 1800).action).toEqual({ type: 'hover', square: 'd4' });
  });
});

describe('with a piece in hand', () => {
  const held = { holdingPiece: true };

  it('drops on a single play when the square is eligible', () => {
    expect(play(createSelection(), 'e5', 1000, { ...held, isEligible: true }).action)
      .toEqual({ type: 'drop', square: 'e5' });
  });

  it('only hovers an ineligible square — exploring is never punished', () => {
    expect(play(createSelection(), 'h8', 1000, held).action).toEqual({ type: 'hover', square: 'h8' });
  });

  it('never picks up while already holding, however fast the repeat', () => {
    const first = play(createSelection(), 'h8', 1000, held);
    const second = ev(first.selection, 'preview', 'h8', 1150, held);
    expect(second.action.type).not.toBe('pickup');
  });
});

describe('an unrecognised chord', () => {
  it('is refused when choosing a piece', () => {
    expect(play(createSelection(), null, 1000).action).toEqual({ type: 'refuse', square: null });
  });

  it('is silent while a piece is in hand', () => {
    expect(play(createSelection(), null, 1000, { holdingPiece: true }).action)
      .toEqual({ type: 'hover', square: null });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/chordSelection.test.js`
Expected: FAIL — cannot resolve `./chordSelection.js`.

- [ ] **Step 3: Implement**

```javascript
/**
 * Naming a square and committing to it are different acts.
 *
 * In a game where every square is a chord, a player has to be able to try a
 * chord and see where it lands. So one play HOVERS — it lights the square and
 * commits nothing — and the same square played twice in a row picks the piece
 * up. Dropping needs only one play, because a held piece can reach a handful of
 * lit, labelled squares and intent is already declared.
 *
 * This module knows nothing about chess: the caller says whether a piece is in
 * hand and whether the square is a legal destination.
 */

/** How long after the first release the second chord may be RECOGNISED. */
export const DOUBLE_WINDOW_MS = 800;

export function createSelection() {
  return { lastSquare: null, lastAt: 0, swallowNextCommit: false };
}

export function applyEvent(selection, { type, square, at, holdingPiece = false, isEligible = false }) {
  if (type === 'preview') {
    // The pick-up fires HERE, on recognition, so the piece lifts under the
    // fingers that named it. The window runs from the previous chord's release
    // to this moment: a repeat needs no new fingering, and a player who then
    // holds this chord to study the board must not silently fail the double.
    if (holdingPiece || !square) return { selection, action: { type: 'none' } };
    const isDouble = selection.lastSquare === square && at - selection.lastAt <= DOUBLE_WINDOW_MS;
    if (!isDouble) return { selection, action: { type: 'none' } };
    return {
      selection: { ...createSelection(), swallowNextCommit: true },
      action: { type: 'pickup', square },
    };
  }

  // The release of the chord that just lifted a piece. It must not read as a
  // third hover on the square the piece has left.
  if (selection.swallowNextCommit) {
    return { selection: createSelection(), action: { type: 'swallowed' } };
  }

  // An unrecognised chord is worth saying out loud when the player is choosing
  // a piece — but not while they explore with one already in hand.
  if (!square) {
    return {
      selection: createSelection(),
      action: holdingPiece ? { type: 'hover', square: null } : { type: 'refuse', square: null },
    };
  }

  if (holdingPiece) {
    if (isEligible) return { selection: createSelection(), action: { type: 'drop', square } };
    // Exploring is never punished: an unlit, unlabelled square already says no.
    return { selection: createSelection(), action: { type: 'hover', square } };
  }

  // Remember this release: the next recognition of the same square is a pick-up.
  return {
    selection: { ...createSelection(), lastSquare: square, lastAt: at },
    action: { type: 'hover', square },
  };
}

export default { createSelection, applyEvent, DOUBLE_WINDOW_MS };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/chordSelection.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Prove the window is real**

Change `DOUBLE_WINDOW_MS` to `2000`, re-run, and confirm the "outside the window" test goes RED.
Restore it, re-run, confirm green. Paste both outputs into the report. A window test that passes at
any duration is worse than none.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/chordSelection.js frontend/src/modules/Piano/PianoChessGame/chordSelection.test.js
git commit -m "feat(chess): hover, pick up, drop as a pure selection machine"
```

---

### Task 2: Route the screen through the machine

**Files:**
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx`
- Test: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.test.jsx` (extend)

**Interfaces:**
- Consumes: `createSelection()`, `applyEvent(selection, { type, square, at, holdingPiece, isEligible })`,
  `DOUBLE_WINDOW_MS` from `./chordSelection.js` (Task 1). `type` is `'preview'` or `'commit'`.
- Produces: the board receives a new `heldSquare` prop (`game.origin`, or null) — Task 3 renders it.

- [ ] **Step 1: Write the failing tests**

Append to `PianoChessGame.test.jsx`, following the file's existing mocking of
`../PianoKiosk/PianoMidiContext.jsx` and `./chessApi.js`:

```javascript
describe('hover before commit', () => {
  it('does not pick a piece up on a single chord', async () => {
    const { container } = render(<PianoChessGame />);
    await playChordOnce(container, 'a pawn square');   // helper below
    expect(container.querySelectorAll('.chess-board__square--held')).toHaveLength(0);
  });

  it('picks it up when the same square is played twice inside the window', async () => {
    const { container } = render(<PianoChessGame />);
    await playChordTwice(container);
    expect(container.querySelectorAll('.chess-board__square--held')).toHaveLength(1);
  });

  it('never refuses while exploring with a piece in hand', async () => {
    const { container } = render(<PianoChessGame />);
    await playChordTwice(container);                    // now holding
    await playIneligibleSquare(container);
    expect(container.querySelectorAll('.chess-board__square--rejected')).toHaveLength(0);
  });
});
```

The helpers drive the mocked MIDI context and fake timers, exactly as `helpValidity.test.jsx`
already does. Put them at the top of the describe block:

```javascript
// The mocked context is already set up in this file; these mirror helpValidity.test.jsx.
const holdNotes = (notes) => mockUsePianoMidiNotes.mockReturnValue({
  activeNotes: new Map(notes.map((n) => [n, { velocity: 80 }])),
  noteHistory: [],
});

/** Play one chord: hold past the 140ms settle, then release. */
const playChord = async (rerender, notes) => {
  holdNotes(notes);
  rerender(<PianoChessGame />);
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  holdNotes([]);
  rerender(<PianoChessGame />);
  await act(async () => { await vi.advanceTimersByTimeAsync(120); });
};
```

Choose the notes by asking the board, not by guessing: `squareToChord(square, DEFAULT_CHORD_SCHEME)`
gives the chord for a square, and the test file already imports both. Pick a square holding one of
White's pieces that has legal moves in the opening position, derive its notes, and use those. State
in your report which square you used and why.

Between the two plays of a double, advance the clock by less than `DOUBLE_WINDOW_MS`; for the
outside-the-window case, advance by more. Both cases belong in the tests.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/PianoChessGame.test.jsx`
Expected: FAIL — a single chord currently picks the piece up, so test one fails; `--held` does not
exist yet, so test two fails.

- [ ] **Step 3: Route commits through the machine**

In `PianoChessGame.jsx`, hold the selection in a ref beside the existing cursor ref:

```javascript
const selectionRef = useRef(createSelection());
```

The cursor tick currently ends with (around line 374):

```javascript
if (event.type === 'commit') {
  if (!wasGesture && !(latched && !event.square)) handleSquare(event.square);
}
```

Replace the inner call. Keep the gesture latch exactly as it is — it solves a different problem
(a staggered cluster release) and both guards are needed:

```javascript
// Both cursor events feed the machine: the pick-up fires on recognition, the
// rest on release.
if (event.type === 'preview' || event.type === 'commit') {
  if (wasGesture || (latched && !event.square)) return;
  const current = gameRef.current;
  const holdingPiece = Boolean(current.origin);
  const isEligible = holdingPiece && destinationsFor(current, current.origin).includes(event.square);
  const { selection, action } = applyEvent(selectionRef.current, {
    type: event.type, square: event.square, at: Date.now(), holdingPiece, isEligible,
  });
  selectionRef.current = selection;
  if (action.type === 'hover') setCursor(action.square);
  if (action.type === 'pickup' || action.type === 'drop') handleSquare(action.square);
  if (action.type === 'refuse') handleSquare(null);
  // 'none' and 'swallowed' do nothing, deliberately.
}
```

The existing `preview` handling that sets the cursor square stays — the machine's `'none'` action
means "no selection change", not "draw nothing". Keep whatever the tick already does to light the
previewed square while a chord is held, and let the machine own only the selection decision.

`handleSquare` still routes to `applySquare`, which picks up when there is no origin and drops when
there is — so pick-up and drop both go through the existing reducer unchanged.

**Reset the selection whenever the board changes underneath it:** add
`selectionRef.current = createSelection();` to `restart()` and to the effect that clears help on
`game.history.length`. A hover from before the opponent moved must not combine with one after it.

Pass `heldSquare={game.origin}` to `<ChessBoard>`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/`
Expected: PASS. If an existing test assumed a single chord commits, update it to the new model and
say so in the report — do not weaken it.

- [ ] **Step 5: Prove the wiring**

Break the machine's route (call `handleSquare(event.square)` directly again), run, confirm the
hover test goes RED, restore, confirm green. Paste both.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/
git commit -m "feat(chess): a chord hovers; the same chord twice picks the piece up"
```

---

### Task 3: Marching ants on the held square

**Files:**
- Modify: `frontend/src/modules/Chess/ChessBoard.jsx`
- Modify: `frontend/src/modules/Chess/ChessBoard.scss`
- Test: `frontend/src/modules/Chess/ChessBoard.test.jsx` (extend)

**Interfaces:**
- Consumes: `heldSquare` passed by Task 2.
- Produces: `ChessBoard` accepts `heldSquare={string|null}` and puts
  `chess-board__square--held` on it.

- [ ] **Step 1: Write the failing test**

```javascript
describe('the piece in hand', () => {
  it('marks the held square and only that square', () => {
    const { container } = render(<ChessBoard fen={START} heldSquare="e2" />);
    const held = container.querySelectorAll('.chess-board__square--held');
    expect(held).toHaveLength(1);
    expect(held[0].closest('[data-square]').dataset.square).toBe('e2');
  });

  it('marks nothing when no piece is in hand', () => {
    const { container } = render(<ChessBoard fen={START} heldSquare={null} />);
    expect(container.querySelectorAll('.chess-board__square--held')).toHaveLength(0);
  });
});
```

`START` is already defined in this file.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Chess/ChessBoard.test.jsx`
Expected: FAIL — no `--held` class exists.

- [ ] **Step 3: Implement**

Accept `heldSquare = null` and add to the square's class list, in the outline channel's group:

```jsx
heldSquare === square && 'chess-board__square--held',
```

In `ChessBoard.scss`, add the ants. They belong to the **outline** channel — a solid outline still
means the last move, and the crawl means "this one is in the air":

```scss
/* The piece in hand. An animated variant of the outline channel rather than a
   fifth visual language. background-position is animated deliberately: an
   animated filter is a paint-cost trap on the kiosk's 2018 tablet. */
.chess-board__square--held::before {
  content: '';
  position: absolute;
  inset: 3px;
  pointer-events: none;
  border-radius: 2px;
  background:
    repeating-linear-gradient(90deg, var(--cb-accent-glow) 0 7px, transparent 7px 14px) top / 100% 2px no-repeat,
    repeating-linear-gradient(90deg, var(--cb-accent-glow) 0 7px, transparent 7px 14px) bottom / 100% 2px no-repeat,
    repeating-linear-gradient(0deg, var(--cb-accent-glow) 0 7px, transparent 7px 14px) left / 2px 100% no-repeat,
    repeating-linear-gradient(0deg, var(--cb-accent-glow) 0 7px, transparent 7px 14px) right / 2px 100% no-repeat;
  animation: chess-board-ants 0.55s linear infinite;
}

@keyframes chess-board-ants {
  to {
    background-position: top 0 left 14px, bottom 0 left 14px, left 0 top 14px, right 0 top 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chess-board__square--held::before { animation: none; background: none; outline: 3px solid var(--cb-accent-glow); outline-offset: -3px; }
}
```

**Check `--best` first.** It already uses `::before` on the square. If a held square could also carry
`--best`, one of them will not render — an element has one `::before`. Verify whether that
combination is reachable; if it is, move the ants to a child element rather than a pseudo-element
and say so in the report. Do not leave two rules fighting over one pseudo-element: that exact defect
was found and fixed on this board a day ago.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/src/modules/Chess/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Chess/
git commit -m "feat(chess): marching ants on the square whose piece is in hand"
```

---

### Task 4: Corner-badge chord labels

**Files:**
- Create: `frontend/src/modules/Piano/PianoChessGame/chessBadges.js`
- Test: `frontend/src/modules/Piano/PianoChessGame/chessBadges.test.js`
- Modify: `frontend/src/modules/Chess/ChessBoard.jsx`, `frontend/src/modules/Chess/ChessBoard.scss`
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx`
- Modify: `frontend/src/modules/Piano/PianoChessGame/chessCues.js`
- Modify: `frontend/src/modules/Piano/PianoChessGame/ChessSettingsPanel.jsx`
- Test: the two existing test files for the modified modules

**Interfaces:**
- Consumes: `squareToChord(square, scheme)` from `./chordAddress.js`, which returns `{ symbol }` or
  null; `destinationsFor(state, square)` from `./chessGameState.js`; `cuesFromConfig(config)` from
  `./chessCues.js`, currently returning `{ flashRejected, toast }`.
- Produces: `destinationBadges(game, scheme)` → `{ [square]: symbol }`, empty when no piece is held.
  `ChessBoard` accepts `squareLabels={{[square]: string}}`. `cuesFromConfig` gains
  `showDestinationLabels` (default **true**).

- [ ] **Step 1: Write the failing badge test**

```javascript
import { describe, expect, it } from 'vitest';
import { DEFAULT_CHORD_SCHEME } from './chordAddress.js';
import { createChessGameState, applySquare } from './chessGameState.js';
import { destinationBadges } from './chessBadges.js';

const fresh = () => createChessGameState({ playerColor: 'w', scheme: DEFAULT_CHORD_SCHEME, seed: 7, shuffleEachTurn: false });

describe('destinationBadges', () => {
  it('is empty when no piece is in hand', () => {
    expect(destinationBadges(fresh(), DEFAULT_CHORD_SCHEME)).toEqual({});
  });

  it('names every square the held piece can reach', () => {
    const start = fresh();
    // Pick up a knight, which always has moves from the opening position.
    const knightSquare = 'g1';
    const { state } = applySquare(start, knightSquare);
    const badges = destinationBadges(state, state.scheme);
    const squares = Object.keys(badges);
    expect(squares.length).toBeGreaterThan(0);
    for (const sq of squares) expect(typeof badges[sq]).toBe('string');
  });

  it('gives each destination the chord that actually addresses it', () => {
    const start = fresh();
    const { state } = applySquare(start, 'g1');
    const badges = destinationBadges(state, state.scheme);
    const [square, symbol] = Object.entries(badges)[0];
    expect(symbol).toBe(squareToChord(square, state.scheme).symbol);
  });
});
```

Import `squareToChord` alongside `DEFAULT_CHORD_SCHEME`. If `applySquare(start, 'g1')` does not
select the knight because the seeded chord map puts it elsewhere, read the state's own board rather
than hard-coding: pick any square whose piece has destinations. Say in the report which you used.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/chessBadges.test.js`
Expected: FAIL — cannot resolve `./chessBadges.js`.

- [ ] **Step 3: Implement the badges**

```javascript
import { squareToChord } from './chordAddress.js';
import { destinationsFor } from './chessGameState.js';

/**
 * The chord that sends the held piece to each square it can reach.
 *
 * Reading the rim and intersecting a file with a rank is too much work mid-game,
 * so the square says its own name. Empty when nothing is held: these are the
 * consequence of picking a piece up, not advice offered unasked.
 */
export function destinationBadges(game, scheme) {
  if (!game?.origin) return {};
  const badges = {};
  for (const square of destinationsFor(game, game.origin)) {
    const chord = squareToChord(square, scheme);
    if (chord?.symbol) badges[square] = chord.symbol;
  }
  return badges;
}

export default { destinationBadges };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/chessBadges.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Render the badge, with a failing test first**

Add to `ChessBoard.test.jsx`:

```javascript
describe('destination labels', () => {
  it('prints the chord on a labelled square without hiding the piece', () => {
    const { container } = render(<ChessBoard fen={START} squareLabels={{ e4: 'Fm7' }} />);
    const badge = container.querySelector('.chess-board__badge');
    expect(badge.textContent).toBe('Fm7');
    expect(badge.closest('[data-square]').dataset.square).toBe('e4');
  });

  it('prints nothing when there are no labels', () => {
    const { container } = render(<ChessBoard fen={START} squareLabels={{}} />);
    expect(container.querySelectorAll('.chess-board__badge')).toHaveLength(0);
  });

  it('labels a capture square, where a piece is already standing', () => {
    // Black pawn on e5; the label must coexist with it.
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const { container } = render(<ChessBoard fen={fen} squareLabels={{ e5: 'Bb' }} />);
    const square = container.querySelector('[data-square="e5"]');
    expect(square.querySelector('.chess-board__badge').textContent).toBe('Bb');
    expect(square.querySelector('.chess-board__piece')).not.toBeNull();
  });
});
```

Run it, confirm it fails, then in `ChessBoard.jsx` accept `squareLabels = {}` and render inside the
square, after the piece so it stacks above:

```jsx
{squareLabels[square] && (
  <span className="chess-board__badge" aria-hidden="true">{squareLabels[square]}</span>
)}
```

In `ChessBoard.scss`:

```scss
/* The chord that reaches this square. The corner is the one placement that
   never covers the piece, which matters most on a capture. */
.chess-board__badge {
  position: absolute;
  top: 3%;
  right: 3%;
  padding: 0.1em 0.3em;
  border-radius: 2px;
  background: var(--cb-hint);
  color: var(--cb-frame);
  font-size: 26cqmin;
  font-weight: 700;
  line-height: 1;
  pointer-events: none;
}
```

The square needs `container-type: size` for `cqmin` to resolve against it. If adding that to
`.chess-board__square` disturbs the existing layout, size the badge in `em` against a square-relative
font-size instead — but do NOT use `vw`/`vh`.

- [ ] **Step 6: Wire the config, the panel and the game**

`chessCues.js` — add the key, defaulting to on:

```javascript
showDestinationLabels: feedback.show_destination_labels !== false,
```

Extend `chessCues.test.js` with a case for each of: absent (true), `false`, `true`.

`ChessSettingsPanel.jsx` — a fourth group following the existing three exactly:

```jsx
<h3 className="chess-settings__group">Name the squares</h3>
<div className="chess-settings__row">
  {[{ id: true, label: 'Show chords' }, { id: false, label: 'Hide chords' }].map((opt) => (
    <button
      key={String(opt.id)}
      type="button"
      className={`chess-settings__opt${labelsOn === opt.id ? ' is-active' : ''}`}
      aria-pressed={labelsOn === opt.id}
      onClick={() => onChange({ feedback: { show_destination_labels: opt.id } })}
    >
      {opt.label}
    </button>
  ))}
</div>
```

with `const labelsOn = config?.feedback?.show_destination_labels !== false;`. Add panel tests
mirroring the existing ones: both buttons present, the active one marked, and a tap emitting
`{ feedback: { show_destination_labels: false } }`.

`PianoChessGame.jsx` — compute and pass:

```javascript
const squareLabels = cues.showDestinationLabels ? destinationBadges(game, liveScheme) : {};
```

and `squareLabels={squareLabels}` on `<ChessBoard>`.

Add the key to the household config through the container, writing the whole file (never `sed -i` on
YAML), then `chown node:node`:

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/chess.yml'
```
Add `show_destination_labels: true` under `feedback:` and write it back.

- [ ] **Step 7: Run everything**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/ frontend/src/modules/Chess/`
Expected: PASS.

- [ ] **Step 8: Update the reference doc**

Add the hover/pick-up/drop model, the ants and the labels to the Piano Chess section of
`docs/reference/piano/piano-games.md`.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/ frontend/src/modules/Chess/ docs/reference/piano/piano-games.md
git commit -m "feat(chess): eligible squares name the chord that reaches them"
```

---

---

### Task 5: Stop the same square from cancelling a pick-up, and lock the player

**Files:**
- Modify: `frontend/src/modules/Piano/PianoChessGame/chessGameState.js:154-156`
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx`
- Test: `frontend/src/modules/Piano/PianoChessGame/chessGameState.test.js` (extend)
- Test: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.test.jsx` (extend)

**Interfaces:**
- Consumes: `applyEvent` from Task 1; `isPersistentUser` from `../PianoKiosk/pianoUser.js`.
- Produces: nothing later tasks consume.

**Why:** `applySquare` currently treats a repeat of the held square as "put it back". Combined with
the new model, a player who double-plays to pick up would pick up on the recognition and put it
straight back on the release. The octave gesture is the escape; the square itself must not also be
one. Separately, a game holds a per-user config and writes a per-user record, so switching player
mid-game leaves it incoherent.

- [ ] **Step 1: Write the failing tests**

```javascript
// chessGameState.test.js
it('does not put the piece back when its own square is played again', () => {
  const start = createChessGameState({ playerColor: 'w', scheme: DEFAULT_CHORD_SCHEME, seed: 7, shuffleEachTurn: false });
  const held = applySquare(start, firstMovableSquare(start)).state;
  const again = applySquare(held, held.origin);
  expect(again.state.origin).toBe(held.origin);       // still in hand
  expect(again.event.type).not.toBe('deselected');
});
```

Write `firstMovableSquare(state)` in the test file: walk `chordBoard(state.scheme)` keys and return
the first square whose piece belongs to the player and has destinations. Do not hard-code a square —
the chord map is seeded and re-deals.

```javascript
// PianoChessGame.test.jsx
it('keeps the starting player for the whole game, ignoring a mid-game switch', async () => {
  const { rerender, container } = render(<PianoChessGame currentUser="felix" />);
  await playChord(rerender, notesFor('a movable square'));
  rerender(<PianoChessGame currentUser="milo" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(container.querySelector('.piano-chess__locked-user').textContent).toContain('felix');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/`
Expected: FAIL on both — the repeat currently deselects, and no lock exists.

- [ ] **Step 3: Implement**

In `chessGameState.js`, delete the `square === state.origin` deselect branch entirely and let the
square fall through to the normal destination check, where it will be rejected as an illegal
destination like any other — except that under the new model an ineligible square only hovers, so
nothing happens at all. Put-it-back remains the octave, which `advanceCursor` already emits as
`escape`.

In `PianoChessGame.jsx`, latch the player at mount:

```javascript
// The game holds this player's config and writes their record. Switching the
// kiosk user mid-game would file one player's moves under another's name, so
// the game keeps whoever started it until it ends.
const lockedUserRef = useRef(userId);
const lockedUser = lockedUserRef.current;
```

Use `lockedUser` everywhere `userId` is currently used for saving and for config, and reset it in
`restart()`. Render the locked name in the right rail as `.piano-chess__locked-user` so the screen
says whose game this is.

- [ ] **Step 4: Run them to verify they pass, then prove both**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/`. Then re-add the deselect branch,
confirm the first test goes RED, restore. Remove the lock, confirm the second goes RED, restore.
Paste the observed output for both.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/
git commit -m "fix(chess): a repeated square no longer cancels the pick-up; lock the player for the game"
```

---

### Task 6: One name per chord, and no add2

**Files:**
- Modify: `frontend/src/modules/Piano/PianoChessGame/chordAddress.js`
- Test: `frontend/src/modules/Piano/PianoChessGame/chordAddress.test.js` (extend)
- Modify: `data/household/config/chess.yml` via `docker exec`

**Interfaces:**
- Consumes: nothing.
- Produces: `DEFAULT_CHORD_SCHEME.qualities` with `minor6` in place of `add2`; `CHORD_QUALITIES`
  gains `minor6: { label: 'm6', name: 'minor 6th', intervals: [0, 3, 7, 9] }`.

**Why:** the board's axis said `add2` while the chord plaque three inches away named the same four
notes `A add9` — two labels for one chord on one screen. `m6` was verified collision-free,
gesture-safe and label-unambiguous against the eight roots, and it pairs with the `6` already on the
board: minor plus a sixth.

- [ ] **Step 1: Write the failing test**

```javascript
it('no longer offers add2, and the replacement collides with nothing', () => {
  expect(DEFAULT_CHORD_SCHEME.qualities).not.toContain('add2');
  expect(DEFAULT_CHORD_SCHEME.qualities).toContain('minor6');
  expect(findChordCollisions(DEFAULT_CHORD_SCHEME)).toEqual([]);
  expect(validateChordScheme(DEFAULT_CHORD_SCHEME).valid).toBe(true);
});

it('names the replacement the same way the chord plaque would', () => {
  // The plaque uses theory/chordNaming.js; the axis uses this table. They must agree
  // on what the chord IS, even though one abbreviates and one spells out.
  const notes = [60, 63, 67, 69]; // C E-flat G A
  expect(identifyChord(notes, DEFAULT_CHORD_SCHEME).square).toBeTruthy();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/chordAddress.test.js`
Expected: FAIL — `add2` is still listed.

- [ ] **Step 3: Implement**

Add `minor6: { label: 'm6', name: 'minor 6th', intervals: [0, 3, 7, 9] }` to `CHORD_QUALITIES`, and
in `DEFAULT_CHORD_SCHEME.qualities` replace `'add2'` with `'minor6'`. Leave `add2` in the table —
other consumers may reference it — but off the board.

Then confirm against the naming module that the two agree, and record the result in the report:

```bash
node --input-type=module -e "
import { identifyChord } from '/opt/Code/DaylightStation/frontend/src/modules/Piano/theory/chordNaming.js';
console.log(identifyChord([60,63,67,69], 'C').displayName);
"
```

If the plaque calls it something that contradicts `m6`, say so plainly rather than shipping a second
disagreement.

- [ ] **Step 4: Run the chess suites**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/ frontend/src/modules/Chess/`
Expected: PASS. Tests asserting five candidate squares for a C major triad may shift — recompute the
expectation from `chordBoard` rather than editing it to whatever the code now returns, and say which
you did.

- [ ] **Step 5: Turn the re-deal off by default**

The chord map re-dealing every turn compounded the confusion in the failed session: the one reference
a player could orient by was moving between moves. Change the household default to off, writing the
whole file (never `sed -i` on YAML) and re-chowning:

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/chess.yml'
# rewrite with shuffle_each_turn: false, then:
sudo docker exec daylight-station sh -c 'chown node:node data/household/config/chess.yml'
```

The panel control stays, so it can be turned back on per player.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/
git commit -m "fix(chess): m6 replaces add2, and the map holds still by default"
```

---

### Task 7: Play the game before claiming it works

**Files:**
- Create: `cli/piano-chess.cli.mjs`
- Test: `cli/piano-chess.cli.test.mjs`

**Interfaces:**
- Consumes: the deployed page, driven through the fake MIDI bridge.
- Produces: a command that plays a real move end to end and fails loudly if it cannot.

**Why this task exists:** the failed session was not caught by four rounds of review, 145 passing
tests, or screenshots. Every check verified the implementation against the spec; none of them tried
to move a piece. This closes that hole permanently.

- [ ] **Step 1: Write the verifier**

`cli/piano-chess.cli.mjs`, following the conventions of `cli/piano-card-game.cli.mjs` (argv parsing,
`--json`, `--headed`, exit codes). It must:

1. Stand up a `WebSocketServer` on port 8770 in-process — the piano kiosk's note-in is bridge-first,
   so this is what gets past the connect gate and delivers notes. Frames are
   `{type:'note.on'|'note.off', note, velocity}`.
2. Open `https://daylightlocal.kckern.net/piano/games/chess` and wait for `.chess-board__square`.
3. Read the board's own rim to learn the live chord map — the ranks and files are rendered as axis
   labels, and the map re-deals, so it must be read rather than assumed.
4. Pick a square holding a movable White piece, derive its chord, and **play that chord twice** with
   a gap under 800ms.
5. Assert a piece is now in hand: exactly one `.chess-board__square--held`.
6. Assert the destinations are visible: at least one `.chess-board__badge`.
7. Play the chord of one badged destination once.
8. Assert the move happened: the move list is no longer empty, and the backend logged
   `chess.engine.move`.
9. Exit non-zero with a legible message if any step fails, naming the step.

- [ ] **Step 2: Unit-test its pure parts**

Test argv parsing and the board-reading helper against fixture DOM, the way
`cli/chess.cli.test.mjs` tests `parseArgs` and `renderBoard`. The Playwright driving is not
unit-tested; it is the acceptance run itself.

- [ ] **Step 3: Run it against the deployed page and paste the transcript**

Run: `node cli/piano-chess.cli.mjs`
Expected: a full move completes. Paste the real output into the report. **If it fails, that is the
task's finding — report it rather than adjusting the verifier until it passes.**

- [ ] **Step 4: Commit**

```bash
git add cli/piano-chess.cli.mjs cli/piano-chess.cli.test.mjs
git commit -m "test(chess): a verifier that actually plays a move"
```

---

## Deployment

Build and deploy per `CLAUDE.local.md`, checking the deploy gate first — never redeploy while a
fitness session is active or a video is playing. Note that "the TV is off" and "nothing is playing"
are different facts: the piano app plays Plex video on desktop browsers too, so check the frame
count rather than the room.

```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```

Afterwards reload the piano tablet kiosk, then **run `node cli/piano-chess.cli.mjs` against the
deployed page and paste its transcript**. A deploy is not done until a move has been played through
it. Screenshots and green suites were both present the last time this shipped unplayable.

## Out of scope, and why

**Milo's reading level** — bass-clef ranks and treble-clef files — is not in this plan. It is not a
setting on this board: it replaces chord addressing with two-note addressing, which needs its own
addresser, its own axis rendering built on `components/ActionStaff.jsx`, and a per-user switch
between the two. It gets its own spec and plan immediately after this one. Recording it here so it
is not mistaken for something this plan delivers, which is exactly how it went missing the first
time.
