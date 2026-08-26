/**
 * Silence from the printer is not evidence a print failed (2026-08-25, second
 * incident — the FIX for the first one).
 *
 * The claim tier gave `print()` three honest outcomes, and `ReceiptPrinting`
 * then collapsed two of them: "the printer told me it is out of paper" and "the
 * printer told me nothing" both became `printed: false`. Probed on the live
 * hardware the same day, the post-job read answers 2 of 4 queries on the first
 * connection and TIMES OUT on the second — so "told me nothing" is the NORMAL
 * case, and every real print reported failure. A child was told their worksheet
 * had not printed while it sat in the tray, and because the failure path skips
 * the cooldown, tapping again reprinted it.
 *
 * These tests wire the REAL adapter to the REAL `ReceiptPrinting` and pin the
 * full mapping end to end, because the defect lived in neither unit alone — it
 * lived in what the adapter's return shape failed to carry across the seam.
 *
 * NOTE ON MOCKING: the transport is INJECTED via `options.createTransport`,
 * never module-mocked. `escpos-network` is CJS, so this ESM adapter's import of
 * it resolves through interop and neither `jest.mock` nor
 * `jest.unstable_mockModule` intercepts it — the mock factory is never invoked
 * and the adapter opens a REAL socket to the configured printer IP and prints
 * physical paper. The double must expose `read(cb)`, NOT `on('data')`.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { ThermalPrinterAdapter } from '#adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs';
import { ReceiptPrinting } from '#apps/school/ReceiptPrinting.mjs';

/** The live printer's `DLE EOT` replies, probed read-only 2026-08-25. */
const HEALTHY = [0x16, 0x12, 0x12, 0x12];
const PAPER_OUT = [0x16, 0x12, 0x12, 0x72]; // bits 5+6 of DLE EOT 4 = roll end

const ESC_AT = Buffer.from([0x1b, 0x40]); // ESC @ — job init

const quietLogger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });

const DOCUMENT = { id: 'agenda-felix', target: ['receipt'] };
const JOB = { items: [{ type: 'text', content: 'Your list', align: 'left' }] };

/**
 * @param {object} opts
 * @param {number[][]} [opts.replies] one reply set per CONNECTION, so a job's
 *   pre-flight and its post-job read can disagree.
 * @param {number[]} [opts.mute] connection indexes that answer NOTHING — the
 *   observed behaviour of the real post-job read.
 */
function transportFactory({ replies = [], mute = [] } = {}) {
  const connections = [];
  let nth = 0;

  const factory = (host, port) => {
    const index = nth++;
    const conn = {
      host, port, index,
      writes: [],
      closed: 0,
      onData: null,
      open(cb) { setImmediate(() => cb(null)); return this; },
      read(cb) { this.onData = cb; return this; },
      write(data, cb) {
        this.writes.push(data);
        const isQuery = data.length === 3 && data[0] === 0x10 && data[1] === 0x04;
        if (isQuery && !mute.includes(index)) {
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

function wire(createTransport, logger = quietLogger()) {
  const printer = new ThermalPrinterAdapter(
    { host: '10.0.0.50', port: 9100, timeout: 5000, upsideDown: false },
    { logger, createTransport, statusSettleMs: 5 },
  );
  const renderer = { render: jest.fn(async () => ({ ...JOB })) };
  return { receipts: new ReceiptPrinting({ renderer, printer, logger }), logger };
}

describe('ReceiptPrinting over the real claim tier', () => {
  it('reports PRINTED when the post-job status cannot be read at all', async () => {
    // THE REGRESSION TEST. The job's own connection answers (pre-flight passes,
    // bytes go out); every post-job connection stays silent, which is what the
    // live printer actually does. No answer is not a fault — the paper is in
    // the tray and the child must not be told otherwise.
    const { factory, connections } = transportFactory({
      replies: [HEALTHY, HEALTHY, HEALTHY],
      mute: [1, 2],
    });
    const { receipts, logger } = wire(factory);

    const outcome = await receipts.print(DOCUMENT);

    expect(outcome).toEqual({ printed: true, reason: 'unverified' });
    expect(connections[0].jobBytes().includes(ESC_AT)).toBe(true);
    // The silence stays visible even though the print counts.
    expect(logger.warn).toHaveBeenCalledWith(
      'school.receipt.unverified', expect.objectContaining({ id: 'agenda-felix' }),
    );
  }, 20000);

  it('reports NOT printed when the roll runs out during the job', async () => {
    // Healthy at pre-flight, paper-out afterwards. The printer TOLD us it
    // failed — the genuine-failure path, and the only way to catch a roll that
    // ended halfway down a receipt.
    const { factory } = transportFactory({ replies: [HEALTHY, PAPER_OUT] });
    const { receipts, logger } = wire(factory);

    const outcome = await receipts.print(DOCUMENT);

    expect(outcome).toEqual({ printed: false, reason: 'printer_fault' });
    expect(logger.warn).toHaveBeenCalledWith(
      'school.receipt.printer-fault',
      expect.objectContaining({ id: 'agenda-felix', faults: ['no_paper'] }),
    );
  }, 20000);

  it('reports NOT printed and writes no bytes when pre-flight refuses', async () => {
    const { factory, connections } = transportFactory({ replies: [PAPER_OUT] });
    const { receipts, logger } = wire(factory);

    const outcome = await receipts.print(DOCUMENT);

    expect(outcome).toEqual({ printed: false, reason: 'printer_refused' });
    expect(connections).toHaveLength(1);
    expect(connections[0].jobBytes()).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      'school.receipt.refused', expect.objectContaining({ id: 'agenda-felix' }),
    );
  }, 20000);

  it('reports PRINTED with no reason when the printer answers healthy throughout', async () => {
    const { factory } = transportFactory({ replies: [HEALTHY, HEALTHY] });
    const { receipts, logger } = wire(factory);

    const outcome = await receipts.print(DOCUMENT);

    expect(outcome).toEqual({ printed: true, reason: null });
    expect(logger.warn).not.toHaveBeenCalledWith(
      'school.receipt.unverified', expect.anything(),
    );
  }, 20000);
});
