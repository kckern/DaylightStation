# Performance Assessment Service Adoption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate piano grading/matching/aggregation into the existing `frontend/src/modules/Piano/performance/` module and give the Hanon lesson drill scored runs for the first time.

**Architecture:** `Piano/performance/` already holds the timed judge (`performanceJudge.js`, `performanceTargets.js`) used by polish and hero mode. This plan relocates the card-game grading math, the flashcard held-chord matcher, and polish's span aggregation into that module (no math changes), adds one new untimed runner (`drillRun`), and rebinds the lesson drill and card-game provider to the shared code. Spec: `docs/superpowers/specs/2026-08-11-performance-assessment-service-design.md` (v2).

**Tech Stack:** Plain ES modules (pure, DOM-free), React only at the surface bindings, vitest.

## Global Constraints

- Working directory: `/opt/Code/DaylightStation/.claude/worktrees/sheetmusic-wave3` (git worktree, branch `sheetmusic-learn-hand-deadlock`). Never cd to the main repo.
- Run tests with `./node_modules/.bin/vitest run <paths>` from the worktree root. Do NOT pass `--reporter=basic` (unsupported in this vitest).
- **No grading-math changes.** All pre-existing tests must pass unchanged; a numeric diff in any existing grade is a bug, full stop.
- New user-facing events use the logging framework (`getLogger().child(...)`), never raw console.
- Commit after every task. End commit messages with:
  `Co-Authored-By: Claude <noreply@anthropic.com>`
- Do NOT deploy; deployment is handled outside this plan.

---

### Task 1: Move grading math into the service, add declared weights

**Files:**
- Create: `frontend/src/modules/Piano/performance/grading.js`
- Create: `frontend/src/modules/Piano/performance/grading.test.js`
- Modify: `frontend/src/modules/Piano/challenge/provider/pianoChallengeGrading.js` (becomes a re-export shim)
- Delete: `frontend/src/modules/Piano/challenge/provider/pianoChallengeGrading.test.js` (its cases move into the new test file)

**Interfaces:**
- Consumes: nothing new.
- Produces (later tasks rely on these exact exports from `performance/grading.js`):
  - `timingQuality(actualAt, targetAt, beatMs) → number|null`
  - `gradeOrderedPerformance({ expectedCount, wrongNotes, timingQualities, paced, weights }) → { score, pitchAccuracy, timingAccuracy, continuity }`
  - `gradeChordPerformance({ targetNotes, wrongAttempts, onsetSpanMs }) → { score, pitchSetAccuracy, simultaneity }`
  - `gradeBand(score, thresholds?) → 'green'|'yellow'|'red'`

- [ ] **Step 1: Copy the existing grading module and its test into `performance/`**

Copy `frontend/src/modules/Piano/challenge/provider/pianoChallengeGrading.js` verbatim to `frontend/src/modules/Piano/performance/grading.js`, and copy `pianoChallengeGrading.test.js` to `frontend/src/modules/Piano/performance/grading.test.js`, updating that test file's import path to `./grading.js`.

- [ ] **Step 2: Run the moved tests to establish the baseline passes**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/performance/grading.test.js`
Expected: PASS (identical math, new location).

- [ ] **Step 3: Write failing tests for `weights` and `gradeBand`**

Append to `frontend/src/modules/Piano/performance/grading.test.js`:

```js
describe('declared weights', () => {
  it('defaults reproduce the untimed constants exactly', () => {
    const a = gradeOrderedPerformance({ expectedCount: 8, wrongNotes: 2, paced: false });
    const b = gradeOrderedPerformance({ expectedCount: 8, wrongNotes: 2, paced: false, weights: null });
    expect(b).toEqual(a);
  });

  it('custom weights change what the drill is about', () => {
    // All weight on continuity: two wrongs out of eight → continuity 0.75, score 0.75.
    const r = gradeOrderedPerformance({
      expectedCount: 8, wrongNotes: 2, paced: false,
      weights: { pitch: 0, timing: 0, continuity: 1 },
    });
    expect(r.score).toBeCloseTo(0.75, 5);
  });
});

