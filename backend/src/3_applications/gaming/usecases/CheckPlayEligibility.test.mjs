import { describe, it, expect } from 'vitest';
import { CheckPlayEligibility } from './CheckPlayEligibility.mjs';

const quiet = { info() {}, warn() {} };
const tue16 = () => new Date('2026-09-15T16:00:00');
const build = (over = {}) => new CheckPlayEligibility({ now: tue16, logger: quiet, ...over });

describe('CheckPlayEligibility', () => {
  it('allows play when nothing is configured', async () => {
    expect(await build().execute({})).toEqual({ allowed: true, reasons: [] });
  });

  it('applies the household policy', async () => {
    const c = build({ policyFor: async () => ({ windows: [{ days: ['sat'] }] }) });
    expect((await c.execute({})).reasons).toContain('outside_play_window');
  });

  it('consults assertions about the person', async () => {
    const policy = async () => ({ requires: ['school-day-complete'] });
    const blocked = build({ policyFor: policy, assertionsFor: async () => [] });
    expect((await blocked.execute({ userId: 'child' })).allowed).toBe(false);
    const done = build({ policyFor: policy, assertionsFor: async () => ['school-day-complete'] });
    expect((await done.execute({ userId: 'child' })).allowed).toBe(true);
  });

  it('refuses new play on a device the meter cannot see', async () => {
    const c = build({ isBlocked: (d) => d === 'tv' });
    const r = await c.execute({ deviceId: 'tv' });
    expect(r.allowed).toBe(false);
    expect(r.reasons).toContain('device_unobservable');
  });

  it('counts controllers for a group title', async () => {
    const c = build({
      policyFor: async () => ({ titles: { 'x:1': { min_players: 2 } } }),
      controllersFor: async () => 1,
    });
    expect((await c.execute({ contentId: 'x:1' })).reasons).toContain('needs_2_controllers');
  });
});

describe('CheckPlayEligibility — an input we cannot gather is not a refusal', () => {
  it('still allows play when the policy source fails', async () => {
    const c = build({ policyFor: async () => { throw new Error('config down'); } });
    expect((await c.execute({})).allowed).toBe(true);
  });

  it('still allows play when the assertion source fails', async () => {
    const c = build({
      policyFor: async () => ({ requires: [] }),
      assertionsFor: async () => { throw new Error('gates down'); },
    });
    expect((await c.execute({ userId: 'child' })).allowed).toBe(true);
  });

  it('does not refuse on controllers it could not count', async () => {
    const c = build({
      policyFor: async () => ({ titles: { 'x:1': { min_players: 2 } } }),
      controllersFor: async () => { throw new Error('adb gone'); },
    });
    expect((await c.execute({ contentId: 'x:1' })).allowed).toBe(true);
  });

  it('but a blocked device still refuses, because that hole must stay closed', async () => {
    const c = build({
      policyFor: async () => { throw new Error('config down'); },
      isBlocked: () => true,
    });
    expect((await c.execute({ deviceId: 'tv' })).allowed).toBe(false);
  });
});
