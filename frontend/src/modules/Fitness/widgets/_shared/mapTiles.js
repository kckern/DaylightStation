// Basemap tiles for the route maps (session detail + the sessions list mini map).
//
// OpenStreetMap's own tile server: free, no key. CARTO's dark basemap
// (basemaps.cartocdn.com/dark_all), used until 2026-09, began answering every
// request with an "API KEY REQUIRED" image, on every URL form. OSM tiles are
// light, so the dark look is a CSS filter over the tile layer rather than a
// second provider to depend on.
//
// OSM's tile usage policy asks for visible attribution (MAP_ATTRIBUTION) and a
// real referer (the browser sends it). These are small, occasional maps —
// well inside that policy.
export const TILE_SIZE = 256;

export const tileUrl = (zoom, x, y) => `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;

// Light tiles to a dark map: invert, turn the hues back (water stays blue,
// parks green), then take the glare off.
export const DARK_TILE_FILTER = 'invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.85) saturate(0.6)';

export const MAP_ATTRIBUTION = '© OpenStreetMap';
export const MAP_ATTRIBUTION_URL = 'https://www.openstreetmap.org/copyright';
