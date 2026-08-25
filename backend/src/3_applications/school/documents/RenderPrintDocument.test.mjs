/**
 * RenderPrintDocument — the v2 print pipeline assembled (spec §3 governing
 * idea 1, §7 fit orchestration). Real rendering throughout (no stubbed
 * texToSvg/theme): this is the integration point where validation, fit,
 * furniture and the PDF renderer all have to actually agree.
 */
import { describe, it, expect } from 'vitest';
import { RenderPrintDocument } from './RenderPrintDocument.mjs';
import { validateDocument } from '#domains/school/documents/documentValidation.mjs';
import { DOCUMENT_V2_SCHEMA } from '#domains/school/documents/documentV2.mjs';
import { DOCUMENT_SOURCE_SCHEMA } from '#domains/school/documents/documentSource.mjs';
import { deriveShuffle, applyShuffle } from '#domains/school/documents/shuffle.mjs';
import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import { createMeasurementDocument, measureDocumentFragments } from '#rendering/school/documents/measure.mjs';
import { placeFragments } from '#rendering/school/documents/layout.mjs';
import { contentBox } from '#rendering/school/documents/furniture.mjs';
import { texToSvg } from '#rendering/school/documents/mathSvg.mjs';
import { pdfText, pdfTextItems } from '../../../../../tests/_lib/school/pdfText.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';

const isPdf = (bytes) => Buffer.isBuffer(bytes) && bytes.subarray(0, 5).toString('latin1') === '%PDF-';

/** A single question: short stem + fixed-size answer space (no growth ambiguity). */
const question = (n) => ({
  type: 'question',
  itemId: `q${n}`,
  number: n,
  blocks: [
    { type: 'rich_text', md: `Problem ${n}. Solve and show your work.` },
    { type: 'answer_space', minPt: 30, maxPt: 30 },
  ],
});

/** v2 envelope builder. `archetype: 'quiz'` (simplex) unless overridden. */
const v2doc = (over = {}) => ({
  schema: DOCUMENT_V2_SCHEMA,
  id: 'v2-fixture',
  seed: 7,
  target: ['letter'],
  archetype: 'quiz',
  blocks: [question(1)],
  ...over,
});

/** v1 (schema-less) envelope builder. */
const v1doc = (over = {}) => ({
  id: 'v1-fixture',
  title: 'V1 Fixture',
  seed: 4242,
  variant: 0,
  target: ['letter'],
  blocks: [
    { type: 'rich_text', md: 'A plain legacy worksheet.' },
    { type: 'question', itemId: 'w1', number: 1, blocks: [{ type: 'answer_space', minPt: 40, maxPt: 90 }] },
  ],
  ...over,
});

// Empirically derived against the real measurement pipeline (quiz archetype:
// gutter reserved, duplex false — see `contentBox`/`furniture.mjs`), each
// question a fixed 30/30pt answer space so density is the ONLY variable:
//  9 questions: fits at normal.
// 10 questions: overflows normal (2 pages), fits at compact (1 page).
// 12 questions: overflows BOTH densities.
const manyQuestions = (n) => Array.from({ length: n }, (_, i) => question(i + 1));

describe('RenderPrintDocument — v2 basic render (a)', () => {
  it('renders a real v2 worksheet PDF; two runs are byte-identical', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({ archetype: 'worksheet', blocks: manyQuestions(2) });

    const first = await useCase.execute({ document, context: { learnerName: 'Alex' } });
    expect(isPdf(first.bytes)).toBe(true);
    expect(first.pageCount).toBe(1);
    expect(first.density).toBe('normal');
    expect(first.warnings).toEqual([]);

    const second = await useCase.execute({ document, context: { learnerName: 'Alex' } });
    expect(first.bytes.equals(second.bytes)).toBe(true);
  });
});

describe('RenderPrintDocument — fit policy one-page (b)', () => {
  // `header.scoreBox: false` keeps this describe block's empirically-derived
  // page-count calibration (see the comment above `manyQuestions`) exactly
  // what it was before Task 5 threaded `totalPoints` into the header — this
  // block's whole point is the FIT/density fallback machinery, not the score
  // box, which has its own coverage (`totalPoints threading` describe below).
  const oneShot = (n) => v2doc({
    archetype: 'quiz', header: { scoreBox: false }, fit: { policy: 'one-page', typeScale: 'standard' }, blocks: manyQuestions(n),
  });

  it('fits at normal density: density "normal", warns only about the missing card allocation (spec §5.3, Task 5)', async () => {
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document: oneShot(9) });
    expect(result.pageCount).toBe(1);
    expect(result.density).toBe('normal');
    expect(result.warnings).toEqual([expect.stringMatching(/rendered without card allocation/)]);
  });

  it('a padded fixture (overflows normal) falls back to compact density', async () => {
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document: oneShot(10) });
    expect(result.pageCount).toBe(1);
    expect(result.density).toBe('compact');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('an overlong fixture (overflows both densities) rejects with structured FIT_OVERSET', async () => {
    const useCase = new RenderPrintDocument();
    await expect(useCase.execute({ document: oneShot(12) })).rejects.toMatchObject({
      name: 'ValidationError',
      code: 'FIT_OVERSET',
      details: expect.objectContaining({ oversetPt: expect.any(Number), documentId: 'v2-fixture' }),
    });
    const err = await useCase.execute({ document: oneShot(12) }).catch((e) => e);
    expect(err.details.oversetPt).toBeGreaterThan(0);
  });
});

// `prefer-one-page` (household rule: "we can only use two pages if we have an
// exceptionally long number of questions ... within each page there should
// be right sizing"): try normal, then compact, then SPILL rather than
// rejecting — the one difference from `one-page` above, which hard-fails
// instead of spilling. Reuses `one-page`'s own empirically-calibrated fixture
// sizes (9/10/12 questions — see that describe block's comment) so the three
// outcomes below are apples-to-apples with `one-page`'s.
describe('RenderPrintDocument — fit policy prefer-one-page', () => {
  const preferOneShot = (n) => v2doc({
    archetype: 'quiz', header: { scoreBox: false }, fit: { policy: 'prefer-one-page', typeScale: 'standard' }, blocks: manyQuestions(n),
  });

  it('outcome 1 — fits at normal density: density "normal", pageCount 1', async () => {
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document: preferOneShot(9) });
    expect(result.pageCount).toBe(1);
    expect(result.density).toBe('normal');
  });

  it('outcome 2 — fits only at compact density: falls back to compact, still one page', async () => {
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document: preferOneShot(10) });
    expect(result.pageCount).toBe(1);
    expect(result.density).toBe('compact');
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/required compact density to fit .* on one page/),
    ]));
  });

  it('outcome 3 — fits at neither: SPILLS at compact density instead of throwing (the one-page/prefer-one-page divergence)', async () => {
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document: preferOneShot(12) });
    expect(result.pageCount).toBeGreaterThan(1);
    expect(result.density).toBe('compact');
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/could not fit .* on one page even at compact density; spilled to \d+ pages/),
    ]));
  });

  // Regression coverage for a real disagreement found while verifying this
  // policy against actual atlas-course content: `#measureAttempt` (the fit
  // loop's TRIAL) never threads `bank` through to `resolveChoices`, so any
  // `omr_response` block is measured in measure.mjs's own "probe mode" — a
  // conservative reservation, not the real choice text's real width. That can
  // make the trial predict MORE pages than the real (bank-aware) final render
  // actually produces. The spill warning must report what was ACTUALLY
  // printed, not the trial's pessimistic guess — this asserts that
  // self-consistency directly, on a real OMR/bank-backed document, rather
  // than trusting a hardcoded page-count number that would drift with any
  // measurement-fidelity change.
  it('outcome 3 with OMR content: the spill warning\'s page count always matches result.pageCount, even when the trial disagreed with the real render', async () => {
    const omrQuestion = (n) => ({
      type: 'question',
      itemId: `oq${n}`,
      number: n,
      blocks: [
        { type: 'rich_text', md: `Which of these best answers overlong prompt number ${n}, spanning enough words to wrap onto more than one line at either density?` },
        { type: 'omr_response', itemId: `oq${n}`, choices: 5 },
      ],
      choices: ['Alpha option', 'Beta option', 'Gamma option', 'Delta option', 'Epsilon option'],
      answer: 'Alpha option',
    });
    const document = {
      schema: DOCUMENT_SOURCE_SCHEMA,
      id: 'prefer-one-page-omr-fixture',
      seed: 4242,
      variant: 0,
      target: ['letter'],
      archetype: 'worksheet',
      fit: { policy: 'prefer-one-page', typeScale: 'standard' },
      title: 'OMR overflow fixture',
      blocks: Array.from({ length: 16 }, (_, i) => omrQuestion(i + 1)),
    };
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document });

    expect(result.pageCount).toBeGreaterThan(1); // confirms this fixture actually exercises the spill path
    const spillWarning = result.warnings.find((w) => w.includes('spilled to'));
    expect(spillWarning).toBeDefined();
    expect(spillWarning).toContain(`spilled to ${result.pageCount} pages`);
  });
});

