/**
 * ResolveCardScan — scan-back resolution + grading (spec §5.4, §5.5, Task 6).
 * Exercises the REAL pipeline end to end: a source document is actually
 * published (`PublishPrintDocument`) and actually card-attach rendered
 * (`RenderPrintDocument`, real allocation store), then `ResolveCardScan`
 * resolves a decoded scan against exactly what got persisted — the same
 * division of labor `RenderPrintDocument.test.mjs`'s own card-allocation
 * suite uses, extended one step further into grading.
 */
import { describe, it, expect } from 'vitest';
import { PublishPrintDocument } from './PublishPrintDocument.mjs';
import { RenderPrintDocument } from './RenderPrintDocument.mjs';
import { ResolveCardScan } from './ResolveCardScan.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';
import { DOCUMENT_SOURCE_SCHEMA } from '#domains/school/documents/documentSource.mjs';

const richText = (md) => ({ type: 'rich_text', md });

const mcQuestion = (itemId, number, { choices, answer, points } = {}) => ({
  type: 'question',
  itemId,
  number,
  blocks: [richText(`Prompt for ${itemId}`)],
  choices,
  answer,
  ...(points !== undefined ? { points } : {}),
});

const tfQuestion = (itemId, number, answer) => ({
  type: 'question',
  itemId,
  number,
  blocks: [richText(`Prompt for ${itemId}`)],
  trueFalse: true,
  answer,
});

const msQuestion = (itemId, number, { choices, answers } = {}) => ({
  type: 'question',
  itemId,
  number,
  blocks: [richText(`Prompt for ${itemId}`)],
  choices,
  answers,
});

const sourceDoc = (id, blocks, over = {}) => ({
  schema: DOCUMENT_SOURCE_SCHEMA,
  id,
  seed: 12345,
  variant: 0,
  target: ['letter'],
  archetype: 'quiz',
  title: id,
  blocks,
  ...over,
});

/**
 * In-memory `YamlPrintDocumentRepository`-shaped fake: `getPublished(id, rev?)`
 * without a `rev` returns the MOST RECENTLY published one for `id` (mirrors
 * the real repository's mtime-latest semantics — this fake tracks insertion
 * order instead, since our tests publish strictly sequentially).
 */
function fakeRepository() {
  const published = new Map(); // `${id}@${rev}` -> document
  const banks = new Map(); // `${id}@${rev}` -> bank
  const latestRevById = new Map(); // id -> rev
  return {
    async writePublished({ document, bank, rev }) {
      const key = `${document.id}@${rev}`;
      published.set(key, document);
      if (bank) banks.set(key, bank);
      latestRevById.set(document.id, rev);
      return {
        document: { written: true, alreadyPublished: false },
        bank: bank ? { written: true, alreadyPublished: false } : null,
      };
    },
    async getPublished(id, rev) {
      const resolvedRev = rev ?? latestRevById.get(id);
      if (!resolvedRev) return null;
      return published.get(`${id}@${resolvedRev}`) ?? null;
    },
    async getDerivedBank(id, rev) {
      return banks.get(`${id}@${rev}`) ?? null;
    },
  };
}

/** Fresh in-memory `YamlAllocationStore` — no filesystem (mirrors RenderPrintDocument.test.mjs's own fake). */
function fakeAllocationStore(over = {}) {
  const map = new Map();
  const io = {
    load: (filePath) => (map.has(filePath) ? structuredClone(map.get(filePath)) : null),
    save: (filePath, content) => { map.set(filePath, structuredClone(content)); },
  };
  return new YamlAllocationStore({
    directory: '/docs', io, now: () => '2026-08-04T00:00:00.000Z', rng: () => 0.42, ...over,
  });
}

/** Publishes `source`, then card-attach renders the published v2 document (real fit/render), returning `{repository, allocationStore, allocation, published}`. */
async function publishAndAllocate({
  repository, allocationStore, source, context,
}) {
  const publisher = new PublishPrintDocument({ repository });
  const { id, rev } = await publisher.execute({ source });
  const published = await repository.getPublished(id, rev);
  const renderer = new RenderPrintDocument({ repository, allocationStore });
  const result = await renderer.execute({ document: published, context });
  return { allocation: result.allocation, published };
}

describe('constructor', () => {
  it('requires allocationStore and repository', () => {
    expect(() => new ResolveCardScan({})).toThrow(/allocationStore/);
    expect(() => new ResolveCardScan({ allocationStore: {} })).toThrow(/repository/);
  });
});

