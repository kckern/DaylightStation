// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { DanceLightingController } from './DanceLightingController.mjs';
import { resolveDanceLightingConfig } from './danceLightingConfig.mjs';

const silentLogger = { info(){}, warn(){}, error(){}, debug(){} };

function makeController(lighting) {
  const gateway = { callService: vi.fn().mockResolvedValue({}) };
  const ctrl = new DanceLightingController({
    gateway,
    loadFitnessConfig: () => ({ dance_party: { lighting } }),
    logger: silentLogger
  });
  return { ctrl, gateway };
}

describe('danceLightingConfig — plugs', () => {
  it('normalizes bare plug names to the switch domain and passes domained ids through', () => {
    const cfg = resolveDanceLightingConfig({
      dance_party: { lighting: { plugs: ['garage_disco_light_plug', 'switch.already_qualified', '', null] } }
    });
    expect(cfg.plugs).toEqual(['switch.garage_disco_light_plug', 'switch.already_qualified']);
  });

  it('defaults plugs to an empty array when unconfigured', () => {
    expect(resolveDanceLightingConfig({ dance_party: { lighting: {} } }).plugs).toEqual([]);
  });
});

describe('DanceLightingController — disco plug on/off', () => {
  it('turns the plug ON at start (switch.turn_on)', async () => {
    const { ctrl, gateway } = makeController({
      color_strips: ['light.strip'],
      plugs: ['garage_disco_light_plug']
    });
    await ctrl.start('hh');
    expect(gateway.callService).toHaveBeenCalledWith('switch', 'turn_on',
      { entity_id: ['switch.garage_disco_light_plug'] });
  });

  it('turns the plug OFF at stop (switch.turn_off)', async () => {
    const { ctrl, gateway } = makeController({
      color_strips: ['light.strip'],
      plugs: ['garage_disco_light_plug']
    });
    await ctrl.stop('hh');
    expect(gateway.callService).toHaveBeenCalledWith('switch', 'turn_off',
      { entity_id: ['switch.garage_disco_light_plug'] });
  });

  it('still fires the plug when no color strips are configured (plugs-only)', async () => {
    const { ctrl, gateway } = makeController({ plugs: ['garage_disco_light_plug'] });
    const res = await ctrl.start('hh');
    expect(res).toMatchObject({ ok: true, started: true, plugsOnly: true });
    expect(gateway.callService).toHaveBeenCalledWith('switch', 'turn_on',
      { entity_id: ['switch.garage_disco_light_plug'] });
    // No color-strip light call when none configured.
    expect(gateway.callService).not.toHaveBeenCalledWith('light', 'turn_on', expect.anything());
  });

  it('a plug failure does not block the color strips from turning on', async () => {
    const { ctrl, gateway } = makeController({
      color_strips: ['light.strip'],
      plugs: ['garage_disco_light_plug']
    });
    gateway.callService.mockImplementation((domain) =>
      domain === 'switch' ? Promise.reject(new Error('plug offline')) : Promise.resolve({}));
    const res = await ctrl.start('hh');
    expect(res).toMatchObject({ ok: true, started: true });
    expect(gateway.callService).toHaveBeenCalledWith('light', 'turn_on',
      expect.objectContaining({ entity_id: ['light.strip'] }));
  });

  it('skips entirely when nothing (no strips, no plugs) is configured', async () => {
    const { ctrl, gateway } = makeController({});
    const res = await ctrl.start('hh');
    expect(res).toMatchObject({ ok: true, skipped: true, reason: 'lighting_not_configured' });
    expect(gateway.callService).not.toHaveBeenCalled();
  });
});
