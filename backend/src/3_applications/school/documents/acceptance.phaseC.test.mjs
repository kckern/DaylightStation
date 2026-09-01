/**
 * Phase C acceptance sweep — spec §12 items tagged `[C]` (§12.3/§12.4/§12.5),
 * plus the Phase-C slice of §12.10 (see
 * `docs/_wip/plans/2026-08-04-print-design-system-requirements.md` §12, and
 * the Phase C task plan at
 * `.superpowers/sdd/2026-08-04-print-design-system-phase-c-plan/`).
 *
 * Same posture as `acceptance.phaseA.test.mjs`/`acceptance.phaseB.test.mjs`:
 * a falsifiability sweep against the REAL pipeline (`RenderPrintDocument`,
 * `PublishPrintDocument`, `ResolveCardScan`, `IssueDocument`, the real
 * `YamlAllocationStore`, the real `DocumentPdfRenderer`, real fonts, real
 * poppler text extraction/rasterization, and — for the card-boundary scan —
 * the REAL `decodeQuizSheet` bit decoder, not a hand-assembled
 * `{testId, answers}` object) — not a re-run of the per-task unit suites
 * (those already exist and stay green; see the full sweep recorded in the
 * evidence doc). A fake in-memory `io` stands in for `YamlAllocationStore`'s
 * filesystem in most tests (the SAME shape Task 5/6/7's own unit suites
 * use); the release-card test and the CARD ROW capacity error additionally
 * exercise the real filesystem or the real CLI entry point where the task
 * brief calls for it.
 *
 * CARRIES (mandatory per this task's brief):
 *   (a) Task 6's review flagged that a `superseded`-status record's rows
 *       reaching `unallocatedRows` had no test (only `released` did) — see
 *       "§12.4 ... CARRY (Task 6's own gap)" below.
 *   (b) Task 4's card header strip had zero pixel coverage (workbookTheme
 *       isn't in the pixel-golden corpus) — the "visual evidence" describe
 *       block below rasterizes a real card-attached sheet, confirms the
 *       seven card-id digits are actually printed on the page, and pins one
 *       page as a real pixel-diff regression snapshot.
 */
import {
  describe, it, expect, beforeAll,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dump } from 'js-yaml';

import { RenderPrintDocument } from './RenderPrintDocument.mjs';
import { createPrintDocumentRendering } from '#rendering/school/documents/PrintDocumentRendering.mjs';
import { PublishPrintDocument } from './PublishPrintDocument.mjs';
import { ResolveCardScan } from './ResolveCardScan.mjs';
import { IssueDocument } from '#apps/school/usecases/IssueDocument.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';
import { decodeQuizSheet } from '#apps/quizzes/quizScanRecorder.mjs';
import {
  DOCUMENT_SOURCE_SCHEMA, validateDocumentSource,
} from '#domains/school/documents/documentSource.mjs';
import { DOCUMENT_V2_SCHEMA, validateAnyDocument } from '#domains/school/documents/documentV2.mjs';
import { deriveShuffle, applyShuffle } from '#domains/school/documents/shuffle.mjs';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import {
  FakeSessionRepository, FakeTokenRegistry, FakeFormMapStore, FakeLaserPrinter, FakeDocumentRenderer,
  fakeClock, seededRng, silentLogger,
} from '../../../../../tests/_lib/school/lifecycleFakes.mjs';
import { pdfText } from '../../../../../tests/_lib/school/pdfText.mjs';
import { requirePdftoppm, rasterizePdfPages } from '../../../../../tests/_lib/school/rasterize.mjs';
import { runSchoolDocs } from '../../../../../cli/school/docs.mjs';

