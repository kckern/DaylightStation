import { beforeEach, describe, expect, it, vi } from 'vitest';

const info = vi.fn();
const warn = vi.fn();
const child = vi.fn(() => ({ info, warn }));
vi.mock('../../../../../lib/logging/Logger.js', () => ({ default: () => ({ child }) }));

describe('wordLadderLog — trace binding', () => {
  beforeEach(() => { info.mockClear(); warn.mockClear(); vi.resetModules(); });

  it('with no trace bound, falls back to plain unstamped logging (existing behaviour)', async () => {
    const { wordLadderLog } = await import('./wordLadderLog.js');
    wordLadderLog.itemShown({ itemId: 'i1' });
    expect(info).toHaveBeenCalledWith('school.word-ladder.item.shown', { itemId: 'i1' });
  });

  it('once bound, every facade call is routed through the trace and comes out stamped', async () => {
    const { wordLadderLog, setTrace } = await import('./wordLadderLog.js');
    const { createTrace } = await import('./createTrace.js');
    const trace = createTrace({ learnerId: 'kid-1', deckId: 'd', mode: 'live' });
    setTrace(trace);
    wordLadderLog.itemShown({ itemId: 'i1' });
    expect(info.mock.calls.at(-1)[1]).toMatchObject({ itemId: 'i1', traceId: trace.id, learnerId: 'kid-1', seq: 1 });
  });

  it('warn-level facade calls stay on warn once traced', async () => {
    const { wordLadderLog, setTrace } = await import('./wordLadderLog.js');
    const { createTrace } = await import('./createTrace.js');
    const trace = createTrace({});
    setTrace(trace);
    wordLadderLog.itemStalled({ ms: 45000 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toMatchObject({ ms: 45000, traceId: trace.id });
  });

  it('an item-level itemMode survives alongside the trace\'s own live/test mode — they no longer collide', async () => {
    const { wordLadderLog, setTrace } = await import('./wordLadderLog.js');
    const { createTrace } = await import('./createTrace.js');
    const trace = createTrace({ learnerId: 'kid-1', deckId: 'd', mode: 'live' });
    setTrace(trace);
    wordLadderLog.itemShown({ itemId: 'i1', itemMode: 'intro' });
    expect(info.mock.calls.at(-1)[1]).toMatchObject({ mode: 'live', itemMode: 'intro' });
  });

  it('clearTrace(trace) only unbinds if it is still the active trace — a stale unmount cannot clobber a newer one', async () => {
    const { wordLadderLog, setTrace, clearTrace } = await import('./wordLadderLog.js');
    const { createTrace } = await import('./createTrace.js');
    const first = createTrace({});
    const second = createTrace({});
    setTrace(first);
    setTrace(second);
    clearTrace(first); // stale — second is still active
    wordLadderLog.itemShown({});
    expect(info.mock.calls.at(-1)[1]).toMatchObject({ traceId: second.id });
    clearTrace(second);
    info.mockClear();
    wordLadderLog.itemShown({ itemId: 'untraced' });
    expect(info).toHaveBeenCalledWith('school.word-ladder.item.shown', { itemId: 'untraced' });
  });

  it('audio.played is warn when the clip failed or was blocked, info when it ended', async () => {
    const { wordLadderLog } = await import('./wordLadderLog.js');
    wordLadderLog.audioPlayed({ clip: 'term', trigger: 'auto', outcome: 'ended' });
    wordLadderLog.audioPlayed({ clip: 'term', trigger: 'auto', outcome: 'error' });
    wordLadderLog.audioPlayed({ clip: 'term', trigger: 'auto', outcome: 'blocked' });
    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('say.recording is warn for failed/unavailable and info for the rest', async () => {
    const { wordLadderLog } = await import('./wordLadderLog.js');
    wordLadderLog.sayRecording({ phase: 'started' });
    wordLadderLog.sayRecording({ phase: 'uploaded' });
    wordLadderLog.sayRecording({ phase: 'failed' });
    wordLadderLog.sayRecording({ phase: 'unavailable' });
    expect(info.mock.calls.map(([name]) => name)).toEqual(['school.word-ladder.say.recording', 'school.word-ladder.say.recording']);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

