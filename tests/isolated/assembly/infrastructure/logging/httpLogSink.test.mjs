import { describe, test, expect, vi } from 'vitest';
import { createHttpLogSinkTransport } from '#backend/src/0_system/logging/transports/httpLogSink.mjs';

const URL = 'http://log-store:9428/insert/jsonline?_time_field=ts';

const evt = (n) => ({ ts: '2026-08-17T00:00:00.000', level: 'info', event: `e.${n}`, data: {}, context: {} });

/** A fetch double that records calls and resolves however the test wants. */
function fakeFetch({ ok = true, status = 200, hang = false } = {}) {
  const calls = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const fn = vi.fn(async (url, init) => {
    calls.push({ url, init, body: init.body });
    if (hang) await gate;
    return { ok, status };
  });
  return { fn, calls, release: () => release() };
}

describe('http log sink transport', () => {
  test('is a no-op when no url is configured', () => {
    // Unconfigured is normal — dev machines opt out — so it must not throw and
    // must not take the dispatcher's other transports with it.
    const t = createHttpLogSinkTransport({});
    expect(() => t.send(evt(1))).not.toThrow();
    expect(t.getStatus().status).toBe('disabled');
  });

  test('ships a batch as newline-delimited JSON once batchSize is reached', async () => {
    const { fn, calls } = fakeFetch();
    const t = createHttpLogSinkTransport({ url: URL, batchSize: 3, fetchImpl: fn });

    t.send(evt(1));
    t.send(evt(2));
    expect(fn).not.toHaveBeenCalled();   // still under the batch size

    t.send(evt(3));
    await t.flush();

    expect(fn).toHaveBeenCalledTimes(1);
    const lines = calls[0].body.split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).event).toBe('e.1');
    expect(JSON.parse(lines[2]).event).toBe('e.3');
    expect(calls[0].init.headers['Content-Type']).toBe('application/stream+json');
  });

  test('flush ships a partial batch', async () => {
    const { fn, calls } = fakeFetch();
    const t = createHttpLogSinkTransport({ url: URL, batchSize: 100, fetchImpl: fn });
    t.send(evt(1));
    await t.flush();
    expect(calls[0].body.split('\n')).toHaveLength(1);
  });

  // The rule this file exists for: a logging failure costs the log, never the
  // server. Every one of these is a way the far end can misbehave.
  test('never throws when the sink rejects, times out, or errors', async () => {
    const rejecting = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const t = createHttpLogSinkTransport({ url: URL, batchSize: 1, fetchImpl: rejecting });
    expect(() => t.send(evt(1))).not.toThrow();
    await expect(t.flush()).resolves.toBeUndefined();
    expect(t.getStatus().eventsDropped).toBe(1);
    expect(t.getStatus().lastError).toContain('ECONNREFUSED');
  });

  test('counts a non-2xx response as dropped rather than retrying forever', async () => {
    const { fn } = fakeFetch({ ok: false, status: 400 });
    const t = createHttpLogSinkTransport({ url: URL, batchSize: 2, fetchImpl: fn });
    t.send(evt(1)); t.send(evt(2));
    await t.flush();
    // Re-queueing into a sink that is rejecting turns a broken dependency into
    // an ever-growing backlog; the events are also on stdout and in the file sink.
    expect(t.getStatus().eventsDropped).toBe(2);
    expect(t.getStatus().batchesFailed).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('drops the OLDEST events when the buffer is full, and counts them', async () => {
    // During an outage the newest events describe what is happening now, which
    // is what someone reading this later actually needs.
    const { fn, calls, release } = fakeFetch({ hang: true });
    const t = createHttpLogSinkTransport({ url: URL, batchSize: 1, maxBufferEvents: 2, fetchImpl: fn });

    t.send(evt(1));            // starts an in-flight POST that hangs
    t.send(evt(2));            // these queue behind it
    t.send(evt(3));
    t.send(evt(4));            // buffer full -> evicts e.2

    expect(t.getStatus().eventsDropped).toBeGreaterThanOrEqual(1);
    release();
    await t.flush();

    const shipped = calls.flatMap((c) => c.body.split('\n')).map((l) => JSON.parse(l).event);
    expect(shipped).toContain('e.4');       // newest survived
    expect(shipped).not.toContain('e.2');   // oldest evicted
  });

  test('serializes batches so a slow sink cannot pile up concurrent requests', async () => {
    const { fn, release } = fakeFetch({ hang: true });
    const t = createHttpLogSinkTransport({ url: URL, batchSize: 1, fetchImpl: fn });

    t.send(evt(1));
    t.send(evt(2));
    t.send(evt(3));
    expect(fn).toHaveBeenCalledTimes(1);   // one in flight, the rest wait

    release();
    await t.flush();
    expect(fn.mock.calls.length).toBeGreaterThan(1);
  });

  test('reports counters for the status endpoint', async () => {
    const { fn } = fakeFetch();
    const t = createHttpLogSinkTransport({ url: URL, batchSize: 1, fetchImpl: fn });
    t.send(evt(1));
    await t.flush();
    const s = t.getStatus();
    expect(s).toMatchObject({ name: 'http-log-sink', status: 'ok', eventsSent: 1, eventsDropped: 0 });
    expect(s.config.url).toBe(URL);
  });

  test('close stops the flush timer without throwing', () => {
    const { fn } = fakeFetch();
    const t = createHttpLogSinkTransport({ url: URL, fetchImpl: fn });
    expect(() => t.close()).not.toThrow();
    t.send(evt(1));
    expect(fn).not.toHaveBeenCalled();   // closed sinks accept nothing further
  });
});
