# Piano Chess Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Piano Chess screen so the instrument is legible, the board says one thing per visual channel, help is asked for rather than volunteered, and a finished game leaves a record.

**Architecture:** Pure functions first, wiring second. Candidate narrowing and gesture recognition are pure modules with their own tests; the board gains a channel-based class vocabulary; the component wires them and loses the left rail. Nothing new goes on the server except a per-game record endpoint reusing the existing chess router.

**Tech Stack:** React 18, Vitest, SCSS, Node/Express (ESM `.mjs`), the existing `chordAddress.js` addresser and `theory/chordNaming.js` namer.

**Design spec:** `docs/superpowers/specs/2026-08-12-piano-chess-chrome-design.md`

## Global Constraints

- Frontend `.jsx`/`.js`, backend `.mjs`; colocated tests; `npx vitest run <path>`.
- Never raw `console.*` — the frontend logging framework, or the injected backend logger.
- **Nothing in this component may size itself off `vh` or `vw`.** `PianoDesignScale` lays the kiosk out at a fixed design size and scales the canvas, so viewport units measure the physical screen while the layout only ever gets the design box. Use container-query units against the box the element actually occupies.
- **Two `identifyChord` functions exist and must never be merged.** `theory/chordNaming.js` is the NAMER ("what chord is this?", answers for any notes, inversion- and key-aware). `PianoChessGame/chordAddress.js` is the ADDRESSER ("which square is this?", answers only for the 64 board chords).
- **No cue appears unbidden.** Legality marks appear only in response to a gesture. The automatic reveal after a refusal is removed, not merely reconfigured.
- Touch UI rule: discrete tap targets, no sliders.
- **No test may be written that cannot fail.** Prior waves of this work shipped one test asserting on a React warning that no longer exists and another using a FEN that lacked the piece it named; both passed against broken code. Prove each new test red-before / green-after and report both.
- The piano user is a **string id**; guests (`isPersistentUser` false) never reach per-user endpoints.

## File Structure

| File | Responsibility |
|---|---|
| `PianoChessGame/chordCandidates.js` (new) | Pure: held pitch classes → candidate squares |
| `PianoChessGame/chordGestures.js` (new) | Pure: held notes → `'hint' \| 'best' \| null` |
| `PianoChessGame/chessGameRecord.js` (new) | Pure: game state + counters → the record body |
| `Chess/ChessBoard.jsx` | Renders the four channels; gains `candidates`, `hintTargets`, `bestMove`; loses `sourceSquares`, `marked`, crosshair |
| `Chess/ChessBoard.scss` | Channel vocabulary; drops the uppercase transform |
| `PianoChessGame/PianoChessGame.jsx` | Wires it; loses the left rail and the post-refusal reveal |
| `PianoChessGame/PianoChessGame.scss` | Two-zone layout, instrument zone |
| `components/ChordNamePanel.jsx` | Gains an optional `label` prop |
| `chordAddress.js` | Validator gains gesture-collision and label-ambiguity checks |
| `4_api/v1/routers/chess.mjs` | Gains `POST /games` to store a record |

---

### Task 1: Candidate narrowing (pure)

**Files:**
- Create: `frontend/src/modules/Piano/PianoChessGame/chordCandidates.js`
- Test: `frontend/src/modules/Piano/PianoChessGame/chordCandidates.test.js`

**Interfaces:**
- Consumes: `chordBoard(scheme)` from `./chordAddress.js`, which returns `{ [square]: { symbol, pitch_classes, ... } }`.
- Produces: `candidateSquares(heldNotes, scheme)` → `string[]` of square names, sorted. `heldNotes` is an array of MIDI numbers.

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, expect, it } from 'vitest';
import { DEFAULT_CHORD_SCHEME } from './chordAddress.js';
import { candidateSquares } from './chordCandidates.js';

const S = DEFAULT_CHORD_SCHEME;

