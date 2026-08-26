/**
 * The post-job status read must be bounded to SECONDS, not the 20s connect
 * guard (2026-08-25 follow-up incident).
 *
 * `getStatus()` used to inherit `this.#timeout` unconditionally — the 20s
 * guard that exists so a JOB's own connect survives the ~11.5s post-`destroy()`
 * lockout this printer was observed to enforce. A post-job STATUS read is not
 * a job the household is waiting on: the paper is already in the tray, and a
 * hung status connection (probed read-only 2026-08-25: up to ~42s) sat in
 * front of the NEXT queued job, doubled by the old 2-attempt retry.
 *
 * These tests pin:
 *   1. A post-job status read against a transport whose connect never
 *      completes gives up in ~`POST_JOB_STATUS_TIMEOUT_MS`, not ~20s, and the
 *      job still resolves `dispatched: true` / `verification: 'unreadable'`
 *      (unreadable is not evidence of failure — see ThermalPrinterAdapter's
 *      `print()` doc comment and the 7b4727ece incident it fixed).
 *   2. `getStatus()` called directly with NO explicit timeout still honours
 *      the adapter's full configured connect timeout — the regression guard
 *      that matters most, since a job's own post-destroy lockout protection
 *      must not be weakened by this change.
 *   3. Only ONE post-job attempt is made (POST_JOB_STATUS_ATTEMPTS was
 *      lowered from 2 to 1 in the same change) — a second connection is never
 *      opened after the first hangs out.
 *   4. The exported timeout constant has the value this fix pins.
 *
 * NOTE ON MOCKING: the transport is INJECTED via `options.createTransport`,
 * never module-mocked. `escpos-network` is CJS; a module mock is silently
 * bypassed and the adapter opens a REAL socket to the configured printer IP.
 * See the header of ThermalPrinterAdapter.flush.test.mjs for the full story.
 *
 * FAKE TIMERS: a real 20s (or even 2.5s) wait is flaky wall-clock time and
 * risks jest's default per-test timeout, so every test here drives the clock
 * with `jest.useFakeTimers()` / `advanceTimersByTimeAsync`.
 */
import { describe, it, expect, jest } from '@jest/globals';
import {
  ThermalPrinterAdapter,
  DEFAULT_CONNECT_TIMEOUT_MS,
  POST_JOB_STATUS_TIMEOUT_MS,
} from '#adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs';

const HEALTHY = [0x16, 0x12, 0x12, 0x12]; // online, cover closed, no errors, paper present

const quietLogger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });
const textJob = { items: [{ type: 'text', content: 'hi', align: 'left' }] };

/**
 * A transport whose FIRST connection (the job's own) behaves normally —
 * answers preflight `DLE EOT` queries healthy, accepts the write, flushes —
 * and whose SECOND connection (the post-job status read) never completes its
 * connect at all, standing in for the observed hung-connection case. Every
 * callback fires via a microtask (`Promise.resolve().then`), never
 * `setTimeout`/`setImmediate`, so it behaves identically under fake timers
 * without needing its own timer entries.
 */
function makeHangOnSecondConnectionTransport({ onConnectionOpened } = {}) {
  const connections = [];
  const factory = (host, port) => {
    const index = connections.length;
    const conn = {
      index, host, port, writes: [], closed: 0, onData: null, opened: false,
      open(cb) {
        this.opened = true;
        onConnectionOpened?.(index);
        if (index === 0) {
          Promise.resolve().then(() => cb(null));
        }
        // index >= 1 (the post-job status connection): never calls back.
        return this;
      },
      read(cb) { this.onData = cb; return this; },
      write(data, cb) {
        this.writes.push(data);
        if (data.length === 3 && data[0] === 0x10 && data[1] === 0x04) {
          const byte = HEALTHY[data[2] - 1];
          if (byte !== undefined) Promise.resolve().then(() => this.onData?.(Buffer.from([byte])));
        }
        if (cb) Promise.resolve().then(() => cb(null));
        return this;
      },
      close(cb) { this.closed += 1; cb && cb(null, null); return this; },
    };
    connections.push(conn);
    return conn;
  };
  return { factory, connections };
}

