// frontend/src/modules/Surround/fit.js
//
// THE FIT — how the band sets a programme note so that it is never cut.
//
// THE LAW THIS FILE EXISTS FOR. There is no ellipsis in the listening band, at
// any screen in the fleet, ever. A television has no "read more", no scroll and
// no pointer; a note that stops mid-sentence with three dots is a claim the
// viewer cannot complete, and it is worse than no note at all. So the type is
// SIZED TO THE TEXT rather than the text being cut to the type.
//
// WHAT THIS REPLACES. Waves 5-8 answered the same problem with a lattice of
// container-query tiers: three thresholds (88px / 108px / 161px) solved by hand
// from the clamp coefficient, the header's height and the line-height, each one
// setting a reserve in `em` and a `-webkit-line-clamp` count to match. Every
// number in it was derived in a harness and carried in a comment, the two files
// traded padding against each other to make a threshold clear by two tenths of
// a pixel, and the whole structure still ellipsized a real authored fact at two
// of the three sizes. It is gone. A measured fit is both simpler and strictly
// stronger: it asks the browser how tall this text actually is in this box, at
// this size, in this face, and picks the largest size at which the answer fits.
//
// THE LADDER, IN THE ORDER THE USER SET IT.
//   1. LINE-HEIGHT FIRST. Tightening the leading buys another line without
//      making a single glyph smaller, so it is always the cheaper move.
//   2. FONT-SIZE SECOND, and only to buy back leading. Stepping down a size is
//      what the ladder does when tight leading is still not enough.
//   3. NEITHER, PAST THE FLOORS. Below the floors the note is unreadable at ten
//      feet, and an unreadable note is not a fit — it is the same defect wearing
//      a smaller type size. A text that does not fit AT the floors is an
//      AUTHORING failure: it is dropped from the rotation, and the caller warns
//      with the measured overflow and the character budget so the corpus can be
//      fixed. The band shows only notes it can show whole.
//
// Expressed as a preference order over (size, leading) pairs — largest size
// first, loosest leading at that size — the ladder is exactly "tighten the
// leading before dropping the size", and the search below is that order.
//
// WHY THE DOM READS LIVE HERE AND NOT IN THE COMPONENT. Every other measured
// rule in this frame keeps the reads in the component and the arithmetic in a
// module (`band.js`, `desiredWidth`), because the arithmetic is what a spec has
// to be able to call. A fit is not that shape: it is a SEARCH whose every step
// is a measurement, so splitting it would leave the loop — the load-bearing
// part — on one side and the ruler on the other. So the whole of it lives here,
// takes an element, and is called identically by `CueTicker` and by the spec
// that measures the band (`band.measure.test.jsx`), which injects this file into
// its page and calls `fitBand` on the same DOM the component would.
//
// NO IMPORTS, DELIBERATELY. This file is loaded into a bare page by that spec,
// so it must stand alone — and it means no logger: `fitBand` REPORTS what did
// not fit and the component is what writes the warn.

/* -------------------------------------------------------------------------- */
/* The floors, and where they come from                                        */
/* -------------------------------------------------------------------------- */

/**
 * The root the prose floor is ANCHORED to: the office screen's 1280 CSS px.
 * `screens/office.yml` is the root every typographic number in this frame was
 * derived against, so it is the root at which the derived number is the answer
 * and every other root is a scaling of it.
 */
export const FLOOR_ANCHOR_ROOT_PX = 1280;

