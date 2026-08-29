// backend/src/3_applications/school/documents/RenderPrintDocument.gate.test.mjs
// @vitest-environment node
//
// The companion gate row's bank item is SYNTHESIZED, never published (Task 8).
//
// `publishDocument` mints a derived bank item for any question carrying
// `answer`/`answers`; the gate block carries neither, so it publishes to
// nothing. That is deliberate — the gate is not a bank item and is never
// `questionBankValidation`-checked, whose `multi_select` two-answer minimum
// would make the one-letter finish code `['A']` illegal.
//
// But the row planner reads an item's TYPE off the bank, and so does the
// scan-back resolver. Both reach the bank through the same seam,
// `prepareV2Document` + `mergeBank` — so the gate item is built there, from
// the printed block, and it reaches both callers identically or neither.
import { describe, it, expect } from 'vitest';
import {
  RenderPrintDocument, prepareV2Document, mergeBank, buildTeacherKeyBlocks,
} from './RenderPrintDocument.mjs';
import { createPrintDocumentRendering } from '#rendering/school/documents/PrintDocumentRendering.mjs';
import { DOCUMENT_SOURCE_SCHEMA } from '#domains/school/documents/documentSource.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';
import { COMPANION_GATE_ITEM_ID } from '#domains/school/companionCode.mjs';
import { planRows } from '#domains/school/documents/allocation.mjs';

const createRenderPrintDocument = (deps = {}) => new RenderPrintDocument({
  rendering: createPrintDocumentRendering(), ...deps,
});

const gateBlock = (code) => ({
  type: 'question',
  itemId: COMPANION_GATE_ITEM_ID,
  number: 1,
  omr: true,
  points: 0,
  companionGate: true,
  code,
  choices: ['A', 'B', 'C', 'D', 'E'],
  blocks: [
    { type: 'rich_text', md: 'Read-along finish code. Fill in every letter you were given.' },
    { type: 'omr_response', itemId: COMPANION_GATE_ITEM_ID, choices: 5 },
  ],
});

const question = (n) => ({
  type: 'question',
  itemId: `q${n}`,
  number: n + 1,
  omr: true,
  choices: ['one', 'two', 'three', 'four'],
  answer: 'one',
  blocks: [
    { type: 'rich_text', md: `Question ${n}?` },
    { type: 'omr_response', itemId: `q${n}`, choices: 4 },
  ],
});

const derivedBank = {
  id: 'derived/ws-1@rev0',
  items: [1, 2].map((n) => ({
    id: `q${n}`, type: 'multiple_choice', prompt: `Question ${n}?`, choices: ['one', 'two', 'three', 'four'], answer: 'one',
  })),
};

const documentWith = (blocks) => ({
  schema: 'school.document/v2',
  id: 'ws-1',
  rev: 'rev0',
  title: 'Worksheet',
  seed: 11,
  variant: 0,
  archetype: 'worksheet',
  target: ['letter'],
  blocks,
});

function preparedBank(document) {
  const { document: prepared, extraItems } = prepareV2Document(document, { banks: null });
  return { prepared, bank: mergeBank(derivedBank, extraItems, prepared.id) };
}

