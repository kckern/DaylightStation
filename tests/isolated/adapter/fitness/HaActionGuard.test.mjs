// tests/isolated/adapter/fitness/HaActionGuard.test.mjs
import { vi } from 'vitest';
import { HaActionGuard } from '#adapters/fitness/HaActionGuard.mjs';

describe('HaActionGuard', () => {
  let guard;
  beforeEach(() => {
    guard = new HaActionGuard({ name: 'test', logger: { error: vi.fn(), debug: vi.fn() } });
  });

  test('runs the action and returns ok when it succeeds', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const r = await guard.run({ key: 'a', throttleMs: 0, action });
    expect(action).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, key: 'a' });
    expect(r.skipped).toBeFalsy();
  });

  test('skips a duplicate key without calling the action', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    await guard.run({ key: 'a', throttleMs: 0, action });
    const r = await guard.run({ key: 'a', throttleMs: 0, action });
    expect(action).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, skipped: true, reason: 'duplicate' });
  });

  test('rate-limits within the throttle window', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    await guard.run({ key: 'a', throttleMs: 60000, action });
    const r = await guard.run({ key: 'b', throttleMs: 60000, action });
    expect(action).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, skipped: true, reason: 'rate_limited' });
  });

  test('opens the circuit after maxFailures and then skips with reason backoff', async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: 'boom' });
    const g = new HaActionGuard({ name: 't', maxFailures: 2, logger: { error: vi.fn() } });
    const r1 = await g.run({ key: '1', throttleMs: 0, action });
    expect(r1.ok).toBe(false);
    const r2 = await g.run({ key: '2', throttleMs: 0, action });
    expect(r2.ok).toBe(false);
    const r3 = await g.run({ key: '3', throttleMs: 0, action });
    expect(r3).toMatchObject({ ok: true, skipped: true, reason: 'backoff' });
  });

  test('reset clears latch/backoff state', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    await guard.run({ key: 'a', throttleMs: 60000, action });
    guard.reset();
    const r = await guard.run({ key: 'a', throttleMs: 60000, action });
    expect(action).toHaveBeenCalledTimes(2);
    expect(r.skipped).toBeFalsy();
  });
});