describe('RenderPrintDocument — fit policy fill bottoms out the last page (c)', () => {
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

  /** Wraps the real renderer factory, recording every `.render()` call's options. */
  function spyRendererFactory() {
    const calls = [];
    const factory = (opts) => {
      const instance = createDocumentPdfRenderer(opts);
      return {
        ...instance,
        render: async (source, options) => {
          calls.push({ opts, options });
          return instance.render(source, options);
        },
      };
    };
    factory.calls = calls;
    return factory;
  }

  it('threads growLastPage: true into the final render for fit.policy "fill"', async () => {
    const renderer = spyRendererFactory();
    const useCase = new RenderPrintDocument({ renderer });
    const result = await useCase.execute({ document: growable });

    expect(result.pageCount).toBe(1);
    expect(renderer.calls).toHaveLength(1);
    expect(renderer.calls[0].options.growLastPage).toBe(true);
  });

  it('growLastPage: true measurably grows the last page’s answer space to its cap — the layout result, not a pixel diff', () => {
    // Same real pipeline RenderPrintDocument itself calls, exercised directly
    // to prove what the threaded flag actually does to placement.
    const theme = createWorkbookTheme({ typeScale: 'standard', density: 'normal' });
    const doc = createMeasurementDocument({ theme });
    const fragments = measureDocumentFragments(growable, { doc, theme, texToSvg, studentName: null });
    const box = contentBox(theme, { gutter: true, duplex: true, pageIndex: 0 });
    const place = (growLastPage) => placeFragments(fragments, {
      pageHeightPt: box.pageHeightPt, marginPt: box.marginPt, spacing: theme.spacing, growLastPage,
    });

    const unfilled = place(false);
    const filled = place(true);
    const lastFragment = (result) => result.pages.at(-1).fragments.at(-1);

    // `placeFragments` grows the FRAGMENT's heightPt (per-node redistribution
    // — `applyAnswerSpaceGrowth` — happens later, at draw time); the
    // fragment-level number is the "layout result" this flag controls.
    expect(lastFragment(unfilled).heightPt).toBeLessThan(lastFragment(filled).heightPt);
    // Grown all the way to the fragment's own answerSpace cap (comfortably
    // inside the ~638-648pt page budget), not just "a little bigger".
    expect(lastFragment(filled).heightPt).toBeCloseTo(lastFragment(filled).answerSpace.maxPt, 1);
    expect(lastFragment(unfilled).heightPt).toBeCloseTo(lastFragment(unfilled).answerSpace.minPt, 1);
  });

  it('threads balance: true into the final render for fit.policy "fill"', async () => {
    const renderer = spyRendererFactory();
    const useCase = new RenderPrintDocument({ renderer });
    await useCase.execute({ document: growable });

    expect(renderer.calls).toHaveLength(1);
    expect(renderer.calls[0].options.balance).toBe(true);
  });

  it('a non-fill policy threads balance: false', async () => {
    const renderer = spyRendererFactory();
    const useCase = new RenderPrintDocument({ renderer });
    await useCase.execute({
      document: v2doc({ archetype: 'worksheet', fit: { policy: 'flow', typeScale: 'standard' } }),
    });

    expect(renderer.calls[0].options.balance).toBe(false);
    expect(renderer.calls[0].options.growLastPage).toBe(false);
  });

  it('balance: true measurably evens out a two-page document instead of overpacking page 1', () => {
    // Same real pipeline RenderPrintDocument calls, exercised directly so the
    // page split is inspectable — a rendered PDF only tells you the page
    // COUNT, which is precisely what balancing leaves alone.
    const many = v2doc({
      archetype: 'worksheet',
      fit: { policy: 'fill', typeScale: 'standard' },
      blocks: Array.from({ length: 10 }, (_, i) => ({
        type: 'question',
        itemId: `b${i + 1}`,
        number: i + 1,
        blocks: [
          { type: 'rich_text', md: `Question ${i + 1}. Explain your reasoning.` },
          { type: 'answer_space', minPt: 60, maxPt: 90 },
        ],
      })),
    });
    const theme = createWorkbookTheme({ typeScale: 'standard', density: 'normal' });
    const doc = createMeasurementDocument({ theme });
    const fragments = measureDocumentFragments(many, { doc, theme, texToSvg, studentName: null });
    const box = contentBox(theme, { gutter: true, duplex: true, pageIndex: 0 });
    const place = (balance) => placeFragments(fragments, {
      pageHeightPt: box.pageHeightPt,
      marginPt: box.marginPt,
      spacing: theme.spacing,
      growLastPage: true,
      balance,
      maxFillAfterPt: theme.pagination.maxFillGrowthPt,
    });

    const greedy = place(false);
    const balanced = place(true);
    const sizes = (result) => result.pages.map((page) => page.fragments.length);
    const spread = (result) => Math.max(...sizes(result)) - Math.min(...sizes(result));

    // Same pagination, better distribution — the whole contract of `balance`.
    expect(balanced.pages).toHaveLength(greedy.pages.length);
    expect(greedy.pages.length).toBeGreaterThan(1);
    expect(spread(balanced)).toBeLessThan(spread(greedy));
    expect(balanced.errors).toEqual([]);
  });
});

// F4 (review finding): a standalone short_answer/essay prompt must never
// strand on one page while its own write-space fragment lands on the next.
// Same real pipeline the tests above already exercise directly
// (measureDocumentFragments + placeFragments), swept across filler sizes
// that straddle the page-1 boundary so this isn't pinned to one hand-tuned
// number — before the fix, SOME sweep step would land the prompt on page N
// and the space on page N+1.
describe('RenderPrintDocument — short_answer keep-with-next at a page boundary (F4)', () => {
  it('the prompt and its write space always land on the same page, across a sweep of filler sizes', () => {
    const theme = createWorkbookTheme({ typeScale: 'standard', density: 'normal' });
    const box = contentBox(theme, { gutter: true, duplex: false, pageIndex: 0 });
    const usablePt = box.pageHeightPt - 2 * box.marginPt;

    const buildDoc = (fillerPt) => ({
      schema: DOCUMENT_V2_SCHEMA,
      id: 'keep-with-next-fixture',
      seed: 1,
      variant: 0,
      target: ['letter'],
      archetype: 'worksheet',
      fit: { policy: 'flow', typeScale: 'standard' },
      blocks: [
        { type: 'spacer', minPt: fillerPt, maxPt: fillerPt },
        { type: 'short_answer', prompt: 'Name a state capital.', lines: 8 },
      ],
    });

    const place = (fillerPt) => {
      const measurementDoc = createMeasurementDocument({ theme });
      const fragments = measureDocumentFragments(buildDoc(fillerPt), { doc: measurementDoc, theme, texToSvg });
      return placeFragments(fragments, { pageHeightPt: box.pageHeightPt, marginPt: box.marginPt, spacing: theme.spacing });
    };

    for (let fillerPt = 0; fillerPt < usablePt; fillerPt += 25) {
      const { pages, errors } = place(fillerPt);
      expect(errors).toEqual([]);
      const pageOf = (id) => pages.findIndex((p) => p.fragments.some((f) => f.id === id));
      const promptPage = pageOf('blocks[1]#p0');
      const spacePage = pageOf('blocks[1]#p1');
      expect(promptPage).toBeGreaterThanOrEqual(0);
      expect(spacePage).toBe(promptPage);
    }
  });
});

describe('RenderPrintDocument — v1 legacy passthrough (d)', () => {
  it('is byte-identical to calling the legacy renderer directly', async () => {
    const useCase = new RenderPrintDocument();
    const raw = v1doc();

    const { document: normalized } = validateDocument(raw);
    const directRenderer = createDocumentPdfRenderer({ texToSvg });
    const direct = await directRenderer.render(normalized, { studentName: 'Sam' });

    const viaUseCase = await useCase.execute({ document: raw, context: { learnerName: 'Sam' } });

    expect(viaUseCase.bytes.equals(direct.pdf)).toBe(true);
    expect(viaUseCase.pageCount).toBe(direct.pageCount);
    expect(viaUseCase.density).toBeNull();
    expect(viaUseCase.warnings).toEqual([]);
  });

  it('ignores context.date on the legacy path — that option does not exist before this use case', async () => {
    const useCase = new RenderPrintDocument();
    const raw = v1doc();
    const withoutDate = await useCase.execute({ document: raw, context: { learnerName: 'Sam' } });
    const withDate = await useCase.execute({ document: raw, context: { learnerName: 'Sam', date: '2026-08-04' } });
    expect(withoutDate.bytes.equals(withDate.bytes)).toBe(true);
  });

  it('never opts into *italic* on the legacy path — a v1 document with the same markdown is byte-identical to calling the renderer directly (no italic option)', async () => {
    const useCase = new RenderPrintDocument();
    const raw = v1doc({ blocks: [{ type: 'rich_text', md: 'Mix **bold** and *emphasis* words.' }] });

    const { document: normalized } = validateDocument(raw);
    const direct = await createDocumentPdfRenderer({ texToSvg }).render(normalized, { studentName: null });
    const viaUseCase = await useCase.execute({ document: raw });

    expect(viaUseCase.bytes.equals(direct.pdf)).toBe(true);
    // And *emphasis* really did stay literal — no italic FACE got embedded.
    // (Every embedded font descriptor carries a generic `/ItalicAngle 0`
    // field regardless of style, so the check is specifically for an
    // italic PostScript name, e.g. `...-Italic`, not the substring 'Italic'.)
    expect(viaUseCase.bytes.toString('latin1')).not.toContain('-Italic');
  });
});

describe('RenderPrintDocument — *italic* grammar reaches v2 (spec §12.8)', () => {
  it('measurement and the final render agree: an italic run is actually embedded for a v2 document', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({
      archetype: 'worksheet',
      blocks: [{ type: 'rich_text', md: 'Mix **bold** and *emphasis* words.' }],
    });

    const result = await useCase.execute({ document });
    expect(isPdf(result.bytes)).toBe(true);
    expect(result.bytes.toString('latin1')).toContain('AtkinsonHyperlegible-Italic');
  });

  it('the measured run itself carries the italic font tag — proves measurement (not just the draw pass) opted in', () => {
    const theme = createWorkbookTheme();
    const doc = createMeasurementDocument({ theme });
    const document = v2doc({ blocks: [{ type: 'rich_text', md: 'An *emphasis* word.' }] });
    const fragments = measureDocumentFragments(document, { doc, theme, texToSvg, italic: true });
    const italicRun = fragments.flatMap((f) => f.lines ?? []).flatMap((l) => l.runs).find((r) => r.font === 'italic');
    expect(italicRun).toBeDefined();
    expect(italicRun.text).toBe('emphasis');
  });
});

describe('RenderPrintDocument — name/date prefill (e)', () => {
  it('changes the rendered bytes when learnerName/date are supplied (v2)', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({ archetype: 'worksheet' });

    const blank = await useCase.execute({ document });
    const filled = await useCase.execute({ document, context: { learnerName: 'Riley', date: '2026-08-04' } });

    expect(isPdf(blank.bytes)).toBe(true);
    expect(isPdf(filled.bytes)).toBe(true);
    expect(blank.bytes.equals(filled.bytes)).toBe(false);
  });
});

