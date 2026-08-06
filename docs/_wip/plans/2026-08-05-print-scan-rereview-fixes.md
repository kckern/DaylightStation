# Print/OMR Re-Review Fix Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every finding from the second grouchy-Fable review of the school print/OMR system (5 new Majors, 3 Minors, nits) so scan grades are correctly filed, never double-counted, human-reviewable, un-bypassable, and immune to phantom revs.

**Architecture:** All changes stay inside the existing print pipeline seams: the print route (`school.mjs`), the scan resolver (`ResolveCardScan`), the scan recorder (`RecordCardScanOutcome`), the grading use case (`GradeSubmission`), and the composition wiring (`schoolPrintScanConsumer`/`app.mjs`). The review queue becomes the bridge's durable per-item verdict sheet — the same role it plays for `GradeSubmission` — so the existing parent flow (`ResolveReviewItem` → `GradeSubmission`) finishes sessions the bridge holds.

**Tech Stack:** Node ESM (`.mjs`), vitest, express 5, YAML stores. No new dependencies.

## Global Constraints

- Domain layer (`2_domains/`) imports nothing outside `#domains` (architecture gate; no node builtins).
- Never raw `console.*` — injected `logger` with structured events (`school.print.*` namespace).
- Tests must fail before the fix and pass after; no skipped assertions ("Skipping is NOT passing").
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- All work on branch `fix/school-print-rereview-wave2` in the worktree at `/opt/Code/DaylightStation/.claude/worktrees/sheetmusic-wave3`; run all commands from there. Do NOT touch the main checkout.
- Run tests with `npx vitest run <paths>`; the full school sweep is `npx vitest run backend/src/2_domains/school/ backend/src/3_applications/school/ backend/src/1_adapters/school/ backend/src/4_api/v1/routers/school.print.test.mjs backend/src/4_api/v1/routers/school.print.integration.test.mjs tests/isolated/domain/school/`.
- Review shapes are contracts: review-queue items carry `{sessionId, itemId, learnerId, unitId, reason, given, prompt, questionNumber, rubric, enqueuedAt}` and resolved ones add `{verdict, gradedBy, gradedAt, attemptId}` (see `GradeSubmission.mjs:160-173`).
- The scan-resolver row-result shape after Task 1 is `{row, itemId, itemType, prompt, status, given, points, earned}` — every later task consumes it exactly.

---

### Task 1: ResolveCardScan — per-record resilience, dead-card marker, write-on/prompt signals

**Files:**
- Modify: `backend/src/3_applications/school/documents/ResolveCardScan.mjs`
- Test: `backend/src/3_applications/school/documents/ResolveCardScan.test.mjs`

