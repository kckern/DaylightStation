// frontend/src/modules/Surround/fit.test.js
//
// The parts of the fit that are decidable without a layout engine: WHAT gets
// measured, and what the ladder's floors are worth. The ladder ITSELF is a
// search whose every step is a measurement, so it is asserted where it can only
// be asserted honestly — in `band.measure.test.jsx`, against the real compiled
// stylesheet in real Chromium with the real vendored faces.

import { describe, it, expect } from 'vitest';
import {
  bandPools, fitBand, fitStyle,
  PROSE_FLOOR_PX, PROSE_CEILING_PX, LEADING_FLOOR, LEADING_MAX,
} from './fit.js';

/**
 * THE FIT IS A CONSTANT OF THE PIECE. If the pool were "what is on screen right
 * now", the type would resize at every movement boundary — the reserved-height
 * law broken by the mechanism that replaced the reserve. These specs pin that
 * the pool is the union over the whole work.
 */
describe('bandPools — everything either register can ever show', () => {
  const WORK = {
    facts: ['A fact about 1804.', 'Another fact.'],
    movements: [
      { n: 1, listen: ['Listen for the horn.', 'And the off-beat chords.'] },
      { n: 2, listen: ['The basses mutter.'] },
    ],
    cues: [{ at: 976, text: 'The funeral march.' }],
  };

  it('gives the NOW register every movement’s notes, not just the sounding one', () => {
    const pools = bandPools(WORK);
    expect(pools.now).toEqual(expect.arrayContaining([
      'Listen for the horn.', 'And the off-beat chords.', 'The basses mutter.',
    ]));
  });

  it('includes the cues, because a cue lands in the NOW register at full size', () => {
    expect(bandPools(WORK).now).toContain('The funeral march.');
  });

  /**
   * A movement with no listening notes BORROWS the piece pool under its header,
   * so those facts have to be measured against the NOW register's room too — it
   * is a different box from the piece register's, with a different header above
   * it. Where nothing borrows, they are not measured there and the fit is not
   * over-constrained by a string that register will never show.
   */
  it('measures the facts in the NOW register only where a movement will borrow them', () => {
    expect(bandPools(WORK).now).not.toContain('A fact about 1804.');
    const borrows = {
      ...WORK,
      movements: [...WORK.movements, { n: 3 }],   // no listen notes authored
    };
    expect(bandPools(borrows).now).toContain('A fact about 1804.');
  });

  it('gives the cues to the PIECE register when the band does not split', () => {
    const unsplit = { ...WORK, movements: [] };
    expect(bandPools(unsplit).piece).toContain('The funeral march.');
    expect(bandPools(unsplit).now).toEqual([]);
  });

  it('drops empties, and survives a payload with nothing in it', () => {
    expect(bandPools({ facts: ['', '   ', null, 'Real.'], movements: [], cues: null }))
      .toEqual({ piece: ['Real.'], now: [] });
    expect(bandPools({})).toEqual({ piece: [], now: [] });
  });
});

describe('the ladder’s floors', () => {
  /**
   * THE PROSE FLOOR IS ABOVE THE LABEL FLOOR, and that gap is the whole
   * argument. The frame's stated ten-foot floor for labels is 0.72rem — earned
   * by being a short, tracked, small-cap string the eye reads as a shape.
   * Continuous prose is read glyph by glyph. EB Garamond's x-height is 0.42em
   * (measured against the vendored binary), so the label floor buys 4.84px of
   * x-height and this one buys 5.91px — 22% more, on a fleet running at device
   * pixel ratio 1, where an x-height is exactly that many device rows.
   */
  const LABEL_FLOOR_PX = 0.72 * 16;
  const X_HEIGHT = 0.42;

  it('sets prose above the label floor, by the x-height margin the argument claims', () => {
    expect(PROSE_FLOOR_PX).toBeGreaterThan(LABEL_FLOOR_PX);
    expect((PROSE_FLOOR_PX * X_HEIGHT) / (LABEL_FLOOR_PX * X_HEIGHT)).toBeGreaterThan(1.2);
    expect(PROSE_FLOOR_PX * X_HEIGHT, 'the x-height at the floor').toBeCloseTo(5.91, 1);
  });

  it('keeps a ceiling under the note, so it cannot shout down the work’s own title', () => {
    expect(PROSE_CEILING_PX).toBeGreaterThan(PROSE_FLOOR_PX);
    expect(PROSE_CEILING_PX).toBe(1.5 * 16);
  });

  /**
   * EB Garamond's ink extent is 0.71em of ascender and 0.29em of descender —
   * exactly 1.00em from the bottom of a `g` to the top of an `h`, measured. So
   * the clear space between consecutive lines is `leading - 1.00` in ems,
   * directly. The floor must leave a real gap, and must not undercut the face's
   * own `line-height: normal` (1.31, measured) by more than a fifth.
   */
  it('leaves real air between lines at the tightest leading it allows', () => {
    const INK_EXTENT = 1.00;
    const NORMAL = 1.31;
    expect(LEADING_FLOOR - INK_EXTENT, 'the lines interlock at this floor')
      .toBeGreaterThanOrEqual(0.2);
    expect(LEADING_FLOOR / NORMAL, 'tighter than four fifths of the face’s own metrics')
      .toBeGreaterThan(0.8);
    expect(LEADING_MAX).toBeGreaterThan(LEADING_FLOOR);
  });
});

