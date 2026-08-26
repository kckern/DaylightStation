/**
 * THE progress bar for thermal receipts. One drawing, every surface.
 *
 * There used to be two, in one file, drawn by two unrelated blocks of code:
 *
 *  - The **agenda lesson card** drew a railroad track — an outlined box, a
 *    solid fill from the left, tick marks dividing it into lessons.
 *  - The **result receipt** drew a thermometer — a 4px rule with a heavy slab
 *    of fill on it and ticks standing outside the line, no container at all.
 *
 * They disagreed about the bar's height, its label row, whether the empty
 * remainder is visible, where ticks live, and when to drop them. Two surfaces
 * a child sees minutes apart, answering "how far along am I" in two visual
 * languages.
 *
 * WHAT SURVIVED FROM EACH, and why:
 *
 *  - **The outlined track (agenda).** The empty remainder has to be visible or
 *    the fraction cannot be read: a fill with no container says "this much"
 *    and never "…out of this". The thermometer's hairline could not carry
 *    that — its 4px rule and its heavy fill did not read as the same object,
 *    so the right-hand end was ambiguous.
 *  - **Ticks inside the track (agenda).** Outside the line they read as
 *    scale furniture; inside they divide the thing being measured.
 *  - **One tick per lesson (result).** The filled edge then lands exactly on
 *    the `completed`-th tick by construction. A tick standing for "a tenth of
 *    the way" cannot line up with a fill computed as `completed / total`.
 *  - **The width-aware tick drop (result).** Dropping ticks below a legible
 *    gap beats the agenda's fixed `total <= 40` cap: what matters is how many
 *    PIXELS each tick gets, which depends on the track's width, not on the
 *    lesson count alone.
 *  - **The in-progress hatch (both).** Solid means done and empty means
 *    untouched; the unit a child is working through right now is neither.
 *    Now with a minimum: a hatch too narrow to fit two stripes is a smudge,
 *    and reads as dirt on the tape rather than as a state.
 *  - **Position, not tally (both, already agreed).** "16 of 23" is where the
 *    child IS. `activeProgressPosition` owns that arithmetic.
 *
 * Pure drawing against a 2D context — no I/O, no fonts registered here, and
 * every dimension read from the theme it is handed.
 *
 * @module rendering/school/documents/progressBar
 */
import { activeProgressPosition } from '#domains/school/progressRows.mjs';

/** Height of one label + bar + gap row, so a caller can measure before drawing. */
export function progressRowHeight(theme) {
  const p = theme.progress;
  return p.labelHeight + p.barHeight + p.rowGap;
}

/** Total height of n rows — what a band needs to reserve. */
export function progressRowsHeight(theme, rows) {
  return (Array.isArray(rows) ? rows : []).length * progressRowHeight(theme);
}

/**
 * Rows worth drawing: a bar needs a positive total, or it is a divide by zero
 * wearing a label.
 */
export function usableProgressRows(rows) {
  const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
  return list.filter((row) => row && Number.isInteger(row.total) && row.total > 0);
}

/**
 * Draw one row — label line, then the track — and return its height.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object}  args
 * @param {object}  args.theme  the receipt theme (reads `theme.progress`, `fonts`, `colors`)
 * @param {object}  args.row    `{label, completed, total, inProgress?}`
 * @param {number}  args.x      left edge of the track
 * @param {number}  args.y      top of the label line
 * @param {number}  args.width  track width
 */
export function drawProgressRow(ctx, { theme, row, x, y, width }) {
  const p = theme.progress;
  const total = row.total;
  const completed = Math.max(0, Math.min(total, row.completed ?? 0));
  const complete = completed >= total;

  ctx.save();
  ctx.fillStyle = theme.colors.text;
  ctx.strokeStyle = theme.colors.border;
  ctx.textBaseline = 'top';

  // The label row: what is being measured, and where in it the child stands.
  ctx.textAlign = 'left';
  ctx.font = theme.fonts.eyebrow;
  ctx.fillText(`${String(row.label ?? '').toUpperCase()}${complete ? ' COMPLETE' : ''}`, x, y);
  ctx.textAlign = 'right';
  ctx.font = theme.fonts.code;
  ctx.fillText(`${activeProgressPosition(row)} of ${total}`, x + width, y);

  const barY = y + p.labelHeight;
  // The container first, so everything after is drawn INTO a known box.
  ctx.lineWidth = p.borderWidth;
  ctx.strokeRect(x, barY, width, p.barHeight);

  const filled = (completed / total) * width;
  if (filled > 0) ctx.fillRect(x, barY, filled, p.barHeight);

  // In progress: the segment being worked through right now.
  const inProgress = Number.isInteger(row.inProgress) ? row.inProgress : 0;
  if (inProgress > 0 && completed + inProgress <= total) {
    const hatchStart = x + filled;
    const hatchEnd = x + ((completed + inProgress) / total) * width;
    // Under two stripes' worth of room the hatch is a smudge, not a texture —
    // and a smudge on thermal tape reads as a printer fault. The bar's own
    // fill edge and the "n of m" beside it already carry the position.
    if (hatchEnd - hatchStart >= 2 * p.hatchPitch) {
      ctx.lineWidth = p.hatchWidth;
      for (let hx = hatchStart + p.hatchPitch / 2; hx < hatchEnd; hx += p.hatchPitch) {
        ctx.beginPath();
        ctx.moveTo(hx, barY);
        ctx.lineTo(hx, barY + p.barHeight);
        ctx.stroke();
      }
    }
  }

  // One tick per lesson, inside the track, dropped whole rather than thinned
  // to a wrong count when they stop being countable.
  if (width / total >= p.minTickGap) {
    ctx.lineWidth = p.tickWidth;
    for (let index = 1; index < total; index += 1) {
      const tickX = x + (index / total) * width;
      ctx.beginPath();
      ctx.moveTo(tickX, barY);
      ctx.lineTo(tickX, barY + p.barHeight);
      ctx.stroke();
    }
  }

  ctx.restore();
  return progressRowHeight(theme);
}

/** Draw a stack of rows from `y` downward; returns the height consumed. */
export function drawProgressRows(ctx, { theme, rows, x, y, width }) {
  let cursor = y;
  for (const row of usableProgressRows(rows)) {
    cursor += drawProgressRow(ctx, { theme, row, x, y: cursor, width });
  }
  return cursor - y;
}

export default { drawProgressRow, drawProgressRows, progressRowHeight, progressRowsHeight, usableProgressRows };
