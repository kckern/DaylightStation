# OMR Key-Alignment Suspect Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect, at grading time, a paper worksheet whose marked answers would
score meaningfully better under a ±1/±2 row shift than they do literally, and
hold the outcome for a teacher's sign-off instead of silently finalizing it —
without ever auto-accepting the shifted reading as correct.

**Architecture:** A new pure domain function scores every row-shift hypothesis
against a worksheet's own answer key. `ResolveCardScan` calls it once a
record's rows are graded and attaches the result to that record. The existing
review-queue/`awaiting-review` session halt (already used for ambiguous
bubbles and free-response items) gets one more entry reason, so the session
stops at `submitted` (no receipt, no remediation hook) until a teacher clears
it — but the synthetic queue entry needs two small, real fixes elsewhere
(`GradeSubmission.mjs`'s denominator, and where the entry's text can surface)
that a first pass at this plan got wrong. Both are in Task 3 below.

**Tech Stack:** Node ESM backend, Vitest, School domain/application layers
(DDD: `2_domains` → `3_applications`).

**Spec:** `docs/_wip/plans/2026-09-21-omr-answer-key-alignment-check.md`

**Correction to the spec (§3.4), discovered during planning:** the spec
proposed reusing `ReviewHeldCardScan`/`heldScanStore`. That store only ever
holds a scan **before** grading, for card-identity ambiguity — its creation
path lives entirely inside `ResolveCardScan#identityPreflight`, and
`SchoolPrintScanConsumer` never creates a held record itself. This is a
different kind of hold: grading already happened correctly, and what needs a
human is a plausibility question about the whole sheet. The real fit is the
existing ambiguous-row review queue (`IReviewQueue`, `RecordCardScanOutcome
#bridgeSession`): a sheet with any pending review-queue item halts at
`submitted` instead of advancing to `graded` — the "hold before the outcome
is final" behavior the spec asked for, using code that already exists for
the same purpose.

