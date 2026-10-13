// Per-rider identity colors for cycle-game lanes, roster, speedometers, recap.
// Single source of truth — index = rider order. Import this instead of
// redeclaring the array.
//
// Synthwave palette — six hues distinct from both reserved UI chrome and
// HR-zone colors. Avoided hues: blue-green (#6ab8ff, #51cf66), yellow (#ffd43b),
// orange (#ff922b), red (#ff6b6b). Reserved UI chrome absent here: cyan (#21e6ff)
// and hot magenta (#ff2d95) stay exclusive to telemetry/selection accents.
// Assignment priority (index = rider order): green, teal, sand, then magenta
// lead, with rose + slate filling the remaining lanes.
//
// Audit UX §6.2: lane 1 used to be #4dd0e1 — a "soft cyan" that reads as the
// same hue as the reserved chrome cyan ($cg-cyan / #21e6ff) at a race-day
// glance. Moved to #5dff9b — the green already reserved for "go"/"success"
// state as $cg-lane-1 in _cgTokens.scss, so a rider tinted this color and the
// app's own go/success chrome now agree instead of clashing with chrome cyan.
// The old maroon (#a14d6b, ~3.4:1 against $cg-bg) is brightened to #d4708f
// (~6.1:1 — verified in lineColors.test.js via contrastRatio()).
export const LINE_COLORS = [
  '#5dff9b', // green (was cyan #4dd0e1 — too close to reserved chrome cyan)
  '#2dd4bf', // teal
  '#cbb285', // sand / tan
  '#d472c0', // magenta (softer than the reserved hot magenta #ff2d95)
  '#d4708f', // rose (was maroon #a14d6b — brightened for AA contrast)
  '#9aa3c0'  // slate gray
];

// ── Contrast + distance helpers (audit UX §6.2 acceptance criteria) ────────
// Small, dependency-free WCAG relative-luminance contrast so the palette's
// AA-contrast claim is verified in-repo rather than eyeballed.
function hexToRgb(hex) {
  const clean = String(hex).replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16) / 255,
    g: parseInt(clean.slice(2, 4), 16) / 255,
    b: parseInt(clean.slice(4, 6), 16) / 255
  };
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two hex colors (1..21). */
export function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Sum of absolute per-channel (0-255) differences — a cheap, deterministic
 * "how visually close are these two hues" check. Not perceptual color
 * science; good enough to catch "this lane basically IS the chrome cyan"
 * regressions without pulling in a color-distance library. */
export function channelDistance(hexA, hexB) {
  const a = String(hexA).replace('#', '');
  const b = String(hexB).replace('#', '');
  const ar = parseInt(a.slice(0, 2), 16), ag = parseInt(a.slice(2, 4), 16), ab = parseInt(a.slice(4, 6), 16);
  const br = parseInt(b.slice(0, 2), 16), bg = parseInt(b.slice(2, 4), 16), bb = parseInt(b.slice(4, 6), 16);
  return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
}

/**
 * Rider-color CSS custom props, keyed by array index (NOT rider id — matches
 * the `LINE_COLORS[idx % LINE_COLORS.length]` convention every consumer
 * already uses). Inject once at the race screen root (`--cg-lane-0` etc.) so
 * SCSS can reference `var(--cg-lane-N)` for lane-tinted chrome instead of
 * re-declaring hex literals (audit UX §6.2). Defaults to the full 6-color
 * palette when riderIds is omitted, so it's usable before a roster is known.
 */
export function laneColorVars(riderIds = []) {
  const count = Array.isArray(riderIds) && riderIds.length > 0 ? riderIds.length : LINE_COLORS.length;
  const vars = {};
  for (let idx = 0; idx < count; idx++) {
    vars[`--cg-lane-${idx}`] = LINE_COLORS[idx % LINE_COLORS.length];
  }
  return vars;
}
