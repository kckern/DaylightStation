/**
 * Which screen wrote a frontend log event.
 *
 * Every kiosk reaches the backend through the same reverse proxy, so the log
 * store's `context.ip` is identical for the garage display, the living-room
 * TV, the piano tablet and the Portal — only the user agent told them apart.
 * Kiosk launch URLs already carry `?device=<id>`, so the logger stamps that on
 * every event as `context.deviceId` ("find it in the logs" is one filter).
 *
 * Read at module load and persisted: SPA routers rewrite the URL and drop the
 * query (see FitnessApp's FLEET_DEVICE_ID note), and a same-tab reload starts
 * from the rewritten URL. Falls back to the identities the fitness and piano
 * apps already persist, so kiosks identified before this existed are covered.
 */

export const LOG_DEVICE_STORAGE_KEY = 'daylight.log.deviceId';
const LEGACY_KEYS = ['fitness.fleetDeviceId', 'piano.kioskDeviceId'];

/**
 * @param {{search?: string}} [loc]
 * @param {Storage|null} [store]
 * @returns {string|null}
 */
export function readLogDeviceId(loc, store) {
  try {
    const fromUrl = new URLSearchParams(loc?.search || '').get('device');
    if (fromUrl) {
      try { store?.setItem(LOG_DEVICE_STORAGE_KEY, fromUrl); } catch { /* storage blocked */ }
      return fromUrl;
    }
    for (const key of [LOG_DEVICE_STORAGE_KEY, ...LEGACY_KEYS]) {
      const value = store?.getItem(key);
      if (value) return value;
    }
    return null;
  } catch {
    return null;
  }
}

export default readLogDeviceId;