**Second correction, found by adversarial review of this plan itself:** the
first draft assumed dropping a synthetic, non-bank-item entry into that
queue was purely additive and invisible elsewhere. It is not. For a
print/paper unit, `GradeSubmission.mjs` computes the score's denominator
from **every** queued item's `itemId` (`GradeSubmission.mjs:248-249`), so an
unfixed synthetic entry would change the score the moment a teacher resolves
it. And a queue item's `prompt` can reach the child's own feedback rail
(`StudentPanel.jsx`'s `item.note || item.prompt || ...` fallback) if a
teacher marks it `correct`/`incorrect` instead of `void` (only `void`
requires a note). Task 3 below fixes both: a denominator exclusion in
`GradeSubmission.mjs`, and routing the evidence sentence through `rubric`
(grown-up-facing guidance, never read by `StudentPanel`) instead of `prompt`.

## Global Constraints

- `MIN_ITEMS = 5` and `MARGIN = 2` are provisional starting values (spec §4)
  — module-level exported constants, easy to retune later.
- No auto-regrade: the shifted reading is never written as truth anywhere.
- Row-shift comparison never reaches outside one worksheet's own row range.
- Not for on-screen quizzes — paper/OMR only.
- The check only ever runs over fully-marked rows (no blanks) — not because
  it would break anything (a genuinely blank/partial scan already exits
  `RecordCardScanOutcome#bridgeSession` before the review queue is ever
  touched, via the pre-existing `partial-scan` branch), but because logging
  a `school.scan.key-alignment-suspected` warn on a still-mid-fill sheet
  during an earlier scan pass would be pure noise with no downstream effect.

---

### Task 1: Pure domain function `omrKeyAlignmentSuspect`

**Files:**
- Create: `backend/src/2_domains/school/omrKeyAlignment.mjs`
- Test: `backend/src/2_domains/school/omrKeyAlignment.test.mjs`

**Interfaces:**
- Produces: `export const MIN_ITEMS`, `export const MARGIN`, `export const
  PASSING_FLOOR`, `export function omrKeyAlignmentSuspect(rows, { minItems,
  margin, passingFloor } = {})` → `{ offset: number, literalMatches: number,
  shiftedMatches: number, itemCount: number } | null`. `rows` is
  `Array<{ row: number, given: string, correctLetter: string }>`.

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/2_domains/school/omrKeyAlignment.test.mjs
import { describe, it, expect } from 'vitest';
import { omrKeyAlignmentSuspect, MIN_ITEMS, MARGIN } from './omrKeyAlignment.mjs';

// The real 2026-09-21 New York-lesson scan (session ses_qkd1wl1fzz, rows
// 22-27): a parent suspected a row-shift mistake. Hand verification found
// none — this is the must-NOT-trigger regression fixture that matters most.
// Recomputed by hand during review: literal=2; offset -2 -> 0, -1 -> 1,
// +1 -> 0, +2 -> 1. No offset reaches MARGIN(2). Confirmed null.
const learner1NewYorkRows = [
  { row: 22, given: 'C', correctLetter: 'C' },
  { row: 23, given: 'A', correctLetter: 'B' },
  { row: 24, given: 'B', correctLetter: 'B' },
  { row: 25, given: 'C', correctLetter: 'A' },
  { row: 26, given: 'C', correctLetter: 'A' },
  { row: 27, given: 'C', correctLetter: 'D' },
];

describe('omrKeyAlignmentSuspect', () => {
  it('does not flag a real 2/6 sheet whose misses are genuine content misses', () => {
    expect(omrKeyAlignmentSuspect(learner1NewYorkRows)).toBeNull();
  });

  it('flags a synthetic sheet whose marks are the key shifted down one row', () => {
    // correct[row] for rows 1-6: A,B,C,D,A,B. given[row] = correct[row-1] for
    // rows 2-6 (a learner who wrote each answer one row late); row 1 has no
    // row 0 to draw from, so it is deliberately wrong. Recomputed by hand:
    // literal=0; offset -1 gives 5 matches (rows 2-6); offsets -2/+1/+2 give
    // fewer. -1/5/0/6 is the correct result.
    const rows = [
      { row: 1, given: 'E', correctLetter: 'A' },
      { row: 2, given: 'A', correctLetter: 'B' },
      { row: 3, given: 'B', correctLetter: 'C' },
      { row: 4, given: 'C', correctLetter: 'D' },
      { row: 5, given: 'D', correctLetter: 'A' },
      { row: 6, given: 'A', correctLetter: 'B' },
    ];
    expect(omrKeyAlignmentSuspect(rows)).toEqual({
      offset: -1, literalMatches: 0, shiftedMatches: 5, itemCount: 6,
    });
  });

  it('never flags a worksheet below MIN_ITEMS, however clean the shift', () => {
    const rows = [
      { row: 1, given: 'E', correctLetter: 'A' },
      { row: 2, given: 'A', correctLetter: 'B' },
      { row: 3, given: 'B', correctLetter: 'C' },
      { row: 4, given: 'C', correctLetter: 'D' },
    ];
    expect(rows.length).toBe(MIN_ITEMS - 1);
    expect(omrKeyAlignmentSuspect(rows, { minItems: MIN_ITEMS })).toBeNull();
  });

  it('never lets a shift reach outside the worksheet\'s own row range', () => {
    // 4-row sheet, whose key repeats a pattern such that a NAIVE (unbounded)
    // +1 shift would look clean if row 4 were allowed to "match" a row 5
    // that does not exist. The boundary rule means row 4 contributes no
    // shifted match at offset +1 at all — verified below by checking the
    // exact shiftedMatches count, not just null/non-null.
    const rows = [
      { row: 1, given: 'B', correctLetter: 'A' },
      { row: 2, given: 'C', correctLetter: 'B' },
      { row: 3, given: 'D', correctLetter: 'C' },
      { row: 4, given: 'A', correctLetter: 'D' },
    ];
    // At offset +1: row1->row2(correct B, given B: match), row2->row3(correct
    // C, given C: match), row3->row4(correct D, given D: match), row4->row5
    // (out of range: excluded). shiftedMatches must be 3, not 4 — if the
    // boundary guard were missing and row 4 wrapped to a phantom row 5 that
    // happened to be treated as matching, this would be 4 instead.
    const result = omrKeyAlignmentSuspect(rows, { minItems: 4 });
    expect(result).toEqual({ offset: 1, literalMatches: 0, shiftedMatches: 3, itemCount: 4 });
  });

  it('does not flag an already-passing sheet even when a shift would score higher still', () => {
    // 9/12 correct literally (75%) — a real pass on most grading scales.
    // Constructed so shifting by -1 would raise 3 of the wrong rows to
    // correct, pushing shiftedMatches to 12 — margin(2) alone does NOT rule
    // this out (12 - 9 = 3 >= 2), which is exactly the false "structural"
    // proof an earlier draft of this file relied on. PASSING_FLOOR is the
    // real guard: literalMatches/itemCount (0.75) is at or above it, so this
    // must return null regardless of how large the shifted score is.
    const correct = ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 'A', 'B', 'C', 'D'];
    const rows = correct.map((letter, index) => ({
      row: index + 1,
      given: index < 9 ? letter : correct[index - 1], // last 3 rows: shifted-late guess
      correctLetter: letter,
    }));
    expect(omrKeyAlignmentSuspect(rows)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run backend/src/2_domains/school/omrKeyAlignment.test.mjs`
Expected: FAIL — `omrKeyAlignment.mjs` does not exist yet.

- [ ] **Step 3: Write the implementation**

```js
// backend/src/2_domains/school/omrKeyAlignment.mjs
/**
 * Detect a worksheet whose marked answers would score meaningfully better
 * under a small row shift than they do literally — the "I put answers in
 * the wrong number ranges" failure mode. Compares against the worksheet's
 * OWN answer key, never a prior scan (that is `omrAlignment.mjs`'s job, a
 * different failure mode: a scanner misreading a card it read correctly
 * before). Never reaches outside this worksheet's own rows.
 *
 * PASSING_FLOOR is a real, separate guard — NOT implied by MARGIN. A shift
 * can gain at most `itemCount - |offset|` matches, which is not bounded
 * tightly enough by MARGIN alone to rule out flagging an already-passing
 * sheet on a large-enough worksheet (verified by a failing proof caught in
 * review; see the "already-passing sheet" test).
 */
const OFFSETS = [-2, -1, 1, 2];

export const MIN_ITEMS = 5;
export const MARGIN = 2;
export const PASSING_FLOOR = 0.7;

export function omrKeyAlignmentSuspect(rows, {
  minItems = MIN_ITEMS, margin = MARGIN, passingFloor = PASSING_FLOOR,
} = {}) {
  if (!Array.isArray(rows) || rows.length < minItems) return null;

  const byRow = new Map(rows.map((row) => [row.row, row]));
  const rowNumbers = rows.map((row) => row.row);
  const minRow = Math.min(...rowNumbers);
  const maxRow = Math.max(...rowNumbers);
  const itemCount = rows.length;
  const literalMatches = rows.filter((row) => row.given === row.correctLetter).length;
  if (literalMatches / itemCount >= passingFloor) return null;

  let best = null;
  for (const offset of OFFSETS) {
    let shiftedMatches = 0;
    for (const row of rows) {
      const shiftedRow = row.row + offset;
      if (shiftedRow < minRow || shiftedRow > maxRow) continue;
      const target = byRow.get(shiftedRow);
      if (target && row.given === target.correctLetter) shiftedMatches += 1;
    }
    if (shiftedMatches - literalMatches >= margin && (!best || shiftedMatches > best.shiftedMatches)) {
      best = { offset, literalMatches, shiftedMatches, itemCount };
    }
  }
  return best;
}

export default omrKeyAlignmentSuspect;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run backend/src/2_domains/school/omrKeyAlignment.test.mjs`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/school/omrKeyAlignment.mjs backend/src/2_domains/school/omrKeyAlignment.test.mjs
git commit -m "feat(school): add omrKeyAlignmentSuspect row-shift detector"
```

---

### Task 2: Wire into `ResolveCardScan#resolveRecord`

**Files:**
- Modify: `backend/src/3_applications/school/documents/ResolveCardScan.mjs`
  (import near line 40, alongside `omrAlignmentError`; logic inside
  `#resolveRecord`, lines 1025-1247)
- Test: `backend/src/3_applications/school/documents/
  ResolveCardScan.keyAlignment.test.mjs` — **use the real fixture harness**
  from `ResolveCardScan.test.mjs`/`ResolveCardScan.decodeConfidence.test.mjs`
  (`sourceDoc`, `mcQuestion`, `fakeRepository`, `fakeAllocationStore`,
  `publishAndAllocate`) — a first draft of this task invented a bank/document
  shape (`options`/`letter`, `blocks: [{type:'questions'}]`) that does not
  match the real domain and would have produced `ALLOCATION_ROW_MAPPING_DRIFT`
  for every fixture. Do not reinvent this harness; copy it.

**Interfaces:**
- Consumes: `omrKeyAlignmentSuspect(rows)` from Task 1.
- Produces: the object `#resolveRecord` returns gains an optional
  `keyAlignmentSuspect: { offset, literalMatches, shiftedMatches, itemCount }`
  field, present only when a candidate is found AND every row is marked
  (no blanks). This is what Task 3 reads as `card.keyAlignmentSuspect`.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/3_applications/school/documents/ResolveCardScan.keyAlignment.test.mjs
import { describe, it, expect } from 'vitest';
import { PublishPrintDocument } from './PublishPrintDocument.mjs';
import { RenderPrintDocument } from './RenderPrintDocument.mjs';
import { createPrintDocumentRendering } from '#rendering/school/documents/PrintDocumentRendering.mjs';
import { ResolveCardScan } from './ResolveCardScan.mjs';
import { DOCUMENT_SOURCE_SCHEMA } from '#domains/school/documents/documentSource.mjs';

const richText = (md) => ({ type: 'rich_text', md });
const mcQuestion = (itemId, number, { choices, answer, points } = {}) => ({
  type: 'question', itemId, number, blocks: [richText(`Prompt for ${itemId}`)], choices, answer,
  ...(points !== undefined ? { points } : {}),
});
const sourceDoc = (id, blocks, over = {}) => ({
  schema: DOCUMENT_SOURCE_SCHEMA, id, seed: 12345, variant: 0, target: ['letter'],
  archetype: 'quiz', title: id, blocks, ...over,
});

function fakeRepository() {
  const published = new Map(); const banks = new Map(); const latestRevById = new Map();
  return {
    async writePublished({ document, bank, rev }) {
      const key = `${document.id}@${rev}`;
      published.set(key, document);
      if (bank) banks.set(key, bank);
      latestRevById.set(document.id, rev);
      return { document: { written: true, alreadyPublished: false }, bank: bank ? { written: true, alreadyPublished: false } : null };
    },
    async getPublished(id, rev) {
      const resolvedRev = rev ?? latestRevById.get(id);
      return resolvedRev ? (published.get(`${id}@${resolvedRev}`) ?? null) : null;
    },
    async getDerivedBank(id, rev) { return banks.get(`${id}@${rev}`) ?? null; },
  };
}

function fakeAllocationStore(over = {}) {
  const map = new Map();
  const io = {
    load: (filePath) => (map.has(filePath) ? structuredClone(map.get(filePath)) : null),
    save: (filePath, content) => { map.set(filePath, structuredClone(content)); },
    list: (dir) => [...map.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).replace(/\.yml$/, '')),
  };
  // NOTE FOR IMPLEMENTER: copy the rest of `fakeAllocationStore` verbatim
  // from `ResolveCardScan.test.mjs` — it constructs a real `YamlAllocationStore`
  // over this in-memory `io`. Do not hand-roll a different fake; the real
  // one already handles `findByCard`/`updateStatus`/etc. correctly.
  throw new Error('copy the full fakeAllocationStore body from ResolveCardScan.test.mjs here');
}

const createRenderPrintDocument = (deps = {}) => new RenderPrintDocument({ rendering: createPrintDocumentRendering(), ...deps });

async function publishAndAllocate({ repository, allocationStore, source, context }) {
  const publisher = new PublishPrintDocument({ repository });
  const { id, rev } = await publisher.execute({ source });
  const published = await repository.getPublished(id, rev);
  const renderer = createRenderPrintDocument({ repository, allocationStore });
  const result = await renderer.execute({ document: published, context });
  return { allocation: result.allocation, published };
}

describe('ResolveCardScan key-alignment wiring', () => {
  it('attaches keyAlignmentSuspect to a record whose marks are shifted one row late', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const logger = { warn: [], info: () => {} };
    logger.warn = (...args) => { logger.calls = logger.calls ?? []; logger.calls.push(args); };
    const correct = ['A', 'B', 'C', 'D', 'A', 'B'];
    const source = sourceDoc('test/key-alignment-fixture', correct.map((letter, index) => (
      mcQuestion(`q${index + 1}`, index + 1, { choices: ['A', 'B', 'C', 'D'], answer: letter })
    )));
    await publishAndAllocate({
      repository, allocationStore, source,
      context: { cardId: '1234567', startRow: 1, learnerId: 'test-learner' },
    });
    const resolver = new ResolveCardScan({ repository, allocationStore, logger });
    // row N's mark = correct[N-1] for rows 2-6 (one row late); row 1 wrong.
    const answers = { 1: 'E', 2: 'A', 3: 'B', 4: 'C', 5: 'D', 6: 'A' };
    const result = await resolver.execute({ testId: '1234567', answers });
    const record = result.results[0];
    expect(record.keyAlignmentSuspect).toEqual({
      offset: -1, literalMatches: 0, shiftedMatches: 5, itemCount: 6,
    });
    expect(logger.calls?.some(([event]) => event === 'school.scan.key-alignment-suspected')).toBe(true);
  });

  it('does not attach keyAlignmentSuspect to a normally-graded record', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const logger = { info: () => {}, warn: () => {} };
    const correct = ['A', 'B', 'C', 'D', 'A', 'B'];
    const source = sourceDoc('test/key-alignment-fixture-2', correct.map((letter, index) => (
      mcQuestion(`q${index + 1}`, index + 1, { choices: ['A', 'B', 'C', 'D'], answer: letter })
    )));
    await publishAndAllocate({
      repository, allocationStore, source,
      context: { cardId: '1234568', startRow: 1, learnerId: 'test-learner' },
    });
    const resolver = new ResolveCardScan({ repository, allocationStore, logger });
    const answers = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'A', 6: 'B' };
    const result = await resolver.execute({ testId: '1234568', answers });
    expect(result.results[0].keyAlignmentSuspect).toBeUndefined();
  });
});
```

**Before running this**, replace the `fakeAllocationStore` stub's `throw` with
the real body copied from `ResolveCardScan.test.mjs` (it wraps the `io`
object in a real `YamlAllocationStore` — copy that construction exactly,
including any imports it needs).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run backend/src/3_applications/school/documents/ResolveCardScan.keyAlignment.test.mjs`
Expected: FAIL — `keyAlignmentSuspect` is `undefined` on both records (not wired yet).

- [ ] **Step 3: Write the implementation**

Add the import near the existing `omrAlignmentError` import:

```js
import { omrKeyAlignmentSuspect } from '#domains/school/omrKeyAlignment.mjs';
```

Inside `#resolveRecord`, after `rowResults` is built (`const rowResults =
applyLeniency({...})`) and before the method's final `return { ... }`,
insert:

```js
// Content-aware row-shift check (never a prior scan — that is
// omrAlignmentError's job). Runs over fully-marked, multiple_choice rows
// only: a blank row means the sheet is still mid-fill (a later scan pass
// will re-run this once complete); a companion_code row is already
// partitioned out of `questionRows`; a multi_select row's `given` is an
// array and cannot be compared to a single correctLetter.
const keyAlignmentRows = questionRows
  .filter((row) => row.itemType === 'multiple_choice' && typeof row.given === 'string')
  .map((row) => ({
    row: row.row,
    given: row.given,
    correctLetter: correctLetterFor(bankItemsById.get(row.itemId)),
  }))
  .filter((row) => row.correctLetter != null);
const hasBlankRow = questionRows.some((row) => row.status === 'blank');
const keyAlignmentSuspect = hasBlankRow ? null : omrKeyAlignmentSuspect(keyAlignmentRows);
if (keyAlignmentSuspect) {
  this.#logger.warn?.('school.scan.key-alignment-suspected', {
    cardId: record.cardId, recordId: record.recordId,
    learnerId: record.learnerId ?? null, ...keyAlignmentSuspect,
  });
}
```

Then extend the method's final return object (mirroring the existing
`...(companionGate ? { companionGate } : {})` convention):