describe('RenderPrintDocument — v2 header fields wired (F3)', () => {
  it('infopage preset omits Name/Date from the printed header', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({ archetype: 'infopage', blocks: [{ type: 'rich_text', md: 'Some teaching prose.' }] });
    const result = await useCase.execute({ document });
    const text = pdfText(result.bytes);
    expect(text).not.toMatch(/Name:/);
    expect(text).not.toMatch(/Date:/);
  });

  it('quiz/worksheet presets are unaffected — Name/Date still print', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({ archetype: 'worksheet' });
    const result = await useCase.execute({ document });
    const text = pdfText(result.bytes);
    expect(text).toMatch(/Name:/);
    expect(text).toMatch(/Date:/);
  });

  it('header.instructions prints (under the title) when set', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({ archetype: 'quiz', header: { instructions: 'Mark answers on your bubble card.' } });
    const result = await useCase.execute({ document });
    const text = pdfText(result.bytes);
    expect(text).toContain('Mark answers on your bubble card.');
  });

  it('header.instructions is absent by default (no archetype sets it)', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({ archetype: 'quiz' });
    const result = await useCase.execute({ document });
    const text = pdfText(result.bytes);
    expect(text).not.toContain('bubble card');
  });

  it('explicit header.name/header.date:false override the archetype preset even on a quiz', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({ archetype: 'quiz', header: { name: false, date: false } });
    const result = await useCase.execute({ document });
    const text = pdfText(result.bytes);
    expect(text).not.toMatch(/Name:/);
    expect(text).not.toMatch(/Date:/);
  });

  it('v1 legacy documents keep the unconditional Name/Date banner — no `.header` field exists on v1', async () => {
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document: v1doc() });
    const text = pdfText(result.bytes);
    expect(text).toMatch(/Name:/);
    expect(text).toMatch(/Date:/);
  });
});

describe('RenderPrintDocument — gutter threads into body measurement AND drawing (F2)', () => {
  // `worksheet` is the one archetype whose furniture opts into `duplex`
  // (RenderPrintDocument's DUPLEX_ARCHETYPES) — the side the gutter reserves
  // room on FLIPS by page parity, which is exactly the case that would catch
  // body text still drawn at the plain, un-offset page margin.
  const document = v2doc({
    archetype: 'worksheet',
    fit: { policy: 'flow', typeScale: 'standard' },
    blocks: [
      { type: 'rich_text', md: 'BodyMarkerPageOne is the first word measured on page one.' },
      { type: 'page_break' },
      { type: 'rich_text', md: 'BodyMarkerPageTwo is the first word measured on page two.' },
    ],
  });

  it('body text\'s left edge equals furniture\'s content-box left edge, and flips under duplex', async () => {
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document, context: { learnerName: 'Riley' } });
    expect(result.pageCount).toBe(2);

    // Same theme the pipeline actually chose (flow policy → always 'normal'
    // density; default typeScale 'standard') — computed independently here,
    // not read back off the render, so this is a real expectation, not a
    // tautology.
    const theme = createWorkbookTheme({ typeScale: 'standard', density: 'normal' });
    const page1Box = contentBox(theme, { gutter: true, duplex: true, pageIndex: 0 }); // recto
    const page2Box = contentBox(theme, { gutter: true, duplex: true, pageIndex: 1 }); // verso
    // The whole point of "duplex flips the gutter side": the two pages must
    // NOT share a left edge, or this test would pass vacuously.
    expect(page1Box.xPt).not.toBe(page2Box.xPt);

    const items = await pdfTextItems(result.bytes);
    const firstWordOn = (page, str) => items.find((item) => item.page === page && item.str === str);

    const page1Body = firstWordOn(1, 'BodyMarkerPageOne');
    const page2Body = firstWordOn(2, 'BodyMarkerPageTwo');
    expect(page1Body, 'page 1 body marker word').toBeDefined();
    expect(page2Body, 'page 2 body marker word').toBeDefined();

    expect(page1Body.xPt).toBeCloseTo(page1Box.xPt, 1);
    expect(page2Body.xPt).toBeCloseTo(page2Box.xPt, 1);

    // Furniture's own painted output has to track the SAME flip the body did
    // — not just two body numbers that happen to match contentBox in
    // isolation. The footer band is now the only painted furniture, and it is
    // CENTRED in the content box, so its run's left edge is offset from
    // box.xPt by half the leftover width; that offset is identical on both
    // pages (contentBox gives both sides the same widthPt), so the difference
    // between the two footers' x positions is exactly the gutter shift the
    // body text saw.
    const footer1 = firstWordOn(1, 'Page 1 of 2');
    const footer2 = firstWordOn(2, 'Page 2 of 2');
    expect(footer1, 'page 1 footer').toBeDefined();
    expect(footer2, 'page 2 footer').toBeDefined();
    const bodyShiftPt = page1Body.xPt - page2Body.xPt;
    expect(bodyShiftPt).toBeCloseTo(theme.furniture.gutterPt, 1); // guards against a vacuous 0-shift
    // Glyph-advance differences between "1" and "2" move a centred run by a
    // fraction of a point; the gutter shift is 18pt, so 2pt of slack cannot
    // let a non-flipping footer through.
    expect(Math.abs((footer1.xPt - footer2.xPt) - bodyShiftPt)).toBeLessThan(2);
  });

  // The render's own duplex decision has to leave the use case, or the print
  // job falls back to a global adapter default that never looked at the
  // document — and a fixed-gutter document printed double-sided puts facing
  // pages' punch margins on opposite edges of ONE sheet.
  it('reports duplex: true for a worksheet, whose gutter mirrors by page parity', async () => {
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document, context: { learnerName: 'Riley' } });
    expect(result.duplex).toBe(true);
  });

  it('reports duplex: false for every archetype whose gutter is fixed to the left', async () => {
    const useCase = new RenderPrintDocument();
    for (const archetype of ['quiz', 'infopage']) {
      // eslint-disable-next-line no-await-in-loop
      const result = await useCase.execute({
        document: v2doc({
          archetype,
          fit: { policy: 'flow', typeScale: 'standard' },
          blocks: [
            { type: 'rich_text', md: 'Page one body.' },
            { type: 'page_break' },
            { type: 'rich_text', md: 'Page two body.' },
          ],
        }),
      });
      expect(result.pageCount, `${archetype} page count`).toBe(2);
      expect(result.duplex, `${archetype} duplex`).toBe(false);
    }
  });

  it('reports duplex: null on the v1 legacy path, which draws no gutter at all', async () => {
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document: v1doc() });
    // Null, not false: v1 has no decision to express, so the caller leaves the
    // printer on its configured default rather than inventing one.
    expect(result.duplex).toBe(null);
  });

  it('a non-card render keeps the plain "Page X of Y" footer — no card number, no separator', async () => {
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document, context: { learnerName: 'Riley' } });
    const text = pdfText(result.bytes);
    expect(text).toContain('Page 1 of 2');
    expect(text).toContain('Page 2 of 2');
    expect(text).not.toContain('·');
  });

  it('a non-duplex archetype (quiz) keeps the gutter on the SAME side across pages, and body still matches it', async () => {
    const quizDoc = v2doc({
      archetype: 'quiz',
      fit: { policy: 'flow', typeScale: 'standard' },
      blocks: document.blocks,
    });
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document: quizDoc });
    expect(result.pageCount).toBe(2);

    const theme = createWorkbookTheme({ typeScale: 'standard', density: 'normal' });
    const box = contentBox(theme, { gutter: true, duplex: false, pageIndex: 0 });

    const items = await pdfTextItems(result.bytes);
    const page1Body = items.find((item) => item.page === 1 && item.str === 'BodyMarkerPageOne');
    const page2Body = items.find((item) => item.page === 2 && item.str === 'BodyMarkerPageTwo');
    expect(page1Body.xPt).toBeCloseTo(box.xPt, 1);
    expect(page2Body.xPt).toBeCloseTo(box.xPt, 1);
  });

  it('context.gutter: 0 leaves body text at the plain page margin, matching furniture with gutter off', async () => {
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document, context: { gutter: 0 } });

    const theme = createWorkbookTheme({ typeScale: 'standard', density: 'normal' });
    const box = contentBox(theme, { gutter: 0, duplex: true, pageIndex: 0 });
    expect(box.xPt).toBe(theme.page.marginPt); // no gutter reserved at all

    const items = await pdfTextItems(result.bytes);
    const page1Body = items.find((item) => item.page === 1 && item.str === 'BodyMarkerPageOne');
    expect(page1Body.xPt).toBeCloseTo(theme.page.marginPt, 1);
  });
});

describe('RenderPrintDocument — repository-based lookup', () => {
  it('resolves execute({id}) through the injected repository', async () => {
    const raw = v1doc({ id: 'looked-up' });
    const repository = { get: async (id) => (id === 'looked-up' ? raw : null) };
    const useCase = new RenderPrintDocument({ repository });
    const result = await useCase.execute({ id: 'looked-up' });
    expect(isPdf(result.bytes)).toBe(true);
  });

  it('rejects a missing id with a structured DOCUMENT_NOT_FOUND error', async () => {
    const repository = { get: async () => null };
    const useCase = new RenderPrintDocument({ repository });
    await expect(useCase.execute({ id: 'ghost' })).rejects.toMatchObject({
      name: 'ValidationError', code: 'DOCUMENT_NOT_FOUND',
    });
  });

  it('rejects execute({id}) with no repository configured', async () => {
    const useCase = new RenderPrintDocument();
    await expect(useCase.execute({ id: 'anything' })).rejects.toMatchObject({
      name: 'ValidationError', code: 'MISSING_REPOSITORY',
    });
  });

  it('rejects execute({}) — neither document nor id', async () => {
    const useCase = new RenderPrintDocument();
    await expect(useCase.execute({})).rejects.toMatchObject({
      name: 'ValidationError', code: 'MISSING_DOCUMENT',
    });
  });
});

describe('RenderPrintDocument — v2 target receipt-only render warning (F6)', () => {
  it('warns that a receipt-only v2 document was rendered as a Letter PDF (v2 has no receipt path yet, Phase A)', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({
      target: ['receipt'],
      archetype: 'worksheet',
      blocks: [{ type: 'rich_text', md: 'Receipt-only v2 fixture.' }],
    });
    const result = await useCase.execute({ document });
    expect(isPdf(result.bytes)).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/target: \['receipt'\].*rendered as a Letter PDF, not a receipt/),
    ]));
  });

  it('does not warn when target includes letter (even alongside receipt)', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({
      target: ['letter', 'receipt'],
      archetype: 'worksheet',
      blocks: [{ type: 'rich_text', md: 'Both-targets fixture.' }],
    });
    const result = await useCase.execute({ document });
    expect(result.warnings).toEqual([]);
  });

  it('a letter-only v2 document (the common case) never carries this warning', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({ archetype: 'worksheet' });
    const result = await useCase.execute({ document });
    expect(result.warnings).toEqual([]);
  });
});

