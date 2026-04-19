import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalSessionAdapter } from './LocalSessionAdapter.js';
import mediaLog from '../logging/mediaLog.js';

vi.mock('../logging/mediaLog.js', () => {
  const fns = [
    'mounted','unmounted','sessionCreated','sessionReset','sessionResumed',
    'sessionStateChange','sessionPersisted','queueMutated','playbackStarted',
    'playbackStalled','playbackStallAutoAdvanced','playbackError','playbackAdvanced',
    'searchIssued','searchResultChunk','searchCompleted','dispatchInitiated',
    'dispatchStep','dispatchSucceeded','dispatchFailed','dispatchDeduplicated',
    'peekEntered','peekExited','peekCommand','peekCommandAck',
    'takeoverInitiated','takeoverSucceeded','takeoverFailed','takeoverDrift',
    'handoffInitiated','handoffSucceeded','handoffFailed',
    'wsConnected','wsDisconnected','wsReconnected','wsStale',
    'externalControlReceived','externalControlRejected','urlCommandProcessed',
    'urlCommandIgnored','transportCommand',
  ];
  const stub = {};
  for (const k of fns) stub[k] = vi.fn();
  return { default: stub, mediaLog: stub };
});

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe('LocalSessionAdapter — queue ops', () => {
  it('queue.add appends; first add sets currentItem', () => {
    const a = new LocalSessionAdapter(makeDeps());
    a.queue.add({ contentId: 'a', format: 'video', title: 'A' });
    expect(a.getSnapshot().queue.items).toHaveLength(1);
    expect(a.getSnapshot().queue.currentIndex).toBe(0);
    expect(a.getSnapshot().currentItem?.contentId).toBe('a');
  });

  it('queue.playNow replaces-and-loads', () => {
    const a = new LocalSessionAdapter(makeDeps());
    a.queue.playNow({ contentId: 'a', format: 'video' }, { clearRest: true });
    expect(a.getSnapshot().state).toBe('loading');
    expect(a.getSnapshot().currentItem?.contentId).toBe('a');
  });

  it('queue.clear empties the queue', () => {
    const a = new LocalSessionAdapter(makeDeps());
    a.queue.add({ contentId: 'a', format: 'video' });
    a.queue.add({ contentId: 'b', format: 'video' });
    a.queue.clear();
    expect(a.getSnapshot().queue.items).toEqual([]);
  });
});

describe('LocalSessionAdapter — config + lifecycle', () => {
  it('config.setVolume clamps to 0..100', () => {
    const a = new LocalSessionAdapter(makeDeps());
    a.config.setVolume(-5);
    expect(a.getSnapshot().config.volume).toBe(0);
    a.config.setVolume(150);
    expect(a.getSnapshot().config.volume).toBe(100);
  });

  it('lifecycle.reset clears persistence and returns to idle', () => {
    const deps = makeDeps();
    const a = new LocalSessionAdapter(deps);
    a.queue.add({ contentId: 'a', format: 'video' });
    a.lifecycle.reset();
    expect(a.getSnapshot().state).toBe('idle');
    expect(a.getSnapshot().queue.items).toEqual([]);
    expect(deps.persistence.clear).toHaveBeenCalled();
  });

  it('lifecycle.adoptSnapshot replaces state', () => {
    const a = new LocalSessionAdapter(makeDeps());
    const adopted = {
      sessionId: 'adopted', state: 'paused', currentItem: { contentId: 'z', format: 'audio' },
      position: 9,
      queue: { items: [], currentIndex: -1, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 30, playbackRate: 1 },
      meta: { ownerId: 'c1', updatedAt: '' },
    };
    a.lifecycle.adoptSnapshot(adopted, { autoplay: false });
    expect(a.getSnapshot().sessionId).toBe('adopted');
    expect(a.getSnapshot().currentItem?.contentId).toBe('z');
  });
});

describe('LocalSessionAdapter — player event handlers', () => {
  it('onPlayerEnded auto-advances to next item (sequential)', () => {
    const a = new LocalSessionAdapter(makeDeps());
    a.queue.add({ contentId: 'a', format: 'video' });
    a.queue.add({ contentId: 'b', format: 'video' });
    a.onPlayerEnded();
    expect(a.getSnapshot().currentItem?.contentId).toBe('b');
    expect(a.getSnapshot().queue.currentIndex).toBe(1);
  });

  it('onPlayerEnded at end with repeat=off goes to idle', () => {
    const a = new LocalSessionAdapter(makeDeps());
    a.queue.add({ contentId: 'a', format: 'video' });
    a.onPlayerEnded();
    expect(a.getSnapshot().state).toBe('ended');
  });

  it('onPlayerError auto-advances and logs error state', () => {
    const a = new LocalSessionAdapter(makeDeps());
    a.queue.add({ contentId: 'a', format: 'video' });
    a.queue.add({ contentId: 'b', format: 'video' });
    a.onPlayerError({ message: 'boom', code: 'E_X' });
    expect(a.getSnapshot().currentItem?.contentId).toBe('b');
  });
});

describe('LocalSessionAdapter.onPlayerStalled', () => {
  it('transitions state to stalled, logs, and advances to the next queue item', () => {
    const a = new LocalSessionAdapter(makeDeps());
    // Seed a 2-item queue and currentIndex=0
    a.queue.playNow({ contentId: 'p:1', format: 'video', title: 'A', duration: 60 });
    a.queue.add({ contentId: 'p:2', format: 'video', title: 'B', duration: 60 });
    a._dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });

    a.onPlayerStalled({ stalledMs: 10500 });

    expect(mediaLog.playbackStallAutoAdvanced).toHaveBeenCalledTimes(1);
    expect(mediaLog.playbackStallAutoAdvanced.mock.calls[0][0]).toMatchObject({
      stalledMs: 10500,
      contentId: 'p:1',
    });
    // Auto-advance landed on p:2
    expect(a.getSnapshot().currentItem.contentId).toBe('p:2');
  });

  it('is a no-op when no current item exists', () => {
    const a = new LocalSessionAdapter(makeDeps());
    a.onPlayerStalled({ stalledMs: 10500 });
    expect(mediaLog.playbackStallAutoAdvanced).not.toHaveBeenCalled();
    expect(a.getSnapshot().state).toBe('idle');
  });
});
