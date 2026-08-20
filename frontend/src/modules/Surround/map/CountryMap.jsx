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
// Three moving parts:
//
//   1. A hand-rolled Mercator. Fifteen lines, no dependency — this repo has no
//      d3-geo and is not gaining one for a static map of Europe.
//   2. Auto-framing, from one of two ZOOM PRESETS. The highlighted country's own
//      bounding box, padded and then widened to the render box's aspect, IS the
//      viewBox. Finland frames exactly as well as Austria does, with zero
//      per-country config. The preset also decides whether the city is marked
//      at all — see `ZOOM_PRESETS`.
//   3. Labels, chosen from the frame. The subject country is named; so is every
//      neighbour with enough of itself inside the frame to be worth naming.
//
// WHAT THIS MAP IS FOR (and why it is drawn the way it is). A shape with a star
// in it answers nothing — "Austria, with Vienna in it" is exactly as informative
// to a viewer who cannot place Austria as a blank rectangle would be. Context is
// the whole content: at REGIONAL zoom the subject is a quarter of its frame,
// several neighbours are visible whole and NAMED around it, and the viewer reads
// the position rather than being told it. That is why the pads are what they are.
//
// It is drawn in the programme's engraved language and nothing else: parchment
// ink-lines on whatever ground it is placed over, hairline borders, and washes
// so faint they tint rather than fill. No solid area of colour — a filled
// country on the dark rail is a sticker, not an engraving. The colours are the
// frame's own `--ink` / `--ink-soft` family, so the map is restyled by the
// region it is placed in rather than by anything hard-coded here.
//
// Everything degrades to an empty slot, per the surround quality floor: unknown
// country -> context map with no highlight; no lat/lon -> map with no marker;
// no geodata at all -> nothing, and the card around it stays composed.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import { surroundLogger } from '../moduleKit.js';
import { LABEL_FLOOR_ANCHOR_PX } from '../fit.js';
import { useLabelFloorPx } from '../useLabelFloor.js';
import './CountryMap.scss';

/** The shared geodata: Natural Earth 1:110m, public domain, ~41 KB, 52 features. */
const GEO_PATH = 'media/img/library/_maps/europe.geo.json';

/**
 * The rail is ~420px wide, so the map paints at about this size. These are not a
 * hard render size — the SVG is fluid — but they fix the frame's ASPECT (which
 * the viewBox is matched to, so nothing ever stretches) and give the marker and
 * label layers a pixel scale to work against.
 *
 * 420 x 252 is 5:3, which is also the shipped city photographs' ratio. That is
 * deliberate and not a coincidence to be tidied away: in the place carousel the
 * map and the photograph occupy the same slot, and identical geometry is what
 * makes the swap between them a dissolve rather than a resize.
 */
export const RENDER_W = 420;
export const RENDER_H = 252;
const ASPECT = RENDER_W / RENDER_H;

/**
 * The two zooms, and what each one is FOR. The carousel shows this map twice and
 * the two slides answer different questions; wave 5 made them look as different
 * as they read, because at 0.9 / 0.12 they were two crops of the same picture.
 *
 * `region` — "where is AUSTRIA?". Continental context: `pad: 2.2` puts the
 *   subject at 31% of its frame's span (wave 3's 0.9 put it at 53%, which is
 *   why the two map slides read as the same picture twice). Measured against
 *   the real Natural Earth data: at 2.2 an Austria frame is 24° wide with
 *   Hungary, Switzerland, Slovenia, Slovakia, Czechia and Belgium inside it
 *   WHOLE and France, Italy, Germany, Poland and Romania named around them —
 *   a Central-Europe view, which is the context the slide exists to give. Much
 *   past this and the subject stops being the subject (at 2.6 Italy's frame
 *   reaches Libya); much below it and the zoom-out is not visible. And
 *   `showCity: false`: a star and a city name on this slide is the NEXT slide's
 *   answer given away, and it drags the eye down to a 6px mark on a map whose
 *   whole point is the shape one country makes among the others. The country's
 *   own label carries it.
 *
 * `city` — "and where in it is VIENNA?". `pad: 0.12`: the country's own shape
 *   fills the frame and the star lands on it legibly, with `showCity: true` for
 *   the marker and its name. Neighbours are not excluded by rule — they simply
 *   mostly fall outside the frame at this zoom, and the label-share floor drops
 *   the slivers that do not.
 *
 * Both dimensions live HERE rather than at the carousel: which star belongs on
 * which framing is geography, and the carousel's job is to ask for a slide. The
 * `showCity` prop overrides the preset for a caller with its own reason — the
 * standalone `country-map` module draws ONE map, so "where the composer worked"
 * has to carry the star at regional zoom; the carousel, which draws two, does
 * not.
 */
