// frontend/src/modules/Surround/map/CountryMap.jsx
//
// "Where this composer worked", drawn from data rather than illustrated.
//
// The naive version of this — one hand-drawn Europe SVG with pins baked in —
// fails on contact with the library: a frame drawn to flatter Vienna cannot show
// Helsinki, and an asset per composer does not survive seven composers, let
// alone a hundred pieces. So there is exactly one component here, and it frames
// ITSELF around whatever country it is handed.
//
// Two moving parts:
//
//   1. A hand-rolled Mercator. Fifteen lines, no dependency — this repo has no
//      d3-geo and is not gaining one for a static map of Europe.
//   2. Auto-framing. The highlighted country's own bounding box, padded and then
//      widened to the render box's aspect, IS the viewBox. Finland fills the
//      frame exactly as well as Austria does, with zero per-country config.
//
// Everything degrades to an empty slot, per the surround quality floor: unknown
// country -> context map with no highlight; no lat/lon -> map with no marker;
// no geodata at all -> nothing, and the card around it stays composed.

import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import './CountryMap.scss';

/** The shared geodata: Natural Earth 1:110m, public domain, ~41 KB, 52 features. */
const GEO_PATH = 'media/img/library/_maps/europe.geo.json';

/**
 * The card is ~420px wide, so the map paints at about this size. These are not a
 * hard render size — the SVG is fluid — but they fix the frame's ASPECT (which
 * the viewBox is matched to, so nothing ever stretches) and give the marker layer
 * a pixel scale to work against.
 */
export const RENDER_W = 420;
export const RENDER_H = 260;
const ASPECT = RENDER_W / RENDER_H;

/** Breathing room around the highlighted country, as a fraction of its own span. */
const PAD = 0.25;
/** Floor on a frame's span in degrees, so a sliver of a country cannot divide by ~0. */
const MIN_SPAN = 0.75;

/** Mercator blows up at the poles; Natural Earth's Svalbard would take the frame with it. */
const MAX_LAT = 85;

/**
 * Degraded framing, used only when the country name matched nothing. With a city
 * we frame that; without one, a Europe overview — the one hard-coded extent in
 * the file, and it exists precisely so an unknown name still shows a map.
 */
const STRAY_CITY_SPAN = 22;
const EUROPE_FALLBACK = { west: -13, east: 42, south: 34, north: 71 };

/** Design floor: nothing below 0.72rem, read at ten feet. */
const LABEL_PX = 0.72 * 16;
const STAR_R = 6.5;
const LABEL_GAP = 11;
/** Past this fraction of the frame the label would run off the edge, so it flips. */
const FLIP_AT = 0.66;

let moduleLogger = null;
function fallbackLogger() {
  if (!moduleLogger) moduleLogger = getLogger().child({ app: 'surround', component: 'country-map' });
  return moduleLogger;
}
function resolveLogger(logger) {
  if (!logger) return fallbackLogger();
  return logger.child?.({ app: 'surround', component: 'country-map' }) ?? logger;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * Mercator. x is longitude; y is the standard ln(tan(pi/4 + lat/2)).
 *
 * The 180/PI on y is not decoration — it is what puts y in the same units as x
 * (degrees at the equator). Without it y comes out in radians, ~57x smaller than
 * x, and any later "scale both into the viewBox" silently stretches the map
 * vertically by that factor. One shared unit means one uniform scale, which is
 * what "preserve aspect ratio" actually requires.
 *
 * y is negated because SVG's y axis points down and latitude points up.
 */
const projectX = (lon) => Number(lon);
const projectY = (lat) => {
  const phi = Math.max(-MAX_LAT, Math.min(MAX_LAT, Number(lat)));
  return -(180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (phi * Math.PI) / 360));
};

const round = (n) => Math.round(n * 1000) / 1000;

/** Every ring of a Polygon or MultiPolygon, flattened to a list of rings. */
function ringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  if (geometry.type === 'MultiPolygon') {
    return (Array.isArray(geometry.coordinates) ? geometry.coordinates : []).flat();
  }
  return [];
}

/**
 * The OUTER ring of each disjoint part — the mainland, then each island.
 * Holes are excluded: they bound nothing new, and framing cares about landmasses.
 */
function outerRingsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') {
    return Array.isArray(geometry.coordinates) && geometry.coordinates[0] ? [geometry.coordinates[0]] : [];
  }
  if (geometry.type === 'MultiPolygon') {
    return (Array.isArray(geometry.coordinates) ? geometry.coordinates : [])
      .map((poly) => (Array.isArray(poly) ? poly[0] : null))
      .filter(Boolean);
  }
  return [];
}

