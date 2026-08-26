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
import { deriveShuffle, applyShuffle } from '#domains/school/documents/shuffle.mjs';

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
    list: (dir) => [...map.keys()]
      .filter((p) => p.startsWith(`${dir}/`))
      .map((p) => p.slice(dir.length + 1).replace(/\.yml$/, '')),
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

describe('execute — composed allocation sections', () => {
  it('returns independent lesson slices from one shared-card scan', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const source = sourceDoc('composed-sections', [
      mcQuestion('q1', 1, { choices: ['Alpha', 'Beta'], answer: 'Alpha' }),
      mcQuestion('q2', 2, { choices: ['Alpha', 'Beta'], answer: 'Beta' }),
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source,
      context: {
        freshCard: true, learnerId: 'learner3',
        sectionAttribution: [
          { id: 'a', itemIds: ['q1'], sessionId: 'session-a', lessonId: 'lesson-a' },
          { id: 'b', itemIds: ['q2'], sessionId: 'session-b', lessonId: 'lesson-b' },
        ],
      },
    });
    const result = await new ResolveCardScan({ allocationStore, repository }).execute({
      testId: allocation.cardId, answers: { 1: 'A', 2: 'B' },
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].sections).toEqual([
      expect.objectContaining({ id: 'a', sessionId: 'session-a', rowRange: { start: 1, end: 1 } }),
      expect.objectContaining({ id: 'b', sessionId: 'session-b', rowRange: { start: 2, end: 2 } }),
    ]);
    expect(result.results[0].sections.every((section) => section.results[0].status === 'correct')).toBe(true);
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

  it('never guesses a testId with an unreadable digit when no allocated card is consistent with the pattern', async () => {
    const allocationStore = fakeAllocationStore();
    const repository = fakeRepository();
    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({ testId: '482?306', answers: { 1: 'A' } });
    // Best-effort resolution (household direction) ran — the store has no
    // cards at all, so zero candidates were consistent — and it still
    // refuses exactly like before, now WITH the diagnostic (`ambiguous`)
    // that explains why, mirroring `unknownCard`'s `nearMissCardIds`.
    expect(result).toEqual({
      error: { code: 'CARD_ID_UNREADABLE' },
      ambiguous: { pattern: '482?306', candidateCardIds: [] },
    });
  });

  it('never even queries the allocation store for an unreadable id when the store cannot list known cards', async () => {
    const repository = fakeRepository();
    const allocationStore = { findByCard: () => { throw new Error('must not be called'); } };
    const useCase = new ResolveCardScan({ allocationStore, repository });
    // No `listCardIds` on this fake (older-store shape) — best-effort
    // resolution can't even be attempted, so it degrades straight to the
    // same refusal, never touching `findByCard`.
    await expect(useCase.execute({ testId: '???????', answers: {} })).resolves.toEqual({
      error: { code: 'CARD_ID_UNREADABLE' },
      ambiguous: { pattern: '???????', candidateCardIds: [] },
    });
  });
});

// Best-effort ambiguous-id resolution (household direction, real incident
// 2026-08-14): a double-marked test-id digit decoded '?', matched no
// allocation, and a fully-answered sheet silently vanished. These exercise
// the full `execute` path — `#resolveTestId` -> `resolveAmbiguousCardId`
// (`allocation.mjs`, unit-tested on its own in
// `tests/isolated/domain/school/documents/allocation.test.mjs`) -> the SAME
// `findByCard`/grading `execute` already ran for a cleanly-read id.
describe('execute — best-effort ambiguous card-id resolution (household direction)', () => {
  function spyLogger() {
    const calls = [];
    return { calls, warn: (...args) => calls.push(args), debug() {}, info() {}, error() {} };
  }

  it('resolves and grades when EXACTLY ONE known card is consistent with the pattern, and marks cardIdInferred', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore(); // constant rng -> first card is '4444444'
    const source = sourceDoc('ambiguous-quiz', [
      mcQuestion('q1', 1, { choices: ['Alpha', 'Beta'], answer: 'Alpha' }),
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true },
    });
    expect(allocation.cardId).toBe('4444444');

    const logger = spyLogger();
    const useCase = new ResolveCardScan({ allocationStore, repository, logger });
    // Position 3 double-marked digits 4 and 7 (a decoy that happens to
    // match no printed card) — only '4444444' in the store is consistent.
    const result = await useCase.execute({
      testId: '444?444',
      testIdCandidates: [[4], [4], [4], [4, 7], [4], [4], [4]],
      answers: { 1: 'A' },
    });

    expect(result.cardIdInferred).toEqual({ pattern: '444?444', cardId: '4444444' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].cardId).toBe('4444444');
    expect(result.results[0].results[0]).toMatchObject({ row: 1, status: 'correct' });
    // LOUD BY DESIGN: an inferred id must be visible in the log, not just the record.
    expect(logger.calls.some((call) => call[0] === 'school.scan.card-id-inferred'
      && call[1].pattern === '444?444' && call[1].cardId === '4444444')).toBe(true);
  });

  it('refuses (never guesses) when TWO known cards are both consistent with the pattern', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const source = sourceDoc('ambiguous-quiz-a', [
      mcQuestion('q1', 1, { choices: ['Alpha', 'Beta'], answer: 'Alpha' }),
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true },
    });
    expect(allocation.cardId).toBe('4444444');
    // A second, decoy card differing only at the ambiguous position, with
    // the OTHER digit the double mark actually hit — seeded directly
    // (bypassing render) since only its id needs to exist for this test.
    await allocationStore.allocate({
      cardId: '4447444',
      request: {
        documentId: 'decoy-doc', rev: 'r1', seed: 1, rowRange: { start: 1, end: 1 },
      },
    });

    const logger = spyLogger();
    const useCase = new ResolveCardScan({ allocationStore, repository, logger });
    const result = await useCase.execute({
      testId: '444?444',
      testIdCandidates: [[4], [4], [4], [4, 7], [4], [4], [4]],
      answers: { 1: 'A' },
    });

    expect(result).toEqual({
      error: { code: 'CARD_ID_UNREADABLE' },
      ambiguous: { pattern: '444?444', candidateCardIds: ['4444444', '4447444'] },
    });
    expect(logger.calls.some((call) => call[0] === 'school.scan.card-id-unresolved')).toBe(true);
    // Never the "resolved" log — nothing was actually inferred.
    expect(logger.calls.some((call) => call[0] === 'school.scan.card-id-inferred')).toBe(false);
  });

  it('refuses when NO known card is consistent with the pattern', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const source = sourceDoc('ambiguous-quiz-b', [
      mcQuestion('q1', 1, { choices: ['Alpha', 'Beta'], answer: 'Alpha' }),
    ]);
    await publishAndAllocate({ repository, allocationStore, source, context: { freshCard: true } });
    // Only card in the store is '4444444' (digit 4 throughout); a double
    // mark that hit digits 7 and 9 (never 4) at the ambiguous position is
    // consistent with no known card at all.
    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({
      testId: '444?444',
      testIdCandidates: [[4], [4], [4], [7, 9], [4], [4], [4]],
      answers: { 1: 'A' },
    });

    expect(result).toEqual({
      error: { code: 'CARD_ID_UNREADABLE' },
      ambiguous: { pattern: '444?444', candidateCardIds: [] },
    });
  });

  it('a blank column (no marks at all, not double-marked) still resolves when only one known card fits — full wildcard, narrowed by every OTHER clean digit', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const source = sourceDoc('ambiguous-quiz-c', [
      mcQuestion('q1', 1, { choices: ['Alpha', 'Beta'], answer: 'Alpha' }),
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true },
    });
    expect(allocation.cardId).toBe('4444444');

    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({
      testId: '444?444',
      testIdCandidates: [[4], [4], [4], [], [4], [4], [4]], // blank column: no marks
      answers: { 1: 'A' },
    });

    expect(result.cardIdInferred).toEqual({ pattern: '444?444', cardId: '4444444' });
    expect(result.results).toHaveLength(1);
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
        row: 1, itemId: 'q1', itemType: 'multiple_choice', prompt: 'Prompt for q1', status: 'correct', given: 'Alpha', points: 1, earned: 1, concepts: [],
      },
      {
        row: 2, itemId: 'q2', itemType: 'multiple_choice', prompt: 'Prompt for q2', status: 'ambiguous', given: ['A', 'B'], points: 1, earned: 0, concepts: [],
      },
      {
        row: 3, itemId: 'q3', itemType: 'true_false', prompt: 'Prompt for q3', status: 'correct', given: 'A', points: 1, earned: 1, concepts: [],
      },
      {
        row: 4, itemId: 'q4', itemType: 'multi_select', prompt: 'Prompt for q4', status: 'correct', given: ['Red', 'Blue'], points: 1, earned: 1, concepts: [],
      },
      {
        row: 5, itemId: 'q5', itemType: 'multiple_choice', prompt: 'Prompt for q5', status: 'blank', given: null, points: 5, earned: 0, concepts: [],
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

describe('execute — row results carry concepts and renderedAt (R2)', () => {
  it('row results carry the bank item concepts and the record renderedAt', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    // Concepts are a BANK ITEM field (questionBankValidation.mjs:57-61); an
    // inline `question` block (mcQuestion above) never threads a `concepts`
    // key through `publishQuestion` (documentSource.mjs) into its minted
    // item, so the only fixture shape that actually carries concepts through
    // this pipeline is a bank-select block against an external bank whose
    // item defines them directly (mirrors the F1/F4 review-fix fixtures
    // above).
    const bank = {
      id: 'concepts-bank',
      items: [
        {
          id: 'c-mc1', type: 'multiple_choice', prompt: 'Q1', choices: ['A', 'B'], answer: 'A', concepts: ['fraction-add'],
        },
      ],
    };
    const banks = { getBank: (id) => (id === bank.id ? bank : null) };
    const source = sourceDoc('concepts-doc', [
      {
        type: 'question', bankId: bank.id, select: 1, key: 'sel1',
      },
    ]);

    const publisher = new PublishPrintDocument({ repository });
    const { id, rev } = await publisher.execute({ source });
    const published = await repository.getPublished(id, rev);
    const renderer = new RenderPrintDocument({ repository, allocationStore, banks });
    const { allocation } = await renderer.execute({ document: published, context: { freshCard: true } });
    const [record] = await allocationStore.findByCard(allocation.cardId);

    const useCase = new ResolveCardScan({ allocationStore, repository, banks });
    const result = await useCase.execute({ testId: allocation.cardId, answers: { 1: 'A' } });

    expect(result.results).toHaveLength(1);
    const card = result.results[0];
    expect(card.results[0].concepts).toEqual(['fraction-add']);
    expect(card.renderedAt).toBe(record.renderedAt);
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
        row: 1, itemId: 'a1', itemType: 'multiple_choice', prompt: 'Prompt for a1', status: 'correct', given: 'X', points: 1, earned: 1, concepts: [],
      },
      {
        row: 2, itemId: 'a2', itemType: 'multiple_choice', prompt: 'Prompt for a2', status: 'incorrect', given: 'X', points: 1, earned: 0, concepts: [],
      },
    ]);
    expect(byDoc['boundary-doc-b'].results).toEqual([
      {
        row: 26, itemId: 'b1', itemType: 'true_false', prompt: 'Prompt for b1', status: 'correct', given: 'B', points: 1, earned: 1, concepts: [],
      },
      {
        row: 27, itemId: 'b2', itemType: 'true_false', prompt: 'Prompt for b2', status: 'correct', given: 'A', points: 1, earned: 1, concepts: [],
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

  it('a card with no records at all and real answers is an UNKNOWN CARD, with Hamming-1 live near-misses suggested', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore({ rng: Math.random });
    // A real live card exists whose id is one digit off what got bubbled.
    const source = sourceDoc('near-quiz', [
      mcQuestion('n1', 1, { choices: ['X', 'Y'], answer: 'X' }),
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true },
    });
    const mistyped = allocation.cardId.replace(/\d$/, (d) => String((Number(d) + 1) % 10));

    const result = await useCaseExecute({ allocationStore, repository }, {
      testId: mistyped,
      answers: { 3: 'A', 1: 'B' },
    });
    expect(result.results).toEqual([]);
    expect(result.unknownCard).toBe(true);
    expect(result.answeredRowCount).toBe(2);
    expect(result.nearMissCardIds).toEqual([allocation.cardId]);
  });

  it('an unknown card with NO answers stays a quiet empty result (a stray/blank feed, not lost work)', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const result = await useCaseExecute({ allocationStore, repository }, {
      testId: '9999999', answers: {},
    });
    // `cardRecordCount: 0` is what EARNS the quiet here (2026-08-26): it is the
    // signal `schoolPrintScanConsumer` reads to tell a legacy sheet this system
    // never issued (stay silent) from a card we did issue whose rows did not
    // match the marks (never stay silent).
    expect(result).toEqual({ results: [], cardRecordCount: 0 });
  });

  it('reports how many records the card carries, so an empty result can be told from a foreign sheet', async () => {
    // The 2026-08-26 silent scan: a cumulative card whose LIVE record got zero
    // marks while its older satisfied rows still carried last week's. `results`
    // is empty for both this and a sheet we never issued — `cardRecordCount` is
    // the only thing that distinguishes them.
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore({ rng: Math.random });
    const source = sourceDoc('unmarked-quiz', [
      mcQuestion('um-q1', 1, { choices: ['X', 'Y'], answer: 'X' }),
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true },
    });

    // Answer a row this card's record does not own — nothing to grade.
    const result = await useCaseExecute({ allocationStore, repository }, {
      testId: allocation.cardId, answers: { 99: 'A' },
    });

    expect(result.results).toEqual([]);
    expect(result.cardRecordCount).toBeGreaterThan(0);
  });

  it('a card whose ONLY record is RELEASED, scanned with answers, reports deadCard rather than a bare unallocatedRow (re-review wave 2: superseded by the more informative dead-card signal)', async () => {
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
    expect(result.deadCard).toBe(true);
    expect(result.answeredRowCount).toBe(1);
    expect(result.recordStatuses).toEqual(['released']);
    expect(result.unallocatedRows).toBeUndefined();
  });
});

