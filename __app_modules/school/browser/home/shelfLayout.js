// Content-aware shelf packer for a subject page. Given the present kinds and
// how many items each holds, it decides the arrangement rather than blindly
// stacking identical full-width rows: a kind with a large collection becomes a
// WIDE band (one height-capped row of tiles + "See more", so it never floods
// the fold), while kinds with few items are NARROW and pack side-by-side into a
// shared band (splitting the width in proportion to their item counts). Aspect
// ratios live in CSS per kind (video 2:3, audio 1:1) — this planner only decides
// widths, caps, and banding, so it stays pure and testable.

const POSTER_KINDS = new Set(['video', 'audio']);

// A poster shelf at/above this many items is a "large collection" — it gets its
// own full-width band capped to one row (flood mitigation), the rest behind
// "See more". Below it, a shelf is narrow and shares a band.
export const FLOOD = 6;
// Max tiles shown in a wide (capped) poster row before "See more".
export const WIDE_CAP = 8;
// Apps/decks are list tiles (banners/cards); show a few, rest behind "See more".
export const LIST_CAP = 4;

/**
 * @param {Array<{kindId:string, items:Array}>} shelves - non-empty kinds, in the
 *   order they should appear (KIND order). Each `items` is already ranked.
 * @returns {Array<{type:'row', shelves:Array<{kindId, items, wide:boolean, cap:number}>}>}
 *   a vertical list of bands; each band is a row of one wide shelf, or several
 *   narrow shelves packed side-by-side.
 */
export function planBands(shelves = []) {
  const bands = [];
  let run = [];
  const flush = () => { if (run.length) { bands.push({ type: 'row', shelves: run }); run = []; } };

  for (const s of shelves) {
    if (!s || !s.items || s.items.length === 0) continue;
    const poster = POSTER_KINDS.has(s.kindId);
    const wide = poster && s.items.length >= FLOOD;
    const cap = wide ? WIDE_CAP : (poster ? s.items.length : LIST_CAP);
    const entry = { ...s, wide, cap };
    if (wide) {
      flush();                                   // a wide band stands alone
      bands.push({ type: 'row', shelves: [entry] });
    } else {
      run.push(entry);                           // narrow shelves accumulate
    }
  }
  flush();
  return bands;
}

export default planBands;
