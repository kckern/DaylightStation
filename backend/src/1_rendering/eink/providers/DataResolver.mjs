/**
 * Data Resolver — fetches all data sources before render
 * @module 1_rendering/eink/data/DataResolver
 *
 * Server-side equivalent of ScreenDataProvider.jsx.
 * Given a data config map, fetches all sources and returns a keyed object.
 */

/**
 * @param {Object} sources - { [key]: { source: '/api/...' } }
 * @param {string} baseUrl - e.g. 'http://localhost:3112'
 * @returns {Promise<Object>} - { [key]: fetchedData }
 */
export async function resolveData(sources, baseUrl) {
  if (!sources || typeof sources !== 'object') return {};

  const entries = Object.entries(sources);
  const results = await Promise.allSettled(
    entries.map(async ([key, config]) => {
      const url = config.source.startsWith('http')
        ? config.source
        : `${baseUrl}${config.source}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return [key, await res.json()];
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
