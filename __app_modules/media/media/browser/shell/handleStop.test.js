import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import mediaLog from '../logging/mediaLog.js';
import { stopLocalSession, createHandleStops, handleSuppressed, STOP_UNDO_MS } from './handleStop.js';

function fakeLocal(snapshot) {
  const calls = [];
  return {
    calls,
    getSnapshot: () => snapshot,
    transport: { pause: vi.fn(() => calls.push('pause')), stop: vi.fn(() => calls.push('stop')) },
    lifecycle: { reset: vi.fn(() => calls.push('reset')) },
    portability: { capture: () => ({ snapshot }), adopt: vi.fn(() => ({ ok: true })) },
  };
}

describe('stopLocalSession (the bar\'s Stop on this device)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves the spot first, then ends the session (nothing left to show or restore), and offers Undo for 5 s', () => {
    const snapshot = { state: 'playing', currentItem: { contentId: 'plex:1', title: 'Hospital' }, position: 90, queue: { items: [{}], currentIndex: 0 } };
    const local = fakeLocal(snapshot);
    const recordLocal = vi.fn();
    stopLocalSession(local, { outcomes: { recordLocal }, now: () => 1000 });
    expect(local.calls).toEqual(['pause', 'stop', 'reset']);
    expect(local.lifecycle.reset).toHaveBeenCalledWith({ keep: {} });
    expect(mediaLog.miniPlayerStopped).toHaveBeenCalledWith(expect.objectContaining({ target: 'local' }));
    const record = recordLocal.mock.calls[0][0];
    expect(record.command.copy.primary).toBe('Stopped Hospital');
    expect(record.undo.expiresAt).toBe(1000 + STOP_UNDO_MS);
    record.undo.run();
    expect(local.portability.adopt).toHaveBeenCalledWith(snapshot, { autoplay: false });
  });

  it('skips Undo when the session cannot be restored cheaply', () => {
    const local = fakeLocal({ state: 'ready', currentItem: null, queue: { items: [{}], currentIndex: -1 } });
    local.portability = null;
    const recordLocal = vi.fn();
    stopLocalSession(local, { outcomes: { recordLocal } });
    expect(recordLocal.mock.calls[0][0].undo).toBeUndefined();
  });
});

describe('far stop on the screen handle', () => {
  it('is optimistic: the handle hides at once, and stays hidden over the screen\'s stale state', async () => {
    const stops = createHandleStops();
    let resolve;
    const stop = vi.fn(() => new Promise((r) => { resolve = r; }));
    const pending = stops.stop('tv', { contentId: 'plex:1', name: 'Office Screen', run: stop });
    expect(handleSuppressed(stops.get('tv'), { state: 'playing', currentItem: { contentId: 'plex:1' } })).toBe(true);
    resolve({ ok: true });
    await pending;
    // The screen still reports the stopped item (ready / paused): no "Paused · Resume" leftover.
    expect(handleSuppressed(stops.get('tv'), { state: 'paused', currentItem: { contentId: 'plex:1' } })).toBe(true);
    expect(handleSuppressed(stops.get('tv'), { state: 'ready', currentItem: { contentId: 'plex:1' } })).toBe(true);
    // Something new playing there shows again.
    expect(handleSuppressed(stops.get('tv'), { state: 'playing', currentItem: { contentId: 'plex:2' } })).toBe(false);
    expect(mediaLog.miniPlayerStopped).toHaveBeenCalledWith(expect.objectContaining({ target: 'tv' }));
  });

  it('rolls back on error: the bar comes back saying it could not stop, with Retry', async () => {
    const stops = createHandleStops();
    const run = vi.fn().mockRejectedValueOnce(new Error('ack timeout')).mockResolvedValueOnce({ ok: true });
    await stops.stop('tv', { contentId: 'plex:1', name: 'Office Screen', run });
    const entry = stops.get('tv');
    expect(entry.status).toBe('failed');
    expect(entry.message).toBe("Couldn't stop on Office Screen");
    expect(handleSuppressed(entry, { state: 'playing', currentItem: { contentId: 'plex:1' } })).toBe(false);
    await stops.retry('tv');
    expect(run).toHaveBeenCalledTimes(2);
    expect(stops.get('tv').status).toBe('stopped');
  });

  it('a refused stop ({ ok: false }) rolls back too', async () => {
    const stops = createHandleStops();
    await stops.stop('tv', { contentId: 'plex:1', name: 'Office Screen', run: async () => ({ ok: false, code: 'DEVICE_OFFLINE' }) });
    expect(stops.get('tv').status).toBe('failed');
  });
});
