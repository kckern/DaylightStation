/**
 * Task 6 — page furniture: the page-x-of-y footer (every page, carrying the
 * OMR card number when the render is card-attached) and the gutter margin
 * (fixed side, or alternating per page parity under `duplex`).
 *
 * `drawFurniture`/`contentBox` are exercised two ways:
 *  - directly, against a recording stub standing in for a pdfkit document —
 *    the same "pure arithmetic, testable without a PDF context" spirit as
 *    `layout.mjs` — so every assertion here is exact, not a pixel diff;
 *  - once through the real renderer (`DocumentPdfRenderer`'s opt-in
 *    `options.furniture`), proving the whole pipeline — measure, place,
 *    draw — produces a valid multi-page PDF once furniture is wired in.
 */
import { describe, it, expect } from 'vitest';
import { drawFurniture, contentBox } from './furniture.mjs';
import { createWorkbookTheme } from './workbookTheme.mjs';
import { createDocumentPdfRenderer } from './DocumentPdfRenderer.mjs';
import { texToSvg } from './mathSvg.mjs';

const theme = createWorkbookTheme();

/** Records every call made through the small chainable surface `furniture.mjs` uses. */
function createRecorder() {
  const calls = [];
  const round = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);
  const chain = {
    font(name) { calls.push({ op: 'font', name }); return chain; },
    fontSize(n) { calls.push({ op: 'fontSize', sizePt: round(n) }); return chain; },
    fillColor(c) { calls.push({ op: 'fillColor', color: c }); return chain; },
    save() { calls.push({ op: 'save' }); return chain; },
    restore() { calls.push({ op: 'restore' }); return chain; },
    rect(x, y, width, height) {
      calls.push({ op: 'rect', xPt: round(x), yPt: round(y), width: round(width), height: round(height) });
      return chain;
    },
    fill() { calls.push({ op: 'fill' }); return chain; },
    text(str, x, y, opts) {
      calls.push({
        op: 'text', str, xPt: round(x), yPt: round(y), width: round(opts?.width), align: opts?.align,
      });
      return chain;
    },
  };
  return { chain, calls };
}

const textCalls = (calls) => calls.filter((c) => c.op === 'text');

describe('furniture — contentBox', () => {
  it('reserves only the footer band out of pageHeightPt, no gutter by default', () => {
    const box = contentBox(theme, {});
    expect(box.pageHeightPt).toBeCloseTo(
      theme.page.heightPt - theme.furniture.footerBandPt, 6,
    );
    expect(box.marginPt).toBe(theme.page.marginPt);
    expect(box.gutterPt).toBe(0);
    expect(box.contentLeftPt).toBe(theme.page.marginPt);
    expect(box.contentRightPt).toBe(theme.page.widthPt - theme.page.marginPt);
    expect(box.widthPt).toBeCloseTo(box.contentRightPt - box.contentLeftPt, 6);
  });

  it('non-duplex gutter sits on a fixed (left) side on every page', () => {
    const p1 = contentBox(theme, { gutter: true, duplex: false, pageIndex: 0 });
    const p2 = contentBox(theme, { gutter: true, duplex: false, pageIndex: 1 });
    expect(p1.contentLeftPt).toBe(theme.page.marginPt + theme.furniture.gutterPt);
    expect(p1.contentRightPt).toBe(theme.page.widthPt - theme.page.marginPt);
    expect(p2.contentLeftPt).toBe(p1.contentLeftPt);
    expect(p2.contentRightPt).toBe(p1.contentRightPt);
    expect(p1.gutterPt).toBe(theme.furniture.gutterPt);
  });

  it('duplex gutter flips side by page parity (mirror margins)', () => {
    const recto = contentBox(theme, { gutter: true, duplex: true, pageIndex: 0 }); // page 1
    const verso = contentBox(theme, { gutter: true, duplex: true, pageIndex: 1 }); // page 2
    expect(recto.contentLeftPt).toBe(theme.page.marginPt + theme.furniture.gutterPt);
    expect(recto.contentRightPt).toBe(theme.page.widthPt - theme.page.marginPt);
    expect(verso.contentLeftPt).toBe(theme.page.marginPt);
    expect(verso.contentRightPt).toBe(theme.page.widthPt - theme.page.marginPt - theme.furniture.gutterPt);
    // Both sides give up the same room — only which side moves.
    expect(recto.widthPt).toBeCloseTo(verso.widthPt, 6);
  });

  it('an explicit numeric gutter overrides the theme default', () => {
    const box = contentBox(theme, { gutter: 40, duplex: false, pageIndex: 0 });
    expect(box.gutterPt).toBe(40);
    expect(box.contentLeftPt).toBe(theme.page.marginPt + 40);
  });

  it('rejects a theme with no furniture tokens', () => {
    expect(() => contentBox({ page: theme.page }, {})).toThrow(/furniture/);
  });
});

