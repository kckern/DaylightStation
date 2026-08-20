// frontend/src/modules/Surround/fit.test.js
//
// The parts of the fit that are decidable without a layout engine: WHAT gets
// measured, and what the ladder's floors are worth. The ladder ITSELF is a
// search whose every step is a measurement, so it is asserted where it can only
// be asserted honestly — in `band.measure.test.jsx`, against the real compiled
// stylesheet in real Chromium with the real vendored faces.

import { describe, it, expect } from 'vitest';
import {
  bandPools, fitBand, fitStyle, proseFloorPx, labelFloorPx,
  PROSE_FLOOR_ANCHOR_PX, PROSE_FLOOR_MIN_PX, PROSE_FLOOR_MAX_PX,
  LABEL_FLOOR_ANCHOR_PX, LABEL_FLOOR_MIN_PX, LABEL_FLOOR_MAX_PX,
  FLOOR_ANCHOR_ROOT_PX, PROSE_CEILING_PX, LEADING_FLOOR, LEADING_MAX,
} from './fit.js';

/**
 * THE FLOOR THAT APPLIES IN THIS FILE. `fitBand` measures the `.surround-frame`
 * the band is painted in and scales the floor by its width; the bands built
 * below are bare elements with no frame ancestor, so the root is unmeasurable
 * and the fit falls back to the anchor. Written as the call rather than the
 * constant so that a change to what an unmeasurable root falls back to moves
 * these specs with it.
 */
const FLOOR = proseFloorPx(0);

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
  const LABEL_FLOOR_PX = LABEL_FLOOR_ANCHOR_PX;
  const X_HEIGHT = 0.42;

  it('sets prose above the label floor, by the x-height margin the argument claims', () => {
    expect(PROSE_FLOOR_ANCHOR_PX).toBeGreaterThan(LABEL_FLOOR_PX);
    expect((PROSE_FLOOR_ANCHOR_PX * X_HEIGHT) / (LABEL_FLOOR_PX * X_HEIGHT)).toBeGreaterThan(1.2);
    expect(PROSE_FLOOR_ANCHOR_PX * X_HEIGHT, 'the x-height at the floor').toBeCloseTo(5.91, 1);
  });

  it('keeps a ceiling under the note, so it cannot shout down the work’s own title', () => {
    expect(PROSE_CEILING_PX).toBeGreaterThan(PROSE_FLOOR_MAX_PX);
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

  /**
   * AND THE LEADING FLOOR IS THE ONE THAT DOES NOT SCALE. The size floor became
   * a function of the root because it is a LENGTH — 14.08 CSS px is a different
   * angular size on a 960 root than on a 1280 one. This floor is a RATIO of the
   * settled size, so it is already in the units the scaling converts to: on
   * every root it leaves a quarter of the type size between lines. Asserted so
   * that "it needs nothing" is a claim the suite holds rather than a sentence in
   * a report.
   */
  it('leaves the same air between lines on every root, because it is a ratio', () => {
    const air = (rootPx) => (LEADING_FLOOR - 1) * proseFloorPx(rootPx);
    expect(air(960) / proseFloorPx(960)).toBeCloseTo(air(1920) / proseFloorPx(1920), 6);
    expect(air(1280) / proseFloorPx(1280)).toBeCloseTo(LEADING_FLOOR - 1, 6);
  });
});

/**
 * THE FLOOR IS A FUNCTION OF THE ROOT — the wave-9b change.
 *
 * Every screen the surround runs on is a large television read from across a
 * room, and its CSS root width tracks its physical size: the living room's 960
 * root fills the same sort of panel the office's 1280 root does, so a CSS pixel
 * is physically bigger there and an identical `rem` renders BIGGER. Equal
 * angular size therefore means `size / root` held constant, not `size` held
 * constant, which is what the old single 0.88rem floor did.
 *
 * The expected values here are WRITTEN OUT rather than derived from the same
 * formula the implementation uses, because an assertion that recomputes what it
 * is checking cannot fail.
 */
