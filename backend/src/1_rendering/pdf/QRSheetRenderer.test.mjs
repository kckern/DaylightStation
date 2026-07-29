// @vitest-environment node
//
// SMOKE TESTS ONLY, DELIBERATELY.
//
// pdfkit stamps `CreationDate: new Date()` into the info dict and derives the
// trailer /ID from an md5 over that dict, so two runs of identical input produce
// different bytes. A snapshot test here would pin nothing and fail at random.
// Every decision worth asserting was already made upstream: geometry in
// SheetLayout (pure, golden-tested) and item resolution in SheetService. This
// module only walks placements and draws, so "it produced a valid PDF and did
// not fall over" is the honest extent of what can be checked.
import { describe, it, expect } from 'vitest';
import { renderSheetPdf } from './QRSheetRenderer.mjs';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text x="1" y="8">X</text></svg>';

function model({ pages = 1, cells, blocks, titles = [] } = {}) {
  return {
    sheetId: 'test',
    title: 'Test sheet',
    fingerprint: 'abc123',
    page: { widthPt: 612, heightPt: 792, marginPt: 36 },
    blocks: blocks || [{ id: 'b', kind: 'label', cellOpts: {}, items: [{ code: 'x', label: 'X' }] }],
    placements: {
      pages,
      cells: cells || [{ page: 0, block: 'b', index: 0, x: 36, y: 60, w: 100, h: 100 }],
      titles,
    },
  };
}

const kinds = { label: () => SVG };
const countPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

describe('renderSheetPdf', () => {
  it('emits a non-trivial PDF', async () => {
    const buf = await renderSheetPdf(model(), { cellKinds: kinds });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(800);
  });

  it('a cell renderer that throws does not abort the page', async () => {
    const warnings = [];
    const buf = await renderSheetPdf(model(), {
      cellKinds: { label: () => { throw new Error('nope'); } },
      logger: { warn: (e, d) => warnings.push([e, d]) },
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(warnings.map((w) => w[0])).toContain('sheet.cell.failed');
  });

  it('draws one PDF page per layout page', async () => {
    const one = await renderSheetPdf(model(), { cellKinds: kinds });
    const two = await renderSheetPdf(model({
      pages: 2,
      cells: [
        { page: 0, block: 'b', index: 0, x: 36, y: 60, w: 100, h: 100 },
        { page: 1, block: 'b', index: 0, x: 36, y: 60, w: 100, h: 100 },
      ],
    }), { cellKinds: kinds });
    expect(countPages(one)).toBe(1);
    expect(countPages(two)).toBe(2);
  });

  it('skips a cell whose item is missing rather than throwing', async () => {
    const buf = await renderSheetPdf(model({
      cells: [{ page: 0, block: 'b', index: 99, x: 36, y: 60, w: 100, h: 100 }],
    }), { cellKinds: kinds });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('accepts an async cell renderer', async () => {
    const buf = await renderSheetPdf(model(), { cellKinds: { label: async () => SVG } });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