describe('the gate item is synthesized from the printed block', () => {
  it('lands in the merged bank as a companion_code item carrying its own code', () => {
    const { bank } = preparedBank(documentWith([gateBlock(['A', 'C', 'E']), question(1), question(2)]));
    const gate = bank.items.find((item) => item.id === COMPANION_GATE_ITEM_ID);

    expect(gate).toBeDefined();
    expect(gate.type).toBe('companion_code');
    // Its own answer, on its own key — `gradeAnswer` reads `item.code`, never
    // `item.answers`, precisely so the gate never has to be a bank item.
    expect(gate.code).toEqual(['A', 'C', 'E']);
    expect(gate.choices).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('adds nothing at all to a document with no gate', () => {
    const { bank } = preparedBank(documentWith([question(1), question(2)]));
    expect(bank.items.map((item) => item.id)).toEqual(['q1', 'q2']);
  });

  it('gives the gate the FIRST card row, ahead of every question', () => {
    const document = documentWith([gateBlock(['B']), question(1), question(2)]);
    const { prepared, bank } = preparedBank(document);

    const plan = planRows({ document: prepared, bank, startRow: 12 });

    expect(plan.errors).toBeUndefined();
    expect(plan.rows.map((row) => [row.row, row.itemId, row.itemType])).toEqual([
      [12, COMPANION_GATE_ITEM_ID, 'companion_code'],
      [13, 'q1', 'multiple_choice'],
      [14, 'q2', 'multiple_choice'],
    ]);
    expect(plan.rows[0].choiceCount).toBe(5);
  });
});

/**
 * The LIVE lane, end to end.
 *
 * Every worksheet this household issues is CARD-BACKED: `IssueDocument`
 * always hands `RenderPrintDocument` a card context (an existing `cardId`, a
 * reusable card, or `freshCard: true`), so the page itself prints no bubbles
 * and the physical OMR card carries them — which means the gate has to survive
 * publish → prepare → row planning → allocation, and land in the record's
 * `rowItems` as `companion_code`. If it does not, `ResolveCardScan` has no row
 * to veto on and there is no gate at all, however well the bubble-sheet lane
 * round-trips.
 */
describe('a card-attached worksheet allocates the gate a real card row', () => {
  const allocationStore = () => {
    const map = new Map();
    return new YamlAllocationStore({
      directory: '/docs',
      io: {
        load: (file) => (map.has(file) ? structuredClone(map.get(file)) : null),
        save: (file, content) => { map.set(file, structuredClone(content)); },
      },
      now: () => '2026-08-28T00:00:00.000Z',
      rng: () => 0.42,
    });
  };

  const source = (blocks) => ({
    schema: DOCUMENT_SOURCE_SCHEMA,
    id: 'ws-gate-fixture',
    seed: 900,
    variant: 0,
    target: ['letter'],
    archetype: 'worksheet',
    title: 'Gate Fixture',
    blocks,
  });

  it('records the gate as row 1 of the card, typed companion_code', async () => {
    const store = allocationStore();
    const useCase = createRenderPrintDocument({ allocationStore: store });

    const result = await useCase.execute({
      document: source([gateBlock(['A', 'C', 'E']), question(1), question(2)]),
      context: { freshCard: true, learnerId: 'kid1' },
    });

    expect(result.allocation.rowRange).toEqual({ start: 1, end: 3 });
    const [record] = await store.findByCard(result.allocation.cardId);
    expect(record.rowItems).toEqual([
      { row: 1, itemId: COMPANION_GATE_ITEM_ID, itemType: 'companion_code' },
      { row: 2, itemId: 'q1', itemType: 'multiple_choice' },
      { row: 3, itemId: 'q2', itemType: 'multiple_choice' },
    ]);
  });

  it('leaves an ungated worksheet with exactly its own questions', async () => {
    const store = allocationStore();
    const useCase = createRenderPrintDocument({ allocationStore: store });

    const result = await useCase.execute({
      document: source([question(1), question(2)]),
      context: { freshCard: true, learnerId: 'kid1' },
    });

    expect(result.allocation.rowRange).toEqual({ start: 1, end: 2 });
    const [record] = await store.findByCard(result.allocation.cardId);
    expect(record.rowItems.map((entry) => entry.itemId)).toEqual(['q1', 'q2']);
  });

  it('prints the finish code on the teacher key, spelled as the child reads it', () => {
    // `ACE`, not `A, C, E` — the completion card shows one spelling, and a
    // grown-up comparing a bubbled row against the key should not have to
    // translate between two.
    const document = source([gateBlock(['A', 'C', 'E']), question(1)]);
    const { prepared, bank } = preparedBank(document);
    const { blocks } = buildTeacherKeyBlocks(prepared, bank, 'ABCDEFGH');

    const texts = blocks[0].entries.map((entry) => entry.text);
    expect(texts).toContain('ACE');
  });
});