/**
 * The smallest type a programme note may be set in AT THE ANCHOR ROOT, in px at
 * the frame's 16px root — 0.88rem.
 *
 * MEASURED AGAINST THE FACE, not chosen. The frame's stated ten-foot floor for
 * LABELS is 0.72rem, and a label earns that floor by being a short, tracked,
 * small-cap string with high context that the eye reads as a shape. Continuous
 * prose is read glyph by glyph and needs more.
 *
 * EB Garamond's x-height is 0.42em (measured in the harness, against the
 * vendored binary) — small for a text face, where 0.48-0.52 is ordinary — so a
 * given size buys less apparent size in this face than the number suggests. At
 * 0.72rem its x-height is 4.84px; at 0.88rem it is 5.91px, 22% more, which is
 * the margin the label-to-prose step is worth.
 *
 * THE ARGUMENT IS A RATIO OF TWO SIZES ON ONE ROOT, and that is what survives
 * being scaled: `proseFloorPx` below multiplies this floor by the root, and the
 * label floor it is derived from rides the same root, so the +22% x-height step
 * holds on every screen. What the ratio never fixed is the ABSOLUTE size, which
 * is what this constant is — and an absolute size is meaningless without the
 * root it was measured on. Hence the anchor.
 *
 * 0.88rem is also the body floor wave 5 derived and every wave since has kept.
 */
export const PROSE_FLOOR_ANCHOR_PX = 14.08;

/**
 * The narrowest and widest roots in the fleet — the living-room Shield's 960 and
 * the largest screen the frame is measured at. The scaling is linear between
 * them and flat outside them; every clamp below is one of these two roots
 * evaluated at its floor's anchor, rather than a hand-copied literal.
 */
export const FLEET_MIN_ROOT_PX = 960;
export const FLEET_MAX_ROOT_PX = 1920;

/**
 * The frame's ten-foot floor for LABELS at the anchor root — 0.72rem.
 *
 * The older of the two numbers, and the one `PROSE_FLOOR_ANCHOR_PX` is measured
 * against: a label earns this floor by being a short, tracked, small-cap string
 * with high context that the eye reads as a SHAPE, and prose, read glyph by
 * glyph, needs 22% more x-height than it. Honoured by the map's place names, the
 * band's standing labels, the rail's numeral gutter and the period line's era
 * names — every one of which now reads it through `labelFloorPx`.
 */
export const LABEL_FLOOR_ANCHOR_PX = 11.52;

const round2 = (n) => Number(n.toFixed(2));

/**
 * ONE SCALING, USED BY BOTH FLOORS — and that is the wave-9b-follow-up fix
 * rather than tidying.
 *
 * The prose floor was made a function of the root and the LABEL floor was left a
 * flat 0.72rem, which put the two out of step in exactly the way the derivation
 * forbids: the prose floor is defined as +22% of x-height OVER the label floor,
 * and on the 960 root the scaled prose floor (10.56px) fell BELOW the unscaled
 * label's 11.52px. A note could have been set smaller than the standing label
 * over it. Two floors derived from one ratio cannot be scaled by two different
 * rules, so there is one rule and they both call it.
 *
 * @param {number} anchorPx the floor at `FLOOR_ANCHOR_ROOT_PX`.
 * @param {number} rootWidthPx the root this band is painted on.
 */
function scaleFloor(anchorPx, rootWidthPx) {
  const w = Number(rootWidthPx);
  const at = (root) => anchorPx * (root / FLOOR_ANCHOR_ROOT_PX);
  if (!(w > 0)) return round2(anchorPx);
  return round2(Math.min(at(FLEET_MAX_ROOT_PX), Math.max(at(FLEET_MIN_ROOT_PX), at(w))));
}

/**
 * The bounds the prose scaling is clamped between — the fleet's own two
 * extremes, evaluated at the anchor: 0.66rem at a 960 root, 1.32rem at a 1920
 * one. DERIVED, not written out, so that the two floors' clamps cannot drift
 * apart the way the floors themselves did. Argued at `proseFloorPx` below.
 */
export const PROSE_FLOOR_MIN_PX = scaleFloor(PROSE_FLOOR_ANCHOR_PX, FLEET_MIN_ROOT_PX);
export const PROSE_FLOOR_MAX_PX = scaleFloor(PROSE_FLOOR_ANCHOR_PX, FLEET_MAX_ROOT_PX);

