/**
 * The write/close contract (2026-08-22 incident).
 *
 * The adapter used to `device.write(commands)` and then close on a fixed
 * 1000 ms timer. Two facts make that lossy: `escpos-network`'s `write` takes a
 * flush callback that was being discarded, and its `close` is a
 * `socket.destroy()` — so anything still queued when the timer fired was
 * thrown away. A long receipt truncated mid-raster, and because the printer was
 * left counting bitmap bytes it ate the NEXT job's `ESC @` and rendered that
 * one horizontally shifted.
 *
 * These tests pin the contract: never close before the flush callback, never
 * report success for a write that failed.
 *
 * `print()` resolves a claim tier — `{dispatched, verified, printerState}` —
 * rather than a bare boolean (2026-08-25); the transports here are write-only
 * (no `read`), so the printer is never asked anything and `verified` is always
 * false. What these tests assert is `dispatched`, which is the same claim the
 * old boolean made.
 *
 * NOTE ON MOCKING: the transport is INJECTED via `options.createTransport`,
 * not module-mocked. `escpos-network` is CJS, so this ESM adapter's import of
 * it resolves through interop and neither `jest.mock` (unavailable — these test
 * files are native ESM) nor `jest.unstable_mockModule` intercepts it. Measured
 * 2026-08-22: the mock factory is never even invoked, and the adapter opens a
 * REAL socket to the configured printer IP and prints. Do not "simplify" this
 * back to a module mock — the failure is silent and it wastes paper.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ThermalPrinterAdapter } from '#adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs';

const mockWriteCalls = [];
const mockCloseCalls = [];

class MockNetwork {
  static built = 0;

  constructor(host, port) {
    MockNetwork.built += 1;
    this.host = host;
    this.port = port;
  }

  open(cb) { setImmediate(() => cb(null)); return this; }

  // Holds the callback so a test can assert what happened BEFORE the flush.
  write(data, cb) { mockWriteCalls.push({ data, cb }); return this; }

  close(cb) { mockCloseCalls.push(Date.now()); cb && cb(null, null); return this; }
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const quietLogger = () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() });

function makeAdapter(logger) {
  return new ThermalPrinterAdapter(
    { host: '10.0.0.50', port: 9100, timeout: 5000 },
    { logger, createTransport: (host, port) => new MockNetwork(host, port) },
  );
}

const textJob = { items: [{ type: 'text', content: 'hello', align: 'left' }] };

/** The adapter waits 500ms between queued jobs before it opens/writes. */
const PAST_QUEUE_DELAY = 800;

describe('ThermalPrinterAdapter flush contract', () => {
  beforeEach(() => {
    mockWriteCalls.length = 0;
    mockCloseCalls.length = 0;
    MockNetwork.built = 0;
  });

  it('uses the mocked transport (guards against writing to a real printer)', async () => {
    const adapter = makeAdapter(quietLogger());
    const printing = adapter.print(textJob);
    await settle(PAST_QUEUE_DELAY);

    expect(MockNetwork.built).toBe(1);

    mockWriteCalls[0].cb(null);
    await printing;
  });

  it('passes a callback to write — the flush signal must not be discarded', async () => {
    const adapter = makeAdapter(quietLogger());
    const printing = adapter.print(textJob);
    await settle(PAST_QUEUE_DELAY);

    expect(mockWriteCalls.length).toBe(1);
    expect(typeof mockWriteCalls[0].cb).toBe('function');

    mockWriteCalls[0].cb(null);
    await printing;
  });

  it('does NOT close the socket until the write flush callback fires', async () => {
    const adapter = makeAdapter(quietLogger());
    const printing = adapter.print(textJob);
    await settle(PAST_QUEUE_DELAY);

    // The bytes are still in flight. Closing here is precisely what used to
    // discard the tail of a long receipt.
    expect(mockCloseCalls.length).toBe(0);

    mockWriteCalls[0].cb(null);
    await printing;
    expect(mockCloseCalls.length).toBe(1);
  });

  it('reports NOT dispatched when the write fails instead of reporting a phantom success', async () => {
    const logger = quietLogger();
    const adapter = makeAdapter(logger);
    const printing = adapter.print(textJob);
    await settle(PAST_QUEUE_DELAY);

    mockWriteCalls[0].cb(new Error('EPIPE'));
    await expect(printing).resolves.toMatchObject({ dispatched: false, verified: false });

    const completed = logger.info.mock.calls.some(([e]) => e === 'thermalPrinter.job.complete');
    expect(completed).toBe(false);
  });

  it('logs the payload size on completion so a bad print can be tied to a big job', async () => {
    const logger = quietLogger();
    const adapter = makeAdapter(logger);
    const printing = adapter.print(textJob);
    await settle(PAST_QUEUE_DELAY);

    mockWriteCalls[0].cb(null);
    await printing;

    const complete = logger.info.mock.calls.find(([e]) => e === 'thermalPrinter.job.complete');
    expect(complete).toBeDefined();
    expect(complete[1].bytes).toBeGreaterThan(0);
    expect(complete[1].drainMs).toBeGreaterThan(0);
  });

  it('does NOT pad a healthy job — the resync tax is only paid after a failure', async () => {
    const adapter = makeAdapter(quietLogger());
    const printing = adapter.print(textJob);
    await settle(PAST_QUEUE_DELAY);
    const first = mockWriteCalls[0].data;
    // ESC @ leads the stream when nothing went wrong before it.
    expect([first[0], first[1]]).toEqual([0x1b, 0x40]);
    mockWriteCalls[0].cb(null);
    await printing;
  });

  it('prepends a NUL resync pad on the job AFTER an unclean one', async () => {
    const logger = quietLogger();
    const adapter = makeAdapter(logger);

    const failing = adapter.print(textJob);
    await settle(PAST_QUEUE_DELAY);
    mockWriteCalls[0].cb(new Error('EPIPE'));
    await expect(failing).resolves.toMatchObject({ dispatched: false });

    const next = adapter.print(textJob);
    await settle(PAST_QUEUE_DELAY);
    const data = mockWriteCalls[1].data;

    expect(data[0]).toBe(0x00);                       // pad first, not ESC @
    const escAt = data.indexOf(Buffer.from([0x1b, 0x40]));
    expect(escAt).toBeGreaterThan(0);                 // init follows the pad
    expect(data.subarray(0, escAt).every((b) => b === 0x00)).toBe(true);

    mockWriteCalls[1].cb(null);
    await next;

    // ...and the pad is not paid twice.
    const third = adapter.print(textJob);
    await settle(PAST_QUEUE_DELAY);
    expect(mockWriteCalls[2].data[0]).toBe(0x1b);
    mockWriteCalls[2].cb(null);
    await third;
  });

  it('scales the drain window with payload size rather than using a constant', async () => {
    const logger = quietLogger();
    const adapter = makeAdapter(logger);

    const big = { items: [{ type: 'text', content: 'x'.repeat(60_000), align: 'left' }] };
    const printing = adapter.print(big);
    await settle(PAST_QUEUE_DELAY);
    mockWriteCalls[0].cb(null);
    await printing;

    const complete = logger.info.mock.calls.find(([e]) => e === 'thermalPrinter.job.complete');
    // A 60KB job must wait materially longer than the old fixed 1000ms.
    expect(complete[1].drainMs).toBeGreaterThan(1000);
  });
});
