/**
 * Phase B acceptance sweep — spec §12 items tagged `[B]`, plus the Phase-B
 * slice of §12.10 (see `docs/_wip/plans/2026-08-04-print-design-system-requirements.md`
 * §12, and the Phase B task plan at
 * `.superpowers/sdd/2026-08-04-print-design-system-phase-b-plan/`).
 *
 * Same posture as `acceptance.phaseA.test.mjs`: a falsifiability sweep
 * against the REAL pipeline (`RenderPrintDocument`, `PublishPrintDocument`,
 * the actual `DocumentPdfRenderer`, real fonts, real poppler text extraction
 * and rasterization) — not a re-run of the per-task unit suites (those
 * already exist and stay green; see the full sweep recorded in the evidence
 * doc). A fake in-memory repository (the SAME shape `PublishPrintDocument
 * .test.mjs`/`RenderPrintDocument.test.mjs` already use) stands in for the
 * filesystem — that repository's own on-disk contract is
 * `YamlPrintDocumentRepository.test.mjs`'s job, not this file's; what THIS
 * file is proving is that the real USE CASE classes, wired together, behave
 * correctly end-to-end.
 *
 * CARRY from Task 6's review (mandatory per this task's brief): the answer
 * key collection's nested paths were lightly covered — the kitchen-sink
 * document below (`kitchenSinkSource`) includes standalone cloze (one blank
 * WITH a wordbank ref, one WITHOUT), wordbank, matching, standalone
 * short_answer, essay (one `box` variant, one `lines` variant), an inline
 * multiple_choice question, an inline multi_select question, AND a
 * bank-select question against an external bank — and the teacher key is
 * asserted correct for every single one of them, across variants 0..2.
 */
import {
  describe, it, expect, beforeAll,
} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { RenderPrintDocument } from './RenderPrintDocument.mjs';
import { createPrintDocumentRendering } from '#rendering/school/documents/PrintDocumentRendering.mjs';
import { PublishPrintDocument } from './PublishPrintDocument.mjs';
import {
  DOCUMENT_SOURCE_SCHEMA, validateDocumentSource,
} from '#domains/school/documents/documentSource.mjs';
import { DOCUMENT_V2_SCHEMA, validateAnyDocument } from '#domains/school/documents/documentV2.mjs';
import { deriveShuffle, applyShuffle } from '#domains/school/documents/shuffle.mjs';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import { pdfText } from '../../../../../tests/_lib/school/pdfText.mjs';
import { requirePdftoppm, rasterizePdfPages } from '../../../../../tests/_lib/school/rasterize.mjs';