/** The same two roots, at the label anchor: 0.54rem and 1.08rem. */
export const LABEL_FLOOR_MIN_PX = scaleFloor(LABEL_FLOOR_ANCHOR_PX, FLEET_MIN_ROOT_PX);
export const LABEL_FLOOR_MAX_PX = scaleFloor(LABEL_FLOOR_ANCHOR_PX, FLEET_MAX_ROOT_PX);

/**
 * The prose size floor is a FUNCTION OF THE ROOT WIDTH, not a constant.
 *
 * THE ASSUMPTION THIS ENCODES, STATED SO IT CAN BE FALSIFIED. **Every surface
 * this frame renders on is a large television read from across a room, and its
 * CSS root width tracks its physical size** — a screen given a smaller CSS root
 * is a screen whose pixels are physically bigger, in the same proportion. Under
 * that assumption a type size in CSS pixels divided by the root width is an
 * ANGULAR size, and holding `size / root` constant is holding the angle
 * constant. That is the whole claim, and it is what makes one floor correct on
 * two different roots.
 *
 * WAVE 9 ASKED FOR THE TAPE MEASURE AND THIS IS IT, from the owner rather than
 * assumed: both screens are roughly 60-inch televisions — the living room's
 * slightly the larger of the two — and each is viewed from across its own room.
 * Same physical width, fewer CSS pixels laid across it, so a CSS pixel on the
 * 960 root is already physically bigger and an identical rem renders BIGGER
 * there. That is the measurement the old single floor was wrong about: it was
 * not one size on two screens, it was 0.88rem on the office and the apparent
 * equivalent of 1.17rem on the living room.
 *
 * WHAT WOULD INVALIDATE IT: a surface whose root does NOT track its physical
 * size and distance. A handheld given a 960 root is read from arm's length, not
 * ten feet, and would want a floor derived from ITS distance rather than scaled
 * from the office's. A window on a desktop monitor — the surround in a browser
 * tab a foot from a face — is the same failure. Neither exists in this fleet; if
 * one is added, this function is where it has to be answered, because a
 * root-width scaling will silently do the wrong thing rather than fail.
 *
 * THE TWO SHIPPED ROOTS, and why 1280 and 960 are the same size to a viewer:
 *
 *   * OFFICE — `screens/office.yml`, a 1280x720 root at DPR 1, letterboxed on
 *     the display. One CSS pixel is one device row, so at this floor the
 *     thinnest strokes of an old-style face land on about one device row and
 *     are anti-aliased into grey. That is a real constraint and it is this
 *     screen's.
 *   * LIVING ROOM — `screens/living-room.yml`, a 960x540 root at DPR 2 filling
 *     the Shield's 1920x1080 panel. One CSS pixel is TWO device rows, so the
 *     same glyph is rendered with twice the detail — more headroom for the
 *     stroke, not less. Device pixel ratio does not enter the scaling at all:
 *     it changes how a glyph is RESOLVED, never how big it LOOKS.
 *
 * 1280 / 960 = 1.333, so the office's 0.88rem floor is the living room's
 * 0.66rem floor — which is exactly the ratio wave 9 measured between the two
 * screens' equal-angular floors, arrived at from the other direction.
 *
 * THE CLAMPS, AND WHY THEY SIT WHERE THEY DO. The scaling is linear between the
 * fleet's two extremes and flat outside them, because outside them the premise
 * above is no longer backed by a screen anybody has looked at:
 *
 *   * LOW, 10.56px / 0.66rem — the 960 root's value. A root narrower than the
 *     smallest screen in the fleet is not a smaller television, it is something
 *     else (a split pane, a phantom measurement mid-resize, a surface nobody has
 *     looked at), and the scaling's whole warrant is a panel somebody has stood
 *     in front of. Below 960 the floor stops falling and a text that still does
 *     not fit is refused, which is the designed outcome — the alternative is a
 *     band that answers an unreal root with unreadable type.
 *
 *     THE LABEL FLOOR RIDES THE SAME CLAMP, and it has to. For one wave this
 *     floor scaled and the label's did not, which inverted the relationship the
 *     prose floor is DEFINED by: at 960 the scaled prose floor (10.56px) sat
 *     below the flat label's 11.52px, so a note pinned at its floor would have
 *     been set smaller than the standing label over it. Both floors are one
 *     call to `scaleFloor` now, so the +22% x-height step holds at every root
 *     including outside the clamps — which is only true because the clamps are
 *     the same two ROOTS rather than two pairs of literals.
 *   * HIGH, 21.12px / 1.32rem — the 1920 root's value. A floor that keeps
 *     climbing eventually meets `PROSE_CEILING_PX` (24px), and a floor equal to
 *     the ceiling is not a ladder — it is one rung, and every note that wants a
 *     smaller size is refused wholesale on the largest, roomiest screen in the
 *     fleet. 1.32rem leaves the ladder real travel below the ceiling and is
 *     still short of the size at which a programme note starts competing with
 *     the work's own title, which is the design intent the ceiling encodes.
 *
 * @param {number} rootWidthPx the CSS width of the screen root this band is
 *   painted on. A non-positive or unmeasurable value falls back to the anchor —
 *   the number every wave before this one shipped on every screen.
 * @returns {number} the smallest type a programme note may be set in here.
 */