**Interfaces:**
- Consumes: existing resolver internals (`#resolveRecord`, `rowResults` mapping, `eligible` filtering).
- Produces (later tasks rely on these exact shapes):
  - Row results gain `prompt: string|null` (bank item's `prompt ?? null`).
  - Graded entries gain `unscannedItems: [{itemId, prompt}]` — top-level `question` blocks of the PREPARED document that consume no card row (write-ons). Empty array when none.
  - A `#resolveRecord` throw no longer aborts the scan: the failing record becomes an error entry `{cardId, recordId, documentId, rev, variant, learnerId?, error: {code, message}}` (code = `err.code ?? 'SCAN_RECORD_RESOLVE_FAILED'`) and every OTHER record still grades.
  - A card whose records exist but are ALL `released`/`superseded`, scanned with answers, returns `{results: [], deadCard: true, answeredRowCount, recordStatuses: [...statuses]}`.

- [ ] **Step 1: Write the failing tests** — append to `ResolveCardScan.test.mjs` (reuse existing helpers `fakeRepository`, `fakeAllocationStore`, `publishAndAllocate`, `sourceDoc`, `mcQuestion`, `useCaseExecute`; note `useCaseExecute(deps, args)` wraps `new ResolveCardScan(deps).execute(args)` — check its exact name at the top of the file and match it):

```js
describe('execute — resilience + review signals (re-review wave 2)', () => {
  it('one record failing to resolve becomes an error entry; cardmates still grade', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const sourceA = sourceDoc('resilient-a', [
      mcQuestion('ra1', 1, { choices: ['X', 'Y'], answer: 'X' }),
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source: sourceA, context: { freshCard: true },
    });
    const sourceB = sourceDoc('resilient-b', [
      mcQuestion('rb2', 2, { choices: ['X', 'Y'], answer: 'Y' }),
    ]);
    await publishAndAllocate({
      repository, allocationStore, source: sourceB, context: { cardId: allocation.cardId, startRow: 2 },
    });
    // Sabotage record A's pinned rev so its published doc is unresolvable —
    // the exact phantom-rev / deleted-artifact failure.
    const records = await allocationStore.findByCard(allocation.cardId);
    const recordA = records.find((r) => r.documentId === 'resilient-a');
    // simulate by pointing repository at a missing rev: delete the published entry
    // (fakeRepository has no delete — instead re-write the record's rev)
    // Easiest: build a wrapper repository that 404s resilient-a only.
    const wrapped = {
      ...repository,
      getPublished: (id, rev) => (id === 'resilient-a' ? null : repository.getPublished(id, rev)),
      getDerivedBank: (id, rev) => repository.getDerivedBank(id, rev),
    };
    const useCase = new ResolveCardScan({ allocationStore, repository: wrapped });
    const result = await useCase.execute({
      testId: allocation.cardId, answers: { 1: 'A', 2: 'B' },
    });
    const byDoc = Object.fromEntries(result.results.map((r) => [r.documentId, r]));
    expect(byDoc['resilient-a'].error.code).toBe('SCAN_RECORD_RESOLVE_FAILED');
    expect(byDoc['resilient-b'].results).toHaveLength(1);
    expect(byDoc['resilient-b'].results[0].status).toBe('correct');
  });

  it('a card whose records are ALL dead (released) with answers reports deadCard, never silence', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const source = sourceDoc('dead-quiz', [
      mcQuestion('d1', 1, { choices: ['X', 'Y'], answer: 'X' }),
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true },
    });
    await allocationStore.release({ cardId: allocation.cardId });
    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({ testId: allocation.cardId, answers: { 1: 'A' } });
    expect(result.results).toEqual([]);
    expect(result.deadCard).toBe(true);
    expect(result.answeredRowCount).toBe(1);
    expect(result.recordStatuses).toEqual(['released']);
  });

  it('write-on questions (no card row) surface as unscannedItems with prompts; row results carry prompts', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const source = sourceDoc('writeon-quiz', [
      mcQuestion('w1', 1, { choices: ['X', 'Y'], answer: 'X' }),
      {
        type: 'question',
        itemId: 'w-essay',
        blocks: [
          { type: 'rich_text', md: 'Explain your reasoning.' },
          { type: 'short_answer', prompt: 'Explain your reasoning.' },
        ],
      },
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true },
    });
    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({ testId: allocation.cardId, answers: { 1: 'A' } });
    const card = result.results[0];
    expect(card.results[0].prompt).toBe('Prompt for w1');
    expect(card.unscannedItems).toEqual([
      { itemId: 'w-essay', prompt: expect.any(String) },
    ]);
  });
});
```

NOTE for the write-on fixture: a bare `question` block with a `short_answer` child and NO `choices`/`answer` may need a different legal shape — check `blocks.mjs`'s question-block validation and `documentSource.mjs`'s source rules first; the goal is one row-consuming question plus one write-on question that survives publish. If `short_answer` sugar at top level is the legal write-on form, use that instead and adjust the expected itemId (a standalone `short_answer` block may carry no itemId — in that case expect `unscannedItems` to use its generated id or prompt-clip label; mirror whatever `buildTeacherKeyBlocks` uses, see `RenderPrintDocument.mjs`).

- [ ] **Step 2: Run the new tests, verify all three FAIL** (`npx vitest run backend/src/3_applications/school/documents/ResolveCardScan.test.mjs -t "re-review wave 2"`).

- [ ] **Step 3: Implement in `ResolveCardScan.mjs`:**

1. **Dead card** — after the existing `unknownCard` early return (which requires `records.length === 0`), add:

```js
if (eligible.length === 0 && records.length > 0 && answeredRows.size > 0) {
  return {
    results: [],
    deadCard: true,
    answeredRowCount: answeredRows.size,
    recordStatuses: records.map((record) => record.status),
  };
}
```

2. **Per-record catch** — wrap the `#resolveRecord` call in the eligible-records loop:

```js
let cardResult;
try {
  // eslint-disable-next-line no-await-in-loop
  cardResult = await this.#resolveRecord(record, ownedRows, answers);
} catch (err) {
  cardResult = {
    cardId: record.cardId,
    recordId: record.recordId,
    documentId: record.documentId,
    rev: record.rev,
    variant: record.variant,
    ...(record.learnerId != null ? { learnerId: record.learnerId } : {}),
    error: { code: err.code ?? 'SCAN_RECORD_RESOLVE_FAILED', message: err.message },
  };
}
results.push(cardResult);
```

(The existing `if (cardResult.error) continue;` after the push already skips the satisfied-update for error entries.)

3. **Prompts + unscannedItems** — in `#resolveRecord`, the row-results map gains `prompt: item.prompt ?? null`. After building `rowResults`, compute write-ons from the PREPARED document (`prepared`), reusing the same notion of "row-consuming" `planRows` used: a top-level `question` block whose `blocks` contain no `omr_response` (and any standalone `short_answer`-sugar question shape that prints write-on — check how `planRows` in `allocation.mjs` selects row candidates and take the complement of exactly that set):

```js
const rowItemIds = new Set(plan.rows.map((planned) => planned.itemId));
const unscannedItems = (prepared.blocks ?? [])
  .filter((block) => block.type === 'question' && !rowItemIds.has(block.itemId))
  .map((block) => ({
    itemId: block.itemId,
    prompt: firstPromptText(block) ?? null,
  }));
```

with a small local helper `firstPromptText(block)` returning the first `rich_text` child's `md` (or the `short_answer` child's `prompt`). Add `unscannedItems` to the returned graded entry. IMPORTANT: verify against `planRows` — if a question can consume a row without `omr_response` (`true_false` uses a flag, check `documentV2`/`blocks.mjs`), key the complement off `plan.rows`' itemIds as shown, never off block shape guesses.

