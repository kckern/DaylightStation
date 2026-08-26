/**
 * The printer reports what it knows, not what it hopes (2026-08-25 incident).
 *
 * `print()` used to resolve a bare `true` as soon as our bytes had flushed and
 * a drain timer had elapsed. The adapter already HAD `getStatus()` — paper,
 * cover and error queries over `DLE EOT` — and the print path never called it.
 * `IssueDocument` then appended `issued`, a permanent, cooldown-arming fact, on
 * that claim. One morning the printer reported success for paper that never
 * came out and a child was locked out for fifteen minutes over a receipt that
 * did not exist.
 *
 * These tests pin the claim tier: `{dispatched, verified, printerState}`, a
 * refusal that writes nothing, and a job that cannot build its content never
 * reaching the cutter.
 *
 * NOTE ON MOCKING: the transport is INJECTED via `options.createTransport`,
 * never module-mocked. `escpos-network` is CJS, so this ESM adapter's import of
 * it resolves through interop and neither `jest.mock` nor
 * `jest.unstable_mockModule` intercepts it — measured 2026-08-22, the mock
 * factory is never even invoked and the adapter opens a REAL socket to the
 * configured printer IP and prints physical paper. See the header of
 * ThermalPrinterAdapter.flush.test.mjs.
 *
 * The double must expose `read(cb)`, NOT `on('data')`: `escpos-network`'s
 * `read` attaches to the underlying socket, while its EventEmitter surface
 * never re-emits what the socket received.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { ThermalPrinterAdapter } from '#adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs';

/**
 * The live printer's actual `DLE EOT` replies, probed read-only 2026-08-25:
 * online, cover closed, no errors, paper present.
 *
 * `0x16` has BIT 2 SET. On `DLE EOT 1` that bit is the cash-drawer pin, not the
 * cover — the old decoder read it as cover-open, so a pre-flight built on it
 * would have refused every job on this healthy hardware.
 */
const HEALTHY = [0x16, 0x12, 0x12, 0x12];
const PAPER_OUT = [0x16, 0x12, 0x12, 0x72]; // bits 5+6 of DLE EOT 4 = roll end

const ESC_AT = Buffer.from([0x1b, 0x40]);       // ESC @ — job init
const AUTO_CUT = Buffer.from([0x1d, 0x56, 0x00]); // GS V 0 — the cutter

const quietLogger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });

/**
 * A transport that answers `DLE EOT` queries from a scripted sequence of reply
 * sets — one set per CONNECTION, so a job's pre-flight and its post-job read
 * can disagree (which is exactly how a roll running out mid-receipt looks).
 *
 * `openFails` makes every connection fail, standing in for a status path that
 * is simply broken.
 */
function transportFactory({ replies = [], openFails = false } = {}) {
  const connections = [];
  let nth = 0;

  const factory = (host, port) => {
    const index = nth++;
    const conn = {
      host, port, index,
      writes: [],
      closed: 0,
      onData: null,
      open(cb) {
        setImmediate(() => cb(openFails ? new Error('ECONNREFUSED') : null));
        return this;
      },
      read(cb) { this.onData = cb; return this; },
      write(data, cb) {
        this.writes.push(data);
        // A `DLE EOT n` query is answered immediately; job bytes are not.
        if (data.length === 3 && data[0] === 0x10 && data[1] === 0x04) {
          const set = replies[Math.min(index, replies.length - 1)];
          const byte = set?.[data[2] - 1];
          if (byte !== undefined) setImmediate(() => this.onData?.(Buffer.from([byte])));
        }
        if (cb) setImmediate(() => cb(null));
        return this;
      },
      close(cb) { this.closed += 1; cb && cb(null, null); return this; },
      /** Everything written on this connection, minus the status queries. */
      jobBytes() {
        return Buffer.concat(this.writes.filter(
          (w) => !(w.length === 3 && w[0] === 0x10 && w[1] === 0x04),
        ));
      },
    };
    connections.push(conn);
    return conn;
  };

  return { factory, connections };
}

function makeAdapter(createTransport, logger = quietLogger()) {
  return new ThermalPrinterAdapter(
    { host: '10.0.0.50', port: 9100, timeout: 5000, upsideDown: false },
    { logger, createTransport, statusSettleMs: 5 },
  );
}

const textJob = { items: [{ type: 'text', content: 'hello', align: 'left' }] };

