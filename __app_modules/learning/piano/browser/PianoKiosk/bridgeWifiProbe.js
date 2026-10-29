// bridgeWifiProbe — the piano kiosk's answer to "what did the tablet's Wi-Fi
// look like when the video stalled?".
//
// The on-device bridge samples WifiManager + TrafficStats (payload p34,
// `GET :8770/wifi`). Registered as the Player's link probe, it turns every
// `playback.stalled` on this kiosk into a `playback.stalled.link` row carrying
// RSSI, link speed, band, BSSID and recent throughput. 2026-10-28 incident:
// ops:docs/_wip/bugs/2026-10-28-piano-lesson-video-stalls.md
import { registerPlaybackLinkProbe, LINK_PROBE_TIMEOUT_MS } from '../../../../../__capabilities/playback/browser/linkProbe.mjs';
import { bridgeHostPlausible } from './bridgeHost.js';

export const BRIDGE_WIFI_URL = 'http://localhost:8770/wifi?fresh=1';
const RECENT_KEEP = 6;

const pick = (s) => (s ? {
  rssi: s.rssi ?? null,
  linkSpeedMbps: s.linkSpeedMbps ?? null,
  rxLinkSpeedMbps: s.rxLinkSpeedMbps ?? null,
  freqMhz: s.freqMhz ?? null,
  band: s.band ?? null,
  bssid: s.bssid ?? null,
  rxKbps: s.rxKbps ?? null,
  degraded: s.degraded ?? null,
  degradedReason: s.degradedReason ?? null,
  ageMs: s.ageMs ?? null,
} : null);

/** Fetch the bridge's Wi-Fi view and compact it for a log row. Throws on failure. */
export async function fetchBridgeWifi({ fetchImpl = fetch, timeoutMs = LINK_PROBE_TIMEOUT_MS - 200 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(BRIDGE_WIFI_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`bridge-wifi-http-${res.status}`);
    const body = await res.json();
    const recent = Array.isArray(body?.recent) ? body.recent.slice(-RECENT_KEEP) : [];
    return {
      source: 'piano-bridge',
      current: pick(body?.current),
      // Throughput trend just before the stall, oldest first.
      recentRxKbps: recent.map((s) => s?.rxKbps ?? null),
      recentRssi: recent.map((s) => s?.rssi ?? null),
      roams: body?.roams ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Register the bridge probe when a bridge could exist here. Returns unregister. */
export function installBridgeWifiProbe({ plausible = bridgeHostPlausible, fetchImpl } = {}) {
  if (!plausible()) return () => {};
  return registerPlaybackLinkProbe(() => fetchBridgeWifi({ fetchImpl }));
}
