import { rpmToAngle, polarToCartesian } from '@/modules/Fitness/player/overlays/cycleOverlayVisuals.js';

const TICK_INNER_OFFSET = 4;
const TICK_OUTER_OFFSET = 2;

// The cadence_zones in config (warmup/cruising/pushing/sprint) were authored for
// the original ~120-RPM gauge. On a larger gauge (e.g. a 250-RPM tricycle) their
// absolute thresholds leave a huge "sprint/red" wedge. Treat them as proportions
// of this reference and stretch them to the actual gauge so the colour tiers keep
// their intent across equipment.
const BAND_REFERENCE_RPM = 120;

// System-default cadence colour bands (authored against the 120-RPM reference).
// Used whenever the config supplies no `cadence_zones` so the speedometer always
// shows its green→yellow→orange→red intensity zones instead of a bare arc.
// Thresholds are RPM mins; scaleBands() stretches them to the actual gauge.
//
// Audit UX §6.2: the original FlatUI set (#2ecc71/#f1c40f/#e67e22/#e74c3c) was a
// flat, non-neon palette that clashed with the synthwave gauge chrome around it.
// Neon-shifted to the same family as the rest of the HUD (sprint red matches
// $cg-danger) while keeping the green→yellow→orange→red semantic order intact.
export const DEFAULT_CADENCE_BANDS = [
  { id: 'warmup',   name: 'Warm-up',  min: 0,   color: '#5b6470' }, // grey base
  { id: 'cruising', name: 'Cruising', min: 40,  color: '#46e08a' }, // neon green
  { id: 'pushing',  name: 'Pushing',  min: 70,  color: '#ffd93d' }, // neon yellow
  { id: 'hard',     name: 'Hard',     min: 90,  color: '#ff9f43' }, // neon orange
  { id: 'sprint',   name: 'Sprint',   min: 105, color: '#ff5a5a' }  // neon red ($cg-danger)
];

// Pick a tick/label spacing that keeps the dial legible at any gauge max — aim
// for ~12 minor ticks, labelling every third. A fixed 10/30 crowds a 250 gauge.
const NICE_STEPS = [5, 10, 20, 25, 50];
export function tickStepsFor(maxRpm) {
  const m = Number.isFinite(maxRpm) && maxRpm > 0 ? maxRpm : BAND_REFERENCE_RPM;
  const rawTick = m / 12;
  const tickStep = NICE_STEPS.find((n) => n >= rawTick) || NICE_STEPS[NICE_STEPS.length - 1];
  return { tickStep, labelStep: tickStep * 3 };
}

// Scale band thresholds from the reference gauge to the actual one so the colour
// zones stay proportional (a steady cruise is green, a real sprint is red) no
// matter the equipment's max RPM.
export function scaleBands(bands, maxRpm, referenceRpm = BAND_REFERENCE_RPM) {
  const list = Array.isArray(bands) ? bands : [];
  const ref = Number.isFinite(referenceRpm) && referenceRpm > 0 ? referenceRpm : BAND_REFERENCE_RPM;
  const m = Number.isFinite(maxRpm) && maxRpm > 0 ? maxRpm : ref;
  const factor = m / ref;
  return list.map((b) => ({ ...b, min: Math.round((Number.isFinite(b.min) ? b.min : 0) * factor) }));
}

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
