// Pure layout sizing math for the race screen.
//
// columnTemplateFor: a panel's sizeHint → its relative weight in the top grid
// row, so a 'focus' panel (the broadcast camera) gets more width than a
// 'standard' one. Returns a CSS grid-template-columns string.
const HINT_WEIGHT = { focus: 2, wide: 1, standard: 1 };

export function columnTemplateFor(sizeHints = []) {
  const list = (Array.isArray(sizeHints) ? sizeHints : []).filter(Boolean);
  if (list.length === 0) return '1fr';
  return list.map((h) => `${HINT_WEIGHT[h] || 1}fr`).join(' ');
}

// fitScale: the largest uniform scale (≤ 1) that fits `content` inside `zone`
// without overflow. 1 when it already fits or when a dimension is unknown.
export function fitScale(content = {}, zone = {}) {
  const cw = Number(content.width) || 0;
  const ch = Number(content.height) || 0;
  const zw = Number(zone.width) || 0;
  const zh = Number(zone.height) || 0;
  if (cw <= 0 || ch <= 0 || zw <= 0 || zh <= 0) return 1;
  return Math.min(1, zw / cw, zh / ch);
}

// Honest budget for the chrome BELOW the dial. The odometer pill + its gap to
// the gauge (ODOMETER_CHROME_PX) — audit UX §3.3 found the old `zoneH - 50` estimate under-budgeted the
// real ~56-66px the odometer pill actually occupies, so the speedo band bled
// into the zone above it (the zone was `overflow: visible`, which papered over
// the shortfall by letting the overflow show instead of clipping it — RaceLayoutManager.scss
// now sets `overflow: hidden` on that zone, so an under-budget here would clip
// the odometer instead of merely bleeding; this constant must stay honest).
export const ODOMETER_CHROME_PX = 68;
// The boost meter row between the gauge and the odometer: its fixed CSS height
// (CycleSpeedometer.scss .cycle-speedometer__boost) and one more column gap.
export const BOOST_ROW_PX = 40;
export const SPEEDO_STACK_GAP_PX = 10; // .cycle-speedometer { gap }
export const CHROME_BELOW_GAUGE_PX = ODOMETER_CHROME_PX + BOOST_ROW_PX + SPEEDO_STACK_GAP_PX;

// gaugeRowSize: the per-gauge pixel size for the speedo row, derived from the
// zone box the LAYOUT measured (not the row's own content height — that
// self-measuring is the thrash loop). Fits N gauges across the width minus gaps,
// capped by the available height, clamped to [min, max].
export function gaugeRowSize({ zoneW = 0, zoneH = 0, count = 1, gap = 28, min = 96, max = 280 } = {}) {
  const n = Math.max(1, count);
  const byWidth = (zoneW - gap * (n - 1)) / n;
  const byHeight = zoneH - CHROME_BELOW_GAUGE_PX;
  const raw = Math.floor(Math.min(byWidth, byHeight));
  return Math.max(min, Math.min(max, Number.isFinite(raw) && raw > 0 ? raw : min));
}

// Speedo-row min/max gauge sizes per layout mode (RaceLayoutManager picks the
// mode by field size — see CycleRaceScreen.jsx). These floors are derived from
// each mode's grid-row CSS minimum (RaceLayoutManager.scss) minus
// CHROME_BELOW_GAUGE_PX, so `gaugeRowSize(...) + CHROME_BELOW_GAUGE_PX` never
// exceeds the band the layout actually reserves (verified by the
// `layoutSizing.test.js` "band never exceeds its grid row" invariant).
//
// Sidebar mode (≤3 riders) and the solo band: the speedo row is
// `minmax(260px, …)`. floor = 260 - 118 = 142; keep a small margin → 140.
export const SPEEDO_MIN_GAUGE_SIDEBAR = 140;
export const SPEEDO_MAX_GAUGE_SIDEBAR = 360;
// Wide mode (≥4 riders): `.race-layout__wide-main` row is `minmax(220px, 42%)`.
//   floor = 220 - 118 = 102; 96 clears it.
export const SPEEDO_MIN_GAUGE_WIDE = 96;
export const SPEEDO_MAX_GAUGE_WIDE = 280;

export default {
  columnTemplateFor, fitScale, gaugeRowSize, CHROME_BELOW_GAUGE_PX,
  ODOMETER_CHROME_PX, BOOST_ROW_PX, SPEEDO_STACK_GAP_PX,
  SPEEDO_MIN_GAUGE_SIDEBAR, SPEEDO_MAX_GAUGE_SIDEBAR, SPEEDO_MIN_GAUGE_WIDE, SPEEDO_MAX_GAUGE_WIDE
};

/**
 * Race screen layout mode. Missing, negative or NaN counts are treated as 0.
 * @param {{liveCount?:number, fieldSize?:number}} [args]
 * @returns {'solo'|'wide'|'sidebar'} solo: one live rider with at most one rival; wide: 4+ on the road; else sidebar
 */
export function raceLayoutMode({ liveCount = 0, fieldSize = 0 } = {}) {
  const clean = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
  const live = clean(liveCount);
  const field = clean(fieldSize);
  if (live === 1 && field <= 2) return 'solo';
  return field >= 4 ? 'wide' : 'sidebar';
}
