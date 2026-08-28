// backend/src/3_applications/school/documents/ResolveCardScan.companionGate.test.mjs
// @vitest-environment node
//
// THE GATE ROW IS READ, AND IT IS NOT PART OF THE SCORE (Task 10).
//
// Task 8 prints the gate row; this suite is the scan-back half. Two claims,
// and they pull in opposite directions on purpose:
//
//   1. The gate is GRADED. Before this, a decoded gate row (an ARRAY of
//      letters) hit `gradeRow`'s unconditional `Array.isArray(given)` guard
//      and came back `ambiguous` — it never reached `gradeAnswer` at all, so
//      no sheet could ever fail its gate and the failure looked like a
//      scanner fault rather than a code path that was never written.
//   2. The gate is NOT a question. It earns nothing, it is not in the
//      denominator, it never enters the eraser-leniency budget, and it never
//      appears in `results` — the row list every downstream consumer treats
//      as "the child's answers". It leaves through its own door,
//      `companionGate`.
//
// And one thing it must never do: carry the finish code back out.
// `gradeAnswer` returns `{correct, expected}` and for this item type
// `expected` IS the code. `ResolveCardScan`'s output reaches a browser.
import { describe, it, expect } from 'vitest';
import { PublishPrintDocument } from './PublishPrintDocument.mjs';
import { RenderPrintDocument } from './RenderPrintDocument.mjs';
import { ResolveCardScan } from './ResolveCardScan.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';
import { DOCUMENT_SOURCE_SCHEMA } from '#domains/school/documents/documentSource.mjs';
import { COMPANION_GATE_ITEM_ID, CODE_LETTERS } from '#domains/school/companionCode.mjs';

const richText = (md) => ({ type: 'rich_text', md });

/** The gate block exactly as `questionBankV2.mjs#companionGateBlock` mints it. */
const gateBlock = (code) => ({
  type: 'question',
  itemId: COMPANION_GATE_ITEM_ID,
  number: 1,
  omr: true,
  points: 0,
  companionGate: true,
  code: [...code],
  choices: [...CODE_LETTERS],
  blocks: [
    richText('Read-along finish code. Fill in every letter you were given.'),
    { type: 'omr_response', itemId: COMPANION_GATE_ITEM_ID, choices: CODE_LETTERS.length },
  ],
});

const mcQuestion = (itemId, number) => ({
  type: 'question',
  itemId,
  number,
  omr: true,
  blocks: [
    richText(`Prompt for ${itemId}`),
    { type: 'omr_response', itemId, choices: 4 },
  ],
  choices: ['one', 'two', 'three', 'four'],
  answer: 'one',
});

const sourceDoc = (id, blocks, over = {}) => ({
  schema: DOCUMENT_SOURCE_SCHEMA,
  id,
  seed: 12345,
  variant: 0,
  target: ['letter'],
  archetype: 'worksheet',
  title: id,
  blocks,
  ...over,
});

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

function fakeAllocationStore() {
  const map = new Map();
  const io = {
    load: (filePath) => (map.has(filePath) ? structuredClone(map.get(filePath)) : null),
    save: (filePath, content) => { map.set(filePath, structuredClone(content)); },
    list: (dir) => [...map.keys()]
      .filter((p) => p.startsWith(`${dir}/`))
      .map((p) => p.slice(dir.length + 1).replace(/\.yml$/, '')),
  };
  return new YamlAllocationStore({
    directory: '/docs', io, now: () => '2026-08-27T00:00:00.000Z', rng: () => 0.42,
  });
}

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** Publish + card-attach render `blocks`, then scan `answers` back through the real resolver. */
async function scan(blocks, answers, { id = 'gated-sheet' } = {}) {
  const repository = fakeRepository();
  const allocationStore = fakeAllocationStore();
  const publisher = new PublishPrintDocument({ repository });
  const { id: documentId, rev } = await publisher.execute({ source: sourceDoc(id, blocks) });
  const published = await repository.getPublished(documentId, rev);
  const renderer = new RenderPrintDocument({ repository, allocationStore });
  const { allocation } = await renderer.execute({
    document: published, context: { freshCard: true, learnerId: 'kid1' },
  });
  const resolver = new ResolveCardScan({ allocationStore, repository, logger: silentLogger });
  const outcome = await resolver.execute({ testId: allocation.cardId, answers });
  return { outcome, card: outcome.results[0], allocation };
}

/** `{1: gate, 2: q1, 3: q2, ...}` — the gate always takes the record's first row. */
const rowsFrom = (start, gate, ...questions) => Object.fromEntries(
  [gate, ...questions].map((given, i) => [start + i, given]).filter(([, given]) => given !== undefined),
);

