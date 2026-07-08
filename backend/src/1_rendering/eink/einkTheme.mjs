/**
 * Eink default theme — palette + widget presentation constants
 * @module 1_rendering/eink/einkTheme
 *
 * Single source of truth for the renderer's default presentation values.
 * Screen configs may override any DEFAULT_THEME key (EinkRenderer spreads
 * `screenConfig.theme` over these defaults).
 */

// The target (Seeed reTerminal E1003) is a MONOCHROME, 16-level grayscale panel —
// there is no color. The palette is therefore a grayscale ramp whose values snap
// near the 16 hardware levels (0x00..0xFF in ~0x11 steps) so each fill renders as
// a clean tone, never a dithered color stipple. The color-named keys
// (red/blue/green/yellow) are kept as TONAL ALIASES — dark-to-light grays — so the
// widgets that reference them need no rewrite. Rendering note: IT8951 fast/partial
// (A2) refresh is effectively 1-bit, so keep grays in STATIC chrome; any gray in a
// frequently-changing region forces a full (flashing) refresh.
export const DEFAULT_THEME = {
  bg: '#FFFFFF',          // white — e-ink reads crispest at the tonal extremes
  fg: '#000000',          // black
  muted: '#777777',       // mid gray — secondary text
  headerBg: '#000000',
  headerFg: '#FFFFFF',
  // grayscale ramp (dark -> light) for tonal hierarchy
  ink: '#000000',
  g1: '#333333',
  g2: '#555555',
  g3: '#888888',
  g4: '#BBBBBB',
  g5: '#DDDDDD',
  // tonal aliases — this mono panel has no color; severe/important -> darker tones
  red: '#222222',
  blue: '#444444',
  green: '#666666',
  yellow: '#999999',
};

/**
 * PlaceholderWidget label font. Deliberately NOT the base family (see
 * widgets/lib/fonts.mjs): the placeholder marks an unknown widget name, and a
 * generic system face keeps it visually distinct from real content.
 */
export const PLACEHOLDER_FONT = '24px sans-serif';

export default DEFAULT_THEME;
