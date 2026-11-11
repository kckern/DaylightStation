import { TAG_OVERHANG_PX } from './speedometerOverlayLayout.js';

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

// Honest budget for the chrome BELOW the dial (RaceLayoutManager.scss sets
// overflow: hidden on the band, so an under-budget clips the odometer). The
// gauge is the column's hero, so this is kept small: the multiplier tag's
// overhang below the dial, a one-line zone bar row, and the odometer pill,
// with a stack gap between each.
// The odometer pill: cg-type(3) text, 4 px padding, 1 px border (measured on
// the harness at the kiosk size).
export const ODOMETER_CHROME_PX = 42;
// The zone progress row (bar + next step) between the gauge and the odometer:
// its fixed CSS height (CycleSpeedometer.scss .cycle-speedometer__boost).
export const BOOST_ROW_PX = 22;
export const SPEEDO_STACK_GAP_PX = 6; // .cycle-speedometer { gap }
export const CHROME_BELOW_GAUGE_PX = TAG_OVERHANG_PX + BOOST_ROW_PX + ODOMETER_CHROME_PX + 2 * SPEEDO_STACK_GAP_PX;
// Horizontal gap between gauges in the row (.cycle-race-screen__speedos gap).
export const SPEEDO_GAP_PX = 16;

// gaugeRowSize: the per-gauge pixel size for the speedo row, derived from the
// zone box the LAYOUT measured (not the row's own content height — that
// self-measuring is the thrash loop). Fits N gauges across the width minus gaps,
// capped by the available height, clamped to [min, max].
export function gaugeRowSize({ zoneW = 0, zoneH = 0, count = 1, gap = SPEEDO_GAP_PX, min = 96, max = 280 } = {}) {
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
// `minmax(260px, …)`. 260 - CHROME_BELOW_GAUGE_PX (86) = 174 ≥ the 140 floor.
export const SPEEDO_MIN_GAUGE_SIDEBAR = 140;
export const SPEEDO_MAX_GAUGE_SIDEBAR = 360;
// Wide mode (≥4 riders): the gauge is sized from the WIDTH (band width minus
// gaps, divided by the rider count) and the band's height follows it
// (RaceLayoutManager.scss, `--cg-speedo-n`). A fixed 220 px floor put six gauges
// (6 x 220 + gaps = 1460 px) past both edges of the 1381x777 garage kiosk
// (2026-11-10); 150 px is the floor, the same scale the sidebar runs at.
export const SPEEDO_MIN_GAUGE_WIDE = 150;
export const SPEEDO_MAX_GAUGE_WIDE = 280;
// Vertical padding of the speedo zone (.race-layout__zone--speedo: 6 + 10) and
// horizontal padding (8 + 8): the band height CSS adds these to gauge + chrome.
export const SPEEDO_ZONE_PAD_Y = 16;
export const SPEEDO_ZONE_PAD_X = 16;

/**
 * Wide-mode gauge size from the band width alone (no height loop): what
 * RaceLayoutManager.scss reserves and what SpeedoRow then measures.
 * @param {{width:number, count:number, gap?:number}} args width = the race layout's width
 */
export function wideGaugeSize({ width = 0, count = 1, gap = SPEEDO_GAP_PX } = {}) {
  const n = Math.max(1, count);
  const raw = Math.floor((width - SPEEDO_ZONE_PAD_X - gap * (n - 1)) / n);
  return Math.max(SPEEDO_MIN_GAUGE_WIDE, Math.min(SPEEDO_MAX_GAUGE_WIDE, Number.isFinite(raw) ? raw : SPEEDO_MIN_GAUGE_WIDE));
}

export default {
  columnTemplateFor, fitScale, gaugeRowSize, wideGaugeSize, CHROME_BELOW_GAUGE_PX,
  ODOMETER_CHROME_PX, BOOST_ROW_PX, SPEEDO_STACK_GAP_PX, SPEEDO_GAP_PX,
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
