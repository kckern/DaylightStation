/**
 * A timed-out job must be ABANDONED, not merely reported (2026-08-25 incident).
 *
 * The timer used to call `resolve(false)` and nothing else. The pending
 * `device.open` stayed live, so when the connection finally landed the whole
 * job body ran — against a scratch PNG that ReceiptPrinting's `finally` had
 * already deleted. The printer got headers + footer + cut and no raster: blank
 * paper, auto-cut, while the caller had been told the print was refused.
 *
 * NOTE ON MOCKING: the transport is INJECTED via `options.createTransport`,
 * never module-mocked. `escpos-network` is CJS and a module mock is silently
 * bypassed — the adapter then opens a REAL socket and prints. See the header of
 * ThermalPrinterAdapter.flush.test.mjs.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ThermalPrinterAdapter } from '#adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs';

/** A transport whose connect NEVER completes on its own — the test fires it. */
class LateNetwork {
  static instances = [];

  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.writes = [];
    this.closeCount = 0;
    this.openCb = null;
    LateNetwork.instances.push(this);
  }

  open(cb) { this.openCb = cb; return this; }            // deliberately never auto-fires
  write(data, cb) { this.writes.push(data); cb && cb(null); return this; }
  close(cb) { this.closeCount += 1; cb && cb(null, null); return this; }
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const quietLogger = () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() });

/** The adapter waits 500ms between queued jobs before it opens. */
const PAST_QUEUE_DELAY = 800;
const SHORT_TIMEOUT = 300;

function makeAdapter(logger) {
  return new ThermalPrinterAdapter(
    { host: '10.0.0.50', port: 9100, timeout: SHORT_TIMEOUT },
    { logger, createTransport: (host, port) => new LateNetwork(host, port) },
  );
}

const textJob = { items: [{ type: 'text', content: 'hello', align: 'left' }] };

describe('ThermalPrinterAdapter abort-on-timeout contract', () => {
  beforeEach(() => { LateNetwork.instances.length = 0; });

  it('destroys the socket when the connect times out', async () => {
    const adapter = makeAdapter(quietLogger());
    const printing = adapter.print(textJob);

    await expect(printing).resolves.toBe(false);

    const socket = LateNetwork.instances[0];
    expect(socket.closeCount).toBeGreaterThanOrEqual(1);
  });

  it('writes NOTHING if the connect lands after the timeout', async () => {
    const logger = quietLogger();
    const adapter = makeAdapter(logger);
    const printing = adapter.print(textJob);

    expect(await printing).toBe(false);

    // The connection finally lands, long after we gave up.
    const socket = LateNetwork.instances[0];
    socket.openCb(null);
    await settle(200);

    // THE BUG: previously this ran the whole job and cut blank paper.
    expect(socket.writes).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalledWith(
      'thermalPrinter.job.complete', expect.anything(),
    );
  });

  it('logs the late connect rather than swallowing it', async () => {
    const logger = quietLogger();
    const adapter = makeAdapter(logger);
    await adapter.print(textJob);

    LateNetwork.instances[0].openCb(null);
    await settle(200);

    expect(logger.warn).toHaveBeenCalledWith(
      'thermalPrinter.open.after-abort',
      expect.objectContaining({ target: '10.0.0.50:9100' }),
    );
  });
});