```js
      ...(companionGate ? { companionGate } : {}),
      ...(sections.length ? { sections } : {}),
      ...(keyAlignmentSuspect ? { keyAlignmentSuspect } : {}),
    };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run backend/src/3_applications/school/documents/ResolveCardScan.keyAlignment.test.mjs`
Expected: PASS — both tests green.

- [ ] **Step 5: Run the full ResolveCardScan test suite to check for regressions**

Run: `npx vitest run backend/src/3_applications/school/documents/ResolveCardScan.test.mjs backend/src/3_applications/school/documents/ResolveCardScan.alignment.test.mjs backend/src/3_applications/school/documents/ResolveCardScan.decodeConfidence.test.mjs backend/src/3_applications/school/documents/ResolveCardScan.companionGate.test.mjs`
Expected: PASS — no existing behavior changed, since `keyAlignmentSuspect` is
purely additive and conditionally spread.

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/school/documents/ResolveCardScan.mjs backend/src/3_applications/school/documents/ResolveCardScan.keyAlignment.test.mjs
git commit -m "feat(school): flag key-alignment-suspect records during grading"
```

---

### Task 3: Route a suspected record through the review queue — correctly

**Files:**
- Modify: `backend/src/3_applications/school/documents/RecordCardScanOutcome.mjs`
  (`#bridgeSession`, lines 601-771)
