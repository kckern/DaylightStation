import { ledgerLineYs } from '../../../../MusicNotation/renderers/staffGlyphs.jsx';

/**
 * Where a wrong-note ghost is engraved, as a pure function of the target
 * column's geometry.
 *
 * THE RULE (owner engraving requirement): notes sounding on the same beat are a
 * CHORD on ONE STEM. The ghost therefore belongs to the target's column and is
 * placed from the target's actual stem, not from the cursor lane's edge:
 *
 *  - A third or more away: the same side of the stem as the target head. If the
 *    ghost lies beyond the stem's vertical span, a short red stem segment joins
 *    it to the stem so the pair reads as a chord.
 *  - A second away (or the same line, another accidental): the head flips to the
 *    other side of the stem and touches it. Stem-down: the LOWER head goes
 *    left; stem-up: the UPPER head goes right. The target head belongs to the
 *    abcjs engraving and cannot move, so a ghost on the "wrong" side of it
 *    (e.g. above a stem-down head) takes the free side instead of overprinting.
 *  - No stem (a whole note): a column with no stem segment; a second goes left
 *    when below the neighbour, right when above, touching.
 *  - The same pitch is not a mistake and draws nothing.
 *  - The accidental sits left of the ghost's own head, whichever side that is.
 *  - A ledger line is drawn at the ghost's position, reaching across both heads
 *    when they sit side by side.
 *
 * Earlier the ghost was kept out of the cursor lane entirely ("nothing may be
 * drawn inside the lane that is not the note being read"), which traded correct
 * engraving for non-overlap and floated the head beside the column, stemless.
 * The lane now FRAMES the column instead; `minX`/`maxX` tell the caller how far
 * it has to widen to contain a flipped head.
 *
 * All lengths are in the SVG root's user space. Staff position 0 is the bottom
 * line and each unit is half a line spacing (same as `getStaffPositionOnClef`).
 */

/** 'down' when the stem hangs below the heads, 'up' when it rises, 'none' without one. */
export function stemDirection(stem, headYs) {
  if (!stem) return 'none';
  const head = headYs.reduce((a, b) => a + b, 0) / (headYs.length || 1);
  return stem.bottom - head >= head - stem.top ? 'down' : 'up';
}

export function placeGhosts({
  ghosts, heads, stem, bottom, spacing, rx,
  accidentalWidth = 0, accidentalGap = 0, ledgerReach = 0, targetMidis = [],
}) {
  const step = spacing / 2;
  const yOf = (position) => bottom - position * step;
  const dir = stem ? (stem.dir ?? 'down') : 'none';
  const columnX = heads[0]?.cx ?? stem?.x ?? 0;
  // The stem is a filled bar with width: a head sits flush against ITS edge (a
  // stem-down head starts at the bar's left edge, a stem-up head ends at its
  // right edge), and a flipped head is flush against the opposite one.
  const hw = stem?.halfWidth ?? 0;
  const normalX = dir === 'down' ? stem.x - hw + rx : dir === 'up' ? stem.x + hw - rx : columnX;
  const near = (a, b) => Math.abs(a - b) <= rx / 2;
  const isNormal = (head) => near(head.cx, normalX);

  const wanted = ghosts.filter(g => !targetMidis.includes(g.midi));
  // Walk in chord order so a ghost can see the heads already on the normal side.
  const ordered = [...wanted].sort((a, b) => (dir === 'up' ? a.position - b.position : b.position - a.position));
  const placed = heads.map(h => ({ position: h.position, cx: h.cx, fixed: true }));
  const out = [];
  for (const g of ordered) {
    const collides = placed.some(h => Math.abs(h.position - g.position) <= 1 && isNormal(h));
    let cx = normalX;
    if (collides) {
      const above = placed.some(h => h.position < g.position && Math.abs(h.position - g.position) <= 1);
      cx = dir === 'down' ? stem.x + hw - rx
        : dir === 'up' ? stem.x - hw + rx
        : above ? columnX + 2 * rx : columnX - 2 * rx;
    }
    placed.push({ position: g.position, cx, fixed: false });
    const cy = yOf(g.position);

    let stemSegment = null;
    if (stem && (cy < stem.top || cy > stem.bottom)) {
      stemSegment = cy < stem.top
        ? { x: stem.x, y1: cy, y2: stem.top, halfWidth: hw }
        : { x: stem.x, y1: stem.bottom, y2: cy, halfWidth: hw };
    }

    const hasAccidental = Boolean(g.isSharp || g.isFlat);
    const accX = hasAccidental ? cx - rx - accidentalGap - accidentalWidth / 2 : null;

    const lineYs = ledgerLineYs(g.position, bottom, step);
    const beside = collides ? placed.filter(h => h.position !== g.position || h.cx !== cx).filter(h => Math.abs(h.position - g.position) <= 1) : [];
    const xs = [cx, ...beside.map(h => h.cx)];
    const ledgers = lineYs.map(y => ({
      x1: Math.min(...xs) - rx - ledgerReach, x2: Math.max(...xs) + rx + ledgerReach, y,
    }));

    out.push({ ...g, cx, cy, flipped: collides, accX, stemSegment, ledgers });
  }

  let minX = null;
  let maxX = null;
  for (const g of out) {
    const left = g.accX == null ? g.cx - rx : g.accX - accidentalWidth / 2;
    const right = g.cx + rx;
    minX = minX == null ? left : Math.min(minX, left);
    maxX = maxX == null ? right : Math.max(maxX, right);
  }
  return { ghosts: out, minX, maxX };
}