const createRenderPrintDocument = (deps = {}) => new RenderPrintDocument({
  rendering: createPrintDocumentRendering(), ...deps,
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.join(HERE, '..', '..', '..', '..', '..', 'docs', '_wip', 'audits', '2026-08-04-print-design-phase-b-acceptance');
/** Set to regenerate the ONE pinned visual snapshot after reviewing the new render. */
const UPDATE_PROOF = process.env.UPDATE_PROOF === '1';
/** Same whole-page tolerance the Phase A proof suite / golden suite use. */
const PROOF_MAX_DIFF_RATIO = 0.005;
const CHANNEL_TOLERANCE = 8;

const isPdf = (bytes) => Buffer.isBuffer(bytes) && bytes.subarray(0, 5).toString('latin1') === '%PDF-';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const richText = (md) => ({ type: 'rich_text', md });
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function pngToImageData(png) {
  const { createCanvas: create, loadImage } = await import('canvas');
  const image = await loadImage(png);
  const canvas = create(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return { data: ctx.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height };
}

/** Whole-page diff ratio between two PNG buffers — same channel tolerance as the golden/Phase A suites. */
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

/** The order a set of candidate strings actually PRINT in, by first-appearance position in extracted text. */
const printedOrderOf = (bytes, candidates) => {
  const text = pdfText(bytes);
  return [...candidates].sort((a, b) => text.indexOf(a) - text.indexOf(b));
};

/**
 * Recursively asserts none of the SOURCE-only answer-bearing keys survive
 * anywhere in `value` — the publish postcondition (spec §3), checked
 * directly against the REAL published artifact a use-case call produced
 * (not a re-derivation). `pairs` is matching's answer field (source-only,
 * replaced by `itemRef` at publish); `answer`/`answers` cover every other
 * shape (cloze blank, short_answer, inline multiple_choice/multi_select).
 */
function assertNoAnswerFields(value, at = '') {
  if (Array.isArray(value)) { value.forEach((v, i) => assertNoAnswerFields(v, `${at}[${i}]`)); return; }
  if (!value || typeof value !== 'object') return;
  for (const key of ['answer', 'answers', 'pairs']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`found forbidden answer-bearing key "${key}" at ${at || '(root)'}`);
    }
  }
  Object.entries(value).forEach(([k, v]) => assertNoAnswerFields(v, at ? `${at}.${k}` : k));
}

/**
 * In-memory fake repository — the same shape `PublishPrintDocument.test.mjs`
 * already establishes (`get`/`writePublished`), extended with
 * `getDerivedBank` so a PERSISTED publish can round-trip through a real
 * `RenderPrintDocument` teacher-key render (the repository-backed path
 * `school.mjs docs`'s `publish` + `render --teacher` actually use), not
 * just the in-memory source auto-publish path.
 */
function fakeRepository(sourcesById = {}) {
  const store = new Map(); // `${id}@${rev}` -> {document, bank}
  return {
    store,
    get: async (id) => sourcesById[id] ?? null,
    writePublished({ document, bank, rev }) {
      const key = `${document.id}@${rev}`;
      const existing = store.get(key);
      if (existing) {
        return {
          document: { written: false, alreadyPublished: true },
          bank: bank ? { written: false, alreadyPublished: true } : null,
        };
      }
      store.set(key, { document, bank });
      return {
        document: { written: true, alreadyPublished: false },
        bank: bank ? { written: true, alreadyPublished: false } : null,
      };
    },
    async getDerivedBank(id, rev) {
      return store.get(`${id}@${rev}`)?.bank ?? null;
    },
  };
}

const OMR_LETTERS = createWorkbookTheme({ typeScale: 'standard', density: 'normal' }).omr.letters;
const letterFor = (choices, answer) => OMR_LETTERS[choices.indexOf(answer)];

// ── the Task-7 kitchen-sink fixture (CARRY, Task 6's review; F1's review) ───
// One document exercising EVERY Phase B answer-bearing shape in the SAME
// tree: TWO standalone cloze blocks (the first: blank 1 WITH a wordbank ref,
// blank 2 WITHOUT; the second: two more blanks, neither wordbank-referenced —
// added by the F1 fix specifically to prove a second cloze block's blanks no
// longer collide with the first's in the teacher key, now that they're
// grouped under distinct "Fill-in (passage N):" headings instead of a bare
// "N." label that reset to 1 at the start of every cloze block), wordbank,
// matching, standalone short_answer, essay (`box` AND `lines` variants —
// essay never carries an answer either way), an inline multiple_choice
// question, an inline multi_select question, and a bank-select ("select")
// question against an EXTERNAL bank. This is ALSO Task 7's visual-evidence
// document (see the "visual evidence" describe block below) — one document,
// reviewed both structurally and visually.

const WORDBANK_TERMS = ['Photosynthesis', 'Mitosis', 'Osmosis', 'Respiration'];
const MATCHING_LEFT = ['WA', 'OR', 'ID'];
const MATCHING_RIGHT = ['Boise', 'Salem', 'Olympia'];
const MATCHING_PAIRS = [
  { left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }, { left: 'ID', right: 'Boise' },
];
const KITCHEN_SINK_SEED = 90210;

const KITCHEN_SINK_BANK = {
  id: 'phase-b-kitchen-sink-external',
  title: 'Kitchen Sink External Bank',
  items: [
    {
      id: 'ext-mc1', type: 'multiple_choice', prompt: 'External: capital of France?', choices: ['Paris', 'Lyon', 'Nice'], answer: 'Paris',
    },
    {
      id: 'ext-mc2', type: 'multiple_choice', prompt: 'External: capital of Spain?', choices: ['Madrid', 'Barcelona'], answer: 'Madrid',
    },
    { id: 'ext-sa1', type: 'short_answer', prompt: 'External: name a European capital.', answer: 'Paris' },
  ],
};
const kitchenSinkBanks = { getBank: (id) => (id === KITCHEN_SINK_BANK.id ? KITCHEN_SINK_BANK : null) };

const kitchenSinkSource = ({ variant = 0 } = {}) => ({
  schema: DOCUMENT_SOURCE_SCHEMA,
  id: 'phase-b-kitchen-sink',
  seed: KITCHEN_SINK_SEED,
  variant,
  target: ['letter'],
  archetype: 'worksheet',
  title: 'Phase B Kitchen Sink',
  blocks: [
    richText('This worksheet exercises every Phase B assessment block in one document.'),
    { type: 'wordbank', key: 'wb1', terms: WORDBANK_TERMS },
    {
      type: 'cloze',
      text: 'Plants convert light into energy through {{1}}; cells divide by {{2}}.',
      blanks: [
        { n: 1, answer: 'Photosynthesis', wordbank: 'wb1' }, // WITH a wordbank ref
        { n: 2, answer: 'Mitosis' }, // WITHOUT a wordbank ref
      ],
    },
    // Second cloze block (F1, review finding): proves two cloze blocks in the
    // same document don't collide in the teacher key — each blank here is
    // ALSO numbered {{1}}/{{2}} (blank numbering is local to its own block,
    // same as the first cloze above), so a bare "N." label would print "1."
    // and "2." twice, indistinguishably from the first block's entries.
    {
      type: 'cloze',
      text: 'Water boils at {{1}} degrees F and freezes at {{2}} degrees F.',
      blanks: [
        { n: 1, answer: '212' },
        { n: 2, answer: '32' },
      ],
    },
    {
      type: 'matching', key: 'm1', left: MATCHING_LEFT, right: MATCHING_RIGHT, pairs: MATCHING_PAIRS,
    },
    { type: 'short_answer', prompt: 'Name a state capital.', answer: 'Olympia' },
    { type: 'essay', prompt: 'Describe the water cycle in your own words.', box: true },
    { type: 'essay', prompt: 'Explain why mitosis matters for a growing organism.', lines: 6 },
    {
      type: 'question',
      itemId: 'mc1',
      number: 1,
      blocks: [richText('Pick a primary color.'), { type: 'omr_response', itemId: 'mc1', choices: 3 }],
      choices: ['Red', 'Green', 'Blue'],
      answer: 'Blue',
    },
    {
      type: 'question',
      itemId: 'ms1',
      number: 2,
      blocks: [richText('Pick all primes under 6.'), { type: 'omr_response', itemId: 'ms1', choices: 4 }],
      choices: ['2', '3', '4', '5'],
      answers: ['2', '3', '5'],
    },
    {
      type: 'question', bankId: KITCHEN_SINK_BANK.id, select: 2, key: 'sel1',
    },
  ],
});

/**
 * Per-variant expected values, independently derived straight from
 * `deriveShuffle`/`applyShuffle` — never read off the code under test.
 */
function expectedForVariant(variant) {
  const wordbank = applyShuffle(WORDBANK_TERMS, deriveShuffle(KITCHEN_SINK_SEED, variant, 'wb1', WORDBANK_TERMS.length));
  const matchLeft = applyShuffle(MATCHING_LEFT, deriveShuffle(KITCHEN_SINK_SEED, variant, 'm1:left', MATCHING_LEFT.length));
  const matchRight = applyShuffle(MATCHING_RIGHT, deriveShuffle(KITCHEN_SINK_SEED, variant, 'm1:right', MATCHING_RIGHT.length));
  const matchingAnswer = MATCHING_PAIRS
    .map((pair) => ({ number: matchLeft.indexOf(pair.left) + 1, letter: OMR_LETTERS[matchRight.indexOf(pair.right)] }))
    .sort((a, b) => a.number - b.number)
    .map(({ number, letter }) => `${number}-${letter}`)
    .join(' ');
  const permutation = deriveShuffle(KITCHEN_SINK_SEED, variant, 'sel1', KITCHEN_SINK_BANK.items.length);
  const selected = applyShuffle(KITCHEN_SINK_BANK.items, permutation).slice(0, 2);
  const omitted = KITCHEN_SINK_BANK.items.filter((item) => !selected.includes(item));
  const numberedSelected = selected.map((item, i) => ({ item, number: 3 + i }));
  return {
    wordbank, matchLeft, matchRight, matchingAnswer, selected, omitted, numberedSelected,
  };
}

describe('Phase B acceptance sweep (spec §12, items tagged [B], plus the Phase-B slice of §12.10)', () => {
  describe('§12.2 answer split — source validates; publish strips; teacher key matches student shuffles', () => {
    it('the kitchen-sink source (every inline answer shape in one document) validates as a real school.document-source/v1', () => {
      const { errors, document } = validateDocumentSource(kitchenSinkSource());
      expect(errors).toEqual([]);
      expect(document.schema).toBe(DOCUMENT_SOURCE_SCHEMA);
    });

    it('publish strips every answer-bearing field: a deep scan of the REAL published artifact (via PublishPrintDocument, the actual use case) finds zero answer fields', async () => {
      const repository = fakeRepository();
      const useCase = new PublishPrintDocument({ repository });
      const {
        id, rev, bankId, warnings,
      } = await useCase.execute({ source: kitchenSinkSource() });

      expect(warnings).toEqual([]);
      expect(bankId).toBe(`derived/${id}@${rev}`);
      const stored = repository.store.get(`${id}@${rev}`);
      assertNoAnswerFields(stored.document);

      // wordbank (terms are presentation, mints nothing) and the bank-select
      // question (references an EXTERNAL bank, mints nothing of its own)
      // contribute 0 items; cloze #1 (2 blanks) + cloze #2 (2 blanks) +
      // matching (1) + short_answer (1) + inline multiple_choice (1) +
      // inline multi_select (1) = 8.
      expect(stored.bank.items).toHaveLength(8);
      expect(stored.bank.items.map((item) => item.type).sort()).toEqual(
        ['cloze', 'cloze', 'cloze', 'cloze', 'matching', 'multi_select', 'multiple_choice', 'short_answer'],
      );
    });

    it('the publish postcondition failure path runs through the REAL use case (PublishPrintDocument), not just the pure domain function — nothing persisted', async () => {
      const repository = fakeRepository();
      const useCase = new PublishPrintDocument({ repository });
      const badSource = {
        schema: DOCUMENT_SOURCE_SCHEMA,
        id: 'bad-postcondition',
        seed: 1,
        target: ['letter'],
        archetype: 'quiz',
        blocks: [{
          type: 'question',
          itemId: 'q1',
          number: 1,
          blocks: [richText('Pick the only option.')],
          choices: ['OnlyOne'], // a 1-choice multiple_choice fails validateQuestionBank's own postcondition
          answer: 'OnlyOne',
        }],
      };
      await expect(useCase.execute({ source: badSource })).rejects.toMatchObject({
        name: 'ValidationError', code: 'INVALID_DOCUMENT_SOURCE',
      });
      expect(repository.store.size).toBe(0);
    });

    it('a PERSISTED (repository round-tripped) publish resolves its teacher key from the repository-fetched derived bank — the same real path school.mjs docs\'s publish + render --teacher use, not the in-memory source auto-publish shortcut', async () => {
      const repository = fakeRepository();
      const publisher = new PublishPrintDocument({ repository });
      const { id, rev } = await publisher.execute({ source: kitchenSinkSource({ variant: 0 }) });
      const stored = repository.store.get(`${id}@${rev}`);
      expect(stored.document.rev).toBe(rev);

      const renderUseCase = createRenderPrintDocument({ repository, banks: kitchenSinkBanks });
      const result = await renderUseCase.execute({ document: stored.document, context: { teacher: true } });
      expect(isPdf(result.bytes)).toBe(true);
      const text = pdfText(result.bytes);
      expect(text).toMatch(/1\.\s*C/); // mc1: 'Blue' is index 2 of ['Red','Green','Blue'] -> letter C
      expect(text).toMatch(/2\.\s*A,\s*B,\s*D/); // ms1: '2','3','5' are indices 0,1,3 of ['2','3','4','5']
      // This fixture deliberately exercises EVERY Phase B block type in one
      // document — it is the "exceptionally long number of questions" case
      // the household fit rule (spec §7) carves out as legitimate for two
      // pages. `worksheet`'s archetype default is now `prefer-one-page`
      // (this task's change): it still tries compact density first (right
      // sizing), and only spills to a second page because this fixture
      // genuinely doesn't fit even then — which now surfaces as an
      // informative warning instead of the old silent `flow` spill.
      //
      // The warning's page count is 3, not 2: this is a `context.teacher`
      // render, and `result.pageCount` (what the warning reports — see its
      // own comment in RenderPrintDocument.mjs) is honestly the WHOLE
      // artifact's page count, student pages plus the appended teacher-key
      // page — the same total `DocumentPdfRenderer.render`'s own docstring
      // documents and every other caller of `pageCount` already sees. The
      // student content alone is 2 pages (confirmed by rendering the same
      // fixture without `context.teacher` — see the "renders both..." test
      // below, and the visual-evidence snapshot's page 1/2); the 3rd page is
      // the key, not a THIRD student page.
      expect(result.warnings).toEqual([
        `fit.policy 'prefer-one-page' could not fit '${id}' on one page even at compact density; spilled to 3 pages`,
      ]);
    });

    for (const variant of [0, 1, 2]) {
      it(`variant ${variant}: teacher key matches the student page's shuffles — every answerable item asserted correct`, async () => {
        const useCase = createRenderPrintDocument({ banks: kitchenSinkBanks });
        const document = kitchenSinkSource({ variant });
        const [student, teacher] = await Promise.all([
          useCase.execute({ document }),
          useCase.execute({ document, context: { teacher: true } }),
        ]);
        const teacherText = pdfText(teacher.bytes);
        const studentText = pdfText(student.bytes);
        const keyStart = teacherText.indexOf('Answer key —');
        expect(keyStart).toBeGreaterThanOrEqual(0);
        const keySection = teacherText.slice(keyStart);

        const expected = expectedForVariant(variant);

        // wordbank + matching print in the SHUFFLED (not document) order.
        expect(printedOrderOf(student.bytes, WORDBANK_TERMS)).toEqual(expected.wordbank);
        expect(printedOrderOf(student.bytes, MATCHING_LEFT)).toEqual(expected.matchLeft);
        expect(printedOrderOf(student.bytes, MATCHING_RIGHT)).toEqual(expected.matchRight);

        // bank-select: exactly the shuffled-selected 2 of 3 external items print; the omitted one never appears.
        for (const item of expected.selected) expect(studentText).toContain(item.prompt);
        for (const item of expected.omitted) expect(studentText).not.toContain(item.prompt);

        // -- every answerable item's teacher-key entry, scoped to the "Answer key" section --
        // standalone cloze #1, WITH (blank 1) and WITHOUT (blank 2) a
        // wordbank ref: fixed answers (cloze never shuffles). F1 (review
        // finding): grouped under its own "Fill-in (passage 1):" heading,
        // each blank labelled "blank <n>:" — not a bare "N." (which would
        // collide with question numbering AND with cloze #2's own blank 1/2
        // below).
        expect(keySection).toContain('Fill-in (passage 1):');
        expect(keySection).toMatch(/blank 1:\s*Photosynthesis/);
        expect(keySection).toMatch(/blank 2:\s*Mitosis/);
        // standalone cloze #2 (F1's added second cloze block): its own
        // "Fill-in (passage 2):" heading and blanks 1/2 — proving the two
        // cloze blocks' identically-numbered blanks do NOT collide.
        expect(keySection).toContain('Fill-in (passage 2):');
        expect(keySection).toMatch(/blank 1:\s*212/);
        expect(keySection).toMatch(/blank 2:\s*32/);
        // matching: labelled "Matching:" (the ONLY matching block in this
        // document — never the internal block key "m1", which prints
        // nowhere on the student page), shuffled order, per-variant
        // "N-L ..." string.
        expect(keySection).toContain(`Matching: ${expected.matchingAnswer}`);
        expect(keySection).not.toMatch(/\bm1:/);
        // standalone short_answer: labeled by its (truncated) prompt, never an internal path-based id.
        expect(keySection).toMatch(/"Name a state capital\." —\s*Olympia/);
        // essay (BOTH the `box` and `lines` variants) is NEVER answerable — no key entry for either, in any variant.
        expect(keySection).not.toContain('Describe the water cycle');
        expect(keySection).not.toContain('Explain why mitosis matters');
        // inline multiple_choice / multi_select: fixed answers (their own choices/answers never shuffle).
        expect(keySection).toMatch(/1\.\s*C/);
        expect(keySection).toMatch(/2\.\s*A,\s*B,\s*D/);
        // bank-select: numbered 3.. in the SAME shuffled-selection order the student page printed, correct per item type.
        for (const { item, number } of expected.numberedSelected) {
          const answerText = item.type === 'multiple_choice' ? letterFor(item.choices, item.answer) : item.answer;
          const re = new RegExp(`${number}\\.\\s*${escapeRegExp(answerText)}`);
          expect(keySection).toMatch(re);
        }
      });
    }
  });

  describe('§12.9 seeded shuffles — cloze/wordbank/matching render pinned; edit-stability under a sibling insert', () => {
    const SHUFFLE_SEED = 8675309;
    const shuffleDoc = (extraSibling = []) => ({
      schema: DOCUMENT_V2_SCHEMA,
      id: 'phase-b-shuffle-fixture',
      seed: SHUFFLE_SEED,
      variant: 0,
      target: ['letter'],
      archetype: 'worksheet',
      blocks: [
        { type: 'wordbank', key: 'wb1', terms: WORDBANK_TERMS },
        ...extraSibling,
        { type: 'cloze', text: 'The mitochondria is the {{1}} of the cell.', blanks: [{ n: 1 }] },
        { type: 'matching', key: 'm1', left: MATCHING_LEFT, right: MATCHING_RIGHT },
      ],
    });

    it('cloze + wordbank + matching render together — extracted page text is snapshot-pinned', async () => {
      const useCase = createRenderPrintDocument();
      const result = await useCase.execute({ document: shuffleDoc() });
      const normalized = pdfText(result.bytes).replace(/\n{3,}/g, '\n\n');
      expect(normalized).toMatchSnapshot();
    });

    it('edit-stability: inserting an unrelated sibling rich_text block between wordbank and cloze leaves BOTH keyed blocks\' shuffle order unchanged', async () => {
      const useCase = createRenderPrintDocument();
      const a = await useCase.execute({ document: shuffleDoc() });
      const b = await useCase.execute({
        document: shuffleDoc([{ type: 'rich_text', md: 'An unrelated inserted paragraph — a pure sibling edit.' }]),
      });

      expect(printedOrderOf(b.bytes, WORDBANK_TERMS)).toEqual(printedOrderOf(a.bytes, WORDBANK_TERMS));
      expect(printedOrderOf(b.bytes, MATCHING_LEFT)).toEqual(printedOrderOf(a.bytes, MATCHING_LEFT));
      expect(printedOrderOf(b.bytes, MATCHING_RIGHT)).toEqual(printedOrderOf(a.bytes, MATCHING_RIGHT));

      // Cross-checked directly against deriveShuffle/applyShuffle, not just "a equals b" (a shared bug could move both identically).
      const expectedWordbank = applyShuffle(WORDBANK_TERMS, deriveShuffle(SHUFFLE_SEED, 0, 'wb1', WORDBANK_TERMS.length));
      expect(printedOrderOf(a.bytes, WORDBANK_TERMS)).toEqual(expectedWordbank);
      expect(printedOrderOf(b.bytes, WORDBANK_TERMS)).toEqual(expectedWordbank);
    });
  });

  describe('§12.10(B) archetype dial — visible score box (quiz) vs no score box (worksheet), envelope-only diff', () => {
    const scoreBoxQuestion = (n) => ({
      type: 'question',
      itemId: `sq${n}`,
      number: n,
      blocks: [{ type: 'rich_text', md: `Problem ${n}.` }, { type: 'answer_space', minPt: 20, maxPt: 20 }],
    });
    const sameBody = () => Array.from({ length: 5 }, (_, i) => scoreBoxQuestion(i + 1));
    const bodyDoc = (archetype) => ({
      schema: DOCUMENT_V2_SCHEMA,
      id: 'phase-b-scorebox-fixture',
      seed: 13,
      variant: 0,
      target: ['letter'],
      archetype,
      fit: { policy: 'flow', typeScale: 'standard' },
      blocks: sameBody(),
    });

    it('header.scoreBox is the ONLY header field differing between quiz and worksheet — same body, same everything else', () => {
      const { document: quiz } = validateAnyDocument(bodyDoc('quiz'));
      const { document: worksheet } = validateAnyDocument(bodyDoc('worksheet'));
      expect(quiz.header).toEqual({ name: true, date: true, scoreBox: true });
      expect(worksheet.header).toEqual({ name: true, date: true, scoreBox: false });
      expect({ ...quiz.header, scoreBox: null }).toEqual({ ...worksheet.header, scoreBox: null });
    });

    it('quiz PRINTS "Score ____ / 5" (5 questions x defaultPoints 1); worksheet prints no score line at all — real rendered text, not a structural guess', async () => {
      const useCase = createRenderPrintDocument();
      const [quiz, worksheet] = await Promise.all([
        useCase.execute({ document: bodyDoc('quiz') }),
        useCase.execute({ document: bodyDoc('worksheet') }),
      ]);
      const quizText = pdfText(quiz.bytes);
      const worksheetText = pdfText(worksheet.bytes);
      expect(quizText).toContain('Score ____ / 5');
      expect(worksheetText).not.toContain('Score ____');

      // Pinned so a future regression that collapses the visible score box
      // shows up as a snapshot diff — same "snapshot both" model Phase A's
      // §12.10-A envelope-only check used, now covering the VISIBLE box.
      expect({
        quiz: { pageCount: quiz.pageCount, hash: sha256(quiz.bytes) },
        worksheet: { pageCount: worksheet.pageCount, hash: sha256(worksheet.bytes) },
      }).toMatchSnapshot();
    });
  });

  describe('visual evidence — kitchen-sink assessment worksheet + its teacher key (CARRY: Task 6 review flagged the answer-key collection\'s nested paths as lightly covered)', () => {
    let studentResult;
    let teacherResult;
    let studentPages;

    beforeAll(async () => {
      requirePdftoppm();
      const useCase = createRenderPrintDocument({ banks: kitchenSinkBanks });
      const document = kitchenSinkSource({ variant: 0 });
      const context = { learnerName: 'Proof Learner', date: '2026-08-04' };
      studentResult = await useCase.execute({ document, context });
      teacherResult = await useCase.execute({ document, context: { ...context, teacher: true } });
      studentPages = rasterizePdfPages(studentResult.bytes, { dpi: 150, name: 'phaseB-kitchen-sink-student' });

      // Commit the full PDFs + every student page PNG as reviewable
      // evidence. Content is fully deterministic (pinned CreationDate, no
      // randomness), so re-running this suite writes byte-identical files —
      // no spurious `git status` churn on a clean tree.
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'kitchen-sink-student.pdf'), studentResult.bytes);
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'kitchen-sink-teacher-key.pdf'), teacherResult.bytes);
      studentPages.forEach((png, i) => {
        // p01 is the ONE pinned regression gate below — compared against the
        // git-committed file BEFORE (potentially) being overwritten, never
        // blindly rewritten here.
        if (i === 0) return;
        fs.writeFileSync(path.join(EVIDENCE_DIR, `kitchen-sink-student-p${String(i + 1).padStart(2, '0')}.png`), png);
      });
    }, 60000);

    it('renders both the student worksheet and its teacher-key PDF; the teacher render has strictly more pages', () => {
      expect(isPdf(studentResult.bytes)).toBe(true);
      expect(isPdf(teacherResult.bytes)).toBe(true);
      expect(teacherResult.pageCount).toBeGreaterThan(studentResult.pageCount);
    });

    it('page 1 matches the committed visual snapshot', async () => {
      const snapshotPath = path.join(EVIDENCE_DIR, 'kitchen-sink-student-p01.png');
      const rendered = studentPages[0];

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
  });
});
