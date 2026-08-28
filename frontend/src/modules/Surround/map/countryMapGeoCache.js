// countryMapGeoCache.js — lazy, shared fetch of the Europe geodata used by
// CountryMap.jsx, split out so Fast Refresh can hot-reload the map component
// on its own. The cache lives at module scope because every card on screen
// shares one fetch rather than issuing its own.
import { DaylightMediaPath } from '../../../lib/api.mjs';

const GEO_PATH = 'media/img/library/_maps/europe.geo.json';

let geoPromise = null;
let geoResolved;

/** Test seam: forget the cached geodata so a spec starts from a cold fetch. */
export function __resetMapCache() {
  geoPromise = null;
  geoResolved = undefined;
}

/** The already-resolved FeatureCollection (or null), if a fetch has settled. */
export function getCachedGeo() {
  return geoResolved;
}

/**
 * Resolves to the FeatureCollection, or to null if it could not be had. Never
 * rejects: a map that cannot load is a missing decoration, not a broken card.
 * The failure is cached too, so a dead asset costs one request, not one per card.
 */
export function loadGeo(log) {
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
