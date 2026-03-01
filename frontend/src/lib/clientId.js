const STORAGE_KEY = 'daylight_client_id';

let _cached = null;

/**
 * Get a stable client identifier for this browser/device.
 * Persists across page reloads via localStorage.
 * @returns {string}
 */
export function getClientId() {
  if (_cached) return _cached;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      _cached = stored;
      return stored;
    }
  } catch (_) {
    // localStorage unavailable (e.g., incognito)
  }

  const id = crypto.randomUUID();
  _cached = id;

  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch (_) {
    // Best effort
  }

  return id;
}