export function proseFloorPx(rootWidthPx) {
  return scaleFloor(PROSE_FLOOR_ANCHOR_PX, rootWidthPx);
}

/**
 * THE LABEL FLOOR, on the same scaling — the frame's ten-foot floor for a short,
 * tracked, small-cap string read as a shape: the map's place names, the band's
 * standing labels, the rail's numeral gutter, the period line's era names.
 *
 * IT LIVES BESIDE THE PROSE FLOOR BECAUSE IT IS THE NUMBER THE PROSE FLOOR IS
 * DERIVED FROM. `PROSE_FLOOR_ANCHOR_PX` is this floor plus 22% of x-height, and
 * for one wave the two were scaled by different rules — this one not at all —
 * which inverted the relationship on the living-room root and let prose floor
 * BELOW its own standing label. Keeping them in two files is what made that
 * possible; keeping them in one function is what makes it impossible.
 *
 * THE SAME ANGULAR ARGUMENT, UNCHANGED. A label on the 960 root is already
 * physically larger at the same rem, because that root lays fewer CSS pixels
 * across the same panel. Pinning it at a flat 0.72rem made it bigger in ANGLE
 * than the office's, which is the same defect the prose floor had and is fixed
 * the same way: 0.72rem at the 1280 anchor, 0.54rem at 960, 1.08rem at 1920.
 *
 * @param {number} rootWidthPx the CSS width of the screen root, unmeasurable
 *   values falling back to the anchor.
 * @returns {number} the smallest a label may be set in here, in px.
 */
export function labelFloorPx(rootWidthPx) {
  return scaleFloor(LABEL_FLOOR_ANCHOR_PX, rootWidthPx);
}

/**
 * The CSS width of the screen root this band is painted on.
 *
 * IT IS THE FRAME'S OWN WIDTH, NOT THE VIEWPORT'S, and the difference is the
 * office screen. `ScreenRenderer` gives a screen a FIXED `resolution` box and
 * letterboxes it inside whatever viewport the display actually has, so on the
 * office PC `window.innerWidth` is the panel's 1920 while the root the frame is
 * laid out in is 1280. Measuring the window there would scale the floor by the
 * wrong number, in the direction that makes prose too big. `SurroundFrame`
 * fills its screen root, so its own box IS the root — measured, so it cannot
 * drift from a config value nobody re-read.
 */