describe('RenderPrintDocument — invalid documents', () => {
  it('rejects a structurally invalid document with a structured INVALID_DOCUMENT error', async () => {
    const useCase = new RenderPrintDocument();
    await expect(useCase.execute({ document: { schema: DOCUMENT_V2_SCHEMA } })).rejects.toMatchObject({
      name: 'ValidationError', code: 'INVALID_DOCUMENT',
    });
  });
});

describe('RenderPrintDocument — gutter guard', () => {
  it('rejects a negative context.gutter at the use-case boundary', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({ archetype: 'worksheet' });
    await expect(useCase.execute({ document, context: { gutter: -1 } })).rejects.toMatchObject({
      name: 'ValidationError', code: 'INVALID_GUTTER',
    });
  });

  it('accepts a non-negative numeric override', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({ archetype: 'worksheet' });
    const result = await useCase.execute({ document, context: { gutter: 0 } });
    expect(isPdf(result.bytes)).toBe(true);
  });
});

// ── Task 5: bank threading, shuffles, selection + publish pipeline ─────────

/** A source-schema fixture with one inline multiple_choice question — mints a derived bank. */
const sourceDoc = (over = {}) => ({
  schema: DOCUMENT_SOURCE_SCHEMA,
  id: 'source-fixture',
  seed: 100,
  target: ['letter'],
  archetype: 'quiz',
  blocks: [{
    type: 'question',
    itemId: 'q1',
    number: 1,
    blocks: [
      { type: 'rich_text', md: 'What is 2+2?' },
      { type: 'omr_response', itemId: 'q1', choices: 3 },
    ],
    choices: ['3', '4', '5'],
    answer: '4',
  }],
  ...over,
});

describe('RenderPrintDocument — source-schema auto-publish in memory (spec §3)', () => {
  it('publishes a source document in memory and renders the answer-free page, choices resolved from the in-memory derived bank', async () => {
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document: sourceDoc() });
    expect(isPdf(result.bytes)).toBe(true);
    const text = pdfText(result.bytes);
    expect(text).toContain('What is 2+2?');
    expect(text).toContain('3');
    expect(text).toContain('4');
    expect(text).toContain('5');
  });

  it('nothing is persisted — the repository’s writePublished is never called for a proof render', async () => {
    const writePublished = () => { throw new Error('writePublished must not be called by RenderPrintDocument'); };
    const repository = { get: async () => null, writePublished, getDerivedBank: async () => null };
    const useCase = new RenderPrintDocument({ repository });
    const result = await useCase.execute({ document: sourceDoc() });
    expect(isPdf(result.bytes)).toBe(true);
  });

  it('is deterministic: publishing + rendering the identical source twice yields byte-identical PDFs', async () => {
    const useCase = new RenderPrintDocument();
    const doc = sourceDoc();
    const first = await useCase.execute({ document: doc });
    const second = await useCase.execute({ document: doc });
    expect(first.bytes.equals(second.bytes)).toBe(true);
  });

  it('rejects an invalid source document with a structured INVALID_DOCUMENT error', async () => {
    const useCase = new RenderPrintDocument();
    await expect(useCase.execute({ document: sourceDoc({ id: 'BAD ID' }) })).rejects.toMatchObject({
      name: 'ValidationError', code: 'INVALID_DOCUMENT',
    });
  });
});

describe('RenderPrintDocument — published documents resolve their derived bank via the repository (spec §3)', () => {
  const published = (over = {}) => ({
    schema: DOCUMENT_V2_SCHEMA,
    id: 'published-fixture',
    seed: 3,
    target: ['letter'],
    archetype: 'quiz',
    rev: 'deadbeef1',
    blocks: [{
      type: 'question',
      itemId: 'p1',
      number: 1,
      blocks: [
        { type: 'rich_text', md: 'Pick a color.' },
        { type: 'omr_response', itemId: 'p1', choices: 2 },
      ],
    }],
    ...over,
  });
  const bank = {
    id: 'derived/published-fixture@deadbeef1',
    items: [{
      id: 'p1', type: 'multiple_choice', prompt: 'Pick a color.', choices: ['Red', 'Blue'], answer: 'Red',
    }],
  };

  it('fetches the derived bank by (id, rev) and resolves omr_response choices from it', async () => {
    const repository = {
      get: async () => null,
      getDerivedBank: async (id, rev) => (id === 'published-fixture' && rev === 'deadbeef1' ? bank : null),
    };
    const useCase = new RenderPrintDocument({ repository });
    const result = await useCase.execute({ document: published() });
    const text = pdfText(result.bytes);
    expect(text).toContain('Red');
    expect(text).toContain('Blue');
  });

  it('a published document with no bank resolvable (no repository) throws MissingChoicesError rather than printing blank bubbles', async () => {
    const useCase = new RenderPrintDocument();
    await expect(useCase.execute({ document: published() })).rejects.toMatchObject({ name: 'MissingChoicesError' });
  });

  it('a hand-authored v2 document with NO rev never attempts a bank lookup — repository.getDerivedBank is not called', async () => {
    const getDerivedBank = () => { throw new Error('getDerivedBank must not be called without a rev'); };
    const repository = { get: async () => null, getDerivedBank };
    const useCase = new RenderPrintDocument({ repository });
    const document = v2doc({ archetype: 'worksheet' }); // no rev, no omr_response
    const result = await useCase.execute({ document });
    expect(isPdf(result.bytes)).toBe(true);
  });
});

describe('RenderPrintDocument — wordbank/matching shuffle by key (spec §6.2)', () => {
  const terms = ['Photosynthesis', 'Mitosis', 'Osmosis', 'Respiration'];
  const wordbankDoc = (extraBefore = []) => v2doc({
    archetype: 'worksheet',
    seed: 555,
    blocks: [...extraBefore, { type: 'wordbank', key: 'wb1', terms }],
  });
  const printedOrderOf = (bytes, candidates) => {
    const text = pdfText(bytes);
    return [...candidates].sort((a, b) => text.indexOf(a) - text.indexOf(b));
  };

  it('shuffles wordbank terms deterministically from (seed, variant, key) — matches deriveShuffle/applyShuffle directly', async () => {
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document: wordbankDoc() });
    const expected = applyShuffle(terms, deriveShuffle(555, 0, 'wb1', terms.length));
    expect(printedOrderOf(result.bytes, terms)).toEqual(expected);
  });

  it('edit-stability: an unrelated inserted sibling block does not change the wordbank’s shuffle', async () => {
    const useCase = new RenderPrintDocument();
    const a = await useCase.execute({ document: wordbankDoc() });
    const b = await useCase.execute({
      document: wordbankDoc([{ type: 'rich_text', md: 'An unrelated inserted paragraph.' }]),
    });
    expect(printedOrderOf(b.bytes, terms)).toEqual(printedOrderOf(a.bytes, terms));
  });

  it('shuffles matching left/right independently, deterministic from (seed, variant, key)', async () => {
    const left = ['Washington', 'Oregon', 'Idaho'];
    const right = ['Boise', 'Salem', 'Olympia'];
    const document = v2doc({
      archetype: 'worksheet',
      seed: 777,
      blocks: [{ type: 'matching', key: 'm1', left, right }],
    });
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document });

    const expectedLeft = applyShuffle(left, deriveShuffle(777, 0, 'm1:left', left.length));
    const expectedRight = applyShuffle(right, deriveShuffle(777, 0, 'm1:right', right.length));
    expect(printedOrderOf(result.bytes, left)).toEqual(expectedLeft);
    expect(printedOrderOf(result.bytes, right)).toEqual(expectedRight);
  });
});

describe('RenderPrintDocument — totalPoints threading to the score box (spec §13)', () => {
  it('sums question points ?? defaultPoints and prints "Score ____ / <N>"', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({
      archetype: 'quiz',
      defaultPoints: 2,
      blocks: [question(1), { ...question(2), points: 5 }],
    });
    const result = await useCase.execute({ document });
    const text = pdfText(result.bytes);
    expect(text).toContain('Score ____ / 7');
  });

  it('prints no score line when header.scoreBox is false, even with scored questions', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({ archetype: 'worksheet', blocks: [question(1)] }); // worksheet preset: scoreBox false
    const result = await useCase.execute({ document });
    const text = pdfText(result.bytes);
    expect(text).not.toContain('Score');
  });
});

