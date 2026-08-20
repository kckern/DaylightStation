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
 * The smallest type a programme note may be set in, in px at the frame's 16px
 * root — 0.88rem.
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
 * THE ARGUMENT IS A RATIO, AND THAT IS WHY IT IS ROOT- AND DPR-INDEPENDENT. Both
 * floors are CSS pixels on the same screen root as each other, so the 22% holds
 * whatever that root is scaled to and whatever the panel's device pixel ratio
 * is. An earlier draft of this comment added "the kiosks in this fleet run at
 * device pixel ratio 1, so an x-height is exactly that many device rows"; that
 * is TRUE OF THE OFFICE SCREEN AND FALSE OF THE LIVING ROOM, and it is worth
 * being exact about because the two roots are different sizes:
 *
 *   * OFFICE — `screens/office.yml`, a 1280x720 root at DPR 1, letterboxed on
 *     the display. One CSS pixel is one device row, so at this floor the
 *     thinnest strokes of an old-style face land on about one device row and
 *     are anti-aliased into grey. That is a real constraint and it is this
 *     screen's.
 *   * LIVING ROOM — `screens/living-room.yml`, a 960x540 root at DPR 2 filling
 *     the Shield's 1920x1080 panel. One CSS pixel is TWO device rows, so the
 *     same glyph is rendered with twice the detail — more headroom, not less.
 *     It is also the SMALLER root on (in this house) the larger panel, so a
 *     glyph of N CSS pixels is physically about 1280/960 = 1.33x bigger there
 *     than the same N on the office screen.
 *
 * So the living room is the more forgiving root for LEGIBILITY and the tighter
 * one for ROOM, which is exactly the trade its 39px piece register shows.
 * Neither correction moves the floor: device pixel ratio does not change angular
 * size at ten feet, and the binding root for legibility is the office one, where
 * the original DPR-1 reasoning holds unchanged.
 *
 * MAKING IT PER-ROOT WAS MEASURED, AND IT IS A REAL DECISION — which is why it
 * is not taken here. The living-room root is 960 CSS px across the whole Shield
 * panel and the office root is a letterboxed 1280 CSS px box, so IF the two
 * panels were the same physical width and were viewed from the same distance, a
 * glyph of N CSS pixels would subtend 1280/960 = 1.33x more on the living room
 * and its equal-angular floor would be 0.88 / 1.33 = 0.66rem. Measured against
 * the real sheet, that floor changes what the living-room piece register holds
 * from ~92 characters to ~123 — not by fitting a third line (39px of room is two
 * lines at either size) but by fitting half again as many characters onto each
 * of the two. Three of the eight shipped facts cross that line.
 *
 * It is not taken because the premise is not measured: the office panel's
 * physical size and both screens' true viewing distances are unknown here, so
 * 1.33x is an upper bound on the living room's advantage rather than a
 * measurement, and 0.66rem is below the one floor every other argument in this
 * frame is anchored to. Lowering a readability floor on an assumed panel size is
 * exactly the guess this file exists to replace. One number on every root until
 * somebody measures the two panels.
 *
 * 0.88rem is also the body floor wave 5 derived and every wave since has kept.
 */
export const PROSE_FLOOR_PX = 14.08;

/**
 * The largest — 1.5rem. The point at which a programme note starts competing
 * with the work's own title on the plate above it. Unchanged from the clamp
 * this ladder replaces.
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
 * would resize both registers at every movement boundary — the reserved-height
 * law broken by the mechanism that replaced the reserve. So the pool is the
 * union over the whole work: every fact, every PLACED movement's listening
 * notes, every docked cue, and the facts again in the NOW register where some
 * movement will borrow them for want of listening notes of its own.
 *
 * Pure, and separate from the measuring below, because the spec that measures
 * the band needs exactly this list and must not be allowed to write its own.
 *
 * @param {{facts?:string[], movements?:object[], cues?:object[]}} args
 *   `movements` are the PLACED ones — a movement this recording cannot put on
 *   the clock never becomes the sounding movement, so its notes never show.
 * @returns {{piece:string[], now:string[]}}
 */
export function bandPools({ facts, movements, cues }) {
  const f = (Array.isArray(facts) ? facts : []).filter(isText);
  const cueTexts = (Array.isArray(cues) ? cues : [])
    .map((c) => String(c?.text ?? '')).filter(isText);
  const list = Array.isArray(movements) ? movements : [];
  const listenAll = list.flatMap(
    (m) => (Array.isArray(m?.listen) ? m.listen : []).filter(isText),
  );
  const borrows = list.some(
    (m) => !(Array.isArray(m?.listen) ? m.listen : []).some(isText),
  );
  return {
    // With no movements the band does not split, and this single register
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
 */
function budgetChars(zone, text) {
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (heightOf(zone, text.slice(0, mid), PROSE_FLOOR_PX, LEADING_FLOOR) <= zone.availPx + EPS) {
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
 * across the WHOLE PIECE — every movement's listening notes, not just the
 * sounding movement's — so the answer cannot change at a movement boundary. A
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
 * FLOOR — the prose size floor is 14.08px and the step is 0.25px — and a floor
 * is not on the grid: `Math.floor(14.08 / 0.25) * 0.25` is 14.0, eight
 * hundredths of a pixel BELOW the floor the whole no-ellipsis argument rests on.
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
 *   ever show for this piece — facts, every movement's listening notes, cues.
 * @returns {null|{
 *   fontPx:number, leading:number,
 *   rejected:Array<{zone:string,text:string,chars:number,budget:number,overflowPx:number}>,
 *   zones:Array<{zone:string,availPx:number,widthPx:number,texts:number}>
 * }} null when the band has not been laid out yet.
 */
export function fitBand(root, pools) {
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
      const h = heightOf(entry.zone, text, PROSE_FLOOR_PX, LEADING_FLOOR);
      if (h <= entry.zone.availPx + EPS) { keep.push(text); continue; }
      rejected.push({
        zone: entry.key,
        text,
        chars: text.length,
        budget: budgetChars(entry.zone, text),
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
    PROSE_FLOOR_PX, PROSE_CEILING_PX, FONT_STEP_PX,
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