export const ZOOM_PRESETS = Object.freeze({
  region: { pad: 2.2, showCity: false },
  city: { pad: 0.12, showCity: true },
});
export const ZOOMS = Object.keys(ZOOM_PRESETS);
const DEFAULT_ZOOM = 'region';
const presetFor = (zoom) => ZOOM_PRESETS[zoom] ?? ZOOM_PRESETS[DEFAULT_ZOOM];
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

/**
 * Design floor: nothing below the frame's ten-foot label floor, which is
 * MEASURED PER SCREEN ROOT (`../fit.js`) rather than fixed at 0.72rem — every
 * screen here is a large television read from across a room and each lays a
 * different number of CSS pixels across a panel of much the same size, so a flat
 * rem is a different apparent size on each. These are the anchor root's values,
 * and they are what a map rendered outside a frame is drawn at; the component
 * reads the live floor and scales all three by the same factor.
 *
 * They stay in one RATIO to each other whatever the root — the subject's name is
 * one step up from the floor, a neighbour's is at it — because that ratio is the
 * map's own hierarchy and has nothing to do with which screen it is on.
 */
const LABEL_PX = LABEL_FLOOR_ANCHOR_PX;
/** The subject country's own name — the map's primary label, one step up. */
export const COUNTRY_LABEL_PX = 0.9 * 16;
/** A neighbour's name: quieter, but never below the ten-foot floor. */
export const NEIGHBOUR_LABEL_PX = LABEL_PX;
/** The subject's step up, as a multiple of the floor: 0.9rem / 0.72rem. */
const SUBJECT_STEP = COUNTRY_LABEL_PX / LABEL_FLOOR_ANCHOR_PX;
const STAR_R = 6.5;
const LABEL_GAP = 11;
/** Past this fraction of the frame the label would run off the edge, so it flips. */
const FLIP_AT = 0.66;

/**
 * A neighbour is worth naming when this much of the frame is filled by the part
 * of it that is actually visible — in BOTH axes, so a country entering the frame
 * as a 2px coastal strip is drawn but not labelled. Measured on the CLIPPED box,
 * not the country's own: what matters is how much of it the viewer can see.
 */
const MIN_LABEL_SHARE = 0.14;
/** At most this many neighbours are named. Past it the frame is a word cloud. */
const MAX_NEIGHBOUR_LABELS = 7;
/** The subject's name is nudged clear of the city marker inside this radius. */
const MARKER_CLEARANCE_PX = 34;
/**
 * Average advance per character, in ems, for the tracked uppercase display face
 * the labels are set in. Used to give every label an approximate BOX so two of
 * them can be tested for overlap.
 *
 * Measuring the real advance would mean a DOM text measurement per label per
 * render, in a component that also has to render server-side-ish in jsdom. The
 * estimate is deliberately a little generous: over-estimating drops a label that
 * would have just fitted, under-estimating ships "LONDONGERMANY", and only one
 * of those is a defect a viewer sees.
 */
