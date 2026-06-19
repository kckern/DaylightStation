/**
 * Data Resolver — fetches all data sources before render
 * @module 1_rendering/eink/data/DataResolver
 *
 * Server-side equivalent of ScreenDataProvider.jsx.
 * Given a data config map, fetches all sources and returns a keyed object.
 */

import { loadImage } from '#system/canvas/index.mjs';

/**
 * @param {Object} sources - { [key]: { source: '/api/...', image?: '<field>' } }
 * @param {string} baseUrl - backend base URL injected from household config
 *                           (devices.yml daylightHostInternal); prefixes relative sources
 * @param {Object} [opts]
 * @param {boolean} [opts.loadImages=false] - when true, a source that declares
 *   `image: '<field>'` has the URL at json[field] fetched and decoded into a
 *   ready-to-draw `imageEl`. This is the EXPENSIVE pixel path — only the renderer
 *   passes it; the cheap /config snapshot resolves data WITHOUT images so its
 *   battery-saving hash check never downloads a photo.
 * @returns {Promise<Object>} - { [key]: fetchedData }
 */
export async function resolveData(sources, baseUrl, { loadImages = false } = {}) {
  if (!sources || typeof sources !== 'object') return {};

  const entries = Object.entries(sources);
  const results = await Promise.allSettled(
    entries.map(async ([key, config]) => {
      const isAbsolute = config.source.startsWith('http');
      if (!isAbsolute && !baseUrl) {
        throw new Error(`relative data source "${config.source}" needs a baseUrl (unset household daylightHost)`);
      }
      const url = isAbsolute ? config.source : `${baseUrl}${config.source}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();

      // Optional image preload (render path only). A failed image load degrades to
      // caption-only rather than dropping the whole data feed.
      if (loadImages && config.image && json && typeof json === 'object') {
        const ref = json[config.image];
        if (ref) {
          try {
            const imgUrl = String(ref).startsWith('http') ? ref : `${baseUrl}${ref}`;
            const imgRes = await fetch(imgUrl);
            if (imgRes.ok) {
              json.imageEl = await loadImage(Buffer.from(await imgRes.arrayBuffer()));
            }
          } catch { /* keep json; widget shows its no-image fallback */ }
        }
      }
      return [key, json];
    })
  );

  const data = {};
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const [key, value] = result.value;
      data[key] = value;
    }
  }
  return data;
}
