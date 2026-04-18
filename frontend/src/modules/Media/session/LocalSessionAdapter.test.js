import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalSessionAdapter } from './LocalSessionAdapter.js';

function makeDeps() {
  return {
    clientId: 'c1',
    wsSend: vi.fn(),
    httpClient: vi.fn(async () => ({})),
    persistence: {
      read: vi.fn(() => null),
      write: vi.fn(() => ({ ok: true })),
      clear: vi.fn(),
    },
    nowFn: () => new Date('2026-04-18T00:00:00Z'),
    randomUuid: () => 's-test-1',
  };
}

describe('LocalSessionAdapter — bootstrap', () => {
  it('starts with an idle snapshot when persistence returns null', () => {
    const a = new LocalSessionAdapter(makeDeps());
    expect(a.getSnapshot().state).toBe('idle');
    expect(a.getSnapshot().sessionId).toBe('s-test-1');
    expect(a.getSnapshot().meta.ownerId).toBe('c1');
  });

  it('hydrates from persistence if a prior snapshot exists', () => {
    const deps = makeDeps();
    deps.persistence.read = vi.fn(() => ({
      snapshot: { sessionId: 'old', state: 'paused', currentItem: null, position: 42,
                  queue: { items: [], currentIndex: -1, upNextCount: 0 },
                  config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
                  meta: { ownerId: 'c1', updatedAt: '' } },
      wasPlayingOnUnload: false,
    }));
    const a = new LocalSessionAdapter(deps);
    expect(a.getSnapshot().sessionId).toBe('old');
    expect(a.getSnapshot().position).toBe(42);
  });

  it('notifies subscribers on state change', () => {
    const a = new LocalSessionAdapter(makeDeps());
    const sub = vi.fn();
    const unsub = a.subscribe(sub);
    a._dispatch({ type: 'SET_CONFIG', patch: { volume: 77 } });
    expect(sub).toHaveBeenCalledTimes(1);
    expect(sub.mock.calls[0][0].config.volume).toBe(77);
    unsub();
    a._dispatch({ type: 'SET_CONFIG', patch: { volume: 44 } });
    expect(sub).toHaveBeenCalledTimes(1);
  });
});

describe('LocalSessionAdapter — transport', () => {
  let a;
  beforeEach(() => { a = new LocalSessionAdapter(makeDeps()); });

  it('pause updates snapshot.state to paused', () => {
    a._dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    a._dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
    a.transport.pause();
    expect(a.getSnapshot().state).toBe('paused');
  });

  it('stop resets to idle', () => {
    a._dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    a.transport.stop();
    expect(a.getSnapshot().state).toBe('idle');
    expect(a.getSnapshot().currentItem).toBeNull();
  });

  it('persists after every transport action', () => {
    const deps = makeDeps();
    const b = new LocalSessionAdapter(deps);
    b._dispatch({ type: 'LOAD_ITEM', item: { contentId: 'p:1', format: 'video' } });
    b.transport.pause();
    expect(deps.persistence.write).toHaveBeenCalled();
  });
});
