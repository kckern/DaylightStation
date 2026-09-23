import { beforeEach, describe, expect, it, vi } from 'vitest';

const info = vi.fn();
const warn = vi.fn();
const child = vi.fn(() => ({ info, warn }));
vi.mock('../../../../../lib/logging/Logger.js', () => ({ default: () => ({ child }) }));

describe('cardLadderLog — trace binding', () => {
  beforeEach(() => { info.mockClear(); warn.mockClear(); vi.resetModules(); });

  it('with no trace bound, falls back to plain unstamped logging (existing behaviour)', async () => {
    const { cardLadderLog } = await import('./cardLadderLog.js');
    cardLadderLog.itemShown({ itemId: 'i1' });
    expect(info).toHaveBeenCalledWith('school.card-ladder.item.shown', { itemId: 'i1' });
  });

  it('once bound, every facade call is routed through the trace and comes out stamped', async () => {
    const { cardLadderLog, setTrace } = await import('./cardLadderLog.js');
    const { createTrace } = await import('./createTrace.js');
    const trace = createTrace({ learnerId: 'kid-1', deckId: 'd', mode: 'live' });
    setTrace(trace);
    cardLadderLog.itemShown({ itemId: 'i1' });
    expect(info.mock.calls.at(-1)[1]).toMatchObject({ itemId: 'i1', traceId: trace.id, learnerId: 'kid-1', seq: 1 });
  });

  it('warn-level facade calls stay on warn once traced', async () => {
    const { cardLadderLog, setTrace } = await import('./cardLadderLog.js');
    const { createTrace } = await import('./createTrace.js');
    const trace = createTrace({});
    setTrace(trace);
    cardLadderLog.itemStalled({ ms: 45000 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toMatchObject({ ms: 45000, traceId: trace.id });
  });

  it('an item-level itemMode survives alongside the trace\'s own live/test mode — they no longer collide', async () => {
    const { cardLadderLog, setTrace } = await import('./cardLadderLog.js');
    const { createTrace } = await import('./createTrace.js');
    const trace = createTrace({ learnerId: 'kid-1', deckId: 'd', mode: 'live' });
    setTrace(trace);
    cardLadderLog.itemShown({ itemId: 'i1', itemMode: 'intro' });
    expect(info.mock.calls.at(-1)[1]).toMatchObject({ mode: 'live', itemMode: 'intro' });
  });

  it('clearTrace(trace) only unbinds if it is still the active trace — a stale unmount cannot clobber a newer one', async () => {
    const { cardLadderLog, setTrace, clearTrace } = await import('./cardLadderLog.js');
    const { createTrace } = await import('./createTrace.js');
    const first = createTrace({});
    const second = createTrace({});
    setTrace(first);
    setTrace(second);
    clearTrace(first); // stale — second is still active
    cardLadderLog.itemShown({});
    expect(info.mock.calls.at(-1)[1]).toMatchObject({ traceId: second.id });
    clearTrace(second);
    info.mockClear();
    cardLadderLog.itemShown({ itemId: 'untraced' });
    expect(info).toHaveBeenCalledWith('school.card-ladder.item.shown', { itemId: 'untraced' });
  });

  it('audio.played is warn when the clip failed or was blocked, info when it ended', async () => {
    const { cardLadderLog } = await import('./cardLadderLog.js');
    cardLadderLog.audioPlayed({ clip: 'term', trigger: 'auto', outcome: 'ended' });
    cardLadderLog.audioPlayed({ clip: 'term', trigger: 'auto', outcome: 'error' });
    cardLadderLog.audioPlayed({ clip: 'term', trigger: 'auto', outcome: 'blocked' });
    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('say.recording is warn for failed/unavailable and info for the rest', async () => {
    const { cardLadderLog } = await import('./cardLadderLog.js');
    cardLadderLog.sayRecording({ phase: 'started' });
    cardLadderLog.sayRecording({ phase: 'uploaded' });
    cardLadderLog.sayRecording({ phase: 'failed' });
    cardLadderLog.sayRecording({ phase: 'unavailable' });
    expect(info.mock.calls.map(([name]) => name)).toEqual(['school.card-ladder.say.recording', 'school.card-ladder.say.recording']);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