describe('execute — scan confidence diagnostics (review wave M4)', () => {
  it('grading a record that had ALREADY settled flags reScored (a first scan never carries the flag)', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const source = sourceDoc('rescore-quiz', [
      mcQuestion('r1', 1, { choices: ['X', 'Y'], answer: 'X' }),
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true },
    });

    const first = await useCaseExecute({ allocationStore, repository }, {
      testId: allocation.cardId, answers: { 1: 'A' },
    });
    expect(first.results[0].reScored).toBeUndefined();

    // The record is satisfied now; feeding the card again is a REPEAT.
    const second = await useCaseExecute({ allocationStore, repository }, {
      testId: allocation.cardId, answers: { 1: 'B' },
    });
    expect(second.results[0].reScored).toBe(true);
  });

  it('a live cardmate whose rows got zero marks is surfaced as silent (wrong-rows signature)', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const sourceA = sourceDoc('quiz-a', [
      mcQuestion('a1', 1, { choices: ['X', 'Y'], answer: 'X' }),
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source: sourceA, context: { freshCard: true },
    });
    const sourceB = sourceDoc('quiz-b', [
      mcQuestion('b2', 2, { choices: ['X', 'Y'], answer: 'Y' }),
    ]);
    await publishAndAllocate({
      repository, allocationStore, source: sourceB, context: { cardId: allocation.cardId, startRow: 2 },
    });

    // Only quiz B's row is marked; quiz A (live, rows 1-1) got nothing.
    const result = await useCaseExecute({ allocationStore, repository }, {
      testId: allocation.cardId, answers: { 2: 'B' },
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].documentId).toBe('quiz-b');
    expect(result.silentLiveRecords).toEqual([
      expect.objectContaining({ documentId: 'quiz-a', rowRange: { start: 1, end: 1 } }),
    ]);
  });

  it('a completely blank card still reports its live record as unmarked', async () => {
    // 2026-08-26 follow-up. A card with a live worksheet and NO marks anywhere
    // used to fall through every diagnostic: `unknownCard` and `deadCard` both
    // require answers, and `silentLiveRecords` required them too, so the one
    // outcome that could name the rows to fill in was never populated.
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore({ rng: Math.random });
    const source = sourceDoc('blank-quiz', [
      mcQuestion('bq-q1', 1, { choices: ['X', 'Y'], answer: 'X' }),
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true },
    });

    const result = await useCaseExecute({ allocationStore, repository }, {
      testId: allocation.cardId, answers: {},
    });

    expect(result.results).toEqual([]);
    expect(result.silentLiveRecords).toHaveLength(1);
    expect(result.silentLiveRecords[0].rowRange).toEqual(allocation.rowRange);
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
        row: 1, itemId: 'r2-q1', itemType: 'multiple_choice', prompt: 'Prompt for r2-q1', status: 'correct', given: 'P', points: 1, earned: 1, concepts: [],
      },
      {
        row: 2, itemId: 'r2-q2', itemType: 'multiple_choice', prompt: 'Prompt for r2-q2', status: 'incorrect', given: 'Q', points: 1, earned: 0, concepts: [],
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

describe('execute — variant pinned against the RECORD, not the published document (F1 review fix, Critical)', () => {
  it('grades a variant-overridden render (IssueDocument-shaped: {...published, variant: N}) against ITS OWN variant\'s bank-select mapping, never the published document\'s own default variant', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const bank = {
      id: 'f1-bank',
      items: [
        {
          id: 'ext-mc1', type: 'multiple_choice', prompt: 'Q1', choices: ['A', 'B'], answer: 'A',
        },
        {
          id: 'ext-mc2', type: 'multiple_choice', prompt: 'Q2', choices: ['A', 'B'], answer: 'A',
        },
        {
          id: 'ext-mc3', type: 'multiple_choice', prompt: 'Q3', choices: ['A', 'B'], answer: 'A',
        },
      ],
    };
    const banks = { getBank: (id) => (id === bank.id ? bank : null) };
    const source = sourceDoc('f1-variant-doc', [
      { type: 'question', bankId: bank.id, select: 3, key: 'sel1' },
    ], { seed: 555 });

    const publisher = new PublishPrintDocument({ repository });
    const { id, rev } = await publisher.execute({ source });
    const published = await repository.getPublished(id, rev);
    expect(published.variant ?? 0).toBe(0);

    // Independently derived (never read off the code under test): at this
    // seed/key, variant 0's and variant 1's selection ORDER genuinely
    // disagree, so grading against the wrong one is observable.
    const permutation0 = deriveShuffle(555, 0, 'sel1', bank.items.length);
    const permutation1 = deriveShuffle(555, 1, 'sel1', bank.items.length);
    const row1ItemIdAtVariant0 = applyShuffle(bank.items, permutation0)[0].id;
    const row1ItemIdAtVariant1 = applyShuffle(bank.items, permutation1)[0].id;
    expect(row1ItemIdAtVariant1).not.toBe(row1ItemIdAtVariant0);

    // Mirrors IssueDocument's own variant override EXACTLY (`state.variant
    // === (document.variant ?? 0) ? document : {...document, variant:
    // state.variant}`, IssueDocument.mjs) — a card-attached render at a
    // variant OTHER than whatever the document happens to be published
    // carrying. The override lives only in this in-memory document, never
    // persisted back to the published artifact `repository.getPublished`
    // will keep returning at variant 0.
    const renderer = new RenderPrintDocument({ repository, allocationStore, banks });
    const { allocation } = await renderer.execute({
      document: { ...published, variant: 1 },
      context: { freshCard: true },
    });
    const [record] = await allocationStore.findByCard(allocation.cardId);
    expect(record.variant).toBe(1);

    const useCase = new ResolveCardScan({ allocationStore, repository, banks });
    const result = await useCase.execute({ testId: allocation.cardId, answers: { 1: 'A' } });

    expect(result.results).toHaveLength(1);
    // The graded itemId matches what the sheet ACTUALLY printed at variant 1
    // — not variant 0's mapping (the bug: re-deriving against
    // `repository.getPublished`'s own variant-0 artifact instead of
    // `record.variant`).
    expect(result.results[0].results[0].itemId).toBe(row1ItemIdAtVariant1);
    expect(result.results[0].results[0].itemId).not.toBe(row1ItemIdAtVariant0);
  });
});

