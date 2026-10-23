import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
const captured = vi.hoisted(() => ({ options: null }));
vi.mock('./useFitnessStateSync.js', () => ({ useFitnessStateSync: options => { captured.options = options; } }));
import { useZoneLedSync } from './useZoneLedSync.js';
import { useEquipmentFanSync } from './useEquipmentFanSync.js';

describe.each([['LED', useZoneLedSync], ['fan', useEquipmentFanSync]])('%s earned-zone output', (_label, hook) => {
  it('uses committed zones and suppresses untrusted/null raw highs', () => {
    renderHook(() => hook({ enabled:true, sessionActive:true,
      participantRoster:[
        {zoneTrusted:false,zoneId:'hot',rawZoneId:'fire',isActive:true},
        {zoneId:null,rawZoneId:'fire',isActive:true},
        {zoneId:'active',rawZoneId:'hot',isActive:true},
      ], rpmDevices:[{deviceId:'201',cadence:47}] }));
    expect(captured.options.buildPayload().zones).toEqual([
      {zoneId:null,isActive:true},{zoneId:null,isActive:true},{zoneId:'active',isActive:true},
    ]);
    expect(captured.options.buildSignature()).not.toMatch(/fire|hot/);
  });
});
it('preserves cadence fan payloads independently of earned HR zones', () => {
  renderHook(() => useEquipmentFanSync({participantRoster:[{zoneId:null,rawZoneId:'fire'}],rpmDevices:[{deviceId:'201',cadence:47}]}));
  expect(captured.options.buildPayload().rpm).toEqual({'201':47});
  expect(captured.options.buildSignature()).toContain('201:go');
});
