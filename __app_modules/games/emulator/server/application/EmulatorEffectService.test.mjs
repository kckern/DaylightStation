// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { EmulatorEffectService, normalizeEffectRegistry } from './EmulatorEffectService.mjs';

const REGISTRY = {
  min_interval_ms: 3000,
  effects: {
    underground_lights: {
      snapshot: ['light.garage_light_switch', 'light.garage_ceiling_led_strip'],
      hold_zone_lighting: true,
      max_seconds: 60,
      enter: [
        { service: 'light.turn_off', entity_id: 'light.garage_light_switch' },
        { scene: 'scene.garage_led_blue' },
      ],
      exit: [],
    },
  },
};

function harness(registry = REGISTRY) {
  let t = 1_000_000;
  const timers = [];
  const calls = [];
  const gateway = { callService: vi.fn(async (domain, service, data) => { calls.push([`${domain}.${service}`, data]); return { ok: true }; }) };
  const lightingHold = { hold: vi.fn(), release: vi.fn() };
  const svc = new EmulatorEffectService({
    readRegistry: () => registry,
    haGateway: gateway,
    lightingHold,
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; },
    clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  async function advance(ms) {
    await settle(); // let in-flight applies finish at the current time
    t += ms;
    for (;;) {
      const due = timers.filter((h) => h.at <= t).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      due.fn();
      await settle();
    }
    await settle();
  }
  return { svc, calls, gateway, lightingHold, settle, advance, timers };
}

describe('normalizeEffectRegistry', () => {
  it('drops effects with an unknown step kind or a bad entity', () => {
    const warn = vi.fn();
    const { effects } = normalizeEffectRegistry({
      effects: {
        good: { enter: [{ scene: 'scene.a' }] },
        bad_step: { enter: [{ shell: 'rm -rf' }] },
        bad_entity: { enter: [{ service: 'light.turn_off', entity_id: 'not an entity' }] },
        bad_snapshot: { snapshot: ['nope'], enter: [] },
      },
    }, { warn });
    expect([...effects.keys()]).toEqual(['good']);
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

describe('EmulatorEffectService', () => {
  it('refuses ids that are not in the registry, and bad phases', () => {
    const { svc, gateway } = harness();
    expect(svc.request('script.anything', 'enter')).toMatchObject({ ok: false, code: 'invalid_request' });
    expect(svc.request('unknown', 'enter')).toMatchObject({ ok: false, code: 'unknown_effect' });
    expect(svc.request('underground_lights', 'toggle')).toMatchObject({ ok: false, code: 'invalid_request' });
    expect(gateway.callService).not.toHaveBeenCalled();
  });

  it('enter snapshots, holds zone lighting, then runs the steps in order', async () => {
    const { svc, calls, lightingHold, settle } = harness();
    expect(svc.request('underground_lights', 'enter', { game: 'super-mario-land' })).toEqual({ ok: true, status: 'applying' });
    await settle();
    expect(lightingHold.hold).toHaveBeenCalledWith('arcade:underground_lights');
    expect(calls).toEqual([
      ['scene.create', { scene_id: 'arcade_restore_underground_lights', snapshot_entities: ['light.garage_light_switch', 'light.garage_ceiling_led_strip'] }],
      ['light.turn_off', { entity_id: 'light.garage_light_switch' }],
      ['scene.turn_on', { entity_id: 'scene.garage_led_blue' }],
    ]);
  });

  it('exit restores the snapshot and releases zone lighting', async () => {
    const { svc, calls, lightingHold, advance } = harness();
    svc.request('underground_lights', 'enter');
    await advance(5000);
    calls.length = 0;
    expect(svc.request('underground_lights', 'exit').status).toBe('applying');
    await advance(0);
    expect(calls).toEqual([['scene.turn_on', { entity_id: 'scene.arcade_restore_underground_lights' }]]);
    expect(lightingHold.release).toHaveBeenCalledWith('arcade:underground_lights');
  });

  it('a quick in-and-out inside the interval changes nothing', async () => {
    const { svc, calls, advance } = harness();
    svc.request('underground_lights', 'enter');
    await advance(0);
    const afterEnter = calls.length;
    expect(svc.request('underground_lights', 'exit').status).toBe('queued');
    expect(svc.request('underground_lights', 'enter').status).toBe('unchanged');
    await advance(5000);
    expect(calls.length).toBe(afterEnter);
  });

  it('an exit inside the interval is applied once the interval has passed', async () => {
    const { svc, calls, advance } = harness();
    svc.request('underground_lights', 'enter');
    await advance(1000);
    calls.length = 0;
    expect(svc.request('underground_lights', 'exit').status).toBe('queued');
    await advance(1000);
    expect(calls).toEqual([]);
    await advance(1500);
    expect(calls).toEqual([['scene.turn_on', { entity_id: 'scene.arcade_restore_underground_lights' }]]);
  });

  it('exits on its own after max_seconds if no exit ever arrives', async () => {
    const { svc, calls, lightingHold, advance } = harness();
    svc.request('underground_lights', 'enter');
    await advance(0);
    calls.length = 0;
    await advance(60_000);
    expect(calls).toEqual([['scene.turn_on', { entity_id: 'scene.arcade_restore_underground_lights' }]]);
    expect(lightingHold.release).toHaveBeenCalled();
    expect(svc.getStatus().underground_lights.applied).toBe('exit');
  });

  it('reports unavailable without a Home Assistant gateway', () => {
    const svc = new EmulatorEffectService({ readRegistry: () => REGISTRY, haGateway: null, setTimer: () => 0, clearTimer: () => {} });
    expect(svc.request('underground_lights', 'enter')).toMatchObject({ ok: false, code: 'unavailable' });
  });
});