describe('proseFloorPx — the prose floor, per root', () => {
  it('is 0.88rem at the office root and 0.66rem at the living room’s', () => {
    expect(proseFloorPx(1280), 'the anchor root').toBe(14.08);
    expect(proseFloorPx(960), 'the living-room Shield').toBe(10.56);
    expect(proseFloorPx(1920), 'the largest root in the fleet').toBe(21.12);
    expect(proseFloorPx(FLOOR_ANCHOR_ROOT_PX)).toBe(PROSE_FLOOR_ANCHOR_PX);
  });

  /**
   * THE CLAIM ITSELF, stated as an invariant rather than as three numbers: the
   * floor per unit of root width is one constant across the fleet, which is
   * what "the same angular size on every screen" means when the root tracks the
   * panel.
   */
  it('holds one angular size across the fleet', () => {
    const angular = [960, 1280, 1920].map((w) => proseFloorPx(w) / w);
    expect(angular[0]).toBeCloseTo(angular[1], 6);
    expect(angular[1]).toBeCloseTo(angular[2], 6);
    expect(angular[1]).toBeCloseTo(PROSE_FLOOR_ANCHOR_PX / FLOOR_ANCHOR_ROOT_PX, 6);
  });

  /**
   * OUTSIDE THE FLEET THE PREMISE IS NOT BACKED BY A SCREEN ANYBODY HAS LOOKED
   * AT, so the scaling goes flat rather than carrying on.
   *
   * LOW: a root narrower than the smallest screen in the fleet is not a smaller
   * ten-foot display — it is a split pane or a phantom measurement mid-resize —
   * and letting it drive the floor down hands the fit a size no viewer of any of
   * these screens could use. HIGH: a floor that keeps climbing meets the
   * ceiling, and a floor equal to the ceiling is not a ladder but one rung, on
   * which every note that wants a smaller size is refused wholesale.
   */
  it('goes flat outside the fleet, at the fleet’s own two extremes', () => {
    expect(proseFloorPx(320), 'a phone-sized root drove the floor below the fleet’s smallest')
      .toBe(PROSE_FLOOR_MIN_PX);
    expect(proseFloorPx(3840), 'a 4K root inflated the floor past the fleet’s largest')
      .toBe(PROSE_FLOOR_MAX_PX);
    expect(PROSE_FLOOR_MIN_PX).toBe(proseFloorPx(960));
    expect(PROSE_FLOOR_MAX_PX).toBe(proseFloorPx(1920));
  });

  it('leaves the ladder real travel below the ceiling even at the high clamp', () => {
    expect(
      PROSE_CEILING_PX - PROSE_FLOOR_MAX_PX,
      'the floor has climbed into the ceiling: the ladder has one rung left',
    ).toBeGreaterThanOrEqual(2);
    expect(PROSE_FLOOR_MAX_PX).toBeLessThan(PROSE_CEILING_PX);
  });

  /**
   * AN UNMEASURABLE ROOT IS NOT A SMALL ONE. A server render, a `display: none`
   * ancestor, a mount with no frame around it: the answer is the anchor — the
   * number every wave before this one shipped on every screen — and not the low
   * clamp, which would silently set prose at 0.66rem on an office screen whose
   * frame nobody could measure.
   */
  it('falls back to the anchor when the root cannot be measured', () => {
    [0, -1, NaN, undefined, null, 'wide'].forEach((bad) => {
      expect(proseFloorPx(bad), `an unmeasurable root (${String(bad)}) did not fall back`)
        .toBe(PROSE_FLOOR_ANCHOR_PX);
    });
  });
});

/**
 * ============================================================================
 * THE INVARIANT THE WHOLE DERIVATION RESTS ON — at EVERY root, prose floors
 * above labels, by the x-height margin that defines it.
 * ============================================================================
 *
 * `PROSE_FLOOR_ANCHOR_PX` is not an independent number: it IS the label floor
 * plus 22% of x-height, because a label is a short tracked small-cap string the
 * eye reads as a shape and prose is read glyph by glyph. Everything else in
 * `fit.js` — the ladder's bottom rung, the rejection pass, the character budgets
 * warned to the log store — is downstream of that one relationship.
 *
 * IT HAS ALREADY BEEN BROKEN ONCE, which is why it is asserted here rather than
 * assumed. Design wave 9b scaled the PROSE floor by the root and left the LABEL
 * floor a flat 0.72rem, and on the living-room root that inverted it: prose
 * floored at 10.56px under a label set at 11.52px, so a note pinned at its floor
 * would have been set SMALLER than the standing label above it. The fix is that
 * both floors are one call to `scaleFloor`; this is the assertion that says so.
 *
 * SWEPT ACROSS ROOTS, not checked at three, and deliberately including roots
 * outside the clamps — a clamp is exactly where two independently-written bounds
 * would come apart, and the reason `PROSE_FLOOR_MIN_PX` and `LABEL_FLOOR_MIN_PX`
 * are the same two ROOTS evaluated at two anchors rather than four literals.
 *
 * TO GO RED: return `LABEL_FLOOR_ANCHOR_PX` unconditionally from `labelFloorPx`
 * — the state this follow-up fixed — or move either pair of clamps alone.
 */
