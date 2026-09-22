import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const logSpy = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() };
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => logSpy }),
}));

import { useWebMidiBLE } from './useWebMidiBLE.js';

// Contract: input timestamps (docs/_wip/plans/2026-09-22-timed-grading-single-judge-design.md).
// A hardware note is stored under its EVENT time when that time is trustworthy,
// so a grader judges when the key went down, not when the WebView read it.

const NOW = 1_800_000_000_000;

function mockAccess() {
  const input = {
    id: 'i', name: 'Piano', _h: null,
    get onmidimessage() { return this._h; },
    set onmidimessage(v) { this._h = v; },
    open: async () => {}, close: async () => {},
  };
  const access = {
    inputs: new Map([['i', input]]),
    outputs: new Map([['o', { id: 'o', name: 'Piano', send: () => {} }]]),
    onstatechange: null,
  };
  global.navigator.requestMIDIAccess = async () => access;
  return { input };
}

const sampledCalls = (name) => logSpy.sampled.mock.calls.filter(([n]) => n === name);

describe('useWebMidiBLE event time', () => {
  beforeEach(() => {
    Object.values(logSpy).forEach((fn) => fn.mockClear());
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  async function bridgeHook() {
    mockAccess();
    const hook = renderHook(() => useWebMidiBLE({ acquireInput: false }));
    await act(async () => { await hook.result.current.connect(); });
    return hook;
  }

  it('feedNote stores the bridge t as the note timestamp and logs the lag', async () => {
    const { result } = await bridgeHook();
    const seen = [];
    result.current.subscribe((e) => seen.push(e));

    act(() => { result.current.feedNote('note_on', 60, 90, NOW - 180); });

    const snap = result.current.notes.getSnapshot();
    expect(snap.activeNotes.get(60)).toEqual({ velocity: 90, timestamp: NOW - 180 });
    expect(snap.noteHistory.at(-1).startTime).toBe(NOW - 180);
    expect(seen[0]).toMatchObject({ type: 'note_on', note: 60, time: NOW - 180 });
    expect(sampledCalls('piano.input.bridge-lag')[0][1]).toEqual({ lagMs: 180 });
    expect(sampledCalls('piano.input.untimed')).toHaveLength(0);

    act(() => { result.current.feedNote('note_off', 60, 0, NOW - 20); });
    expect(result.current.notes.getSnapshot().noteHistory.at(-1).endTime).toBe(NOW - 20);
  });

  it('an old payload without t behaves as before (receipt time) and logs untimed', async () => {
    const { result } = await bridgeHook();
    act(() => { result.current.feedNote('note_on', 62, 70); });
    expect(result.current.notes.getSnapshot().activeNotes.get(62)).toEqual({ velocity: 70, timestamp: NOW });
    const [[, data, opts]] = sampledCalls('piano.input.untimed');
    expect(data).toMatchObject({ source: 'bridge', reason: 'missing' });
    expect(opts).toMatchObject({ level: 'warn', aggregate: true });
    expect(sampledCalls('piano.input.bridge-lag')).toHaveLength(0);
  });

  it('a stale t (> 1s from receipt) falls back to receipt time', async () => {
    const { result } = await bridgeHook();
    act(() => { result.current.feedNote('note_on', 64, 80, NOW - 5000); });
    expect(result.current.notes.getSnapshot().activeNotes.get(64).timestamp).toBe(NOW);
    expect(sampledCalls('piano.input.untimed')[0][1]).toMatchObject({ reason: 'skew', skewMs: 5000 });
  });

  it('local presses (on-screen keys) use receipt time and log nothing', async () => {
    const { result } = await bridgeHook();
    act(() => { result.current.pressNote(65, 90); });
    expect(result.current.notes.getSnapshot().activeNotes.get(65).timestamp).toBe(NOW);
    expect(logSpy.sampled.mock.calls.filter(([n]) => n.startsWith('piano.input.'))).toHaveLength(0);
  });

  it('Web MIDI input uses performance.timeOrigin + event.timeStamp', async () => {
    const { input } = mockAccess();
    const origin = NOW - 60_000;
    vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(origin);
    const { result } = renderHook(() => useWebMidiBLE({ acquireInput: true }));
    await act(async () => { await result.current.connect(); });

    act(() => { input.onmidimessage({ data: new Uint8Array([0x90, 67, 100]), timeStamp: 60_000 - 45 }); });
    expect(result.current.notes.getSnapshot().activeNotes.get(67).timestamp).toBe(NOW - 45);

    // A Web MIDI event with no timeStamp lands at receipt.
    act(() => { input.onmidimessage({ data: new Uint8Array([0x90, 69, 100]) }); });
    expect(result.current.notes.getSnapshot().activeNotes.get(69).timestamp).toBe(NOW);
    expect(sampledCalls('piano.input.untimed').at(-1)[1]).toMatchObject({ source: 'webmidi' });
  });
});