describe('ThermalPrinterAdapter claim tier', () => {
  it('reports dispatched AND verified when the live healthy bytes come back', async () => {
    const { factory, connections } = transportFactory({ replies: [HEALTHY, HEALTHY] });
    const adapter = makeAdapter(factory);

    const result = await adapter.print(textJob);

    expect(result).toMatchObject({ dispatched: true, verified: true });
    expect(result.printerState).toMatchObject({
      success: true, online: true, paperPresent: true, coverOpen: false, errors: [],
    });
    // The job went out on its own connection; the post-job read used another,
    // AFTER that one was closed (this printer refuses concurrent connections).
    expect(connections[0].jobBytes().includes(ESC_AT)).toBe(true);
    expect(connections.length).toBe(2);
    expect(connections[0].closed).toBeGreaterThanOrEqual(1);
  }, 20000);

  it('decodes the healthy bytes as coverOpen FALSE — DLE EOT 1 bit 2 is the cash drawer', async () => {
    // The regression guard. `0x16 & 0x04` is set on a printer whose cover is
    // shut; decoding that as cover-open would refuse every single job.
    const { factory } = transportFactory({ replies: [HEALTHY, HEALTHY] });
    const result = await makeAdapter(factory).print(textJob);

    expect(result.printerState.coverOpen).toBe(false);
    expect(result.dispatched).toBe(true);
  }, 20000);

  it('refuses the job and writes no job bytes when pre-flight reports paper out', async () => {
    const logger = quietLogger();
    const { factory, connections } = transportFactory({ replies: [PAPER_OUT] });
    const adapter = makeAdapter(factory, logger);

    const result = await adapter.print(textJob);

    expect(result).toMatchObject({ dispatched: false, verified: false });
    expect(result.printerState).toMatchObject({ paperPresent: false });

    // Only the four DLE EOT queries went out. No init, no content, no cut —
    // and no `job.complete`, because there was no job.
    expect(connections).toHaveLength(1);
    expect(connections[0].jobBytes()).toHaveLength(0);
    expect(connections[0].writes.every((w) => w[0] === 0x10 && w[1] === 0x04)).toBe(true);
    expect(logger.info).not.toHaveBeenCalledWith('thermalPrinter.job.complete', expect.anything());
    expect(logger.warn).toHaveBeenCalledWith(
      'thermalPrinter.preflight.refused',
      expect.objectContaining({ faults: ['no_paper'] }),
    );
  }, 20000);

  it('dispatches but does NOT verify when the roll runs out during the job', async () => {
    // Healthy at pre-flight, paper-out afterwards: the only way to catch a roll
    // that ended halfway down a receipt.
    const logger = quietLogger();
    const { factory, connections } = transportFactory({ replies: [HEALTHY, PAPER_OUT] });
    const adapter = makeAdapter(factory, logger);

    const result = await adapter.print(textJob);

    expect(result).toMatchObject({ dispatched: true, verified: false });
    expect(result.printerState).toMatchObject({ paperPresent: false });
    expect(connections[0].jobBytes().includes(ESC_AT)).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      'thermalPrinter.postjob.fault',
      expect.objectContaining({ faults: ['no_paper'] }),
    );
  }, 20000);

  it('still prints when the status read fails entirely — a broken probe never strands the household', async () => {
    // Every connection fails, so nothing can be asked and nothing is known.
    // Not-knowing is not a fault: the job must still go out.
    const logger = quietLogger();
    const writes = [];
    let connects = 0;
    const factory = () => {
      const first = connects++ === 0;
      return {
        // The job's own connection lands; every status connection is refused.
        open(cb) { setImmediate(() => cb(first ? null : new Error('ECONNREFUSED'))); return this; },
        // `read` exists (so the adapter tries), but nothing ever answers.
        read() { return this; },
        write(data, cb) { writes.push(data); if (cb) setImmediate(() => cb(null)); return this; },
        close(cb) { cb && cb(null, null); return this; },
      };
    };
    const adapter = makeAdapter(factory, logger);

    const result = await adapter.print(textJob);

    expect(result.dispatched).toBe(true);
    expect(result.verified).toBe(false);
    expect(Buffer.concat(writes).includes(ESC_AT)).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      'thermalPrinter.job.complete', expect.anything(),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'thermalPrinter.postjob.unverified', expect.anything(),
    );
  }, 20000);

  it('cuts NOTHING when an item cannot be built', async () => {
    // A receipt whose image fails to load used to emit header, padding and
    // auto-cut anyway: blank paper, cut and dispensed, logged as success.
    const logger = quietLogger();
    const { factory, connections } = transportFactory({ replies: [HEALTHY, HEALTHY] });
    const adapter = makeAdapter(factory, logger);

    const result = await adapter.print({
      items: [{ type: 'image', path: '/nonexistent/receipt-that-never-rendered.png', width: 384 }],
      footer: { paddingLines: 3, autoCut: true },
    });

    expect(result).toMatchObject({ dispatched: false, verified: false });
    const written = connections[0].jobBytes();
    expect(written.includes(AUTO_CUT)).toBe(false);
    expect(written).toHaveLength(0); // the buffer is built before it is written
    expect(logger.error).toHaveBeenCalledWith(
      'thermalPrinter.processItem.error',
      expect.objectContaining({ type: 'image' }),
    );
  }, 20000);
});
