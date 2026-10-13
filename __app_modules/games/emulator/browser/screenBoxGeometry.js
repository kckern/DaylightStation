// screenBoxGeometry.js — screen box math for EmulatorConsole.jsx, split out so
// Fast Refresh can hot-reload the console component on its own.

/**
 * Where the picture goes inside the bezel's cutout.
 *
 * Two modes, because two kinds of console want different things:
 *
 * `integer` (the default, and what the Game Boy needs) — the largest whole
 * multiple of the native framebuffer that fits, centred and pixel-snapped. The
 * dot-matrix shader draws an LCD grid at multiples of `scale` device pixels, so
 * each game pixel must be an exact whole number of them or the grid moirés
 * against the picture. The cost is up to a full step of unused cutout: a 320x224
 * frame in a 1198x838 hole locks to 3x = 960x672 and leaves a fifth of the
 * aperture empty, because 4x would overflow it.
 *
 * `fill` — take the whole cutout. Right for any console without a pixel grid to
 * align to, and NOT merely a cosmetic stretch: a Genesis put 320x224 across a
 * 4:3 television, so its pixels were never square. The cutout is measured to the
 * console's real display aspect and filling it reproduces that geometry, which
 * is the same thing `genesis_plus_gx_aspect_ratio = auto` does on the Shield.
 *
 * Exported for unit testing; the layout effect calls it with measured values.
 *
 * @param {object} args
 * @param {{left:number,top:number,width:number,height:number}} args.cut bezel cutout in CSS px
 * @param {number} args.dpr device pixel ratio
 * @param {{width:number,height:number}} [args.native] framebuffer size
 * @param {'integer'|'fill'} [args.scaling]
 * @param {number} [args.overscan] `fill` only: fraction to grow the box beyond
 *   `cut`, centred, before the parent's `overflow:hidden` crops it back down.
 *   Exists for a picture-shader (crt-geom) that renders its own curvature inset
 *   a few percent in from whatever box it's given — see the call site comment
 *   in EmulatorConsole.jsx. Zero (the default) is a plain, uncropped fill.
 * @returns {{left:number,top:number,width:number,height:number,cell:number,scale:number}}
 */
export function computeScreenBox({ cut, dpr, native, scaling = 'integer', overscan = 0 }) {
  const nw = native && Number.isFinite(native.width) ? native.width : 160;
  const nh = native && Number.isFinite(native.height) ? native.height : 144;

  if (scaling === 'fill') {
    const factor = 1 + (Number.isFinite(overscan) && overscan > 0 ? overscan : 0);
    const grownWidth = cut.width * factor;
    const grownHeight = cut.height * factor;
    const grownLeft = cut.left - (grownWidth - cut.width) / 2;
    const grownTop = cut.top - (grownHeight - cut.height) / 2;
    // Snap to whole device pixels so the edges stay crisp against the bezel.
    const left = Math.round(grownLeft * dpr) / dpr;
    const top = Math.round(grownTop * dpr) / dpr;
    const width = Math.round(grownWidth * dpr) / dpr;
    const height = Math.round(grownHeight * dpr) / dpr;
    // Reported for telemetry only — fractional here by definition, and no grid
    // is drawn in this mode, so nothing consumes it as a step size.
    const scale = (width * dpr) / nw;
    return { left, top, width, height, cell: scale / dpr, scale };
  }

  const scale = Math.max(1, Math.min(
    Math.floor((cut.width * dpr) / nw),
    Math.floor((cut.height * dpr) / nh),
  ));
  const width = (scale * nw) / dpr;
  const height = (scale * nh) / dpr;
  const left = Math.round((cut.left + (cut.width - width) / 2) * dpr) / dpr;
  const top = Math.round((cut.top + (cut.height - height) / 2) * dpr) / dpr;
  const cell = scale / dpr;
  return { left, top, width, height, cell, scale };
}
