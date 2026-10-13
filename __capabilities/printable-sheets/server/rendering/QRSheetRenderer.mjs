/**
 * QRSheetRenderer — walk placements, draw cells, emit a PDF.
 *
 * Deliberately dumb. Every geometric decision was already made by `SheetLayout`
 * (pure, golden-tested) and every item decision by `SheetService`. This module
 * chooses nothing; it iterates and draws.
 *
 * ## Do not add a snapshot test here
 *
 * pdfkit writes `CreationDate: new Date()` into the info dict and derives the
 * trailer `/ID` from an md5 over that dict, so two runs over identical input
 * differ byte-for-byte. A golden test would pin nothing and fail at random. That
 * is precisely why the geometry lives in a separate pure function — so the part
 * worth asserting sits somewhere a test can hold it. Smoke tests only.
 *
 * ## Marks are fitted, never drawn at intrinsic size
 *
 * A framed QR SVG is roughly TWICE its nominal module size and is not square: a
 * 108pt cell yields a 212x292 SVG, and the ratio drifts with size (0.73 at 108pt,
 * 0.68 at 64pt) because the frame and label chrome are absolute rather than
 * proportional. Drawing at intrinsic size would overflow every cell and overlap
 * neighbours. Every embed therefore passes explicit width/height plus
 * `preserveAspectRatio`, and blocks carry an `aspect` so the cell is shaped to
 * suit in the first place.
 *
 * @module rendering/pdf/QRSheetRenderer
 */
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';

const TITLE_SIZE = 18;
const BLOCK_TITLE_SIZE = 12;
const FOOTER_SIZE = 7;
const FOOTER_COLOUR = '#777';
const RULE_WIDTH = 0.8;
const RULE_COLOUR = '#999';

/**
 * @param {object} model From `SheetService.build()`.
 * @param {object} deps
 * @param {Record<string, Function>} deps.cellKinds Renderer per `block.kind`.
 * @param {object} [deps.logger]
 * @returns {Promise<Buffer>} The finished PDF.
 */
export async function renderSheetPdf(model, { cellKinds, logger = console } = {}) {
  const doc = new PDFDocument({ size: [model.page.widthPt, model.page.heightPt], margin: 0 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const finished = new Promise((resolve) => doc.on('end', resolve));

  const blockById = new Map(model.blocks.map((b) => [b.id, b]));

  for (let p = 0; p < model.placements.pages; p += 1) {
    if (p > 0) doc.addPage();

    // The sheet title appears once. Repeating it on every page would waste the
    // space that continued BLOCK titles need to do their job.
    if (p === 0 && model.title) {
      doc.font('Helvetica-Bold').fontSize(TITLE_SIZE).fillColor('black')
        .text(model.title, model.page.marginPt, model.page.marginPt / 2, { lineBreak: false });
    }

    // Section rules first: a hairline under the previous block's marks, above the
    // next block's heading. Drawn before the titles so a rule can never overprint
    // the text sitting below it.
    for (const r of (model.placements.rules || []).filter((x) => x.page === p)) {
      doc.save()
        .moveTo(r.x, r.y).lineTo(r.x + r.w, r.y)
        .lineWidth(RULE_WIDTH).strokeColor(RULE_COLOUR).stroke()
        .restore();
    }

    for (const t of model.placements.titles.filter((x) => x.page === p)) {
      doc.font('Helvetica-Bold').fontSize(BLOCK_TITLE_SIZE).fillColor('black')
        .text(t.continued ? `${t.text} (cont.)` : t.text, t.x, t.y, { lineBreak: false });
    }

    for (const cell of model.placements.cells.filter((c) => c.page === p)) {
      const block = blockById.get(cell.block);
      const item = block?.items?.[cell.index];
      // A placement with no item is not an error worth failing a print over: the
      // layout is computed from counts, so this only happens if the two drifted.
      if (!item) continue;

      try {
        const svg = await cellKinds[block.kind](item, cell, block.cellOpts);
        SVGtoPDF(doc, svg, cell.x, cell.y, {
          width: cell.w,
          height: cell.h,
          preserveAspectRatio: 'xMidYMid meet',
        });
      } catch (err) {
        // Cosmetic by definition: one unrenderable cell must not cost the whole
        // sheet. The gap is visible on paper, which is the right place for it to
        // be noticed — unlike a structural fault, which SheetService rejects
        // before a single page is drawn.
        logger.warn?.('sheet.cell.failed', {
          sheet: model.sheetId, block: cell.block, index: cell.index, error: err.message,
        });
      }
    }

    // Provenance, on every page. A laminated sheet outlives config edits, and
    // this is how someone holding one can tell whether it still matches what the
    // backend believes: the fingerprint is a hash of the CODES, so a relabelled
    // button keeps its fingerprint while a renamed id changes it.
    doc.font('Helvetica').fontSize(FOOTER_SIZE).fillColor(FOOTER_COLOUR)
      .text(`${model.sheetId ?? ''} · ${model.fingerprint}`,
        model.page.marginPt, model.page.heightPt - model.page.marginPt + 8, { lineBreak: false });
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}
