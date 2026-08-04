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
import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import { createMeasurementDocument, measureDocumentFragments } from '#rendering/school/documents/measure.mjs';
import { placeFragments } from '#rendering/school/documents/layout.mjs';
import { contentBox } from '#rendering/school/documents/furniture.mjs';
import { texToSvg } from '#rendering/school/documents/mathSvg.mjs';
import { pdfText, pdfTextItems } from '../../../../../tests/_lib/school/pdfText.mjs';

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
  const oneShot = (n) => v2doc({
    archetype: 'quiz', fit: { policy: 'one-page', typeScale: 'standard' }, blocks: manyQuestions(n),
  });

  it('fits at normal density: density "normal", no warnings', async () => {
    const useCase = new RenderPrintDocument();
    const result = await useCase.execute({ document: oneShot(9) });
    expect(result.pageCount).toBe(1);
    expect(result.density).toBe('normal');
    expect(result.warnings).toEqual([]);
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

    // Furniture's own continuation-strip title (page 2 only — page 1 shows
    // the real header instead) must sit at the SAME left edge as page 2's
    // body text — the "body-left == furniture-left" the reviewer demanded,
    // not just two numbers that both happen to match contentBox in isolation.
    const stripTitle = firstWordOn(2, document.id);
    expect(stripTitle, 'page 2 continuation-strip title').toBeDefined();
    expect(stripTitle.xPt).toBeCloseTo(page2Body.xPt, 1);
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