const createRenderPrintDocument = (deps = {}) => new RenderPrintDocument({
  rendering: createPrintDocumentRendering(), ...deps,
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.join(HERE, '..', '..', '..', '..', '..', 'docs', '_wip', 'audits', '2026-08-04-print-design-phase-c-acceptance');
/** Set to regenerate the ONE pinned visual snapshot after reviewing the new render. */
const UPDATE_PROOF = process.env.UPDATE_PROOF === '1';
/** Same whole-page tolerance the Phase A/B proof suites / golden suite use. */
const PROOF_MAX_DIFF_RATIO = 0.005;
const CHANNEL_TOLERANCE = 8;

const isPdf = (bytes) => Buffer.isBuffer(bytes) && bytes.subarray(0, 5).toString('latin1') === '%PDF-';
const richText = (md) => ({ type: 'rich_text', md });

async function pngToImageData(png) {
  const { createCanvas: create, loadImage } = await import('canvas');
  const image = await loadImage(png);
  const canvas = create(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return { data: ctx.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height };
}

/** Whole-page diff ratio between two PNG buffers — same channel tolerance as the golden/Phase A/B suites. */
async function pageDiffRatio(pngA, pngB) {
  const a = await pngToImageData(pngA);
  const b = await pngToImageData(pngB);
  if (a.width !== b.width || a.height !== b.height) return 1;
  let differing = 0;
  const total = a.width * a.height;
  for (let i = 0; i < a.data.length; i += 4) {
    if ([0, 1, 2].some((c) => Math.abs(a.data[i + c] - b.data[i + c]) > CHANNEL_TOLERANCE)) differing += 1;
  }
  return differing / total;
}

async function withTmpDir(fn) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'school-print-phase-c-'));
  try {
    return await fn(root);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

const OMR_LETTERS = createWorkbookTheme({ typeScale: 'standard', density: 'normal' }).omr.letters;

// ── in-memory fakes (same shapes Task 5/6/7's own unit suites use) ─────────

/** `YamlPrintDocumentRepository`-shaped fake — mirrors `ResolveCardScan.test.mjs`/`issueDocument.test.mjs`'s own copy. */
function fakeRepository() {
  const published = new Map();
  const banksById = new Map();
  const latestRevById = new Map();
  return {
    async writePublished({ document, bank, rev }) {
      const key = `${document.id}@${rev}`;
      published.set(key, document);
      if (bank) banksById.set(key, bank);
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
      return banksById.get(`${id}@${rev}`) ?? null;
    },
  };
}

/** In-memory `io` fake for a real `YamlAllocationStore` — no filesystem needed (mirrors `RenderPrintDocument.test.mjs`/`ResolveCardScan.test.mjs`). */
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

// ── row-mappable question builders ──────────────────────────────────────────

const mcRow = (n, itemId, choices, answer) => ({
  type: 'question',
  itemId,
  number: n,
  blocks: [richText(`Q${n} prompt`), { type: 'omr_response', itemId, choices: choices.length }],
  choices,
  answer,
});
const tfRow = (n, itemId, answer) => ({
  type: 'question', itemId, number: n, trueFalse: true, answer, blocks: [richText(`Q${n} true/false prompt`)],
});
const msRow = (n, itemId, choices, answers) => ({
  type: 'question',
  itemId,
  number: n,
  blocks: [richText(`Q${n} select-all prompt`), { type: 'omr_response', itemId, choices: choices.length }],
  choices,
  answers,
});

/** A minimal N-row-mappable quiz source: `blocks` rows 1..N, each `multiple_choice`, itemIds `q1..qN`. */
function quizSource(id, { rows = 2, variant = 0 } = {}) {
  return {
    schema: DOCUMENT_SOURCE_SCHEMA,
    id,
    seed: 42,
    variant,
    target: ['letter'],
    archetype: 'quiz',
    title: id,
    blocks: Array.from({ length: rows }, (_, i) => mcRow(i + 1, `q${i + 1}`, ['Alpha', 'Beta', 'Gamma'], 'Alpha')),
  };
}

// ── the REAL physical card bit layout (spec §5.1), so a "simulated scan" in
// this suite is genuinely DECODED via `decodeQuizSheet`, never hand-assembled
// as `{testId, answers}` directly ─────────────────────────────────────────

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const ID_COLUMNS = 7;
const QUESTION_COLUMNS = 25;
const UPPER_BANK_TOP_BIT = 10; // Q1-25
const LOWER_BANK_TOP_BIT = 4; // Q26-50 (SAME 25 physical columns as the upper bank)
const ID_DIGIT_TOP_BIT = 9;

/** `{cardId, answers: {row: letter|letters[]}}` -> the 32-column raw `marks[]` `decodeQuizSheet` expects. */
function encodeMarks({ cardId, answers }) {
  const cols = new Array(ID_COLUMNS + QUESTION_COLUMNS).fill(0);
  for (let i = 0; i < ID_COLUMNS; i += 1) {
    const digit = Number(cardId[i]);
    cols[i] |= (1 << (ID_DIGIT_TOP_BIT - digit));
  }
  for (const [rowStr, given] of Object.entries(answers)) {
    const row = Number(rowStr);
    const letters = Array.isArray(given) ? given : [given];
    const upper = row >= 1 && row <= 25;
    const colIndex = ID_COLUMNS + (upper ? row - 1 : row - 26);
    const topBit = upper ? UPPER_BANK_TOP_BIT : LOWER_BANK_TOP_BIT;
    for (const letter of letters) {
      const k = LETTERS.indexOf(letter);
      cols[colIndex] |= (1 << (topBit - k));
    }
  }
  return cols;
}

/** `{row: 'choice text'}` -> `{row: 'letter'}` against a fixed `choices` array — for building realistic `encodeMarks` input. */
function letterAnswers(rowToChoiceText, choices) {
  return Object.fromEntries(
    Object.entries(rowToChoiceText).map(([row, text]) => [row, LETTERS[choices.indexOf(text)]]),
  );
}

describe('Phase C acceptance sweep (spec §12.3/§12.4/§12.5, plus the Phase-C slice of §12.10)', () => {
  describe('§12.3 card contract — validation split, startRow offset numbering, bank-boundary scan-back', () => {
    describe('non-row-mappable scored item — Task 2\'s deliberate two-tier split (structural vs bank-dependent)', () => {
      it('validate-time (structural, no bank needed): a scored quiz question wrapping non-row-mappable nested content (short_answer) fails documentV2 validation with a dotted block path', () => {
        const doc = {
          schema: DOCUMENT_V2_SCHEMA,
          id: 'nonmappable-structural',
          seed: 1,
          target: ['letter'],
          archetype: 'quiz',
          blocks: [{
            type: 'question',
            itemId: 'q1',
            number: 1,
            blocks: [{ type: 'short_answer', prompt: 'Name a color.' }],
          }],
        };
        const { errors } = validateAnyDocument(doc);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/^blocks\[0\]: scored quiz question wraps a non-row-mappable 'short_answer'/);
      });

      it('render-time (bank-dependent): an inline question whose OWN itemId resolves to a short_answer bank item (answer, no choices) passes validate() cleanly, but fails card allocation at render time with a dotted block path — the split Task 2\'s own comments document, never caught earlier', async () => {
        const source = {
          schema: DOCUMENT_SOURCE_SCHEMA,
          id: 'nonmappable-bank',
          seed: 1,
          variant: 0,
          target: ['letter'],
          archetype: 'quiz',
          title: 'Nonmappable bank',
          blocks: [{
            type: 'question', itemId: 'q1', number: 1, blocks: [richText('Name a color.')], answer: 'blue',
          }],
        };
        const { errors } = validateDocumentSource(source);
        expect(errors).toEqual([]);

        const allocationStore = fakeAllocationStore();
        const useCase = createRenderPrintDocument({ allocationStore });
        await expect(useCase.execute({
          document: source, context: { freshCard: true },
        })).rejects.toMatchObject({
          name: 'ValidationError',
          code: 'ALLOCATION_ROW_PLAN_INVALID',
          details: { errors: [expect.stringMatching(/^blocks\[0\]: item type "short_answer" is not row-mappable/)] },
        });
      });
    });

    it('>5 choices on a row-mapped multiple_choice item fails card allocation with a dotted block path (bank-dependent — >5 is legal at plain bank validation, only the CARD row limit rejects it)', async () => {
      const allocationStore = fakeAllocationStore();
      const useCase = createRenderPrintDocument({ allocationStore });
      const choices = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
      const source = {
        schema: DOCUMENT_SOURCE_SCHEMA,
        id: 'too-many-choices',
        seed: 1,
        variant: 0,
        target: ['letter'],
        archetype: 'quiz',
        title: 'Too many choices',
        blocks: [mcRow(1, 'q1', choices, 'A1')],
      };
      await expect(useCase.execute({
        document: source, context: { freshCard: true },
      })).rejects.toMatchObject({
        code: 'ALLOCATION_ROW_PLAN_INVALID',
        details: { errors: [expect.stringMatching(/^blocks\[0\]: 6 choices exceeds the 5-choice row limit/)] },
      });
    });

    it('startRow + count - 1 > 50 fails card allocation (a whole-range error, not block-scoped — there is no single offending block; contrast with the two block-scoped errors above)', async () => {
      const allocationStore = fakeAllocationStore();
      const useCase = createRenderPrintDocument({ allocationStore });
      const source = quizSource('past-fifty', { rows: 5 });
      await expect(useCase.execute({
        document: source, context: { freshCard: true, startRow: 48 },
      })).rejects.toMatchObject({
        code: 'ALLOCATION_ROW_PLAN_INVALID',
        details: { errors: [expect.stringMatching(/^rows 48-52 exceed the 50-row card capacity/)] },
      });
    });

    describe('worksheet startRow: 18 -> offset numbering + a simulated scan of rows 18-30 spanning the 25/26 bank boundary', () => {
      const BOUNDARY_ROWS = Array.from({ length: 13 }, (_, i) => 18 + i); // 18..30 (13 rows: 8 upper-bank, 5 lower-bank)
      const boundaryChoices = ['Alpha', 'Beta', 'Gamma'];
      const boundaryAnswerFor = (row) => boundaryChoices[row % 3];
      const boundaryWorksheetSource = () => ({
        schema: DOCUMENT_SOURCE_SCHEMA,
        id: 'boundary-worksheet',
        seed: 555,
        variant: 2,
        target: ['letter'],
        archetype: 'worksheet',
        title: 'Boundary Worksheet',
        blocks: BOUNDARY_ROWS.map((row, i) => ({
          ...mcRow(i + 1, `br${row}`, boundaryChoices, boundaryAnswerFor(row)), omr: true,
        })),
      });

      let repository; let allocationStore; let useCase; let published; let rev;

      beforeAll(async () => {
        repository = fakeRepository();
        // Real randomness (not the usual constant-rng fake): the two tests
        // below each mint a SEPARATE freshCard on this ONE shared store, and
        // a constant rng would draw the identical 7-digit id twice, making
        // the second mint collide with the first's own record (mirrors
        // `issueDocument.test.mjs`'s own "tracked quizzes" fixture comment).
        allocationStore = fakeAllocationStore({ rng: Math.random });
        useCase = createRenderPrintDocument({ repository, allocationStore });
        const publisher = new PublishPrintDocument({ repository });
        ({ rev } = await publisher.execute({ source: boundaryWorksheetSource() }));
        published = await repository.getPublished('boundary-worksheet', rev);
      });

      it('prints the first question numbered 18 and the last numbered 30 — never "1."', async () => {
        const result = await useCase.execute({
          document: published, context: { freshCard: true, startRow: 18, learnerId: 'learner-boundary-1' },
        });
        expect(result.allocation.rowRange).toEqual({ start: 18, end: 30 });
        const text = pdfText(result.bytes);
        expect(text).toMatch(/\b18\./);
        expect(text).toMatch(/\b30\./);
        expect(text).not.toMatch(/\b1\./);
      });

      it('a simulated scan of rows 18-30, decoded through the REAL decodeQuizSheet bit layout (spanning the 25/26 bank boundary), resolves through the allocation store to the right document rev, learner, and variant, and grades every row correctly', async () => {
        const result = await useCase.execute({
          document: published, context: { freshCard: true, startRow: 18, learnerId: 'learner-boundary-2' },
        });
        const { cardId } = result.allocation;

        // Every row correct EXCEPT row 26 — the first LOWER-bank row — deliberately wrong, so grading is proven, not just presence.
        const givenText = {};
        for (const row of BOUNDARY_ROWS) givenText[row] = boundaryAnswerFor(row);
        const wrongIndex = (boundaryChoices.indexOf(boundaryAnswerFor(26)) + 1) % 3;
        givenText[26] = boundaryChoices[wrongIndex];

        const marks = encodeMarks({ cardId, answers: letterAnswers(givenText, boundaryChoices) });
        const decoded = decodeQuizSheet(marks);
        // Sanity: the encoder really round-trips through the REAL decoder — this is a genuinely decoded scan.
        expect(decoded.testId).toBe(cardId);
        expect(Object.keys(decoded.answers).map(Number).sort((a, b) => a - b)).toEqual(BOUNDARY_ROWS);

        const resolver = new ResolveCardScan({ allocationStore, repository });
        const resolved = await resolver.execute({ testId: decoded.testId, answers: decoded.answers });

        expect(resolved.unallocatedRows).toBeUndefined();
        expect(resolved.results).toHaveLength(1);
        const [record] = resolved.results;
        expect(record).toMatchObject({
          cardId,
          documentId: 'boundary-worksheet',
          rev,
          variant: 2,
          learnerId: 'learner-boundary-2',
          revisionSuperseded: false,
        });
        expect(record.results).toHaveLength(13);
        const byRow = new Map(record.results.map((r) => [r.row, r]));
        for (const row of BOUNDARY_ROWS) {
          expect(byRow.get(row).status).toBe(row === 26 ? 'incorrect' : 'correct');
        }
        // Both sides of the physical bank boundary resolved through the SAME allocation record — the boundary is purely a decode detail (spec §5.1), never an allocation seam.
        expect(byRow.get(25).status).toBe('correct'); // last upper-bank row
        expect(byRow.get(26).status).toBe('incorrect'); // first lower-bank row
      });
    });

    describe('shuffle-correct resolution through scan-back (a row-mapped bank-select item, spec §4.3/§5.4)', () => {
      const externalBank = {
        id: 'shuffle-external-bank',
        title: 'Shuffle External Bank',
        items: [
          {
            id: 'ext1', type: 'multiple_choice', prompt: 'Capital of France?', choices: ['Paris', 'Lyon'], answer: 'Paris',
          },
          {
            id: 'ext2', type: 'multiple_choice', prompt: 'Capital of Spain?', choices: ['Madrid', 'Barcelona'], answer: 'Madrid',
          },
          {
            id: 'ext3', type: 'multiple_choice', prompt: 'Capital of Italy?', choices: ['Rome', 'Milan'], answer: 'Rome',
          },
        ],
      };
      const banks = { getBank: (id) => (id === externalBank.id ? externalBank : null) };
      const bankSelectSource = (variant) => ({
        schema: DOCUMENT_SOURCE_SCHEMA,
        id: 'shuffle-select-quiz',
        seed: 9090,
        variant,
        target: ['letter'],
        archetype: 'quiz',
        title: 'Shuffle Select Quiz',
        blocks: [{
          type: 'question', bankId: externalBank.id, select: 1, key: 'sel1',
        }],
      });

      /** Publishes+renders one variant on its OWN card, and independently derives (never reads off the code under test) which external item that variant's seed selects. */
      async function renderCardedVariant(repository, source, learnerId) {
        const publisher = new PublishPrintDocument({ repository });
        const { id, rev } = await publisher.execute({ source });
        const published = await repository.getPublished(id, rev);
        const allocationStore = fakeAllocationStore({ rng: Math.random });
        const useCase = createRenderPrintDocument({ repository, banks, allocationStore });
        const result = await useCase.execute({ document: published, context: { freshCard: true, learnerId } });
        const permutation = deriveShuffle(source.seed, source.variant, 'sel1', externalBank.items.length);
        const selectedItem = applyShuffle(externalBank.items, permutation)[0];
        return { allocationStore, cardId: result.allocation.cardId, selectedItem };
      }

      it('two variants of the SAME document, scanned on DIFFERENT cards, each grade against their OWN seeded bank-select item — never cross-contaminated', async () => {
        const repository = fakeRepository();
        const v0 = await renderCardedVariant(repository, bankSelectSource(0), 'learner-v0');
        const v1 = await renderCardedVariant(repository, bankSelectSource(1), 'learner-v1');

        // The two variants really did select DIFFERENT external items — otherwise this test would prove nothing.
        expect(v0.selectedItem.id).not.toBe(v1.selectedItem.id);

        const resolver0 = new ResolveCardScan({ allocationStore: v0.allocationStore, repository, banks });
        const letter0 = OMR_LETTERS[v0.selectedItem.choices.indexOf(v0.selectedItem.answer)];
        const resolved0 = await resolver0.execute({ testId: v0.cardId, answers: { 1: letter0 } });
        expect(resolved0.results[0].results[0]).toMatchObject({ itemId: v0.selectedItem.id, status: 'correct' });

        const resolver1 = new ResolveCardScan({ allocationStore: v1.allocationStore, repository, banks });
        const letter1 = OMR_LETTERS[v1.selectedItem.choices.indexOf(v1.selectedItem.answer)];
        const resolved1 = await resolver1.execute({ testId: v1.cardId, answers: { 1: letter1 } });
        expect(resolved1.results[0].results[0]).toMatchObject({ itemId: v1.selectedItem.id, status: 'correct' });
      });
    });
  });

  describe('§12.4 collision, supersede, and release-card (spec §5.4)', () => {
    it('a second render overlapping a LIVE range on the SAME card is rejected as a structured ALLOCATION_COLLISION error, regardless of learner', async () => {
      const allocationStore = fakeAllocationStore();
      const useCase = createRenderPrintDocument({ allocationStore });
      const first = await useCase.execute({
        document: quizSource('collision-doc-a', { rows: 2 }), context: { freshCard: true, learnerId: 'kid-a' },
      });
      const { cardId } = first.allocation; // rows 1-2

      await expect(useCase.execute({
        document: quizSource('collision-doc-b', { rows: 2 }), // a DIFFERENT document AND learner
        context: { cardId, startRow: 2, learnerId: 'kid-b' }, // overlaps row 2
      })).rejects.toMatchObject({ name: 'DomainInvariantError', code: 'ALLOCATION_COLLISION' });

      // The colliding attempt never became durable — only the original record exists.
      const records = await allocationStore.findByCard(cardId);
      expect(records).toHaveLength(1);
      expect(records[0].status).toBe('live');
    });

    it('a re-render of the same (document, learner) supersedes cleanly — the prior record becomes superseded, the new one live, teacher-key numbers match the NEW allocation', async () => {
      const allocationStore = fakeAllocationStore();
      const useCase = createRenderPrintDocument({ allocationStore });
      const docV0 = quizSource('supersede-doc', { rows: 2, variant: 0 });
      const first = await useCase.execute({ document: docV0, context: { freshCard: true, learnerId: 'kid-c' } });
      const { cardId, recordId: firstRecordId } = first.allocation;

      // Same id, same learner, a DIFFERENT variant -> a genuinely new record (not the identical-recordId reprint shortcut).
      const docV1 = quizSource('supersede-doc', { rows: 2, variant: 1 });
      const second = await useCase.execute({
        document: docV1, context: { cardId, startRow: 1, learnerId: 'kid-c', teacher: true },
      });

      expect(second.allocation.cardId).toBe(cardId);
      expect(second.allocation.recordId).not.toBe(firstRecordId);
      expect(second.allocation.status).toBe('live');

      const records = await allocationStore.findByCard(cardId);
      expect(records).toHaveLength(2);
      expect(records.find((r) => r.recordId === firstRecordId).status).toBe('superseded');
      expect(records.find((r) => r.recordId === second.allocation.recordId).status).toBe('live');

      // Teacher-key numbers match the NEW allocation's own rows (1, 2).
      const text = pdfText(second.bytes);
      expect(text).toMatch(/1\./);
      expect(text).toMatch(/2\./);
    });

    it('release-card, driven through the REAL CLI function, frees a range — a fresh allocation on those SAME rows of the SAME card no longer collides', async () => withTmpDir(async (contentRoot) => {
      fs.mkdirSync(contentRoot, { recursive: true });
      const sourceFile = path.join(contentRoot, 'release-quiz.yml');
      fs.writeFileSync(sourceFile, dump(quizSource('release-doc', { rows: 2 })));

      const published = await runSchoolDocs(['publish', sourceFile, '--content-root', contentRoot]);
      expect(published.exitCode).toBe(0);

      // The SOURCE file, not a hand-built `published/<id>@<rev>.yml` path.
      // In card mode `<file>` supplies only the document ID — the CLI always
      // resolves the published revision through the repository (re-review
      // wave 2, F2), so source and published copy resolve to the same place.
      // This test used to construct that published path itself and broke
      // silently when the repository moved published revisions to
      // `documents/<id>/<rev>/document.yml`: `render` got a nonexistent path,
      // exited 1, and the failure read as a release-card bug rather than a
      // stale assumption about on-disk layout. Naming the id-bearing file the
      // caller already has cannot rot that way.
      const rendered = await runSchoolDocs([
        'render', sourceFile, '--out', path.join(contentRoot, 'card.pdf'), '--content-root', contentRoot, '--fresh-card',
      ]);
      expect(rendered.exitCode, JSON.stringify(rendered.report?.errors ?? [])).toBe(0);
      const { cardId } = rendered.report.allocation;

      const released = await runSchoolDocs(['release-card', cardId, '--content-root', contentRoot]);
      expect(released.exitCode).toBe(0);
      expect(released.report.released).toHaveLength(1);
      expect(released.report.released[0]).toMatchObject({ cardId, status: 'released' });

      // Freed for real: a fresh allocation on the SAME rows of the SAME card no longer collides.
      const allocationStore = new YamlAllocationStore({ directory: contentRoot });
      const record = await allocationStore.allocate({
        cardId,
        request: {
          documentId: 'another-doc', rev: 'deadbeef', seed: 1, variant: 0, rowRange: { start: 1, end: 2 },
        },
      });
      expect(record.status).toBe('live');
    }));

    it("CARRY (Task 6's own review gap): a SUPERSEDED record's rows are unallocated on scan-back — never graded against the stale answer key, never silently dropped either", async () => {
      const repository = fakeRepository();
      const publisher = new PublishPrintDocument({ repository });
      const allocationStore = fakeAllocationStore();
      const useCase = createRenderPrintDocument({ repository, allocationStore });

      const { id, rev } = await publisher.execute({ source: quizSource('supersede-scan-doc', { rows: 2 }) });
      const published = await repository.getPublished(id, rev);
      const first = await useCase.execute({
        document: published, context: { freshCard: true, startRow: 1, learnerId: 'kid-d' },
      });
      const { cardId } = first.allocation; // rows 1-2, about to become superseded

      // A re-render of the SAME (document, learner) at a DIFFERENT row range on the SAME card supersedes it —
      // rows 1-2 are then claimed by no one (the new record claims rows 5-6).
      await useCase.execute({ document: published, context: { cardId, startRow: 5, learnerId: 'kid-d' } });

      const records = await allocationStore.findByCard(cardId);
      expect(records.find((r) => r.rowRange.start === 1).status).toBe('superseded');

      const resolver = new ResolveCardScan({ allocationStore, repository });
      const resolved = await resolver.execute({ testId: cardId, answers: { 1: 'A' } }); // row 1: the superseded record's own row
      expect(resolved.results).toEqual([]);
      expect(resolved.unallocatedRows).toEqual([1]);
    });
  });

  describe('§12.5 multi_select end-to-end grading + per-row item-type flow (spec §5.4/§5.5)', () => {
    const gradingChoices = ['Alpha', 'Beta', 'Gamma', 'Delta'];
    const gradingSource = () => ({
      schema: DOCUMENT_SOURCE_SCHEMA,
      id: 'grading-fixture',
      seed: 77,
      variant: 0,
      target: ['letter'],
      archetype: 'quiz',
      title: 'Grading Fixture',
      blocks: [
        mcRow(1, 'gq1', ['Alpha', 'Beta', 'Gamma'], 'Beta'), // multiple_choice, single-select
        tfRow(2, 'gq2', true), // true_false
        msRow(3, 'gq3', gradingChoices, ['Alpha', 'Gamma']), // multi_select, exact-set (A, C)
      ],
    });

    /** Publishes + fresh-card renders the grading fixture; returns a scan-ready resolver. */
    async function setUpGradingScan() {
      const repository = fakeRepository();
      const publisher = new PublishPrintDocument({ repository });
      const allocationStore = fakeAllocationStore({ rng: Math.random });
      const useCase = createRenderPrintDocument({ repository, allocationStore });
      const { id, rev } = await publisher.execute({ source: gradingSource() });
      const published = await repository.getPublished(id, rev);
      const result = await useCase.execute({
        document: published, context: { freshCard: true, learnerId: 'kid-grade' },
      });
      const resolver = new ResolveCardScan({ allocationStore, repository });
      return { cardId: result.allocation.cardId, resolver };
    }

    it('a decoded multi-mark row grades exact-set against the derived bank — a correct set AND an incorrect (wrong-member) set, from two independent scans', async () => {
      const first = await setUpGradingScan();
      const correct = await first.resolver.execute({ testId: first.cardId, answers: { 1: 'B', 2: 'A', 3: ['A', 'C'] } });
      expect(correct.results[0].results.find((r) => r.row === 3)).toMatchObject({ status: 'correct', earned: 1 });

      const second = await setUpGradingScan();
      // 'B' (Beta) is not in the answer key {Alpha, Gamma} — a real wrong SET, not a partial-credit near-miss.
      const wrongSet = await second.resolver.execute({ testId: second.cardId, answers: { 1: 'B', 2: 'A', 3: ['A', 'B'] } });
      expect(wrongSet.results[0].results.find((r) => r.row === 3)).toMatchObject({
        status: 'incorrect', earned: 0, given: ['Alpha', 'Beta'],
      });
    });

    it('a double-mark on a SINGLE-SELECT row (multiple_choice) reports ambiguous, never a wrong-answer grade — the exact opposite of multi_select above, from the SAME scan call, and never poisons the other rows', async () => {
      const { cardId, resolver } = await setUpGradingScan();
      const scanned = await resolver.execute({ testId: cardId, answers: { 1: ['A', 'B'], 2: 'A', 3: ['A', 'C'] } });
      const byRow = new Map(scanned.results[0].results.map((r) => [r.row, r]));
      expect(byRow.get(1)).toMatchObject({ status: 'ambiguous', earned: 0, given: ['A', 'B'] });
      expect(byRow.get(2)).toMatchObject({ status: 'correct' });
      expect(byRow.get(3)).toMatchObject({ status: 'correct' });
    });

    it('per-row item type flows from the derived bank to the resolver — three DIFFERENT item types, in the SAME scan, each graded via its own type-specific rule, never guessed uniformly', async () => {
      const { cardId, resolver } = await setUpGradingScan();
      const scanned = await resolver.execute({ testId: cardId, answers: { 1: ['A', 'C'], 2: 'B', 3: ['A', 'B', 'C'] } });
      const byRow = new Map(scanned.results[0].results.map((r) => [r.row, r]));
      // Row 1 (multiple_choice): a double-mark is ambiguous.
      expect(byRow.get(1).status).toBe('ambiguous');
      // Row 2 (true_false): 'B' -> false; the answer key is true -> incorrect (never "ambiguous" — true_false has no multi-mark concept).
      expect(byRow.get(2)).toMatchObject({ status: 'incorrect', given: 'B' });
      // Row 3 (multi_select): a 3-mark set against a 2-correct answer key is a real WRONG SET (exact-set grading), not "too many marks -> ambiguous".
      expect(byRow.get(3)).toMatchObject({ status: 'incorrect', given: ['Alpha', 'Beta', 'Gamma'] });
    });
  });

  describe('§12.10-C tracked-quiz slice — the SAME published document issued through IssueDocument (session + card allocation) vs a loose render (no session, no card): envelope/context-only difference', () => {
    const trackedQuizSource = () => ({
      schema: DOCUMENT_SOURCE_SCHEMA,
      id: 'envelope-only-quiz',
      seed: 314,
      variant: 0,
      target: ['letter'],
      archetype: 'quiz',
      title: 'Envelope-Only Quiz',
      blocks: [
        mcRow(1, 'eq1', ['Alpha', 'Beta', 'Gamma'], 'Alpha'),
        mcRow(2, 'eq2', ['Alpha', 'Beta', 'Gamma'], 'Beta'),
      ],
    });

    it('question content, order, and score box are byte-for-byte the SAME; the card header strip is the only envelope-level difference', async () => {
      const repository = fakeRepository();
      const publisher = new PublishPrintDocument({ repository });
      const { id, rev } = await publisher.execute({ source: trackedQuizSource() });
      const published = await repository.getPublished(id, rev);

      // ── Tracked leg: through IssueDocument — a real session, a real (fake) laser printer ──
      const allocationStore = fakeAllocationStore();
      const renderPrintDocument = createRenderPrintDocument({ repository, allocationStore });
      const clock = fakeClock();
      const sessions = new FakeSessionRepository();
      const tokens = new FakeTokenRegistry();
      const formMaps = new FakeFormMapStore();
      const printer = new FakeLaserPrinter();
      const curriculum = {
        async getUnit(unitId) {
          return unitId === 'tracked-unit' ? { unitId, document: `print/${id}@${rev}` } : null;
        },
        async getDocument() { throw new Error('legacy lookup must not be called for a print-document unit'); },
      };
      const issueUseCase = new IssueDocument({
        curriculum,
        sessions,
        tokens,
        formMaps,
        printer,
        renderer: new FakeDocumentRenderer(), // required by the constructor, never invoked on this path
        printDocuments: repository,
        renderPrintDocument,
        allocationStore,
        clock: clock.now,
        rng: seededRng(1),
        newArtifactId: () => 'art_envelope',
        logger: silentLogger,
      });
      const sessionId = 'ses_envelope';
      await sessions.appendEvent(sessionId, {
        type: 'created', at: clock.iso(), sessionId, learnerId: 'kid-envelope', unitId: 'tracked-unit',
      });
      const issued = await issueUseCase.execute({ sessionId });
      expect(issued.status).toBe('issued');
      expect(printer.jobs).toHaveLength(1);
      const trackedBytes = printer.jobs[0].pdf;
      expect(isPdf(trackedBytes)).toBe(true);

      // ── Loose leg: RenderPrintDocument, direct — no session, no card, no printer ──
      const looseUseCase = createRenderPrintDocument({ repository });
      const loose = await looseUseCase.execute({ document: published, context: {} });
      expect(isPdf(loose.bytes)).toBe(true);
      expect(loose.allocation).toBeNull();
      expect(loose.warnings).toEqual([expect.stringMatching(/rendered without card allocation/)]);

      // ── Content is identical: same question prompts, same order, same score box. ──
      const trackedText = pdfText(trackedBytes);
      const looseText = pdfText(loose.bytes);
      for (const prompt of ['Q1 prompt', 'Q2 prompt']) {
        expect(trackedText).toContain(prompt);
        expect(looseText).toContain(prompt);
      }
      expect(trackedText).toMatch(/Score ____ \/ 2/);
      expect(looseText).toMatch(/Score ____ \/ 2/);
      // Numbering is identical too (both start at position 1) — the card envelope adds a HEADER; it does not renumber this particular sheet.
      expect(trackedText).toMatch(/1\./);
      expect(trackedText).toMatch(/2\./);
      expect(looseText).toMatch(/1\./);
      expect(looseText).toMatch(/2\./);

      // The card header strip is the ENVELOPE-only difference: present on the tracked render, absent on the loose one.
      expect(trackedText).not.toContain('Bubble this number');
      expect(looseText).not.toContain('Bubble this number');
    });
  });

  describe('visual evidence — card header digits on a real rasterized page (CARRY: Task 4 deferred pixel coverage) + fresh-card first-use + continuation reminder + teacher key', () => {
    let firstUseResult;
    let continuationResult;
    let continuationTeacherResult;
    let continuationPages;
    let cardId;

    beforeAll(async () => {
      requirePdftoppm();
      const repository = fakeRepository();
      const publisher = new PublishPrintDocument({ repository });
      const allocationStore = fakeAllocationStore();
      const useCase = createRenderPrintDocument({ repository, allocationStore });

      // Document 1: freshCard, startRow 1 — the FIRST-USE sheet.
      const doc1Source = {
        schema: DOCUMENT_SOURCE_SCHEMA,
        id: 'visual-evidence-quiz-1',
        seed: 111,
        variant: 0,
        target: ['letter'],
        archetype: 'quiz',
        title: 'Visual Evidence Quiz 1',
        blocks: [
          mcRow(1, 'vq1', ['Red', 'Green', 'Blue'], 'Blue'),
          mcRow(2, 'vq2', ['Cat', 'Dog', 'Fish'], 'Dog'),
        ],
      };
      const { id: id1, rev: rev1 } = await publisher.execute({ source: doc1Source });
      const published1 = await repository.getPublished(id1, rev1);
      firstUseResult = await useCase.execute({
        document: published1, context: { freshCard: true, learnerId: 'proof-learner' },
      });
      cardId = firstUseResult.allocation.cardId; // rows 1-2

      // Document 2: SAME card, continuation at startRow 3 — offset numbering + "use your card" reminder.
      const doc2Source = {
        schema: DOCUMENT_SOURCE_SCHEMA,
        id: 'visual-evidence-quiz-2',
        seed: 222,
        variant: 0,
        target: ['letter'],
        archetype: 'quiz',
        title: 'Visual Evidence Quiz 2',
        blocks: [
          mcRow(1, 'vq3', ['One', 'Two', 'Three'], 'Two'),
          mcRow(2, 'vq4', ['Up', 'Down'], 'Up'),
        ],
      };
      const { id: id2, rev: rev2 } = await publisher.execute({ source: doc2Source });
      const published2 = await repository.getPublished(id2, rev2);
      const context2 = {
        cardId, startRow: 3, learnerId: 'proof-learner', date: '2026-08-04',
      };
      continuationResult = await useCase.execute({ document: published2, context: context2 });
      continuationTeacherResult = await useCase.execute({ document: published2, context: { ...context2, teacher: true } });
      continuationPages = rasterizePdfPages(continuationResult.bytes, { dpi: 150, name: 'phaseC-card-continuation' });

      // Commit PDFs + every continuation-sheet page PNG as reviewable evidence.
      // Content is fully deterministic (pinned CreationDate, fixed rng/clock in
      // the allocation store, no other randomness), so re-running this suite
      // writes byte-identical files — no spurious `git status` churn on a
      // clean tree.
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'card-first-use-student.pdf'), firstUseResult.bytes);
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'card-continuation-student.pdf'), continuationResult.bytes);
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'card-continuation-teacher-key.pdf'), continuationTeacherResult.bytes);
      continuationPages.forEach((png, i) => {
        // p01 is the ONE pinned regression gate below — compared against the
        // git-committed file BEFORE (potentially) being overwritten.
        if (i === 0) return;
        fs.writeFileSync(path.join(EVIDENCE_DIR, `card-continuation-student-p${String(i + 1).padStart(2, '0')}.png`), png);
      });
    }, 60000);

    it('the fresh-card sheet carries the first-use instruction; the continuation sheet carries the "use your card" reminder and offset numbering (3, 4 — never 1, 2)', () => {
      expect(isPdf(firstUseResult.bytes)).toBe(true);
      const firstUseText = pdfText(firstUseResult.bytes);
      expect(firstUseText).not.toContain('Bubble this number');
      expect(firstUseResult.allocation.rowRange).toEqual({ start: 1, end: 2 });

      const continuationText = pdfText(continuationResult.bytes);
      expect(continuationText).not.toContain(`Use Student No. ${cardId}.`);
      expect(continuationText).not.toContain('Bubble this number');
      expect(continuationResult.allocation.rowRange).toEqual({ start: 3, end: 4 });
      expect(continuationText).toMatch(/\b3\./);
      expect(continuationText).toMatch(/\b4\./);
      expect(continuationText).not.toMatch(/\b1\./);
    });

    it("the SAME card id's seven digits actually print on BOTH sheets — a physical card is one card across documents (CARRY: this is the pixel-coverage gap Task 4's review flagged)", () => {
      const firstUseText = pdfText(firstUseResult.bytes);
      const continuationText = pdfText(continuationResult.bytes);
      for (const text of [firstUseText, continuationText]) {
        for (const digit of cardId) expect(text).toContain(digit);
      }
      // The plain (un-spaced) reminder line on the continuation sheet.
      expect(continuationText).toContain(cardId);
    });

    it('page 1 matches the committed visual snapshot — Student No. is followed by its identicon and seven digits, with no redundant instruction and offset question numbers 3/4 (never 1/2)', async () => {
      const snapshotPath = path.join(EVIDENCE_DIR, 'card-continuation-student-p01.png');
      const rendered = continuationPages[0];

      if (UPDATE_PROOF || !fs.existsSync(snapshotPath)) {
        fs.writeFileSync(snapshotPath, rendered);
        if (!UPDATE_PROOF) {
          throw new Error(
            `visual proof snapshot did not exist — wrote a fresh one to ${path.relative(process.cwd(), snapshotPath)}. `
            + 'Review the page, then re-run to confirm it is pinned (or set UPDATE_PROOF=1 deliberately after a real change).',
          );
        }
        return;
      }

      const ratio = await pageDiffRatio(rendered, fs.readFileSync(snapshotPath));
      expect(ratio, `page 1 differs from the committed visual snapshot by ${(ratio * 100).toFixed(3)}%`).toBeLessThanOrEqual(PROOF_MAX_DIFF_RATIO);
    }, 30000);

    it('renders a real teacher key for the continuation sheet whose numbers match the offset student sheet (3, 4)', () => {
      expect(isPdf(continuationTeacherResult.bytes)).toBe(true);
      const text = pdfText(continuationTeacherResult.bytes);
      expect(text).toMatch(/3\.\s*B/); // vq3: 'Two' is choice index 1 -> letter B
      expect(text).toMatch(/4\.\s*A/); // vq4: 'Up' is choice index 0 -> letter A
    });
  });
});
