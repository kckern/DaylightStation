import { describe, expect, it } from 'vitest';
import { ProposeLearnSegments, pngDimensions, JEV_BATCH_SIZE } from './ProposeLearnSegments.mjs';

/** A PNG header with the given size (enough for pngDimensions and the adapter's check). */
function png(width = 400, height = 300) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

const record = (after, extra = {}) => ({
  after, tailGapQuarters: 1, tailGapRatio: 0.25, sectionStart: false, bassMotion: null, densityChange: 0, restBar: false, ...extra,
});

function input(measureCount, { sections = [] } = {}) {
  const features = Array.from({ length: measureCount - 1 }, (_, k) => record(k, sections.includes(k) ? { sectionStart: true } : {}));
  const crops = new Map(features.filter((f) => !f.sectionStart).map((f) => [f.after, png()]));
  return { id: 'files:docs/sheet-music/x.musicxml', features, crops, measureCount, limits: { targetLen: 4 } };
}

/** A gateway answering p from `pOf(k)`; `fail(callIndex, keys)` may throw. */
function fakeGateway({ pOf = () => 0.1, fail = () => null } = {}) {
  const calls = [];
  return {
    calls,
    isConfigured: () => true,
    async evaluate(state, questions) {
      const keys = Object.keys(questions);
      calls.push({ state, questions, keys });
      const error = fail(calls.length - 1, keys);
      if (error) throw error;
      return {
        model: 'jev-test-1',
        answers: Object.fromEntries(keys.map((key) => [key, { type: 'yesNo', probability: pOf(Number(key.slice(4))) }])),
        usage: { inputTokens: 1, outputTokens: 0 },
      };
    },
  };
}

function logger() {
  const logs = [];
  const rec = (level) => (event, data) => logs.push({ level, event, data });
  return { logs, info: rec('info'), warn: rec('warn'), error: rec('error'), debug: rec('debug') };
}

