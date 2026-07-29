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
  const underfull = [];

  // Bottom of the printable area — the line nothing may cross.
  const bottom = page.heightPt - page.marginPt;

  // Vertical pen position. Blocks stack down the page, so each one starts where the
  // previous left off rather than at a position derived from its own index.
  let cursorY = page.marginPt;
  let pageIdx = 0;

  for (const block of blocks) {
    const gap = block.gapPt ?? DEFAULT_GAP_PT;
    // Cells are square: the width follows from the column count, and the height copies it.
    // Columns alone cannot express "3 across, but small". Without a cap, cell
    // size is purely page-width / cols, so a 3-column block always eats a third
    // of the page each and a sheet of four such blocks runs to four pages of
    // mostly whitespace. Capping the width lets a block keep the grid shape the
    // content wants while spending only the room it needs. Horizontal placement of
    // the resulting narrower grid is then the block's own choice (`align`).
    const naturalW = (contentW - (block.cols - 1) * gap) / block.cols;
    const cellW = block.maxCellWPt ? Math.min(naturalW, block.maxCellWPt) : naturalW;

    // Centre on the FULL row width (cols), not on how many items a given row got.
    // Centring each row independently would make a short final row float between
    // the columns above it, which reads as misalignment rather than as centring.
    // `justify` spends the row's leftover width on the GAPS instead of on a margin,
    // so a smaller mark ends up further from its neighbours. On a sheet read by a
    // hand scanner that is a functional property, not a cosmetic one: the failure
    // being designed against is catching the code next to the one you aimed at.
    // Vertical spacing stays `gapPt` — only the horizontal axis is redistributed,
    // because only the horizontal axis has slack to redistribute.
    const colGap = block.align === 'justify' && block.cols > 1
      ? Math.max(gap, (contentW - block.cols * cellW) / (block.cols - 1))
      : gap;

    const rowW = block.cols * cellW + (block.cols - 1) * colGap;
    const originX = block.align === 'center'
      ? page.marginPt + Math.max(0, (contentW - rowW) / 2)
      : page.marginPt;
    // `aspect` is the mark's width/height. Square is only right for a bare glyph:
    // a framed QR with a label strip measures ~0.73 w/h, and that ratio DRIFTS with
    // size (0.726 at a 108pt module, 0.677 at 64pt) because the frame and label
    // chrome are absolute rather than proportional. Forcing square cells would
    // letterbox every mark on the sheet, so the block declares the shape it needs
    // and the emitter scales to fit inside it.
    const cellH = cellW / (block.aspect || 1);
    // An untitled block reserves no headroom at all — the caller opted out of the label,
    // not merely out of the text, so the cells move up to fill the space.
    const titleH = block.title ? (block.titleHeightPt ?? DEFAULT_TITLE_HEIGHT_PT) : 0;

    // `cols` is fixed but `rows` is only a per-page maximum: config declares the shape,
    // the data decides how many marks there actually are. A short block prints one
    // partial row and stops — it is never padded and never an error. It IS worth
    // reporting, though: a fridge sheet with four of twenty-five container slots filled
    // is usually a sign the caller's data went missing, so the caller gets told.
    const capacity = block.cols * block.rows;
    if (block.count < capacity) {
      underfull.push({ block: block.id, capacity, items: block.count });
    }

    // A block is emitted one page-chunk at a time. `placed` counts items already laid
    // out and doubles as the absolute item index, which must NOT restart at a page
    // break: the caller maps index → item, so cell 25 of a 30-item block is index 25
    // whichever page it lands on.
    let placed = 0;
    let continued = false;

    while (placed < block.count) {
      // How many rows survive between the pen and the bottom margin, capped at the
      // block's declared per-page maximum. The trailing `+ gap` is because the last row
      // on a page needs no gap beneath it.
      let rowsHere = Math.min(
        block.rows,
        Math.max(0, Math.floor((bottom - cursorY - titleH + gap) / (cellH + gap))),
      );

      if (rowsHere < 1) {
        // Not even one row fits under whatever precedes us. Move to a fresh page and
        // re-measure. Guard against spinning forever: if the pen is ALREADY at the top
        // of a page and a row still will not fit, no page will ever hold this block, so
        // place a row anyway and let it overflow visibly rather than hang the request.
        if (cursorY > page.marginPt) {
          pageIdx += 1;
          cursorY = page.marginPt;
          continue;
        }
        rowsHere = 1;
      }

      if (block.title) {
        // The title repeats on every page the block spans. `continued` lets the emitter
        // mark the repeats (e.g. "Containers (cont.)") so a reader picking up page two
        // knows they are mid-block rather than looking at a second block of the same name.
        titles.push({
          page: pageIdx,
          block: block.id,
          text: block.title,
          // Follows the grid's origin, not the page margin, so a centred block's
          // heading sits over its own columns instead of drifting to the left.
          x: originX,
          y: cursorY,
          continued,
        });
        cursorY += titleH;
      }

      const chunk = Math.min(block.count - placed, rowsHere * block.cols);
      for (let i = 0; i < chunk; i += 1) {
        const col = i % block.cols;
        const row = Math.floor(i / block.cols);
        cells.push({
          page: pageIdx,
          block: block.id,
          index: placed + i,
          x: originX + col * (cellW + colGap),
          y: cursorY + row * (cellH + gap),
          w: cellW,
          h: cellH,
        });
      }

      const usedRows = Math.ceil(chunk / block.cols);
      cursorY += usedRows * (cellH + gap);
      placed += chunk;
      continued = true;

      if (placed < block.count) {
        pageIdx += 1;
        cursorY = page.marginPt;
      }
    }
  }

  return { pages: pageIdx + 1, cells, titles, underfull };
}
