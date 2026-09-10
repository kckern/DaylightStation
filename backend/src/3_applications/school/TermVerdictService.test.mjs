// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { TermVerdictService } from './TermVerdictService.mjs';
import { VERDICT_VERSION } from '#domains/school/termVerdict.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const TODAY = '2026-09-09';
const NOW = `${TODAY}T18:00:00.000Z`; // 11:00 PDT

class MemoryCache {
  docs = new Map(); writes = 0;
  async read(l, t) { const d = this.docs.get(`${l}/${t}`); return d ? structuredClone(d) : null; }
  async write(l, t, doc) { this.writes += 1; this.docs.set(`${l}/${t}`, structuredClone(doc)); }
}

const periods = { listPeriods: () => [{ periodId: '2026-fall', kind: 'semester', label: 'Fall 2026', startsAt: '2026-08-01T07:00:00.000Z', endsAt: '2026-12-19T08:00:00.000Z' }] };

/** A completion double that records which days were asked and answers by table. */
function completionDouble(table = {}) {
  const asked = [];
  return {
    asked,
    async execute({ learnerId, studyDay = null }) {
      const day = studyDay ?? TODAY;
      asked.push(day);
      const spec = table[day] ?? { state: 'complete', sections: [{ subject: 'math', state: 'served', reason: null }] };
      if (spec instanceof Error) throw spec;
      return { learnerId, studyDate: day, excused: [], faults: [], ...spec };
    },
  };
}

