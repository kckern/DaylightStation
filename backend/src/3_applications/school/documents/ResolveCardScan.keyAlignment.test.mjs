/**
 * ResolveCardScan key-alignment wiring (Task 2, key-alignment-check plan).
 * Exercises the same REAL pipeline `ResolveCardScan.test.mjs` uses (a
 * source document actually published + card-attach rendered, a real
 * `YamlAllocationStore`) rather than an invented bank/document shape.
 *
 * Choices are deliberately NOT the literal letters 'A'-'D': a standard
 * `multiple_choice` row's graded `given` (see `gradeRow`/`letterToChoice`
 * in `ResolveCardScan.mjs`) holds the resolved CHOICE VALUE, not the bubble
 * letter the student marked — so a wiring that fed `row.given` straight
 * into `omrKeyAlignmentSuspect` would compare a choice value against a
 * `correctLetterFor` letter and never match, on any worksheet whose choices
 * aren't themselves single-letter strings. These fixtures use plain word
 * choices specifically so that mistake would fail loudly here.
 */
import { describe, it, expect } from 'vitest';
import { PublishPrintDocument } from './PublishPrintDocument.mjs';
import { RenderPrintDocument } from './RenderPrintDocument.mjs';
import { createPrintDocumentRendering } from '#rendering/school/documents/PrintDocumentRendering.mjs';
import { ResolveCardScan } from './ResolveCardScan.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';
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

/** Fresh in-memory `YamlAllocationStore` — no filesystem (copied verbatim from `ResolveCardScan.test.mjs`). */
function fakeAllocationStore(over = {}) {
  const map = new Map();
  const io = {
    load: (filePath) => (map.has(filePath) ? structuredClone(map.get(filePath)) : null),
    save: (filePath, content) => { map.set(filePath, structuredClone(content)); },
    list: (dir) => [...map.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).replace(/\.yml$/, '')),
  };
  return new YamlAllocationStore({
    directory: '/docs', io, now: () => '2026-08-04T00:00:00.000Z', rng: () => 0.42, ...over,
  });
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

// Non-letter choices on purpose — see the file doc comment above.
const CHOICES = ['walrus', 'penguin', 'otter', 'seal'];
// correctLetterFor's position for each item below: A, B, C, D, A, B.
const correctChoiceByRow = ['walrus', 'penguin', 'otter', 'seal', 'walrus', 'penguin'];

function keyAlignmentSource(id) {
  return sourceDoc(id, correctChoiceByRow.map((answer, index) => (
    mcQuestion(`q${index + 1}`, index + 1, { choices: CHOICES, answer })
  )));
}

describe('ResolveCardScan key-alignment wiring', () => {
  it('attaches keyAlignmentSuspect to a record whose marks are shifted one row late', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const logger = { info: () => {} };
    logger.calls = [];
    logger.warn = (...args) => { logger.calls.push(args); };
    const source = keyAlignmentSource('test/key-alignment-fixture');
    await publishAndAllocate({
      repository, allocationStore, source,
      context: { cardId: '1234567', startRow: 1, learnerId: 'test-learner' },
    });
    const resolver = new ResolveCardScan({ repository, allocationStore, logger });
    // Raw bubbled LETTERS (not choice values): row N's mark = the letter
    // correct for row N-1, for rows 2-6; row 1 is wrong. This is the exact
    // failure mode `omrKeyAlignmentSuspect` exists to catch — answers
    // written one row-number late.
    const answers = { 1: 'E', 2: 'A', 3: 'B', 4: 'C', 5: 'D', 6: 'A' };
    const result = await resolver.execute({ testId: '1234567', answers });
    const record = result.results[0];
    expect(record.keyAlignmentSuspect).toEqual({
      offset: -1, literalMatches: 0, shiftedMatches: 5, itemCount: 6,
    });
    expect(logger.calls.some(([event]) => event === 'school.scan.key-alignment-suspected')).toBe(true);
    const [, payload] = logger.calls.find(([event]) => event === 'school.scan.key-alignment-suspected');
    expect(payload).toMatchObject({
      cardId: '1234567', learnerId: 'test-learner',
      offset: -1, literalMatches: 0, shiftedMatches: 5, itemCount: 6,
    });
  });

  it('does not attach keyAlignmentSuspect to a normally-graded record', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const logger = { info: () => {}, warn: () => {} };
    const source = keyAlignmentSource('test/key-alignment-fixture-2');
    await publishAndAllocate({
      repository, allocationStore, source,
      context: { cardId: '1234568', startRow: 1, learnerId: 'test-learner' },
    });
    const resolver = new ResolveCardScan({ repository, allocationStore, logger });
    const answers = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'A', 6: 'B' };
    const result = await resolver.execute({ testId: '1234568', answers });
    expect(result.results[0].keyAlignmentSuspect).toBeUndefined();
  });

  it('does not attach keyAlignmentSuspect when any row is still blank', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const logger = { info: () => {}, warn: () => {} };
    const source = keyAlignmentSource('test/key-alignment-fixture-3');
    await publishAndAllocate({
      repository, allocationStore, source,
      context: { cardId: '1234569', startRow: 1, learnerId: 'test-learner' },
    });
    const resolver = new ResolveCardScan({ repository, allocationStore, logger });
    // Same row-late pattern as the first test, but row 6 is left unmarked —
    // the sheet is still mid-fill, so the check must not fire yet.
    const answers = { 1: 'E', 2: 'A', 3: 'B', 4: 'C', 5: 'D' };
    const result = await resolver.execute({ testId: '1234569', answers });
    expect(result.results[0].keyAlignmentSuspect).toBeUndefined();
  });
});

