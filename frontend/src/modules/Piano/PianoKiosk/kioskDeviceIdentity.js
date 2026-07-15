// ── Kiosk self-identity ──────────────────────────────────────────────────────
// Which physical device is THIS browser? The served piano config carries a
// single `screensaver.deviceId` (e.g. yellow-room-tablet) that is the same for
// every client that loads the piano — so it cannot, on its own, tell the tablet
// apart from a laptop dev tab pointed at the same piano. That gap let a second
// client's idle screensaver sleep the tablet mid-lesson (2026-07-15).
//
// Fix: the kiosk launch URL carries `?device=<id>`; we capture it at module load
// and persist it to localStorage. A client only drives the tablet's screen when
// its OWN identity matches the configured deviceId. A laptop that just opens
// /piano has no identity and never touches the backlight.
//
// Mirrors FitnessApp's fleet-device capture: the SPA router rewrites the URL and
// drops the query param, so read it once at load; localStorage re-asserts it
// across same-tab reloads, and the kiosk launch URL re-asserts it across browser
// restarts.
export const KIOSK_DEVICE_STORAGE_KEY = 'piano.kioskDeviceId';

/**
 * Resolve this client's device identity: `?device=` from the URL (persisted), or
 * the previously-persisted value, or null. Never throws.
 *
 * @param {{search?: string}} [loc]   - defaults to window.location
 * @param {Storage} [store]           - defaults to window.localStorage
 * @returns {string|null}
 */
export function readKioskDeviceId(loc = (typeof window !== 'undefined' ? window.location : { search: '' }),
                                  store = (typeof window !== 'undefined' ? window.localStorage : null)) {
  try {
    const fromUrl = new URLSearchParams(loc?.search || '').get('device');
    if (fromUrl) {
      store?.setItem(KIOSK_DEVICE_STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    return store?.getItem(KIOSK_DEVICE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

// Captured once at module load (see note above about the SPA dropping the param).
export const KIOSK_DEVICE_ID = readKioskDeviceId();
