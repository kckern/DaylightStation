import { describe, it, expect, vi } from 'vitest';
import { DeviceFleetControlService } from './DeviceFleetControlService.mjs';
import { VolumeBoostService } from './VolumeBoostService.mjs';

const fakeClock = (start = 0) => {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
};

/** A device stub that records what level actually reached the hardware. */
function makeDevice({ cap = 55, boostMax = 85, hasVolume = true } = {}) {
  const applied = [];
  return {
    applied,
    volumePolicy: { cap, boostMax },
    hasCapability: (c) => (c === 'volume' ? hasVolume : false),
    setVolume: vi.fn(async (level) => {
      // Mirror Device's own hard clamp so the test exercises the real contract.
      const clamped = boostMax !== null && level > boostMax ? boostMax : level;
      applied.push(clamped);
      return { ok: true, level: clamped };
    }),
    getVolume: vi.fn(async () => ({ ok: true, level: 55 })),
  };
}

function makeService(device, { boosts, scheduler } = {}) {
  return {
    service: new DeviceFleetControlService({
      devices: { get: (id) => (id === 'portal' ? device : null), listDevices: () => [] },
      configuration: {},
      volumeBoosts: boosts ?? null,
      scheduler: scheduler ?? null,
      logger: { info: vi.fn(), warn: vi.fn() },
    }),
  };
}

describe('DeviceFleetControlService volume governance', () => {
  it('clamps a request above the cap down to the cap', async () => {
    const device = makeDevice({ cap: 55, boostMax: 85 });
    const { service } = makeService(device, { boosts: new VolumeBoostService({ clock: fakeClock() }) });

    const result = await service.volume('portal', 90);

    expect(device.applied).toEqual([55]);
    expect(result.kind).toBe('ok');
    expect(result.capped).toBe(true);
    expect(result.requested).toBe(90);
  });

  it('passes a request below the cap through untouched', async () => {
    const device = makeDevice({ cap: 55 });
    const { service } = makeService(device, { boosts: new VolumeBoostService({ clock: fakeClock() }) });

    const result = await service.volume('portal', 30);

    expect(device.applied).toEqual([30]);
    expect(result.capped).toBeUndefined();
  });

  it('honours a live boost above the cap', async () => {
    const clock = fakeClock();
    const boosts = new VolumeBoostService({ clock });
    const device = makeDevice({ cap: 55, boostMax: 85 });
    const { service } = makeService(device, { boosts });
    boosts.set('portal', 80, 30);

    await service.volume('portal', 75);

    expect(device.applied).toEqual([75]);
  });

  it('still clamps to the boost ceiling during a boost', async () => {
    const boosts = new VolumeBoostService({ clock: fakeClock() });
    const device = makeDevice({ cap: 55, boostMax: 85 });
    const { service } = makeService(device, { boosts });
    boosts.set('portal', 70, 30);

    await service.volume('portal', 100);

    expect(device.applied).toEqual([70]);
  });

  it('returns to the cap once the boost window expires', async () => {
    const clock = fakeClock();
    const boosts = new VolumeBoostService({ clock });
    const device = makeDevice({ cap: 55, boostMax: 85 });
    const { service } = makeService(device, { boosts });
    boosts.set('portal', 80, 10);

    clock.advance(10 * 60_000);
    await service.volume('portal', 80);

    expect(device.applied).toEqual([55]);
  });

  it('never exceeds boost_max even when a larger boost is requested', async () => {
    const boosts = new VolumeBoostService({ clock: fakeClock() });
    const device = makeDevice({ cap: 55, boostMax: 85 });
    const { service } = makeService(device, { boosts });

    const result = await service.boostVolume('portal', { level: 100, minutes: 15 });

    expect(device.applied).toEqual([85]);
    expect(result.result.ceiling).toBe(85);
    expect(result.result.capped).toBe(true);
  });

  it('re-applies the cap when the boost timer fires', async () => {
    const clock = fakeClock();
    const boosts = new VolumeBoostService({ clock });
    const device = makeDevice({ cap: 55, boostMax: 85 });
    let fire = null;
    const scheduler = { after: (_d, task) => { fire = task; return () => {}; } };
    const { service } = makeService(device, { boosts, scheduler });

    await service.boostVolume('portal', { level: 80, minutes: 10 });
    expect(device.applied).toEqual([80]);

    clock.advance(10 * 60_000);
    await fire();

    expect(device.applied).toEqual([80, 55]);
  });

  it('leaves a renewed boost alone when the superseded timer fires', async () => {
    const clock = fakeClock();
    const boosts = new VolumeBoostService({ clock });
    const device = makeDevice({ cap: 55, boostMax: 85 });
    const fires = [];
    const scheduler = { after: (_d, task) => { fires.push(task); return () => {}; } };
    const { service } = makeService(device, { boosts, scheduler });

    await service.boostVolume('portal', { level: 80, minutes: 10 });
    clock.advance(5 * 60_000);
    await service.boostVolume('portal', { level: 80, minutes: 30 }); // renewed, still live

    await fires[0]();  // the FIRST window's timer

    // 80 twice from the two boosts, and no revert to 55.
    expect(device.applied).toEqual([80, 80]);
  });

  it('clearing a boost returns the device to its cap', async () => {
    const boosts = new VolumeBoostService({ clock: fakeClock() });
    const device = makeDevice({ cap: 55, boostMax: 85 });
    const { service } = makeService(device, { boosts });
    await service.boostVolume('portal', { level: 80, minutes: 30 });

    const result = await service.clearVolumeBoost('portal');

    expect(device.applied).toEqual([80, 55]);
    expect(result.result.restoredTo).toBe(55);
    expect(boosts.get('portal')).toBeNull();
  });

  it('refuses to boost an ungoverned device rather than inventing a policy', async () => {
    const boosts = new VolumeBoostService({ clock: fakeClock() });
    const device = makeDevice({ cap: null, boostMax: null });
    const { service } = makeService(device, { boosts });

    expect((await service.boostVolume('portal', { level: 80, minutes: 10 })).kind).toBe('ungoverned');
    expect(device.applied).toEqual([]);
  });

  it('leaves an ungoverned device uncapped', async () => {
    const boosts = new VolumeBoostService({ clock: fakeClock() });
    const device = makeDevice({ cap: null, boostMax: null });
    const { service } = makeService(device, { boosts });

    await service.volume('portal', 100);

    expect(device.applied).toEqual([100]);
  });

  it('reports unsupported for a device with no volume capability', async () => {
    const device = makeDevice({ hasVolume: false });
    const { service } = makeService(device, { boosts: new VolumeBoostService({ clock: fakeClock() }) });

    expect((await service.volume('portal', 50)).kind).toBe('unsupported');
    expect((await service.volumeState('portal')).kind).toBe('unsupported');
    expect(device.applied).toEqual([]);
  });

  it('does not emit the route deprecation warning when nothing was set', async () => {
    const device = makeDevice({ hasVolume: false });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const service = new DeviceFleetControlService({
      devices: { get: () => device, listDevices: () => [] },
      configuration: {}, logger,
    });

    await service.volume('portal', 50);

    expect(logger.warn).not.toHaveBeenCalledWith('device.volume.deprecated', expect.anything());
  });

  it('reports the governing ceiling alongside the reading', async () => {
    const boosts = new VolumeBoostService({ clock: fakeClock() });
    const device = makeDevice({ cap: 55, boostMax: 85 });
    const { service } = makeService(device, { boosts });

    const state = await service.volumeState('portal');

    expect(state.result).toMatchObject({ ok: true, level: 55, ceiling: 55, ceilingSource: 'cap' });
  });
});
