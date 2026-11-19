/**
 * The one PianoWakeHoldSyncAdapter for the piano tablet, shared by the MIDI wake
 * (which reports a failed relay) and the bridge supervisor (which reconciles on its
 * reachable ticks). Built only for `bridge_provider: daylight-android`; the old
 * piano-bridge APK has no equivalent need, its hold being read-merge-written on
 * each relay.
 *
 * @module piano/composition/wake-hold-sync
 */
import { PianoWakeHoldSyncAdapter } from '../adapters/bridge/PianoWakeHoldSyncAdapter.mjs';
import { DAYLIGHT_ANDROID } from './bridge-endpoint.mjs';

const instances = new Map();

/**
 * @param {Object} opts
 * @param {{provider:string, httpBase:string, headers:Object}} opts.endpoint - from resolvePianoBridgeEndpoint
 * @param {string} opts.deviceId
 * @param {Function|null} opts.getScreenOverrideService
 * @returns {PianoWakeHoldSyncAdapter|null}
 */
export function getPianoWakeHoldSync({ endpoint, deviceId, getScreenOverrideService, logger = console, factory = (o) => new PianoWakeHoldSyncAdapter(o) }) {
  if (endpoint?.provider !== DAYLIGHT_ANDROID || typeof getScreenOverrideService !== 'function') return null;
  const key = JSON.stringify([deviceId, endpoint.httpBase]);
  if (!instances.has(key)) {
    instances.set(key, factory({ baseUrl: endpoint.httpBase, headers: endpoint.headers, deviceId, overrides: getScreenOverrideService(), logger }));
  }
  return instances.get(key);
}

/** Test-only: forget the shared instance. */
export function _resetForTests() { instances.clear(); }
