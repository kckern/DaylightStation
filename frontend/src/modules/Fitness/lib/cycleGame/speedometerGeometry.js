import { rpmToAngle, polarToCartesian } from '@/modules/Fitness/player/overlays/cycleOverlayVisuals.js';

const TICK_INNER_OFFSET = 4;
const TICK_OUTER_OFFSET = 2;

export function buildTicks({ maxRpm = 120, tickStep = 10, labelStep = 30, center = 100, gaugeRadius = 80 } = {}) {
  const ticks = [];
  for (let rpm = 0; rpm <= maxRpm; rpm += tickStep) {
    const angle = rpmToAngle(rpm, maxRpm);
    const major = rpm % labelStep === 0;
    ticks.push({
      rpm,
      major,
      label: major ? rpm : null,
      inner: polarToCartesian(center, center, gaugeRadius - TICK_INNER_OFFSET, angle),
      outer: polarToCartesian(center, center, gaugeRadius + TICK_OUTER_OFFSET, angle)
    });
  }
  return ticks;
}

export function buildBandArcs({ bands, maxRpm = 120, center = 100, gaugeRadius = 80 } = {}) {
  const list = Array.isArray(bands) ? [...bands].sort((a, b) => (a.min ?? 0) - (b.min ?? 0)) : [];
  const arcs = [];
  for (let i = 0; i < list.length; i++) {
    const band = list[i];
    const start = Number.isFinite(band.min) ? band.min : 0;
    if (start >= maxRpm) continue;
    const end = i + 1 < list.length && Number.isFinite(list[i + 1].min)
      ? Math.min(list[i + 1].min, maxRpm)
      : maxRpm;
    const p1 = polarToCartesian(center, center, gaugeRadius, rpmToAngle(start, maxRpm));
    const p2 = polarToCartesian(center, center, gaugeRadius, rpmToAngle(end, maxRpm));
    arcs.push({
      id: band.id || `band-${i}`,
      color: band.color || '#666',
      d: `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${gaugeRadius} ${gaugeRadius} 0 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
    });
  }
  return arcs;
}

export function needleAngleDeg(rpm, maxRpm = 120) {
  const angle = rpmToAngle(rpm, maxRpm);
  return ((angle - 1.5 * Math.PI) * 180) / Math.PI;
}

export function bandForRpm(rpm, bands) {
  const list = Array.isArray(bands) ? [...bands].sort((a, b) => (a.min ?? 0) - (b.min ?? 0)) : [];
  if (list.length === 0) return null;
  const value = Number.isFinite(rpm) ? rpm : 0;
  let current = list[0];
  for (const band of list) {
    if (value >= (band.min ?? 0)) current = band;
    else break;
  }
  return current;
}