describe('candidateSquares', () => {
  it('lights nothing when no keys are down', () => {
    expect(candidateSquares([], S)).toEqual([]);
  });

  it('lights many squares for a single note, spanning more than one file and rank', () => {
    const lit = candidateSquares([60], S); // middle C
    expect(lit.length).toBeGreaterThan(1);
    expect(new Set(lit.map((sq) => sq[0])).size).toBeGreaterThan(1); // several files
    expect(new Set(lit.map((sq) => sq[1])).size).toBeGreaterThan(1); // several ranks
  });

  it('narrows as notes are added', () => {
    const one = candidateSquares([60], S);
    const two = candidateSquares([60, 64], S);
    expect(two.length).toBeLessThan(one.length);
    expect(two.every((sq) => one.includes(sq))).toBe(true); // strictly a subset
  });

  it('resolves a complete chord to exactly one square', () => {
    const lit = candidateSquares([60, 64, 67], S); // C major triad
    expect(lit).toHaveLength(1);
  });

  it('is octave- and order-free', () => {
    expect(candidateSquares([60, 64, 67], S)).toEqual(candidateSquares([67, 76, 48], S));
  });

  it('lights nothing when no square can contain what is held', () => {
    expect(candidateSquares([60, 61, 62], S)).toEqual([]); // a semitone cluster
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/chordCandidates.test.js`
Expected: FAIL — cannot resolve `./chordCandidates.js`.

- [ ] **Step 3: Implement**

```javascript
import { chordBoard } from './chordAddress.js';

/**
 * Which squares are still possible given what is held.
 *
 * A square is a candidate while its chord contains EVERY pitch class currently
 * down — held ⊆ chord. One note usually lights a scatter across several files
 * and ranks, because a note can be the root of one chord and the third of
 * another; the set contracts with each note added until one square is left.
 *
 * Subset, not equality, is the whole point: equality only ever answers at the
 * end, and the player needs to see the board reacting on the way there.
 */
export function candidateSquares(heldNotes, scheme) {
  const held = [...new Set((heldNotes || [])
    .filter(Number.isFinite)
    .map((note) => ((note % 12) + 12) % 12))];
  if (held.length === 0) return [];
  const board = chordBoard(scheme);
  return Object.entries(board)
    .filter(([, chord]) => {
      const classes = chord?.pitch_classes;
      return Array.isArray(classes) && held.every((pc) => classes.includes(pc));
    })
    .map(([square]) => square)
    .sort();
}

export default { candidateSquares };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/chordCandidates.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/chordCandidates.js frontend/src/modules/Piano/PianoChessGame/chordCandidates.test.js
git commit -m "feat(chess): candidate squares narrow as a chord is spelled"
```

---

### Task 2: Hint gestures (pure) and the validator that keeps them safe

**Files:**
- Create: `frontend/src/modules/Piano/PianoChessGame/chordGestures.js`
- Test: `frontend/src/modules/Piano/PianoChessGame/chordGestures.test.js`
- Modify: `frontend/src/modules/Piano/PianoChessGame/chordAddress.js` (extend `validateChordScheme`, currently at line 89)
- Test: `frontend/src/modules/Piano/PianoChessGame/chordAddress.test.js` (extend)

**Interfaces:**
- Consumes: `CHORD_QUALITIES`, `DEFAULT_CHORD_SCHEME`, `validateChordScheme` from `./chordAddress.js`; `isOctave(notes)` from `./chordCursor.js`.
- Produces: `recognizeGesture(heldNotes)` → `'hint' | 'best' | null`. `GESTURE_SIZES = { hint: 3, best: 4 }`. `validateChordScheme(scheme)` keeps returning `{ valid, errors }` and gains two new error classes.

- [ ] **Step 1: Write the failing gesture test**

```javascript
import { describe, expect, it } from 'vitest';
import { CHORD_QUALITIES, DEFAULT_CHORD_SCHEME, chordPitchClasses } from './chordAddress.js';
import { recognizeGesture } from './chordGestures.js';

describe('recognizeGesture', () => {
  it('reads three adjacent semitones as a request for legal moves', () => {
    expect(recognizeGesture([60, 61, 62])).toBe('hint');
  });

  it('reads four adjacent semitones as a request for the best move', () => {
    expect(recognizeGesture([60, 61, 62, 63])).toBe('best');
  });

  it('ignores a two-note semitone pair, which is a legitimate maj7 fragment', () => {
    // B and C are the seventh and root of Cmaj7 — a real partial chord.
    expect(recognizeGesture([59, 60])).toBeNull();
  });

  it('ignores ordinary chords', () => {
    expect(recognizeGesture([60, 64, 67])).toBeNull();
    expect(recognizeGesture([60, 64, 67, 71])).toBeNull();
  });

  it('ignores an octave, which already means take-it-back', () => {
    expect(recognizeGesture([60, 72])).toBeNull();
  });

  it('requires the semitones to be adjacent, not merely close', () => {
    expect(recognizeGesture([60, 61, 63])).toBeNull();
  });

  it('recognises the shape in any octave', () => {
    expect(recognizeGesture([36, 37, 38])).toBe('hint');
  });

  it('never collides with a square: no gesture shape is a subset of any board chord', () => {
    for (const quality of DEFAULT_CHORD_SCHEME.qualities) {
      for (const root of DEFAULT_CHORD_SCHEME.roots) {
        const classes = chordPitchClasses(root, quality);
        // Every 3- and 4-length run of consecutive pitch classes must be absent.
        for (let start = 0; start < 12; start += 1) {
          const run3 = [0, 1, 2].map((i) => (start + i) % 12);
          const run4 = [0, 1, 2, 3].map((i) => (start + i) % 12);
          expect(run3.every((pc) => classes.includes(pc))).toBe(false);
          expect(run4.every((pc) => classes.includes(pc))).toBe(false);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/chordGestures.test.js`
Expected: FAIL — cannot resolve `./chordGestures.js`.

- [ ] **Step 3: Implement the recogniser**

```javascript
import { isOctave } from './chordCursor.js';

/** How many adjacent semitones each request takes. */
export const GESTURE_SIZES = Object.freeze({ hint: 3, best: 4 });

/** Distinct pitch classes, ascending. */
function pitchClasses(notes) {
  return [...new Set((notes || [])
    .filter(Number.isFinite)
    .map((note) => ((note % 12) + 12) % 12))].sort((a, b) => a - b);
}

/** True when the classes form one unbroken run of semitones, wrap included. */
function isAdjacentRun(classes) {
  if (classes.length < 2) return false;
  for (let offset = 0; offset < 12; offset += 1) {
    const run = Array.from({ length: classes.length }, (_, i) => (offset + i) % 12).sort((a, b) => a - b);
    if (run.length === classes.length && run.every((pc, i) => pc === classes[i])) return true;
  }
  return false;
}

/**
 * Asking for help, in a shape the board can never mean.
 *
 * Squares are chords; a run of adjacent semitones is not one, which is what
 * makes it free vocabulary — the same reason the octave was chosen for
 * take-it-back. Two adjacent semitones are NOT a gesture: a major seventh
 * contains its root and seventh a semitone apart, so a two-note cluster is a
 * legitimate partial chord on the way to a square.
 */
export function recognizeGesture(heldNotes) {
  if (isOctave(heldNotes || [])) return null;
  const classes = pitchClasses(heldNotes);
  if (!isAdjacentRun(classes)) return null;
  if (classes.length === GESTURE_SIZES.hint) return 'hint';
  if (classes.length === GESTURE_SIZES.best) return 'best';
  return null;
}

export default { recognizeGesture, GESTURE_SIZES };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/chordGestures.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the failing validator test**

Append to `frontend/src/modules/Piano/PianoChessGame/chordAddress.test.js`:

```javascript
describe('validateChordScheme — gesture and label safety', () => {
  it('accepts the default scheme', () => {
    expect(validateChordScheme(DEFAULT_CHORD_SCHEME).valid).toBe(true);
  });

  it('rejects a scheme whose chord could swallow a gesture shape', () => {
    // A hypothetical cluster quality would make the hint gesture unusable.
    const scheme = {
      ...DEFAULT_CHORD_SCHEME,
      qualities: ['major', 'minor', 'sus4', 'add2', 'seventh', 'add6', 'major7', 'clusterTest'],
    };
    const result = validateChordScheme(scheme, {
      qualities: { ...CHORD_QUALITIES, clusterTest: { label: 'cl', name: 'cluster', intervals: [0, 1, 2] } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/gesture/i);
  });

  it('rejects a scheme whose rank labels read as the same thing', () => {
    const result = validateChordScheme(DEFAULT_CHORD_SCHEME, {
      qualities: { ...CHORD_QUALITIES, minor: { label: 'maj', name: 'minor', intervals: [0, 3, 7] } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/label/i);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/chordAddress.test.js`
Expected: FAIL — the two new cases pass validation today.

- [ ] **Step 7: Extend the validator**

In `chordAddress.js`, give `validateChordScheme` an optional second argument so a test can inject a
quality table, and add the two checks after the existing quality loop (currently ending at line 107):

```javascript
export function validateChordScheme(scheme, { qualities: table = CHORD_QUALITIES } = {}) {
  // ... existing root and quality checks, reading `table` instead of CHORD_QUALITIES ...

  // Gesture safety. Hints are asked for with runs of adjacent semitones, which
  // works only while no square can contain such a run. That is a property of
  // the vocabulary, not a law — so a scheme that breaks it is rejected here
  // rather than silently disabling help.
  for (const quality of qualities || []) {
    const intervals = table[quality]?.intervals;
    if (!Array.isArray(intervals)) continue;
    const classes = intervals.map((i) => ((i % 12) + 12) % 12);
    for (const size of [3, 4]) {
      for (let start = 0; start < 12; start += 1) {
        const run = Array.from({ length: size }, (_, i) => (start + i) % 12);
        if (run.every((pc) => classes.includes(pc))) {
          errors.push(`quality ${quality} contains a ${size}-semitone run, which collides with the hint gesture`);
        }
      }
    }
  }

  // Label ambiguity. Two ranks that read the same to a musician are worse than
  // two ranks that ARE the same: the board looks legible and lies.
  const labels = new Map();
  for (const quality of qualities || []) {
    const label = (table[quality]?.label || 'maj').toLowerCase();
    if (labels.has(label)) errors.push(`qualities ${labels.get(label)} and ${quality} share the label "${label}"`);
    else labels.set(label, quality);
  }

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 8: Run both suites to verify they pass**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/chordAddress.test.js frontend/src/modules/Piano/PianoChessGame/chordGestures.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/
git commit -m "feat(chess): semitone-cluster hint gestures, and a validator that keeps them safe"
```

---

### Task 3: The board's four channels

**Files:**
- Modify: `frontend/src/modules/Chess/ChessBoard.jsx`
- Modify: `frontend/src/modules/Chess/ChessBoard.scss`
- Test: `frontend/src/modules/Chess/ChessBoard.test.jsx` (extend)

**Interfaces:**
- Consumes: nothing from earlier tasks (the props are supplied by Task 5).
- Produces: `ChessBoard` accepts `candidates={string[]}`, `hintTargets={string[]}`, `bestMove={{from,to}|null}`; it no longer accepts `sourceSquares` or `markedSquares`. `cursorSquare` still marks the resolved square but no longer draws file/rank lines.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/modules/Chess/ChessBoard.test.jsx`:

```javascript
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const sq = (container, name) => container.querySelector(`[data-square="${name}"]`);

describe('four channels', () => {
  it('lights candidates and marks the resolved cursor more strongly', () => {
    const { container } = render(<ChessBoard fen={START} candidates={['e4', 'e5', 'd4']} cursorSquare="e4" />);
    expect(sq(container, 'e5').className).toContain('chess-board__square--candidate');
    expect(sq(container, 'e4').className).toContain('chess-board__square--cursor');
  });

  it('draws no crosshair lines across the file and rank', () => {
    const { container } = render(<ChessBoard fen={START} cursorSquare="e4" />);
    expect(container.querySelectorAll('.chess-board__square--cursor-line')).toHaveLength(0);
  });

  it('shows hint marks only when hint targets are given', () => {
    const { container: quiet } = render(<ChessBoard fen={START} />);
    expect(quiet.querySelectorAll('.chess-board__square--hint')).toHaveLength(0);
    const { container: asked } = render(<ChessBoard fen={START} hintTargets={['e4', 'e3']} />);
    expect(asked.querySelectorAll('.chess-board__square--hint')).toHaveLength(2);
  });

  it('rings both ends of the best move', () => {
    const { container } = render(<ChessBoard fen={START} bestMove={{ from: 'g1', to: 'f3' }} />);
    expect(sq(container, 'g1').className).toContain('chess-board__square--best');
    expect(sq(container, 'f3').className).toContain('chess-board__square--best');
  });

  it('no longer outlines movable pieces, because that is a hint now', () => {
    const { container } = render(<ChessBoard fen={START} />);
    expect(container.querySelectorAll('.chess-board__square--source')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Chess/ChessBoard.test.jsx`
Expected: FAIL — no `--candidate`, `--hint` or `--best` classes exist; `--cursor-line` still renders.

- [ ] **Step 3: Implement the channels**

In `ChessBoard.jsx`: accept the three new props, drop `sourceSquares`/`markedSquares`/`isOnCursorLine`, and compute per square:

```jsx
const classes = [
  'chess-board__square',
  isLight ? 'chess-board__square--light' : 'chess-board__square--dark',
  // channel 1 — light: what the hands are doing now
  candidates.includes(square) && 'chess-board__square--candidate',
  cursorSquare === square && 'chess-board__square--cursor',
  // channel 2 — outline: committed state
  selected === square && 'chess-board__square--selected',
  isLastMove && 'chess-board__square--last-move',
  // channel 3 — marks: only what was asked for
  hintTargets.includes(square) && 'chess-board__square--hint',
  (bestMove?.from === square || bestMove?.to === square) && 'chess-board__square--best',
  // channel 4 — colour: alarms
  isCheck && 'chess-board__square--check',
  rejectedSquare === square && 'chess-board__square--rejected',
].filter(Boolean).join(' ');
```

In `ChessBoard.scss`, replace the old state rules with one block per channel, and **delete the
`text-transform: uppercase` on `.chess-board__axis-label`** so labels render as stored:

```scss
/* Channel 1 — light. What the hands are doing, right now. Candidates glow
   faintly and narrow; the resolved square is unmistakable. */
.chess-board__square--candidate { box-shadow: inset 0 0 0 100vmax color-mix(in srgb, var(--cb-accent-glow) 13%, transparent); }
.chess-board__square--cursor {
  box-shadow:
    inset 0 0 0 100vmax color-mix(in srgb, var(--cb-accent-glow) 34%, transparent),
    inset 0 0 0 3px var(--cb-accent-glow);
}

/* Channel 2 — outline. Where you are in the move. */
.chess-board__square--selected { outline: 3px solid var(--cb-accent); outline-offset: -3px; }
.chess-board__square--last-move { outline: 2px dashed color-mix(in srgb, var(--cb-accent) 42%, transparent); outline-offset: -2px; }

/* Channel 3 — marks. Only ever present because the player asked. */
.chess-board__square--hint::after {
  content: ''; position: absolute; inset: 34%;
  border-radius: 50%; background: var(--cb-hint);
}
.chess-board__square--best::after {
  content: ''; position: absolute; inset: 12%;
  border: 3px solid var(--cb-hint); border-radius: 50%;
}

/* Channel 4 — colour. Alarms, and nothing else. */
.chess-board__square--check { box-shadow: inset 0 0 0 100vmax color-mix(in srgb, var(--cb-danger) 45%, transparent); }
```

Keep the existing `--rejected` shake animation as-is.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/src/modules/Chess/ChessBoard.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Chess/
git commit -m "feat(chess): one visual channel per question, and labels that read as stored"
```

---

### Task 4: The per-game record

**Files:**
- Create: `frontend/src/modules/Piano/PianoChessGame/chessGameRecord.js`
- Test: `frontend/src/modules/Piano/PianoChessGame/chessGameRecord.test.js`
- Modify: `backend/src/4_api/v1/routers/chess.mjs`
- Test: `backend/src/4_api/v1/routers/chess.test.mjs` (extend)

**Interfaces:**
- Consumes: `resolveUser` and the router's existing `safeSegment` guard in `chess.mjs`; `dataService.user.write`.
- Produces: `buildGameRecord({ game, rungId, hints, bestMoves, startedAt, endedAt })` → `{ result, moves, hints, best_moves, rung, duration_ms }`. `POST /api/v1/chess/games?user=<id>` stores it and returns `{ saved: true }`.

- [ ] **Step 1: Write the failing record test**

```javascript
import { describe, expect, it } from 'vitest';
import { buildGameRecord } from './chessGameRecord.js';

const finished = (outcome, winner, plies) => ({
  status: { game_over: true, outcome, winner },
  playerColor: 'w',
  history: Array.from({ length: plies }, (_, i) => ({ san: `m${i}` })),
});

describe('buildGameRecord', () => {
  it('records a win with its move count and help taken', () => {
    const rec = buildGameRecord({
      game: finished('checkmate', 'w', 48), rungId: 'steady',
      hints: 3, bestMoves: 1, startedAt: 1000, endedAt: 61000,
    });
    expect(rec).toMatchObject({ result: 'win', moves: 24, hints: 3, best_moves: 1, rung: 'steady', duration_ms: 60000 });
  });

  it('counts moves as full moves, not plies', () => {
    expect(buildGameRecord({ game: finished('checkmate', 'w', 7), rungId: 'learner', hints: 0, bestMoves: 0, startedAt: 0, endedAt: 0 }).moves).toBe(4);
  });

  it('records a loss when the opponent mates', () => {
    expect(buildGameRecord({ game: finished('checkmate', 'b', 30), rungId: 'learner', hints: 0, bestMoves: 0, startedAt: 0, endedAt: 0 }).result).toBe('loss');
  });

  it('records a draw by its outcome name', () => {
    expect(buildGameRecord({ game: finished('stalemate', null, 60), rungId: 'learner', hints: 0, bestMoves: 0, startedAt: 0, endedAt: 0 }).result).toBe('draw');
  });

  it('returns null for a game that is not over, so nothing half-played is filed', () => {
    expect(buildGameRecord({ game: { status: { game_over: false }, history: [] }, rungId: 'learner', hints: 0, bestMoves: 0, startedAt: 0, endedAt: 0 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/chessGameRecord.test.js`
Expected: FAIL — cannot resolve `./chessGameRecord.js`.

- [ ] **Step 3: Implement**

```javascript
/**
 * What a finished game leaves behind.
 *
 * Facts, not a score: moves and help are reported side by side rather than
 * compressed into one number, because a single number has to decide what a win
 * with three hints is worth — and whatever it decides, someone optimises the
 * number instead of the chess.
 */
export function buildGameRecord({ game, rungId, hints, bestMoves, startedAt, endedAt }) {
  if (!game?.status?.game_over) return null;
  const outcome = game.status.outcome;
  const result = outcome === 'checkmate'
    ? (game.status.winner === game.playerColor ? 'win' : 'loss')
    : 'draw';
  return {
    result,
    outcome,
    moves: Math.ceil((game.history?.length || 0) / 2),
    hints: Math.max(0, hints || 0),
    best_moves: Math.max(0, bestMoves || 0),
    rung: rungId || null,
    duration_ms: Math.max(0, (endedAt || 0) - (startedAt || 0)),
  };
}

export default { buildGameRecord };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/chessGameRecord.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing route test**

Append to `backend/src/4_api/v1/routers/chess.test.mjs`, following the existing tests' style:

```javascript
describe('POST /api/v1/chess/games', () => {
  it('stores a record for a real user', async () => {
    const writes = [];
    const app = appWith({ engine: {}, configService: stubConfig(), recordStore: { save: (u, r) => writes.push([u, r]) } });
    const res = await request(app).post('/api/v1/chess/games?user=felix')
      .send({ result: 'win', moves: 24, hints: 3, best_moves: 1, rung: 'steady', duration_ms: 60000 });
    expect(res.status).toBe(201);
    expect(writes[0][0]).toBe('felix');
    expect(writes[0][1]).toMatchObject({ result: 'win', moves: 24 });
  });

  it('refuses without a user, so nothing is filed anonymously', async () => {
    const writes = [];
    const app = appWith({ engine: {}, configService: stubConfig(), recordStore: { save: (u, r) => writes.push([u, r]) } });
    const res = await request(app).post('/api/v1/chess/games').send({ result: 'win', moves: 24 });
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it('rejects a traversal in the user segment', async () => {
    const writes = [];
    const app = appWith({ engine: {}, configService: stubConfig(), recordStore: { save: (u, r) => writes.push([u, r]) } });
    const res = await request(app).post('/api/v1/chess/games?user=../../../../tmp').send({ result: 'win' });
    expect(res.status).toBe(400);
    expect(writes).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run backend/src/4_api/v1/routers/chess.test.mjs`
Expected: FAIL — the route does not exist.

- [ ] **Step 7: Add the route**

In `chess.mjs`, take a `recordStore` alongside the existing dependencies and add:

```javascript
router.post('/games', asyncHandler(async (req, res) => {
  const userId = resolveUser(req, res);       // same guard as the other routes: 400 on a bad segment
  if (userId === undefined) return undefined; // resolveUser already answered
  if (!userId) return res.status(400).json({ error: 'user_required' });
  await recordStore.save(userId, req.body || {});
  logger?.info?.('chess.game.recorded', { userId, result: req.body?.result, moves: req.body?.moves });
  return res.status(201).json({ saved: true });
}));
```

Wire the real store in `app.mjs` beside the existing chess registration, writing one file per game:

```javascript
recordStore: {
  save: (userId, record) => dataService.user.write(
    `apps/chess/games/${new Date().toISOString().slice(0, 10)}-${Date.now()}`,
    { ...record, user_id: userId, created_at: new Date().toISOString() },
    userId,
  ),
},
```

- [ ] **Step 8: Run both suites to verify they pass**

Run: `npx vitest run backend/src/4_api/v1/routers/chess.test.mjs frontend/src/modules/Piano/PianoChessGame/chessGameRecord.test.js`
Expected: PASS.

- [ ] **Step 9: Add the client function**

The screen needs a way to post it. Add to `frontend/src/modules/Piano/PianoChessGame/chessApi.js`,
alongside the existing three, following their shape exactly — `DaylightAPI`, resolve `null` on
failure, log through the module logger:

```javascript
export async function saveGameRecord(userId, record) {
  try {
    return await DaylightAPI(withUser('api/v1/chess/games', userId), record, 'POST');
  } catch (error) {
    logger().warn('chess.game.save-error', { error: error.message });
    return null;
  }
}
```

Add a test to `chessApi.test.js` mirroring the existing `saveChessConfig` one: it POSTs to
`api/v1/chess/games?user=felix` with the record body, and resolves `null` rather than throwing when
the transport fails.

- [ ] **Step 10: Run the API suites**

Run: `npx vitest run backend/src/4_api/v1/routers/chess.test.mjs frontend/src/modules/Piano/PianoChessGame/`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/modules/Piano/PianoChessGame/ backend/src/4_api/v1/routers/chess.mjs backend/src/4_api/v1/routers/chess.test.mjs backend/src/app.mjs
git commit -m "feat(chess): a finished game leaves a record of moves and help taken"
```

---

### Task 5: Wire the screen — two zones, gestures, narrowing, record

**Files:**
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.jsx`
- Modify: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.scss`
- Modify: `frontend/src/modules/Piano/components/ChordNamePanel.jsx` (optional `label` prop)
- Modify: `frontend/src/modules/Piano/PianoChessGame/chessApi.js` (post the record)
- Test: `frontend/src/modules/Piano/PianoChessGame/PianoChessGame.test.jsx` (extend)

**Interfaces:**
- Consumes: `candidateSquares(heldNotes, scheme)` (Task 1); `recognizeGesture(heldNotes)` (Task 2); the board's `candidates` / `hintTargets` / `bestMove` props (Task 3); `buildGameRecord(...)` and `POST /games` (Task 4).
- Produces: nothing later tasks consume — this is the last task.

- [ ] **Step 1: Write the failing tests**

Append to `PianoChessGame.test.jsx` (the file already mocks `../PianoKiosk/PianoMidiContext.jsx` and `./chessApi.js` — follow that pattern):

```javascript
describe('help is asked for, never volunteered', () => {
  it('shows no hint marks on a fresh board', () => {
    const { container } = render(<PianoChessGame />);
    expect(container.querySelectorAll('.chess-board__square--hint')).toHaveLength(0);
    expect(container.querySelectorAll('.chess-board__square--source')).toHaveLength(0);
  });

  it('stays quiet even when the old force-on seam is used — the auto-reveal is gone, not reconfigured', () => {
    // `feedback` was the test seam that forced legality cues on. After this task
    // it can no longer produce a mark, because marks are a gesture channel.
    const { container } = render(<PianoChessGame feedback={{ highlightSources: true, highlightTargets: true }} />);
    expect(container.querySelectorAll('.chess-board__square--hint')).toHaveLength(0);
    expect(container.querySelectorAll('.chess-board__square--source')).toHaveLength(0);
  });
});

describe('the instrument zone', () => {
  it('names what was played even when it is not a square', () => {
    const { container } = render(<PianoChessGame />);
    expect(container.querySelector('.piano-chord-name')).not.toBeNull();
  });

  it('keeps no left rail', () => {
    const { container } = render(<PianoChessGame />);
    expect(container.querySelector('.piano-chess__rail--move')).toBeNull();
  });
});
```

Both tests are deterministic renders — no MIDI driving, no timers — because the behaviour being
guarded is structural: after this task there is no code path that can produce a mark without a
gesture.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/PianoChessGame.test.jsx`
Expected: FAIL — the left rail still renders and no `.piano-chord-name` is present.

- [ ] **Step 3: Wire the component**

Held notes already exist as `heldNotes`. Add:

```javascript
const gesture = recognizeGesture(heldNotes);
const candidates = gesture ? [] : candidateSquares(heldNotes, liveScheme);
```

Hint state is armed by a gesture and cleared when a move lands:

```javascript
// Help is per-move, not per-press: mashing the cluster cannot inflate the tally,
// and the marks clear themselves when the move they helped with completes.
const [help, setHelp] = useState({ legal: false, best: null });
const [helpUsed, setHelpUsed] = useState({ hints: 0, bestMoves: 0 });
useEffect(() => {
  if (gesture === 'hint' && !help.legal) {
    setHelp((prev) => ({ ...prev, legal: true }));
    setHelpUsed((prev) => ({ ...prev, hints: prev.hints + 1 }));
  }
  if (gesture === 'best' && !help.best) {
    requestOpponentMove({ fen: game.game.fen, rung: 'ruthless', gameId, userId }).then((move) => {
      if (move) setHelp((prev) => ({ ...prev, best: { from: move.from, to: move.to } }));
    });
    setHelpUsed((prev) => ({ ...prev, bestMoves: prev.bestMoves + 1 }));
  }
}, [gesture]);
useEffect(() => { setHelp({ legal: false, best: null }); }, [game.history.length]);
```

Best move asks at `ruthless` deliberately — a hint only as strong as a beginner's opponent is not a
hint.

Pass to the board: `candidates`, `cursorSquare`, `hintTargets={help.legal ? destinationsFor(game, game.origin) : []}`,
`bestMove={help.best}`. Remove `sourceSquares` and the `showLegality` state entirely, along with the
post-refusal reveal.

**Retire `hint_level` across all four places it lives**, or it will keep configuring behaviour that
no longer exists:

1. `ChessSettingsPanel.jsx` — delete the "Show legal moves" group and its three buttons, and the
   two tests covering them in `ChessSettingsPanel.test.jsx`. The other three controls stay.
2. `chessCues.js` — delete `HINT_CUES` and the `hint_level` branch; `cuesFromConfig` now returns
   only `{ flashRejected, toast }`. Update `chessCues.test.js` to match, keeping the coverage of the
   two surviving keys.
3. `PianoChessGame.jsx` — the `gateOnMistake` condition disappears with `showLegality`.
4. `data/household/config/chess.yml` — remove the `hint_level` line via `docker exec` (write the
   whole file; never `sed -i` on YAML). A user override still carrying the key is simply ignored,
   which is correct: it selects behaviour that no longer exists.

**`cursorResolved` is superseded and goes.** It existed to tell "still settling" apart from "settled
and unmapped", because `cursor` was null in both cases. Narrowing answers that directly and
instantly: `candidates.length === 0` means no square can contain these notes. Pass
`settling={heldNotes.length >= 3 && candidates.length > 0 && !cursor}` to `ChordReadout` and delete
the state and its effect.

**The ghost preview keeps working.** It is rendered by `ChessBoard` from the `ghost` prop and is not
part of the class vocabulary Task 3 rewrote, so it survives untouched — but re-run the ghost tests
after the rewrite to be sure the square's `position: relative` and stacking still hold.

Delete the left rail (`.piano-chess__rail--move`), moving the prompt line and the cancel button into
the right rail. In the instrument footer, render `ChordNamePanel` beside `ChordReadout`:

```jsx
<footer className="piano-chess__instrument">
  <div className="piano-chess__instrument-readouts">
    <ChordNamePanel midiNotes={heldNotes} label="Playing" />
    <ChordReadout heldNotes={heldNotes} chord={cursorChord} square={cursor} connected={connected} />
  </div>
  <PianoKeyboard activeNotes={activeNotes} startNote={36} endNote={84} showLabels />
</footer>
```

Give `ChordNamePanel` an optional `label = 'Chord'` prop rendered in place of the hardcoded eyebrow.

On game over, post the record once:

```javascript
useEffect(() => {
  if (!game.status?.game_over || recordedRef.current) return;
  recordedRef.current = true;
  const record = buildGameRecord({ game, rungId, hints: helpUsed.hints, bestMoves: helpUsed.bestMoves, startedAt: startedAtRef.current, endedAt: Date.now() });
  if (record && userId) saveGameRecord(userId, record);
}, [game.status?.game_over]);
```

In `PianoChessGame.scss`, change the root to two rows and give the instrument a real height in
container units — **no `vh`**:

```scss
.piano-chess { grid-template-rows: 1fr auto; }
.piano-chess__instrument { display: flex; flex-direction: column; gap: 0.35rem; }
.piano-chess__instrument-readouts { display: flex; align-items: baseline; justify-content: center; gap: 1.5rem; }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoChessGame/`
Expected: PASS.

- [ ] **Step 5: Verify it on the deployed page**

Build, check the deploy gate, deploy, then load `https://daylightlocal.kckern.net/piano/games/chess`
and confirm by looking: the keyboard is legible with note names, the board fits above it, no hint
marks appear until a cluster is played, and the rank axis reads `maj m sus4 add2 7 6 maj7 dim` in
lower case. Paste what you observed into the report.

- [ ] **Step 6: Update the reference doc**

Add the gestures, the channels and the game record to the Piano Chess section of
`docs/reference/piano/piano-games.md`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Piano/ docs/reference/piano/piano-games.md
git commit -m "feat(chess): two-zone layout, narrowing candidates, help on request"
```

---

## Deployment

Build and deploy per `CLAUDE.local.md`, checking the deploy gate first — never redeploy while a
fitness session is active or a video is playing:

```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```

Clear means zero render lines, no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`.
Afterwards reload the piano tablet kiosk, which otherwise serves the old bundle.