/**
 * A single physical OMR card routinely composes several worksheets (math,
 * scripture, civilization, …) as `sections`, each an independently gradeable
 * lesson with its own `rowRange` — an everyday shape in this household, not
 * an edge case. The row-shift check must never let a shift suspected on one
 * lesson's rows hold an unrelated lesson on the same card, and a blank row
 * in one lesson must never suppress detection in another (whole-branch
 * review finding #2: the check used to run record-wide and land on every
 * section via a `...card` spread).
 */
describe('ResolveCardScan key-alignment wiring — composed sections', () => {
  const sectionSource = (id) => sourceDoc(id, [
    ...correctChoiceByRow.map((answer, index) => mcQuestion(`a${index + 1}`, index + 1, { choices: CHOICES, answer })),
    ...correctChoiceByRow.map((answer, index) => mcQuestion(`b${index + 1}`, index + 7, { choices: CHOICES, answer })),
  ]);

  it('flags only the shifted section on a composed card, leaving the unshifted section unaffected', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const logger = { info: () => {}, warn: () => {} };
    const source = sectionSource('test/key-alignment-composed-1');
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source,
      context: {
        freshCard: true, learnerId: 'test-learner',
        sectionAttribution: [
          { id: 'lesson-a', itemIds: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], sessionId: 'session-a', lessonId: 'lesson-a' },
          { id: 'lesson-b', itemIds: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'], sessionId: 'session-b', lessonId: 'lesson-b' },
        ],
      },
    });
    const resolver = new ResolveCardScan({ repository, allocationStore, logger });
    const answers = {
      // Section A (rows 1-6): answers written one row-number late — the
      // exact shift pattern the first test in this file proves triggers.
      1: 'E', 2: 'A', 3: 'B', 4: 'C', 5: 'D', 6: 'A',
      // Section B (rows 7-12): the literal, un-shifted correct letters.
      7: 'A', 8: 'B', 9: 'C', 10: 'D', 11: 'A', 12: 'B',
    };
    const result = await resolver.execute({ testId: allocation.cardId, answers });
    const [record] = result.results;
    expect(record.keyAlignmentSuspect).toBeUndefined();
    const [sectionA, sectionB] = record.sections;
    expect(sectionA).toMatchObject({
      id: 'lesson-a',
      keyAlignmentSuspect: { offset: -1, literalMatches: 0, shiftedMatches: 5, itemCount: 6 },
    });
    expect(sectionB.keyAlignmentSuspect).toBeUndefined();
    // Section B graded normally: 6 of 6, untouched by section A's hold.
    expect(sectionB.earnedPoints).toBe(sectionB.totalPoints);
    expect(sectionB.results.every((row) => row.status === 'correct')).toBe(true);
  });

  it('does not let a blank row in one section suppress detection in another', async () => {
    const repository = fakeRepository();
    const allocationStore = fakeAllocationStore();
    const logger = { info: () => {}, warn: () => {} };
    const source = sectionSource('test/key-alignment-composed-2');
    const { allocation } = await publishAndAllocate({
      repository, allocationStore, source,
      context: {
        freshCard: true, learnerId: 'test-learner',
        sectionAttribution: [
          { id: 'lesson-a', itemIds: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], sessionId: 'session-a', lessonId: 'lesson-a' },
          { id: 'lesson-b', itemIds: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'], sessionId: 'session-b', lessonId: 'lesson-b' },
        ],
      },
    });
    const resolver = new ResolveCardScan({ repository, allocationStore, logger });
    const answers = {
      // Section A: same shifted-by-one pattern — still fully marked.
      1: 'E', 2: 'A', 3: 'B', 4: 'C', 5: 'D', 6: 'A',
      // Section B: correct except row 12, left blank — the sheet is still
      // mid-fill for this lesson only. Section A's own detection must not
      // be affected by lesson B's own, unrelated, still-open row.
      7: 'A', 8: 'B', 9: 'C', 10: 'D', 11: 'A',
    };
    const result = await resolver.execute({ testId: allocation.cardId, answers });
    const [sectionA, sectionB] = result.results[0].sections;
    expect(sectionA.keyAlignmentSuspect).toEqual({
      offset: -1, literalMatches: 0, shiftedMatches: 5, itemCount: 6,
    });
    expect(sectionB.keyAlignmentSuspect).toBeUndefined();
  });
});
