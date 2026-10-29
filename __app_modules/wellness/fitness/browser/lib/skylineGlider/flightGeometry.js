export const SKYLINE_CRAFT_GEOMETRY = Object.freeze({
  anchorX: 240,
  frontSeconds: 0.8,
  rearSeconds: 0.67,
  radius: 0.035,
});

export const HIGH_ALTITUDE = 0.18;
export const LOW_ALTITUDE = 0.78;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function terrainBounds(segment, atSeconds = null) {
  if (segment?.type === 'lower-terrain') {
    const points = segment.profile;
    if (!points?.length) return { top: 0, bottom: Number(segment.top) };
    if (atSeconds == null) return { top: 0, bottom: Math.min(...points.map(p => Number(p.altitude))) };
    const right = points.findIndex(p => Number(p.at_s) >= atSeconds);
    if (right <= 0) return { top: 0, bottom: Number(points[right < 0 ? points.length - 1 : 0].altitude) };
    const a = points[right - 1], b = points[right];
    const fraction = clamp((atSeconds - a.at_s) / (b.at_s - a.at_s), 0, 1);
    return { top: 0, bottom: Number(a.altitude) + fraction * (b.altitude - a.altitude) };
  }
  if (segment?.type === 'lava') return { top: 0, bottom: Number(segment.top) };
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

// A wing spans time as well as height: sample both ends and every slope knot.
function boundsOverCraft(segment, courseTime, geometry) {
  const from = Math.max(segment.start_s, courseTime - geometry.rearSeconds);
  const to = Math.min(segment.end_s ?? segment.start_s, courseTime + geometry.frontSeconds);
  const times = [from, to, ...(segment.profile || []).map(p => p.at_s).filter(t => t > from && t < to)];
  return times.map(t => terrainBounds(segment, t)).reduce((band, bounds) => ({
    top: Math.max(band.top, bounds.top), bottom: Math.min(band.bottom, bounds.bottom),
  }), { top: 0, bottom: 1 });
}

/** First terrain segment the craft at `altitude` is touching, or null. */
export function terrainContact(course, courseTime, altitude, geometry = SKYLINE_CRAFT_GEOMETRY) {
  return terrainOverlappingCraft(course, courseTime, geometry).find((segment) => {
    const bounds = boundsOverCraft(segment, courseTime, geometry);
    return altitude - geometry.radius < bounds.top || altitude + geometry.radius > bounds.bottom;
  }) || null;
}

/** The open band between every terrain segment under the craft. */
export function safeBandAt(course, courseTime, geometry = SKYLINE_CRAFT_GEOMETRY) {
  return terrainOverlappingCraft(course, courseTime, geometry)
    .map(segment => boundsOverCraft(segment, courseTime, geometry))
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

/** The terrain segment covering the point (at_s, altitude), or null. */
export function terrainAtPoint(course, atSeconds, altitude) {
  return (course?.segments || []).find((segment) => {
    const bounds = terrainBounds(segment, atSeconds);
    if (!bounds) return false;
    if (atSeconds < Number(segment.start_s) || atSeconds > Number(segment.end_s ?? segment.start_s)) return false;
    return altitude < bounds.top || altitude > bounds.bottom;
  }) || null;
}

/** The first entity whose box holds the point, or null. */
export function entityAtPoint(entities, atSeconds, altitude) {
  return (entities || []).find((entity) => {
    const bounds = entityBounds(entity);
    return atSeconds >= bounds.start && atSeconds <= bounds.end && altitude >= bounds.top && altitude <= bounds.bottom;
  }) || null;
}

/**
 * The nearest entity or terrain segment met by a point sweeping from `from` to
 * `to` at a fixed altitude: `{ entity | segment, at }`, or null. Entities win ties.
 */
export function firstHitAlong(entities, course, from, to, altitude) {
  let best = null;
  const consider = (hit, start, end) => {
    if (start > to || end < from) return;
    const at = Math.max(from, start);
    if (!best || at < best.at) best = { ...hit, at };
  };
  for (const entity of entities || []) {
    const bounds = entityBounds(entity);
    if (altitude >= bounds.top && altitude <= bounds.bottom) consider({ entity }, bounds.start, bounds.end);
  }
  for (const segment of course?.segments || []) {
    if (!terrainBounds(segment)) continue;
    const start = Math.max(from, Number(segment.start_s));
    const end = Math.min(to, Number(segment.end_s ?? segment.start_s));
    if (start > end) continue;
    const times = [start, ...(segment.profile || []).map(p => Number(p.at_s)).filter(t => t > start && t < end), end];
    for (let i = 0; i < times.length - 1; i++) {
      const a = times[i], b = times[i + 1];
      const left = terrainBounds(segment, a), right = terrainBounds(segment, b);
      if (altitude < left.top || altitude > left.bottom) { consider({ segment }, a, b); break; }
      const crossings = [];
      if (altitude < right.top) crossings.push(a + (b - a) * (altitude - left.top) / (right.top - left.top));
      if (altitude > right.bottom) crossings.push(a + (b - a) * (altitude - left.bottom) / (right.bottom - left.bottom));
      if (crossings.length) { consider({ segment }, Math.min(...crossings), b); break; }
    }
    if (start === end) {
      const bounds = terrainBounds(segment, start);
      if (altitude < bounds.top || altitude > bounds.bottom) consider({ segment }, start, end);
    }
  }
  return best;
}

/** Whether an entity overlaps a blast box centred on the detonation point. */
export function blastTouches(entity, blast, { blast_width_s, blast_height }) {
  const bounds = entityBounds(entity);
  return bounds.start <= blast.at_s + blast_width_s / 2 && bounds.end >= blast.at_s - blast_width_s / 2
    && bounds.top <= blast.altitude + blast_height / 2 && bounds.bottom >= blast.altitude - blast_height / 2;
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