- Modify: `backend/src/3_applications/school/usecases/GradeSubmission.mjs`
  (the `expectedItems` computation, around line 248) — **this is the fix a
  first draft of this plan missed entirely.** For a print unit, every queued
  item's `itemId` currently becomes part of the score's denominator
  (`GradeSubmission.mjs:248-249`). A synthetic `key-alignment` entry must be
  excluded from that set, or resolving it changes the child's score.
- Modify: `frontend/src/modules/School/teacher/ReviewQueueView.jsx` (or
  wherever `REASON_COPY`, line ~26, actually lives — confirmed present at
  that path/line during planning) — add a `'key-alignment-suspected'` entry,
  and confirm the component renders `item.rubric` somewhere for a teacher to
  read; if it does not, add that rendering (the evidence sentence rides
  `rubric`, not `prompt` — see below).
- Modify: `backend/src/3_applications/school/ports/IReviewQueue.mjs` (JSDoc
  `reason` union only)
- Test: `backend/src/3_applications/school/documents/
  RecordCardScanOutcome.keyAlignment.test.mjs` (new file); a new test case
  in `GradeSubmission.mjs`'s existing test file for the denominator fix.

**Interfaces:**
- Consumes: `card.keyAlignmentSuspect` from Task 2.
- Produces: when set and a review queue is wired, `#bridgeSession` returns
  `{ ..., reason: 'awaiting-review', ... }` and enqueues one extra item with
  `reason: 'key-alignment-suspected'`, `itemId: 'key-alignment'` (no slashes
  or `@`/`:` characters — a real `recordId` like
  `civilization/atlas/ws-ses-4jqdgpr5b3@ca29ac85c:v0:28-33` is NOT safe to
  fold into an `itemId` that may travel through a URL path segment; a plain
  session-unique literal is), `prompt: 'Row alignment check'` (neutral —
  this field CAN reach a child's feedback rail if a teacher resolves the
  item with `correct`/`incorrect` instead of `void`, per `StudentPanel.jsx`'s
  `item.note || item.prompt || ...` fallback), and `rubric:` carrying the
  actual evidence sentence (grown-up-facing guidance, never read by
  `StudentPanel`).

