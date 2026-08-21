/**
 * WHEN THE FRAME SHOWS SUNG TEXT, AND WHAT IT SHOWS.
 *
 * One pure function, deliberately, because the answer is needed in two places
 * that must never disagree: `SurroundFrame` uses it to decide which rail the
 * layout wears, and `ScriptRail` uses it to decide what to print. A module
 * that reported its own emptiness upward would make the frame's layout depend
 * on a child's render, which is the shape that produces a one-frame flash of
 * the wrong column on every segment boundary.
 *
 * IT IS PURE, AND THAT IS THE HYSTERESIS DESIGN, not an accident of style. The
 * obvious implementation of "hold for 20 seconds after the words stop" is a
 * timer and a ref, and it is wrong here: the clock this frame runs on is MEDIA
 * time, which seeks. A ref-based hold survives a seek across a Part break and
 * shows the lyric rail over an interval; this reads the answer off the rail
 * itself, so scrubbing lands in exactly the state that position deserves.
 */

/**
 * How long the rail holds after the last segment stops sounding.
 *
 * Messiah is the piece this exists for: 53 numbers with short gaps between
 * them, where a naive trigger would slide the whole composition in and out all
 * evening. Twenty seconds covers a between-numbers gap and a page turn, and
 * does not cover a Part break, the applause before the first number, or the
 * tail after the last — which are precisely the three moments the frame should
 * hand the screen back to the programme rail.
 */
export const LYRIC_GRACE_S = 20;

const isText = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * DOES THIS RAIL CARRY WORDS ANYWHERE? The gate for the whole feature, and the
 * reason it ships dormant: a piece whose segments carry no text renders exactly
 * the frame it renders today, with no lyric slot in the tree at all.
 *
 * It asks the WHOLE rail rather than the sounding item, so that a container
 * does not change its layout between parts — Messiah's Part Three would
 * otherwise be a different shape from Part One if one of them happened to open
 * instrumentally.
 */
export function railHasText(segments) {
  const list = Array.isArray(segments) ? segments : [];
  return list.some((s) => isText(s?.text));
}

/**
 * SPLIT MEASURED LINES INTO PAGES THAT FIT THE BOX.
 *
 * The frame's standing law is that nothing is ever cut — no ellipsis, at any
 * size, on any screen — and the lyric box is generous but not infinite. Where
 * the type has already been stepped down to its floor and a long air still
 * overruns, the text PAGES. Scrolling is not an option: this is a television
 * read from across a room, with no pointer and no scrollbar a viewer could use.
 *
 * Pure and measured-in: the caller reads the real line heights off the DOM and
 * hands them here, so the rule that decides a break can be asserted without a
 * layout engine.
 *
 * @param {number[]} lineHeights Rendered height of each line, in order.
 * @param {number}   boxHeight   Height available. 0 (unmeasured) means one page.
 * @returns {number[][]} Line indices per page.
 */
export function paginate(lineHeights, boxHeight) {
  const lines = Array.isArray(lineHeights) ? lineHeights : [];
  if (lines.length === 0) return [];
  const box = Number(boxHeight);
  // Before the first measurement there is no honest break to make, and guessing
  // one would flash a wrong page on mount. One page, and the effect re-runs.
  if (!Number.isFinite(box) || box <= 0) return [lines.map((_, i) => i)];

  const pages = [];
  let page = [];
  let used = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const h = Number(lines[i]) || 0;
    // A line taller than the whole box cannot be made to fit. It gets its own
    // page and overflows it rather than being dropped: showing a viewer a
    // cramped line is a smaller failure than silently withholding one.
    if (page.length > 0 && used + h > box) { pages.push(page); page = []; used = 0; }
    page.push(i);
    used += h;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}


