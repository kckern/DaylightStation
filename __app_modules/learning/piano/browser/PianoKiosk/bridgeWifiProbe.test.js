import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchBridgeWifi, installBridgeWifiProbe, BRIDGE_WIFI_URL } from './bridgeWifiProbe.js';
import { probePlaybackLink } from '../../../../../__capabilities/playback/browser/player/lib/linkProbe.js';

const okBody = {
  ok: true,
  current: { rssi: -79, linkSpeedMbps: 6, freqMhz: 2437, band: '2.4GHz', bssid: 'aa:bb', rxKbps: 310, degraded: true, degradedReason: 'rssi,linkSpeed', ageMs: 0, ssid: 'x' },
  recent: Array.from({ length: 10 }, (_, i) => ({ rssi: -70 - i, rxKbps: 1000 - i * 50 })),
  roams: 2,
};
const fetchOk = vi.fn(async () => ({ ok: true, json: async () => okBody }));

let off = () => {};
afterEach(() => { off(); off = () => {}; });

describe('fetchBridgeWifi', () => {
  it('asks the bridge for a fresh sample and compacts it (no SSID, last 6 throughput samples)', async () => {
    const r = await fetchBridgeWifi({ fetchImpl: fetchOk });
    expect(fetchOk).toHaveBeenCalledWith(BRIDGE_WIFI_URL, expect.anything());
    expect(r.current).toEqual(expect.objectContaining({ rssi: -79, linkSpeedMbps: 6, band: '2.4GHz', bssid: 'aa:bb', rxKbps: 310, degraded: true }));
    expect(r.current).not.toHaveProperty('ssid');
    expect(r.recentRxKbps).toHaveLength(6);
    expect(r.recentRxKbps.at(-1)).toBe(550);
    expect(r.roams).toBe(2);
  });

  it('throws on a non-OK answer (the probe turns it into { error })', async () => {
    await expect(fetchBridgeWifi({ fetchImpl: async () => ({ ok: false, status: 404 }) })).rejects.toThrow(/404/);
  });
});

describe('installBridgeWifiProbe', () => {
  it('registers as the Player link probe on a bridge host', async () => {
    off = installBridgeWifiProbe({ plausible: () => true, fetchImpl: fetchOk });
    const r = await probePlaybackLink();
    expect(r.source).toBe('piano-bridge');
  });

  it('does nothing where no bridge can exist', async () => {
    off = installBridgeWifiProbe({ plausible: () => false, fetchImpl: fetchOk });
    await expect(probePlaybackLink()).resolves.toBeNull();
  });
});