- [ ] **Step 1: Update the `IReviewQueue` reason union (documentation)**

In `backend/src/3_applications/school/ports/IReviewQueue.mjs`:

```js
 *             unitId: string|null, reason: 'ambiguous'|'blank'|'free_response'|'unscorable'|'machine'|'key-alignment-suspected',
```

- [ ] **Step 2: Write the failing GradeSubmission denominator test**

Find `GradeSubmission.mjs`'s existing test file (search for the test that
exercises `isPrintUnit`/`expectedItems`) and add:

```js
it('excludes a key-alignment-suspected queue entry from the print-unit denominator', async () => {
  // Arrange a print-unit submission whose review queue holds 6 real
  // machine-marked rows PLUS one synthetic key-alignment entry (itemId:
  // 'key-alignment', reason: 'key-alignment-suspected'), then resolve the
  // synthetic entry with a 'correct' verdict (the natural, wrong gesture a
  // teacher might make). Assert `percent`/`correct`/`total` on the
  // resulting `graded` event reflect ONLY the 6 real rows — 100% if all 6
  // were correct, never treating the synthetic entry as a 7th question.
  //
  // Build this using whatever fixture helpers this file's existing print-
  // unit tests already use (search for `isPrintUnit`/`transport: 'paper'`
  // fixtures in this same test file) — do not invent a new fixture shape.
});
```

- [ ] **Step 3: Run the test to verify it fails**

Expected: FAIL — the synthetic item is currently counted in `expectedItems`.

- [ ] **Step 4: Fix the denominator in `GradeSubmission.mjs`**

At the `expectedItems` computation (around line 248):

```js
    const expectedItems = isPrintUnit
      ? [...new Set(
          queueItemsForSession
            .filter((item) => item.reason !== 'key-alignment-suspected')
            .map((item) => item.itemId),
        )]
      : (document ? questionItemIds(document) : (roster ?? (bank?.items ?? []).map((i) => i.id)));
```

- [ ] **Step 5: Run the test to verify it passes, then the full GradeSubmission suite**

Run: `npx vitest run <GradeSubmission's test file>`
Expected: PASS, no regressions in existing print-unit/on-screen cases.

- [ ] **Step 6: Write the failing `RecordCardScanOutcome` test**