describe('RenderPrintDocument — bank-select sugar resolution (spec §6.2)', () => {
  const geoBank = {
    id: 'geo-bank',
    items: [
      {
        id: 'g1', type: 'multiple_choice', prompt: 'Capital of France?', choices: ['Paris', 'Lyon', 'Nice'], answer: 'Paris',
      },
      {
        id: 'g2', type: 'multiple_choice', prompt: 'Capital of Spain?', choices: ['Madrid', 'Barcelona'], answer: 'Madrid',
      },
      { id: 'g3', type: 'short_answer', prompt: 'Name a European capital.', answer: 'Paris' },
    ],
  };
  const bankSelectDoc = (over = {}) => v2doc({
    archetype: 'quiz',
    seed: 42,
    blocks: [{
      type: 'question', bankId: 'geo-bank', select: 2, key: 'sel1',
    }],
    ...over,
  });

  it('resolves via the injected banks.getBank, selecting applyShuffle(deriveShuffle(seed, variant, key, n)).slice(0, select)', async () => {
    const banks = { getBank: (id) => (id === 'geo-bank' ? geoBank : null) };
    const useCase = new RenderPrintDocument({ banks });
    const result = await useCase.execute({ document: bankSelectDoc() });
    const text = pdfText(result.bytes);

    const permutation = deriveShuffle(42, 0, 'sel1', geoBank.items.length);
    const selected = applyShuffle(geoBank.items, permutation).slice(0, 2);
    const omitted = geoBank.items.filter((item) => !selected.includes(item));

    for (const item of selected) expect(text).toContain(item.prompt);
    for (const item of omitted) expect(text).not.toContain(item.prompt);
  });

  it('bank-selected items count toward totalPoints (points ?? defaultPoints)', async () => {
    const banks = { getBank: (id) => (id === 'geo-bank' ? geoBank : null) };
    const useCase = new RenderPrintDocument({ banks });
    const result = await useCase.execute({ document: bankSelectDoc({ defaultPoints: 3 }) });
    const text = pdfText(result.bytes);
    expect(text).toContain('Score ____ / 6'); // 2 selected items × defaultPoints 3
  });

  it('numbers bank-selected questions continuing after any hand-authored inline questions', async () => {
    const banks = { getBank: (id) => (id === 'geo-bank' ? geoBank : null) };
    const useCase = new RenderPrintDocument({ banks });
    const document = bankSelectDoc({
      blocks: [question(1), {
        type: 'question', bankId: 'geo-bank', select: 1, key: 'sel1',
      }],
    });
    const result = await useCase.execute({ document });
    const text = pdfText(result.bytes);
    expect(text).toMatch(/\b1\./);
    expect(text).toMatch(/\b2\./);
  });

  // Review finding 1: numbering must be STRICTLY POSITIONAL (document order),
  // not "hand-authored keeps its own number, bank-select mints from a running
  // max" — the latter prints bank-select items ahead of a later-numbered-but
  // -earlier-printed hand-authored question whenever a bank-select block sits
  // BEFORE one in the document.
  it('numbers strictly ascending in document order — a bank-select block BEFORE a hand-authored question prints "1." then "2.", not "2." then "1."', async () => {
    const banks = { getBank: (id) => (id === 'geo-bank' ? geoBank : null) };
    const useCase = new RenderPrintDocument({ banks });
    const document = bankSelectDoc({
      blocks: [{
        type: 'question', bankId: 'geo-bank', select: 1, key: 'sel1',
      }, question(1)],
    });
    const result = await useCase.execute({ document });
    const text = pdfText(result.bytes);
    const indexOf1 = text.indexOf('1.');
    const indexOf2 = text.indexOf('2.');
    expect(indexOf1).toBeGreaterThanOrEqual(0);
    expect(indexOf2).toBeGreaterThan(indexOf1);
  });

  it('interleaved bank-select blocks (with unrelated content between them) number contiguously 1..N in document order', async () => {
    const bankA = { id: 'bank-a', items: [{ id: 'a1', type: 'multiple_choice', prompt: 'Prompt A', choices: ['X', 'Y'], answer: 'X' }] };
    const bankB = { id: 'bank-b', items: [{ id: 'b1', type: 'multiple_choice', prompt: 'Prompt B', choices: ['X', 'Y'], answer: 'X' }] };
    const banks = { getBank: (id) => ({ 'bank-a': bankA, 'bank-b': bankB })[id] ?? null };
    const useCase = new RenderPrintDocument({ banks });
    const document = bankSelectDoc({
      blocks: [
        { type: 'rich_text', md: 'Section A' },
        { type: 'question', bankId: 'bank-a', select: 1, key: 'sela' },
        { type: 'rich_text', md: 'Section B' },
        { type: 'question', bankId: 'bank-b', select: 1, key: 'selb' },
      ],
    });
    const result = await useCase.execute({ document });
    const text = pdfText(result.bytes);
    const indexOf1 = text.indexOf('1.');
    const indexOf2 = text.indexOf('2.');
    expect(indexOf1).toBeGreaterThanOrEqual(0);
    expect(indexOf2).toBeGreaterThan(indexOf1);
    // Contiguous, not "1." then "3." or similar — no third numbered item exists.
    expect(text.indexOf('3.')).toBe(-1);
  });

  // Review finding 2: a supplied-but-unapplied option must warn, never fail silently.
  it('a supplied but unapplied bank-select filter surfaces a warning', async () => {
    const banks = { getBank: (id) => (id === 'geo-bank' ? geoBank : null) };
    const useCase = new RenderPrintDocument({ banks });
    const document = bankSelectDoc({
      blocks: [{
        type: 'question', bankId: 'geo-bank', select: 2, key: 'sel1', filter: { topics: ['geography'] },
      }],
    });
    const result = await useCase.execute({ document });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/filter.*not applied/i),
    ]));
  });

  it('no filter supplied -> no filter warning, and selection is unchanged either way', async () => {
    const banks = { getBank: (id) => (id === 'geo-bank' ? geoBank : null) };
    const useCase = new RenderPrintDocument({ banks });
    const withoutFilter = await useCase.execute({ document: bankSelectDoc() });
    // A no-card quiz render still warns (spec §5.3, Task 5) — this test's own
    // concern is the filter warning specifically, so it just needs that ONE
    // (unrelated) warning to be absent, not an empty array.
    expect(withoutFilter.warnings).toEqual([expect.stringMatching(/rendered without card allocation/)]);

    const withFilter = await useCase.execute({
      document: bankSelectDoc({
        blocks: [{
          type: 'question', bankId: 'geo-bank', select: 2, key: 'sel1', filter: { topics: ['geography'] },
        }],
      }),
    });
    // filter is validated-but-ignored (spec §6.2's picker doesn't read it) —
    // the two documents differ ONLY in the presence of `filter`, so the
    // rendered pages must be byte-identical.
    expect(withFilter.bytes.equals(withoutFilter.bytes)).toBe(true);
  });

  it('rejects an unknown bankId with a structured BANK_SELECT_BANK_NOT_FOUND error', async () => {
    const banks = { getBank: () => null };
    const useCase = new RenderPrintDocument({ banks });
    await expect(useCase.execute({ document: bankSelectDoc() })).rejects.toMatchObject({
      name: 'ValidationError', code: 'BANK_SELECT_BANK_NOT_FOUND',
    });
  });

  it('rejects select > bank.items.length with a structured BANK_SELECT_INSUFFICIENT_ITEMS error', async () => {
    const banks = { getBank: () => geoBank };
    const useCase = new RenderPrintDocument({ banks });
    const document = bankSelectDoc({
      blocks: [{
        type: 'question', bankId: 'geo-bank', select: 10, key: 'sel1',
      }],
    });
    await expect(useCase.execute({ document })).rejects.toMatchObject({
      name: 'ValidationError', code: 'BANK_SELECT_INSUFFICIENT_ITEMS',
    });
  });

  it('rejects a selected item whose type has no print rendering (v1 scope) with BANK_SELECT_UNSUPPORTED_ITEM_TYPE', async () => {
    const matchingBank = {
      id: 'match-bank',
      items: [{
        id: 'm1', type: 'matching', prompt: 'Match', pairs: [{ left: 'a', right: 'b' }, { left: 'c', right: 'd' }],
      }],
    };
    const banks = { getBank: () => matchingBank };
    const useCase = new RenderPrintDocument({ banks });
    const document = bankSelectDoc({
      blocks: [{
        type: 'question', bankId: 'match-bank', select: 1, key: 'sel1',
      }],
    });
    await expect(useCase.execute({ document })).rejects.toMatchObject({
      name: 'ValidationError', code: 'BANK_SELECT_UNSUPPORTED_ITEM_TYPE',
    });
  });

  it('determinism: same (seed, variant, key) selects the same items across independent renders', async () => {
    const banks = { getBank: (id) => (id === 'geo-bank' ? geoBank : null) };
    const useCase = new RenderPrintDocument({ banks });
    const document = bankSelectDoc();
    const first = await useCase.execute({ document });
    const second = await useCase.execute({ document });
    expect(first.bytes.equals(second.bytes)).toBe(true);
  });
});

// ── Task 6: teacher key render mode (spec §4.1, §12.1) ──────────────────────