export function rootWidthOf(el) {
  const frame = el?.closest?.('.surround-frame');
  const w = frame?.getBoundingClientRect?.().width ?? 0;
  return w > 0 ? w : 0;
}

/**
 * The largest — 1.5rem. The point at which a programme note starts competing
 * with the work's own title on the plate above it. Unchanged from the clamp
 * this ladder replaces.
 *
 * AND IT DOES NOT SCALE WITH THE ROOT, deliberately. The floor is an ANGULAR
 * claim — "big enough to read from ten feet" — so it has to be re-expressed on
 * every root. The ceiling is a claim about a RELATIONSHIP between two things on
 * the SAME root: the note against the work's title on the plate above it. The
 * title is itself set in rem on that root, so it already scales with the root,
 * and pinning the ceiling to it in rem is what keeps the relationship fixed.
 * Scaling the ceiling by the root as well would scale it twice.
 */
export const PROSE_CEILING_PX = 24;

/** The leading a note is set at when the room is there. */
export const LEADING_MAX = 1.35;

/**
 * The tightest leading a programme note may be set at.
 *
 * MEASURED, AND THE MEASUREMENT IS THE ARGUMENT. EB Garamond's ink extent is
 * 0.71em of ascender and 0.29em of descender — exactly 1.00em from the bottom of
 * a `g` to the top of an `h`. So the clear space between the descenders of one
 * line and the ascenders of the next is `leading - 1.00`, in ems, directly:
 *
 *   1.35 (the loose end)  ->  0.35em of air
 *   1.31 (the face's own `line-height: normal`, measured)  ->  0.31em
 *   1.25 (this floor)     ->  0.25em, or 3.5px at the type floor above
 *   1.20 (the classic prose minimum)  ->  0.20em
 *   1.00                  ->  the lines interlock
 *
 * IT DOES NOT SCALE WITH THE ROOT, AND THAT IS NOT AN OVERSIGHT. The size floor
 * had to become a function of the root because it is a LENGTH: 14.08 CSS pixels
 * is a different angular size on a 960 root than on a 1280 one, so the number
 * that expresses "big enough to read from ten feet" has to be re-expressed per
 * root. This floor is a RATIO — a multiple of whatever size the ladder settled
 * on — so it is already in the units the scaling would have converted it to.
 * Whatever the root, 1.25 leaves a quarter of the type size between lines, and
 * every derivation below is in `em`. Scaling a ratio by the root would not
 * re-express it, it would break it: the same note on the living room would come
 * back at three quarters of the air the office gives it, tighter than the floor
 * the measurements say is the minimum, on the screen with the smaller root.
 *
 * 1.25 is 80% of what the type designer's own metrics reserve. That is a
 * tightening within the face's tolerance rather than a re-metric of it, and it
 * still leaves a quarter of the type size between lines. Below it the failure
 * mode is not collision, it is LINE TRACKING: at ten feet the eye returning from
 * the end of one line has to find the start of the next, and closely-set lines
 * of an old-style face with fine serifs are exactly what makes that fail. Prose
 * at distance wants MORE leading than prose in the hand, so this floor is
 * deliberately above the 1.20 a print page would allow.
 */
export const LEADING_FLOOR = 1.25;

/** The search's resolutions. Finer than a viewer can see; coarse enough to end. */
export const FONT_STEP_PX = 0.25;
export const LEADING_STEP = 0.01;

/** Sub-pixel slack. A box and its contents that agree to a hundredth of a pixel fit. */
const EPS = 0.05;

/** The two registers, by the testid their zone carries. */
const ZONE_KEYS = Object.freeze(['piece', 'now']);

/* -------------------------------------------------------------------------- */
/* What each register can ever show                                            */
/* -------------------------------------------------------------------------- */

const isText = (s) => typeof s === 'string' && s.trim();

