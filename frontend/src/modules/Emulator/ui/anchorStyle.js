/**
 * anchorStyle — corner anchor + offset + scale → absolute CSS.
 *
 * Unlike regionStyle (a manifest-measured %-box), a session badge is sized by
 * its own content, not a fixed box: position is a corner + offset, and size
 * is one scale multiplier applied via `transform`, so font/padding/gaps move
 * together and the badge can't clip regardless of console.
 *
 * @param {{anchor?:string,offsetX?:string,offsetY?:string,scale?:number}} opts
 * @returns {object} inline-style object
 */
const CORNERS = {
  'top-left': { top: true, left: true },
  'top-right': { top: true, right: true },
  'bottom-left': { bottom: true, left: true },
  'bottom-right': { bottom: true, right: true },
};

export function anchorStyle({ anchor, offsetX, offsetY, scale } = {}) {
  const corner = CORNERS[anchor] || CORNERS['top-left'];
  const style = { position: 'absolute' };
  if (corner.top) style.top = offsetY ?? '2%';
  if (corner.bottom) style.bottom = offsetY ?? '2%';
  if (corner.left) style.left = offsetX ?? '2%';
  if (corner.right) style.right = offsetX ?? '2%';
  const s = Number(scale);
  if (Number.isFinite(s) && s > 0 && s !== 1) {
    style.transform = `scale(${s})`;
    style.transformOrigin = `${corner.top ? 'top' : 'bottom'} ${corner.left ? 'left' : 'right'}`;
  }
  return style;
}

export default anchorStyle;
