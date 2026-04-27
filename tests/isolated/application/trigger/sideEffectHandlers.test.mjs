import { describe, it, expect, vi } from 'vitest';
import {
  sideEffectHandlers,
  dispatchSideEffect,
  UnknownSideEffectError,
} from '../../../../backend/src/3_applications/trigger/sideEffectHandlers.mjs';

describe('sideEffectHandlers', () => {
  it('tv-off calls tvControlAdapter.turnOff with the location', async () => {
    const tvControlAdapter = { turnOff: vi.fn().mockResolvedValue({ ok: true }) };
    const out = await sideEffectHandlers['tv-off'](
      { location: 'living_room' },
      { tvControlAdapter }
    );
    expect(tvControlAdapter.turnOff).toHaveBeenCalledWith('living_room');
    expect(out).toEqual({ ok: true });
  });

  it('tv-off throws if tvControlAdapter is missing', async () => {
    await expect(sideEffectHandlers['tv-off'](
      { location: 'living_room' },
      {}
    )).rejects.toThrow(/tvControlAdapter not configured/);
  });

  it('tv-off throws if location is missing', async () => {
    const tvControlAdapter = { turnOff: vi.fn() };
    await expect(sideEffectHandlers['tv-off'](
      {},
      { tvControlAdapter }
    )).rejects.toThrow(/tv-off requires location/);
  });

  it('clear calls device.clearContent for the resolved device', async () => {
    const device = { clearContent: vi.fn().mockResolvedValue({ ok: true }) };
    const deviceService = { get: vi.fn().mockReturnValue(device) };
    const out = await sideEffectHandlers.clear(
      { deviceId: 'livingroom-tv' },
      { deviceService }
    );
    expect(deviceService.get).toHaveBeenCalledWith('livingroom-tv');
    expect(device.clearContent).toHaveBeenCalled();
    expect(out).toEqual({ ok: true });
  });

  it('clear throws when device is unknown', async () => {
    const deviceService = { get: vi.fn().mockReturnValue(null) };
    await expect(sideEffectHandlers.clear(
      { deviceId: 'ghost' },
      { deviceService }
    )).rejects.toThrow(/Unknown device: ghost/);
  });

  it('dispatchSideEffect routes by behavior', async () => {
    const tvControlAdapter = { turnOff: vi.fn().mockResolvedValue({ ok: true }) };
    await dispatchSideEffect(
      { behavior: 'tv-off', location: 'living_room' },
      { tvControlAdapter }
    );
    expect(tvControlAdapter.turnOff).toHaveBeenCalled();
  });

  it('dispatchSideEffect throws UnknownSideEffectError for unknown behavior', async () => {
    await expect(dispatchSideEffect(
      { behavior: 'self-destruct' },
      {}
    )).rejects.toBeInstanceOf(UnknownSideEffectError);
  });
});
