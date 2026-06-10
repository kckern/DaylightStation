// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { DanceLightingController } from '#adapters/fitness/DanceLightingController.mjs';

const cfg = (over = {}) => ({ dance_party: { lighting: {
  color_strips: ['light.strip1', 'light.strip2'],
  white_lights: ['light.white'],
  base_effect: 'colorloop',
  accent: { mode: 'flash', min_interval_ms: 4000 },
  ...over
} } });

const make = (fitnessConfig = cfg()) => {
  const gateway = { callService: vi.fn().mockResolvedValue({ ok: true }) };
  const controller = new DanceLightingController({ gateway, loadFitnessConfig: () => fitnessConfig, logger: { info(){}, warn(){}, error(){}, debug(){} } });
  return { gateway, controller };
};

describe('DanceLightingController', () => {
  it('start: turns off white lights and starts colorloop on the strips', async () => {
    const { gateway, controller } = make();
    const res = await controller.start('h1');
    expect(res.ok).toBe(true);
    expect(gateway.callService).toHaveBeenCalledWith('light', 'turn_off', { entity_id: ['light.white'] });
    expect(gateway.callService).toHaveBeenCalledWith('light', 'turn_on', { entity_id: ['light.strip1', 'light.strip2'], effect: 'colorloop' });
  });

  it('stop: turns white back on and strips off', async () => {
    const { gateway, controller } = make();
    await controller.stop('h1');
    expect(gateway.callService).toHaveBeenCalledWith('light', 'turn_on', { entity_id: ['light.white'] });
    expect(gateway.callService).toHaveBeenCalledWith('light', 'turn_off', { entity_id: ['light.strip1', 'light.strip2'] });
  });

  it('accent: fires a flash then re-asserts the base effect', async () => {
    const { gateway, controller } = make();
    await controller.accent('h1', 1000);
    expect(gateway.callService).toHaveBeenCalledWith('light', 'turn_on', { entity_id: ['light.strip1', 'light.strip2'], flash: 'short' });
    expect(gateway.callService).toHaveBeenCalledWith('light', 'turn_on', { entity_id: ['light.strip1', 'light.strip2'], effect: 'colorloop' });
  });

  it('accent: a second accent within min_interval_ms is rate-limited (no gateway calls)', async () => {
    const { gateway, controller } = make();
    await controller.accent('h1', 1000);
    gateway.callService.mockClear();
    const res = await controller.accent('h1', 1500); // 500ms < 4000ms
    expect(res.skipped).toBe(true);
    expect(gateway.callService).not.toHaveBeenCalled();
  });

  it('accent: breathe mode uses effect instead of flash', async () => {
    const { gateway, controller } = make(cfg({ accent: { mode: 'breathe', min_interval_ms: 0 } }));
    await controller.accent('h1', 1000);
    expect(gateway.callService).toHaveBeenCalledWith('light', 'turn_on', { entity_id: ['light.strip1', 'light.strip2'], effect: 'breathe' });
  });

  it('skips entirely when lighting is unconfigured', async () => {
    const { gateway, controller } = make({});
    const res = await controller.start('h1');
    expect(res.skipped).toBe(true);
    expect(gateway.callService).not.toHaveBeenCalled();
  });

  it('start: raises the party-mode flag BEFORE turning off white lights', async () => {
    const { gateway, controller } = make(cfg({ party_mode_flag: 'input_boolean.party' }));
    await controller.start('h1');
    const calls = gateway.callService.mock.calls;
    const flagIdx = calls.findIndex(c => c[0] === 'input_boolean' && c[1] === 'turn_on');
    const whiteIdx = calls.findIndex(c => c[0] === 'light' && c[1] === 'turn_off');
    expect(flagIdx).toBeGreaterThanOrEqual(0);
    expect(flagIdx).toBeLessThan(whiteIdx);
    expect(calls[flagIdx][2]).toEqual({ entity_id: 'input_boolean.party' });
  });

  it('start: if the flag call fails, skips white-light-off but still starts strips', async () => {
    const { gateway, controller } = make(cfg({ party_mode_flag: 'input_boolean.party' }));
    gateway.callService.mockImplementation((domain) =>
      domain === 'input_boolean' ? Promise.reject(new Error('ha down')) : Promise.resolve({ ok: true }));
    const res = await controller.start('h1');
    expect(res.ok).toBe(true);
    expect(gateway.callService).not.toHaveBeenCalledWith('light', 'turn_off', expect.anything());
    expect(gateway.callService).toHaveBeenCalledWith('light', 'turn_on', { entity_id: ['light.strip1', 'light.strip2'], effect: 'colorloop' });
  });

  it('stop: clears the party-mode flag after restoring lights; flag failure does not fail stop', async () => {
    const { gateway, controller } = make(cfg({ party_mode_flag: 'input_boolean.party' }));
    await controller.stop('h1');
    const calls = gateway.callService.mock.calls;
    const flagIdx = calls.findIndex(c => c[0] === 'input_boolean' && c[1] === 'turn_off');
    expect(flagIdx).toBe(calls.length - 1);

    const second = make(cfg({ party_mode_flag: 'input_boolean.party' }));
    second.gateway.callService.mockImplementation((domain) =>
      domain === 'input_boolean' ? Promise.reject(new Error('ha down')) : Promise.resolve({ ok: true }));
    const res = await second.controller.stop('h1');
    expect(res.ok).toBe(true);
  });

  it('start/stop: no flag configured → identical behavior to before (no input_boolean calls)', async () => {
    const { gateway, controller } = make();
    await controller.start('h1');
    await controller.stop('h1');
    expect(gateway.callService).not.toHaveBeenCalledWith('input_boolean', expect.anything(), expect.anything());
  });
});