describe('furniture — drawFurniture', () => {
  it('draws "page n of pageCount" on every page of a 3-page document', () => {
    const results = [1, 2, 3].map((page) => {
      const { chain, calls } = createRecorder();
      drawFurniture(chain, { theme, page, pageCount: 3 });
      return textCalls(calls).find((c) => c.str === `Page ${page} of 3`);
    });
    expect(results.every(Boolean)).toBe(true);
  });

  it('prints plain "Page X of Y" and nothing else when no cardId is given', () => {
    const { chain, calls } = createRecorder();
    drawFurniture(chain, { theme, page: 2, pageCount: 3 });
    expect(textCalls(calls).map((c) => c.str)).toEqual(['Page 2 of 3']);
  });

  it('prints the complete card identity on every page, page 1 included', () => {
    for (const page of [1, 2]) {
      const { chain, calls } = createRecorder();
      drawFurniture(chain, {
        theme, page, pageCount: 2, card: { cardId: '5922785', startRow: 7, endRow: 12 },
      });
      expect(textCalls(calls).map((c) => c.str), `page ${page}`).toEqual([
        `Student No. 5922785 · Rows 7–12 · Page ${page} of 2`,
      ]);
    }
  });

  it('never draws a title or a "Name:" line — the continuation strip is gone', () => {
    const { chain, calls } = createRecorder();
    drawFurniture(chain, {
      theme, page: 2, pageCount: 2, card: { cardId: '5922785', startRow: 7, endRow: 12 },
    });
    const texts = textCalls(calls).map((c) => c.str);
    expect(texts.some((t) => t.includes('Name:'))).toBe(false);
    expect(texts).toEqual(['Student No. 5922785 · Rows 7–12 · Page 2 of 2']);
  });

  it('footer sits at the configured printer-safe inset near the page edge', () => {
    const rec = createRecorder();
    drawFurniture(rec.chain, { theme, page: 1, pageCount: 1 });
    const footerCall = textCalls(rec.calls).find((c) => c.str === 'Page 1 of 1');
    expect(footerCall.yPt).toBe(theme.page.heightPt - theme.footer.bottomInsetPt - theme.footer.sizePt);
  });

  it('fixed (non-duplex) gutter keeps furniture on the same side across pages', () => {
    const p1 = createRecorder();
    drawFurniture(p1.chain, { theme, page: 1, pageCount: 2, gutter: true, duplex: false });
    const p2 = createRecorder();
    drawFurniture(p2.chain, { theme, page: 2, pageCount: 2, gutter: true, duplex: false });
    const footer1 = textCalls(p1.calls).find((c) => c.str === 'Page 1 of 2');
    const footer2 = textCalls(p2.calls).find((c) => c.str === 'Page 2 of 2');
    expect(footer1.xPt).toBe(theme.page.marginPt + theme.furniture.gutterPt);
    expect(footer2.xPt).toBe(footer1.xPt);
  });

  it('duplex gutter flips the footer x-offset by page parity', () => {
    const recto = createRecorder(); // page 1 (odd)
    drawFurniture(recto.chain, { theme, page: 1, pageCount: 2, gutter: true, duplex: true });
    const verso = createRecorder(); // page 2 (even)
    drawFurniture(verso.chain, { theme, page: 2, pageCount: 2, gutter: true, duplex: true });

    const rectoFooter = textCalls(recto.calls).find((c) => c.str === 'Page 1 of 2');
    const versoFooter = textCalls(verso.calls).find((c) => c.str === 'Page 2 of 2');

    expect(rectoFooter.xPt).toBe(theme.page.marginPt + theme.furniture.gutterPt); // gutter on the left
    expect(versoFooter.xPt).toBe(theme.page.marginPt); // gutter on the right instead
    expect(versoFooter.xPt).not.toBe(rectoFooter.xPt);
  });

  it('rejects a non-positive-integer page, or a pageCount below page', () => {
    const rec = createRecorder();
    expect(() => drawFurniture(rec.chain, { theme, page: 0, pageCount: 3 })).toThrow(/page/);
    expect(() => drawFurniture(rec.chain, { theme, page: 5, pageCount: 3 })).toThrow(/pageCount/);
  });

  it('rejects a theme with no furniture tokens', () => {
    const rec = createRecorder();
    expect(() => drawFurniture(rec.chain, { theme: { page: theme.page }, page: 1, pageCount: 1 })).toThrow(/furniture/);
  });

  it('snapshot: a furnished 3-page document\'s full furniture draw trace', () => {
    const trace = [1, 2, 3].map((page) => {
      const rec = createRecorder();
      drawFurniture(rec.chain, {
        theme, page, pageCount: 3,
        card: { cardId: '5922785', startRow: 7, endRow: 12 },
        duplex: true, gutter: true,
      });
      return { page, calls: textCalls(rec.calls) };
    });
    expect(trace).toMatchSnapshot();
  });
});

describe('furniture — DocumentPdfRenderer integration (opt-in `options.furniture`)', () => {
  const renderer = createDocumentPdfRenderer({ theme, texToSvg });

  // Tuned against the real pipeline (see task-6 report): 28 filler paragraphs
  // lands mid-range under workbookTheme's default scale/density with
  // furniture's footer-band reservation active — not a borderline count that a
  // stray leading-height tweak could tip over.
  const fixtureBlocks = Array.from({ length: 28 }, (_, i) => ({
    type: 'rich_text',
    md: `Paragraph ${i + 1}. The quick brown fox jumps over the lazy dog. This is filler `
      + 'text to occupy vertical space on the page so the document spans multiple pages '
      + 'reliably for a furniture test fixture. Repeat repeat repeat.',
  }));
  const fixtureDoc = {
    id: 'furniture-fixture', title: 'Furniture Fixture', seed: 1, variant: 0, target: ['letter'], blocks: fixtureBlocks,
  };

  it('produces a real, valid 3-page PDF with furniture enabled', async () => {
    const { pdf, pageCount } = await renderer.render(fixtureDoc, {
      studentName: 'Workbook Learner',
      furniture: { duplex: true, gutter: true },
    });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount).toBe(3);
  });

  it('is deterministic: same document, same seed, byte-identical furnished renders', async () => {
    const opts = { studentName: 'Workbook Learner', furniture: { duplex: true, gutter: true } };
    const first = await renderer.render(fixtureDoc, opts);
    const second = await renderer.render(fixtureDoc, opts);
    expect(first.pdf.equals(second.pdf)).toBe(true);
  });
});
