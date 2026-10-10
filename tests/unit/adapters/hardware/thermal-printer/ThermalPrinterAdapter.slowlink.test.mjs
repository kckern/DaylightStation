/**
 * A printer that answers, but too late, is not fit to carry a raster
 * (2026-10-10 incident).
 *
 * A learner's agenda went to a printer whose link was swinging 16–1455 ms RTT. The
 * pre-flight got none of its four `DLE EOT` replies in the normal window, the
 * 225 KB raster was written anyway, and metres of it came out as text.
 *
 * Pinned here: a silent pre-flight keeps listening; replies that arrive only
 * after the normal window refuse the job with ZERO job bytes written; replies
 * inside the window print with no extra wait. Total silence is still
 * "unknown" and prints — see the claim-tier suite.
 *
 * Transport is INJECTED, never module-mocked — see the header of
 * ThermalPrinterAdapter.claimtier.test.mjs for why that matters (real paper).
 */
import { describe, it, expect, jest } from '@jest/globals';
import { ThermalPrinterAdapter } from '#adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs';

const HEALTHY = [0x16, 0x12, 0x12, 0x12];
const ESC_AT = Buffer.from([0x1b, 0x40]);
const quietLogger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });

/**
 * Each `DLE EOT` query is answered after `delayFor(nthQuery)` ms, or never
 * when that returns null.
 */
function delayedTransport(delayFor) {
  const connections = [];
  const factory = () => {
    let asked = 0;
    const conn = {
      writes: [],
      onData: null,
      open(cb) { setImmediate(() => cb(null)); return this; },
      read(cb) { this.onData = cb; return this; },
      write(data, cb) {
        this.writes.push(data);
        if (data.length === 3 && data[0] === 0x10 && data[1] === 0x04) {
          const delay = delayFor(asked++);
          const byte = HEALTHY[data[2] - 1];
          if (delay !== null) setTimeout(() => this.onData?.(Buffer.from([byte])), delay);
        }
        if (cb) setImmediate(() => cb(null));
        return this;
      },
      close(cb) { cb && cb(null, null); return this; },
      jobBytes() {
        return Buffer.concat(this.writes.filter((w) => !(w.length === 3 && w[0] === 0x10 && w[1] === 0x04)));
      },
    };
    connections.push(conn);
    return conn;
  };
  return { factory, connections };
}

const makeAdapter = (createTransport, logger) => new ThermalPrinterAdapter(
  { host: '10.0.0.50', port: 9100, timeout: 5000, upsideDown: false },
  { logger, createTransport, statusSettleMs: 5 },
);
const textJob = { items: [{ type: 'text', content: 'hello', align: 'left' }] };

describe('ThermalPrinterAdapter slow-link pre-flight', () => {
  it('refuses the job, writing no job bytes, when replies only arrive after the normal window', async () => {
    const logger = quietLogger();
    // Every reply takes 1.2 s — tonight's link.
    const { factory, connections } = delayedTransport(() => 1200);

    const result = await makeAdapter(factory, logger).print(textJob);

    expect(result).toMatchObject({ dispatched: false, verified: false, verification: 'faulted' });
    expect(result.faults).toEqual(['link_slow']);
    expect(connections[0].jobBytes()).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalledWith('thermalPrinter.job.complete', expect.anything());
    expect(logger.warn).toHaveBeenCalledWith(
      'thermalPrinter.preflight.refused', expect.objectContaining({ faults: ['link_slow'] }),
    );
  }, 20000);

  it('prints a slow-ish but in-window pre-flight without waiting out the late grace', async () => {
    // 150 ms per reply — the 1-of-4 answers this printer gives on a mediocre day.
    const { factory, connections } = delayedTransport(() => 150);
    const started = Date.now();

    const result = await makeAdapter(factory, quietLogger()).print(textJob);

    expect(result.dispatched).toBe(true);
    expect(connections[0].jobBytes().includes(ESC_AT)).toBe(true);
    expect(Date.now() - started).toBeLessThan(2500);
  }, 20000);

  it('still prints when nothing answers even through the late grace — unknown is not a fault', async () => {
    const { factory, connections } = delayedTransport(() => null);

    const result = await makeAdapter(factory, quietLogger()).print(textJob);

    expect(result.dispatched).toBe(true);
    expect(connections[0].jobBytes().includes(ESC_AT)).toBe(true);
  }, 20000);
});