describe('prose over labels — the +22% x-height step, at every root', () => {
  /**
   * Every root worth asking about — THE FLEET FIRST, so that a failure names a
   * screen somebody owns before it names a hypothetical one, then the gaps
   * between the fleet's sizes, then well outside the clamps at both ends.
   */
  const ROOTS = [960, 1280, 1920, 1024, 1100, 1440, 1600, 800, 640, 320, 240, 2560, 3840, 7680];
  const X_HEIGHT = 0.42;

  it('never lets prose floor below the label floor on any root', () => {
    ROOTS.forEach((root) => {
      const prose = proseFloorPx(root);
      const label = labelFloorPx(root);
      expect(
        prose,
        `on a ${root}px root the prose floor is ${prose}px and the LABEL floor is ${label}px — `
        + 'a note pinned at its floor would be set smaller than the standing label over it, '
        + 'which inverts the relationship the prose floor is defined by',
      ).toBeGreaterThan(label);
    });
  });

  it('keeps the margin at the 22% of x-height the derivation claims', () => {
    ROOTS.forEach((root) => {
      const prose = proseFloorPx(root);
      const label = labelFloorPx(root);
      const gained = (prose * X_HEIGHT) / (label * X_HEIGHT);
      expect(
        gained,
        `on a ${root}px root prose buys ${((gained - 1) * 100).toFixed(1)}% more x-height than a `
        + `label (${(prose * X_HEIGHT).toFixed(2)}px against ${(label * X_HEIGHT).toFixed(2)}px) — `
        + 'the label-to-prose step is 22%',
      // TO TWO DECIMALS, because both floors are quantised to a hundredth of a
      // pixel and a ratio of two rounded numbers is not exact — at a 1024 root
      // the pair is 11.26/9.22, which is 1.2213 rather than 1.2222. That is a
      // tenth of a percent of drift from ROUNDING, and it is the only slack this
      // assertion has: a floor that stopped scaling is out by a third.
      ).toBeCloseTo(PROSE_FLOOR_ANCHOR_PX / LABEL_FLOOR_ANCHOR_PX, 2);
      expect(gained, 'prose no longer buys the 20%+ of x-height that defines it')
        .toBeGreaterThan(1.2);
    });
  });

  /**
   * ...and the two floors are the SAME SHAPE, which is what makes the margin
   * hold rather than merely happen to. Both are one anchor scaled by one rule
   * between one pair of roots.
   */
  it('scales both floors by one rule, so they cannot come apart', () => {
    ROOTS.forEach((root) => {
      expect(
        proseFloorPx(root) / labelFloorPx(root),
        `the two floors scale differently at ${root}px`,
      ).toBeCloseTo(PROSE_FLOOR_MIN_PX / LABEL_FLOOR_MIN_PX, 2);
    });
    expect(LABEL_FLOOR_MIN_PX).toBe(labelFloorPx(960));
    expect(LABEL_FLOOR_MAX_PX).toBe(labelFloorPx(1920));
    expect(labelFloorPx(1280)).toBe(LABEL_FLOOR_ANCHOR_PX);
    // The three the coordinator named, written out.
    expect([labelFloorPx(960), labelFloorPx(1280), labelFloorPx(1920)])
      .toEqual([8.64, 11.52, 17.28]);
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
    const root = ruledBand({ roomPx: 2 * FLOOR * LEADING_FLOOR, widthPx: 275 });
    document.body.appendChild(root);
    const fit = fitBand(root, { piece: ['x'.repeat(84)] });
    expect(fit, 'the ruler produced no fit at all').not.toBeNull();
    expect(
      fit.fontPx,
      `the ladder settled at ${fit.fontPx}px against a ${FLOOR}px floor — `
      + 'the snap to the search grid undercut the floor it was bounded by',
    ).toBeGreaterThanOrEqual(FLOOR);
    expect(fit.fontPx).toBe(FLOOR);
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
    const root = ruledBand({ roomPx: 2 * FLOOR * LEADING_FLOOR, widthPx: 275 });
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
    expect(fit.fontPx).toBeGreaterThanOrEqual(FLOOR);
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
