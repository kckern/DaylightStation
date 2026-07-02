/**
 * usePeek — the press-and-hold audition engine (Task 5.2, design §7).
 *
 * Same harness style as useProducerTransport.test.js: manual rAF queue +
 * mocked performance.now so the wall clock advances deterministically. The
 * shared event builders (loopScheduler / percussion) are REAL — only the
 * router and the lib's loadNotes are mocked.
 *
 * Fixed grid: bpm 120, 4/4 → barMs 2000; ppq 480 → quarter = 500ms.
 * Peek velocity math: base velocity 90 × PEEK_GAIN 0.9 = 81.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePeek, PEEK_CHANNEL, PEEK_DRUM_CHANNEL } from './usePeek.js';

// ── manual clock + rAF queue ─────────────────────────────────────────────────

let now = 0;
let rafCbs = new Map();
let nextRafId = 1;

beforeEach(() => {
  now = 0;
  rafCbs = new Map();
  nextRafId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    const id = nextRafId;
    nextRafId += 1;
    rafCbs.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id) => {
    rafCbs.delete(id);
  });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Advance the wall clock to t and run the currently queued rAF callbacks. */
function frameAt(t) {
  now = t;
  const cbs = [...rafCbs.values()];
  rafCbs.clear();
  cbs.forEach((cb) => cb(t));
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const makeRouter = () => ({
  noteOn: vi.fn(),
  noteOff: vi.fn(),
  allNotesOff: vi.fn(),
  configureLayer: vi.fn(),
  panic: vi.fn(),
});

const NOTES_C = { ppq: 480, notes: [{ ticks: 0, durationTicks: 480, midi: 60 }] };

const MELODY = { slug: 'tune', path: 'melodies/tune.mid', type: 'melody' };
const BASSLINE = { slug: 'walk', path: 'basslines/walk.mid', type: 'bassline' };
const GROOVE = { slug: 'rock', path: 'grooves/rock.mid', type: 'groove' };

/** lib.loadNotes returning a MANUALLY resolved promise (token-guard tests). */
function makeLib(notes = NOTES_C) {
  let resolvers = [];
  const lib = {
    loadNotes: vi.fn(() => new Promise((resolve) => { resolvers.push(resolve); })),
  };
  const resolveLoad = async (value = notes) => {
    const rs = resolvers;
    resolvers = [];
    await act(async () => { rs.forEach((r) => r(value)); });
  };
  return { lib, resolveLoad };
}

const BASE = { bpm: 120, keyShift: 0, isJamPlaying: true, layers: [] };

function mount(overrides = {}) {
  const router = overrides.router ?? makeRouter();
  const { lib, resolveLoad } = makeLib(overrides.notes);
  const props = { router, lib, ...BASE, ...overrides };
  const utils = renderHook((p) => usePeek(p), { initialProps: props });
  return { ...utils, router, lib, resolveLoad };
}

const onCalls = (router, channel) => router.noteOn.mock.calls.filter((c) => c[0] === channel);

// ── behavior ─────────────────────────────────────────────────────────────────

describe('usePeek — melodic peeks on the reserved channel', () => {
  it('fires the loop on channel 15 with the workspace keyShift as transpose', async () => {
    const { result, router, resolveLoad } = mount({ keyShift: 3 });
    act(() => result.current.startPeek(MELODY));
    expect(result.current.peekingId).toBe(MELODY.path);
    await resolveLoad();

    frameAt(10);
    // 60 + keyShift 3 = 63; velocity 90 × 0.9 = 81.
    expect(router.noteOn).toHaveBeenCalledWith(PEEK_CHANNEL, 63, 81);
    frameAt(600); // note_off at 500ms
    expect(router.noteOff).toHaveBeenCalledWith(PEEK_CHANNEL, 63);
  });

  it('conforms the peek voice: default program (grand for melody, bass for basslines) + unity channel gain', async () => {
    const { result, router, resolveLoad } = mount();
    act(() => result.current.startPeek(BASSLINE));
    await resolveLoad();
    expect(router.configureLayer).toHaveBeenCalledWith(PEEK_CHANNEL, { program: 33, gain: 1 });
  });

  it('loops: wraps at the cycle end and re-fires from the top', async () => {
    const { result, router, resolveLoad } = mount();
    act(() => result.current.startPeek(MELODY));
    await resolveLoad();

    frameAt(10);
    expect(onCalls(router, PEEK_CHANNEL)).toHaveLength(1);
    frameAt(2100); // 1-bar cycle at bpm 120 wraps at 2000ms
    expect(onCalls(router, PEEK_CHANNEL)).toHaveLength(2);
  });
});

describe('usePeek — groove peeks', () => {
  it('fires on the drum channel with transpose 0 (grooves never transpose) and no program push', async () => {
    const { result, router, resolveLoad } = mount({
      keyShift: 5,
      notes: { ppq: 480, notes: [{ ticks: 0, durationTicks: 120, midi: 36 }] },
    });
    act(() => result.current.startPeek(GROOVE));
    await resolveLoad();

    frameAt(10);
    expect(router.noteOn).toHaveBeenCalledWith(PEEK_DRUM_CHANNEL, 36, 81); // NOT 41
    expect(router.configureLayer).not.toHaveBeenCalled(); // GM drums ignore program
  });
});

describe('usePeek — metronome under a solo peek', () => {
  it('overlays the click on ch 9 when the jam is NOT playing', async () => {
    const { result, router, resolveLoad } = mount({ isJamPlaying: false });
    act(() => result.current.startPeek(MELODY));
    await resolveLoad();

    frameAt(1600); // beats at 0/500/1000/1500 all fired
    expect(onCalls(router, PEEK_DRUM_CHANNEL)).toHaveLength(4);
    expect(onCalls(router, PEEK_CHANNEL)).toHaveLength(1);
  });

  it('does NOT click when the jam is playing (the stack is the context)', async () => {
    const { result, router, resolveLoad } = mount({ isJamPlaying: true });
    act(() => result.current.startPeek(MELODY));
    await resolveLoad();

    frameAt(1600);
    expect(onCalls(router, PEEK_DRUM_CHANNEL)).toHaveLength(0);
  });
});

describe('usePeek — stopPeek silences', () => {
  it('cancels the loop and silences the peek channel', async () => {
    const { result, router, resolveLoad } = mount();
    act(() => result.current.startPeek(MELODY));
    await resolveLoad();
    frameAt(10);

    act(() => result.current.stopPeek());
    expect(router.allNotesOff).toHaveBeenCalledWith(PEEK_CHANNEL);
    expect(result.current.peekingId).toBeNull();

    const before = router.noteOn.mock.calls.length;
    frameAt(2100); // any straggler rAF must be dead
    expect(router.noteOn.mock.calls.length).toBe(before);
  });

  it('also silences ch 9 when the metronome was running', async () => {
    const { result, router, resolveLoad } = mount({ isJamPlaying: false });
    act(() => result.current.startPeek(MELODY));
    await resolveLoad();
    frameAt(10);

    act(() => result.current.stopPeek());
    expect(router.allNotesOff).toHaveBeenCalledWith(PEEK_CHANNEL);
    expect(router.allNotesOff).toHaveBeenCalledWith(PEEK_DRUM_CHANNEL);
  });

  it('a groove peek released over a LIVE jam releases its own notes but never blanket-wipes ch 9 (shared with the jam\'s grooves)', async () => {
    const { result, router, resolveLoad } = mount({
      isJamPlaying: true,
      notes: { ppq: 480, notes: [{ ticks: 0, durationTicks: 960, midi: 36 }] },
    });
    act(() => result.current.startPeek(GROOVE));
    await resolveLoad();
    frameAt(10); // kick sounding (off at 1000ms)

    act(() => result.current.stopPeek());
    expect(router.noteOff).toHaveBeenCalledWith(PEEK_DRUM_CHANNEL, 36); // per-note release
    expect(router.allNotesOff).not.toHaveBeenCalledWith(PEEK_DRUM_CHANNEL);
  });

  it('drops late-arriving notes: loadNotes resolving after stopPeek starts nothing (token guard)', async () => {
    const { result, router, resolveLoad } = mount();
    act(() => result.current.startPeek(MELODY));
    act(() => result.current.stopPeek());
    await resolveLoad(); // notes land AFTER the stop

    expect(rafCbs.size).toBe(0);
    frameAt(10);
    expect(router.noteOn).not.toHaveBeenCalled();
  });

  it('stopPeek(onlyId) is a no-op for a stale id — a late release must not kill a newer peek', async () => {
    const { result, router, resolveLoad } = mount();
    act(() => result.current.startPeek(MELODY));
    await resolveLoad();
    act(() => result.current.startPeek(GROOVE)); // supersedes MELODY
    await resolveLoad();
    router.allNotesOff.mockClear();

    act(() => result.current.stopPeek(MELODY.path)); // stale card's release
    expect(result.current.peekingId).toBe(GROOVE.path);
    expect(router.allNotesOff).not.toHaveBeenCalled();

    frameAt(10); // the groove peek is still alive
    expect(onCalls(router, PEEK_DRUM_CHANNEL).length).toBeGreaterThan(0);
  });
});

describe('usePeek — one peek at a time', () => {
  it('starting a second peek stops the first', async () => {
    const { result, router, resolveLoad } = mount();
    act(() => result.current.startPeek(MELODY));
    await resolveLoad();
    frameAt(10);
    expect(onCalls(router, PEEK_CHANNEL)).toHaveLength(1);

    act(() => result.current.startPeek(GROOVE));
    expect(router.allNotesOff).toHaveBeenCalledWith(PEEK_CHANNEL); // first silenced
    expect(result.current.peekingId).toBe(GROOVE.path);
    await resolveLoad();

    frameAt(50);
    expect(onCalls(router, PEEK_CHANNEL)).toHaveLength(1); // melody never re-fired
    expect(onCalls(router, PEEK_DRUM_CHANNEL).length).toBeGreaterThan(0);
  });
});

describe('usePeek — channel-15 collision guard', () => {
  it('skips a melodic peek entirely when a workspace layer occupies channel 15', () => {
    const { result, router, lib } = mount({ layers: [{ id: 'x', channel: PEEK_CHANNEL }] });
    act(() => result.current.startPeek(MELODY));

    expect(result.current.peekingId).toBeNull();
    expect(lib.loadNotes).not.toHaveBeenCalled();
    expect(router.noteOn).not.toHaveBeenCalled();
  });

  it('groove peeks still work with channel 15 occupied (drums share 9 by design)', async () => {
    const { result, router, resolveLoad } = mount({
      layers: [{ id: 'x', channel: PEEK_CHANNEL }],
      notes: { ppq: 480, notes: [{ ticks: 0, durationTicks: 120, midi: 38 }] },
    });
    act(() => result.current.startPeek(GROOVE));
    expect(result.current.peekingId).toBe(GROOVE.path);
    await resolveLoad();

    frameAt(10);
    expect(router.noteOn).toHaveBeenCalledWith(PEEK_DRUM_CHANNEL, 38, 81);
  });
});

describe('usePeek — resilience', () => {
  it('a null loadNotes result (fetch/parse failure) clears the peek without throwing', async () => {
    const { result, resolveLoad } = mount();
    act(() => result.current.startPeek(MELODY));
    await resolveLoad(null);
    expect(result.current.peekingId).toBeNull();
    expect(rafCbs.size).toBe(0);
  });

  it('startPeek never throws on a degenerate bpm — it sanitizes and plays', async () => {
    const { result, router, resolveLoad } = mount({ bpm: NaN, isJamPlaying: false });
    act(() => result.current.startPeek(MELODY));
    await resolveLoad();
    frameAt(10);
    expect(onCalls(router, PEEK_CHANNEL)).toHaveLength(1); // sanitized to a sane default
  });

  it('unmount silences a live peek', async () => {
    const { result, router, resolveLoad, unmount } = mount();
    act(() => result.current.startPeek(MELODY));
    await resolveLoad();
    frameAt(10);

    unmount();
    expect(router.allNotesOff).toHaveBeenCalledWith(PEEK_CHANNEL);
    const before = router.noteOn.mock.calls.length;
    frameAt(2100);
    expect(router.noteOn.mock.calls.length).toBe(before);
  });
});
