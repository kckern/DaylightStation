// clipBandFit.js — sizing the clip band's type to the band it sits in.
//
// The band has a fixed height (the definition's `clip.bottom` height) and the
// piece's name is whatever the corpus calls it: "Silent Night" and "Pine Cones
// and Holly Berries / It's Beginning to Look a Lot Like Christmas" share one
// box. A fixed size sets the short one well and pours the long one over the
// picture above and the progress bar below. So the type is MEASURED: the
// largest size, stepping down from the stylesheet's size, at which the zone
// sets inside the band's height (and the title in at most two lines).

/**
 * The largest size in [floorPx, ceilPx], on a grid of stepPx down from the
 * ceiling plus the floor itself, for which `ok()` holds after `apply(px)`.
 * Leaves the winning size applied.
 *
 * BINARY SEARCH, because every `ok` forces a layout and this runs on every clip
 * change on TV hardware. It finds the largest passing size when `ok` is
 * monotonic (a smaller size never fails where a larger one passed), which every
 * check here is: smaller type is never taller or wider. If a check is not (a
 * rounding wobble in layout), the result is still a size that passed when it
 * was measured, just not necessarily the largest.
 *
 * @param {object} args
 * @param {number} args.ceilPx the size the stylesheet sets (tried first).
 * @param {number} args.floorPx the smallest size worth setting.
 * @param {number} [args.stepPx]
 * @param {(px:number) => void} args.apply sets the size on the element.
 * @param {(px:number) => boolean} args.ok measures the element at that size.
 * @returns {{px:number, fits:boolean}} `fits: false` means even the floor
 *   failed; the floor is left applied.
 */
export function fitDown({ ceilPx, floorPx, stepPx = 1, apply, ok }) {
  if (!(ceilPx > 0) || !(floorPx > 0) || floorPx > ceilPx) return { px: ceilPx, fits: true };
  // The ceiling goes in as given: rounding it could set type larger than the
  // stylesheet's (26.8375 -> 26.84).
  const sizes = [ceilPx];
  for (let px = ceilPx - stepPx; px > floorPx + 1e-6; px -= stepPx) {
    // Rounding can land a step on or under a floor with more than two decimals
    // (a fractional root size); the floor itself closes the list.
    const rounded = Number(px.toFixed(2));
    if (rounded > floorPx) sizes.push(rounded);
  }
  if (floorPx < ceilPx) sizes.push(floorPx);
  const passes = (i) => { apply(sizes[i]); return ok(sizes[i]); };

  if (passes(0)) return { px: sizes[0], fits: true };
  const last = sizes.length - 1;
  if (last === 0 || !passes(last)) return { px: floorPx, fits: false };
  let lo = 0; // fails
  let hi = last; // passes
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (passes(mid)) hi = mid; else lo = mid;
  }
  // The last probe may have been a failing size (a lo), so set the winner again.
  apply(sizes[hi]);
  return { px: sizes[hi], fits: true };
}

/** Lines a block of text occupies at this size and leading. */
export function lineCount(heightPx, fontPx, leading) {
  if (!(heightPx > 0) || !(fontPx > 0) || !(leading > 0)) return 0;
  return Math.round(heightPx / (fontPx * leading));
}

const px = (v) => parseFloat(v) || 0;

/**
 * The band's inner height: what its zones may occupy.
 *
 * THE FOOTER IS THE BUDGET, NOT THE BAND'S OWN BOX. A bottom region's numeric
 * `height` is a FLOOR (`SurroundFrame.jsx`, `regionStyle`): the region grows to
 * its content, so a band measured against itself always "fits" while it pours
 * out of the footer — over the picture above and off the bottom of the screen.
 * The footer is what the column actually leaves under the picture.
 */
export function bandInnerHeight(band) {
  if (!band) return 0;
  const view = band.ownerDocument?.defaultView;
  const cs = view?.getComputedStyle?.(band);
  if (!cs) return band.clientHeight || 0;
  const footer = band.closest?.('.surround-frame__footer');
  const frame = band.closest?.('.surround-frame');
  let outer = band.clientHeight || 0;
  if (footer && frame) {
    // The footer can itself run past the screen (its regions are sized by
    // content), so its own height is not the room either: the room is from its
    // top to the frame's bottom, less its padding (a theme's garland reserve)
    // and whatever other band regions share it.
    const f = footer.getBoundingClientRect();
    const fcs = view.getComputedStyle(footer);
    const room = Math.min(f.height, frame.getBoundingClientRect().bottom - f.top);
    const region = band.closest('.surround-frame__region');
    const siblings = [...footer.children]
      .filter((el) => el !== region && el.classList?.contains('surround-frame__region'))
      .reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);
    outer = room - px(fcs.paddingTop) - px(fcs.paddingBottom) - siblings;
  }
  return outer - px(cs.paddingTop) - px(cs.paddingBottom);
}

