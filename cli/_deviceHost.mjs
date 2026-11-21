/**
 * Where a device CLI (pbctl, pkctl, fkb, the piano MIDI checks) should connect.
 *
 * No CLI carries a household address. The target comes from, in order:
 *   1. a host env var (`PB_HOST=<ip>:8770`) — an explicit address wins;
 *   2. a device id (`PB_DEVICE=<id>`, or the CLI's own flag) looked up in the
 *      household device registry through the app API (`GET /api/v1/device/config`,
 *      base `$DAYLIGHT_BASE_URL`, default http://localhost:3111). The address is the
 *      device's `content_control.host`, else its top-level `host`.
 * With neither, the CLI stops with a message naming both.
 */

const DEFAULT_BASE = 'http://localhost:3111';

export function appBaseUrl(env = process.env) {
  return String(env.DAYLIGHT_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

/** The address a registry entry names, or null. */
export function deviceAddress(device) {
  return device?.content_control?.host || device?.host || null;
}

/**
 * @param {Object} opts
 * @param {string} opts.hostVar - env var holding `<host>[:port]`
 * @param {string} opts.deviceVar - env var holding a device id
 * @param {string|null} [opts.deviceId] - a device id from a flag (beats deviceVar)
 * @param {number} opts.port - appended when the address has no port
 * @param {Object} [opts.env]
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<string>} `<host>:<port>`
 */
export async function resolveDeviceHost({ hostVar, deviceVar, deviceId = null, port, env = process.env, fetchImpl = globalThis.fetch }) {
  const withPort = (h) => (/:\d+$/.test(h) ? h : `${h}:${port}`);
  if (env[hostVar]) return withPort(String(env[hostVar]).trim());
  const id = deviceId || env[deviceVar];
  if (!id) {
    throw new Error(`no target: set ${hostVar}=<host>:${port}, or ${deviceVar}=<device id> to read its address from the household device registry`);
  }
  const base = appBaseUrl(env);
  let devices;
  try {
    const res = await fetchImpl(`${base}/api/v1/device/config`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    devices = (await res.json())?.devices ?? {};
  } catch (err) {
    throw new Error(`could not read the device registry from ${base} (${err.message}); set ${hostVar} instead`);
  }
  const host = deviceAddress(devices[id]);
  if (!host) throw new Error(`device "${id}" has no content_control.host or host in the registry; set ${hostVar} instead`);
  return withPort(host);
}

/** Resolve, or print the reason and exit 2. */
export async function resolveDeviceHostOrExit(opts) {
  try {
    return await resolveDeviceHost(opts);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(2);
  }
}
