import { beforeEach, describe, expect, it, vi } from 'vitest';

const info = vi.fn();
const warn = vi.fn();
const child = vi.fn(() => ({ info, warn }));
vi.mock('../../../../../lib/logging/Logger.js', () => ({ default: () => ({ child }) }));

describe('createTrace', () => {
  beforeEach(() => { info.mockClear(); warn.mockClear(); child.mockClear(); });

  it('mints a 12-hex traceId and stamps every event with it, learnerId/deckId/mode and an incrementing seq', async () => {
    const { createTrace } = await import('./createTrace.js');
    const trace = createTrace({ learnerId: 'kid-1', deckId: 'language/korean', mode: 'live' });
    expect(trace.id).toMatch(/^[0-9a-f]{12}$/);

    trace.event('sitting.opened', { first: 'flashcard' });
    trace.event('item.shown', { task: '2.2' });

    expect(info).toHaveBeenCalledTimes(2);
    const [firstName, firstData] = info.mock.calls[0];
    const [secondName, secondData] = info.mock.calls[1];
    expect(firstName).toBe('school.card-ladder.sitting.opened');
    expect(secondName).toBe('school.card-ladder.item.shown');
    expect(firstData).toMatchObject({ traceId: trace.id, learnerId: 'kid-1', deckId: 'language/korean', mode: 'live', seq: 1, first: 'flashcard' });
    expect(secondData).toMatchObject({ traceId: trace.id, seq: 2, task: '2.2' });
    expect(typeof firstData.t).toBe('number');
  });

  it('setSitting and setPackage stamp everything logged after they are called, not before', async () => {
    const { createTrace } = await import('./createTrace.js');
    const trace = createTrace({ learnerId: 'kid-1', deckId: 'd', mode: 'test' });
    trace.event('item.shown', {});
    trace.setSitting('sit-1');
    trace.setPackage('korean-vocab');
    trace.event('item.answered', {});
    expect(info.mock.calls[0][1]).toMatchObject({ sittingId: null, package: null });
    expect(info.mock.calls[1][1]).toMatchObject({ sittingId: 'sit-1', package: 'korean-vocab' });
  });

  it('routes to the level-named logger method — warn events never land on info', async () => {
    const { createTrace } = await import('./createTrace.js');
    const trace = createTrace({});
    trace.event('layout.clamped', { role: 'term' }, 'warn');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toBe('school.card-ladder.layout.clamped');
  });

  it('the data stamp cannot be overridden by a colliding payload key', async () => {
    const { createTrace } = await import('./createTrace.js');
    const trace = createTrace({ learnerId: 'kid-1', deckId: 'd', mode: 'live' });
    trace.event('item.shown', { seq: 999, traceId: 'not-the-real-one' });
    expect(info.mock.calls[0][1].seq).toBe(1);
    expect(info.mock.calls[0][1].traceId).toBe(trace.id);
  });

  it('a caller-provided mode WOULD be clobbered by the stamp — this is why item.shown uses itemMode instead', async () => {
    const { createTrace } = await import('./createTrace.js');
    const trace = createTrace({ learnerId: 'kid-1', deckId: 'd', mode: 'live' });
    trace.event('item.shown', { mode: 'intro' });
    // The trace's own live/test mode wins — 'intro' never survives under this key.
    expect(info.mock.calls[0][1].mode).toBe('live');
  });

  it('the trace\'s live/test mode and a caller\'s itemMode both survive side by side', async () => {
    const { createTrace } = await import('./createTrace.js');
    const trace = createTrace({ learnerId: 'kid-1', deckId: 'd', mode: 'test' });
    trace.event('item.shown', { itemMode: 'sort' });
    expect(info.mock.calls[0][1]).toMatchObject({ mode: 'test', itemMode: 'sort' });
  });
});