describe('execute — CARD_ID_UNREADABLE (spec §5.4)', () => {
  it('never guesses a null testId', async () => {
    const allocationStore = fakeAllocationStore();
    const repository = fakeRepository();
    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({ testId: null, answers: { 1: 'A' } });
    expect(result).toEqual({ error: { code: 'CARD_ID_UNREADABLE' } });
  });

  it('never guesses a testId with an unreadable digit', async () => {
    const allocationStore = fakeAllocationStore();
    const repository = fakeRepository();
    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({ testId: '482?306', answers: { 1: 'A' } });
    expect(result).toEqual({ error: { code: 'CARD_ID_UNREADABLE' } });
  });

  it('never even queries the allocation store for an unreadable id', async () => {
    const repository = fakeRepository();
    const allocationStore = { findByCard: () => { throw new Error('must not be called'); } };
    const useCase = new ResolveCardScan({ allocationStore, repository });
    await expect(useCase.execute({ testId: '???????', answers: {} })).resolves.toEqual({
      error: { code: 'CARD_ID_UNREADABLE' },
    });
  });
});

describe('execute — grading across item types (spec §5.4/§5.5)', () => {
  async function setup() {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const source = sourceDoc('mixed-quiz', [
      mcQuestion('q1', 1, { choices: ['Alpha', 'Beta', 'Gamma'], answer: 'Alpha' }),
      mcQuestion('q2', 2, { choices: ['Alpha', 'Beta', 'Gamma'], answer: 'Alpha' }),
      tfQuestion('q3', 3, true),
      msQuestion('q4', 4, { choices: ['Red', 'Green', 'Blue', 'Yellow'], answers: ['Red', 'Blue'] }),
      mcQuestion('q5', 5, { choices: ['Alpha', 'Beta'], answer: 'Beta', points: 5 }),
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true, learnerId: 'kid-1' },
    });
    return { repository, allocationStore, allocation };
  }

  it('grades multiple_choice correct/incorrect, true_false, multi_select exact-set, per-block points, and flags a double-mark on a single-select row as ambiguous, leaving unanswered rows blank', async () => {
    const { repository, allocationStore, allocation } = await setup();
    const useCase = new ResolveCardScan({ allocationStore, repository });

    const result = await useCase.execute({
      testId: allocation.cardId,
      answers: {
        1: 'A', // correct multiple_choice (Alpha)
        2: ['A', 'B'], // double-mark on a single-select row -> ambiguous
        3: 'A', // true_false: A = true = correct
        4: ['A', 'C'], // multi_select exact set {Red, Blue} -> correct
        // row 5 left unanswered -> blank
      },
    });

    expect(result.results).toHaveLength(1);
    const card = result.results[0];
    expect(card).toMatchObject({
      cardId: allocation.cardId,
      documentId: 'mixed-quiz',
      learnerId: 'kid-1',
      revisionSuperseded: false,
    });
    expect(card.results).toEqual([
      {
        row: 1, itemId: 'q1', status: 'correct', given: 'Alpha', points: 1, earned: 1,
      },
      {
        row: 2, itemId: 'q2', status: 'ambiguous', given: ['A', 'B'], points: 1, earned: 0,
      },
      {
        row: 3, itemId: 'q3', status: 'correct', given: 'A', points: 1, earned: 1,
      },
      {
        row: 4, itemId: 'q4', status: 'correct', given: ['Red', 'Blue'], points: 1, earned: 1,
      },
      {
        row: 5, itemId: 'q5', status: 'blank', given: null, points: 5, earned: 0,
      },
    ]);
    expect(card.totalPoints).toBe(9); // 1+1+1+1+5
    expect(card.earnedPoints).toBe(3); // rows 1,3,4
    expect(result.unallocatedRows).toBeUndefined();
  });

  it('grades an incorrect multi_select (wrong set) and an incorrect multiple_choice distinctly from ambiguous', async () => {
    const { repository, allocationStore, allocation } = await setup();
    const useCase = new ResolveCardScan({ allocationStore, repository });

    const result = await useCase.execute({
      testId: allocation.cardId,
      answers: {
        1: 'B', // wrong single mark -> incorrect (Beta != Alpha)
        4: ['A'], // partial multi_select set -> incorrect (missing Blue)
      },
    });

    const card = result.results[0];
    const byRow = Object.fromEntries(card.results.map((r) => [r.row, r]));
    expect(byRow[1]).toMatchObject({ status: 'incorrect', given: 'Beta' });
    expect(byRow[4]).toMatchObject({ status: 'incorrect', given: ['Red'] });
  });

  it('marks the allocation record satisfied once every row in its range is answered, but leaves it live under partial coverage', async () => {
    const { repository, allocationStore, allocation } = await setup();
    const useCase = new ResolveCardScan({ allocationStore, repository });

    await useCase.execute({ testId: allocation.cardId, answers: { 1: 'A' } });
    let [record] = await allocationStore.findByCard(allocation.cardId);
    expect(record.status).toBe('live');

    await useCase.execute({
      testId: allocation.cardId,
      answers: {
        1: 'A', 2: 'A', 3: 'A', 4: ['A', 'C'], 5: 'B',
      },
    });
    [record] = await allocationStore.findByCard(allocation.cardId);
    expect(record.status).toBe('satisfied');
  });
});

