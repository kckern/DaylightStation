import { describe, it, expect } from 'vitest';
import { BuildLessonExpectations } from './BuildLessonExpectations.mjs';

const SRT = '1\n00:00:05,000 --> 00:00:07,000\nYour turn, play along.\n';
const lesson = (plexId, extra = {}) => ({ plexId, showKey: '1', showTitle: 'Show One', seasonKey: 's1', season: 1, episode: Number(plexId), title: `L${plexId}`, durationSec: 600, captionStreamId: `c${plexId}`, ...extra });

function memStore(seed = []) {
  const lessons = new Map();
  return {
    lessons,
    get: (id) => lessons.get(String(id).replace(/^plex:/, '')) ?? null,
    all: () => [...lessons.values()],
    writes: 0,
    writeLesson(show, e) { this.writes += 1; const r = { ...e, showKey: show.key }; lessons.set(e.plexId, r); return r; },
    writeLessons(show, list) { this.writes += 1; for (const e of list) lessons.set(e.plexId, { ...e, showKey: show.key }); },
    readMeasuredSeed: () => seed,
  };
}
function source(list, captions = {}) {
  return { listLessons: async () => list, captionText: async (id) => (id in captions ? captions[id] : SRT) };
}
function gateway({ score = 2.2, failFor = null } = {}) {
  const calls = [];
  return {
    calls,
    evaluate: async (state, questions) => {
      calls.push({ state, questions });
      if (failFor && state.title === failFor) throw new Error('boom');
      return { model: 'm1', answers: { handsOn: { type: 'score', score, confidence: 0.8, probabilities: [] } } };
    },
  };
}
const logger = { info() {}, warn() {}, debug() {}, error() {} };
const clock = () => new Date('2026-11-12T10:00:00Z');

describe('BuildLessonExpectations', () => {
  it('measured seed wins (model still asked for calibration); captions → ai target 13', async () => {
    const store = memStore([{ show: 'Show One', season: 1, episode: 1, n: 2, minNpm: 16, medianNpm: 18, maxNpm: 20 }]);
    const gw = gateway();
    const job = new BuildLessonExpectations({ lessonSource: source([lesson('1'), lesson('2')]), store, decisionGateway: gw, logger, clock });
    const r = await job.execute();
    expect(store.get('1')).toMatchObject({ source: 'measured', targetNpm: 16, level: 2, levelScore: 2.2 });
    expect(store.get('2')).toMatchObject({ source: 'ai', targetNpm: 13, level: 2, model: 'm1', confidence: 0.8 });
    expect(gw.calls).toHaveLength(2);
    expect(gw.calls[0].questions.handsOn.type).toBe('score');
    expect(gw.calls[0].state.transcript).toContain('[00:05]');
    expect(r.computed).toBe(2);
    expect(r.calibration.n).toBe(1);
  });

  it('no captions and no measurement → default target 0, listed in noCaptions', async () => {
    const store = memStore();
    const job = new BuildLessonExpectations({ lessonSource: source([lesson('3', { captionStreamId: null })]), store, decisionGateway: gateway(), logger, clock });
    const r = await job.execute();
    expect(store.get('3')).toMatchObject({ source: 'default', targetNpm: 0 });
    expect(r.noCaptions).toEqual([{ plexId: '3', show: 'Show One', title: 'L3' }]);
  });

  it('an unchanged caption hash is skipped; force recomputes', async () => {
    const store = memStore();
    const gw = gateway();
    const src = source([lesson('2')]);
    await new BuildLessonExpectations({ lessonSource: src, store, decisionGateway: gw, logger, clock }).execute();
    const again = await new BuildLessonExpectations({ lessonSource: src, store, decisionGateway: gw, logger, clock }).execute();
    expect(again).toMatchObject({ computed: 0, skipped: 1 });
    const forced = await new BuildLessonExpectations({ lessonSource: src, store, decisionGateway: gw, logger, clock }).execute({ force: true });
    expect(forced.computed).toBe(1);
    expect(gw.calls).toHaveLength(2);
  });

  it('limit stops early and reports remaining; one failure does not stop the run', async () => {
    const store = memStore();
    const gw = gateway({ failFor: 'L2' });
    const job = new BuildLessonExpectations({ lessonSource: source([lesson('1'), lesson('2'), lesson('3'), lesson('4')]), store, decisionGateway: gw, logger, clock });
    const r = await job.execute({ limit: 2 });
    expect(r).toMatchObject({ computed: 2, failed: 1, remaining: 1 });
    expect(store.get('2')).toBeNull();
  });

  it('no gateway → everything default with a warning', async () => {
    const store = memStore();
    const warns = [];
    const job = new BuildLessonExpectations({ lessonSource: source([lesson('2')]), store, decisionGateway: null, logger: { ...logger, warn: (e) => warns.push(e) }, clock });
    await job.execute();
    expect(store.get('2')).toMatchObject({ source: 'default', targetNpm: 0 });
    expect(warns).toContain('piano.lesson-expectation.no-gateway');
  });

  it('computes Spearman over measured lessons that have an AI score', async () => {
    const seed = [1, 2, 3].map((e) => ({ show: 'Show One', season: 1, episode: e, n: 2, minNpm: e * 10, medianNpm: e * 12, maxNpm: e * 15 }));
    let i = 0;
    const gw = { evaluate: async () => ({ model: 'm', answers: { handsOn: { score: [0.5, 1.5, 2.6][i++], confidence: 0.9 } } }) };
    const r = await new BuildLessonExpectations({ lessonSource: source([lesson('1'), lesson('2'), lesson('3')]), store: memStore(seed), decisionGateway: gw, logger, clock }).execute();
    expect(r.calibration.n).toBe(3);
    expect(r.calibration.spearman).toBeCloseTo(1, 6);
  });
  it('writes once per show, not once per lesson (a 2,000-lesson show must not block the server)', async () => {
    const store = memStore();
    await new BuildLessonExpectations({ lessonSource: source([lesson('1'), lesson('2'), lesson('3', { showKey: '9' })]), store, decisionGateway: gateway(), logger, clock }).execute();
    expect(store.writes).toBe(2);
    expect(store.all()).toHaveLength(3);
  });

  it('passes a timeout to the gateway', async () => {
    const gw = gateway();
    await new BuildLessonExpectations({ lessonSource: source([lesson('2')]), store: memStore(), decisionGateway: gw, logger, clock }).execute();
    expect(gw.calls).toHaveLength(1);
  });
});