```js
// backend/src/3_applications/school/documents/RecordCardScanOutcome.keyAlignment.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { RecordCardScanOutcome } from './RecordCardScanOutcome.mjs';
import { createEvent } from '#domains/school/sessions/sessionEvents.mjs';

const quietLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function fakeDatastore() {
  const byLearner = new Map();
  return {
    appendAttempt(learnerId, attempt) {
      if (!byLearner.has(learnerId)) byLearner.set(learnerId, []);
      byLearner.get(learnerId).push(structuredClone(attempt));
      return attempt;
    },
    readAllAttempts(learnerId) { return structuredClone(byLearner.get(learnerId) ?? []); },
    readAttemptsInRange(learnerId, fromDay, toDay) {
      return structuredClone(byLearner.get(learnerId) ?? [])
        .filter((attempt) => { const day = String(attempt.at).slice(0, 10); return day >= fromDay && day <= toDay; });
    },
  };
}

function fakeSessions(seedEvents = []) {
  const events = new Map();
  const append = (sessionId, event) => {
    const list = events.get(sessionId) ?? [];
    const seq = list.reduce((max, e) => Math.max(max, e.seq ?? 0), 0) + 1;
    list.push({ ...structuredClone(event), seq });
    events.set(sessionId, list);
  };
  for (const { sessionId, event } of seedEvents) append(sessionId, event);
  return {
    async readEvents(sessionId) { return structuredClone(events.get(sessionId) ?? []); },
    async appendEvent(sessionId, event) { append(sessionId, event); },
  };
}

function fakeReviewQueue() {
  const items = [];
  return {
    items,
    async enqueue(batch) { items.push(...structuredClone(batch)); },
    async listForSession(sessionId) { return structuredClone(items.filter((i) => i.sessionId === sessionId)); },
  };
}

function seededSession(sessionId, { learnerId = 'test-learner', unitId = 'test-unit' } = {}) {
  const mk = (payload) => {
    const { errors, event } = createEvent(payload);
    if (errors.length) throw new Error(errors.join('; '));
    return { sessionId, event };
  };
  return [
    mk({ type: 'created', at: '2026-09-21T00:00:00.000Z', sessionId, unitId, learnerId }),
    mk({ type: 'issued', at: '2026-09-21T00:00:01.000Z', sessionId, artifactId: 'art-1' }),
  ];
}

const gradedCard = (over = {}) => ({
  cardId: '1234567', recordId: 'civilization/test/worksheet@rev1:v0:1-6',
  documentId: 'civilization/test/worksheet', rev: 'rev1', variant: 0,
  learnerId: 'test-learner', sessionId: 'ses_test1',
  results: [1, 2, 3, 4, 5, 6].map((n) => ({
    row: n, itemId: `q${n}`, itemType: 'multiple_choice', prompt: `Q${n}`,
    status: n === 1 ? 'incorrect' : 'correct', given: 'A', points: 1, earned: n === 1 ? 0 : 1, concepts: [],
  })),
  totalPoints: 6, earnedPoints: 5, unscannedItems: [],
  ...over,
});

describe('RecordCardScanOutcome key-alignment routing', () => {
  it('halts the session at submitted, awaiting-review, when keyAlignmentSuspect is set', async () => {
    const sessions = fakeSessions(seededSession('ses_test1'));
    const reviewQueue = fakeReviewQueue();
    const datastore = fakeDatastore();
    const recorder = new RecordCardScanOutcome({
      datastore, sessions, reviewQueue, clock: () => new Date('2026-09-21T00:05:00.000Z'), logger: quietLogger,
    });
    const card = gradedCard({ keyAlignmentSuspect: { offset: -1, literalMatches: 2, shiftedMatches: 5, itemCount: 6 } });
    const outcome = await recorder.execute({ testId: '1234567', card });
    expect(outcome.session.reason).toBe('awaiting-review');
    expect(outcome.session.advancedTo).toBe('submitted');
    const suspectItem = reviewQueue.items.find((item) => item.reason === 'key-alignment-suspected');
    expect(suspectItem).toBeTruthy();
    expect(suspectItem.itemId).toBe('key-alignment');
    expect(suspectItem.prompt).toBe('Row alignment check');
    expect(suspectItem.rubric).toMatch(/row/i);
  });

  it('grades normally, with no key-alignment pending entry, when the field is absent', async () => {
    const sessions = fakeSessions(seededSession('ses_test2'));
    const reviewQueue = fakeReviewQueue();
    const datastore = fakeDatastore();
    const recorder = new RecordCardScanOutcome({
      datastore, sessions, reviewQueue, clock: () => new Date('2026-09-21T00:05:00.000Z'), logger: quietLogger,
    });
    const card = gradedCard({ recordId: 'civilization/test/worksheet@rev1:v0:1-6', sessionId: 'ses_test2' });
    const outcome = await recorder.execute({ testId: '1234567', card });
    expect(outcome.session.reason).not.toBe('awaiting-review');
    expect(reviewQueue.items.some((item) => item.reason === 'key-alignment-suspected')).toBe(false);
  });
});
```

**Before writing Step 4**, check `RecordCardScanOutcome`'s actual `execute`
return shape (search for `outcome.session` vs a differently-nested field in
its existing tests) and adjust the assertions above to match exactly if it
differs — the shape here is inferred from `#bridgeSession`'s own return
object, not independently re-verified against `execute`'s wrapping.

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run backend/src/3_applications/school/documents/RecordCardScanOutcome.keyAlignment.test.mjs`
Expected: FAIL — no `key-alignment-suspected` entry is ever enqueued yet.

- [ ] **Step 8: Write the implementation**

Add a helper near the top of `RecordCardScanOutcome.mjs`:

```js
/**
 * Grown-up-facing guidance for the review queue (rides `rubric`, never
 * `prompt` — `prompt` can reach a resolved item's `StudentPanel` rendering
 * if a teacher marks `correct`/`incorrect` rather than `void`; `rubric` is
 * never read there). Never printed to the child directly either way.
 */
