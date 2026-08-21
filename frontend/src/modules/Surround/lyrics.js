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

/** `2. Ev'ry valley` where the corpus numbers its segments, else the bare name. */
function headingFor(segment) {
  const name = isText(segment?.label) ? segment.label.trim()
    : isText(segment?.name) ? segment.name.trim() : '';
  const n = segment?.n;
  if (!name) return '';
  return Number.isFinite(Number(n)) ? `${Number(n)}. ${name}` : name;
}

/**
 * THE NUMBER'S BILLING — how it is performed and where its words come from.
 *
 * `subheading:` and `heading:` are two of a segment's four authored text fields
 * (see the classical reference): `Air (Tenor)` and `Isaiah 40:1-3`. THE CORPUS
 * FIELD `heading:` IS NOT THIS MODULE'S `heading`, which is the numbered label
 * — a collision worth naming, because reading one for the other is how a rail
 * ends up printing a scripture reference where a movement title belongs. The
 * returned key is `billing` for that reason.
 *
 * Joined with the interpunct the NOW register uses, from the same two fields in
 * the same order, so the two halves of the frame cannot bill one number two
 * ways. Absent on a work that authors neither, which is most symphonies.
 */
function billingFor(segment) {
  return [segment?.subheading, segment?.heading]
    .map((v) => (isText(v) ? v.trim() : ''))
    .filter(Boolean)
    .join(' \u00b7 ');
}

/**
 * The lyric rail's whole state at one position.
 *
 * @param {object}   args
 * @param {Array}    args.segments  The rail, flattened, as the store publishes it.
 * @param {string}   args.contentId The media item currently sounding.
 * @param {number}   args.position  Seconds into THAT item.
 * @returns {{active: boolean, text: string, heading: string, billing: string, index: number}}
 *   `active` is whether the frame wears the lyric layout; `text` is the sounding
 *   segment's words, EMPTY on an instrumental number while `active` stays true;
 *   `heading` is the numbered label and `billing` the line under it.
 */
export function lyricStateAt({ segments, contentId, position }) {
  const list = Array.isArray(segments) ? segments : [];
  const dormant = { active: false, text: '', heading: '', billing: '', index: -1 };
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

  // A segment is sounding: the rail is up, whether or not this number has words.
  // The Pifa is ninety seconds of pastoral symphony between two texted numbers,
  // and sliding the layout out and back for it is the exact flapping the grace
  // window exists to prevent.
  if (sounding) {
    return {
      active: true,
      text: isText(sounding.text) ? sounding.text.trim() : '',
      heading: headingFor(sounding),
      billing: billingFor(sounding),
      index,
    };
  }

  // Nothing is sounding. This is a real gap — between numbers, a Part break, or
  // the tail — and only its LENGTH decides.
  if (pos - lastEnd <= LYRIC_GRACE_S) return { active: true, text: '', heading: '', billing: '', index: -1 };
  return dormant;
}