describe('gradeBand', () => {
  it('maps a score to green/yellow/red on the polish thresholds', () => {
    expect(gradeBand(0.95)).toBe('green');
    expect(gradeBand(0.9)).toBe('green');
    expect(gradeBand(0.7)).toBe('yellow');
    expect(gradeBand(0.59)).toBe('red');
  });
  it('accepts custom thresholds', () => {
    expect(gradeBand(0.7, { green: 0.65, yellow: 0.4 })).toBe('green');
  });
});
```

Add `gradeBand` to the test file's import list.

- [ ] **Step 4: Run to verify the new tests fail**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/performance/grading.test.js`
Expected: FAIL — `gradeBand` is not exported; `weights` is an unknown option (custom-weights case returns the default-weight score).

- [ ] **Step 5: Implement weights + gradeBand in `grading.js`**

Replace `gradeOrderedPerformance` and append `gradeBand`:

```js
const ORDERED_WEIGHTS = {
  untimed: { pitch: 0.70, timing: 0, continuity: 0.30 },
  paced: { pitch: 0.55, timing: 0.30, continuity: 0.15 },
};

export function gradeOrderedPerformance({ expectedCount, wrongNotes = 0, timingQualities = [], paced = false, weights = null }) {
  const required = Math.max(1, Number(expectedCount) || 1);
  const pitchAccuracy = required / (required + Math.max(0, wrongNotes));
  const continuity = clamp01(1 - Math.max(0, wrongNotes) / required);
  const timing = timingQualities.length > 0
    ? timingQualities.reduce((total, value) => total + value, 0) / timingQualities.length
    : (paced ? 0 : null);
  const w = weights || (paced ? ORDERED_WEIGHTS.paced : ORDERED_WEIGHTS.untimed);
  const score = w.pitch * pitchAccuracy + w.timing * (timing ?? 0) + w.continuity * continuity;
  return {
    score: clamp01(score),
    pitchAccuracy,
    timingAccuracy: timing,
    continuity,
  };
}

/** Map a 0–1 score to the polish red/yellow/green bands. */
export function gradeBand(score, thresholds = { green: 0.9, yellow: 0.6 }) {
  return score >= thresholds.green ? 'green' : score >= thresholds.yellow ? 'yellow' : 'red';
}
```

Add `gradeBand` to the default export object. Note the default-weight paths reproduce the old constants bit-for-bit: untimed `0.70·pitch + 0·(timing??0) + 0.30·continuity` equals the old `0.70·pitch + 0.30·continuity`, and paced equals the old `0.55/0.30/0.15`.

- [ ] **Step 6: Run the module tests**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/performance/grading.test.js`
Expected: PASS, including the untouched pre-existing cases.

- [ ] **Step 7: Turn the old module into a shim**

Replace the entire contents of `frontend/src/modules/Piano/challenge/provider/pianoChallengeGrading.js` with:

```js
// Shim — grading moved to Piano/performance/grading.js (assessment service).
// Remove once createPianoChordProvider imports the service directly (Task 6).
export { timingQuality, gradeOrderedPerformance, gradeChordPerformance, gradeBand } from '../../performance/grading.js';
export { default } from '../../performance/grading.js';
```

Delete `frontend/src/modules/Piano/challenge/provider/pianoChallengeGrading.test.js` (its cases now live in `grading.test.js`).

- [ ] **Step 8: Run the provider suite to prove the shim is transparent**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/challenge/provider/`
Expected: PASS with zero modifications to provider code or tests.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/modules/Piano/performance/grading.js frontend/src/modules/Piano/performance/grading.test.js frontend/src/modules/Piano/challenge/provider/pianoChallengeGrading.js
git rm frontend/src/modules/Piano/challenge/provider/pianoChallengeGrading.test.js
git commit -m "refactor(piano): move challenge grading into the performance service

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Move the held-chord matcher into the service

**Files:**
- Create: `frontend/src/modules/Piano/performance/heldSet.js`
- Create: `frontend/src/modules/Piano/performance/heldSet.test.js`
- Modify: `frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.js` (`evaluateChordMatch` delegates)

**Interfaces:**
- Produces: `matchHeldSet(activeNotes, target, options?) → 'idle'|'correct'|'wrong'|'partial'` where `activeNotes: Map<midi, any>`, `target: { root: number, pitchClasses: Set<number> }`, `options: { bassMustBeRoot?: boolean }` (default `true`).
- Task 6 consumes `matchHeldSet` from the provider.

- [ ] **Step 1: Write the failing test**