describe('execute — multi-doc shared card spanning the bank boundary (spec §5.1/§5.4)', () => {
  it('resolves two allocation records on the same physical card independently, one per document', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();

    const firstSource = sourceDoc('boundary-doc-a', [
      mcQuestion('a1', 1, { choices: ['X', 'Y'], answer: 'X' }),
      mcQuestion('a2', 2, { choices: ['X', 'Y'], answer: 'Y' }),
    ]);
    const { allocation: firstAllocation } = await publishAndAllocate({
      repository, allocationStore, source: firstSource, context: { freshCard: true },
    });

    // Second document allocated onto the SAME card, starting at row 26 — the
    // physical bank boundary (spec §5.1) is a decoding detail, not an
    // allocation constraint, so this is a perfectly legal non-overlapping
    // second allocation.
    const secondSource = sourceDoc('boundary-doc-b', [
      tfQuestion('b1', 1, false),
      tfQuestion('b2', 2, true),
    ]);
    const { allocation: secondAllocation } = await publishAndAllocate({
      repository,
      allocationStore,
      source: secondSource,
      context: { cardId: firstAllocation.cardId, startRow: 26 },
    });
    expect(secondAllocation.rowRange).toEqual({ start: 26, end: 27 });

    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({
      testId: firstAllocation.cardId,
      answers: {
        1: 'A', 2: 'A', 26: 'B', 27: 'A',
      },
    });

    expect(result.results).toHaveLength(2);
    const byDoc = Object.fromEntries(result.results.map((r) => [r.documentId, r]));
    expect(byDoc['boundary-doc-a'].results).toEqual([
      {
        row: 1, itemId: 'a1', status: 'correct', given: 'X', points: 1, earned: 1,
      },
      {
        row: 2, itemId: 'a2', status: 'incorrect', given: 'X', points: 1, earned: 0,
      },
    ]);
    expect(byDoc['boundary-doc-b'].results).toEqual([
      {
        row: 26, itemId: 'b1', status: 'correct', given: 'B', points: 1, earned: 1,
      },
      {
        row: 27, itemId: 'b2', status: 'correct', given: 'A', points: 1, earned: 1,
      },
    ]);
    expect(result.unallocatedRows).toBeUndefined();
  });
});

describe('execute — unallocated rows (spec §5.4: "never guessed")', () => {
  it('reports an answered row that matches no live/satisfied allocation on the card, without dropping the rows that DO resolve', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const source = sourceDoc('small-quiz', [
      mcQuestion('s1', 1, { choices: ['X', 'Y'], answer: 'X' }),
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true },
    });

    const result = await useCaseExecute({ allocationStore, repository }, {
      testId: allocation.cardId,
      answers: { 1: 'A', 10: 'B' },
    });

    expect(result.results).toHaveLength(1);
    expect(result.unallocatedRows).toEqual([10]);
  });

  it('reports every answered row as unallocated when the card has no records at all', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const result = await useCaseExecute({ allocationStore, repository }, {
      testId: '9999999',
      answers: { 3: 'A', 1: 'B' },
    });
    expect(result.results).toEqual([]);
    expect(result.unallocatedRows).toEqual([1, 3]);
  });

  it('reports a RELEASED record\'s rows as unallocated and grades nothing for them (spec §5.4 review fix, Important)', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const source = sourceDoc('released-quiz', [
      mcQuestion('rel-q1', 1, { choices: ['X', 'Y'], answer: 'X' }),
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true },
    });
    const [record] = await allocationStore.findByCard(allocation.cardId);
    await allocationStore.updateStatus({
      cardId: allocation.cardId, recordId: record.recordId, status: 'released',
    });

    const result = await useCaseExecute({ allocationStore, repository }, {
      testId: allocation.cardId,
      answers: { 1: 'A' },
    });

    expect(result.results).toEqual([]);
    expect(result.unallocatedRows).toEqual([1]);
  });
});

