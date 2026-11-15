/** Largest GemGlyph grid that fits the prepared category count, without scrolling. */
export function rewardsGridFit(count, width, height) {
  if (!count || !(width > 0) || !(height > 0)) return { columns: 1, fontPx: 16 };
  let best = { columns: 1, fontPx: 0 };
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const fontPx = Math.min(42, width / (columns * 5 + (columns - 1) * .4), height / (rows * 5.8 + (rows - 1) * .4));
    if (fontPx > best.fontPx + .01) best = { columns, fontPx };
  }
  return best;
}