`frontend/src/modules/Piano/performance/heldSet.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { matchHeldSet } from './heldSet.js';

const cMajor = { root: 0, pitchClasses: new Set([0, 4, 7]) }; // C E G
const held = (...notes) => new Map(notes.map((n) => [n, { velocity: 90 }]));

describe('matchHeldSet', () => {
  it('is idle with nothing held or no target', () => {
    expect(matchHeldSet(held(), cMajor)).toBe('idle');
    expect(matchHeldSet(held(60), null)).toBe('idle');
  });

  it('accepts the full set in any octave, root in the bass', () => {
    expect(matchHeldSet(held(60, 64, 67), cMajor)).toBe('correct'); // C4 E4 G4
    expect(matchHeldSet(held(48, 76, 91), cMajor)).toBe('correct'); // C3 E5 G6
  });

  it('a full set with a non-root bass is wrong by default (inversion rejected)', () => {
    expect(matchHeldSet(held(64, 67, 72), cMajor)).toBe('wrong'); // E4 G4 C5 — E in the bass
  });

  it('bassMustBeRoot:false accepts inversions', () => {
    expect(matchHeldSet(held(64, 67, 72), cMajor, { bassMustBeRoot: false })).toBe('correct');
  });

  it('any wrong pitch class held is wrong; a subset is partial', () => {
    expect(matchHeldSet(held(60, 63), cMajor)).toBe('wrong');   // Eb
    expect(matchHeldSet(held(60, 64), cMajor)).toBe('partial'); // C E only
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/performance/heldSet.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `heldSet.js`**

The body is `evaluateChordMatch` from `flashcardEngine.js` (lines ~168–190), verbatim except for the option:

```js
/**
 * matchHeldSet — held-set chord matching with pitch-class equivalence.
 *
 * Wrongness is judged on what is CURRENTLY held (any wrong pitch class → wrong),
 * completion means every target pitch class is simultaneously down, and by
 * default the lowest held note must be the chord root (inversions rejected).
 * This is the service home of the flashcard engine's chord matcher; note-offs
 * matter here and nowhere else in the assessment model.
 *
 * @param {Map<number, any>} activeNotes
 * @param {{root: number, pitchClasses: Set<number>}|null} target
 * @param {{bassMustBeRoot?: boolean}} [options]
 * @returns {'idle'|'correct'|'wrong'|'partial'}
 */
export function matchHeldSet(activeNotes, target, { bassMustBeRoot = true } = {}) {
  if (!activeNotes || activeNotes.size === 0 || !target?.pitchClasses?.size) {
    return 'idle';
  }
  const heldClasses = new Set();
  let bass = Infinity;
  for (const [note] of activeNotes) {
    heldClasses.add(((note % 12) + 12) % 12);
    if (note < bass) bass = note;
  }
  for (const pc of heldClasses) {
    if (!target.pitchClasses.has(pc)) return 'wrong';
  }
  const complete = [...target.pitchClasses].every((pc) => heldClasses.has(pc));
  if (!complete) return 'partial';
  if (!bassMustBeRoot) return 'correct';
  return ((bass % 12) + 12) % 12 === target.root ? 'correct' : 'wrong';
}

export default { matchHeldSet };
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/performance/heldSet.test.js`
Expected: PASS.

- [ ] **Step 5: Delegate `evaluateChordMatch`**

In `frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.js`, add at the top:

```js
import { matchHeldSet } from '../performance/heldSet.js';
```

Replace the **body** of `evaluateChordMatch` (keep its name, signature, and JSDoc — flashcards and, until Task 6, the provider import it):

```js
export function evaluateChordMatch(activeNotes, card) {
  return matchHeldSet(activeNotes, card);
}
```

- [ ] **Step 6: Run both consumers' suites**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoFlashcards/ frontend/src/modules/Piano/challenge/provider/`
Expected: PASS unchanged.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Piano/performance/heldSet.js frontend/src/modules/Piano/performance/heldSet.test.js frontend/src/modules/Piano/PianoFlashcards/flashcardEngine.js
git commit -m "refactor(piano): home the held-chord matcher in the performance service

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Move span aggregation into the service

**Files:**
- Create: `frontend/src/modules/Piano/performance/spans.js`
- Create: `frontend/src/modules/Piano/performance/spans.test.js`
- Modify: every importer of `./gradeTally.js` / `./worstSpan.js` under `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/` (found by grep in Step 3)
- Delete: `SheetMusic/gradeTally.js`, `SheetMusic/worstSpan.js`, `SheetMusic/gradeTally.test.js`, `SheetMusic/worstSpan.test.js`

