/**
 * Where the distance chart's goal-line label ("⚑ 1.50 km") sits along the goal
 * line so it never covers a rider's terminus tag.
 *
 * The label rides the goal line near its right end. A rider closing on the
 * finish brings their tag (avatar + distance) up to that same line, at the
 * right edge of the plot — exactly where the label is (2026-11-10: "1.50 km"
 * printed over the leader's "960 m"). The label keeps its look and its line;
 * it slides LEFT along the line, to just clear of any tag it would touch, and
 * slides back when the tags move on. Pure: px in, px out, no DOM.
 *
 * Boxes are in plot pixels. Tags are centre-anchored (`translate(-50%,-50%)`),
 * the label is top-anchored with its left edge returned.
 *
 * @param {object} args
 * @param {{w:number,h:number,top:number}} args.label  the label's size and top edge
 * @param {Array<{x:number,y:number,w:number,h:number}>} args.tags  centre x/y + size of each tag
 * @param {number} args.plotW  plot width
 * @param {number} args.anchorRight  where the label's right edge sits when nothing is in the way
 * @param {number} [args.gapPx]  clearance kept between the label and a tag
 * @param {number} [args.minLeft]  the label never goes left of this (the y-axis label lives there)
 * @returns {number} the label's left edge, px
 */
export function goalLabelLeft({ label, tags = [], plotW, anchorRight, gapPx = 8, minLeft = 0 }) {
  const w = Math.max(0, label?.w || 0);
  const h = Math.max(0, label?.h || 0);
  const top = label?.top || 0;
  let right = Math.min(anchorRight, plotW);
  // An unmeasured label (first paint, jsdom) covers nothing: stay at the anchor.
  if (!w || !h) return Math.max(minLeft, right - w);
  // Right-to-left: the label only ever moves left, so each tag is checked
  // against where the label is after every tag to its right has pushed it.
  const ordered = tags
    .filter((t) => t && Number.isFinite(t.x) && Number.isFinite(t.y))
    .sort((a, b) => (b.x - b.w / 2) - (a.x - a.w / 2));
  for (const t of ordered) {
    const tTop = t.y - t.h / 2;
    const tBottom = t.y + t.h / 2;
    const tLeft = t.x - t.w / 2;
    const tRight = t.x + t.w / 2;
    const vertical = tTop < top + h + gapPx && tBottom + gapPx > top;
    if (!vertical) continue;
    const left = right - w;
    const horizontal = tLeft < right + gapPx && tRight + gapPx > left;
    if (!horizontal) continue;
    right = tLeft - gapPx;
  }
  return Math.max(minLeft, right - w);
}
