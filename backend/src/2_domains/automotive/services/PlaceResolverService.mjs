// backend/src/2_domains/automotive/services/PlaceResolverService.mjs

/**
 * Resolve a coordinate to one of the household's named places.
 *
 * Purely local: the curated `places.yml` is the whole world as far as this
 * service is concerned. Nothing is geocoded, so no coordinate ever leaves the
 * network — which for a list whose first entry is the family's home address is
 * the point, not an optimisation.
 *
 * An unresolved fix is a first-class outcome, not a failure. The app renders it
 * as "Unnamed stop" with a one-tap naming action, so the registry grows out of
 * driving that actually happened rather than an up-front data-entry chore.
 *
 * @module automotive/services/PlaceResolverService
 */

import { GeoFix } from '../value-objects/GeoFix.mjs';

/**
 * Find the named place containing a fix.
 *
 * Places may overlap — a fuel stop inside a larger "shopping centre" place is
 * the obvious case — so containment alone is ambiguous. The **nearest centre**
 * wins, which reliably picks the specific place over the general one, since a
 * tighter radius implies a closer centre for any fix inside both.
 *
 * @param {GeoFix|null} fix
 * @param {import('../value-objects/Place.mjs').Place[]} places
 * @returns {import('../value-objects/Place.mjs').Place|null}
 */
export function resolvePlace(fix, places) {
  if (!(fix instanceof GeoFix) || !Array.isArray(places) || places.length === 0) return null;

  let best = null;
  let bestDistanceM = Infinity;
  for (const place of places) {
    if (!place?.contains?.(fix)) continue;
    const distanceM = place.distanceMTo(fix);
    if (distanceM < bestDistanceM) {
      best = place;
      bestDistanceM = distanceM;
    }
  }
  return best;
}

/**
 * Is a fix at a fuel-kind place? The one-line question fill-up detection asks.
 *
 * @param {GeoFix|null} fix
 * @param {import('../value-objects/Place.mjs').Place[]} places
 * @returns {boolean}
 */
export function isAtFuelStop(fix, places) {
  return Boolean(resolvePlace(fix, places)?.isFuelStop);
}