**Interfaces:**
- Produces from `performance/spans.js` (exact current signatures, keyed by any integer span index — measure or drill cell):
  - `tallyGrades(grades) → { green, yellow, red, overall }` (`overall` may be `null`)
  - `worstSpan(grades) → { inMeasure, outMeasure } | null`

- [ ] **Step 1: Create `spans.js` by concatenating the two modules verbatim**

Copy the full contents of `SheetMusic/gradeTally.js` (the `tallyGrades` function and its JSDoc) and `SheetMusic/worstSpan.js` (the `WEIGHT` const, `worstSpan`, JSDoc) into `frontend/src/modules/Piano/performance/spans.js`. One default export:

```js
export default { tallyGrades, worstSpan };
```

Keep the field names `inMeasure`/`outMeasure` — renaming them would touch polish's RunSummary contract for zero benefit; the JSDoc gains one line: "Span indices are measures in polish and transposition cells in drills."

- [ ] **Step 2: Create `spans.test.js` from the two existing test files**

Concatenate `gradeTally.test.js` and `worstSpan.test.js` into `frontend/src/modules/Piano/performance/spans.test.js`, changing both import paths to `./spans.js`. Do not alter any case.

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/performance/spans.test.js`
Expected: PASS.

- [ ] **Step 3: Flip the SheetMusic importers**

Find them: `grep -rln "from './gradeTally.js'\|from './worstSpan.js'" frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/`

In each hit, replace the import with the service path (from `SheetMusic/`, that is `../../../performance/spans.js`), e.g.:

```js
import { tallyGrades } from '../../../performance/spans.js';
import { worstSpan } from '../../../performance/spans.js';
```

Then delete the four old files (`gradeTally.js`, `worstSpan.js`, and their test files). No shims here — the importers are all in one directory and flipped in the same commit.

- [ ] **Step 4: Run the full SheetMusic suite**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/`
Expected: PASS. This suite is the polish equivalence guard; any failure means the move was not verbatim.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/modules/Piano/performance/ frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
git commit -m "refactor(piano): generalize span aggregation into the performance service

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: The untimed runner (`drillRun`)

**Files:**
- Create: `frontend/src/modules/Piano/performance/drillRun.js`
- Create: `frontend/src/modules/Piano/performance/drillRun.test.js`

**Interfaces:**
- Consumes: `gradeOrderedPerformance`, `gradeBand` (Task 1); `tallyGrades`, `worstSpan` (Task 3).
- Produces (Task 5 consumes all four):
  - `createDrillRun(spans, options?) → run` — `spans: [{ id, expectedMidi: number[] }]`, `options: { wrongWindow?: number, weights?: object, thresholds?: object }`
  - `applyDrillPress(run, note) → { run, event }` — events: `{type:'ignored'}` · `{type:'wrong', spanIndex}` · `{type:'advance', spanIndex, progress}` · `{type:'span_complete', spanIndex}` · `{type:'complete', summary}`
  - `drillProgress(run) → number` — global step index (for the cursor)
  - `finalizeDrillRun(run) → { grades, tally, worst, score }` — `grades: {spanIndex: {…dims, grade}}` over **completed** spans only; `score: 0–100 | null`

- [ ] **Step 1: Write the failing test (Hanon-shaped fixture)**

