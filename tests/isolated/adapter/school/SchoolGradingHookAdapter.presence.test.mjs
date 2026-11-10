import { describe, it, expect } from 'vitest';
import { SchoolGradingHookAdapter } from '../../../../__app_modules/learning/school/server/adapters/SchoolGradingHookAdapter.mjs';

function make({ key = 'presence_hook', block = { script: 'script.school_presence', cooldownMinutes: 5 }, ok = () => true } = {}) {
  const calls = [];
  const logs = [];
  let t = 1_000_000;
  const logger = new Proxy({}, { get: (_, level) => (event, data) => logs.push({ level, event, data }) });
  const gateway = {
    callService: async (domain, service, data) => {
      calls.push({ domain, service, data });
      return ok() ? { ok: true } : { ok: false, error: 'ha down' };
    },
  };
  const adapter = new SchoolGradingHookAdapter({
    gateway, logger, configKey: key, now: () => t,
    loadSchoolConfig: () => ({ [key]: block }),
  });
  return { adapter, calls, logs, advance: (ms) => { t += ms; } };
}
const EV = { result: 'present', source: 'card', location: 'study', device: 'portal', event: 'tap' };

describe('hook adapter cooldown + presence variables', () => {
  it('sends source/location/device/event', async () => {
    const { adapter, calls } = make();
    await adapter.fire(EV);
    expect(calls[0]).toMatchObject({ domain: 'script', service: 'school_presence' });
    expect(calls[0].data).toMatchObject({ result: 'present', source: 'card', location: 'study', device: 'portal', event: 'tap' });
  });

  it('nulls presence keys when absent', async () => {
    const { adapter, calls } = make({ key: 'grading_hook', block: { script: 'script.x' } });
    await adapter.fire({ result: 'graded' });
    expect(calls[0].data).toMatchObject({ source: null, location: null, device: null, event: null });
  });

  it('skips within the cooldown window and fires at its edge', async () => {
    const { adapter, calls, logs, advance } = make();
    await adapter.fire(EV);
    advance(5 * 60000 - 1000);
    const r = await adapter.fire(EV);
    expect(r).toEqual({ ok: true, skipped: true, reason: 'cooldown' });
    expect(calls).toHaveLength(1);
    const skip = logs.find((l) => l.event === 'school.presence_hook.skipped');
    expect(skip.data).toEqual({ reason: 'cooldown', remainingMs: 1000 });
    advance(1000);
    await adapter.fire(EV);
    expect(calls).toHaveLength(2);
  });

  it('a failed call does not arm the cooldown', async () => {
    let good = false;
    const { adapter, calls, advance } = make({ ok: () => good });
    await adapter.fire(EV);
    advance(10000);
    good = true;
    const r = await adapter.fire(EV);
    expect(r).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('no cooldownMinutes means every event fires', async () => {
    const { adapter, calls, advance } = make({ key: 'grading_hook', block: { script: 'script.x' } });
    await adapter.fire({ result: 'graded' });
    advance(1000);
    await adapter.fire({ result: 'graded' });
    expect(calls).toHaveLength(2);
  });

  it('reset logs under the instance prefix', () => {
    const { adapter, logs } = make();
    adapter.reset();
    expect(logs.some((l) => l.event === 'school.presence_hook.reset')).toBe(true);
  });

  it('concurrent fires with a pending call yield one callService; a failure releases the window', async () => {
    let release;
    const calls = [];
    const gateway = {
      callService: (d, sv, data) => { calls.push(data); return new Promise((res) => { release = res; }); },
    };
    const adapter = new SchoolGradingHookAdapter({
      gateway, logger: {}, configKey: 'presence_hook', now: () => 1_000_000,
      loadSchoolConfig: () => ({ presence_hook: { script: 'script.school_presence', cooldownMinutes: 5 } }),
    });
    const first = adapter.fire(EV);
    const second = await adapter.fire(EV);
    expect(second).toEqual({ ok: true, skipped: true, reason: 'cooldown' });
    expect(calls).toHaveLength(1);
    release({ ok: false, error: 'ha down' });
    await first;
    const third = adapter.fire(EV);
    expect(calls).toHaveLength(2);
    release({ ok: true });
    await third;
  });

  it('cooldown skip uses the rate-limited logger at maxPerMinute 2 when available, debug otherwise', async () => {
    const sampled = [];
    const debug = [];
    const mk = (logger) => new SchoolGradingHookAdapter({
      gateway: { callService: async () => ({ ok: true }) }, logger, configKey: 'presence_hook', now: () => 1_000_000,
      loadSchoolConfig: () => ({ presence_hook: { script: 'script.school_presence', cooldownMinutes: 5 } }),
    });
    const a = mk({ sampled: (e, d, o) => sampled.push({ e, d, o }), debug: (e, d) => debug.push({ e, d }) });
    await a.fire(EV);
    await a.fire(EV);
    expect(sampled).toHaveLength(1);
    expect(sampled[0].e).toBe('school.presence_hook.skipped');
    expect(sampled[0].d).toMatchObject({ reason: 'cooldown' });
    expect(sampled[0].o).toEqual({ maxPerMinute: 2, aggregate: true });
    expect(debug).toHaveLength(0);

    const b = mk({ debug: (e, d) => debug.push({ e, d }) });
    await b.fire(EV);
    await b.fire(EV);
    expect(debug).toHaveLength(1);
    expect(debug[0].d).toMatchObject({ reason: 'cooldown' });
  });

  it('two fires carrying learner_id dedupe even while resolveStudent is slow', async () => {
    let releaseLookup;
    const calls = [];
    const adapter = new SchoolGradingHookAdapter({
      gateway: { callService: async (d, sv, data) => { calls.push(data); return { ok: true }; } },
      logger: {}, configKey: 'presence_hook', now: () => 1_000_000,
      resolveStudent: () => new Promise((res) => { releaseLookup = res; }),
      loadSchoolConfig: () => ({ presence_hook: { script: 'script.school_presence', cooldownMinutes: 5 } }),
    });
    const first = adapter.fire({ ...EV, learnerId: 'kid1' });
    const second = await adapter.fire({ ...EV, learnerId: 'kid1' });
    expect(second).toEqual({ ok: true, skipped: true, reason: 'cooldown' });
    releaseLookup('Kid One');
    await first;
    expect(calls).toHaveLength(1);
    expect(calls[0].student).toBe('Kid One');
  });
});