/**
 * Every string each register can ever show for this piece.
 *
 * THE FIT IS A CONSTANT OF THE PIECE, NOT OF THIS INSTANT, and this function is
 * what makes that true. Fitting the type to whatever is on screen right now
 * would resize both registers at every segment boundary — the reserved-height
 * law broken by the mechanism that replaced the reserve. So the pool is the
 * union over the whole work: every fact, every PLACED segment's listening
 * notes, every docked cue, and the facts again in the NOW register where some
 * segment will borrow them for want of listening notes of its own.
 *
 * Pure, and separate from the measuring below, because the spec that measures
 * the band needs exactly this list and must not be allowed to write its own.
 *
 * @param {{facts?:string[], segments?:object[], cues?:object[]}} args
 *   `segments` are the PLACED ones — a segment this recording cannot put on
 *   the clock never becomes the sounding segment, so its notes never show.
 * @returns {{piece:string[], now:string[]}}
 */
export function bandPools({ facts, segments, cues }) {
  const f = (Array.isArray(facts) ? facts : []).filter(isText);
  const cueTexts = (Array.isArray(cues) ? cues : [])
    .map((c) => String(c?.text ?? '')).filter(isText);
  const list = Array.isArray(segments) ? segments : [];
  const listenAll = list.flatMap(
    (m) => (Array.isArray(m?.listen) ? m.listen : []).filter(isText),
  );
  const borrows = list.some(
    (m) => !(Array.isArray(m?.listen) ? m.listen : []).some(isText),
  );
  return {
    // With no segments the band does not split, and this single register
    // carries the cues too.
    piece: [...f, ...(list.length ? [] : cueTexts)],
    now: list.length ? [...listenAll, ...(borrows ? f : []), ...cueTexts] : [],
  };
}

/* -------------------------------------------------------------------------- */
/* The ruler                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Gather one register's measurable state off the DOM.
 *
 * The PROBE is a real element the component renders inside the note's own box
 * (`CueTicker.jsx`), out of flow and invisible. Being a child of that box is the
 * whole point: it inherits the face, the weight, the tracking, the alignment and
 * `text-wrap: balance` from the element the note is actually set in, so a
 * measurement cannot drift from the paint by a property nobody remembered to
 * copy. Only the two things the ladder varies — size and leading — are set on it.
 *
 * @returns {{box:Element, probe:HTMLElement, availPx:number, widthPx:number}|null}
 */
function zoneOf(root, key) {
  const zone = root?.querySelector?.(`[data-testid="surround-ticker-zone-${key}"]`);
  const box = zone?.querySelector('.surround-cue-ticker__text');
  const probe = box?.querySelector('.surround-cue-ticker__probe');
  if (!box || !probe) return null;
  const availPx = box.clientHeight;
  const widthPx = box.clientWidth;
  // Not laid out yet (an unmounted tree, a display:none ancestor, the frame's
  // first render before the region has a height). Zero is not a small box — it
  // is the absence of a measurement, and fitting against it would pin the whole
  // band at the floor for the life of the piece.
  if (!(availPx > 0) || !(widthPx > 0)) return null;
  return { box, probe, availPx, widthPx };
}

/** How tall this string sets, in this zone, at this size and leading. */
function heightOf(zone, text, fontPx, leading) {
  const { probe } = zone;
  probe.style.width = `${zone.widthPx}px`;
  probe.style.fontSize = `${fontPx}px`;
  probe.style.lineHeight = String(leading);
  probe.textContent = text;
  return probe.getBoundingClientRect().height;
}

/** Leave nothing behind: an inhabited probe is a box the next measurement lies about. */
function resetProbe(zone) {
  const { probe } = zone;
  probe.textContent = '';
  probe.style.width = '';
  probe.style.fontSize = '';
  probe.style.lineHeight = '';
}