/**
 * THE NUMBER'S BILLING — the two lines standing over the words.
 *
 * A segment authors four text fields, and only two of them belong here:
 *
 *   `heading:`    where the words come from.  "Lamentations 1:12"   -> HEADER
 *   `subheading:` how it is performed.        "Air (Tenor)"         -> SUBHEADER
 *   `label:`      the number's short name — the rail's, not this panel's
 *   `text:`       the words themselves
 *
 * THE LABEL AND THE NUMERAL ARE DELIBERATELY ABSENT. `label:` is the INCIPIT:
 * in the corpus, segment 30 of Messiah has `label: Behold, and see if there be
 * any sorrow` and a `text:` whose first line is that same sentence. Setting it
 * over the verse printed one line twice, an inch apart, on the panel where
 * space is scarcest. The classical README already refuses it for the band's NOW
 * register on exactly this ground ("otherwise the same words twice within six
 * inches of screen"); here the two are adjacent, so the case is stronger. The
 * numeral goes with it — it is on the time rail beneath the video, where a
 * locator belongs.
 *
 * PROMOTION, NOT AN ORPHAN. A number that authors only one of the pair puts it
 * in the HEADER. A subheader alone under nothing is a caption for an absence.
 *
 * AND A NUMBER THAT AUTHORS NEITHER IS STILL NAMED. Most of Messiah's texted
 * numbers carry no `heading:` and no `subheading:` at all; with the pair
 * unauthored, `label:` (then `name:`) is the only name the number has, and a
 * rail that heads a verse with nothing is worse than one that repeats a name.
 * This branch used to be justified by the Pifa, which no longer reaches it:
 * an instrumental is dormant now, so `billingFor` never sees a wordless
 * segment.
 *
 * @returns {{heading: string, subheading: string}}
 */
function billingFor(segment) {
  const source = isText(segment?.heading) ? segment.heading.trim() : '';
  const manner = isText(segment?.subheading) ? segment.subheading.trim() : '';
  if (source) return { heading: source, subheading: manner };
  if (manner) return { heading: manner, subheading: '' };
  const named = isText(segment?.label) ? segment.label.trim()
    : isText(segment?.name) ? segment.name.trim() : '';
  return { heading: named, subheading: '' };
}

/**
 * The lyric rail's whole state at one position.
 *
 * @param {object}   args
 * @param {Array}    args.segments  The rail, flattened, as the store publishes it.
 * @param {string}   args.contentId The media item currently sounding.
 * @param {number}   args.position  Seconds into THAT item.
 * @returns {{active: boolean, text: string, heading: string, subheading: string, index: number}}
 *   `active` is whether the frame wears the lyric layout; `text` is the sounding
 *   segment's words, EMPTY only while the rail HOLDS across a short gap with
 *   nothing sounding — an instrumental number goes dormant instead;
 *   `heading` and `subheading` are the corpus fields of those names — see
 *   `billingFor`, and note that `heading` is NOT the number's label.
 */
export function lyricStateAt({ segments, contentId, position }) {
  const list = Array.isArray(segments) ? segments : [];
  const dormant = { active: false, text: '', heading: '', subheading: '', index: -1 };
  if (!railHasText(list)) return dormant;

  const id = String(contentId ?? '');
  const pos = Number(position);
  if (!Number.isFinite(pos)) return dormant;

  let index = -1;
  let sounding = null;
  // The last moment any segment of this item had stopped sounding, as of `pos`.
  // A gap's length is measured from here; -Infinity means nothing has ended yet,
  // which is the pre-roll before the first number and reads as "no grace".
  let lastEnd = -Infinity;

  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    if (String(c?.contentId) !== id) continue;
    const start = Number(c?.start);
    const end = Number(c?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    // LAST match wins, exactly as `segmentAt` resolves it — the rail may nest,
    // and the innermost segment containing the playhead is the sounding one.
    if (pos >= start && pos < end) { index = i; sounding = c; }
    if (pos >= end && end > lastEnd) lastEnd = end;
  }

  // The lyric rail is up ONLY when the sounding segment has words. An
  // instrumental number (the Sinfonia, the Pifa) hands the screen back to the
  // programme rail — the video slides left and right as text comes and goes,
  // and that is the intended behaviour.
  if (sounding) {
    if (!isText(sounding.text)) return dormant;
    return {
      active: true,
      text: sounding.text.trim(),
      ...billingFor(sounding),
      index,
    };
  }

  // Nothing is sounding. This is a real gap — between numbers, a Part break, or
  // the tail — and only its LENGTH decides.
  //
  // THE TWO RULES ARE ABOUT DIFFERENT LENGTHS OF SILENCE, not in tension. An
  // instrumental has ALREADY returned dormant above, so nothing reaching here
  // is a ninety-second Pifa the programme rail should be narrating; it is the
  // few seconds between two numbers. The rails TRAVEL, and sliding them out and
  // back across four seconds is precisely the flapping the grace window exists
  // to prevent — the merge that deleted this branch put that flap back.
  if (pos - lastEnd <= LYRIC_GRACE_S) {
    return { active: true, text: '', heading: '', subheading: '', index: -1 };
  }
  return dormant;
}