/**
 * A stand-in for layout, built by hand on the elements this test creates —
 * instances, not prototypes, so nothing leaks. happy-dom has no layout at all
 * (every box is 0x0 and `fitBand` correctly declines to fit one), so the only
 * way to exercise the SEARCH from here is to supply a ruler. It is a plain
 * monotone model: characters per line from the box's width and the trial size,
 * lines times the trial leading. The REAL ruler is measured in Chromium against
 * the compiled stylesheet and the vendored faces (`band.measure.test.jsx`);
 * what this exercises is the search's arithmetic, for which any monotone ruler
 * will do.
 */
function ruledBand({ roomPx, widthPx, emPerChar = 0.46 }) {
  const root = document.createElement('div');
  root.innerHTML = `
    <div data-testid="surround-ticker-zone-piece">
      <p class="surround-cue-ticker__text"><span class="surround-cue-ticker__line"></span>
      <span class="surround-cue-ticker__probe"></span></p>
    </div>`;
  const box = root.querySelector('.surround-cue-ticker__text');
  const probe = root.querySelector('.surround-cue-ticker__probe');
  Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => roomPx });
  Object.defineProperty(box, 'clientWidth', { configurable: true, get: () => widthPx });
  probe.getBoundingClientRect = () => {
    const size = parseFloat(probe.style.fontSize) || 16;
    const leading = parseFloat(probe.style.lineHeight) || 1.35;
    const width = parseFloat(probe.style.width) || widthPx;
    const perLine = width / (emPerChar * size);
    const lines = Math.max(1, Math.ceil((probe.textContent?.length ?? 0) / perLine));
    return { width, height: lines * size * leading };
  };
  return root;
}