describe('ThermalPrinterAdapter post-job status timeout', () => {
  it('gives up the post-job status read in seconds, not the 20s connect guard, and still reports dispatched/unverified', async () => {
    jest.useFakeTimers();
    try {
      const { factory, connections } = makeHangOnSecondConnectionTransport();
      const adapter = new ThermalPrinterAdapter(
        // Same connect timeout production uses (adapters.yml thermal_printer_defaults.timeout).
        { host: '10.0.0.50', port: 9100, timeout: DEFAULT_CONNECT_TIMEOUT_MS, upsideDown: false },
        { logger: quietLogger(), createTransport: factory },
      );

      const settled = jest.fn();
      const printing = adapter.print(textJob).then(settled);

      // Well short of a bound that would require the 20s connect guard to
      // have elapsed even once (job connect 500ms queue-delay + ~600ms
      // preflight + ~520ms drain + 1000ms settle + 20000ms status connect
      // would be ~22.6s). At 3s nothing resembling that could have fired yet.
      await jest.advanceTimersByTimeAsync(3000);
      expect(settled).not.toHaveBeenCalled();

      // Comfortably past job-dispatch overhead (~2.1s) + POST_JOB_STATUS_TIMEOUT_MS
      // (2.5s) with margin, but still far short of the old 20s-per-attempt cost.
      await jest.advanceTimersByTimeAsync(5000);
      await printing;

      expect(settled).toHaveBeenCalledWith(expect.objectContaining({
        dispatched: true,
        verified: false,
        verification: 'unreadable',
      }));

      // Exactly two connections: the job's own, and ONE post-job status
      // attempt — never a second retry against a printer that just hung.
      expect(connections).toHaveLength(2);
      expect(connections[1].opened).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not retry the post-job status read — only one connection is opened after the job', async () => {
    jest.useFakeTimers();
    try {
      const openedIndexes = [];
      const { factory, connections } = makeHangOnSecondConnectionTransport({
        onConnectionOpened: (index) => openedIndexes.push(index),
      });
      const adapter = new ThermalPrinterAdapter(
        { host: '10.0.0.50', port: 9100, timeout: DEFAULT_CONNECT_TIMEOUT_MS, upsideDown: false },
        { logger: quietLogger(), createTransport: factory },
      );

      const printing = adapter.print(textJob);
      await jest.advanceTimersByTimeAsync(10000);
      await printing;

      // Index 0 = job's own connection, index 1 = the single post-job status
      // attempt. POST_JOB_STATUS_ATTEMPTS was lowered from 2 to 1 in this fix
      // precisely because a retry immediately after a hung/refused connection
      // is unlikely to help and only doubles the cost in front of the next job.
      expect(openedIndexes).toEqual([0, 1]);
      expect(connections).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('getStatus() with NO explicit timeout still honours the adapter-configured connect timeout — the post-destroy lockout guard is untouched', async () => {
    jest.useFakeTimers();
    try {
      // A transport whose connect never completes on its own.
      const device = { open(cb) { this.cb = cb; return this; }, close(cb) { cb && cb(null, null); return this; } };
      const adapter = new ThermalPrinterAdapter(
        { host: '10.0.0.50', port: 9100, timeout: DEFAULT_CONNECT_TIMEOUT_MS },
        { logger: quietLogger(), createTransport: () => device },
      );

      const settled = jest.fn();
      const statusPromise = adapter.getStatus().then(settled);

      // Still waiting just short of the full 20s guard.
      await jest.advanceTimersByTimeAsync(DEFAULT_CONNECT_TIMEOUT_MS - 100);
      expect(settled).not.toHaveBeenCalled();

      // Past it now.
      await jest.advanceTimersByTimeAsync(200);
      await statusPromise;
      expect(settled).toHaveBeenCalledWith(expect.objectContaining({
        success: false, error: 'Connection timeout',
      }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('an explicit short timeoutMs on getStatus() overrides the connect guard — this is the seam the post-job path uses', async () => {
    jest.useFakeTimers();
    try {
      const device = { open(cb) { this.cb = cb; return this; }, close(cb) { cb && cb(null, null); return this; } };
      const adapter = new ThermalPrinterAdapter(
        { host: '10.0.0.50', port: 9100, timeout: DEFAULT_CONNECT_TIMEOUT_MS },
        { logger: quietLogger(), createTransport: () => device },
      );

      const settled = jest.fn();
      const statusPromise = adapter.getStatus(POST_JOB_STATUS_TIMEOUT_MS).then(settled);

      await jest.advanceTimersByTimeAsync(POST_JOB_STATUS_TIMEOUT_MS - 100);
      expect(settled).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(200);
      await statusPromise;
      expect(settled).toHaveBeenCalledWith(expect.objectContaining({
        success: false, error: 'Connection timeout',
      }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('pins the exported post-job status timeout constant', () => {
    expect(POST_JOB_STATUS_TIMEOUT_MS).toBe(2500);
    // And it must remain strictly shorter than the connect guard it no longer
    // borrows from — the whole point of this fix.
    expect(POST_JOB_STATUS_TIMEOUT_MS).toBeLessThan(DEFAULT_CONNECT_TIMEOUT_MS);
  });
});
