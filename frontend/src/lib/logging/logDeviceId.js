/**
 * Which screen wrote a frontend log event.
 *
 * Every kiosk reaches the backend through the same reverse proxy, so the log
 * store's `context.ip` is identical for the garage display, the living-room
 * TV, the piano tablet and the Portal — only the user agent told them apart.
 * Kiosk launch URLs already carry `?device=<id>`, so the logger stamps that on
 * every event as `context.deviceId` ("find it in the logs" is one filter).
 *
 * Read at module load and kept for the TAB (sessionStorage): SPA routers
 * rewrite the URL and drop the query (see FitnessApp's FLEET_DEVICE_ID note),
 * and a same-tab reload starts from the rewritten URL. Tab-scoped, not
 * localStorage, so a laptop that once opened `?device=garage-tv` does not stamp
 * that id on every later page. Falls back to the identities the fitness and
 * piano kiosks already persist (localStorage), so they are covered.
 */

export const LOG_DEVICE_STORAGE_KEY = 'daylight.log.deviceId';
const LEGACY_KEYS = ['fitness.fleetDeviceId', 'piano.kioskDeviceId'];

/**
 * @param {{search?: string}} [loc]
 * @param {Storage|null} [store] tab-scoped store for the URL's id (sessionStorage)
 * @param {Storage|null} [kioskStore] where the kiosk apps persist their ids (localStorage)
 * @returns {string|null}
 */
export function readLogDeviceId(loc, store, kioskStore = store) {
  try {
    const fromUrl = new URLSearchParams(loc?.search || '').get('device');
    if (fromUrl) {
      try { store?.setItem(LOG_DEVICE_STORAGE_KEY, fromUrl); } catch { /* storage blocked */ }
      return fromUrl;
    }
    const remembered = store?.getItem(LOG_DEVICE_STORAGE_KEY);
    if (remembered) return remembered;
    for (const key of LEGACY_KEYS) {
      const value = kioskStore?.getItem(key);
      if (value) return value;
    }
    return null;
  } catch {
    return null;
  }
}

export default readLogDeviceId;