/** Rings -> one SVG path `d`, already projected. */
function pathFor(geometry) {
  const parts = [];
  for (const ring of ringsOf(geometry)) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const points = ring
      .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => `${round(projectX(p[0]))},${round(projectY(p[1]))}`);
    if (points.length < 3) continue;
    parts.push(`M${points.join('L')}Z`);
  }
  return parts.join('');
}

/** Projected bounding box of one ring, or null if it has no usable points. */
function bboxOfRing(ring) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  if (!Array.isArray(ring)) return null;
  for (const p of ring) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const x = projectX(p[0]);
    const y = projectY(p[1]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

const boxArea = (b) => (b.maxX - b.minX) * (b.maxY - b.minY);

/**
 * Which landmass to frame on.
 *
 * Framing on the country's RAW bounding box is the obvious reading of "frame the
 * country", and against the real Natural Earth data it is wrong often enough to
 * matter: France carries French Guiana and Réunion, so its box is 116° wide;
 * Norway's is 145°; Russia's is 450° — wider than the planet, so the map wraps.
 * In each case the composer's city ends up a speck in an ocean.
 *
 * So frame on ONE part: the one the city sits in, or failing that the largest.
 * Still no per-country configuration — the geometry and the sidecar's own
 * coordinates decide. Every other part is still DRAWN; it just does not get a
 * vote on the frame.
 */
function framingBox(geometry, point) {
  const boxes = outerRingsOf(geometry).map(bboxOfRing).filter(Boolean);
  if (!boxes.length) return null;
  if (point) {
    const inside = boxes.filter((b) => point.x >= b.minX && point.x <= b.maxX
      && point.y >= b.minY && point.y <= b.maxY);
    if (inside.length) return inside.reduce((a, b) => (boxArea(b) > boxArea(a) ? b : a));
  }
  return boxes.reduce((a, b) => (boxArea(b) > boxArea(a) ? b : a));
}

/**
 * The auto-framing itself.
 *
 * Pad the country's own box by PAD, then grow the SHORT side until the box
 * matches the render aspect. Growing (never cropping) is what letterboxes the
 * frame: the country keeps its true shape and the surplus is filled with
 * neighbours instead of with stretch.
 */
function frameFor(bbox) {
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  let w = Math.max(bbox.maxX - bbox.minX, MIN_SPAN) * (1 + PAD);
  let h = Math.max(bbox.maxY - bbox.minY, MIN_SPAN) * (1 + PAD);
  if (w / h < ASPECT) w = h * ASPECT; else h = w / ASPECT;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

const normalize = (name) => String(name ?? '').trim().toLowerCase();

// ---------------------------------------------------------------------------
// Geodata: fetched lazily, once, and shared by every card on screen
// ---------------------------------------------------------------------------

let geoPromise = null;
let geoResolved;

/** Test seam: forget the cached geodata so a spec starts from a cold fetch. */
export function __resetMapCache() {
  geoPromise = null;
  geoResolved = undefined;
}

/**
 * Resolves to the FeatureCollection, or to null if it could not be had. Never
 * rejects: a map that cannot load is a missing decoration, not a broken card.
 * The failure is cached too, so a dead asset costs one request, not one per card.
 */
function loadGeo(log) {
  if (!geoPromise) {
    geoPromise = Promise.resolve()
      .then(() => fetch(DaylightMediaPath(GEO_PATH)))
      .then((res) => {
        if (!res?.ok) throw new Error(`HTTP ${res?.status ?? 'error'}`);
        return res.json();
      })
      .then((json) => {
        const features = Array.isArray(json?.features) ? json.features : null;
        if (!features?.length) throw new Error('no features');
        geoResolved = json;
        return json;
      })
      .catch((err) => {
        log.warn('surround.map.load-failed', { error: err?.message ?? String(err) });
        geoResolved = null;
        return null;
      });
  }
  return geoPromise;
}

// ---------------------------------------------------------------------------

/** A five-pointed star of radius r, centred on the origin. */
function starPath(r) {
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.42;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${round(Math.cos(angle) * radius)},${round(Math.sin(angle) * radius)}`);
  }
  return `M${pts.join('L')}Z`;
}
const STAR = starPath(STAR_R);

export default function CountryMap({
  country = null,
  city = null,
  lat = null,
  lon = null,
  className = '',
  logger = null,
}) {
  const log = useMemo(() => resolveLogger(logger), [logger]);
  // Seeded from the module cache so the second card on screen paints on its first
  // render instead of flashing empty while an already-settled promise re-resolves.
  const [geo, setGeo] = useState(() => geoResolved ?? null);

  useEffect(() => {
    let alive = true;
    loadGeo(log).then((data) => { if (alive) setGeo(data ?? null); });
    return () => { alive = false; };
  }, [log]);

  const features = useMemo(
    () => (Array.isArray(geo?.features) ? geo.features : []),
    [geo],
  );

  const wanted = normalize(country);
  const highlight = useMemo(
    () => (wanted ? features.find((f) => normalize(f?.properties?.name) === wanted) ?? null : null),
    [features, wanted],
  );

  // The event an author needs: the sidecar names a country the geodata has never
  // heard of. Fires once per name, not once per render.
  useEffect(() => {
    if (!features.length || !wanted || highlight) return;
    log.warn('surround.map.country-missing', { country });
  }, [features.length, wanted, highlight, country, log]);

  const shapes = useMemo(
    () => features.map((f) => ({
      name: f?.properties?.name ?? '',
      d: pathFor(f?.geometry),
      highlighted: f === highlight,
    })).filter((s) => s.d),
    [features, highlight],
  );

  const point = useMemo(() => {
    const la = Number(lat);
    const lo = Number(lon);
    if (lat === null || lat === undefined || lat === '' || lon === null || lon === undefined || lon === '') return null;
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
    return { x: projectX(lo), y: projectY(la) };
  }, [lat, lon]);

  // Frame the highlight when there is one. Failing that, a city still gives us
  // somewhere to look; failing even that, a Europe overview. An unrecognised
  // country shows a map, never a hole.
  const frame = useMemo(() => {
    if (!features.length) return null;
    if (highlight) {
      const box = framingBox(highlight.geometry, point);
      if (box) return frameFor(box);
    }
    if (point) {
      const half = STRAY_CITY_SPAN / 2;
      return frameFor({
        minX: point.x - half, maxX: point.x + half, minY: point.y - half, maxY: point.y + half,
      });
    }
    return frameFor({
      minX: projectX(EUROPE_FALLBACK.west), maxX: projectX(EUROPE_FALLBACK.east),
      minY: projectY(EUROPE_FALLBACK.north), maxY: projectY(EUROPE_FALLBACK.south),
    });
  }, [features.length, highlight, point]);

  if (!shapes.length || !frame) return null;

  const viewBox = `${round(frame.x)} ${round(frame.y)} ${round(frame.w)} ${round(frame.h)}`;

  // The marker lives in pixel space, not degrees: at Gamma's 1° frame a
  // degree-sized star would swallow the country, and at Beta's 20° frame it would
  // vanish. One scale factor converts px -> view units for the whole marker group.
  const unitsPerPx = frame.w / RENDER_W;
  let marker = null;
  if (point) {
    const fracX = (point.x - frame.x) / frame.w;
    const flip = fracX > FLIP_AT;
    marker = {
      anchor: flip ? 'end' : 'start',
      dx: flip ? -LABEL_GAP : LABEL_GAP,
      // Near the top edge the label drops below the star instead of off the frame.
      dy: (point.y - frame.y) / frame.h < 0.1 ? LABEL_PX * 1.1 : LABEL_PX * 0.36,
    };
  }

  return (
    <svg
      className={`surround-country-map ${className}`.trim()}
      data-testid="country-map"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={city && country ? `${city}, ${country}` : (country || 'map')}
    >
      {/* Context first, highlight over it, marker over both. */}
      {shapes.filter((s) => !s.highlighted).map((s) => (
        <path
          key={`ctx:${s.name}`}
          d={s.d}
          data-country={s.name}
          data-role="context"
          fill="var(--programme-edge, #ddd0b4)"
          stroke="var(--programme, #efe6d2)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {shapes.filter((s) => s.highlighted).map((s) => (
        <path
          key={`hl:${s.name}`}
          d={s.d}
          data-country={s.name}
          data-role="highlight"
          fill="var(--velvet, #4a1018)"
          stroke="var(--velvet, #4a1018)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {marker && (
        <g
          data-testid="country-map-marker"
          transform={`translate(${round(point.x)} ${round(point.y)}) scale(${round(unitsPerPx)})`}
        >
          <path data-testid="country-map-star" d={STAR} fill="var(--brass, #c79a3e)" />
          {city && (
            <text
              className="surround-country-map__label"
              data-testid="country-map-label"
              x={marker.dx}
              y={marker.dy}
              textAnchor={marker.anchor}
              fontSize={LABEL_PX}
              fill="var(--brass, #c79a3e)"
            >
              {city}
            </text>
          )}
        </g>
      )}
    </svg>
  );
}

CountryMap.propTypes = {
  country: PropTypes.string,
  city: PropTypes.string,
  lat: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  lon: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  className: PropTypes.string,
  logger: PropTypes.object,
};