export const LABEL_EM_PER_CHAR = 0.78;
/** Breathing room around a label box, in ems of its own size. */
export const LABEL_MARGIN_EM = 0.5;


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
function frameFor(bbox, pad = ZOOM_PRESETS[DEFAULT_ZOOM].pad) {
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  let w = Math.max(bbox.maxX - bbox.minX, MIN_SPAN) * (1 + pad);
  let h = Math.max(bbox.maxY - bbox.minY, MIN_SPAN) * (1 + pad);
  if (w / h < ASPECT) w = h * ASPECT; else h = w / ASPECT;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Where to write a country's name, and how much of it the viewer can see.
 *
 * Each disjoint part of the country is CLIPPED to the frame and the biggest
 * surviving rectangle wins. Clipping first is what makes the label land on the
 * visible half of a country that runs off the edge, instead of somewhere out in
 * the margin where a centroid of the whole shape would put it. Returns null when
 * nothing of the country is inside the frame at all.
 */
function labelSpotFor(boxes, frame) {
  const right = frame.x + frame.w;
  const bottom = frame.y + frame.h;
  let best = null;
  for (const b of boxes) {
    const x0 = Math.max(b.minX, frame.x);
    const x1 = Math.min(b.maxX, right);
    const y0 = Math.max(b.minY, frame.y);
    const y1 = Math.min(b.maxY, bottom);
    if (x1 <= x0 || y1 <= y0) continue;
    const area = (x1 - x0) * (y1 - y0);
    if (!best || area > best.area) {
      best = {
        area, x: (x0 + x1) / 2, y: (y0 + y1) / 2, wShare: (x1 - x0) / frame.w, hShare: (y1 - y0) / frame.h,
      };
    }
  }
  return best;
}

/**
 * A label's approximate footprint, in view units, so two of them can be tested
 * for overlap before both are drawn. `anchor` mirrors the SVG attribute: the
 * city's label hangs off the side of its star, the country names are centred.
 */
function labelBox({ x, y, text, sizePx, anchor = 'middle', unitsPerPx }) {
  const w = (String(text).length * LABEL_EM_PER_CHAR + LABEL_MARGIN_EM * 2) * sizePx * unitsPerPx;
  const h = (1 + LABEL_MARGIN_EM) * sizePx * unitsPerPx;
  let x0 = x - w / 2;
  if (anchor === 'start') x0 = x;
  if (anchor === 'end') x0 = x - w;
  return { x0, x1: x0 + w, y0: y - h / 2, y1: y + h / 2 };
}

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

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
  /**
   * `region` (default) frames the subject in continental context and draws NO
   * city marker; `city` frames the subject's own shape nearly edge to edge and
   * carries the marker and its label. Anything else falls back to `region`
   * rather than producing an undefined pad. See `ZOOM_PRESETS`.
   */
  zoom = DEFAULT_ZOOM,
  /**
   * Draw the city marker and its label? `null` (default) takes the zoom
   * preset's answer; `true`/`false` overrides it. It never invents a marker
   * out of nothing: without a city and a coordinate there is no marker to draw
   * either way.
   */
  showCity: showCityProp = null,
  className = '',
  logger = null,
}) {
  const log = useMemo(() => surroundLogger(logger, 'country-map'), [logger]);
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
      // The parts' boxes, kept for label placement: which part of a country is
      // on screen decides where — and whether — its name is written.
      boxes: outerRingsOf(f?.geometry).map(bboxOfRing).filter(Boolean),
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
  const preset = presetFor(zoom);
  const { pad } = preset;
  const frame = useMemo(() => {
    if (!features.length) return null;
    if (highlight) {
      const box = framingBox(highlight.geometry, point);
      if (box) return frameFor(box, pad);
    }
    if (point) {
      const half = STRAY_CITY_SPAN / 2;
      return frameFor({
        minX: point.x - half, maxX: point.x + half, minY: point.y - half, maxY: point.y + half,
      }, pad);
    }
    // The degraded overview is a fixed extent by definition — a zoom that has
    // no subject to zoom on gets the default pad, not the caller's.
    return frameFor({
      minX: projectX(EUROPE_FALLBACK.west), maxX: projectX(EUROPE_FALLBACK.east),
      minY: projectY(EUROPE_FALLBACK.north), maxY: projectY(EUROPE_FALLBACK.south),
    });
  }, [features.length, highlight, point, pad]);

  // The marker and every label live in PIXEL space, not degrees: at Gamma's 1°
  // frame a degree-sized star would swallow the country, and at Beta's 20° frame
  // it would vanish. One scale factor converts px -> view units for all of them,
  // which is also what keeps the type above the 0.72rem ten-foot floor at every
  // zoom the auto-framing can produce.
  const unitsPerPx = frame ? frame.w / RENDER_W : 1;

  /**
   * Where the city's own label hangs off its star, and which way. Null when the
   * zoom does not show a city at all — the regional slide answers "where is this
   * country", and it answers it without pointing at a town. `point` still exists
   * and is still used for FRAMING (it picks which landmass of a multi-part
   * country to frame on); it is only the drawn star and its name that go.
   */
  const svgRef = useRef(null);
  const showCity = showCityProp === null || showCityProp === undefined
    ? preset.showCity
    : !!showCityProp;

  /**
   * THE MAP'S TYPE, SCALED TO THIS SCREEN ROOT. Every size drawn below is a
   * multiple of the frame's ten-foot label floor, which is measured rather than
   * fixed: the living room lays 960 CSS pixels across a panel slightly larger
   * than the office's 1280, so a flat rem is physically bigger there and would
   * be drawn LOUDER than the same label on the office screen.
   *
   * It is not only a size. These numbers feed `labelBox` and the collision
   * tests, so the floor decides which neighbours are named at all — solving that
   * against the wrong screen's floor would keep names that do not fit and drop
   * names that do.
   */
  const labelPx = useLabelFloorPx(svgRef);
  const subjectPx = labelPx * SUBJECT_STEP;
  const marker = useMemo(() => {
    if (!point || !frame || !showCity) return null;
    const fracX = (point.x - frame.x) / frame.w;
    const flip = fracX > FLIP_AT;
    return {
      anchor: flip ? 'end' : 'start',
      dx: flip ? -LABEL_GAP : LABEL_GAP,
      // Near the top edge the label drops below the star instead of off the frame.
      dy: (point.y - frame.y) / frame.h < 0.1 ? labelPx * 1.1 : labelPx * 0.36,
    };
  }, [point, frame, showCity, labelPx]);

  /**
   * Who gets named.
   *
   * The city's label is placed first and is never dropped — it is the one thing
   * on the map the programme actually asserts. The subject country next, nudged
   * clear of the star AND of the city's label box if it wants either spot (the
   * NAME moves, not the star: the star is the fact). Then neighbours, biggest
   * visible part first, while they are large enough to be worth a word and
   * their box does not run into a name already written.
   *
   * Collision is tested on approximate BOXES, not on anchor points. A point test
   * is what let "LONDON" and "GERMANY" print into each other — the two anchors
   * were a comfortable distance apart and the two words were not. Fix round 1:
   * the subject's OWN clearance check was still a point-radius test against the
   * city's marker star (34px), which misses the city LABEL's text box entirely —
   * "VENICE" reaches well past 34px from its anchor. The subject's candidate box
   * is now also checked against `taken` (which already carries the city's label
   * box at this point), the same way a neighbour's is.
   */
  const labels = useMemo(() => {
    if (!frame) return [];
    const placed = [];
    const taken = [];
    const clearance = MARKER_CLEARANCE_PX * unitsPerPx;

    if (point && marker && city) {
      taken.push(labelBox({
        x: point.x + marker.dx * unitsPerPx,
        y: point.y + marker.dy * unitsPerPx,
        text: city,
        sizePx: labelPx,
        anchor: marker.anchor,
        unitsPerPx,
      }));
    }

    const subject = shapes.find((s) => s.highlighted);
    if (subject?.name) {
      const spot = labelSpotFor(subject.boxes, frame);
      if (spot) {
        let { y } = spot;
        let box = labelBox({
          x: spot.x, y, text: subject.name, sizePx: subjectPx, unitsPerPx,
        });
        // Two reasons to relocate: sitting on top of the star itself (the old
        // radius test), or the candidate box overlapping something already
        // placed — which at this point is only ever the city's LABEL box, since
        // the subject is placed before any neighbour. A box overlapping `taken`
        // relocates; it never drops, because the subject's name is the one
        // thing this map exists to answer.
        // (`taken` can only be non-empty here — before any neighbour is
        // considered — if the city label was placed, which itself requires a
        // point, so gating the whole relocation on `point` loses nothing.)
        const onTheStar = point && marker && Math.hypot(spot.x - point.x, y - point.y) < clearance;
        if (point && marker && (onTheStar || taken.some((t) => overlaps(t, box)))) {
          y = point.y + subjectPx * 2.4 * unitsPerPx;
          box = labelBox({
            x: spot.x, y, text: subject.name, sizePx: subjectPx, unitsPerPx,
          });
        }
        taken.push(box);
        placed.push({
          key: `country:${subject.name}`,
          name: subject.name,
          role: 'subject',
          x: spot.x,
          y,
          size: subjectPx,
        });
      }
    }

    shapes
      .filter((s) => !s.highlighted && s.name)
      .map((s) => ({ shape: s, spot: labelSpotFor(s.boxes, frame) }))
      .filter(({ spot }) => spot
        && spot.wShare >= MIN_LABEL_SHARE && spot.hShare >= MIN_LABEL_SHARE)
      .sort((a, b) => b.spot.area - a.spot.area)
      .forEach(({ shape, spot }) => {
        if (placed.filter((p) => p.role === 'neighbour').length >= MAX_NEIGHBOUR_LABELS) return;
        const box = labelBox({
          x: spot.x, y: spot.y, text: shape.name, sizePx: labelPx, unitsPerPx,
        });
        if (taken.some((t) => overlaps(t, box))) return;
        taken.push(box);
        placed.push({
          key: `country:${shape.name}`,
          name: shape.name,
          role: 'neighbour',
          x: spot.x,
          y: spot.y,
          size: labelPx,
        });
      });

    return placed;
  }, [shapes, frame, point, marker, city, unitsPerPx, labelPx, subjectPx]);

  if (!shapes.length || !frame) return null;

  const viewBox = `${round(frame.x)} ${round(frame.y)} ${round(frame.w)} ${round(frame.h)}`;

  return (
    <svg
      ref={svgRef}
      className={`surround-country-map ${className}`.trim()}
      data-testid="country-map"
      viewBox={viewBox}
      data-zoom={ZOOM_PRESETS[zoom] ? zoom : DEFAULT_ZOOM}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={city && country ? `${city}, ${country}` : (country || 'map')}
    >
      {/* Context first, subject over it, names over both, marker last.
          Engraved, not filled: the washes are faint enough to TINT the ground
          they sit on, and the line does the drawing. A solid country reads as a
          sticker stuck on the rail; a hairline reads as print. */}
      {shapes.filter((s) => !s.highlighted).map((s) => (
        <path
          key={`ctx:${s.name}`}
          d={s.d}
          data-country={s.name}
          data-role="context"
          fill="var(--ink, #2a1d07)"
          fillOpacity={0.05}
          stroke="var(--ink-soft, #6b6152)"
          strokeWidth={0.9}
          strokeOpacity={0.55}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {shapes.filter((s) => s.highlighted).map((s) => (
        <path
          key={`hl:${s.name}`}
          d={s.d}
          data-country={s.name}
          data-role="highlight"
          fill="var(--ink, #2a1d07)"
          fillOpacity={0.16}
          stroke="var(--ink, #2a1d07)"
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {labels.map((l) => (
        <g
          key={l.key}
          data-testid="country-map-country-label"
          data-country-label={l.name}
          data-role={l.role}
          transform={`translate(${round(l.x)} ${round(l.y)}) scale(${round(unitsPerPx)})`}
        >
          <text
            className={`surround-country-map__place surround-country-map__place--${l.role}`}
            textAnchor="middle"
            fontSize={l.size}
            fill={l.role === 'subject' ? 'var(--ink, #2a1d07)' : 'var(--ink-soft, #6b6152)'}
          >
            {l.name}
          </text>
        </g>
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
              fontSize={labelPx}
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
  zoom: PropTypes.oneOf(ZOOMS),
  showCity: PropTypes.bool,
  className: PropTypes.string,
  logger: PropTypes.object,
};