describe('RenderPrintDocument — teacher key render mode (spec §4.1, §12.1)', () => {
  /** One source document exercising every answerable item type the teacher key formats. */
  const teacherSourceDoc = (over = {}) => ({
    schema: DOCUMENT_SOURCE_SCHEMA,
    id: 'teacher-fixture',
    seed: 321,
    variant: 2,
    target: ['letter'],
    archetype: 'quiz',
    title: 'Teacher Fixture',
    blocks: [
      {
        type: 'question',
        itemId: 'mc1',
        number: 1,
        blocks: [
          { type: 'rich_text', md: 'Pick a color.' },
          { type: 'omr_response', itemId: 'mc1', choices: 3 },
        ],
        choices: ['Red', 'Green', 'Blue'],
        answer: 'Blue',
      },
      {
        type: 'question',
        itemId: 'ms1',
        number: 2,
        blocks: [
          { type: 'rich_text', md: 'Pick all primes.' },
          { type: 'omr_response', itemId: 'ms1', choices: 4 },
        ],
        choices: ['2', '3', '4', '5'],
        answers: ['2', '3', '5'],
      },
      {
        type: 'cloze',
        text: 'The sky is {{1}} and grass is {{2}}.',
        blanks: [{ n: 1, answer: 'blue' }, { n: 2, answer: 'green' }],
      },
      {
        type: 'matching',
        key: 'm1',
        left: ['WA', 'OR', 'ID'],
        right: ['Boise', 'Salem', 'Olympia'],
        pairs: [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }, { left: 'ID', right: 'Boise' }],
      },
      { type: 'short_answer', prompt: 'Name a state capital.', answer: 'Olympia' },
    ],
    ...over,
  });

  it('renders the identical student pages a non-teacher render of the same document produces (same shuffles, same layout)', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({ archetype: 'quiz', seed: 999, blocks: [question(1), question(2)] });

    const plain = await useCase.execute({ document });
    const teacher = await useCase.execute({ document, context: { teacher: true } });

    expect(teacher.pageCount).toBeGreaterThan(plain.pageCount);

    const [plainItems, teacherItems] = await Promise.all([
      pdfTextItems(plain.bytes), pdfTextItems(teacher.bytes),
    ]);
    // Every text run on every STUDENT page (1..plain.pageCount) is drawn at
    // the identical string and position in both renders — the strongest
    // "layout equality" check available at the text-layer, and exactly what
    // the shared measure/place pass (unchanged by teacher mode) guarantees.
    const studentItems = (items) => items.filter((item) => item.page <= plain.pageCount);
    expect(studentItems(teacherItems)).toEqual(studentItems(plainItems));
  });

  it('published document objects are never mutated by a teacher render', async () => {
    const document = {
      schema: DOCUMENT_V2_SCHEMA,
      id: 'published-teacher',
      seed: 3,
      target: ['letter'],
      archetype: 'quiz',
      rev: 'deadbeef1',
      blocks: [{
        type: 'question',
        itemId: 'p1',
        number: 1,
        blocks: [
          { type: 'rich_text', md: 'Pick a color.' },
          { type: 'omr_response', itemId: 'p1', choices: 2 },
        ],
      }],
    };
    const bank = {
      id: 'derived/published-teacher@deadbeef1',
      items: [{
        id: 'p1', type: 'multiple_choice', prompt: 'Pick a color.', choices: ['Red', 'Blue'], answer: 'Red',
      }],
    };
    const snapshot = JSON.parse(JSON.stringify(document));
    const repository = { get: async () => null, getDerivedBank: async () => bank };
    const useCase = new RenderPrintDocument({ repository });

    const result = await useCase.execute({ document, context: { teacher: true } });
    expect(isPdf(result.bytes)).toBe(true);
    expect(document).toEqual(snapshot);
  });

  it('formats multiple_choice/multi_select/cloze/matching/short_answer answers and prints the "Answer key — <title> (variant N)" heading', async () => {
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document: teacherSourceDoc(), context: { teacher: true } });
    const text = pdfText(result.bytes);

    expect(text).toContain('Answer key — Teacher Fixture (variant 2)');
    // multiple_choice: 'Blue' is index 2 of ['Red','Green','Blue'] -> 'C'.
    expect(text).toMatch(/1\.\s*C/);
    // multi_select: '2','3','5' are indices 0,1,3 of ['2','3','4','5'] -> A, B, D (already sorted).
    expect(text).toMatch(/2\.\s*A,\s*B,\s*D/);
    // cloze blanks (F1: grouped under a per-block "Fill-in (passage N):"
    // heading, each blank labelled "blank <n>:" — not a bare "N." label,
    // which would collide with question numbering and with a second cloze
    // block's own blank 1/2).
    expect(text).toContain('Fill-in (passage 1):');
    expect(text).toMatch(/blank 1:\s*blue/);
    expect(text).toMatch(/blank 2:\s*green/);
    // short_answer (standalone sugar block): the answer text prints verbatim.
    expect(text).toContain('Olympia');
  });

  // Review finding 1: a standalone short_answer sugar block has no `.number`
  // of its own and prints its prompt text UNNUMBERED on the student page
  // (measure.mjs desugars it straight to prompt + answer_space) — so the
  // bank item's own internal path-based id (`blocks-4`, never printed
  // anywhere) gave a teacher nothing to correlate a key line against. The
  // fix labels it with the prompt text itself instead.
  it('labels a standalone short_answer key entry with its (truncated) prompt text, never the internal path-based item id', async () => {
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document: teacherSourceDoc(), context: { teacher: true } });
    const text = pdfText(result.bytes);

    expect(text).toContain('"Name a state capital." —');
    expect(text).not.toMatch(/blocks-\d+\s+Olympia/);
    for (const line of text.split('\n')) {
      expect(line).not.toMatch(/^\s*blocks-\d/);
    }
  });

  it('truncates a long standalone short_answer prompt rather than printing it in full', async () => {
    const useCase = new RenderPrintDocument();
    const longPrompt = 'What is the exact founding year of the state capital building, to the nearest decade?';
    const document = teacherSourceDoc({
      blocks: [{ type: 'short_answer', prompt: longPrompt, answer: 'Olympia' }],
    });
    const result = await useCase.execute({ document, context: { teacher: true } });
    const text = pdfText(result.bytes);

    // The student page legitimately prints the prompt IN FULL (it's the
    // block's own body text) — only the KEY LABEL truncates it, so the
    // assertion targets the labelled form specifically, not bare substring
    // presence/absence of the prompt text.
    expect(text).toContain(`"${longPrompt.slice(0, 39)}…" —`);
    expect(text).not.toContain(`"${longPrompt}" —`);
  });

  // F3 (review finding): a `question` that mints its OWN item (via `itemId`)
  // AND wraps a further answer-bearing child (a nested `short_answer` with
  // its own `itemRef`) must get key entries for BOTH — the old code's
  // `else if` made the two mutually exclusive, silently dropping the child's
  // entry whenever the question's own itemId also resolved.
  it('a question minting its own item AND wrapping an answer-bearing child gets key entries for BOTH', async () => {
    const document = {
      schema: DOCUMENT_V2_SCHEMA,
      id: 'composite-question-fixture',
      seed: 5,
      target: ['letter'],
      archetype: 'worksheet',
      rev: 'deadbeef2',
      blocks: [{
        type: 'question',
        itemId: 'q1',
        number: 1,
        blocks: [
          { type: 'rich_text', md: 'Pick a color, then explain your choice.' },
          { type: 'omr_response', itemId: 'q1', choices: 2 },
          { type: 'short_answer', prompt: 'Why?', itemRef: 'q1-explain' },
        ],
      }],
    };
    const bank = {
      id: 'derived/composite-question-fixture@deadbeef2',
      items: [
        {
          id: 'q1', type: 'multiple_choice', prompt: 'Pick a color.', choices: ['Red', 'Blue'], answer: 'Red',
        },
        { id: 'q1-explain', type: 'short_answer', prompt: 'Why?', answer: 'Because red is nice.' },
      ],
    };
    const repository = { get: async () => null, getDerivedBank: async () => bank };
    const useCase = new RenderPrintDocument({ repository });
    const result = await useCase.execute({ document, context: { teacher: true } });
    const text = pdfText(result.bytes);

    // The question's own entry: 'Red' is index 0 of ['Red','Blue'] -> 'A'.
    expect(text).toMatch(/1\.\s*A/);
    // The nested short_answer's entry, labelled by its (truncated) prompt —
    // exactly as a standalone short_answer already is.
    expect(text).toMatch(/"Why\?" —\s*Because red is nice\./);
  });

  it('formats a matching block as "<n>-<letter> …" against the SAME shuffled left/right order the student page prints', async () => {
    const useCase = new RenderPrintDocument();
    const document = teacherSourceDoc();
    const result = await useCase.execute({ document, context: { teacher: true } });
    const text = pdfText(result.bytes);

    const left = ['WA', 'OR', 'ID'];
    const right = ['Boise', 'Salem', 'Olympia'];
    const pairs = [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }, { left: 'ID', right: 'Boise' }];
    const shuffledLeft = applyShuffle(left, deriveShuffle(321, 2, 'm1:left', left.length));
    const shuffledRight = applyShuffle(right, deriveShuffle(321, 2, 'm1:right', right.length));
    const expected = pairs
      .map((pair) => ({
        number: shuffledLeft.indexOf(pair.left) + 1,
        letter: String.fromCharCode(65 + shuffledRight.indexOf(pair.right)),
      }))
      .sort((a, b) => a.number - b.number)
      .map(({ number, letter }) => `${number}-${letter}`)
      .join(' ');

    // F1 (review finding): labelled `Matching:` — never the internal block
    // `key` (`m1`), which prints nowhere on the student page.
    expect(text).toContain(`Matching: ${expected}`);
    expect(text).not.toMatch(/\bm1:/);
  });

  // F1 (review finding): a document with MORE THAN ONE matching block gets
  // ordinal-suffixed labels (`Matching 1:`, `Matching 2:`) so the two never
  // collide — the single-matching-block test above proves the bare
  // `Matching:` form when there is nothing to disambiguate.
  it('labels matching blocks "Matching 1:"/"Matching 2:" when the document has more than one', async () => {
    const document = teacherSourceDoc({
      blocks: [
        {
          type: 'matching', key: 'first', left: ['A', 'B'], right: ['1', '2'], pairs: [{ left: 'A', right: '1' }, { left: 'B', right: '2' }],
        },
        {
          type: 'matching', key: 'second', left: ['X', 'Y'], right: ['9', '8'], pairs: [{ left: 'X', right: '9' }, { left: 'Y', right: '8' }],
        },
      ],
    });
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document, context: { teacher: true } });
    const text = pdfText(result.bytes);

    expect(text).toContain('Matching 1:');
    expect(text).toContain('Matching 2:');
    expect(text).not.toContain('Matching:');
  });

  it('a document with zero answerable items renders a bare heading and surfaces a warning, not a failure', async () => {
    const useCase = new RenderPrintDocument();
    const document = v2doc({ archetype: 'infopage', blocks: [{ type: 'rich_text', md: 'Just some prose, nothing gradeable.' }] });
    const result = await useCase.execute({ document, context: { teacher: true } });

    expect(isPdf(result.bytes)).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/no answerable items/i),
    ]));
    const text = pdfText(result.bytes);
    expect(text).toContain('No answerable items in this document.');
  });

  it('a published v2 document resolves its teacher key from the repository-fetched derived bank', async () => {
    const published = {
      schema: DOCUMENT_V2_SCHEMA,
      id: 'published-fixture',
      seed: 3,
      target: ['letter'],
      archetype: 'quiz',
      rev: 'deadbeef1',
      blocks: [{
        type: 'question',
        itemId: 'p1',
        number: 1,
        blocks: [
          { type: 'rich_text', md: 'Pick a color.' },
          { type: 'omr_response', itemId: 'p1', choices: 2 },
        ],
      }],
    };
    const bank = {
      id: 'derived/published-fixture@deadbeef1',
      items: [{
        id: 'p1', type: 'multiple_choice', prompt: 'Pick a color.', choices: ['Red', 'Blue'], answer: 'Red',
      }],
    };
    const repository = {
      get: async () => null,
      getDerivedBank: async (id, rev) => (id === 'published-fixture' && rev === 'deadbeef1' ? bank : null),
    };
    const useCase = new RenderPrintDocument({ repository });
    const result = await useCase.execute({ document: published, context: { teacher: true } });
    const text = pdfText(result.bytes);
    // Answer 'Red' is index 0 of ['Red','Blue'] -> letter A.
    expect(text).toMatch(/1\.\s*A/);
    // A no-card quiz render still warns (spec §5.3, Task 5) — this test's own
    // concern is that no OTHER (e.g. teacher-key) warning fires.
    expect(result.warnings).toEqual([expect.stringMatching(/rendered without card allocation/)]);
  });

  it('ignores context.teacher on the v1 legacy path — byte-identical to the same call without it', async () => {
    const useCase = new RenderPrintDocument();
    const raw = v1doc();
    const withoutTeacher = await useCase.execute({ document: raw });
    const withTeacher = await useCase.execute({ document: raw, context: { teacher: true } });
    expect(withoutTeacher.bytes.equals(withTeacher.bytes)).toBe(true);
  });
});

// ── Task 5: card allocation context (spec §5.3/§5.4) ────────────────────────