describe('execute — row ownership on reuse: newest claimant wins (spec §5.4 review fix, Critical)', () => {
  it('grades ONLY the newer live record when a settled record\'s rows are reallocated to a different document; the old record never appears and is never re-graded', async () => {
    const repository = fakeRepository();
    // A store whose clock we can advance BETWEEN allocations, so the two
    // competing records on this card carry distinct, orderable `renderedAt`
    // timestamps — exactly the signal `resolveRowOwners` arbitrates on.
    const clock = { at: '2026-08-04T00:00:00.000Z' };
    const map = new Map();
    const io = {
      load: (filePath) => (map.has(filePath) ? structuredClone(map.get(filePath)) : null),
      save: (filePath, content) => { map.set(filePath, structuredClone(content)); },
    };
    const allocationStore = new YamlAllocationStore({
      directory: '/docs', io, now: () => clock.at, rng: () => 0.42,
    });
    const resolver = new ResolveCardScan({ allocationStore, repository });

    // quiz-1: rows 1-2 on a fresh card, then fully answered -> satisfied.
    // Once satisfied, its rows are no longer collision-protected
    // (`checkCollision` only blocks `live` ranges — allocation.mjs).
    const quiz1 = sourceDoc('reuse-quiz-1', [
      mcQuestion('r1-q1', 1, { choices: ['X', 'Y'], answer: 'X' }),
      mcQuestion('r1-q2', 2, { choices: ['X', 'Y'], answer: 'Y' }),
    ]);
    const { allocation: firstAllocation } = await publishAndAllocate({
      repository, allocationStore, source: quiz1, context: { freshCard: true },
    });
    const { cardId } = firstAllocation;
    await resolver.execute({ testId: cardId, answers: { 1: 'A', 2: 'B' } });
    const [settledFirstRecord] = await allocationStore.findByCard(cardId);
    expect(settledFirstRecord.status).toBe('satisfied');

    // Advance the clock, then legitimately reallocate the SAME rows to a
    // completely different document.
    clock.at = '2026-08-05T00:00:00.000Z';
    const quiz2 = sourceDoc('reuse-quiz-2', [
      mcQuestion('r2-q1', 1, { choices: ['P', 'Q'], answer: 'P' }),
      mcQuestion('r2-q2', 2, { choices: ['P', 'Q'], answer: 'P' }),
    ]);
    const { allocation: secondAllocation } = await publishAndAllocate({
      repository, allocationStore, source: quiz2, context: { cardId, startRow: 1 },
    });
    expect(secondAllocation.rowRange).toEqual({ start: 1, end: 2 });

    const recordsAfterReuse = await allocationStore.findByCard(cardId);
    expect(recordsAfterReuse).toHaveLength(2);
    expect(recordsAfterReuse.map((r) => r.status).sort()).toEqual(['live', 'satisfied']);

    // The SAME physical marks, scanned again: must grade ONLY against
    // quiz-2's answer key (the newest claimant) — quiz-1 must be entirely
    // absent from results, never re-graded against its own (stale) key.
    const result = await resolver.execute({ testId: cardId, answers: { 1: 'A', 2: 'B' } });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].documentId).toBe('reuse-quiz-2');
    expect(result.results[0].results).toEqual([
      {
        row: 1, itemId: 'r2-q1', status: 'correct', given: 'P', points: 1, earned: 1,
      },
      {
        row: 2, itemId: 'r2-q2', status: 'incorrect', given: 'Q', points: 1, earned: 0,
      },
    ]);
    expect(result.unallocatedRows).toBeUndefined();

    // quiz-2 was fully answered this scan -> live -> satisfied; quiz-1's
    // already-satisfied record is untouched (no re-write, no re-grade).
    const finalRecords = await allocationStore.findByCard(cardId);
    const quiz1Record = finalRecords.find((r) => r.documentId === 'reuse-quiz-1');
    const quiz2Record = finalRecords.find((r) => r.documentId === 'reuse-quiz-2');
    expect(quiz1Record.status).toBe('satisfied');
    expect(quiz2Record.status).toBe('satisfied');
  });
});

describe('execute — revisionSuperseded (spec §4.3)', () => {
  it('flags revisionSuperseded when a newer rev has since been published, but still grades against the PINNED rev the card was allocated against', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const source = sourceDoc('revisable-quiz', [
      mcQuestion('r1', 1, { choices: ['Old', 'Other'], answer: 'Old' }),
    ]);
    const { allocation, published: firstPublished } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true },
    });

    // Republish an EDITED source under the same id — a new rev, never
    // mutating the first (spec §4.3's post-issue immutability).
    const editedSource = sourceDoc('revisable-quiz', [
      mcQuestion('r1', 1, { choices: ['New', 'Other'], answer: 'New' }),
    ]);
    const publisher = new PublishPrintDocument({ repository });
    const { rev: secondRev } = await publisher.execute({ source: editedSource });
    expect(secondRev).not.toBe(firstPublished.rev);

    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({ testId: allocation.cardId, answers: { 1: 'A' } });

    const card = result.results[0];
    expect(card.rev).toBe(firstPublished.rev);
    expect(card.revisionSuperseded).toBe(true);
    // Still graded against the PINNED (old) rev's answer key: 'A' -> 'Old' -> correct.
    expect(card.results[0]).toMatchObject({ status: 'correct', given: 'Old' });
  });
});

/** Small helper so the "unallocated rows" describe block reads as one call per test. */
async function useCaseExecute(deps, args) {
  const useCase = new ResolveCardScan(deps);
  return useCase.execute(args);
}
