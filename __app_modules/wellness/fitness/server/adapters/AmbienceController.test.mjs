// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { AmbienceController } from "./AmbienceController.mjs";
import { AmbientLedAdapter } from "./AmbientLedAdapter.mjs";

const silentLogger = { info(){}, warn(){}, error(){}, debug(){} };

const halloween = {
  type: 'ambience',
  name: 'Halloween',
  dates: ['10-31'],
  target: { id: 'halloween', video: 'plex:774715', playlist: 'plex:774714', ha_script: 'script.garage_led_halloween' }
};

function makeController({ items = [halloween], result = { ok: true } } = {}) {
  const gateway = { callService: vi.fn().mockResolvedValue(result) };
  const ctrl = new AmbienceController({
    gateway,
    loadFitnessConfig: () => ({ plex: { nav_items: items } }),
    logger: silentLogger
  });
  return { ctrl, gateway };
}

describe('AmbienceController', () => {
  it('starts the configured HA script with command: start', async () => {
    const { ctrl, gateway } = makeController();
    const res = await ctrl.start('hh', 'halloween');
    expect(res.ok).toBe(true);
    expect(gateway.callService).toHaveBeenCalledWith('script', 'turn_on',
      { entity_id: 'script.garage_led_halloween', variables: { command: 'start' } });
    expect(ctrl.isActive()).toBe(true);
  });

  it('stops with command: stop and clears the active flag', async () => {
    const { ctrl, gateway } = makeController();
    await ctrl.start('hh', 'halloween');
    await ctrl.stop('hh', 'halloween');
    expect(gateway.callService).toHaveBeenLastCalledWith('script', 'turn_on',
      { entity_id: 'script.garage_led_halloween', variables: { command: 'stop' } });
    expect(ctrl.isActive()).toBe(false);
  });

  it('refuses an id with no ambience nav item, calling nothing', async () => {
    const { ctrl, gateway } = makeController();
    const res = await ctrl.start('hh', 'not-configured');
    expect(res).toEqual({ ok: false, reason: 'unknown_ambience' });
    expect(gateway.callService).not.toHaveBeenCalled();
    expect(ctrl.isActive()).toBe(false);
  });

  it('only matches type: ambience items', async () => {
    const lookalike = { type: 'module_direct', target: { id: 'halloween', ha_script: 'script.other' } };
    const { ctrl, gateway } = makeController({ items: [lookalike] });
    expect((await ctrl.start('hh', 'halloween')).reason).toBe('unknown_ambience');
    expect(gateway.callService).not.toHaveBeenCalled();
  });

  it('reports a gateway { ok: false } as ha_error', async () => {
    const { ctrl } = makeController({ result: { ok: false, error: 'boom' } });
    expect(await ctrl.start('hh', 'halloween')).toEqual({ ok: false, reason: 'ha_error', error: 'boom' });
  });

  it('skips the HA call when the item names no script', async () => {
    const noScript = { ...halloween, target: { ...halloween.target, ha_script: undefined } };
    const { ctrl, gateway } = makeController({ items: [noScript] });
    expect((await ctrl.start('hh', 'halloween')).reason).toBe('no_ha_script');
    expect(gateway.callService).not.toHaveBeenCalled();
  });
});

describe('AmbientLedAdapter — stands down while an ambience runs', () => {
  it('skips zone scenes when isSuppressed() is true', async () => {
    const gateway = { callService: vi.fn(), activateScene: vi.fn().mockResolvedValue({ ok: true }), getState: vi.fn() };
    const adapter = new AmbientLedAdapter({
      gateway,
      loadFitnessConfig: () => ({ ambient_led: { scenes: { off: 'garage_led_off', hot: 'garage_led_orange' } } }),
      logger: silentLogger,
      isSuppressed: () => true
    });
    const res = await adapter.syncZone({ zones: [{ zoneId: 'hot', isActive: true }], householdId: 'hh' });
    expect(res).toMatchObject({ ok: true, skipped: true, reason: 'ambience_active' });
    expect(gateway.activateScene).not.toHaveBeenCalled();
  });
});
