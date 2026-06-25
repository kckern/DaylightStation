/**
 * regionStyle — translate a bezel-relative %-region into absolute CSS offsets.
 *
 * Regions use the SAME convention as the manifest's `presentation.screen`
 * block: `{ x, y, width, height }` as percentages of the bezel image, where
 * x/y is the top-left corner. The emulator layers are full-bleed over the
 * bezel, so percent offsets line up 1:1 with the rendered chrome.
 *
 * @param {{x?:number,y?:number,width?:number,height?:number}|null} region
 * @returns {object} inline-style object (empty when region is absent)
 */
export function regionStyle(region) {
  if (!region || typeof region !== 'object') return {};
  const style = { position: 'absolute' };
  const edges = [
    ['x', 'left'],
    ['y', 'top'],
    ['width', 'width'],
    ['height', 'height'],
  ];
  for (const [key, cssProp] of edges) {
    const v = region[key];
    if (typeof v === 'number' && Number.isFinite(v)) style[cssProp] = `${v}%`;
  }
  // No usable edges → nothing to position.
  if (Object.keys(style).length === 1) return {};
  return style;
}

export default regionStyle;
