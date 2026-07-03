import { describe, it, expect, vi } from 'vitest';
import { saveRaceRecord } from './saveRaceRecord.js';

const RECORD = { race: { id: '20260701080000' }, participants: {} };
const okResp = { ok: true, status: 200 };
const failResp = { ok: false, status: 500 };
const noSleep = () => Promise.resolve();

describe('saveRaceRecord', () => {
  it('resolves ok on first success without retrying', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResp);
    const result = await saveRaceRecord({ record: RECORD, fetchFn, sleep: noSleep });
    expect(result).toEqual({ ok: true, attempt: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/v1/fitness/cycle-races');
    expect(JSON.parse(opts.body)).toEqual({ record: RECORD });
  });

  it('retries transient failures with backoff and succeeds', async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(failResp)
      .mockResolvedValueOnce(okResp);
    const sleep = vi.fn(noSleep);
    const onAttempt = vi.fn();
    const result = await saveRaceRecord({ record: RECORD, fetchFn, sleep, onAttempt, backoffMs: [10, 30] });
    expect(result).toEqual({ ok: true, attempt: 3 });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([10, 30]);
    expect(onAttempt).toHaveBeenCalledTimes(2); // only failed attempts report
    expect(onAttempt.mock.calls[0][0]).toMatchObject({ attempt: 1, error: 'network down' });
    expect(onAttempt.mock.calls[1][0]).toMatchObject({ attempt: 2, error: 'http_500' });
  });

  it('gives up after the attempt budget and reports the last error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(failResp);
    const result = await saveRaceRecord({ record: RECORD, fetchFn, sleep: noSleep, attempts: 3 });
    expect(result).toEqual({ ok: false, attempt: 3, error: 'http_500' });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('does not sleep after the final attempt', async () => {
    const fetchFn = vi.fn().mockResolvedValue(failResp);
    const sleep = vi.fn(noSleep);
    await saveRaceRecord({ record: RECORD, fetchFn, sleep, attempts: 2, backoffMs: [10, 30] });
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