describe('the ladder’s search', () => {
  /**
   * REVIEW FINDING I-5 — THE SNAP-TO-GRID MUST NOT UNDERCUT THE FLOOR.
   *
   * `largestPassing` rounds its answer down to the search step, and 14.08 is not
   * on a 0.25 grid: `Math.floor(14.08 / 0.25) * 0.25` is **14.0**, eight
   * hundredths of a pixel below the floor the whole no-ellipsis argument rests
   * on. It bites in exactly the case a tighter band or a longer corpus produces
   * — where only the bottom rung passes — and it would have reported itself as
   * a floor violation rather than as the rounding bug it is.
   *
   * The room here is two lines at the floor, exactly, so nothing above the floor
   * can fit and `largestPassing` returns its own low bound.
   *
   * TO GO RED: drop the `Math.max(lo, …)` clamp in `largestPassing`.
   */
  it('never returns a size below its own floor, even when only the floor fits', () => {
    const root = ruledBand({ roomPx: 2 * PROSE_FLOOR_PX * LEADING_FLOOR, widthPx: 275 });
    document.body.appendChild(root);
    const fit = fitBand(root, { piece: ['x'.repeat(84)] });
    expect(fit, 'the ruler produced no fit at all').not.toBeNull();
    expect(
      fit.fontPx,
      `the ladder settled at ${fit.fontPx}px against a ${PROSE_FLOOR_PX}px floor — `
      + 'the snap to the search grid undercut the floor it was bounded by',
    ).toBeGreaterThanOrEqual(PROSE_FLOOR_PX);
    expect(fit.fontPx).toBe(PROSE_FLOOR_PX);
    expect(fit.leading).toBeGreaterThanOrEqual(LEADING_FLOOR);
    expect(fit.rejected, 'a note that fits at the floor was rejected').toEqual([]);
    root.remove();
  });

  it('takes the ceiling whole when there is room for it', () => {
    const root = ruledBand({ roomPx: 600, widthPx: 600 });
    document.body.appendChild(root);
    const fit = fitBand(root, { piece: ['A short fact.'] });
    expect(fit.fontPx).toBe(PROSE_CEILING_PX);
    expect(fit.leading).toBe(LEADING_MAX);
    root.remove();
  });

  /**
   * THE LADDER'S ORDER, as the user set it: tighten the leading to HOLD a size,
   * and only give the leading back once a smaller size has paid for it. A room
   * that fits three lines at the tight leading and only two at the loose one
   * must come back tight — the alternative (loose leading, smaller type) is the
   * rung below.
   */
  it('tightens the leading before it drops the size', () => {
    // A two-line note in a 52px box. The loose leading can afford at most
    // 52 / (2 x 1.35) = 19.26px of type; the tight one can afford 20.8px. The
    // ladder's order is the user's — hold the SIZE and spend the leading on it —
    // so it must come back with the bigger type and the tighter leading, not the
    // other way round.
    const roomPx = 52;
    const root = ruledBand({ roomPx, widthPx: 500 });
    document.body.appendChild(root);
    const fit = fitBand(root, { piece: ['x'.repeat(84)] });
    const looseCeiling = roomPx / (2 * LEADING_MAX);
    expect(
      fit.fontPx,
      `the ladder settled at ${fit.fontPx}px — no bigger than the ${looseCeiling.toFixed(2)}px the `
      + 'loose leading could already afford, so it gave the leading back instead of spending it',
    ).toBeGreaterThan(looseCeiling);
    expect(fit.leading).toBeLessThan(LEADING_MAX);
    expect(fit.leading).toBeGreaterThanOrEqual(LEADING_FLOOR);
    expect(fit.fontPx * fit.leading * 2).toBeLessThanOrEqual(roomPx + 0.05);
    root.remove();
  });

  /** What cannot be set at the floors is rejected, with a MEASURED budget. */
  it('rejects what the floors cannot hold, and bisects the character budget', () => {
    const root = ruledBand({ roomPx: 2 * PROSE_FLOOR_PX * LEADING_FLOOR, widthPx: 275 });
    document.body.appendChild(root);
    const long = 'y'.repeat(400);
    const fit = fitBand(root, { piece: ['x'.repeat(84), long] });
    expect(fit.rejected).toHaveLength(1);
    const [r] = fit.rejected;
    expect(r.zone).toBe('piece');
    expect(r.chars).toBe(400);
    expect(r.budget).toBeGreaterThan(0);
    expect(r.budget).toBeLessThan(400);
    expect(r.overflowPx).toBeGreaterThan(0);
    // ...and the surviving note is what the size was solved for.
    expect(fit.fontPx).toBeGreaterThanOrEqual(PROSE_FLOOR_PX);
    root.remove();
  });
});

describe('fitBand', () => {
  /**
   * ZERO IS NOT A SMALL BOX — it is the absence of a measurement. A tree with no
   * layout (this one; server render; a `display: none` ancestor) must yield NO
   * answer, because pinning the band at the floor for the life of the piece is
   * exactly what fitting against zero would do.
   */
  it('refuses to fit a tree that has not been laid out', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-testid="surround-ticker-zone-piece">
        <p class="surround-cue-ticker__text"><span class="surround-cue-ticker__line"></span>
        <span class="surround-cue-ticker__probe"></span></p>
      </div>`;
    document.body.appendChild(root);
    expect(fitBand(root, { piece: ['A fact.'] })).toBeNull();
    root.remove();
  });

  it('refuses to fit a tree with no registers at all', () => {
    expect(fitBand(document.createElement('div'), { piece: ['A fact.'] })).toBeNull();
  });

  it('publishes the fit as the two properties the stylesheet reads', () => {
    expect(fitStyle({ fontPx: 16.25, leading: 1.35 }))
      .toEqual({ '--note-size': '16.25px', '--note-leading': '1.35' });
    expect(fitStyle(null)).toBeNull();
  });
});