describe('execute — row-mapping integrity vs mutable external banks (F4 review fix)', () => {
  const seed = 555;
  const twoItemBank = () => ({
    id: 'f4-bank',
    items: [
      {
        id: 'ext-a', type: 'multiple_choice', prompt: 'A', choices: ['X', 'Y'], answer: 'X',
      },
      {
        id: 'ext-b', type: 'multiple_choice', prompt: 'B', choices: ['X', 'Y'], answer: 'X',
      },
    ],
  });
  const thirdItem = {
    id: 'ext-c', type: 'multiple_choice', prompt: 'C', choices: ['X', 'Y'], answer: 'X',
  };

  async function allocateAgainstBank(bank) {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const banks = { getBank: (id) => (id === bank.id ? bank : null) };
    const source = sourceDoc('f4-doc', [
      { type: 'question', bankId: bank.id, select: 2, key: 'sel1' },
    ], { seed });
    const publisher = new PublishPrintDocument({ repository });
    const { id, rev } = await publisher.execute({ source });
    const published = await repository.getPublished(id, rev);
    const renderer = new RenderPrintDocument({ repository, allocationStore, banks });
    const { allocation } = await renderer.execute({ document: published, context: { freshCard: true } });
    const [record] = await allocationStore.findByCard(allocation.cardId);
    // Sanity: the fix (RenderPrintDocument#allocateCard) actually persisted
    // the printed mapping — every other assertion here is moot without it.
    expect(record.rowItems).toEqual([
      { row: 1, itemId: 'ext-a', itemType: 'multiple_choice' },
      { row: 2, itemId: 'ext-b', itemType: 'multiple_choice' },
    ]);
    return {
      repository, allocationStore, banks, allocation,
    };
  }

  it('a bank mutated (an item appended) after the card printed is reported as row-mapping drift, and grades nothing for that record', async () => {
    const bank = twoItemBank();
    const {
      repository, allocationStore, banks, allocation,
    } = await allocateAgainstBank(bank);

    // The external bank changes shape AFTER the card was printed — exactly
    // the scenario `rowItems` exists to catch: `resolveBankSelect`'s
    // selection formula depends on `bank.items.length`, so appending an item
    // changes WHICH items select=2 resolves, even though nothing about the
    // printed card itself changed.
    bank.items.push(thirdItem);

    const useCase = new ResolveCardScan({ allocationStore, repository, banks });
    const result = await useCase.execute({ testId: allocation.cardId, answers: { 1: 'A', 2: 'A' } });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      cardId: allocation.cardId,
      recordId: allocation.recordId,
      documentId: 'f4-doc',
      error: { code: 'ALLOCATION_ROW_MAPPING_DRIFT' },
    });
    // Fail CLOSED, not partial: no `results`/totalPoints/earnedPoints — this
    // record graded nothing, even for rows the mutation didn't happen to
    // touch.
    expect(result.results[0].results).toBeUndefined();

    // Nothing was graded, so the record must not have been marked satisfied.
    const [record] = await allocationStore.findByCard(allocation.cardId);
    expect(record.status).toBe('live');
  });

  it('an UNMODIFIED external bank still grades normally through the recorded rowItems mapping', async () => {
    const bank = twoItemBank();
    const {
      repository, allocationStore, banks, allocation,
    } = await allocateAgainstBank(bank);

    const useCase = new ResolveCardScan({ allocationStore, repository, banks });
    const result = await useCase.execute({ testId: allocation.cardId, answers: { 1: 'A', 2: 'A' } });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].error).toBeUndefined();
    expect(result.results[0].results).toEqual([
      {
        row: 1, itemId: 'ext-a', itemType: 'multiple_choice', prompt: 'A', status: 'correct', given: 'X', points: 1, earned: 1, concepts: [],
      },
      {
        row: 2, itemId: 'ext-b', itemType: 'multiple_choice', prompt: 'B', status: 'correct', given: 'X', points: 1, earned: 1, concepts: [],
      },
    ]);

    const [record] = await allocationStore.findByCard(allocation.cardId);
    expect(record.status).toBe('satisfied');
  });
});