/** The root font size, which is what the band's rem sizes resolve against. */
export function rootPx(el) {
  const doc = el?.ownerDocument;
  const cs = doc?.defaultView?.getComputedStyle?.(doc.documentElement);
  return px(cs?.fontSize) || 16;
}

/** Title sizes, in rem: the stylesheet's size, and the smallest worth setting. */
export const TITLE_CEIL_REM = 1.75;
export const TITLE_FLOOR_REM = 0.875;
export const TITLE_LEADING = 1.12;
/** Up next is set in em of one base size; that base steps between these. */
export const NEXT_CEIL_REM = 1;
export const NEXT_FLOOR_REM = 0.72;
const EPS = 0.5;

/**
 * Fit the band's two text zones to the room under the picture. Sets the
 * elements' font sizes directly (React sets none on them) and says what it set.
 *
 * @param {{band:Element, title?:Element|null, heading?:Element|null, nextText?:Element|null}} els
 * @returns {null|{innerPx:number, titlePx?:number, titleLines?:number,
 *   titleFits?:boolean, nextPx?:number, nextFits?:boolean}} null when the band
 *   is not laid out (tests, a collapsed region): nothing is changed.
 */
export function fitClipBand({ band, title = null, heading = null, nextText = null }) {
  const inner = bandInnerHeight(band);
  if (!(inner > 0)) return null;
  const rem = rootPx(band);
  const report = { innerPx: Math.round(inner) };

  if (title && heading) {
    const apply = (f) => { title.style.fontSize = `${f}px`; };
    const fitsBand = () => heading.getBoundingClientRect().height <= inner + EPS;
    const lines = (f) => lineCount(title.getBoundingClientRect().height, f, TITLE_LEADING);
    const ceilPx = TITLE_CEIL_REM * rem;
    const floorPx = TITLE_FLOOR_REM * rem;
    title.classList.remove('clip-band__title--clamped');
    // Two lines at most while any size allows it; a name that cannot be set in
    // two lines at the floor takes a third rather than being cut. Past three it
    // is clamped (the stylesheet's line-clamp is 3).
    let r = fitDown({ ceilPx, floorPx, apply, ok: (f) => lines(f) <= 2 && fitsBand() });
    if (!r.fits) r = fitDown({ ceilPx, floorPx, apply, ok: (f) => lines(f) <= 3 && fitsBand() });
    if (!r.fits) title.classList.add('clip-band__title--clamped');
    report.titlePx = r.px;
    report.titleLines = lines(r.px);
    report.titleFits = r.fits;
  }

  if (nextText) {
    // The whole Up next block is what has to fit, poster included: the poster
    // is 4.4rem tall by default, which is taller than a short band, and the
    // block is centred, so an unbounded poster pushes "Next, from" out of the top.
    const block = nextText.closest?.('.clip-band__next') ?? nextText;
    const poster = block.querySelector?.('.clip-band__next-poster');
    if (poster) poster.style.maxHeight = `${Math.floor(inner)}px`;
    const fitNext = () => fitDown({
      ceilPx: NEXT_CEIL_REM * rem,
      floorPx: NEXT_FLOOR_REM * rem,
      apply: (f) => { nextText.style.fontSize = `${f}px`; },
      ok: () => block.getBoundingClientRect().height <= inner + EPS,
    });
    block.classList?.remove('clip-band__next--compact');
    let r = fitNext();
    // A short band drops the other concert's name before it cuts anything:
    // the poster beside it already shows which concert that is.
    if (!r.fits && block.querySelector?.('.clip-band__next-work')) {
      block.classList.add('clip-band__next--compact');
      r = fitNext();
      report.nextCompact = true;
    }
    report.nextPx = r.px;
    report.nextFits = r.fits;
  }
  return report;
}
