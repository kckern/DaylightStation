/**
 * DeviceManager — ANT+ profile is the authoritative device-type signal.
 *
 * The garage backend forwards a strap's ANT+ profile ('HR'/'CAD'/'PWR') on
 * every broadcast, even when it strips an out-of-range reading (0 bpm) to null.
 * A HR strap reading 0 bpm must still classify as 'heart_rate' so it appears in
 * the roster and is guest-assignable — not degrade to 'unknown' equipment.
 */
import { describe, it, expect } from 'vitest';
import { DeviceManager } from './DeviceManager.js';

describe('DeviceManager — profile-authoritative classification', () => {
  it('classifies an HR strap as heart_rate even when the reading was stripped to null', () => {
    const dm = new DeviceManager();
    const device = dm.updateDevice('10266', 'HR', { ComputedHeartRate: null });
    expect(device.type).toBe('heart_rate');
    expect(device.heartRate).toBe(null);
  });

  it('classifies an HR strap as heart_rate and records a valid reading', () => {
    const dm = new DeviceManager();
    const device = dm.updateDevice('90001', 'HR', { ComputedHeartRate: 125 });
    expect(device.type).toBe('heart_rate');
    expect(device.heartRate).toBe(125);
  });

  it('classifies a CAD profile as cadence', () => {
    const dm = new DeviceManager();
    const device = dm.updateDevice('7138', 'CAD', { CalculatedCadence: 88 });
    expect(device.type).toBe('cadence');
    expect(device.cadence).toBe(88);
  });

  it('classifies a PWR profile as power', () => {
    const dm = new DeviceManager();
    const device = dm.updateDevice('49904', 'PWR', { InstantaneousPower: 210 });
    expect(device.type).toBe('power');
    expect(device.power).toBe(210);
  });

  it('falls back to data-field inference when the profile is unknown/absent', () => {
    const dm = new DeviceManager();
    const device = dm.updateDevice('555', null, { ComputedHeartRate: 99 });
    expect(device.type).toBe('heart_rate');
  });

  it('leaves a device with no profile and no usable data as unknown', () => {
    const dm = new DeviceManager();
    const device = dm.updateDevice('999', null, { ComputedHeartRate: null });
    expect(device.type).toBe('unknown');
  });
});