describe('execute — nonexistent bubble grading (F6 review fix, Low)', () => {
  it('a decoded letter past the item\'s own choice count grades incorrect and reports the raw letter as `given`, never `undefined`', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    // Only 2 choices (A/B) — 'D' is a legal bubble POSITION on the physical
    // row (5 bubbles, spec §5.1) but has no corresponding choice on this item.
    const source = sourceDoc('f6-doc', [
      mcQuestion('f6-q1', 1, { choices: ['X', 'Y'], answer: 'X' }),
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true },
    });

    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({ testId: allocation.cardId, answers: { 1: 'D' } });

    expect(result.results[0].results[0]).toEqual({
      row: 1, itemId: 'f6-q1', itemType: 'multiple_choice', prompt: 'Prompt for f6-q1', status: 'incorrect', given: 'D', points: 1, earned: 0, concepts: [],
    });
  });
});

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
    // the exact phantom-rev / deleted-artifact failure — via a wrapper
    // repository that 404s resilient-a only.
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
    // The write-on is a STANDALONE `short_answer` sugar block, not a bare
    // `question` block: `blocks.mjs`'s `question` validator requires
    // `number` even on a non-row-consuming question, so there is no legal
    // "numberless question" shape — `short_answer` sugar is the actual v1
    // write-on primitive (spec §4.2/§6.2), and per
    // `RenderPrintDocument.mjs`'s own `collectAnswerKeyEntries` comment it
    // is "never card-mapped" regardless of scoring, so it never competes for
    // a row the way an unscored `question` block would.
    const source = sourceDoc('writeon-quiz', [
      mcQuestion('w1', 1, { choices: ['X', 'Y'], answer: 'X' }),
      { type: 'short_answer', prompt: 'Explain your reasoning.' },
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true },
    });
    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({ testId: allocation.cardId, answers: { 1: 'A' } });
    const card = result.results[0];
    expect(card.results[0].prompt).toBe('Prompt for w1');
    expect(card.unscannedItems).toEqual([
      { itemId: 'blocks[1]', prompt: 'Explain your reasoning.' },
    ]);
  });

  it('an essay write-on (no card row, never carries an answer) also surfaces in unscannedItems', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    // `essay` (blocks.mjs) is structurally the same write-on as `short_answer`
    // for this purpose — no itemId, NEVER carries an answer ("unmarked prose
    // has nothing for a bank to hold") — so it must get the same treatment,
    // never silently dropped from unscannedItems.
    const source = sourceDoc('essay-writeon-quiz', [
      mcQuestion('e1', 1, { choices: ['X', 'Y'], answer: 'X' }),
      { type: 'essay', prompt: 'Write a short reflection.' },
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true },
    });
    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({ testId: allocation.cardId, answers: { 1: 'A' } });
    const card = result.results[0];
    expect(card.unscannedItems).toEqual([
      { itemId: 'blocks[1]', prompt: 'Write a short reflection.' },
    ]);
  });

  it('an essay write-on nested one level inside an inset also surfaces in unscannedItems (re-review wave 2 F1: inset write-ons were invisible to the queue)', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    // `blocks.mjs`'s `INSET_UNSUPPORTED_CHILD_TYPES` deliberately leaves
    // short_answer/essay OFF the ban list — an inset-wrapped write-on is a
    // legal, printable shape — so it must still reach `unscannedItems`
    // rather than silently printing invisibly to the review queue.
    const source = sourceDoc('inset-writeon-quiz', [
      mcQuestion('i1', 1, { choices: ['X', 'Y'], answer: 'X' }),
      {
        type: 'inset',
        title: 'Reflection Box',
        blocks: [
          richText('Take a moment to reflect.'),
          { type: 'essay', prompt: 'Write a short reflection.' },
        ],
      },
    ]);
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true },
    });
    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({ testId: allocation.cardId, answers: { 1: 'A' } });
    const card = result.results[0];
    expect(card.unscannedItems).toEqual([
      { itemId: 'blocks[1].blocks[1]', prompt: 'Write a short reflection.' },
    ]);
  });
});

/** Small helper so the "unallocated rows" describe block reads as one call per test. */
async function useCaseExecute(deps, args) {
  const useCase = new ResolveCardScan(deps);
  return useCase.execute(args);
}
