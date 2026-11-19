// A manual hold on one screen must not touch another device's MIDI wake.
// Regression: setOverride('off') on ANY device called the piano's
// suppressWakeUntil (muting the piano's note wake) and skipped the override
// for the device that was asked.
import { describe, it, expect, vi } from 'vitest';
import { DeviceScreenControlService } from '#apps/devices/services/DeviceScreenControlService.mjs';
import { ScreenOverrideService } from '#apps/devices/services/ScreenOverrideService.mjs';

const NOW = 1_800_000_000_000;
function setup() {
  const overrides = new ScreenOverrideService({ clock: { now: () => NOW } });
  const midiWake = { deviceId: 'yellow-room-tablet', suppressWakeUntil: vi.fn(), resumeWake: vi.fn() };
  const device = { setScreen: vi.fn(async () => ({ ok: true })), getStatus: async () => ({ screenOn: true }) };
  const service = new DeviceScreenControlService({
    devices: { get: () => device },
    holdPolicy: { offMinutes: () => 30, onMinutes: () => 10 },
    screenOverrides: overrides,
    midiWake,
    logger: { info() {}, warn() {}, error() {} },
    nowMs: () => NOW,
  });
  return { service, overrides, midiWake };
}

describe('DeviceScreenControlService: the MIDI wake belongs to one device', () => {
  it('an off hold on another device sets that device override and leaves the piano wake alone', async () => {
    const { service, overrides, midiWake } = setup();
    await service.setOverride('portal', 'off', 20);
    expect(overrides.get('portal')?.state).toBe('off');
    expect(midiWake.suppressWakeUntil).not.toHaveBeenCalled();
  });

  it('an off hold on the piano tablet sets its override and relays the deadline', async () => {
    const { service, overrides, midiWake } = setup();
    await service.setOverride('yellow-room-tablet', 'off', 20);
    expect(overrides.get('yellow-room-tablet')?.state).toBe('off');
    expect(midiWake.suppressWakeUntil).toHaveBeenCalledWith(NOW + 20 * 60_000);
  });

  it('clearing another device hold does not resume the piano wake', async () => {
    const { service, midiWake } = setup();
    await service.setOverride('portal', 'off', 20);
    service.clearOverride('portal');
    expect(midiWake.resumeWake).not.toHaveBeenCalled();
  });

  it('suppressWake for another device does not mute the piano', () => {
    const { service, midiWake } = setup();
    expect(service.suppressWake('portal', 20)).toMatchObject({ relayed: false });
    expect(midiWake.suppressWakeUntil).not.toHaveBeenCalled();
  });
});

describe('DeviceScreenControlService: a hold lasts at most 24 hours', () => {
  it('setOverride clamps a longer request to 24 h, for the override and the relayed deadline', async () => {
    const { service, overrides, midiWake } = setup();
    await service.setOverride('yellow-room-tablet', 'off', 100_000);
    expect(overrides.get('yellow-room-tablet')?.until).toBe(NOW + 24 * 60 * 60_000);
    expect(midiWake.suppressWakeUntil).toHaveBeenCalledWith(NOW + 24 * 60 * 60_000);
  });

  it('an on hold is clamped the same way', async () => {
    const { service, overrides } = setup();
    await service.setOverride('portal', 'on', 5_000);
    expect(overrides.get('portal')?.until).toBe(NOW + 24 * 60 * 60_000);
  });

  it('suppressWake clamps to 24 h', () => {
    const { service, midiWake } = setup();
    expect(service.suppressWake('yellow-room-tablet', 1e9)).toMatchObject({ until: NOW + 24 * 60 * 60_000, relayed: true });
    expect(midiWake.suppressWakeUntil).toHaveBeenCalledWith(NOW + 24 * 60 * 60_000);
  });

  it('a request under 24 h is kept as asked', async () => {
    const { service, overrides } = setup();
    await service.setOverride('portal', 'off', 90);
    expect(overrides.get('portal')?.until).toBe(NOW + 90 * 60_000);
  });
});
