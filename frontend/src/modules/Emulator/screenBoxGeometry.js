// screenBoxGeometry.js — integer-lock screen box math for EmulatorConsole.jsx,
// split out so Fast Refresh can hot-reload the console component on its own.

/**
 * Pure integer-lock geometry: largest integer scale N where an
 * N×nativeW × N×nativeH device-px box fits the cutout, centered + pixel-snapped.
 * Exported for unit testing; the layout effect calls it with measured values.
 */
export function computeScreenBox({ cut, dpr, native }) {
  const nw = native && Number.isFinite(native.width) ? native.width : 160;
  const nh = native && Number.isFinite(native.height) ? native.height : 144;
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
