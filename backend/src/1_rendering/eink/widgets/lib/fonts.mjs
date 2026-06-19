/**
 * Eink base font — Roboto Condensed
 * @module 1_rendering/eink/widgets/lib/fonts
 *
 * Single source of truth for the renderer's base typeface. node-canvas resolves
 * a font family by NAME only after the face file has been registered, so the
 * renderer registers FONT_FACES once per render (see EinkRenderer). Widgets then
 * address the base font through `font()` rather than hardcoding a family string —
 * swap the family here and the whole panel follows.
 */

export const BASE_FONT = 'Roboto Condensed';

/**
 * Face files to register, relative to the canvas fontDir. Regular covers normal
 * weight; SemiBold is registered as `bold` so `font(size, { bold: true })`
 * resolves to a real bold face (node-canvas falls back to synthetic bold if the
 * SemiBold file is absent on a given host).
 */
export const FONT_FACES = [
  { path: 'roboto-condensed/RobotoCondensed-Regular.ttf', family: BASE_FONT, weight: 'normal' },
  { path: 'roboto-condensed/RobotoCondensed-SemiBold.ttf', family: BASE_FONT, weight: 'bold' },
];

/**
 * Build a canvas font string in the base family.
 * @param {number} size - px
 * @param {{ bold?: boolean }} [opts]
 * @returns {string}
 */
export function font(size, { bold = false } = {}) {
  return `${bold ? 'bold ' : ''}${size}px ${BASE_FONT}`;
}
