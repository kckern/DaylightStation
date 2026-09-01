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
