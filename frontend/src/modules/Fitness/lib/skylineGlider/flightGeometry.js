export const SKYLINE_CRAFT_GEOMETRY = Object.freeze({
  anchorX: 240,
  frontSeconds: 0.8,
  rearSeconds: 0.67,
  radius: 0.035,
});

export const HIGH_ALTITUDE = 0.18;
export const LOW_ALTITUDE = 0.78;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function terrainBounds(segment) {
  if (segment?.type === 'lower-terrain') return { top: 0, bottom: Number(segment.top) };
  if (segment?.type === 'upper-terrain') return { top: Number(segment.bottom), bottom: 1 };
  if (segment?.type === 'corridor') return { top: Number(segment.ceiling), bottom: Number(segment.floor) };
  return null;
}

export function terrainOverlappingCraft(course, courseTime, geometry = SKYLINE_CRAFT_GEOMETRY) {
  const from = courseTime - geometry.rearSeconds;
  const to = courseTime + geometry.frontSeconds;
  return (course?.segments || []).filter((segment) => terrainBounds(segment)
    && Number(segment.start_s) <= to
    && Number(segment.end_s ?? segment.start_s) >= from);
}

export function pointOverlapsCraft(pointTime, courseTime, geometry = SKYLINE_CRAFT_GEOMETRY) {
  return pointTime >= courseTime - geometry.rearSeconds
    && pointTime <= courseTime + geometry.frontSeconds;
}

export function altitudeToTrackPercent(altitude) {
  return clamp((Number(altitude) - HIGH_ALTITUDE) / (LOW_ALTITUDE - HIGH_ALTITUDE), 0, 1) * 100;
}

export function trackPercentToAltitude(percent) {
  return HIGH_ALTITUDE + (LOW_ALTITUDE - HIGH_ALTITUDE) * clamp(Number(percent) / 100, 0, 1);
}