describe('ProposeLearnSegments', () => {
  it('turns Jev probabilities into segments, batching barlines with image keys bar_<k>', async () => {
    const gateway = fakeGateway({ pOf: (k) => (k === 3 || k === 7 ? 0.95 : 0.05) });
    const log = logger();
    const useCase = new ProposeLearnSegments({ gateway, logger: log, now: () => new Date('2026-11-20T00:00:00Z') });
    const result = await useCase.execute(input(12));
    expect(result.segments).toEqual([{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 11 }]);
    expect(result.proposal).toMatchObject({ scorer: 'jev', model: 'jev-test-1', at: '2026-11-20T00:00:00.000Z', failedCalls: 0 });
    expect(result.proposal.boundaries[3]).toBe(0.95);
    expect(result.proposal.features).toHaveLength(11);
    expect(gateway.calls.map((c) => c.keys.length)).toEqual([JEV_BATCH_SIZE, 1]);
    for (const call of gateway.calls) {
      for (const key of call.keys) {
        expect(key).toMatch(/^bar_\d+$/);
        expect(call.state[key]).toMatchObject({ kind: 'image', mediaType: 'image/png', width: 400, height: 300 });
        expect(call.questions[key]).toMatchObject({ type: 'yesNo' });
        expect(call.questions[key].instructions).toContain(`\`${key}\``);
      }
      expect(call.state.features).toHaveLength(call.keys.length);
    }
    expect(log.logs.map((l) => l.event)).toEqual(['piano.sheetmusic.propose.start', 'piano.sheetmusic.propose.done']);
    expect(log.logs[1].data).toMatchObject({ calls: 2, failures: 0, model: 'jev-test-1' });
  });

  it('never sends section starts to Jev; they are certain cuts', async () => {
    const gateway = fakeGateway();
    const result = await new ProposeLearnSegments({ gateway }).execute(input(10, { sections: [4] }));
    const sent = gateway.calls.flatMap((c) => c.keys);
    expect(sent).not.toContain('bar_4');
    expect(sent).toHaveLength(8);
    expect(result.proposal.boundaries[4]).toBe(1);
    expect(result.segments.some((s) => s.end === 4)).toBe(true);
  });

  it('fails the proposal when more than 20% of barlines fail', async () => {
    // 11 barlines in two batches; the 10-barline batch fails.
    const gateway = fakeGateway({ fail: (i) => (i === 0 ? new Error('boom') : null) });
    const log = logger();
    const err = await new ProposeLearnSegments({ gateway, logger: log }).execute(input(12)).catch((e) => e);
    expect(err).toMatchObject({ code: 'proposal-failed' });
    expect(log.logs.find((l) => l.event === 'piano.sheetmusic.propose.failed')?.data).toMatchObject({ failures: 10, barlines: 11 });
  });

  it('3 of 10 barlines failing fails it; failed barlines otherwise get p 0.5', async () => {
    // 30 barlines, three batches; answers missing for 3 barlines in one batch → 10% → ok.
    const gateway = {
      calls: 0,
      isConfigured: () => true,
      async evaluate(state, questions) {
        this.calls += 1;
        const keys = Object.keys(questions).filter((k) => !['bar_0', 'bar_1', 'bar_2'].includes(k));
        return { model: 'm', answers: Object.fromEntries(keys.map((k) => [k, { type: 'yesNo', probability: 0.1 }])) };
      },
    };
    const ok = await new ProposeLearnSegments({ gateway }).execute(input(31));
    expect(ok.proposal.boundaries[0]).toBe(0.5);
    expect(ok.proposal.failedBarlines).toBe(3);

    const tenBarlines = input(11);
    const failing = {
      isConfigured: () => true,
      async evaluate(state, questions) {
        const keys = Object.keys(questions).slice(3);
        return { model: 'm', answers: Object.fromEntries(keys.map((k) => [k, { type: 'yesNo', probability: 0.1 }])) };
      },
    };
    await expect(new ProposeLearnSegments({ gateway: failing }).execute(tenBarlines)).rejects.toMatchObject({ code: 'proposal-failed' });
  });

  it('waits out a rate limit once, then retries the batch', async () => {
    const waits = [];
    const rateLimited = Object.assign(new Error('Rate limit'), { code: 'RATE_LIMIT', retryAfter: 2 });
    const gateway = fakeGateway({ fail: (i) => (i === 0 ? rateLimited : null) });
    const result = await new ProposeLearnSegments({ gateway, scheduler: { wait: async (ms) => { waits.push(ms); } } }).execute(input(5));
    expect(waits).toEqual([2000]);
    expect(gateway.calls).toHaveLength(2);
    expect(result.proposal.failedCalls).toBe(0);
  });

  it('a second rate limit fails that batch', async () => {
    const rateLimited = Object.assign(new Error('Rate limit'), { code: 'RATE_LIMIT', retryAfter: 1 });
    const gateway = fakeGateway({ fail: () => rateLimited });
    await expect(new ProposeLearnSegments({ gateway, scheduler: { wait: async () => {} } }).execute(input(5)))
      .rejects.toMatchObject({ code: 'proposal-failed' });
    expect(gateway.calls).toHaveLength(2);
  });

  it('runs at most two batches at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const gateway = {
      isConfigured: () => true,
      async evaluate(state, questions) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return { model: 'm', answers: Object.fromEntries(Object.keys(questions).map((k) => [k, { type: 'yesNo', probability: 0.2 }])) };
      },
    };
    await new ProposeLearnSegments({ gateway }).execute(input(51));
    expect(peak).toBe(2);
  });

  it('compares Jev and the heuristic with reference cuts when given', async () => {
    const gateway = fakeGateway({ pOf: (k) => (k === 3 ? 0.95 : 0.05) });
    const log = logger();
    const result = await new ProposeLearnSegments({ gateway, logger: log })
      .execute({ ...input(8), reference: [{ start: 0, end: 3 }, { start: 4, end: 7 }] });
    expect(result.comparison.jev).toMatchObject({ tp: 1, fp: 0, fn: 0, precision: 1, recall: 1 });
    expect(result.comparison.heuristic).toHaveProperty('recall');
    expect(log.logs.find((l) => l.event === 'piano.sheetmusic.propose.compared')?.data).toMatchObject({ jevRecall: 1 });
  });

  it('reads PNG dimensions', () => {
    expect(pngDimensions(png(512, 300))).toEqual({ width: 512, height: 300 });
    expect(pngDimensions(Buffer.from('not a png at all, really not'))).toBeNull();
  });
});