function build({ table, cache = new MemoryCache(), window = { from: '2026-09-01' }, at = NOW, freshMs = 60_000 } = {}) {
  const completion = completionDouble(table);
  const service = new TermVerdictService({
    getLearnerDayCompletion: completion, cache, academicPeriods: periods, window,
    timezone: 'America/Los_Angeles', clock: () => new Date(at), freshMs, logger: silent,
  });
  return { service, completion, cache };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('TermVerdictService.read', () => {
  it('today and yesterday are recomputed on read; older days are queued for the background and read pending meanwhile', async () => {
    const { service, completion } = build();
    const out = await service.read('kid');
    expect(out.term).toMatchObject({ termId: '2026-fall', from: '2026-09-01', to: '2026-12-18' });
    expect(completion.asked).toEqual(['2026-09-08', TODAY]);
    expect(out.days).toHaveLength(9);
    expect(out.days.at(-1)).toMatchObject({ studyDay: TODAY, state: 'met' });
    expect(out.days[0]).toMatchObject({ studyDay: '2026-09-01', state: 'unknown', reason: 'pending' });
    expect(out.pending).toBe(7);
    // …and the queue fills them in.
    await settle();
    const again = await service.read('kid');
    expect(again.pending).toBe(0);
    expect(again.days[0].state).toBe('met');
  });

  it('a day five days back is served from the file while yesterday is rewritten', async () => {
    const cache = new MemoryCache();
    const { service, completion } = build({ cache });
    await service.read('kid'); await settle();
    completion.asked.length = 0;
    // Tamper with the cached D-5 to prove it is not recomputed, and age yesterday.
    const doc = cache.docs.get('kid/2026-fall');
    doc.days['2026-09-04'].state = 'partial';
    doc.days['2026-09-08'].computedAt = '2026-09-09T00:00:00.000Z';
    doc.days[TODAY].computedAt = '2026-09-09T00:00:00.000Z';
    const out = await service.read('kid');
    expect(completion.asked).toEqual(['2026-09-08', TODAY]);
    expect(out.days.find((d) => d.studyDay === '2026-09-04').state).toBe('partial');
  });

  it('a fresh row (computed within freshMs) is trusted, so the board can poll', async () => {
    const cache = new MemoryCache();
    const { service, completion } = build({ cache });
    await service.read('kid'); await settle();
    completion.asked.length = 0;
    await service.read('kid');
    expect(completion.asked).toEqual([]);
  });

  it('a cache from an older ladder version is discarded whole', async () => {
    const cache = new MemoryCache();
    cache.docs.set('kid/2026-fall', { version: 0, computedAt: NOW, days: { '2026-09-02': { state: 'met', computedAt: NOW } } });
    const { service } = build({ cache });
    const out = await service.read('kid');
    expect(out.days.find((d) => d.studyDay === '2026-09-02').state).toBe('unknown');
    await settle();
    expect(cache.docs.get('kid/2026-fall').version).toBe(VERDICT_VERSION);
  });

  it('a faulted day is retried once its retryAfter passes, not before', async () => {
    const cache = new MemoryCache();
    const fault = { state: 'indeterminate', faults: [{ subject: 'math', reason: 'program_unavailable' }], sections: [{ subject: 'math', state: 'faulted', reason: 'program_unavailable' }] };
    const { service, completion } = build({ cache, table: { '2026-09-03': fault } });
    await service.read('kid'); await settle();
    expect(cache.docs.get('kid/2026-fall').days['2026-09-03']).toMatchObject({ state: 'unknown', reason: 'program_unavailable' });
    completion.asked.length = 0;
    await service.read('kid'); await settle();
    expect(completion.asked).not.toContain('2026-09-03');
    // Seven hours later the retry is due.
    const later = build({ cache, at: '2026-09-10T01:30:00.000Z', table: {} });
    await later.service.read('kid'); await settle();
    expect(later.completion.asked).toContain('2026-09-03');
    expect(later.cache.docs.get('kid/2026-fall').days['2026-09-03'].state).toBe('met');
  });

  it("today's cell is the LIVE completion, not a replay", async () => {
    const { service, completion } = build();
    const seen = [];
    const original = completion.execute.bind(completion);
    completion.execute = async (args) => { seen.push(args); return original(args); };
    await service.read('kid');
    // A replay passes `studyDay`; the live call passes none.
    expect(seen.find((a) => a.studyDay === undefined)).toBeTruthy();
    expect(seen.filter((a) => a.studyDay === TODAY)).toEqual([]);
  });

  it('weeks cover the whole term, including the empty tail', async () => {
    const { service } = build();
    const out = await service.read('kid');
    expect(out.weeks[0]).toMatchObject({ weekId: '2026-08-31', from: '2026-08-31', to: '2026-09-06' });
    expect(out.weeks.at(-1).weekId).toBe('2026-12-14');
    expect(out.weeks).toHaveLength(16);
    expect(out.weeks[0].state).toBe('exempt');
  });
});

describe('TermVerdictService.rebuild', () => {
  it('computes every day oldest-first and skips existing rows unless forced', async () => {
    const cache = new MemoryCache();
    const { service, completion } = build({ cache });
    const first = await service.rebuild('kid');
    expect(first.computed).toBe(9);
    expect(completion.asked).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', TODAY]);
    completion.asked.length = 0;
    const second = await service.rebuild('kid');
    expect(second).toMatchObject({ computed: 0, skipped: 9 });
    const forced = await service.rebuild('kid', { force: true, from: '2026-09-07' });
    expect(forced.computed).toBe(3);
  });

  it('delete-then-rebuild reproduces the same rows', async () => {
    const cache = new MemoryCache();
    const { service } = build({ cache, table: { '2026-09-05': { state: 'no_work_today', sections: [{ subject: 'math', state: 'excused', reason: 'not_a_school_day' }] } } });
    await service.rebuild('kid');
    const before = structuredClone(cache.docs.get('kid/2026-fall').days);
    cache.docs.clear();
    await service.rebuild('kid');
    expect(cache.docs.get('kid/2026-fall').days).toEqual(before);
    expect(before['2026-09-05']).toMatchObject({ state: 'exempt', reason: 'not_a_school_day', weekday: 6 });
  });

  it('a day that throws is recorded as unknown with a retry, and the run continues', async () => {
    const cache = new MemoryCache();
    const { service } = build({ cache, table: { '2026-09-03': new Error('plex down') } });
    const out = await service.rebuild('kid');
    expect(out.computed).toBe(9);
    const rows = cache.docs.get('kid/2026-fall').days;
    expect(rows['2026-09-03']).toMatchObject({ state: 'unknown', reason: 'replay_failed', error: 'plex down' });
    expect(rows['2026-09-03'].retryAfter).toBeTruthy();
    expect(rows['2026-09-04'].state).toBe('met');
  });

  it('writes in batches of ten, so a crash keeps what it had', async () => {
    const cache = new MemoryCache();
    const { service } = build({ cache, at: '2026-09-25T18:00:00.000Z' });
    await service.rebuild('kid');
    expect(cache.writes).toBe(3); // 25 days → 10 + 10 + 5
  });
});