describe('RenderPrintDocument — card allocation context (spec §5.3/§5.4, Task 5)', () => {
  /** In-memory `io` fake for a real `YamlAllocationStore` — no filesystem needed (mirrors YamlAllocationStore.test.mjs). */
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

  /** One row-mappable (`multiple_choice`) source question — auto-published in memory (spec §3) mints a real `rev` + derived bank, which card allocation requires. */
  const omrQuestion = (n) => ({
    type: 'question',
    itemId: `oq${n}`,
    number: n,
    blocks: [
      { type: 'rich_text', md: `OMR prompt ${n}` },
      { type: 'omr_response', itemId: `oq${n}`, choices: 3 },
    ],
    choices: ['Alpha', 'Beta', 'Gamma'],
    answer: 'Alpha',
  });
  const omrSourceDoc = (n, over = {}) => ({
    schema: DOCUMENT_SOURCE_SCHEMA,
    id: 'card-fixture',
    seed: 900,
    variant: 0,
    target: ['letter'],
    archetype: 'quiz',
    title: 'Card Fixture',
    blocks: Array.from({ length: n }, (_, i) => omrQuestion(i + 1)),
    ...over,
  });

  it('rejects a card-attached render with no allocationStore configured (ALLOCATION_STORE_REQUIRED)', async () => {
    const useCase = new RenderPrintDocument();
    await expect(useCase.execute({
      document: omrSourceDoc(2), context: { freshCard: true },
    })).rejects.toMatchObject({ name: 'ValidationError', code: 'ALLOCATION_STORE_REQUIRED' });
  });

  it('rejects a card-attached render of a document with no rev (hand-authored, unpublished v2)', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const document = v2doc({ archetype: 'worksheet' }); // no rev
    await expect(useCase.execute({
      document, context: { freshCard: true },
    })).rejects.toMatchObject({ name: 'ValidationError', code: 'ALLOCATION_REQUIRES_REV' });
  });

  it('a fresh-card render mints a card, writes a live allocation record, and returns {cardId, rowRange, recordId, status}', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const result = await useCase.execute({ document: omrSourceDoc(3), context: { freshCard: true } });

    expect(isPdf(result.bytes)).toBe(true);
    expect(result.allocation).toEqual({
      cardId: expect.stringMatching(/^\d{7}$/),
      rowRange: { start: 1, end: 3 },
      recordId: expect.stringMatching(/^card-fixture@[0-9a-f]+:v0:1-3$/),
      status: 'live',
    });

    const stored = await allocationStore.findByCard(result.allocation.cardId);
    expect(stored).toHaveLength(1);
    expect(stored[0].recordId).toBe(result.allocation.recordId);
  });

  it('replays a frozen card mapping without calling the allocation store', async () => {
    const allocationStore = { allocate: () => { throw new Error('history reads must not allocate'); } };
    const useCase = new RenderPrintDocument({ allocationStore });
    const result = await useCase.execute({
      document: omrSourceDoc(2),
      context: { cardId: '4071314', startRow: 19, historicalCard: true, learnerName: 'Milo' },
    });

    expect(isPdf(result.bytes)).toBe(true);
    expect(result.allocation).toEqual({
      cardId: '4071314', rowRange: { start: 19, end: 20 }, recordId: null, status: 'historical-replay',
    });
  });

  it('persists immutable section row ownership for a composed card', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const result = await useCase.execute({
      document: omrSourceDoc(3),
      context: {
        freshCard: true,
        sectionAttribution: [
          { id: 'lesson-a', itemIds: ['oq1', 'oq2'], sessionId: 'session-a', lessonId: 'a' },
          { id: 'lesson-b', itemIds: ['oq3'], sessionId: 'session-b', lessonId: 'b' },
        ],
      },
    });
    const [record] = await allocationStore.findByCard(result.allocation.cardId);
    expect(record.sections).toEqual([
      expect.objectContaining({ id: 'lesson-a', rowRange: { start: 1, end: 2 }, sessionId: 'session-a' }),
      expect.objectContaining({ id: 'lesson-b', rowRange: { start: 3, end: 3 }, sessionId: 'session-b' }),
    ]);
  });

  it('the page footer carries the card number on EVERY page, page 1 included (end-to-end, real extracted PDF text)', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    // Enough OMR questions to actually paginate — a page-1-only render could
    // not prove "every page".
    const result = await useCase.execute({
      document: omrSourceDoc(20), context: { freshCard: true },
    });
    const { cardId } = result.allocation;
    expect(cardId).toMatch(/^\d{7}$/);
    expect(result.pageCount).toBeGreaterThan(1);

    const text = pdfText(result.bytes);
    for (let page = 1; page <= result.pageCount; page += 1) {
      expect(text, `page ${page} footer`).toContain(`Page ${page} of ${result.pageCount} · ${cardId}`);
    }
    // The blank continuation-strip name line it replaced is gone for good:
    // "Name:" now appears exactly once, in page 1's real header, not once
    // more per continuation page.
    expect((text.match(/Name:/g) ?? []).length).toBe(1);
  });

  it('prints the Student No. with offset numbering starting at startRow and no redundant instruction or range', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const result = await useCase.execute({
      document: omrSourceDoc(3), context: { freshCard: true, startRow: 18 },
    });

    expect(result.allocation.rowRange).toEqual({ start: 18, end: 20 });
    const text = pdfText(result.bytes);
    expect(text).not.toContain('Bubble this number');
    expect(text).not.toContain('questions 18');
    // Offset numbering: printed question numbers start at 18, not 1.
    expect(text).toMatch(/\b18\./);
    expect(text).toMatch(/\b19\./);
    expect(text).toMatch(/\b20\./);
    expect(text).not.toMatch(/\b1\./);
  });

  it('a reprint (supplied cardId) prints the "use your card" reminder line, not the first-use instruction', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const first = await useCase.execute({ document: omrSourceDoc(2), context: { freshCard: true } });
    const { cardId } = first.allocation;

    // A different document sharing the same card, starting after the first's rows.
    const second = await useCase.execute({
      document: omrSourceDoc(2, { id: 'card-fixture-2' }),
      context: { cardId, startRow: 3 },
    });

    expect(second.allocation.cardId).toBe(cardId);
    expect(second.allocation.rowRange).toEqual({ start: 3, end: 4 });
    const text = pdfText(second.bytes);
    expect(text).not.toContain(`Use Student No. ${cardId}.`);
    expect(text).not.toContain('Bubble this number');
  });

  it('teacher-mode key numbers match the offset student-sheet numbers (startRow 18, spec §5.4 parity)', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const result = await useCase.execute({
      document: omrSourceDoc(3),
      context: { freshCard: true, startRow: 18, teacher: true },
    });

    expect(result.allocation.rowRange).toEqual({ start: 18, end: 20 });
    const text = pdfText(result.bytes);
    // The teacher key's entries are labelled with the SAME numbers the
    // student sheet just printed (spec §5.4: "the render prints the numbers
    // the record claims ... the teacher key is rendered per allocation ...
    // including startRow offsets"). Every answer is 'Alpha' -> letter A.
    expect(text).toMatch(/18\.\s*A/);
    expect(text).toMatch(/19\.\s*A/);
    expect(text).toMatch(/20\.\s*A/);
    expect(text).not.toMatch(/\b1\.\s*A/);
  });

  // Task 7 review, Finding 2 (Important): a failure AFTER the allocation
  // write (fit rejection, an asset the renderer can't resolve, ...) used to
  // leave a durable `live` record with no way for a caller to discover its
  // cardId — the fresh card's id is otherwise unknowable from outside
  // (`freshCard: true` never hands it back except on the happy-path return).
  it('a failure AFTER the allocation write attaches the allocation snapshot to the thrown error, and the record really is durable', async () => {
    const allocationStore = fakeAllocationStore();
    const explodingRenderer = () => ({ render: async () => { throw new Error('renderer exploded'); } });
    const useCase = new RenderPrintDocument({ allocationStore, renderer: explodingRenderer });

    const err = await useCase.execute({
      document: omrSourceDoc(2), context: { freshCard: true },
    }).catch((e) => e);

    expect(err.message).toBe('renderer exploded');
    expect(err.details.allocation).toEqual({
      cardId: expect.stringMatching(/^\d{7}$/),
      rowRange: { start: 1, end: 2 },
      recordId: expect.stringMatching(/^card-fixture@[0-9a-f]+:v0:1-2$/),
      status: 'live',
    });
    // Not a fabricated id — the write genuinely happened and is orphaned
    // (findable, not silently lost) until something releases it.
    const stored = await allocationStore.findByCard(err.details.allocation.cardId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ recordId: err.details.allocation.recordId, status: 'live' });
  });

  it('a FIT_OVERSET rejection (a real, non-injected failure) also attaches the allocation snapshot', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    // 40 row-mappable questions with a padded prompt overflows both densities
    // (the same "overlong fixture" shape as the fit-policy describe block
    // above, just row-mappable so card allocation is legal for it).
    const paddedOmrQuestion = (n) => ({
      type: 'question',
      itemId: `oq${n}`,
      number: n,
      blocks: [
        { type: 'rich_text', md: `OMR prompt ${n}. `.repeat(30) },
        { type: 'omr_response', itemId: `oq${n}`, choices: 3 },
      ],
      choices: ['Alpha', 'Beta', 'Gamma'],
      answer: 'Alpha',
    });
    const document = omrSourceDoc(40, {
      id: 'overset-card-fixture',
      blocks: Array.from({ length: 40 }, (_, i) => paddedOmrQuestion(i + 1)),
      fit: { policy: 'one-page', typeScale: 'standard' },
    });

    const err = await useCase.execute({ document, context: { freshCard: true } }).catch((e) => e);
    expect(err.code).toBe('FIT_OVERSET');
    expect(err.details.oversetPt).toBeGreaterThan(0);
    expect(err.details.allocation).toMatchObject({ status: 'live' });
    const stored = await allocationStore.findByCard(err.details.allocation.cardId);
    expect(stored).toHaveLength(1);
  });

  it('a failure BEFORE any allocation write (the allocation call itself throws) attaches no allocation at all', async () => {
    const allocationStore = fakeAllocationStore();
    // A hand-authored (unpublished, no `rev`) v2 document: `#allocateCard`
    // throws (ALLOCATION_REQUIRES_REV) before ever calling the store.
    const useCase = new RenderPrintDocument({ allocationStore });
    const err = await useCase.execute({
      document: v2doc({ archetype: 'quiz', blocks: [question(1)] }),
      context: { freshCard: true },
    }).catch((e) => e);
    expect(err.code).toBe('ALLOCATION_REQUIRES_REV');
    expect(err.details.allocation).toBeUndefined();
  });

  it('a quiz whose scored items are not row-mappable fails card allocation with a structured ALLOCATION_ROW_PLAN_INVALID error, and never calls the store', async () => {
    const allocationStore = fakeAllocationStore();
    let allocateCalls = 0;
    const originalAllocate = allocationStore.allocate.bind(allocationStore);
    allocationStore.allocate = async (...args) => { allocateCalls += 1; return originalAllocate(...args); };
    const useCase = new RenderPrintDocument({ allocationStore });
    // question(1) fixture's itemId never resolves in any bank (no bank-select,
    // no omr_response) — planRows must fail to find it, not silently allocate.
    const document = v2doc({ archetype: 'quiz', rev: 'deadbeef1', blocks: [question(1)] });
    await expect(useCase.execute({
      document, context: { freshCard: true },
    })).rejects.toMatchObject({ name: 'ValidationError', code: 'ALLOCATION_ROW_PLAN_INVALID' });
    expect(allocateCalls).toBe(0);
  });

  it('a collision with an existing live record on the same card+rows surfaces as a structured DomainInvariantError, and writes no second record', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const first = await useCase.execute({ document: omrSourceDoc(2), context: { freshCard: true } });
    const { cardId } = first.allocation;

    // A DIFFERENT document (different id => different recordId => not a
    // supersede) claiming the SAME rows on the SAME card.
    await expect(useCase.execute({
      document: omrSourceDoc(2, { id: 'card-fixture-collide' }),
      context: { cardId, startRow: 1 },
    })).rejects.toMatchObject({ name: 'DomainInvariantError', code: 'ALLOCATION_COLLISION' });

    const records = await allocationStore.findByCard(cardId);
    expect(records).toHaveLength(1);
    expect(records[0].documentId).toBe('card-fixture');
  });

  it('determinism: an identical re-render with the SAME context (fixed cardId, not fresh) is byte-identical (store idempotent-reprint path)', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const document = omrSourceDoc(3);
    // A fixed, EXPLICIT cardId in both calls — `freshCard` inherently mints a
    // NEW opaque card id each time (by design, spec §5.2), so it is the
    // supplied-cardId path, not `freshCard`, that is expected to be
    // idempotent under an identical context.
    const context = { cardId: '1234567', startRow: 5 };

    const first = await useCase.execute({ document, context });
    const second = await useCase.execute({ document, context });

    expect(second.allocation).toEqual(first.allocation);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    // Only ONE record was ever written — the reprint reused the identical recordId.
    expect(await allocationStore.findByCard('1234567')).toHaveLength(1);
  });

  /**
   * A worksheet source: 2 OMR-mapped multiple_choice questions with a plain
   * (non-OMR, non-bank) write-on question in between — the fixture for the
   * fix-round-1 review's Finding 1/2 (printed numbers ARE card rows; a
   * skipped write-on question must NOT shift a later OMR question's number
   * off its real row).
   */
  const mixedWorksheetDoc = (idSuffix) => ({
    schema: DOCUMENT_SOURCE_SCHEMA,
    id: `worksheet-mixed-fixture-${idSuffix}`,
    seed: 12,
    variant: 0,
    target: ['letter'],
    archetype: 'worksheet',
    blocks: [
      {
        type: 'question', itemId: 'w1', number: 1, omr: true,
        blocks: [{ type: 'rich_text', md: 'Pick one.' }, { type: 'omr_response', itemId: 'w1', choices: 2 }],
        choices: ['Yes', 'No'], answer: 'Yes',
      },
      {
        type: 'question',
        itemId: 'w2',
        number: 2,
        blocks: [{ type: 'rich_text', md: 'Explain your answer.' }, { type: 'answer_space', minPt: 40, maxPt: 60 }],
      },
      {
        type: 'question', itemId: 'w3', number: 3, omr: true,
        blocks: [{ type: 'rich_text', md: 'Pick one more.' }, { type: 'omr_response', itemId: 'w3', choices: 2 }],
        choices: ['Yes', 'No'], answer: 'No',
      },
    ],
  });

  /** The reconstructed text line (poppler `-layout`) that contains `needle`, or undefined. */
  const lineContaining = (text, needle) => text.split('\n').find((line) => line.includes(needle));

  it('worksheet mixed mode: only omr:true questions consume rows — a write-on question between two OMR ones does not widen the rowRange (planRows integration)', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const result = await useCase.execute({ document: mixedWorksheetDoc('a'), context: { freshCard: true } });
    // Only 2 rows consumed (w1, w3) — NOT 3 — proving planRows skipped the
    // non-omr write-on question when computing the card's rowRange.
    expect(result.allocation.rowRange).toEqual({ start: 1, end: 2 });
  });

  it('mixed worksheet prints EXACT card row numbers for OMR questions and NO number for the write-on question (spec §5.3, fix round 1 finding 1 — printed numbers ARE card rows)', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const result = await useCase.execute({ document: mixedWorksheetDoc('b'), context: { freshCard: true } });
    expect(result.allocation.rowRange).toEqual({ start: 1, end: 2 });

    const text = pdfText(result.bytes);
    // w1 is the FIRST row-consuming question -> row 1.
    expect(lineContaining(text, 'Pick one.')).toMatch(/\b1\./);
    // w2 is a write-on (non-omr) question -> NO number at all, not "2." —
    // a parallel/independent numbering sequence would invite the exact
    // sheet-to-card confusion this system exists to prevent.
    const w2Line = lineContaining(text, 'Explain your answer.');
    expect(w2Line).toBeDefined();
    expect(w2Line).not.toMatch(/\d+\./);
    // w3 is the SECOND row-consuming question -> row 2 (NOT 3 — the skipped
    // write-on question must not shift it).
    expect(lineContaining(text, 'Pick one more.')).toMatch(/\b2\./);
    expect(lineContaining(text, 'Pick one more.')).not.toMatch(/\b3\./);
  });

  it('mixed worksheet at startRow 10: OMR questions print 10 and 11 (still skipping the write-on question), never 10/11/12', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const result = await useCase.execute({
      document: mixedWorksheetDoc('c'), context: { freshCard: true, startRow: 10 },
    });
    expect(result.allocation.rowRange).toEqual({ start: 10, end: 11 });

    const text = pdfText(result.bytes);
    expect(lineContaining(text, 'Pick one.')).toMatch(/\b10\./);
    const w2Line = lineContaining(text, 'Explain your answer.');
    expect(w2Line).not.toMatch(/\d+\./);
    expect(lineContaining(text, 'Pick one more.')).toMatch(/\b11\./);
    expect(lineContaining(text, 'Pick one more.')).not.toMatch(/\b12\./);
  });

  it('quiz archetype regression: with EVERY question row-consuming (no gaps), numbering is unchanged — 1, 2, 3 print in document order', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const result = await useCase.execute({ document: omrSourceDoc(3), context: { freshCard: true } });
    expect(result.allocation.rowRange).toEqual({ start: 1, end: 3 });

    const text = pdfText(result.bytes);
    expect(lineContaining(text, 'OMR prompt 1')).toMatch(/\b1\./);
    expect(lineContaining(text, 'OMR prompt 2')).toMatch(/\b2\./);
    expect(lineContaining(text, 'OMR prompt 3')).toMatch(/\b3\./);
  });

  it('teacher key: an unnumbered (non-row-consuming but still bank-answerable) question falls back to its prompt-clip label, never "undefined."', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    // w2 here IS bank-answerable (an omr_response-backed multiple_choice)
    // but explicitly opts OUT of row consumption (`omr: false`) — a
    // worksheet item a teacher grades by eye, never bubbled. It still gets a
    // key entry (it has a real answer), but with no `.number` to key off.
    const document = {
      schema: DOCUMENT_SOURCE_SCHEMA,
      id: 'worksheet-unnumbered-answerable-fixture',
      seed: 12,
      variant: 0,
      target: ['letter'],
      archetype: 'worksheet',
      blocks: [
        {
          type: 'question', itemId: 'w1', number: 1, omr: true,
          blocks: [{ type: 'rich_text', md: 'Pick one.' }, { type: 'omr_response', itemId: 'w1', choices: 2 }],
          choices: ['Yes', 'No'], answer: 'Yes',
        },
        {
          type: 'question', itemId: 'w2', number: 2, omr: false,
          blocks: [
            { type: 'rich_text', md: 'Which planet is closest to the sun?' },
            { type: 'omr_response', itemId: 'w2', choices: 3 },
          ],
          choices: ['Venus', 'Mercury', 'Mars'], answer: 'Mercury',
        },
      ],
    };
    const result = await useCase.execute({
      document, context: { freshCard: true, teacher: true },
    });
    expect(result.allocation.rowRange).toEqual({ start: 1, end: 1 }); // only w1 consumes a row
    const text = pdfText(result.bytes);
    expect(text).not.toMatch(/undefined\./);
    // Prompt-clip label (same convention as a standalone short_answer key
    // entry), NOT a bare "2." — 'Mercury' is index 1 of ['Venus','Mercury','Mars'] -> letter B.
    expect(text).toMatch(/"Which planet is closest to the sun\?" —\s*B/);
  });

  it('a quiz archetype rendered without any card context is legal but warns "rendered without card allocation" — even with a store configured, it does not allocate', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const result = await useCase.execute({ document: omrSourceDoc(2) });
    expect(isPdf(result.bytes)).toBe(true);
    expect(result.allocation).toBeNull();
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/rendered without card allocation/),
    ]));
  });

  it('a worksheet rendered without card context never warns (the "no card" warning is quiz-only)', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const document = v2doc({ archetype: 'worksheet' });
    const result = await useCase.execute({ document });
    expect(result.warnings).toEqual([]);
    expect(result.allocation).toBeNull();
  });

  it('a v1 legacy document ignores card context entirely and returns allocation: null', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const result = await useCase.execute({ document: v1doc(), context: { freshCard: true } });
    expect(isPdf(result.bytes)).toBe(true);
    expect(result.allocation).toBeNull();
  });

  it('a non-card v2 render (no cardId/freshCard) returns allocation: null even with a store configured', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const result = await useCase.execute({ document: v2doc({ archetype: 'worksheet' }) });
    expect(result.allocation).toBeNull();
  });

  it('threads context.learnerId into the allocation record for supersede scoping', async () => {
    const allocationStore = fakeAllocationStore();
    const useCase = new RenderPrintDocument({ allocationStore });
    const result = await useCase.execute({
      document: omrSourceDoc(2), context: { freshCard: true, learnerId: 'kid-1' },
    });
    const [record] = await allocationStore.findByCard(result.allocation.cardId);
    expect(record.learnerId).toBe('kid-1');
  });
});