- [ ] **Step 4: Run the resolver suite** — all tests pass, including pre-existing ones (`npx vitest run backend/src/3_applications/school/documents/ResolveCardScan.test.mjs`). The existing strict `toEqual` row fixtures WILL now fail on the new `prompt` field — update those fixtures (add `prompt: 'Prompt for <itemId>'` to each, matching the `mcQuestion`/`tfQuestion`/`msQuestion` helpers' prompt text) and, where a graded entry is asserted whole, add `unscannedItems: []`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(school): scan resolver resilience — per-record errors, dead cards, write-on signals"` (with trailer).

---

### Task 2: Print route — published-first everywhere, quiz card gate, learner-mismatch conflict

**Files:**
- Modify: `backend/src/4_api/v1/routers/school.mjs` (print route, ~lines 180-360)
- Test: `backend/src/4_api/v1/routers/school.print.test.mjs`, `backend/src/4_api/v1/routers/school.print.integration.test.mjs`

**Interfaces:**
- Consumes: `printDocumentsRepo.getPublished(id, rev?)`, `.get(id)`; existing `adopt`/`newestUsable` helpers; `DomainInvariantError` (already imported and mapped to 409).
- Produces: the render target is ALWAYS `{document}` when `printDocumentsRepo` is wired (published-first, source fallback), `{id}` only when it is not; new 400 on quiz+unknown-card-without-learner; new 409 `CARD_LEARNER_MISMATCH`.

- [ ] **Step 1: Write the failing tests** — append to `school.print.test.mjs`:

```js
it('EVERY lane rides the published doc when the repo is wired — a fresh first print never pins a source-hash rev', async () => {
  const render = renderFake();
  const source = { id: 'q', seed: 1, blocks: [] }; // no rev — a drifted/unpublished source
  const published = { id: 'q', seed: 1, rev: 'abcdef123', blocks: [] };
  const repo = { get: vi.fn().mockResolvedValue(source), getPublished: vi.fn().mockResolvedValue(published) };
  const allocations = { findByCard: vi.fn(), findByDocument: vi.fn().mockResolvedValue([]) };
  const res = await request(appWith({ render, repo, allocations }))
    .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&learnerId=felix');
  expect(res.status).toBe(200);
  // The render receives the PUBLISHED document (rev field intact), never the source.
  expect(render.calls[0].document).toMatchObject({ rev: 'abcdef123' });
  expect(render.calls[0].id).toBeUndefined();
});

it('a never-published document still renders from source (proofing a draft stays legal)', async () => {
  const render = renderFake();
  const repo = {
    get: vi.fn().mockResolvedValue({ id: 'draft', seed: 1, blocks: [] }),
    getPublished: vi.fn().mockResolvedValue(null),
  };
  const res = await request(appWith({ render, repo }))
    .get('/api/v1/school/print/draft-sheet?variety=hand');
  expect(res.status).toBe(200);
  expect(render.calls[0].document).toMatchObject({ id: 'draft' });
});

it('quiz + fabricated card (no usable record) demands a learnerId — the seven-digit bypass is closed', async () => {
  const render = renderFake();
  const doc = { id: 'q', archetype: 'quiz', seed: 1, rev: 'abcdef123', blocks: [] };
  const repo = { get: vi.fn().mockResolvedValue(doc), getPublished: vi.fn().mockResolvedValue(doc) };
  const allocations = { findByCard: vi.fn().mockResolvedValue([]), findByDocument: vi.fn().mockResolvedValue([]) };
  const bare = await request(appWith({ render, repo, allocations }))
    .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&card=1111111');
  expect(bare.status).toBe(400);
  expect(bare.body.error).toMatch(/learnerId/);
  // With a learner, attach-new on an explicit card stays legal.
  const ok = await request(appWith({ render, repo, allocations }))
    .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&card=1111111&learnerId=felix');
  expect(ok.status).toBe(200);
});

it('adopting a card that belongs to a DIFFERENT learner is a 409, never a silent identity swap', async () => {
  const render = renderFake();
  const doc = { id: 'q', seed: 1, rev: 'abcdef123', blocks: [] };
  const repo = { get: vi.fn().mockResolvedValue(doc), getPublished: vi.fn().mockResolvedValue(doc) };
  const allocations = {
    findByCard: vi.fn().mockResolvedValue([
      { documentId: 'pokemon-quiz-1', cardId: '4829306', learnerId: 'felix', status: 'live', rev: 'abcdef123', variant: 0, rowRange: { start: 1, end: 6 }, renderedAt: 't1' },
    ]),
    findByDocument: vi.fn(),
  };
  const res = await request(appWith({ render, repo, allocations }))
    .get('/api/v1/school/print/pokemon-quiz-1?variety=omr&card=4829306&learnerId=soren');
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('CARD_LEARNER_MISMATCH');
});
```

- [ ] **Step 2: Run them, verify all four FAIL.**

- [ ] **Step 3: Implement in `school.mjs`:**

1. **Published-first target (Major 5a)** — replace the entire `let target; if (rev === null && variant === null) {...} else {...}` block with:

```js
let target;
if (!printDocumentsRepo) {
  // No repo wired (embedded/test harness): rev/variant pinning is impossible,
  // and the renderer resolves the id itself.
  if (rev !== null || variant !== null) return res.status(503).json({ error: 'print-render-unavailable' });
  target = { id };
} else {
  // Published-first on EVERY lane: a source render re-publishes in-memory and
  // a drifted source hashes to a rev getPublished can never serve — the
  // allocation record would pin a phantom rev and the card would die at scan
  // time, taking innocent cardmates with it. The published artifact's rev is
  // a FIELD, which variant overrides leave intact. Source is the fallback
  // only for a document never published at all (proofing a draft).
  const raw = rev !== null
    ? await printDocumentsRepo.getPublished(id, rev)
    : ((await printDocumentsRepo.getPublished(id)) ?? (await printDocumentsRepo.get(id)));
  if (!raw) throw new EntityNotFoundError('print document', rev !== null ? `${id}@${rev}` : id);
  target = { document: variant !== null ? { ...raw, variant } : raw };
}
```

2. **Quiz card gate (Major 4)** — the route already has an archetype probe for the bare lane. Hoist it into a memoized helper near the top of the handler so both call sites share one repo read:

```js
let quizProbe = null;
const isQuizDocument = async () => {
  if (!printDocumentsRepo) return false;
  if (quizProbe === null) {
    const probe = (await printDocumentsRepo.getPublished(id)) ?? (await printDocumentsRepo.get(id));
    quizProbe = probe?.archetype === 'quiz';
  }
  return quizProbe;
};
```

Replace the existing bare-lane gate's inline repo read with `await isQuizDocument()`. Then in the `card` branch, after the adoption lookup fails to find a usable record (`!adoptedRecord`), BEFORE the `startRow` default is applied:

```js
if (!adoptedRecord && !learnerId && (await isQuizDocument())) {
  throw new ValidationError(
    `card ${card} has no usable allocation for this quiz — add learnerId=<id> to attach it `
    + '(or check the card number)',
  );
}
```

3. **Learner mismatch (Minor 2)** — inside `adopt(record)`, after the existing rev/variant rejection:

```js
if (learnerId && (record.learnerId ?? null) !== learnerId) {
  throw new DomainInvariantError(
    `card ${record.cardId} belongs to a different learner; omit learnerId to reproduce its sheet`,
    { code: 'CARD_LEARNER_MISMATCH', details: { cardId: record.cardId } },
  );
}
```

CAREFUL with scope: `adopt` is used by BOTH the `card=` branch and the bare branch. In the bare branch, adoption is already learner-filtered when `learnerId` is present, so the check can never fire there — verify that with the existing "bare omr with learnerId reuses only that learner's sheet" test still passing.

- [ ] **Step 4: Run both route suites** (`npx vitest run backend/src/4_api/v1/routers/school.print.test.mjs backend/src/4_api/v1/routers/school.print.integration.test.mjs`). Pre-existing tests that asserted `render.calls[0]` equals `{ id, context }` for hand renders WITHOUT a repo still pass (no repo → `{id}` target). Any pre-existing test that passes a `repo` AND asserted an `{id}` target must be updated to expect the document target — check `hand variety renders a PDF...` (no repo: fine) and the adopted/auto-omr tests (already document targets). The integration suite must pass unchanged — it uses a real repo, so every lane now resolves published-first; its first-print assertions must still hold because the integration source was published in `beforeAll`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "fix(school): published-first renders on every lane; quiz card gate; learner-mismatch 409"` (with trailer).

---

### Task 3: RecordCardScanOutcome — correct filing, row-scoped idempotency, matching percent

**Files:**
- Modify: `backend/src/3_applications/school/documents/RecordCardScanOutcome.mjs`
- Test: `backend/src/3_applications/school/documents/RecordCardScanOutcome.test.mjs`

**Interfaces:**
- Consumes: Task 1's row shape (`{row, itemId, itemType, prompt, status, given, points, earned}`).
- Produces: attempts filed as `bankId: '<documentId>@<rev>'` (NO `derived/` prefix) with `learning: { subjectId }` set from a hierarchical documentId's first segment; `sessionId: card.sessionId ?? null` (no synthetic ids); dedup per `(recordId, row, given)`; graded percent = `correctRows / totalRows * 100` (item-count, matching `GradeSubmission`). Return shape unchanged otherwise — Task 4 extends this same class.

- [ ] **Step 1: Write the failing tests** — in `RecordCardScanOutcome.test.mjs`, update/extend (the `gradedCard` fixture rows must gain `prompt: null` to match Task 1's shape):

```js
it('attempts are filed under the document taxonomy, not a phantom "derived" subject', async () => {
  const datastore = fakeDatastore();
  const useCase = new RecordCardScanOutcome({ datastore, logger: quietLogger });
  const card = gradedCard({ documentId: 'science/biology/quiz-1', recordId: 'science/biology/quiz-1@abcdef123:v0:1-2' });
  await useCase.execute({ testId: '1234567', card });
  const attempt = datastore.readAllAttempts('felix')[0];
  expect(attempt.bankId).toBe('science/biology/quiz-1@abcdef123');
  expect(attempt.learning.subjectId).toBe('science');
  expect(attempt.sessionId).toBeNull();
});

it('a flat (non-hierarchical) documentId files without a subjectId rather than inventing one', async () => {
  const datastore = fakeDatastore();
  const useCase = new RecordCardScanOutcome({ datastore, logger: quietLogger });
  await useCase.execute({ testId: '1234567', card: gradedCard() }); // documentId 'arts/quiz-1' → subjectId 'arts'
  const flat = gradedCard({ documentId: 'quiz-1', recordId: 'quiz-1@abcdef123:v0:9-10' });
  flat.results = flat.results.map((row, i) => ({ ...row, row: 9 + i }));
  await useCase.execute({ testId: '1234567', card: flat });
  const attempts = datastore.readAllAttempts('felix');
  expect(attempts.at(-1).bankId).toBe('quiz-1@abcdef123');
  expect(attempts.at(-1).learning?.subjectId ?? null).toBeNull();
});

it('a partial feed then a complete re-feed appends ONLY the rows not already recorded', async () => {
  const datastore = fakeDatastore();
  const useCase = new RecordCardScanOutcome({ datastore, logger: quietLogger });
  const partial = gradedCard({
    results: [
      { row: 1, itemId: 'q1', itemType: 'multiple_choice', prompt: null, status: 'correct', given: 'blue', points: 1, earned: 1 },
      { row: 2, itemId: 'q2', itemType: 'multiple_choice', prompt: null, status: 'blank', given: null, points: 1, earned: 0 },
    ],
    earnedPoints: 1,
  });
  await useCase.execute({ testId: '1234567', card: partial });
  expect(datastore.readAllAttempts('felix')).toHaveLength(1);

  const complete = gradedCard(); // both rows answered, row 1 identical (given 'blue')
  const second = await useCase.execute({ testId: '1234567', card: complete });
  expect(second.recorded).toBe(true);
  const attempts = datastore.readAllAttempts('felix');
  expect(attempts).toHaveLength(2); // row 1 deduped, only row 2 appended
  expect(attempts.at(-1).itemId).toBe('q2');
});

it('graded percent is item-count over rows, matching GradeSubmission semantics', async () => {
  const datastore = fakeDatastore();
  const sessions = fakeSessions(seededSession('ws-1'));
  const useCase = new RecordCardScanOutcome({ datastore, sessions, logger: quietLogger });
  // 1 correct of 2 rows, but the correct row is worth 5 points of 6 total:
  const card = gradedCard({
    sessionId: 'ws-1',
    results: [
      { row: 1, itemId: 'q1', itemType: 'multiple_choice', prompt: null, status: 'correct', given: 'blue', points: 5, earned: 5 },
      { row: 2, itemId: 'q2', itemType: 'multiple_choice', prompt: null, status: 'incorrect', given: 'fox', points: 1, earned: 0 },
    ],
    totalPoints: 6,
    earnedPoints: 5,
  });
  await useCase.execute({ testId: '1234567', card });
  const graded = (await sessions.readEvents('ws-1')).at(-1);
  expect(graded.type).toBe('graded');
  expect(graded.percent).toBe(50); // 1 of 2 items — NOT 83.33 points-weighted
});
```

Also UPDATE the existing "re-feeding the identical card writes nothing new" test's expectation text if needed (it still holds: identical rows all dedupe → `recorded: false, reason: 'duplicate-scan'`) and the existing "re-scan with DIFFERENT answers" test (row 1 identical dedupes; only changed row 2 appends → total 3 attempts, not 4 — fix its expectation).

- [ ] **Step 2: Run, verify the new tests FAIL** and note exactly which existing expectations change.

- [ ] **Step 3: Implement in `RecordCardScanOutcome.mjs`:**

1. **Filing (Major 1 + nit):**

```js
const documentSegments = card.documentId.split('/');
const subjectId = documentSegments.length > 1 ? documentSegments[0] : null;
// ...inside createAttempt call:
sessionId: card.sessionId ?? null,
bankId: `${card.documentId}@${card.rev}`,
...(subjectId ? { learning: { subjectId } } : {}),
```

Check `createAttempt`/`normalizeLearningContext` (`#domains/school/attempt.mjs`, `learningContext` module) accepts `{subjectId}` — mirror whatever key `SchoolService#answer` passes (`learning: { subjectId: s.bank.subject }`).

2. **Row-scoped dedup (Major 2)** — replace the whole-scan `scanKey` gate:

```js
const recordedRows = new Set(
  this.#datastore.readAllAttempts(learnerId)
    .filter((attempt) => attempt?.provenance?.recordId === card.recordId)
    .map((attempt) => `${attempt.provenance.row}:${JSON.stringify(attempt.given)}`),
);
const freshRows = card.results.filter(
  (row) => row.status !== 'blank' && !recordedRows.has(`${row.row}:${JSON.stringify(row.given)}`),
);
if (freshRows.length === 0) {
  this.#logger.info?.('school.print.scan-already-recorded', { testId, recordId: card.recordId, learnerId });
  return { recorded: false, reason: 'duplicate-scan' };
}
```

Then append attempts from `freshRows` only. KEEP `scanKey` in `provenance` (forensics) — the function stays exported and stamped, it just no longer gates.

3. **Percent (Minor 1)** — in the bridge:

```js
const correctRows = card.results.filter((row) => row.status === 'correct').length;
const percent = card.results.length > 0
  ? Math.round((correctRows / card.results.length) * 10000) / 100
  : 0;
```

4. **Dead branch (nit)** — the graded event's `attemptIds` uses the appended ids; the `['scan:'+recordId]` fallback stays REACHABLE now (a complete re-feed after a partial can dedupe some rows yet still bridge) — so keep a fallback but make it honest: `attemptIds.length ? attemptIds : priorAttemptIdsForRecord` where `priorAttemptIdsForRecord` is collected from the same `readAllAttempts` pass (`.filter(provenance.recordId === card.recordId).map((a) => a.id)`). Never emit a synthetic `scan:` id.

- [ ] **Step 4: Run the suite** (`npx vitest run backend/src/3_applications/school/documents/RecordCardScanOutcome.test.mjs`) — all pass.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "fix(school): scan attempts filed by taxonomy, row-scoped idempotency, item-count percent"` (with trailer).

---

### Task 4: Review-queue bridge — write-ons and ambiguous marks reach a person; GradeSubmission finishes print sessions

**Files:**
- Modify: `backend/src/3_applications/school/documents/RecordCardScanOutcome.mjs`
- Modify: `backend/src/3_applications/school/usecases/GradeSubmission.mjs`
- Modify: `backend/src/app.mjs` (RecordCardScanOutcome construction, ~line 2888)
- Test: `backend/src/3_applications/school/documents/RecordCardScanOutcome.test.mjs`, `backend/src/3_applications/school/usecases/GradeSubmission.test.mjs` (find its actual test file; if it lives elsewhere, e.g. `tests/isolated/`, follow it)

**Interfaces:**
- Consumes: `IReviewQueue` (`enqueue(items)`, `listForSession(sessionId)`, `resolve(...)` — `backend/src/3_applications/school/ports/IReviewQueue.mjs`); Task 1's `unscannedItems` + row `prompt`; `PRINT_DOCUMENT_REF_PATTERN` from `#domains/school/curriculum/unitValidation.mjs` (check the exact export name).
- Produces: `RecordCardScanOutcome` constructor accepts `reviewQueue = null`; bridge outcome gains `{advancedTo: 'submitted', reason: 'awaiting-review', pendingReview: n}` when items are queued; `GradeSubmission` grades print-ref units using the review queue as the expected-item roster.

- [ ] **Step 1: Write the failing bridge tests** — extend `RecordCardScanOutcome.test.mjs` with a `fakeReviewQueue`:

```js
function fakeReviewQueue() {
  const items = [];
  return {
    items,
    async enqueue(batch) { items.push(...structuredClone(batch)); },
    async listForSession(sessionId) { return structuredClone(items.filter((i) => i.sessionId === sessionId)); },
  };
}
```

```js
it('a complete scan with an ambiguous row holds at submitted and queues the row for a person', async () => {
  const datastore = fakeDatastore();
  const sessions = fakeSessions(seededSession('ws-1'));
  const reviewQueue = fakeReviewQueue();
  const useCase = new RecordCardScanOutcome({ datastore, sessions, reviewQueue, logger: quietLogger });
  const card = gradedCard({
    sessionId: 'ws-1',
    results: [
      { row: 1, itemId: 'q1', itemType: 'multiple_choice', prompt: 'P1', status: 'correct', given: 'blue', points: 1, earned: 1 },
      { row: 2, itemId: 'q2', itemType: 'multiple_choice', prompt: 'P2', status: 'ambiguous', given: ['A', 'B'], points: 1, earned: 0 },
    ],
    earnedPoints: 1,
  });
  const outcome = await useCase.execute({ testId: '1234567', card });
  expect(outcome.session).toMatchObject({ advancedTo: 'submitted', reason: 'awaiting-review', pendingReview: 1 });
  const types = (await sessions.readEvents('ws-1')).map((e) => e.type);
  expect(types).toEqual(['created', 'issued', 'submitted']); // graded is NOT appended
  // The machine marks are recorded as RESOLVED verdicts; the ambiguous row is pending.
  const pending = reviewQueue.items.filter((i) => !i.verdict);
  expect(pending).toEqual([expect.objectContaining({ itemId: 'q2', reason: 'ambiguous', given: ['A', 'B'], prompt: 'P2' })]);
  const resolved = reviewQueue.items.filter((i) => i.verdict);
  expect(resolved).toEqual([expect.objectContaining({ itemId: 'q1', verdict: 'correct', gradedBy: 'engine' })]);
});

it('write-on questions queue as free_response and hold the session at submitted', async () => {
  const datastore = fakeDatastore();
  const sessions = fakeSessions(seededSession('ws-1'));
  const reviewQueue = fakeReviewQueue();
  const useCase = new RecordCardScanOutcome({ datastore, sessions, reviewQueue, logger: quietLogger });
  const card = gradedCard({ sessionId: 'ws-1', unscannedItems: [{ itemId: 'w-essay', prompt: 'Explain.' }] });
  const outcome = await useCase.execute({ testId: '1234567', card });
  expect(outcome.session).toMatchObject({ advancedTo: 'submitted', reason: 'awaiting-review' });
  expect(reviewQueue.items.filter((i) => !i.verdict)).toEqual([
    expect.objectContaining({ itemId: 'w-essay', reason: 'free_response', prompt: 'Explain.' }),
  ]);
});

it('no ambiguous rows, no write-ons: graded as before, machine marks still on the verdict sheet', async () => {
  const datastore = fakeDatastore();
  const sessions = fakeSessions(seededSession('ws-1'));
  const reviewQueue = fakeReviewQueue();
  const useCase = new RecordCardScanOutcome({ datastore, sessions, reviewQueue, logger: quietLogger });
  const outcome = await useCase.execute({ testId: '1234567', card: gradedCard({ sessionId: 'ws-1', unscannedItems: [] }) });
  expect(outcome.session).toEqual({ sessionId: 'ws-1', advancedTo: 'graded' });
  expect(reviewQueue.items.every((i) => i.gradedBy === 'engine')).toBe(true);
});

it('without a reviewQueue wired, behavior degrades to wave-1 (graded when complete) — never a crash', async () => {
  const datastore = fakeDatastore();
  const sessions = fakeSessions(seededSession('ws-1'));
  const useCase = new RecordCardScanOutcome({ datastore, sessions, logger: quietLogger });
  const outcome = await useCase.execute({ testId: '1234567', card: gradedCard({ sessionId: 'ws-1' }) });
  expect(outcome.session).toEqual({ sessionId: 'ws-1', advancedTo: 'graded' });
});
```

The `gradedCard` fixture gains a default `unscannedItems: []` field.

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement the bridge side** in `RecordCardScanOutcome.mjs`:

- Constructor: `reviewQueue = null` dep, stored.
- In `#bridgeSession` (which now needs `state` — it already reduces it — plus the row results and unscannedItems): after the existing bridgeable/partial checks, build the verdict sheet exactly in `GradeSubmission`'s machine-mark shape (`GradeSubmission.mjs:160-173` is the reference — copy the field list):

```js
const nowIso = at;
if (this.#reviewQueue) {
  const machineMarks = card.results
    .filter((row) => row.status === 'correct' || row.status === 'incorrect')
    .map((row) => ({
      sessionId, itemId: row.itemId, learnerId: state.learnerId, unitId: state.unitId,
      reason: 'machine', given: row.given,
      prompt: row.prompt ?? null, questionNumber: row.row, rubric: null,
      enqueuedAt: nowIso,
      verdict: row.status === 'correct' ? 'correct' : 'incorrect',
      gradedBy: 'engine', gradedAt: nowIso,
      attemptId: attemptIdByItem.get(row.itemId) ?? null,
    }));
  const pending = [
    ...card.results.filter((row) => row.status === 'ambiguous').map((row) => ({
      sessionId, itemId: row.itemId, learnerId: state.learnerId, unitId: state.unitId,
      reason: 'ambiguous', given: row.given,
      prompt: row.prompt ?? null, questionNumber: row.row, rubric: null, enqueuedAt: nowIso,
    })),
    ...(card.unscannedItems ?? []).map((item) => ({
      sessionId, itemId: item.itemId, learnerId: state.learnerId, unitId: state.unitId,
      reason: 'free_response', given: null,
      prompt: item.prompt ?? null, questionNumber: null, rubric: null, enqueuedAt: nowIso,
    })),
  ];
  await this.#reviewQueue.enqueue([...machineMarks, ...pending]);
  if (pending.length > 0) {
    if (state.state !== 'submitted') { /* append submitted event exactly as now */ }
    this.#logger.info?.('school.print.scan-awaiting-review', { sessionId, pendingReview: pending.length });
    return { sessionId, advancedTo: 'submitted', reason: 'awaiting-review', pendingReview: pending.length };
  }
}
// fall through to the existing submitted+graded appends (item-count percent from Task 3)
```

`attemptIdByItem` is a `Map(itemId → attempt.id)` built during the append loop in `execute` and passed into `#bridgeSession` — adjust its signature (`#bridgeSession(card, attemptIds, attemptIdByItem, at)`), keeping backward behavior when `reviewQueue` is null. NOTE the no-pending case must ALSO enqueue the machine marks (verdict sheet completeness) — the third test asserts this; place the `enqueue` before the pending branch as shown.

- [ ] **Step 4: Write the failing GradeSubmission test** — print-ref units derive expected items from the review queue. Find GradeSubmission's existing test file (`grep -r "GradeSubmission" --include="*.test.mjs" backend/ tests/`) and add, following its existing fixture style for `sessions`/`curriculum`/`reviewQueue`/`grader`/`grownUps` fakes:

```js
it('a print-document unit grades from the review-queue roster once every verdict is in', async () => {
  // unit.document = 'print/science/biology/quiz-1@abcdef123', no unit.bank
  // session state: submitted
  // reviewQueue.listForSession returns 3 items: two machine-resolved (q1 correct, q2 incorrect),
  // one free_response 'w-essay' resolved correct by 'dad'
  // → execute({sessionId}) reaches 'graded' with percent 66.67 (2 of 3 correct)
  // and expectedItems == the 3 queue itemIds.
});
```

Write it CONCRETELY against the real fixture helpers in that file — the comment above is the scenario contract, not the test body; the implementer writes real code here, mirroring an adjacent test's setup. Assert: `status: 'graded'`, `percent` ≈ 66.67, and that a queue with an UNRESOLVED item instead returns `awaiting_review` with that itemId outstanding.

- [ ] **Step 5: Implement the GradeSubmission side** — in `GradeSubmission.mjs`, where `expectedItems` is computed (`:108-112`):

```js
import { PRINT_DOCUMENT_REF_PATTERN } from '#domains/school/curriculum/unitValidation.mjs';
// ...
const isPrintUnit = typeof unit?.document === 'string' && PRINT_DOCUMENT_REF_PATTERN.test(unit.document);
const expectedItems = isPrintUnit
  // The review queue IS the verdict sheet for a card-scanned print document:
  // the scan bridge enqueues every machine mark (resolved) and every
  // human-needed item (pending) — the roster of queue itemIds is therefore
  // exactly the set of questions the printed sheet carried, including the
  // bank-select expansion no static document walk could reproduce.
  ? [...new Set((await this.#reviewQueue.listForSession(sessionId)).map((item) => item.itemId))]
  : (document ? questionItemIds(document) : (bank?.items ?? []).map((i) => i.id));
```

(Verify the exact export name of the print-ref pattern in `unitValidation.mjs` — it was widened in the taxonomy work; if it is not exported, export it there first. Check the architecture gate allows application → domain imports — it does.) The rest of `GradeSubmission` (marked-map from the queue, verdict pass, outstanding calculation, `graded` append) works unchanged on that roster — that is the point of this design. Guard: an EMPTY roster (`expectedItems.length === 0`) must still return the existing "There are no questions to mark" unavailable — already handled by the existing check.

- [ ] **Step 6: Wire prod** — in `app.mjs`, add `reviewQueue: schoolLifecycle.stores.reviewQueue ?? null` to the `RecordCardScanOutcome` construction (the lifecycle exposes `stores.reviewQueue` — verify via `schoolLifecycle.mjs`'s `stores` object).

- [ ] **Step 7: Run everything this task touched** (`npx vitest run backend/src/3_applications/school/`) — all pass.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(school): scan bridge feeds the review queue; GradeSubmission finishes print sessions"` (with trailer).

---

### Task 5: Consumer diagnostics, conflict-message clarity, spec trust note

**Files:**
- Modify: `backend/src/5_composition/modules/schoolPrintScanConsumer.mjs`
- Modify: `backend/src/1_adapters/school/documents/YamlAllocationStore.mjs`
- Modify: `docs/_wip/plans/2026-08-04-print-design-system-requirements.md`
- Test: `tests/isolated/composition/schoolPrintScanConsumer.test.mjs` (if this file does not exist, check `grep -r "createSchoolPrintScanConsumer" tests/ backend/` for the real test location; if none exists, create it at that path with a minimal eventBus fake — `subscribe(topic, fn)` returning an unsubscribe — feeding `onPayload` a `{event:'sheet', marks:[...]}`; mock `resolveCardScan.execute` directly so no decode fixtures are needed), `backend/src/1_adapters/school/documents/YamlAllocationStore.test.mjs`

**Interfaces:**
- Consumes: Task 1's `deadCard` marker and per-record `error` entries.
- Produces: warn-level events `school.print.scan-dead-card` and `school.print.scan-record-refused`; error entries excluded from the `scan-resolved` info log; `ALLOCATION_RECORD_ID_CONFLICT` message names WHICH check failed.

- [ ] **Step 1: Write the failing consumer tests** (location per the note above):

```js
it('a dead card with answers warns — the child\'s work must not vanish below warn', async () => {
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const resolveCardScan = { execute: vi.fn().mockResolvedValue({
    results: [], deadCard: true, answeredRowCount: 4, recordStatuses: ['released'],
  }) };
  // ...construct consumer with a captured onPayload via the eventBus fake, fire a sheet event,
  // flush microtasks (await new Promise(setImmediate))...
  expect(logger.warn).toHaveBeenCalledWith('school.print.scan-dead-card', expect.objectContaining({ answeredRowCount: 4 }));
});

it('a per-record refusal (drift / resolve failure) warns per record and is excluded from scan-resolved', async () => {
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const resolveCardScan = { execute: vi.fn().mockResolvedValue({ results: [
    { cardId: '1234567', recordId: 'r1', documentId: 'd1', rev: 'a', variant: 0, error: { code: 'ALLOCATION_ROW_MAPPING_DRIFT' } },
    { cardId: '1234567', recordId: 'r2', documentId: 'd2', rev: 'a', variant: 0, revisionSuperseded: false, results: [], totalPoints: 1, earnedPoints: 1 },
  ] }) };
  // ...fire...
  expect(logger.warn).toHaveBeenCalledWith('school.print.scan-record-refused', expect.objectContaining({ recordId: 'r1', code: 'ALLOCATION_ROW_MAPPING_DRIFT' }));
  const resolvedCalls = logger.info.mock.calls.filter(([event]) => event === 'school.print.scan-resolved');
  expect(resolvedCalls).toHaveLength(1);
  expect(resolvedCalls[0][1].recordId).toBe('r2');
});
```

- [ ] **Step 2: Implement in `schoolPrintScanConsumer.mjs`:** after the `unknownCard` branch add:

```js
if (outcome?.deadCard) {
  logger.warn?.('school.print.scan-dead-card', {
    testId, answeredRowCount: outcome.answeredRowCount, recordStatuses: outcome.recordStatuses,
  });
  return;
}
```

and in the per-card loop, FIRST:

```js
if (card.error) {
  logger.warn?.('school.print.scan-record-refused', {
    testId, recordId: card.recordId, documentId: card.documentId, code: card.error.code,
  });
  continue;
}
```

(then the existing `scan-resolved` info + `reScored` warn + recording call, whose own `card.error` guard becomes redundant — remove it).

- [ ] **Step 3: Store message clarity** — in `YamlAllocationStore.mjs`'s idClash branch, when the clash is a satisfied record that FAILED `isIdenticalReprint`, say why:

```js
if (idClash) {
  if (idClash.status === 'satisfied') {
    if (isIdenticalReprint(idClash, request)) return structuredClone(idClash);
    throw new DomainInvariantError(
      `allocation recordId "${recordId}" exists satisfied on card ${resolvedCardId} but the request `
        + `is not an identical reprint (${reprintMismatchReason(idClash, request)})`,
      { code: 'ALLOCATION_RECORD_ID_CONFLICT', details: { cardId: resolvedCardId, recordId } },
    );
  }
  throw new DomainInvariantError(/* existing message/details unchanged */);
}
```

with `reprintMismatchReason(record, request)` returning `'seed differs'` | `'learner differs'` | `'row mapping differs'` (first check that fails, same order as `isIdenticalReprint`). Store test: assert the message matches `/learner differs/` for the existing different-learner case.

- [ ] **Step 4: Spec trust note (M1 residue)** — in `docs/_wip/plans/2026-08-04-print-design-system-requirements.md`, find the teacher-key / render-modes section (grep `teacher`) and append one short paragraph:

> **Trust model:** print endpoints are unauthenticated household surfaces; the only privileged artifact is the answer key. `teacher=1` therefore requires `pin=` matching the household school config's `print.teacherPin` and denies (403) when unset or wrong. The pin rides the query string — visible in access logs and browser history — which is an accepted trade-off at household scale; it gates children, not adversaries.

- [ ] **Step 5: Run** consumer + store suites; all pass.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "fix(school): scan diagnostics never drop below warn; reprint conflicts say why; spec trust note"` (with trailer).

---

### Task 6: Full sweep + integration coherence (controller-executed)

Run by the controller after Tasks 1-5 (not a subagent): full school sweep (see Global Constraints), `node --check backend/src/app.mjs`, then ff-merge to main, gated deploy (playback/session gate as a separate halting step), live verification:
- `?variety=omr&learnerId=felix` still reproduces felix's sheet (published-first now, record rev unchanged `@632002966`).
- `?variety=omr&card=1111111` → 400 demanding learnerId.
- `?variety=omr&card=<felix's card>&learnerId=soren` → 409 `CARD_LEARNER_MISMATCH`.
- Teacher key with pin still 200.
- Container logs clean of FATAL.
