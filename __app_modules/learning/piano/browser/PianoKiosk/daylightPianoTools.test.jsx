import { expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createBluetoothClient } from './bluetoothClient.js';
import { checkBridgeMediaVolume } from './bridgeAudioVolume.js';
import { fetchBridgeWifi } from './bridgeWifiProbe.js';
import { useBridgeMidiTap } from './useBridgeMidiTap.js';

it('uses selected piano tools without the old helper and preserves native pairing refusal', async () => {
  const offline = vi.fn(async () => { throw Error('legacy helper absent'); });
  const state = { ok: true, adapter: { enabled: true }, devices: [] };
  let polls = 0;
  window.daylight = {deviceId: 'piano', piano: {
    bluetoothState: () => state,
    bluetoothCommand: () => ({ok:false, code:'permission_denied', error:'Permission required'}),
    checkVolume: () => ({ok:true, guard:{routeOk:true, musicIndex:15, musicMax:15}}),
    wifi: () => ({ok:true,current:{rssi:-44},recent:[],roams:0}),
    midiTap: () => ({ok:true,tap:{chunks:++polls,recent:['12 C0 08']}}),
  }};
  let result;
  try {
    const client = createBluetoothClient({fetchImpl:offline});
    expect(await client.state()).toEqual(state);
    await expect(client.command('pair', {address:'AA:BB:CC:DD:EE:FF'})).rejects.toMatchObject({code:'permission_denied'});
    expect(await checkBridgeMediaVolume({fetchImpl:offline})).toMatchObject({available:true, silent:false});
    expect(await fetchBridgeWifi({fetchImpl:offline})).toMatchObject({current:{rssi:-44}});
    result = renderHook(() => useBridgeMidiTap({enabled:true,intervalMs:10,fetchImpl:offline}));
    await waitFor(() => expect(result.result.current.changes[0]?.pc).toBe(8));
    expect(offline).not.toHaveBeenCalled();
  } finally { result?.unmount(); delete window.daylight; }
});
