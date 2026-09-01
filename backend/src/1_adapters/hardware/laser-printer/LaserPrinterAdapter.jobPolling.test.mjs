import { afterEach, describe, expect, it, vi } from 'vitest';
import { LaserPrinterAdapter } from './LaserPrinterAdapter.mjs';

/** Build an IPP response carrying one job-attributes group. */
function ippJobResponse({ state, reasons = ['none'], impressions = 1 }) {
  const parts = [Buffer.from([0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01])];
  parts.push(Buffer.from([0x02])); // job-attributes group
  const attr = (tag, name, valueBuf) => Buffer.concat([
    Buffer.from([tag]),
    (() => { const b = Buffer.alloc(2); b.writeUInt16BE(name.length); return b; })(),
    Buffer.from(name),
    (() => { const b = Buffer.alloc(2); b.writeUInt16BE(valueBuf.length); return b; })(),
    valueBuf,
  ]);
  const int32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
  parts.push(attr(0x23, 'job-state', int32(state)));                       // ENUM
  for (const r of reasons) parts.push(attr(0x44, 'job-state-reasons', Buffer.from(r)));
  parts.push(attr(0x21, 'job-impressions-completed', int32(impressions))); // INTEGER
  parts.push(Buffer.from([0x03]));
  return Buffer.concat(parts);
}

function stubFetch(buffer) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => buffer.buffer.slice(
      buffer.byteOffset, buffer.byteOffset + buffer.byteLength,
    ),
  }));
}

afterEach(() => { delete globalThis.fetch; });

describe('getJobState', () => {
  it('reads a completed job', async () => {
    stubFetch(ippJobResponse({ state: 9, reasons: ['job-completed-successfully'], impressions: 1 }));
    const adapter = new LaserPrinterAdapter({ host: '127.0.0.1', port: 631 });
    await expect(adapter.getJobState(42)).resolves.toEqual({
      state: 9,
      classification: 'completed',
      stateReasons: ['job-completed-successfully'],
      impressionsCompleted: 1,
    });
  });

  it('reads a still-processing job as pending', async () => {
    stubFetch(ippJobResponse({ state: 5, reasons: ['job-printing'], impressions: 0 }));
    const adapter = new LaserPrinterAdapter({ host: '127.0.0.1', port: 631 });
    const result = await adapter.getJobState(42);
    expect(result.classification).toBe('pending');
    expect(result.state).toBe(5);
  });
});

describe('awaitJobOutcome', () => {
  const noSleep = async () => {};

  it('returns completed once the printer reports a terminal success', async () => {
    const adapter = new LaserPrinterAdapter({ host: '127.0.0.1', port: 631 });
    const states = [5, 5, 9];
    adapter.getJobState = vi.fn(async () => {
      const state = states.shift();
      return {
        state,
        classification: state === 9 ? 'completed' : 'pending',
        stateReasons: [], impressionsCompleted: state === 9 ? 1 : 0,
      };
    });
    const result = await adapter.awaitJobOutcome(42, { deadlineMs: 10000, intervalMs: 1, sleep: noSleep });
    expect(result.outcome).toBe('completed');
    expect(result.polls).toBe(3);
  });

  it('returns failed on an aborted job', async () => {
    const adapter = new LaserPrinterAdapter({ host: '127.0.0.1', port: 631 });
    adapter.getJobState = vi.fn(async () => ({
      state: 8, classification: 'failed', stateReasons: ['job-canceled-by-system'], impressionsCompleted: 0,
    }));
    const result = await adapter.awaitJobOutcome(42, { deadlineMs: 10000, intervalMs: 1, sleep: noSleep });
    expect(result.outcome).toBe('failed');
    expect(result.stateReasons).toEqual(['job-canceled-by-system']);
  });

  it('returns INDETERMINATE, not failed, when the deadline passes without a terminal state', async () => {
    const adapter = new LaserPrinterAdapter({ host: '127.0.0.1', port: 631 });
    adapter.getJobState = vi.fn(async () => ({
      state: 5, classification: 'pending', stateReasons: ['job-printing'], impressionsCompleted: 0,
    }));
    let now = 0;
    const result = await adapter.awaitJobOutcome(42, {
      deadlineMs: 50, intervalMs: 10, sleep: noSleep, clock: () => { now += 10; return now; },
    });
    expect(result.outcome).toBe('indeterminate');
    expect(result.state).toBe(5);
  });

  it('returns INDETERMINATE, not failed, when the printer stops answering', async () => {
    const adapter = new LaserPrinterAdapter({ host: '127.0.0.1', port: 631 });
    adapter.getJobState = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    let now = 0;
    const result = await adapter.awaitJobOutcome(42, {
      deadlineMs: 30, intervalMs: 10, sleep: noSleep, clock: () => { now += 10; return now; },
    });
    expect(result.outcome).toBe('indeterminate');
  });

  it('is indeterminate for a null job id rather than pretending to poll', async () => {
    const adapter = new LaserPrinterAdapter({ host: '127.0.0.1', port: 631 });
    const result = await adapter.awaitJobOutcome(null, { sleep: noSleep });
    expect(result.outcome).toBe('indeterminate');
    expect(result.polls).toBe(0);
  });

  it('warns on the FIRST poll error for a job, then only debugs on later errors for that same job', async () => {
    const warn = vi.fn();
    const debug = vi.fn();
    const adapter = new LaserPrinterAdapter({ host: '127.0.0.1', port: 631, logger: { warn, debug } });
    adapter.getJobState = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    let now = 0;
    // Four poll ticks before the deadline — enough to see error #1 (warn)
    // followed by errors #2-4 (debug only, no additional warn).
    const result = await adapter.awaitJobOutcome(42, {
      deadlineMs: 35, intervalMs: 10, sleep: noSleep, clock: () => { now += 10; return now; },
    });
    expect(result.outcome).toBe('indeterminate');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('laser-printer.job-outcome-poll-error');
    expect(warn.mock.calls[0][1]).toMatchObject({ jobId: 42, poll: 1, error: 'ECONNREFUSED' });
    expect(debug.mock.calls.length).toBeGreaterThan(0);
    expect(debug.mock.calls.every(([, data]) => data.poll > 1)).toBe(true);
  });
});