`frontend/src/modules/Piano/performance/drillRun.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createDrillRun, applyDrillPress, drillProgress, finalizeDrillRun } from './drillRun.js';

// Two Hanon-style cells of 4 (real cells are 8; 4 keeps cases readable).
const SPANS = [
  { id: 0, expectedMidi: [48, 52, 53, 55] },
  { id: 1, expectedMidi: [50, 53, 55, 57] },
];
const play = (run, notes) => notes.reduce((acc, n) => {
  const r = applyDrillPress(acc.run, n);
  return { run: r.run, events: [...acc.events, r.event] };
}, { run, events: [] });

describe('drillRun', () => {
  it('advances on the expected note and reports global progress', () => {
    const { run, events } = play(createDrillRun(SPANS), [48, 52]);
    expect(events.map((e) => e.type)).toEqual(['advance', 'advance']);
    expect(drillProgress(run)).toBe(2);
  });

  it('counts a near wrong note against the current span without advancing', () => {
    const { run, events } = play(createDrillRun(SPANS), [49]);
    expect(events[0]).toEqual({ type: 'wrong', spanIndex: 0 });
    expect(drillProgress(run)).toBe(0);
    expect(run.spans[0].wrongNotes).toBe(1);
  });

  it('ignores notes outside the plausibility window', () => {
    const { run, events } = play(createDrillRun(SPANS), [100]); // 52 semitones off
    expect(events[0].type).toBe('ignored');
    expect(run.spans[0].wrongNotes).toBe(0);
  });

  it('emits span_complete at a cell boundary and complete at the end', () => {
    const { events } = play(createDrillRun(SPANS), [48, 52, 53, 55, 50, 53, 55, 57]);
    expect(events[3].type).toBe('span_complete');
    expect(events[7].type).toBe('complete');
    expect(events[7].summary.score).toBe(100);
    expect(events[7].summary.tally).toEqual({ green: 2, yellow: 0, red: 0, overall: 'green' });
    expect(events[7].summary.worst).toBeNull();
  });

  it('grades wrongs per span and finds the worst span', () => {
    // Clean first cell; second cell with 3 wrongs → pitch 4/7, continuity 0.25 → red.
    const { events } = play(createDrillRun(SPANS), [48, 52, 53, 55, 51, 51, 51, 50, 53, 55, 57]);
    const { summary } = events.at(-1);
    expect(summary.grades[0].grade).toBe('green');
    expect(summary.grades[1].grade).toBe('red');
    expect(summary.worst).toEqual({ inMeasure: 1, outMeasure: 1 });
    expect(summary.tally.overall).toBe('green'); // tallyGrades' documented rule: greens win ties (1 green, 1 red)
  });

  it('finalize grades only completed spans; an abandoned run scores what was finished', () => {
    const { run } = play(createDrillRun(SPANS), [48, 52, 53, 55, 50]); // cell 2 in progress
    const summary = finalizeDrillRun(run);
    expect(Object.keys(summary.grades)).toEqual(['0']);
    expect(summary.score).toBe(100);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/performance/drillRun.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `drillRun.js`**

```js
import { gradeOrderedPerformance, gradeBand } from './grading.js';
import { tallyGrades, worstSpan } from './spans.js';

/**
 * drillRun — the untimed ordered runner of the performance service.
 *
 * The timed judge (performanceJudge) matches attacks against millisecond
 * targets and needs a tempo map; drills have none, which is why the lesson
 * surface never adopted it. This runner advances span-by-span on exact
 * pitches: a wrong note within the plausibility window counts against the
 * current span (no restart — the lesson-drill policy), and anything farther
 * out is ignored as an unrelated key. Grading and aggregation are the shared
 * service modules, so a drill's verdict speaks the same language as polish.
 */
export function createDrillRun(spans, options = {}) {
  return {
    spans: spans.map((s) => ({
      id: s.id,
      expectedMidi: [...s.expectedMidi],
      progress: 0,
      wrongNotes: 0,
      done: false,
    })),
    spanIndex: 0,
    complete: false,
    wrongWindow: Number.isFinite(options.wrongWindow) ? options.wrongWindow : 24,
    weights: options.weights || null,
    thresholds: options.thresholds || undefined,
  };
}

/** Global step index — the position of the follow cursor over the flattened drill. */
export function drillProgress(run) {
  let total = 0;
  for (let i = 0; i < run.spanIndex; i++) total += run.spans[i].expectedMidi.length;
  return total + (run.spans[run.spanIndex]?.progress || 0);
}

export function applyDrillPress(run, note) {
  if (run.complete || !run.spans.length) return { run, event: { type: 'ignored' } };
  const span = run.spans[run.spanIndex];
  const target = span.expectedMidi[span.progress];

  if (note === target) {
    const spans = [...run.spans];
    const progress = span.progress + 1;
    const done = progress === span.expectedMidi.length;
    spans[run.spanIndex] = { ...span, progress, done };
    const spanIndex = done ? run.spanIndex + 1 : run.spanIndex;
    const complete = done && spanIndex === spans.length;
    const next = { ...run, spans, spanIndex, complete };
    if (complete) return { run: next, event: { type: 'complete', summary: finalizeDrillRun(next) } };
    if (done) return { run: next, event: { type: 'span_complete', spanIndex: run.spanIndex } };
    return { run: next, event: { type: 'advance', spanIndex: run.spanIndex, progress } };
  }

  if (Math.abs(note - target) > run.wrongWindow) return { run, event: { type: 'ignored' } };
  const spans = [...run.spans];
  spans[run.spanIndex] = { ...span, wrongNotes: span.wrongNotes + 1 };
  return { run: { ...run, spans }, event: { type: 'wrong', spanIndex: run.spanIndex } };
}

