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

/** First terrain segment the craft at `altitude` is touching, or null. */
export function terrainContact(course, courseTime, altitude, geometry = SKYLINE_CRAFT_GEOMETRY) {
  return terrainOverlappingCraft(course, courseTime, geometry).find((segment) => {
    const bounds = terrainBounds(segment);
    return altitude - geometry.radius < bounds.top || altitude + geometry.radius > bounds.bottom;
  }) || null;
}

/** The open band between every terrain segment under the craft. */
export function safeBandAt(course, courseTime, geometry = SKYLINE_CRAFT_GEOMETRY) {
  return terrainOverlappingCraft(course, courseTime, geometry)
    .map(terrainBounds)
    .reduce((band, bounds) => ({ top: Math.max(band.top, bounds.top), bottom: Math.min(band.bottom, bounds.bottom) }), { top: 0, bottom: 1 });
}

/** Entities stand on their `altitude`: they occupy [altitude - height, altitude]. */
export function entityBounds(entity) {
  const halfWidth = Number(entity.width_s) / 2;
  return {
    start: Number(entity.at_s) - halfWidth,
    end: Number(entity.at_s) + halfWidth,
    top: Number(entity.altitude) - Number(entity.height),
    bottom: Number(entity.altitude),
  };
}

export function entitiesTouchingCraft(course, courseTime, altitude, geometry = SKYLINE_CRAFT_GEOMETRY) {
  const from = courseTime - geometry.rearSeconds;
  const to = courseTime + geometry.frontSeconds;
  return (course?.entities || []).filter((entity) => {
    if (entity.class === 'scenery') return false;
    const bounds = entityBounds(entity);
    return bounds.start <= to && bounds.end >= from
      && altitude + geometry.radius > bounds.top && altitude - geometry.radius < bounds.bottom;
  });
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
