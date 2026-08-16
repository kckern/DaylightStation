/**
 * Which machine is this?
 *
 * Every frontend request reaches the backend over the docker network, so they
 * all share one source IP (`172.18.0.53` throughout the 2026-08-16
 * investigation). Filtering the backend log by IP therefore conflated the
 * garage fitness kiosk with the piano tablet, and the backend's own log context
 * is `{source, app, host}` where `host` is `os.hostname()` — the SERVER. Nothing
 * in a backend line said which client it was about.
 *
 * This mints a stable per-browser id and `lib/api.mjs` sends it as
 * `X-Daylight-Device`. There was no existing device id to reuse: the fleet name
 * (`wsConfig.guardrails.device`) only exists inside a rendered screen, and
 * `window.__DAYLIGHT_DEVICE_ID` is read in one place and set in none.
 *
 * The value carries its own provenance as a prefix, because the three cases
 * mean different things to a reader:
 *
 *   fleet:<name>      a named device from the fleet config — the best case,
 *                     joinable to devices.yml. Requires something to have set
 *                     window.__DAYLIGHT_DEVICE_ID; nothing does yet.
 *   browser:<token>   a random token persisted in localStorage. Stable across
 *                     reloads and restarts for this browser profile, which is
 *                     one-to-one with a kiosk. Not joinable to fleet config.
 *   ephemeral:<token> localStorage is unavailable or refused the write, so this
 *                     token dies with the page. Two lines carrying different
 *                     ephemeral ids may still be the same machine — never read
 *                     a count of these as a count of devices.
 */

const STORAGE_KEY = 'ds_device_id';

/** Survives within a page even when persistence fails, so one page = one id. */
let inMemoryId = null;

/** Random, URL/header-safe, no dependency on crypto.randomUUID being present. */
function mintToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }
  let out = '';
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 16; i += 1) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

/**
 * The id this browser reports as `X-Daylight-Device`.
 *
 * @returns {string} always a non-empty `<provenance>:<value>` string
 */
export function getDeviceId() {
  const fleetName = typeof window !== 'undefined' ? window.__DAYLIGHT_DEVICE_ID : null;
  if (typeof fleetName === 'string' && fleetName) return `fleet:${fleetName}`;

  if (inMemoryId) return inMemoryId;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      inMemoryId = `browser:${stored}`;
      return inMemoryId;
    }
    const token = mintToken();
    window.localStorage.setItem(STORAGE_KEY, token);
    inMemoryId = `browser:${token}`;
    return inMemoryId;
  } catch {
    // Private mode, a disabled store, or a quota refusal. Say so in the value
    // rather than emitting a `browser:` id that silently does not persist.
    inMemoryId = `ephemeral:${mintToken()}`;
    return inMemoryId;
  }
}

/** Test seam: drop the memoised value so a fresh environment can be exercised. */
export function _resetDeviceIdForTests() {
  inMemoryId = null;
}

export default getDeviceId;
