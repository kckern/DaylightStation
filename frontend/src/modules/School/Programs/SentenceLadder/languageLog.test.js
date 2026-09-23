import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = [];
const make = (level) => vi.fn((name, data) => calls.push({ level, name, data }));
const childLogger = {
  debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error'),
  sampled: vi.fn((name, data) => calls.push({ level: 'sampled', name, data })),
};
const child = vi.fn(() => childLogger);
vi.mock('../../../../lib/logging/Logger.js', () => ({ default: () => ({ child }) }));

describe('languageLog trace stamping', () => {
  beforeEach(() => { calls.length = 0; child.mockClear(); });

  it('stamps every event in a run with traceId (= the run id), traceSeq, t, learnerId, corpus and day', async () => {
    const { languageLog } = await import('./languageLog.js');
    const runId = languageLog.startRun({ learnerId: 'learner-a', corpus: 'glossika-korean' });
    languageLog.program('mounted', {});
    languageLog.setTraceContext({ day: 8 });
    languageLog.capture('cut', { seq: 16, piece: 0 });
    expect(calls[0].data).toMatchObject({
      traceId: runId, traceSeq: 1, learnerId: 'learner-a', corpus: 'glossika-korean', day: null,
    });
    // The sentence's own `seq` is untouched — the event order rides as traceSeq.
    expect(calls[1].data).toMatchObject({ traceId: runId, traceSeq: 2, day: 8, seq: 16, piece: 0 });
    expect(typeof calls[1].data.t).toBe('number');
    languageLog.endRun();
  });

  it('stamps sampled (rate-limited) events too', async () => {
    const { languageLog } = await import('./languageLog.js');
    languageLog.startRun({ learnerId: 'learner-a', corpus: 'c' });
    languageLog.rung('refused', { rung: 'dictation' });
    expect(calls[0].level).toBe('sampled');
    expect(calls[0].data).toMatchObject({ traceSeq: 1, learnerId: 'learner-a' });
    languageLog.endRun();
  });

  it('outside a run nothing is stamped', async () => {
    const { languageLog } = await import('./languageLog.js');
    languageLog.endRun();
    languageLog.capture('start', { seq: 1 });
    expect(calls[0].data.traceId).toBeUndefined();
    expect(calls[0].data.traceSeq).toBeUndefined();
  });

  it('a stall is a warn, so it reaches the store', async () => {
    const { languageLog } = await import('./languageLog.js');
    languageLog.rungStalled({ rung: 'recording', seq: 16, phase: 'review', ms: 45000, screen: 'visible' });
    expect(calls[0]).toMatchObject({ level: 'warn', name: 'school.language.rung.stalled' });
  });
});
