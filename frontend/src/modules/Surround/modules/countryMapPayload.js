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
 *
 * PIECE-FIRST, same precedent as `piece.period ?? composer.period`: a work
 * can author its own `piece.map` (a play's fictional setting, a work composed
 * somewhere other than the composer's home) and it wins over the
 * composer's/playwright's own geography. `source` rides along so a caller can
 * tell which one is drawn — `PlaceCarousel` uses it to gate the biographical
 * caption sentences, which are true of a person's own geography and simply
 * false of a play's setting.
 */
export function mapPinFrom(data) {
  const pieceMap = data?.piece?.map ?? null;
  const composerMap = data?.composer?.map ?? null;
  const pieceCountry = typeof pieceMap?.country === 'string' && pieceMap.country.trim() ? pieceMap.country.trim() : null;
  const composerCountry = typeof composerMap?.country === 'string' && composerMap.country.trim() ? composerMap.country.trim() : null;
  const source = pieceCountry ? 'piece' : composerCountry ? 'composer' : null;
  if (!source) return null;
  const map = source === 'piece' ? pieceMap : composerMap;
  return {
    country: source === 'piece' ? pieceCountry : composerCountry,
    city: typeof map?.city === 'string' && map.city.trim() ? map.city.trim() : null,
    lat: coord(map?.lat),
    lon: coord(map?.lon),
    source,
  };
}
