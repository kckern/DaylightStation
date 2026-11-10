/**
 * Bounded eraser-leniency (spec §5.4 print-documents.md, 2026-08-22 policy):
 * a multi-mark row is credited when it reads as an eraser signature (exactly
 * two marks, one correct, not covering every choice), capped per sheet, and
 * only on lenient archetypes (`worksheet`; `quiz` stays strict).
 *
 * The ResolveCardScan half of this suite exercises the REAL pipeline —
 * publish, card-attach render, decode-and-grade — the same division of labor
 * `ResolveCardScan.test.mjs` itself uses. The RecordCardScanOutcome half
 * unit-tests the verdict-sheet mapping directly against a hand-built graded
 * card (the exact shape `ResolveCardScan` produces for a promoted row),
 * mirroring `RecordCardScanOutcome.test.mjs`'s own fixture style.
 */
import { describe, it, expect, vi } from 'vitest';
import { PublishPrintDocument } from "../../../../__app_modules/learning/school/server/application/documents/PublishPrintDocument.mjs";
import { RenderPrintDocument } from "../../../../__app_modules/learning/school/server/application/documents/RenderPrintDocument.mjs";
import { createPrintDocumentRendering } from "../../../../__app_modules/learning/school/server/rendering/documents/PrintDocumentRendering.mjs";
import { ResolveCardScan } from "../../../../__app_modules/learning/school/server/application/documents/ResolveCardScan.mjs";
import { RecordCardScanOutcome } from "../../../../__app_modules/learning/school/server/application/documents/RecordCardScanOutcome.mjs";
import { YamlAllocationStore } from "../../../../__app_modules/learning/school/server/adapters/documents/YamlAllocationStore.mjs";
import { DOCUMENT_SOURCE_SCHEMA } from "../../../../__app_modules/learning/school/server/domain/documents/documentSource.mjs";
import { createEvent } from "../../../../__app_modules/learning/school/server/domain/sessions/sessionEvents.mjs";

const richText = (md) => ({ type: 'rich_text', md });

/** A single-select `question` block, marked `omr: true` so a non-quiz (worksheet) archetype still row-maps it (spec §5.3). */
const mcQuestion = (itemId, number, {
  choices, answer, points, omr = true,
} = {}) => ({
  type: 'question', itemId, number, blocks: [richText(`Prompt for ${itemId}`)], choices, answer, omr, ...(points !== undefined ? { points } : {}),
});

const tfQuestion = (itemId, number, answer, { omr = true } = {}) => ({
  type: 'question', itemId, number, blocks: [richText(`Prompt for ${itemId}`)], trueFalse: true, answer, omr,
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

/** Six row-consuming questions: row 1 is a clean correct mark (filler); rows
 * 2-6 cover every branch of the eraser-leniency decision so a 6-row sheet
 * (cap = max(1, floor(6/5)) = 1) exercises the cap itself, not just the rule.
 */
function leniencySheetBlocks() {
  return [
    mcQuestion('q1', 1, { choices: ['Alpha', 'Beta', 'Gamma', 'Delta'], answer: 'Alpha' }),
    // Eraser signature #1: two marks, D correct -> ELIGIBLE (spends the cap).
    mcQuestion('q2', 2, { choices: ['Alpha', 'Beta', 'Gamma', 'Delta'], answer: 'Delta' }),
    // Eraser signature #2: two marks, A correct -> ALSO eligible, but the
    // cap is already spent by q2 (lower row number, rule 5 ordering).
    mcQuestion('q3', 3, { choices: ['Alpha', 'Beta', 'Gamma', 'Delta'], answer: 'Alpha' }),
    // Three marks, one correct -> never eligible (rule 2).
    mcQuestion('q4', 4, { choices: ['Alpha', 'Beta', 'Gamma', 'Delta'], answer: 'Alpha' }),
    // true_false: both options marked = every choice covered -> never
    // eligible regardless of correctness (rule 3).
    tfQuestion('q5', 5, true),
    // Two marks, both wrong -> never eligible (rule 2).
    mcQuestion('q6', 6, { choices: ['Alpha', 'Beta', 'Gamma', 'Delta'], answer: 'Alpha' }),
  ];
}

const leniencyAnswers = {
  1: 'A',
  2: ['B', 'D'],
  3: ['A', 'C'],
  4: ['A', 'B', 'D'],
  5: ['A', 'B'],
  6: ['B', 'C'],
};

/** Fresh in-memory `YamlPrintDocumentRepository`-shaped fake (mirrors ResolveCardScan.test.mjs's own). */
function fakeRepository() {
  const published = new Map();
  const banks = new Map();
  const latestRevById = new Map();
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

/** Fresh in-memory `YamlAllocationStore` — no filesystem (mirrors ResolveCardScan.test.mjs's own). */
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
    directory: '/docs', io, now: () => '2026-08-22T00:00:00.000Z', rng: () => 0.42, ...over,
  });
}