describe('the gate row is graded, not shrugged off as ambiguous', () => {
  it('a correct finish code satisfies the gate', async () => {
    const { card, allocation } = await scan(
      [gateBlock(['A', 'C', 'E']), mcQuestion('q1', 2), mcQuestion('q2', 3)],
      rowsFrom(1, ['A', 'C', 'E'], 'A', 'A'),
    );
    // A fresh card allocates from row 1, so the gate takes row 1 and the
    // questions follow — asserted rather than assumed, since every `answers`
    // map in this file is written against it.
    expect(allocation.rowRange.start).toBe(1);
    expect(card.companionGate).toMatchObject({ itemId: COMPANION_GATE_ITEM_ID, row: 1, status: 'satisfied' });
  });

  it('a BLANK gate row is blank — distinguishable from a wrong one', async () => {
    const { card } = await scan(
      [gateBlock(['A', 'C', 'E']), mcQuestion('q1', 2), mcQuestion('q2', 3)],
      { 2: 'A', 3: 'A' },
    );
    expect(card.companionGate).toMatchObject({ status: 'blank' });
  });

  it('a WRONG finish code is wrong — never ambiguous, never silently credited', async () => {
    const { card } = await scan(
      [gateBlock(['A', 'C', 'E']), mcQuestion('q1', 2), mcQuestion('q2', 3)],
      { 1: ['A', 'B'], 2: 'A', 3: 'A' },
    );
    expect(card.companionGate).toMatchObject({ status: 'wrong' });
  });

  it('an ALL-FIVE row that is still wrong is exhausted — this sheet can never be repaired', async () => {
    // A child repairs a wrong code by adding bubbles, which walks a chain of
    // supersets because paper is append-only. Every letter marked means there
    // is nothing left to add: the physics IS the attempt limit, so nothing has
    // to count how many times the card went through the roller.
    const { card } = await scan(
      [gateBlock(['A', 'C', 'E']), mcQuestion('q1', 2), mcQuestion('q2', 3)],
      { 1: [...CODE_LETTERS], 2: 'A', 3: 'A' },
    );
    expect(card.companionGate).toMatchObject({ status: 'exhausted', given: [...CODE_LETTERS] });
  });

  it('a full row that happens to BE the code is still satisfied, not exhausted', async () => {
    const { card } = await scan(
      [gateBlock([...CODE_LETTERS]), mcQuestion('q1', 2), mcQuestion('q2', 3)],
      { 1: [...CODE_LETTERS], 2: 'A', 3: 'A' },
      { id: 'all-five-code-sheet' },
    );
    expect(card.companionGate).toMatchObject({ status: 'satisfied' });
  });

  it('never carries the expected finish code back out — the answer reaches a browser', async () => {
    const { outcome, card } = await scan(
      [gateBlock(['A', 'C', 'E']), mcQuestion('q1', 2), mcQuestion('q2', 3)],
      { 1: ['B'], 2: 'A', 3: 'A' },
    );
    expect(card.companionGate).not.toHaveProperty('expected');
    expect(card.companionGate).not.toHaveProperty('code');
    // The whole payload, not just the gate object: a child who can read
    // `["A","C","E"]` anywhere in this response never has to play the audio.
    expect(JSON.stringify(outcome)).not.toContain('"A","C","E"');
  });
});

describe('the gate is a veto, not a question', () => {
  it('is NOT in the denominator: ten questions plus a gate row score out of ten', async () => {
    const questions = Array.from({ length: 10 }, (_, i) => mcQuestion(`q${i + 1}`, i + 2));
    const { card } = await scan(
      [gateBlock(['A', 'C', 'E']), ...questions],
      rowsFrom(1, ['A', 'C', 'E'], ...Array.from({ length: 10 }, () => 'A')),
    );
    expect(card.totalPoints).toBe(10);
    expect(card.earnedPoints).toBe(10);
    expect(card.results).toHaveLength(10);
    // The row list every downstream consumer treats as "the child's answers"
    // (the percent denominator, the attempt ledger, `missedItemIds`, the
    // review queue) must not contain the gate at all.
    expect(card.results.map((row) => row.itemId)).not.toContain(COMPANION_GATE_ITEM_ID);
    expect(card.results.map((row) => row.itemType)).not.toContain('companion_code');
  });

  it('never enters the eraser-leniency budget: the cap is the QUESTION count', async () => {
    // Nine worksheet questions, every one double-marked with the eraser
    // signature (two marks, one of them correct, four choices). The cap is
    // `max(1, floor(rowCount / 5))` — 1 for nine questions, 2 for ten rows.
    // If the gate row is counted as an eleventh... nine questions + gate = 10
    // rows, cap 2 — and a second child's row gets credited for free.
    const questions = Array.from({ length: 9 }, (_, i) => mcQuestion(`q${i + 1}`, i + 2));
    const answers = { 1: ['A', 'C', 'E'] };
    for (let i = 0; i < 9; i += 1) answers[i + 2] = ['A', 'B'];
    const { card } = await scan([gateBlock(['A', 'C', 'E']), ...questions], answers);

    expect(card.results.filter((row) => row.leniency === 'eraser')).toHaveLength(1);
    expect(card.results.filter((row) => row.status === 'correct')).toHaveLength(1);
    expect(card.results.filter((row) => row.status === 'ambiguous')).toHaveLength(8);
  });
});

describe('a sheet with no companion', () => {
  it('behaves exactly as it did before the gate existed', async () => {
    const { card } = await scan(
      [mcQuestion('q1', 1), mcQuestion('q2', 2)],
      { 1: 'A', 2: 'B' },
      { id: 'ungated-sheet' },
    );
    expect(card.companionGate).toBeUndefined();
    expect(card.results).toHaveLength(2);
    expect(card.totalPoints).toBe(2);
    expect(card.earnedPoints).toBe(1);
    expect(card.results.map((row) => row.status)).toEqual(['correct', 'incorrect']);
  });
});
