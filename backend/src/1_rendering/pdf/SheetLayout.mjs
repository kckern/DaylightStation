/**
 * SheetLayout — pure geometry for printable interaction sheets.
 *
 * A "sheet" is a page of scannable marks (QR codes, barcodes, labels) that acts as a
 * physical input device. This module answers the only interesting question in that
 * pipeline: *where does each mark go?* Everything downstream — drawing the marks,
 * serving the PDF — merely follows the coordinates computed here.
 *
 * It is deliberately extracted as a pure function. PDF bytes are not stable across runs
 * (pdfkit stamps a fresh CreationDate and derives the trailer /ID from it), so a snapshot
 * of the output would assert nothing. Keeping the geometry here puts the part worth
 * testing somewhere a test can actually pin it down. Consequently this file imports
 * nothing and touches no clock, no randomness, and no I/O.
 *
 * Coordinates are PDF points with the origin at the TOP-LEFT and y growing downward,
 * matching what pdfkit's drawing calls expect.
 *
 * @module rendering/pdf/SheetLayout
 */

/** Vertical space reserved for a block title when the block declares one, in points. */
const DEFAULT_TITLE_HEIGHT_PT = 24;

/** Space between adjacent cells, both horizontally and vertically, in points. */
const DEFAULT_GAP_PT = 8;

/**
 * Compute cell and title placements for a sheet.
 *
 * @param {object} spec
 * @param {{widthPt:number, heightPt:number, marginPt:number}} spec.page
 * @param {Array<{id:string, title?:string, cols:number, rows:number, count:number, gapPt?:number, titleHeightPt?:number}>} spec.blocks
 * @returns {{pages:number, cells:Array<{page:number, block:string, index:number, x:number, y:number, w:number, h:number}>, titles:Array<{page:number, block:string, text:string, x:number, y:number, continued:boolean}>, underfull:Array<{block:string, capacity:number, items:number}>}}
 */
export function layout({ page, blocks }) {
  const contentW = page.widthPt - 2 * page.marginPt;
  const cells = [];
  const titles = [];

  // Vertical pen position. Blocks stack down the page, so each one starts where the
  // previous left off rather than at a position derived from its own index.
  let cursorY = page.marginPt;

  for (const block of blocks) {
    const gap = block.gapPt ?? DEFAULT_GAP_PT;
    // Cells are square: the width follows from the column count, and the height copies it.
    const cellW = (contentW - (block.cols - 1) * gap) / block.cols;
    const cellH = cellW;
    // An untitled block reserves no headroom at all — the caller opted out of the label,
    // not merely out of the text, so the cells move up to fill the space.
    const titleH = block.title ? (block.titleHeightPt ?? DEFAULT_TITLE_HEIGHT_PT) : 0;

    if (block.title) {
      titles.push({
        page: 0,
        block: block.id,
        text: block.title,
        x: page.marginPt,
        y: cursorY,
        continued: false,
      });
      cursorY += titleH;
    }

    for (let i = 0; i < block.count; i += 1) {
      const col = i % block.cols;
      const row = Math.floor(i / block.cols);
      cells.push({
        page: 0,
        block: block.id,
        index: i,
        x: page.marginPt + col * (cellW + gap),
        y: cursorY + row * (cellH + gap),
        w: cellW,
        h: cellH,
      });
    }

    const usedRows = Math.ceil(block.count / block.cols);
    cursorY += usedRows * (cellH + gap);
  }

  return { pages: 1, cells, titles, underfull: [] };
}