function keyAlignmentRubric({ offset, literalMatches, shiftedMatches, itemCount }) {
  const direction = offset > 0 ? 'down' : 'up';
  const rows = Math.abs(offset) === 1 ? 'row' : 'rows';
  return `Shifting the answers ${direction} ${Math.abs(offset)} ${rows} would score `
    + `${shiftedMatches}/${itemCount} instead of ${literalMatches}/${itemCount} — `
    + `worth asking before this counts against them.`;
}
```

Inside `#bridgeSession`, in the `pending` array literal, add a third spread:

```js
        const pending = [
          ...card.results.filter((row) => row.status === 'ambiguous').map((row) => ({
            sessionId, itemId: row.itemId, learnerId: state.learnerId, unitId: state.unitId,
            reason: 'ambiguous', given: row.given,
            prompt: row.prompt ?? null, questionNumber: row.row, rubric: null, enqueuedAt: at,
          })),
          ...(card.unscannedItems ?? []).map((item) => ({
            sessionId, itemId: item.itemId, learnerId: state.learnerId, unitId: state.unitId,
            reason: 'free_response', given: null,
            prompt: item.prompt ?? null, questionNumber: null, rubric: null, enqueuedAt: at,
          })),
          ...(card.keyAlignmentSuspect ? [{
            sessionId, itemId: 'key-alignment', learnerId: state.learnerId, unitId: state.unitId,
            reason: 'key-alignment-suspected', given: null,
            prompt: 'Row alignment check', questionNumber: null,
            rubric: keyAlignmentRubric(card.keyAlignmentSuspect), enqueuedAt: at,
          }] : []),
        ];
```

- [ ] **Step 9: Run the test to verify it passes, then the full RecordCardScanOutcome suite**

Run: `npx vitest run backend/src/3_applications/school/documents/RecordCardScanOutcome.keyAlignment.test.mjs backend/src/3_applications/school/documents/RecordCardScanOutcome.test.mjs`
Expected: PASS.

- [ ] **Step 10: Add the teacher-facing copy**

In `ReviewQueueView.jsx`'s `REASON_COPY`:

```js
const REASON_COPY = {
  ambiguous: 'the scanner could not tell which bubble was meant',
  blank: 'the row was left blank',
  free_response: 'a written answer needs a human mark',
  'key-alignment-suspected': 'the marked answers might be shifted by a row — check the note below before marking',
};
```

Check whether this component already renders `item.rubric` anywhere in its
item markup. If it does not, add a line rendering it for items whose reason
is `'key-alignment-suspected'` (or generally, for any item carrying a
non-null `rubric` — check whether `ambiguous`/`free_response` items ever
populate `rubric` today before deciding between a reason-specific render and
a general one; the code above always sets `rubric: null` for those two, so a
general "render rubric when present" is safe and simpler).

- [ ] **Step 11: Commit**

```bash
git add backend/src/3_applications/school/documents/RecordCardScanOutcome.mjs backend/src/3_applications/school/documents/RecordCardScanOutcome.keyAlignment.test.mjs backend/src/3_applications/school/ports/IReviewQueue.mjs backend/src/3_applications/school/usecases/GradeSubmission.mjs frontend/src/modules/School/teacher/ReviewQueueView.jsx
git commit -m "feat(school): hold key-alignment-suspect sheets for teacher review, without corrupting the score or leaking evidence to the child"
```

---

### Task 4: Reason-aware ceremony copy + end-to-end regression fixtures

**Files:**
- Modify: `backend/src/2_domains/school/documents/scanNotices.mjs` (the
  `case 'scan-review':` branch, around line 104) — this branch currently
  hardcodes "Some questions had two answers filled in. Ask a grown-up to
  check it." for every `scan-review` announcement. A key-alignment hold
  would hand the child a slip that lies about why. Make it reason-aware.
- Test: `backend/src/3_applications/school/workflows/
  SchoolPrintScanConsumer.keyAlignment.test.mjs` (new file) — **use the real
  test-harness pattern** from `SchoolPrintScanConsumer.slip.test.mjs`
  (`onPrintSheet: (_config, cb) => { handler = cb; return () => {}; }`,
  `handler(payload)` called synchronously then `await settle()`, a helper
  that awaits 6 microtask-flush ticks). Broadcast events carry a `kind`
  field, not `event` — check `announcement.kind === 'scan-review'`, not
  `announcement.event`.

**Interfaces:**
- Consumes: `ResolveCardScan` (Task 2) → `RecordCardScanOutcome` (Task 3),
  wired together the same way `SchoolPrintScanConsumer`'s own real
  composition does — check `backend/src/5_composition/modules/
  schoolLifecycle.mjs` for the exact constructor wiring before writing the
  test's dependency graph.

- [ ] **Step 1: Make `scanNotices.mjs`'s `scan-review` case reason-aware**

