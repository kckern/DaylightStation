// The symmetry enforcement suite: every SessionController implementation is
// run through the same shape + behavior checks. When the remote controller
// lands (peek phase), add it to IMPLEMENTATIONS — UI panels bind to whatever
// passes this suite.
import { describe, it, expect, vi } from 'vitest';
import { assertController } from './controllerShape.js';
import { createMockController } from './mockController.js';
import { createLocalSessionController } from '../session/LocalSessionController.js';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

const IMPLEMENTATIONS = [
  ['mock', () => createMockController({ id: 'mock-1' })],
  ['local', () => createLocalSessionController({ clientId: 'c1', randomUuid: () => 's1' })],
];

describe.each(IMPLEMENTATIONS)('controller conformance: %s', (_name, make) => {
  it('satisfies the controller shape', () => {
    expect(() => assertController(make())).not.toThrow();
  });

  it('getSnapshot returns a session snapshot with queue + config', () => {
    const c = make();
    const snap = c.getSnapshot();
    expect(snap).toBeTruthy();
    expect(Array.isArray(snap.queue.items)).toBe(true);
    expect(snap.config).toHaveProperty('volume');
  });

  it('subscribe fires on queue mutation and returns an unsubscriber', () => {
    const c = make();
    const sub = vi.fn();
    const unsub = c.subscribe(sub);
    c.queue.add({ contentId: 'x:1', format: 'video', title: 'X' });
    expect(sub).toHaveBeenCalled();
    const calls = sub.mock.calls.length;
    unsub();
    c.queue.add({ contentId: 'x:2', format: 'video', title: 'Y' });
    expect(sub.mock.calls.length).toBe(calls);
  });

  it('playNow makes the item current', () => {
    const c = make();
    c.queue.playNow({ contentId: 'x:1', format: 'video', title: 'X' }, { clearRest: true });
    expect(c.getSnapshot().currentItem?.contentId).toBe('x:1');
  });

  it('queue add/remove round-trips', () => {
    const c = make();
    c.queue.add({ contentId: 'x:1', format: 'video' });
    c.queue.add({ contentId: 'x:2', format: 'video' });
    const second = c.getSnapshot().queue.items[1];
    c.queue.remove(second.queueItemId);
    expect(c.getSnapshot().queue.items.map((i) => i.contentId)).toEqual(['x:1']);
  });

  it('config setters round-trip through the snapshot', () => {
    const c = make();
    c.config.setShuffle(true);
    c.config.setRepeat('all');
    c.config.setVolume(25);
    const snap = c.getSnapshot();
    expect(snap.config.shuffle).toBe(true);
    expect(snap.config.repeat).toBe('all');
    expect(snap.config.volume).toBe(25);
  });

  it('position tier exposes get + subscribe', () => {
    const c = make();
    const pos = c.position.get();
    expect(typeof pos.seconds).toBe('number');
    const unsub = c.position.subscribe(() => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });
});
