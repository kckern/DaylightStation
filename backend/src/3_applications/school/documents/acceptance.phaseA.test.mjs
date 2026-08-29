/**
 * Phase A acceptance sweep — spec §12 items tagged `[A]` (see
 * `docs/_wip/plans/2026-08-04-print-design-system-requirements.md`).
 *
 * This is a falsifiability sweep, not a unit suite: every item below is
 * exercised through the REAL pipeline (`RenderPrintDocument`, the actual
 * `DocumentPdfRenderer`, real fonts, real poppler rasterization) rather than
 * stubs, because the point of an acceptance test is to catch the gap between
 * "the unit tests pass" and "the thing actually works."
 *
 * CARRY from Task 5's self-review (mandatory per this task's brief): the
 * seven new content blocks (passage/figure/inset/list/divider/spacer/
 * page_break) had only structural (`toMatchSnapshot()`) coverage before this
 * file — no one had actually LOOKED at a rendered page. The "visual proof"
 * describe below renders one document exercising all seven blocks plus page
 * furniture (footer band, duplex gutter) across 3 pages
 * at both type-scale presets, rasterizes every page with poppler, commits
 * the PDFs + PNGs as reviewable evidence under
 * `docs/_wip/audits/2026-08-04-print-design-phase-a-acceptance/`, and pins
 * one page as a real regression-checked image snapshot (pixel-diff, same
 * tolerance model as `tests/isolated/rendering/school/golden/`).
 *
 * §12.10's full item ("archetype dial") is tagged `[A/B/C]` — only the
 * envelope-level "A-part" is in scope here. Phase A does not draw a visible
 * score box (`header.scoreBox` is validated but not yet consumed by
 * `DocumentPdfRenderer` — the visible box is explicitly Phase B's "points/
 * score box", spec §13). What Phase A DOES wire end-to-end, purely from the
 * `archetype` field, is `header.scoreBox` (validation-level) and `duplex`
 * (render-level, via `RenderPrintDocument`'s `DUPLEX_ARCHETYPES`) — both
 * proven below.
 */