/** Publishes `source`, then card-attach renders it (real fit/render), returning `{allocation}`. */
async function publishAndAllocate({
  repository, allocationStore, source, context,
}) {
  const publisher = new PublishPrintDocument({ repository });
  const { id, rev } = await publisher.execute({ source });
  const published = await repository.getPublished(id, rev);
  // RenderPrintDocument requires the rendering collaborator now. These cases
  // only need the ALLOCATION it produces, but the real factory is what the
  // sibling suites use and it keeps the fake from drifting from the port.
  const renderer = new RenderPrintDocument({ repository, allocationStore, rendering: createPrintDocumentRendering() });
  const result = await renderer.execute({ document: published, context });
  return { allocation: result.allocation };
}

describe('ResolveCardScan — bounded eraser-leniency (spec §5.4, 2026-08-22 policy)', () => {
  it('(a) a lenient worksheet promotes the eraser row to full credit', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const source = sourceDoc('leniency-worksheet-a', leniencySheetBlocks(), { archetype: 'worksheet' });
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true, learnerId: 'kid-1' },
    });

    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({ testId: allocation.cardId, answers: leniencyAnswers });

    const card = result.results[0];
    const row2 = card.results.find((row) => row.row === 2);
    expect(row2).toMatchObject({
      status: 'correct', given: ['B', 'D'], points: 1, earned: 1, leniency: 'eraser',
    });
  });

  it('(c) a second eligible row on a 6-row worksheet stays ambiguous because the cap is 1', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const source = sourceDoc('leniency-worksheet-c', leniencySheetBlocks(), { archetype: 'worksheet' });
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true, learnerId: 'kid-1' },
    });

    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({ testId: allocation.cardId, answers: leniencyAnswers });

    const card = result.results[0];
    const byRow = Object.fromEntries(card.results.map((row) => [row.row, row]));
    // Row 2 (the lower question number, rule 5) spent the sheet's only
    // credited slot; row 3 — an equally eligible eraser signature — falls
    // through to the review queue exactly as an ordinary ambiguous row does.
    expect(byRow[2]).toMatchObject({ status: 'correct', leniency: 'eraser' });
    // NEIGHBOUR BLEED (added after this fixture): this dense fixture's rows
    // 3, 4 and 6 each have exactly one mark the rows beside them do not
    // explain, so they now resolve to that letter (graded against the one unexplained letter)
    // instead of staying ambiguous (row 3 contains the key
    // and is eraser-eligible, but row 2 already spent the cap and bleed never
    // consumes the eraser budget).
    expect(byRow[3]).toMatchObject({
      status: 'incorrect', given: ['A', 'C'], resolvedLetter: 'C', bleed: 'neighbour', earned: 0,
    });
    expect(byRow[3].leniency).toBeUndefined();
    expect(byRow[4]).toMatchObject({ status: 'incorrect', given: ['A', 'B', 'D'], bleed: 'neighbour' });
    // Row 5 (every-choice coverage) has two candidates -> undecidable, stays ambiguous.
    expect(byRow[5]).toMatchObject({ status: 'ambiguous', given: ['A', 'B'] });
    expect(byRow[6]).toMatchObject({ status: 'incorrect', given: ['B', 'C'], bleed: 'neighbour' });
    expect(card.totalPoints).toBe(6);
    // row1 (1) + row2 promoted (1) = 2; rows 3, 4, 6 incorrect, row 5 ambiguous.
    expect(card.earnedPoints).toBe(2);
  });

  it('(d) a quiz archetype promotes nothing — strictness cap is 0', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const source = sourceDoc('leniency-quiz-d', leniencySheetBlocks(), { archetype: 'quiz' });
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true, learnerId: 'kid-1' },
    });

    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({ testId: allocation.cardId, answers: leniencyAnswers });

    const card = result.results[0];
    // The SAME eraser-signature marks that earn row 2 full credit on a
    // worksheet stay ambiguous on a quiz — no row anywhere on the card
    // carries a `leniency` marker.
    // (Neighbour bleed, a separate rule, resolves rows 3, 4 and 6 of this
    // dense fixture; rows 2 and 5 are undecidable and stay ambiguous.)
    expect(card.results.filter((row) => row.status === 'ambiguous')).toHaveLength(2);
    expect(card.results.some((row) => row.leniency)).toBe(false);
    const row2 = card.results.find((row) => row.row === 2);
    expect(row2).toMatchObject({ status: 'ambiguous', given: ['B', 'D'], earned: 0 });
  });

  it('(e) a true/false row marked on BOTH options is refused even with the budget unspent (rule 3, resolver-level)', async () => {
    // (c) above only proves rule 3 exists as a UNIT-level fact about
    // `creditsAsEraser` (it hands in a literal `choiceCount`) — at the
    // resolver level its rows 3-6 assertions are vacuous: the cap is 1,
    // row 2 spends it, and `applyLeniency` (`ResolveCardScan.mjs`) BREAKS
    // out of its loop the moment the budget hits zero, so rows 3-6 are
    // never even evaluated for eligibility. Deleting rule 3 from
    // `creditsAsEraser` would leave every assertion in this file green.
    //
    // This test closes that gap by making a true/false double-mark the
    // FIRST (and only) ambiguous row on the sheet, so `applyLeniency`
    // reaches it with the full budget still unspent. Marking both True and
    // False covers every choice on a 2-choice row — rule 1 (two marks) and
    // rule 2 (one of them correct) both look satisfied, so without rule 3
    // this row would be wrongly promoted to full credit.
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const blocks = [
      mcQuestion('q1', 1, { choices: ['Alpha', 'Beta', 'Gamma', 'Delta'], answer: 'Alpha' }),
      // The only ambiguous row: true/false marked True AND False.
      tfQuestion('q2', 2, true),
      mcQuestion('q3', 3, { choices: ['Alpha', 'Beta', 'Gamma', 'Delta'], answer: 'Beta' }),
      mcQuestion('q4', 4, { choices: ['Alpha', 'Beta', 'Gamma', 'Delta'], answer: 'Gamma' }),
      mcQuestion('q5', 5, { choices: ['Alpha', 'Beta', 'Gamma', 'Delta'], answer: 'Delta' }),
    ];
    // 5 rows -> cap = max(1, floor(5/5)) = 1, and nothing before row 2 is
    // ambiguous, so the whole budget is on the table when row 2 is graded.
    const answers = {
      1: 'A', 2: ['A', 'B'], 3: 'B', 4: 'C', 5: 'D',
    };
    const source = sourceDoc('leniency-worksheet-e', blocks, { archetype: 'worksheet' });
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true, learnerId: 'kid-1' },
    });

    const useCase = new ResolveCardScan({ allocationStore, repository });
    const result = await useCase.execute({ testId: allocation.cardId, answers });

    const card = result.results[0];
    const row2 = card.results.find((row) => row.row === 2);
    expect(row2).toMatchObject({ status: 'ambiguous', given: ['A', 'B'], earned: 0 });
    expect(row2.leniency).toBeUndefined();
  });
});