```js
    case 'scan-review': {
      const reasons = Array.isArray(announcement.reasons) ? announcement.reasons : [];
      if (reasons.includes('key-alignment-suspected') && reasons.length === 1) {
        return noticeDocument({
          id,
          headline: headlineFor(announcement.title, 'NEEDS A GROWN-UP'),
          lines: ['A grown-up is double-checking one of your answers.', 'Ask them to take a look.'],
        });
      }
      const count = isNumber(announcement.pendingReview) ? announcement.pendingReview : null;
      const what = count === null ? 'Some questions' : count === 1 ? '1 question' : `${count} questions`;
      return noticeDocument({
        id,
        headline: headlineFor(announcement.title, 'NEEDS A GROWN-UP'),
        lines: [`${what} had two answers filled in.`, 'Ask a grown-up to check it.'],
      });
    }
```

(If `reasons` can legitimately mix `key-alignment-suspected` with an
`ambiguous`/`free_response` reason on the same sheet, decide — and write a
test for — which copy wins; the branch above assumes the common case where
key-alignment is the sole reason, since it only ever fires on a fully-marked
sheet with no blank/ambiguous rows per Task 2's guard, which makes mixing
rare but not provably impossible if a `free_response` write-on item also
exists on the same worksheet.)

- [ ] **Step 2: Write a unit test for the new `scanNotices.mjs` branch**

Add to `scanNotices.mjs`'s existing test file: a `scan-review` announcement
with `reasons: ['key-alignment-suspected']` produces the new copy; one with
`reasons: ['ambiguous']` still produces the original copy (regression).

Run: `npx vitest run <scanNotices test file>`
Expected: PASS.

- [ ] **Step 3: Write the failing end-to-end regression test**

```js
// backend/src/3_applications/school/workflows/SchoolPrintScanConsumer.keyAlignment.test.mjs
import { describe, it, expect } from 'vitest';
import { createSchoolPrintScanConsumer } from './SchoolPrintScanConsumer.mjs';
// NOTE FOR IMPLEMENTER: import ResolveCardScan/RecordCardScanOutcome and
// whatever fixture helpers Task 2/Task 3 established, plus check
// `schoolLifecycle.mjs` composition for how `recordCardScanOutcome` is
// actually passed to `createSchoolPrintScanConsumer` (a raw instance vs an
// `{ execute }` wrapper) before writing the harness below — copy that shape
// exactly rather than guessing.

const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

describe('SchoolPrintScanConsumer key-alignment end-to-end', () => {
  it('grades normally and never suspects the real Learner1 New York marks (must-not-trigger)', async () => {
    let handler;
    const broadcast = [];
    const realtime = {
      onPrintSheet: (_config, cb) => { handler = cb; return () => {}; },
      printScanResolved: (payload) => broadcast.push(payload),
    };
    // Build resolveCardScan/recordCardScanOutcome against a worksheet shaped
    // like the real New York lesson (6 multiple_choice items, correct
    // answers C,B,B,A,A,D), using Task 2/Task 3's real fixture harness —
    // not the invented bank/document shape from the original draft.
    const consumer = createSchoolPrintScanConsumer({ realtime, resolveCardScan, recordCardScanOutcome, logger: quietLogger });
    handler({ testId: '5252427', answers: { 22: 'C', 23: 'A', 24: 'B', 25: 'C', 26: 'C', 27: 'C' } });
    await settle();
    expect(broadcast.some((event) => event.kind === 'scan-review')).toBe(false);
  });

  it('routes a shifted-marks scan of the same worksheet to review (must-trigger)', async () => {
    let handler;
    const broadcast = [];
    const realtime = {
      onPrintSheet: (_config, cb) => { handler = cb; return () => {}; },
      printScanResolved: (payload) => broadcast.push(payload),
    };
    const consumer = createSchoolPrintScanConsumer({ realtime, resolveCardScan, recordCardScanOutcome, logger: quietLogger });
    // Same worksheet, marks written one row late.
    handler({ testId: '5252427', answers: { 22: 'X', 23: 'C', 24: 'B', 25: 'B', 26: 'A', 27: 'A' } });
    await settle();
    const review = broadcast.find((event) => event.kind === 'scan-review');
    expect(review).toBeTruthy();
    expect(review.reasons).toContain('key-alignment-suspected');
  });
});
```

- [ ] **Step 4: Run the test, diagnosing any wiring mismatch rather than weakening assertions**

Run: `npx vitest run backend/src/3_applications/school/workflows/SchoolPrintScanConsumer.keyAlignment.test.mjs`
Expected: once the harness correctly matches `schoolLifecycle.mjs`'s real
wiring, this should PASS without further production changes beyond Steps 1-2
— Tasks 2 and 3 are the only feature code this test exercises.

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/school/documents/scanNotices.mjs backend/src/3_applications/school/workflows/SchoolPrintScanConsumer.keyAlignment.test.mjs
git commit -m "feat(school): reason-aware scan-review slip copy + end-to-end key-alignment fixtures"
```

---

## Out of scope for this plan (spec §7, unresolved — do not guess)

- Retuning `MIN_ITEMS`/`MARGIN`/`PASSING_FLOOR` against real worksheet score
  history.
- Whether a suspected-shift hold should also suppress the Home Assistant
  `grading_hook` siren cue before a teacher resolves it.
- Any further teacher-facing UI beyond the `REASON_COPY` entry and `rubric`
  rendering in Task 3 — a bigger visual treatment is a separate change.
