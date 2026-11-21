/**
 * Keeps the old piano-bridge APK's device config in step with household config.
 *
 * The APK carries no household values: which instrument to dial (`targetName`,
 * `targetMac`), its own device id for the log store and where that store is all
 * arrive from here. On each reachable supervisor tick this reads `GET /config`,
 * and when a wanted key differs it read-merge-writes `POST /config` (the same
 * shape as the wake-suppress relay, so no sibling key is ever lost).
 *
 * A POST makes the bridge rebuild its Bluetooth links, so a push waits for an
 * idle kiosk (`checkIdle`) and is never repeated sooner than `minPushGapMs`.
 * Without an idle check nothing is pushed: dropping a child's MIDI link to sync
 * config is never worth it.
 *
 * @module piano/adapters/bridge/PianoBridgeConfigSyncAdapter
 */

const DEFAULT_MIN_PUSH_GAP_MS = 10 * 60_000;
const TIMEOUT_MS = 8000;

/** Keys whose wanted value differs from what the bridge reports. Pure. */
export function configDrift(current = {}, wanted = {}) {
  return Object.keys(wanted).filter((key) => {
    const want = wanted[key];
    if (want === undefined || want === null || want === '') return false;
    return String(current?.[key] ?? '') !== String(want);
  });
}

export class PianoBridgeConfigSyncAdapter {
  #baseUrl; #fetchImpl; #logger; #wanted; #checkIdle; #now; #minPushGapMs;
  #lastPushAt = null;

  /**
   * @param {Object} opts
   * @param {string} opts.bridgeUrl - http(s) base of the bridge control plane
   * @param {Object<string,string>} opts.wanted - flat keys the bridge must hold
   * @param {(() => Promise<{idle:boolean, reason?:string|null}>)|null} opts.checkIdle
   */
  constructor({ bridgeUrl, wanted, checkIdle = null, fetchImpl = globalThis.fetch, logger = console, now = () => Date.now(), minPushGapMs = DEFAULT_MIN_PUSH_GAP_MS } = {}) {
    if (!bridgeUrl) throw new Error('PianoBridgeConfigSyncAdapter requires bridgeUrl');
    if (typeof fetchImpl !== 'function') throw new Error('PianoBridgeConfigSyncAdapter requires fetchImpl');
    this.#baseUrl = bridgeUrl.replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/+$/, '');
    this.#wanted = { ...(wanted || {}) };
    this.#checkIdle = typeof checkIdle === 'function' ? checkIdle : null;
    this.#fetchImpl = fetchImpl;
    this.#logger = logger;
    this.#now = now;
    this.#minPushGapMs = minPushGapMs;
  }

  get wantedKeys() { return Object.keys(this.#wanted); }

  /** @returns {Promise<{status:'in-sync'|'pushed'|'deferred'|'unreadable'|'failed', keys?:string[], reason?:string}>} */
  async reconcile() {
    const url = `${this.#baseUrl}/config`;
    let values;
    try {
      const res = await this.#fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(TIMEOUT_MS) });
      values = res?.ok ? (await res.json())?.values : null;
    } catch { values = null; }
    if (!values || typeof values !== 'object') {
      this.#logger.debug?.('piano-bridge.config-sync.unreadable', {});
      return { status: 'unreadable' };
    }
    const keys = configDrift(values, this.#wanted);
    if (!keys.length) return { status: 'in-sync' };

    if (this.#lastPushAt !== null && this.#now() - this.#lastPushAt < this.#minPushGapMs) {
      return { status: 'deferred', keys, reason: 'recent-push' };
    }
    if (!this.#checkIdle) {
      this.#logger.warn?.('piano-bridge.config-sync.deferred', { keys, reason: 'no-idle-check' });
      return { status: 'deferred', keys, reason: 'no-idle-check' };
    }
    let idle;
    try { idle = await this.#checkIdle(); } catch (err) { idle = { idle: false, reason: `idle-check-failed: ${err?.message ?? err}` }; }
    if (!idle?.idle) {
      this.#logger.debug?.('piano-bridge.config-sync.deferred', { keys, reason: idle?.reason ?? 'busy' });
      return { status: 'deferred', keys, reason: idle?.reason ?? 'busy' };
    }

    const merged = { ...values };
    for (const key of keys) merged[key] = String(this.#wanted[key]);
    const yaml = Object.entries(merged).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n';
    this.#lastPushAt = this.#now();
    try {
      const res = await this.#fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: yaml,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res?.ok) {
        this.#logger.warn?.('piano-bridge.config-sync.failed', { keys, status: res?.status ?? null });
        return { status: 'failed', keys };
      }
    } catch (err) {
      this.#logger.warn?.('piano-bridge.config-sync.failed', { keys, error: String(err?.message ?? err) });
      return { status: 'failed', keys };
    }
    // Key names only: values can include an address, never a secret, but stay out of logs.
    this.#logger.info?.('piano-bridge.config-sync.pushed', { keys });
    return { status: 'pushed', keys };
  }
}

/**
 * What the bridge must hold, from household config. Pure.
 *
 * @param {Object} opts
 * @param {string} opts.deviceId - the tablet (becomes heartbeatDeviceId)
 * @param {Object|null} opts.midiDevice - the devices.yml entry the bridge dials;
 *   its `bluetooth: { name, address }` become targetName / targetMac
 * @param {Object|null} [opts.deviceConfig] - extra flat keys (bridge_supervisor.device_config)
 */
export function wantedBridgeConfig({ deviceId, midiDevice = null, deviceConfig = null }) {
  const wanted = {};
  for (const [key, value] of Object.entries(deviceConfig || {})) {
    if (value !== null && value !== undefined && typeof value !== 'object') wanted[key] = String(value);
  }
  if (deviceId) wanted.heartbeatDeviceId = deviceId;
  const bt = midiDevice?.bluetooth;
  if (bt?.name) wanted.targetName = String(bt.name);
  if (bt?.address) wanted.targetMac = String(bt.address).toUpperCase();
  return wanted;
}