describe('RecordCardScanOutcome — leniency verdict (spec §5.4)', () => {
  const quietLogger = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  };

  function fakeDatastore() {
    const byLearner = new Map();
    return {
      appendAttempt(learnerId, attempt) {
        if (!byLearner.has(learnerId)) byLearner.set(learnerId, []);
        byLearner.get(learnerId).push(structuredClone(attempt));
        return attempt;
      },
      readAllAttempts(learnerId) {
        return structuredClone(byLearner.get(learnerId) ?? []);
      },
    };
  }

  function fakeSessions(seedEvents) {
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

  function seededSession(sessionId, { learnerId = 'kid-1', unitId = 'unit-1' } = {}) {
    const mk = (payload) => {
      const { errors, event } = createEvent(payload);
      if (errors.length) throw new Error(errors.join('; '));
      return { sessionId, event };
    };
    return [
      mk({
        type: 'created', at: '2026-08-22T00:00:00.000Z', sessionId, unitId, learnerId,
      }),
      mk({
        type: 'issued', at: '2026-08-22T00:01:00.000Z', sessionId, artifactId: 'art-1',
      }),
    ];
  }

  function fakeReviewQueue() {
    const items = [];
    return { items, async enqueue(batch) { items.push(...structuredClone(batch)); } };
  }

  /** The exact shape `ResolveCardScan`'s `applyLeniency` produces for a promoted row. */
  const gradedCard = (over = {}) => ({
    cardId: '1234567',
    recordId: 'arts/worksheet-1@abcdef123:v0:1-2',
    documentId: 'arts/worksheet-1',
    rev: 'abcdef123',
    variant: 0,
    learnerId: 'kid-1',
    revisionSuperseded: false,
    renderedAt: '2026-08-22T00:00:00.000Z',
    results: [
      {
        row: 1, itemId: 'q1', itemType: 'multiple_choice', prompt: 'P1', status: 'correct', given: 'Alpha', points: 1, earned: 1, concepts: [],
      },
      {
        row: 2, itemId: 'q2', itemType: 'multiple_choice', prompt: 'P2', status: 'correct', given: ['B', 'D'], points: 1, earned: 1, concepts: [], leniency: 'eraser',
      },
    ],
    totalPoints: 2,
    earnedPoints: 2,
    unscannedItems: [],
    ...over,
  });

  it('(b) a promoted row is recorded gradedBy "engine-leniency" and carries its leniency marker on the verdict sheet', async () => {
    const datastore = fakeDatastore();
    const sessions = fakeSessions(seededSession('ws-1'));
    const reviewQueue = fakeReviewQueue();
    const useCase = new RecordCardScanOutcome({
      datastore, sessions, reviewQueue, logger: quietLogger,
    });

    const outcome = await useCase.execute({ testId: '1234567', card: gradedCard({ sessionId: 'ws-1' }) });
    expect(outcome.recorded).toBe(true);
    // Both rows resolved (correct), nothing pending -> the session reaches graded.
    expect(outcome.session).toMatchObject({ advancedTo: 'graded' });

    const row1Verdict = reviewQueue.items.find((item) => item.itemId === 'q1');
    const row2Verdict = reviewQueue.items.find((item) => item.itemId === 'q2');
    expect(row1Verdict).toMatchObject({ verdict: 'correct', gradedBy: 'engine' });
    expect(row1Verdict.leniency).toBeUndefined();
    expect(row2Verdict).toMatchObject({ verdict: 'correct', gradedBy: 'engine-leniency', leniency: 'eraser' });
  });
});