/** Grade completed spans; an abandoned run scores what was finished. */
export function finalizeDrillRun(run) {
  const grades = {};
  run.spans.forEach((span, i) => {
    if (!span.done) return;
    const dims = gradeOrderedPerformance({
      expectedCount: span.expectedMidi.length,
      wrongNotes: span.wrongNotes,
      paced: false,
      weights: run.weights,
    });
    grades[i] = { ...dims, grade: gradeBand(dims.score, run.thresholds) };
  });
  const graded = Object.values(grades);
  const score = graded.length
    ? Math.round((100 * graded.reduce((sum, g) => sum + g.score, 0)) / graded.length)
    : null;
  return { grades, tally: tallyGrades(grades), worst: worstSpan(grades), score };
}

export default { createDrillRun, applyDrillPress, drillProgress, finalizeDrillRun };
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/performance/drillRun.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/performance/drillRun.js frontend/src/modules/Piano/performance/drillRun.test.js
git commit -m "feat(piano): add the untimed drill runner to the performance service

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: The lesson drill adopts `drillRun` — Hanon gets a score

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Lessons/drillSpans.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Lessons/drillSpans.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Lessons/LessonDrill.jsx`

**Interfaces:**
- Consumes: `createDrillRun`, `applyDrillPress`, `drillProgress` (Task 4); `expandDrill`'s output shape (`expanded.hands.right` = array of cells, each `{ role, notes: [{ midi, … }] }`).
- Produces: `drillSpans(expanded) → [{ id, expectedMidi }]`.

- [ ] **Step 1: Write the failing test for the span builder**

`frontend/src/modules/Piano/PianoKiosk/modes/Lessons/drillSpans.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { drillSpans } from './drillSpans.js';

