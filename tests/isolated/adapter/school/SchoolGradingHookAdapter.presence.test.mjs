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
});