describe('ResolveCardScan — neighbour bleed + configurable tolerance/fallback', () => {
  const CH = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
  // The spec sheet shifted down by 19 (spec rows 20-26 -> rows 1-7), plus two
  // filler rows. 9 rows -> default cap = 1.
  const bleedBlocks = () => [
    mcQuestion('q1', 1, { choices: CH, answer: 'Epsilon' }),
    mcQuestion('q2', 2, { choices: CH, answer: 'Alpha' }),
    mcQuestion('q3', 3, { choices: CH, answer: 'Beta' }),
    mcQuestion('q4', 4, { choices: CH, answer: 'Beta' }),
    mcQuestion('q5', 5, { choices: CH, answer: 'Beta' }),
    mcQuestion('q6', 6, { choices: CH, answer: 'Gamma' }),
    mcQuestion('q7', 7, { choices: CH, answer: 'Gamma' }),
    mcQuestion('q8', 8, { choices: CH, answer: 'Alpha' }),
    mcQuestion('q9', 9, { choices: CH, answer: 'Beta' }),
  ];
  const bleedAnswers = {
    1: 'E', 2: ['A', 'C', 'E'], 3: ['B', 'C', 'E'], 4: ['B', 'E'], 5: ['B', 'E'], 6: ['B', 'C'], 7: 'C', 8: ['A', 'D'], 9: 'B',
  };

  async function run({ archetype = 'worksheet', options = {}, blocks = bleedBlocks(), answers = bleedAnswers } = {}) {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const source = sourceDoc(`bleed-${Math.random().toString(36).slice(2)}`, blocks, { archetype });
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source, context: { freshCard: true, learnerId: 'test-learner' },
    });
    const logger = {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    };
    const useCase = new ResolveCardScan({
      allocationStore, repository, logger, ...options,
    });
    const result = await useCase.execute({ testId: allocation.cardId, answers });
    const card = result.results[0];
    return { card, byRow: Object.fromEntries(card.results.map((r) => [r.row, r])), logger };
  }

  it('resolves the bleed row, spends the default eraser budget on the next row, holds the rest (today)', async () => {
    const { byRow, logger } = await run({ options: { ambiguousFallback: 'review' } });
    expect(byRow[2]).toMatchObject({
      status: 'correct', earned: 1, bleed: 'neighbour', resolvedLetter: 'A', given: ['A', 'C', 'E'],
    });
    expect(byRow[2].leniency).toBeUndefined();
    expect(byRow[3].status).toBe('ambiguous'); // three marks, undecidable
    expect(byRow[4]).toMatchObject({ status: 'correct', leniency: 'eraser' });
    expect(byRow[5].status).toBe('ambiguous');
    expect(byRow[6].status).toBe('ambiguous');
    expect(logger.info).toHaveBeenCalledWith('school.print.scan-bleed-resolved', expect.objectContaining({
      row: 2, resolvedLetter: 'A', neighbours: { above: ['E'], below: ['B', 'C', 'E'] },
    }));
  });

  it('a two-mark row holding the key is eraser-credited even when its key letter is shared with a neighbour (bleed runs after the eraser pass)', async () => {
    // Row 2 [A,C], key Alpha. Row 1 shares the key letter A, row 3 does not
    // carry C, so bleed alone would resolve row 2 to the OTHER mark (C) and
    // dock it. The eraser rule goes first and credits it.
    const answers = {
      1: 'A', 2: ['A', 'C'], 3: 'B', 4: 'B', 5: 'B', 6: 'C', 7: 'C', 8: 'A', 9: 'B',
    };
    const { byRow } = await run({ options: { leniencyRowsPerCredit: 1 }, answers });
    expect(byRow[2]).toMatchObject({ status: 'correct', leniency: 'eraser', earned: 1 });
    expect(byRow[2].bleed).toBeUndefined();
  });

  it('leniencyRowsPerCredit: 1 eraser-credits every two-mark row with a correct mark', async () => {
    const { byRow } = await run({ options: { leniencyRowsPerCredit: 1 } });
    for (const r of [4, 5, 6, 8]) expect(byRow[r]).toMatchObject({ status: 'correct', leniency: 'eraser' });
    expect(byRow[2]).toMatchObject({ status: 'correct', bleed: 'neighbour' });
  });

  it("ambiguousFallback: 'incorrect' scores leftovers incorrect with ambiguous:true, no ambiguous status", async () => {
    const { card, byRow, logger } = await run({ options: { ambiguousFallback: 'incorrect' } });
    for (const r of [3, 5, 6, 8]) {
      expect(byRow[r]).toMatchObject({ status: 'incorrect', ambiguous: true, earned: 0 });
    }
    expect(card.results.some((r) => r.status === 'ambiguous')).toBe(false);
    expect(logger.info).toHaveBeenCalledWith('school.print.scan-ambiguous-scored', expect.objectContaining({ row: 5, fallback: 'incorrect' }));
  });

  it("budget spent + unexplained ['A','D'] row: review holds it, incorrect scores it", async () => {
    const held = await run({ options: { ambiguousFallback: 'review' } });
    expect(held.byRow[8].status).toBe('ambiguous');
    const scored = await run({ options: { ambiguousFallback: 'incorrect' } });
    expect(scored.byRow[8]).toMatchObject({ status: 'incorrect', ambiguous: true });
  });

  it('a quiz still resolves bleed rows while eraser leniency stays off', async () => {
    const { byRow } = await run({ archetype: 'quiz' });
    expect(byRow[2]).toMatchObject({ status: 'correct', bleed: 'neighbour' });
    expect(byRow[4].status).toBe('ambiguous');
    expect(byRow[4].leniency).toBeUndefined();
  });

  it('never touches a multi_select row', async () => {
    const msQuestion = (itemId, number, { choices, answers }) => ({
      type: 'question', itemId, number, blocks: [richText(`Prompt for ${itemId}`)], choices, answers, omr: true,
    });
    const blocks = [
      mcQuestion('q1', 1, { choices: CH, answer: 'Alpha' }),
      msQuestion('q2', 2, { choices: ['Red', 'Green', 'Blue', 'Yellow'], answers: ['Red', 'Blue', 'Yellow'] }),
      mcQuestion('q3', 3, { choices: CH, answer: 'Alpha' }),
    ];
    const { byRow } = await run({
      blocks, answers: { 1: ['A', 'C'], 2: ['A', 'C', 'D'], 3: ['C', 'E'] },
    });
    expect(byRow[2]).toMatchObject({ itemType: 'multi_select', status: 'correct' });
    expect(byRow[2].bleed).toBeUndefined();
  });

  it('looks across records: row 3 (record A) is explained only by row 4 (record B)', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const three = (prefix) => [1, 2, 3].map((n) => mcQuestion(`${prefix}${n}`, n, { choices: CH, answer: 'Alpha' }));
    const docA = sourceDoc(`bleed-a-${Math.random().toString(36).slice(2)}`, three('a'), { archetype: 'quiz' });
    const docB = sourceDoc(`bleed-b-${Math.random().toString(36).slice(2)}`, three('b'), { archetype: 'quiz' });
    const { allocation: a } = await publishAndAllocate({
      repository, allocationStore, source: docA, context: { freshCard: true, learnerId: 'test-learner' },
    });
    const { allocation: b } = await publishAndAllocate({
      repository, allocationStore, source: docB, context: { cardId: a.cardId, startRow: 4, learnerId: 'test-learner' },
    });
    expect(b.cardId).toBe(a.cardId);
    expect(b.rowRange).toEqual({ start: 4, end: 6 });
    const logger = {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    };
    const useCase = new ResolveCardScan({ allocationStore, repository, logger });
    // Row 3 [A,C]: its C is explained by record B's row 4 (C); A is the one unexplained mark.
    const result = await useCase.execute({
      testId: a.cardId,
      answers: { 1: 'B', 2: 'B', 3: ['A', 'C'], 4: 'C', 5: 'B', 6: 'B' },
    });
    const rows = result.results.flatMap((c) => c.results);
    const row3 = rows.find((r) => r.row === 3);
    expect(row3).toMatchObject({
      status: 'correct', bleed: 'neighbour', resolvedLetter: 'A', given: ['A', 'C'],
    });
    expect(row3.leniency).toBeUndefined();
  });

  it('invalid config falls back to defaults with a warning', async () => {
    const { byRow, logger } = await run({ options: { leniencyRowsPerCredit: 0, ambiguousFallback: 'bogus' } });
    expect(byRow[5].status).toBe('ambiguous');
    expect(logger.warn).toHaveBeenCalledWith('school.print.scan-config-invalid', expect.objectContaining({ key: 'leniencyRowsPerCredit' }));
    expect(logger.warn).toHaveBeenCalledWith('school.print.scan-config-invalid', expect.objectContaining({ key: 'ambiguousFallback' }));
  });
});
