// countryMapPayload.js — surround-payload → CountryMap props mapping, shared
// by CountryMapModule.jsx and PlaceCarousel.jsx, split out so Fast Refresh
// can hot-reload the module component on its own.

/** A coordinate is only a coordinate if it is a finite number. */
function coord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The surround payload -> `CountryMap` props, or null when there is no map to
 * draw. Exported because `PlaceCarousel` needs exactly this decision — "is there
 * a map here, and what is it of" — and two copies of it would be two places for
 * a payload change to have to land.
 */
export function mapPinFrom(data) {
  const map = data?.composer?.map ?? null;
  const country = typeof map?.country === 'string' && map.country.trim() ? map.country.trim() : null;
  if (!country) return null;
  return {
    country,
    city: typeof map?.city === 'string' && map.city.trim() ? map.city.trim() : null,
    lat: coord(map?.lat),
    lon: coord(map?.lon),
  };
}