describe('drillSpans', () => {
  it('maps each expanded right-hand cell to a span of its midi notes', () => {
    const expanded = {
      hands: {
        right: [
          { role: 'ascending', notes: [{ midi: 48 }, { midi: 52 }] },
          { role: 'ascending', notes: [{ midi: 50 }, { midi: 53 }] },
        ],
        left: [{ role: 'ascending', notes: [{ midi: 36 }] }],
      },
    };
    expect(drillSpans(expanded)).toEqual([
      { id: 0, expectedMidi: [48, 52] },
      { id: 1, expectedMidi: [50, 53] },
    ]);
  });

  it('is empty for missing hands and skips noteless cells', () => {
    expect(drillSpans(null)).toEqual([]);
    expect(drillSpans({ hands: { right: [{ role: 'ascending' }] } })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/Lessons/drillSpans.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `drillSpans.js`**

```js
/**
 * drillSpans — one assessment span per expanded transposition cell (right hand,
 * the hand the drill follows). Concatenated spans equal handMidiSequence's
 * flattened right hand, so the follow cursor and the grader walk the same notes.
 */
export function drillSpans(expanded) {
  const cells = expanded?.hands?.right || [];
  return cells
    .map((cell, i) => ({ id: i, expectedMidi: (cell.notes || []).map((n) => n.midi) }))
    .filter((span) => span.expectedMidi.length > 0);
}

export default { drillSpans };
```

**Note:** the `id: i` is assigned before filtering, so a skipped noteless cell leaves a gap in ids but span *indices* in the run stay dense — `worstSpan` operates on run indices, which is what the summary reports.

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/Lessons/drillSpans.test.js`
Expected: PASS.

- [ ] **Step 5: Rewire `LessonDrill.jsx` onto the runner (single matcher, no dual state)**

The component currently matches notes itself (`rhSeq[stepRef.current]`, advance/flash). Replace that matcher with the runner — the run becomes the single source of truth and `step` becomes derived display state. Six edits:

(a) Add imports:

```js
import { createDrillRun, applyDrillPress, drillProgress } from '../../../performance/drillRun.js';
import { drillSpans } from './drillSpans.js';
```

(b) After the `rhSeq` memo, add the spans memo, the run ref, and summary state:

```js
const spans = useMemo(() => (expanded ? drillSpans(expanded) : []), [expanded]);
const runRef = useRef(null);
const [summary, setSummary] = useState(null);
```

(c) Replace the reset effect (`useEffect(() => { setStep(0); setWrong(false); }, [abc]);`) with one that also rebuilds the run:

```js
// Reset progress whenever the engraved exercise changes; the run is the
// matcher's single source of truth and `step` is derived display state.
useEffect(() => {
  runRef.current = spans.length ? createDrillRun(spans) : null;
  setStep(0);
  setWrong(false);
  setSummary(null);
}, [abc, spans]);
```

(d) Replace the follow-mode subscribe effect entirely:

```js
// Follow mode: the drill run advances on the correct right-hand note, counts a
// plausible wrong one (within two octaves) against the current cell, and hands
// back a graded summary on the last note. Mirrors the Sheet Music ScorePlayer.
useEffect(() => {
  if (!rhSeq.length) return undefined;
  return subscribe((evt) => {
    if (evt.type !== 'note_on' || !evt.velocity) return;
    const run = runRef.current;
    if (!run) return;
    const { run: next, event } = applyDrillPress(run, evt.note);
    runRef.current = next;
    if (event.type === 'wrong') flashWrong();
    else if (event.type === 'advance' || event.type === 'span_complete') setStep(drillProgress(next));
    else if (event.type === 'complete') {
      setStep(drillProgress(next));
      setSummary(event.summary);
      logger.info('piano.drill-complete', {
        collection, id: drillId,
        score: event.summary.score,
        tally: event.summary.tally,
        worst: event.summary.worst,
      });
    }
  });
}, [rhSeq, spans, subscribe, flashWrong, logger, collection, drillId]);
```

(e) Update the Restart button to rebuild the run:

```jsx
<button
  type="button"
  className="lesson-drill__reset"
  onClick={() => {
    runRef.current = spans.length ? createDrillRun(spans) : null;
    setStep(0);
    setSummary(null);
  }}
  aria-label="Restart drill"
>⟲ Restart</button>
```

(f) Render the summary under the transport row (after the `lesson-drill__transport` div):

```jsx
{summary && summary.score != null && (
  <p className="lesson-drill__result">
    Score {summary.score}
    {summary.worst
      ? ` — trouble at climb ${summary.worst.inMeasure + 1}–${summary.worst.outMeasure + 1}`
      : ' — clean run'}
  </p>
)}
```

The equivalence to the old behavior: spans concatenated equal `rhSeq` (same source, `expanded.hands.right`), exact-match advance and the ±24 window are unchanged, so the cursor, wrong-flash, and `done` conditions behave identically — the run adds grading, it does not change following.

- [ ] **Step 6: Run the Lessons and MusicNotation suites**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/Lessons/ frontend/src/modules/MusicNotation/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Lessons/
git commit -m "feat(piano): grade Hanon drill runs

The lesson drill adopts the performance service's untimed runner: each
transposition cell is a span, wrong notes count against the cell they
interrupt, and finishing hands back a run score with the worst climb —
the first time drill content has awarded anything.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: The card-game provider imports the service directly

**Files:**
- Modify: `frontend/src/modules/Piano/challenge/provider/createPianoChordProvider.jsx`
- Modify: `frontend/src/modules/Piano/challenge/provider/createPianoChordProvider.test.jsx` (only if it asserts the version string)
- Delete: `frontend/src/modules/Piano/challenge/provider/pianoChallengeGrading.js` (the Task 1 shim)

**Interfaces:**
- Consumes: `matchHeldSet` (Task 2), `gradeChordPerformance` / `gradeOrderedPerformance` / `timingQuality` (Task 1).
- Produces: attempts stamped `provider_version: '6-shared-performance-grading'`.

- [ ] **Step 1: Flip the imports**

In `createPianoChordProvider.jsx`, replace:

```js
import { evaluateChordMatch } from '../../PianoFlashcards/flashcardEngine.js';
import { gradeChordPerformance, gradeOrderedPerformance, timingQuality } from './pianoChallengeGrading.js';
```

with:

```js
import { matchHeldSet } from '../../performance/heldSet.js';
import { gradeChordPerformance, gradeOrderedPerformance, timingQuality } from '../../performance/grading.js';
```

and rename every `evaluateChordMatch(` call site in this file to `matchHeldSet(` (same signature; default options reproduce the flashcard behavior exactly). **Touch nothing else** — the verifier lifecycle (arm-after-release, layout-effect commit paths) is hardened and stays as-is.

- [ ] **Step 2: Bump the provider version**

```js
const PROVIDER_VERSION = '6-shared-performance-grading';
```

Grep the provider test for the old string and update any assertion:
`grep -n "5-virtual-keyboard-fallback" frontend/src/modules/Piano/challenge/provider/`

- [ ] **Step 3: Delete the shim**

```bash
git rm frontend/src/modules/Piano/challenge/provider/pianoChallengeGrading.js
```

Then verify nothing else imported it: `grep -rn "pianoChallengeGrading" frontend/src/ --include=*.js --include=*.jsx` — expected: no hits.

- [ ] **Step 4: Run the provider, flashcards, and Gaming suites**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano/challenge/ frontend/src/modules/Piano/PianoFlashcards/ frontend/src/modules/Gaming/`
Expected: PASS (version-string assertions updated in Step 2 are the only permitted test diffs).

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/modules/Piano/challenge/provider/
git commit -m "refactor(piano): point the challenge provider at the performance service

Provider version bumps to 6-shared-performance-grading so recorded
attempts stay attributable across the import flip. Grading math and the
verifier lifecycle are unchanged.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Reference doc + full-suite sweep

**Files:**
- Create: `docs/reference/piano/performance-assessment.md`
- Modify: `docs/superpowers/specs/2026-08-11-performance-assessment-service-design.md` (status line only)

- [ ] **Step 1: Write the reference doc**

`docs/reference/piano/performance-assessment.md` — endstate style (present tense, capabilities and locations, no code walkthrough):

```markdown
# Performance Assessment

The performance service (`frontend/src/modules/Piano/performance/`) judges a live
performance against an expected one. It is pure and DOM-free; surfaces bind it to
notation, keyboards, or game chrome as they see fit.

## Runners

- **Timed** — matches note attacks against millisecond targets compiled from an
  engraved score (tempo map in, perfect/good/miss windows). Used by Sheet Music
  polish and the hero game.
- **Untimed** — advances span-by-span through ordered expected pitches with no
  tempo map. A wrong note within two octaves of the target counts against the
  current span; anything farther is ignored as an unrelated key. Used by lesson
  drills.

## Matching

Held-set matching judges chords on what is currently held: pitch-class
equivalence, any wrong pitch class held is wrong, completion means the full set
is down at once, and by default the lowest note must be the chord root
(inversions rejected — an option relaxes this). Note releases matter only here.

## Grading and spans

Grading is dimensional — pitch accuracy, timing, continuity, simultaneity — with
weights an exercise may declare to say what it is about; defaults reproduce the
long-standing constants. Scores band to green/yellow/red on shared thresholds.

Assessment aggregates over spans: measures in a score, transposition cells in a
drill, one span for a bare exercise. A run tallies to an overall grade and
surfaces its heaviest contiguous block of trouble — the natural thing to go
drill next.

## Boundaries

Sequence matching is attack-only: ornaments, sustain pedal, and note durations
are not assessed. An onset group spanning two measures belongs to neither and is
excluded from per-measure grading. Timing math differs between the timed runner
(fixed windows) and challenge grading (beat-relative quality); unifying them is
a grading-policy version change, not a refactor.

## Producers

The service consumes expected-performance material; it never authors it. Scores
arrive via the target compiler, drills via seed expansion, card-game challenges
via the backend's adaptive policy.
```

- [ ] **Step 2: Mark the spec implemented**

In the spec's header, change `**Status:** Revised after adversarial review; supersedes v1 in place.` to `**Status:** Implemented — see docs/reference/piano/performance-assessment.md and docs/superpowers/plans/2026-08-11-performance-assessment-adoption.md.`

- [ ] **Step 3: Full-suite sweep (the whole-plan equivalence gate)**

Run: `./node_modules/.bin/vitest run frontend/src/modules/Piano frontend/src/modules/Gaming frontend/src/modules/MusicNotation`
Expected: PASS. Baseline before this plan was 3,174 Piano+Gaming tests passing; the count grows (new modules) and nothing pre-existing fails.

- [ ] **Step 4: Commit**

```bash
git add docs/reference/piano/performance-assessment.md docs/superpowers/specs/2026-08-11-performance-assessment-service-design.md
git commit -m "docs(piano): document the performance assessment service

Co-Authored-By: Claude <noreply@anthropic.com>"
```