/**
 * The most characters of `text` that fit in this zone at the floors.
 *
 * What the author needs to know is not "it overflowed by 41px" but "cut it to
 * 183 characters", so this is measured rather than estimated from an average
 * advance — the same reason nothing else in this frame counts characters.
 * Bisection on the prefix length, which costs ~8 measurements for a note.
 *
 * `floorPx` is THIS ROOT'S floor, so the budget an author reads out of the log
 * store is the budget on the screen that refused the note — a budget quoted at
 * some other screen's floor is a re-authoring target that fixes nothing.
 */
function budgetChars(zone, text, floorPx) {
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (heightOf(zone, text.slice(0, mid), floorPx, LEADING_FLOOR) <= zone.availPx + EPS) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/* -------------------------------------------------------------------------- */
/* The ladder                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Does every note in every register fit at this size and leading?
 *
 * ONE ANSWER FOR THE WHOLE BAND, and that is a design decision rather than a
 * convenience. The two registers sit side by side and are read together; setting
 * them in two different sizes would read as a mistake. And the pools are taken
 * across the WHOLE PIECE — every segment's listening notes, not just the
 * sounding segment's — so the answer cannot change at a segment boundary. A
 * band whose type resized every few minutes would be the reserved-height law
 * broken by the thing that replaced it.
 */
function everythingFits(work, fontPx, leading) {
  for (const { zone, texts } of work) {
    for (const text of texts) {
      if (heightOf(zone, text, fontPx, leading) > zone.availPx + EPS) return false;
    }
  }
  return true;
}

/**
 * The largest value in [lo, hi] that passes, to `step`. `pass` must be monotone.
 *
 * THE SNAP IS CLAMPED TO `lo`, and that is not defensive tidying. `lo` is a
 * FLOOR — the prose size floor is 14.08px at the anchor root and the step is
 * 0.25px — and a floor is not on the grid: `Math.floor(14.08 / 0.25) * 0.25` is
 * 14.0, eight hundredths of a pixel BELOW the floor the whole no-ellipsis
 * argument rests on. Now that the floor is a function of the root it is off the
 * grid at almost every root rather than at one, so the clamp does more work.
 * It bites exactly when only the bottom rung passes, which is the case a tighter
 * band or a longer corpus produces, and it would have reported itself as a floor
 * violation in the measure spec rather than as the rounding bug it is.
 */
function largestPassing(lo, hi, step, pass) {
  if (pass(hi)) return hi;
  let a = lo;
  let b = hi;
  while (b - a > step) {
    const mid = (a + b) / 2;
    if (pass(mid)) a = mid; else b = mid;
  }
  return Math.max(lo, Math.floor((a + 1e-9) / step) * step);
}

/**
 * Set the whole band's programme type to the largest size at which nothing is cut.
 *
 * @param {Element} root the ticker's root element.
 * @param {{piece?:string[], now?:string[]}} pools every string each register can
 *   ever show for this piece — facts, every segment's listening notes, cues.
 * @returns {null|{
 *   fontPx:number, leading:number, floorPx:number, rootWidthPx:number,
 *   rejected:Array<{zone:string,text:string,chars:number,budget:number,overflowPx:number}>,
 *   zones:Array<{zone:string,availPx:number,widthPx:number,texts:number}>
 * }} null when the band has not been laid out yet. `floorPx` is the floor THIS
 *   root got, reported because it is what every rejection below was judged
 *   against and a budget is unreadable without it.
 */
export function fitBand(root, pools) {
  // THE FLOOR IS MEASURED, ONCE, BEFORE ANYTHING IS JUDGED — it bounds the
  // ladder AND the rejection pass, so it has to be the same number in both or
  // the band would refuse a note it then had room for.
  const rootWidthPx = rootWidthOf(root);
  const floorPx = proseFloorPx(rootWidthPx);

  const work = [];
  for (const key of ZONE_KEYS) {
    const zone = zoneOf(root, key);
    if (!zone) continue;
    const texts = (pools?.[key] ?? []).filter((t) => typeof t === 'string' && t.trim());
    work.push({ key, zone, texts });
  }
  if (!work.length) return null;

  // PASS ONE — what cannot be set whole even at the floors. Measured at the
  // bottom of the ladder, because that is the only rung at which "it does not
  // fit" means "no rendering of this can fit" rather than "not at this size".
  const rejected = [];
  for (const entry of work) {
    const keep = [];
    for (const text of entry.texts) {
      const h = heightOf(entry.zone, text, floorPx, LEADING_FLOOR);
      if (h <= entry.zone.availPx + EPS) { keep.push(text); continue; }
      rejected.push({
        zone: entry.key,
        text,
        chars: text.length,
        budget: budgetChars(entry.zone, text, floorPx),
        overflowPx: Number((h - entry.zone.availPx).toFixed(2)),
      });
    }
    entry.texts = keep;
  }

  // PASS TWO — the ladder, over what survives.
  //   * the largest SIZE is found at the TIGHTEST leading, because that is the
  //     rung with the most room, so it is the size the ladder can reach at all;
  //   * then the LOOSEST leading that size can still afford.
  // Which is the user's order exactly: tighten the leading to hold the size, and
  // only give the leading back once the size has been paid for.
  const fontPx = largestPassing(
    floorPx, PROSE_CEILING_PX, FONT_STEP_PX,
    (f) => everythingFits(work, f, LEADING_FLOOR),
  );
  const leading = largestPassing(
    LEADING_FLOOR, LEADING_MAX, LEADING_STEP,
    (l) => everythingFits(work, fontPx, l),
  );

  work.forEach(({ zone }) => resetProbe(zone));

  return {
    fontPx: Number(fontPx.toFixed(2)),
    leading: Number(leading.toFixed(2)),
    floorPx,
    rootWidthPx: Number(rootWidthPx.toFixed(2)),
    rejected,
    zones: work.map(({ key, zone, texts }) => ({
      zone: key,
      availPx: Number(zone.availPx.toFixed(2)),
      widthPx: Number(zone.widthPx.toFixed(2)),
      texts: texts.length,
    })),
  };
}

/**
 * The strings the band must NOT show, per register.
 *
 * ONE PLACE DECIDES, because there are three consumers and the one that was
 * forgotten was the one that mattered. Review finding C-1: the rotating pools
 * were filtered and the TIMED CUES were not, so the single string the fit had
 * certified as unsettable was the one string that could preempt the panel — set
 * at a size solved on the assumption it was not there, in a box with
 * `overflow: hidden` and no ellipsis. Anything a register can show now goes
 * through `withhold`.
 *
 * @param {object|null} fit from `fitBand`.
 * @returns {{piece:Set<string>, now:Set<string>}|null} null when nothing is withheld.
 */
export function withheldSets(fit) {
  if (!fit?.rejected?.length) return null;
  const by = { piece: new Set(), now: new Set() };
  fit.rejected.forEach((r) => by[r.zone]?.add(r.text));
  return by;
}

/**
 * Drop from `items` everything whose text this register cannot set whole.
 *
 * @param {Array} items facts, listening notes, or cue objects.
 * @param {Set<string>|undefined} set from `withheldSets`.
 * @param {(item:*) => string} [textOf] how to read an item's text — the identity
 *   for a note, `smartQuotes(cue.text)` for a cue, because what is compared has
 *   to be the string that would be PAINTED.
 */
export function withhold(items, set, textOf = (x) => x) {
  const list = Array.isArray(items) ? items : [];
  if (!set || !set.size) return list;
  return list.filter((item) => !set.has(textOf(item)));
}

/**
 * The custom properties a fit publishes. One place names them, so the component
 * that renders them and the spec that applies them cannot drift.
 */
export function fitStyle(fit) {
  if (!fit) return null;
  return {
    '--note-size': `${fit.fontPx}px`,
    '--note-leading': String(fit.leading),
  };
}

export default fitBand;