import {
  describe, it, expect, beforeAll,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { RenderPrintDocument } from './RenderPrintDocument.mjs';
import { createPrintDocumentRendering } from '#rendering/school/documents/PrintDocumentRendering.mjs';
import {
  validateAnyDocument, DOCUMENT_V2_SCHEMA, BLOCK_TARGET_SUPPORT,
} from '#domains/school/documents/documentV2.mjs';
import { validateDocument } from '#domains/school/documents/documentValidation.mjs';
import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import { createMeasurementDocument, measureDocumentFragments } from '#rendering/school/documents/measure.mjs';
import { placeFragments } from '#rendering/school/documents/layout.mjs';
import { contentBox } from '#rendering/school/documents/furniture.mjs';
import { texToSvg } from '#rendering/school/documents/mathSvg.mjs';
import { requirePdftoppm, rasterizePdfPages } from '../../../../../tests/_lib/school/rasterize.mjs';

const createRenderPrintDocument = (deps = {}) => new RenderPrintDocument({
  rendering: createPrintDocumentRendering(), ...deps,
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.join(HERE, '..', '..', '..', '..', '..', 'docs', '_wip', 'audits', '2026-08-04-print-design-phase-a-acceptance');
/** Set to regenerate the ONE pinned visual snapshot after reviewing the new render. */
const UPDATE_PROOF = process.env.UPDATE_PROOF === '1';
/** Same whole-page tolerance the golden suite uses — loose enough to absorb antialiasing jitter. */
const PROOF_MAX_DIFF_RATIO = 0.005;
const CHANNEL_TOLERANCE = 8;

const isPdf = (bytes) => Buffer.isBuffer(bytes) && bytes.subarray(0, 5).toString('latin1') === '%PDF-';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const FONT_FACES = [
  'AtkinsonHyperlegible-Regular', 'AtkinsonHyperlegible-Bold', 'AtkinsonHyperlegible-Italic', 'AtkinsonHyperlegible-BoldItalic',
];

/** A single fixed-size question: keeps page-count math independent of font metrics. */
const question = (n, prefix = 'q') => ({
  type: 'question',
  itemId: `${prefix}${n}`,
  number: n,
  blocks: [
    { type: 'rich_text', md: `Problem ${n}. Solve and show your work.` },
    { type: 'answer_space', minPt: 30, maxPt: 30 },
  ],
});
/** 10 fixed questions: empirically 2 pages under `flow`/quiz|worksheet at standard density (see RenderPrintDocument.test.mjs's own empirical comment). */
const manyQuestions = (n, prefix = 'q') => Array.from({ length: n }, (_, i) => question(i + 1, prefix));

const v2doc = (over = {}) => ({
  schema: DOCUMENT_V2_SCHEMA,
  id: 'acceptance-fixture',
  seed: 7,
  target: ['letter'],
  archetype: 'quiz',
  blocks: [question(1)],
  ...over,
});

/** Text extraction via poppler's `pdftotext -layout` — real ink, not a structural guess. */
function pdfText(bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-acceptance-'));
  try {
    const pdfPath = path.join(dir, 'doc.pdf');
    fs.writeFileSync(pdfPath, bytes);
    return execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function pngToImageData(png) {
  const { createCanvas: create, loadImage } = await import('canvas');
  const image = await loadImage(png);
  const canvas = create(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return { data: ctx.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height };
}

/** Whole-page diff ratio between two PNG buffers — same channel tolerance as the golden suite. */
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

describe('Phase A acceptance sweep (spec §12, items tagged [A])', () => {
  describe('§12.1 determinism', () => {
    it('a v2 document renders byte-identically on a second run of the SAME use-case instance', async () => {
      const useCase = createRenderPrintDocument();
      const document = v2doc({ archetype: 'worksheet', blocks: manyQuestions(3) });
      const first = await useCase.execute({ document, context: { learnerName: 'Alex' } });
      const second = await useCase.execute({ document, context: { learnerName: 'Alex' } });
      expect(isPdf(first.bytes)).toBe(true);
      expect(first.bytes.equals(second.bytes)).toBe(true);
    });

    it('a v2 document renders byte-identically across two FRESH use-case instances — no shared mutable state', async () => {
      const document = v2doc({ archetype: 'worksheet', blocks: manyQuestions(3) });
      const a = await createRenderPrintDocument().execute({ document, context: { learnerName: 'Alex' } });
      const b = await createRenderPrintDocument().execute({ document, context: { learnerName: 'Alex' } });
      expect(a.bytes.equals(b.bytes)).toBe(true);
    });

    it('a v1 (legacy) document renders byte-identically on a second run and across two fresh instances', async () => {
      const raw = {
        id: 'v1-determinism', seed: 4242, variant: 0, target: ['letter'], blocks: [{ type: 'rich_text', md: 'Determinism check.' }],
      };
      const first = await createRenderPrintDocument().execute({ document: raw, context: { learnerName: 'Sam' } });
      const second = await createRenderPrintDocument().execute({ document: raw, context: { learnerName: 'Sam' } });
      expect(first.bytes.equals(second.bytes)).toBe(true);
    });
  });

  describe('§12.6 fit — the three-policy matrix (one file, three fixtures) + the receipt-target rejection', () => {
    describe('policy: one-page — overset at compact density fails with a structured, non-zero oversetPt', () => {
      it('rejects with FIT_OVERSET after trying both densities', async () => {
        const useCase = createRenderPrintDocument();
        // 12 fixed 30/30pt questions overflow BOTH densities — same empirical
        // fixture RenderPrintDocument.test.mjs establishes against the real pipeline.
        const document = v2doc({
          archetype: 'quiz', fit: { policy: 'one-page', typeScale: 'standard' }, blocks: manyQuestions(12),
        });
        const err = await useCase.execute({ document }).catch((e) => e);
        expect(err).toMatchObject({
          name: 'ValidationError', code: 'FIT_OVERSET', details: expect.objectContaining({ oversetPt: expect.any(Number) }),
        });
        expect(err.details.oversetPt).toBeGreaterThan(0);
      });
    });

    describe('policy: flow — paginates with correct footers', () => {
      let rendered;
      let pages;
      let text;

      beforeAll(async () => {
        requirePdftoppm();
        const useCase = createRenderPrintDocument();
        const document = v2doc({
          archetype: 'quiz', fit: { policy: 'flow', typeScale: 'standard' }, blocks: manyQuestions(10),
        });
        rendered = await useCase.execute({ document, context: { learnerName: 'Riley' } });
        pages = rasterizePdfPages(rendered.bytes, { dpi: 150, name: 'flow-policy' });
        text = pdfText(rendered.bytes);
      }, 60000);

      it('actually paginates to more than one page', () => {
        expect(rendered.pageCount).toBe(2);
        expect(pages).toHaveLength(2);
      });

      it('the footer band reads "Page N of 2" on every page — verified by real text extraction (pdftotext), not a structural guess', () => {
        expect(text).toMatch(/Page 1 of 2/);
        expect(text).toMatch(/Page 2 of 2/);
      });

      it('page 2 carries NO continuation strip — the name line lives on page 1\'s real header alone', () => {
        // Page 1 has the real header ("Name: Riley" once). Nothing repeats it
        // on page 2: the blank continuation strip that used to print a second
        // "Name: ____" is gone, replaced by the footer's card number (which
        // this non-card fixture does not carry — see the footer test above).
        const occurrences = text.match(/Name: Riley/g) ?? [];
        expect(occurrences).toHaveLength(1);
        // The document's title-or-id prints once, in that same page-1 header.
        expect((text.match(/acceptance-fixture/g) ?? [])).toHaveLength(1);
        expect(rendered.pageCount).toBe(2);
      });

      it('the reserved furniture band is exactly the footer band — layout result backing the visual check', () => {
        const theme = createWorkbookTheme({ typeScale: 'standard', density: 'normal' });
        expect(theme.furniture.footerBandPt).toBeGreaterThan(0);
        expect(theme.furniture.continuationStripPt).toBeUndefined();
        const box = contentBox(theme, { gutter: true, duplex: false, pageIndex: 1 });
        expect(box.pageHeightPt).toBe(theme.page.heightPt - theme.furniture.footerBandPt);
      });

      it('extracted page text is snapshot-pinned — a regression that reflows/renumbers pages shows up as a text diff', () => {
        // Collapse runs of blank lines so the pin is robust to harmless
        // vertical-whitespace shifts and only breaks on real content changes.
        const normalized = text.replace(/\n{3,}/g, '\n\n');
        expect(normalized).toMatchSnapshot();
      });
    });

    describe('policy: fill — bottoms out the last page (inverted last-page growth)', () => {
      const growable = v2doc({
        archetype: 'worksheet',
        fit: { policy: 'fill', typeScale: 'standard' },
        blocks: [{
          type: 'question',
          itemId: 'g1',
          number: 1,
          blocks: [{ type: 'rich_text', md: 'Write a sentence.' }, { type: 'answer_space', minPt: 40, maxPt: 400 }],
        }],
      });

      it('grows the last fragment to its answer-space cap — proven at the layout-result level', () => {
        const theme = createWorkbookTheme({ typeScale: 'standard', density: 'normal' });
        const doc = createMeasurementDocument({ theme });
        const fragments = measureDocumentFragments(growable, {
          doc, theme, texToSvg, studentName: null,
        });
        const box = contentBox(theme, { gutter: true, duplex: true, pageIndex: 0 });
        const place = (growLastPage) => placeFragments(fragments, {
          pageHeightPt: box.pageHeightPt, marginPt: box.marginPt, spacing: theme.spacing, growLastPage,
        });
        const unfilled = place(false);
        const filled = place(true);
        const lastFragment = (result) => result.pages.at(-1).fragments.at(-1);

        expect(lastFragment(unfilled).heightPt).toBeCloseTo(lastFragment(unfilled).answerSpace.minPt, 1);
        expect(lastFragment(filled).heightPt).toBeCloseTo(lastFragment(filled).answerSpace.maxPt, 1);
        expect(lastFragment(filled).heightPt).toBeGreaterThan(lastFragment(unfilled).heightPt);
      });

      it('threads growLastPage: true end-to-end through RenderPrintDocument', async () => {
        const calls = [];
        const spyFactory = (opts) => {
          const instance = createDocumentPdfRenderer(opts);
          return {
            ...instance,
            render: async (source, options) => {
              calls.push(options);
              return instance.render(source, options);
            },
          };
        };
        const useCase = createRenderPrintDocument({ renderer: spyFactory });
        const result = await useCase.execute({ document: growable });
        expect(result.pageCount).toBe(1);
        expect(calls).toHaveLength(1);
        expect(calls[0].growLastPage).toBe(true);
      });
    });

    describe('policy one-page + target: [receipt] — fails at VALIDATION, never reaches render', () => {
      const raw = {
        schema: DOCUMENT_V2_SCHEMA,
        id: 'onepage-receipt',
        seed: 1,
        target: ['receipt'],
        archetype: 'worksheet',
        fit: { policy: 'one-page', typeScale: 'standard' },
        blocks: [{ type: 'rich_text', md: 'A receipt cannot be one-paged.' }],
      };

      it('validateAnyDocument reports the specific policy/target conflict', () => {
        const { errors } = validateAnyDocument(raw);
        expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/one-page.*requires letter target/)]));
      });

      it('RenderPrintDocument.execute rejects with INVALID_DOCUMENT (validation, not a fit/render failure)', async () => {
        const useCase = createRenderPrintDocument();
        await expect(useCase.execute({ document: raw })).rejects.toMatchObject({
          name: 'ValidationError', code: 'INVALID_DOCUMENT',
        });
      });

      it('the same conflict fires for fit.policy "fill" too — both letter-only fit policies', () => {
        const { errors } = validateAnyDocument({ ...raw, fit: { policy: 'fill', typeScale: 'standard' } });
        expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/fill.*requires letter target/)]));
      });
    });
  });

  describe('§12.7 targets — a letter-only block + target: [receipt] fails at VALIDATION, not render', () => {
    const raw = {
      schema: DOCUMENT_V2_SCHEMA,
      id: 'wordbank-receipt',
      seed: 1,
      target: ['receipt'],
      archetype: 'infopage',
      blocks: [{ type: 'math', tex: 'x^2 + y^2 = z^2' }],
    };

    it('BLOCK_TARGET_SUPPORT itself declares math letter-only (the matrix this check is built on)', () => {
      expect(BLOCK_TARGET_SUPPORT.math).toEqual(['letter']);
      expect(BLOCK_TARGET_SUPPORT.math).not.toContain('receipt');
    });

    it('validateAnyDocument reports the block×target conflict at a dotted path', () => {
      const { errors } = validateAnyDocument(raw);
      expect(errors).toEqual(expect.arrayContaining([
        expect.stringMatching(/blocks\[0\]: block type 'math' does not support target 'receipt'/),
      ]));
    });

    it('RenderPrintDocument.execute rejects at validation — INVALID_DOCUMENT, never attempts to measure/render', async () => {
      const useCase = createRenderPrintDocument();
      const err = await useCase.execute({ document: raw }).catch((e) => e);
      expect(err).toMatchObject({ name: 'ValidationError', code: 'INVALID_DOCUMENT' });
      expect(err.message).toMatch(/does not support target 'receipt'/);
    });
  });

  describe('§12.8 type', () => {
    it('all four font styles (regular/bold/italic/boldItalic) are embedded in the rendered PDF bytes', async () => {
      const STUB_SVG = '<svg viewBox="0 0 200 100"><rect width="200" height="80"/></svg>';
      const resolveAsset = (ref) => (ref === 'school/proof/diagram' ? { svg: STUB_SVG, widthPt: 200, heightPt: 100 } : null);
      const useCase = createRenderPrintDocument({ resolveAsset });
      // boldItalic is reached specifically via a **bold** span inside an
      // already-italic base (figure captions/credits use baseFont: 'italic' —
      // see measure.mjs's inlineRuns) — a bare rich_text **bold**/*italic* pair
      // never produces it, so the fixture needs a figure caption to exercise it.
      const document = v2doc({
        archetype: 'worksheet',
        blocks: [
          { type: 'rich_text', md: 'Mix **bold** and *italic* words.' },
          { type: 'figure', asset: 'school/proof/diagram', caption: 'See **Figure 1** for detail.' },
        ],
      });
      const result = await useCase.execute({ document });
      expect(isPdf(result.bytes)).toBe(true);
      const text = result.bytes.toString('latin1');
      for (const face of FONT_FACES) expect(text).toContain(face);
    });

    it('*italic* renders for v2 (font actually embedded) and is INERT for v1 (asterisks stay literal, no italic face)', async () => {
      const md = 'Mix **bold** and *emphasis* words.';
      const v2Result = await createRenderPrintDocument().execute({
        document: v2doc({ archetype: 'worksheet', blocks: [{ type: 'rich_text', md }] }),
      });
      expect(v2Result.bytes.toString('latin1')).toContain('AtkinsonHyperlegible-Italic');

      const v1Raw = {
        id: 'v1-italic-inert', seed: 1, variant: 0, target: ['letter'], blocks: [{ type: 'rich_text', md }],
      };
      const { document: normalized } = validateDocument(v1Raw);
      const direct = await createDocumentPdfRenderer({ texToSvg }).render(normalized, { studentName: null });
      const viaUseCase = await createRenderPrintDocument().execute({ document: v1Raw });
      expect(viaUseCase.bytes.equals(direct.pdf)).toBe(true);
      expect(viaUseCase.bytes.toString('latin1')).not.toContain('-Italic');
    });

    it('both type-scale presets AND both densities produce distinct, deterministic, snapshot-pinned output', async () => {
      const doc = {
        id: 'scale-density-fixture', title: 'Scale Density', seed: 11, variant: 0, target: ['letter'],
        blocks: [
          { type: 'rich_text', md: 'Mix **bold** and *italic* words to exercise every face.' },
          {
            type: 'question', itemId: 'q1', number: 1, blocks: [{ type: 'rich_text', md: 'Solve for x.' }, { type: 'answer_space', minPt: 40, maxPt: 40 }],
          },
        ],
      };
      const renderCombo = async (typeScale, density) => {
        const theme = createWorkbookTheme({ typeScale, density });
        const renderer = createDocumentPdfRenderer({ theme, texToSvg });
        const { pdf } = await renderer.render(doc, { studentName: 'Learner', italic: true });
        return pdf;
      };

      const combos = {};
      for (const typeScale of ['standard', 'young']) {
        for (const density of ['normal', 'compact']) {
          // eslint-disable-next-line no-await-in-loop
          combos[`${typeScale}-${density}`] = await renderCombo(typeScale, density);
        }
      }

      const hashes = Object.fromEntries(Object.entries(combos).map(([key, pdf]) => [key, sha256(pdf)]));
      // Pairwise distinct: 4 combos, 4 distinct hashes — no pair collapses.
      expect(new Set(Object.values(hashes)).size).toBe(4);
      // Pinned so a future accidental collapse (e.g. density stops affecting
      // spacing) shows up as a snapshot diff, not just a passing "size === 4".
      expect(hashes).toMatchSnapshot();
    });
  });

  describe('§12.10-A archetype dial — envelope-only difference (Phase A scope; visible score box is Phase B)', () => {
    const sameBody = () => manyQuestions(10, 'aq');

    it('header.scoreBox differs true/false PURELY from archetype — same body, same everything else', () => {
      const { document: quiz } = validateAnyDocument(v2doc({ archetype: 'quiz', blocks: sameBody() }));
      const { document: worksheet } = validateAnyDocument(v2doc({ archetype: 'worksheet', blocks: sameBody() }));
      expect(quiz.header).toEqual({ name: true, date: true, scoreBox: true });
      expect(worksheet.header).toEqual({ name: true, date: true, scoreBox: false });
      // Every other header field is IDENTICAL — scoreBox is the only divergence.
      expect({ ...quiz.header, scoreBox: null }).toEqual({ ...worksheet.header, scoreBox: null });
    });

    it('the SAME body renders to different bytes for quiz vs worksheet, purely from the archetype field (duplex threading)', async () => {
      const quizResult = await createRenderPrintDocument().execute({
        document: v2doc({ archetype: 'quiz', fit: { policy: 'flow', typeScale: 'standard' }, blocks: sameBody() }),
      });
      const worksheetResult = await createRenderPrintDocument().execute({
        document: v2doc({ archetype: 'worksheet', fit: { policy: 'flow', typeScale: 'standard' }, blocks: sameBody() }),
      });
      expect(quizResult.pageCount).toBeGreaterThanOrEqual(2);
      expect(worksheetResult.pageCount).toBeGreaterThanOrEqual(2);
      expect(quizResult.bytes.equals(worksheetResult.bytes)).toBe(false);

      // "Snapshot both" — pinned so a future change that accidentally collapses
      // the archetype-driven duplex difference shows up as a snapshot diff.
      expect({
        quiz: { pageCount: quizResult.pageCount, hash: sha256(quizResult.bytes) },
        worksheet: { pageCount: worksheetResult.pageCount, hash: sha256(worksheetResult.bytes) },
      }).toMatchSnapshot();
    });
  });

  describe('visual proof — every new block type + furniture, both type scales (CARRY: Task 5 self-review flagged no visual verification)', () => {
    const STUB_SVG = '<svg viewBox="0 0 200 100"><rect x="0" y="0" width="200" height="80" fill="#000"/></svg>';
    const resolveAsset = (ref) => (ref === 'school/proof/diagram' ? { svg: STUB_SVG, widthPt: 200, heightPt: 100 } : null);

    const proofQuestion = (n) => ({
      type: 'question',
      itemId: `pq${n}`,
      number: n,
      blocks: [
        { type: 'rich_text', md: `Problem ${n}. Solve and show your work.` },
        { type: 'answer_space', minPt: 30, maxPt: 30 },
      ],
    });

    /** Exercises all seven Task-4/5 block types plus furniture, padded to 3 pages. */
    const proofBlocks = () => [
      {
        type: 'passage',
        mode: 'reprint',
        lineNumbers: true,
        source: { title: 'A Field Guide to Rivers', author: 'J. Rivers', locator: 'p. 12' },
        text: 'The river began as a trickle far up the mountainside, gathering strength from every rivulet it passed. By the time it reached the valley floor it had become a broad, unhurried current, carrying silt and story alike toward the sea. Fishermen along its banks spoke of it the way one speaks of an old friend: familiar, a little unpredictable, always worth watching.',
      },
      {
        type: 'figure', asset: 'school/proof/diagram', caption: 'See **Figure 1** for the full diagram.', credit: 'Diagram: *Proof Suite*',
      },
      {
        type: 'inset',
        title: 'Remember',
        blocks: [{ type: 'list', style: 'checklist', items: ['Read the passage carefully', 'Label the diagram', 'Show your work'] }],
      },
      { type: 'list', style: 'numbered', items: ['Identify the source', 'Trace the tributaries', 'Mark the delta'] },
      { type: 'divider' },
      { type: 'spacer', minPt: 30, maxPt: 60 },
      { type: 'page_break' },
      { type: 'rich_text', md: 'Mix **bold** and *italic* words in the second half of the proof document.' },
      ...Array.from({ length: 10 }, (_, i) => proofQuestion(i + 1)),
    ];

    async function renderProof(typeScale) {
      const useCase = createRenderPrintDocument({ resolveAsset });
      const document = {
        schema: DOCUMENT_V2_SCHEMA,
        id: 'phase-a-proof',
        seed: 42,
        target: ['letter'],
        archetype: 'worksheet',
        fit: { policy: 'flow', typeScale },
        blocks: proofBlocks(),
      };
      return useCase.execute({ document, context: { learnerName: 'Proof Learner', date: '2026-08-04' } });
    }

    let standardResult;
    let youngResult;
    let standardPages;
    let youngPages;

    beforeAll(async () => {
      requirePdftoppm();
      standardResult = await renderProof('standard');
      youngResult = await renderProof('young');
      standardPages = rasterizePdfPages(standardResult.bytes, { dpi: 150, name: 'phaseA-proof-standard' });
      youngPages = rasterizePdfPages(youngResult.bytes, { dpi: 150, name: 'phaseA-proof-young' });

      // Commit the full PDFs + every rasterized page as reviewable evidence.
      // Content is fully deterministic (pinned CreationDate, no randomness),
      // so re-running this suite writes byte-identical files — no spurious
      // `git status` churn on a clean tree.
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'proof-standard.pdf'), standardResult.bytes);
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'proof-young.pdf'), youngResult.bytes);
      standardPages.forEach((png, i) => {
        // p02 is handled separately below — it is the ONE pinned regression
        // gate, and must be compared against the git-committed file BEFORE
        // (potentially) being overwritten, never blindly rewritten here.
        if (i === 1) return;
        fs.writeFileSync(path.join(EVIDENCE_DIR, `proof-standard-p${String(i + 1).padStart(2, '0')}.png`), png);
      });
      youngPages.forEach((png, i) => {
        fs.writeFileSync(path.join(EVIDENCE_DIR, `proof-young-p${String(i + 1).padStart(2, '0')}.png`), png);
      });
    }, 60000);

    it('renders 3 pages at both type-scale presets', () => {
      expect(standardResult.pageCount).toBe(3);
      expect(youngResult.pageCount).toBe(3);
      expect(standardPages).toHaveLength(3);
      expect(youngPages).toHaveLength(3);
    });

    it('all four embedded font faces appear in both renders', () => {
      for (const bytes of [standardResult.bytes, youngResult.bytes]) {
        const text = bytes.toString('latin1');
        for (const face of FONT_FACES) expect(text).toContain(face);
      }
    });

    it('the two type scales produce different bytes (young really does print larger)', () => {
      expect(standardResult.bytes.equals(youngResult.bytes)).toBe(false);
    });

    it('page 2 (duplex gutter + bold/italic prose) matches the committed visual snapshot', async () => {
      const snapshotPath = path.join(EVIDENCE_DIR, 'proof-standard-p02.png');
      const rendered = standardPages[1];

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
      expect(ratio, `page 2 differs from the committed visual snapshot by ${(ratio * 100).toFixed(3)}%`).toBeLessThanOrEqual(PROOF_MAX_DIFF_RATIO);
    }, 30000);
  });
});
