// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { collectProgramStatuses } from './programStatusCollection.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const SATURDAY = '2026-11-14';
const WEEKDAYS = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];

function launcher({ doneOn = [], replayable = true, failOn = null }) {
  const seen = [];
  return {
    seen, id: 'p', entryAction: null, surface: null, replayable,
    async status({ day = null }) {
      seen.push(day);
      if (day && day === failOn) throw new Error('boom');
      return { doneToday: doneOn.includes(day ?? 'TODAY'), progressLabel: null, score: null };
    },
    async launch() {},
  };
}
const plan = (cadence = 'daily') => ({ entries: [{ unitId: 'p:x', program: 'p', programInstance: null, cadence }] });
const run = (l, extra = {}) => collectProgramStatuses({
  plan: plan(extra.cadence), learnerId: 'k', launchers: new Map([['p', l]]), logger: silent, studyDay: SATURDAY, ...extra,
});

describe('collectProgramStatuses — Saturday weekday fold', () => {
  it('a live Saturday asks Monday through Friday and records the done days', async () => {
    const l = launcher({ doneOn: ['2026-11-10', '2026-11-12'] });
    const [row] = await run(l);
    expect(l.seen).toEqual([null, ...WEEKDAYS]);
    expect(row.status.weekdays).toEqual({ weekFrom: '2026-11-09', doneOn: ['2026-11-10', '2026-11-12'] });
  });
  it('a weekday build does not replay', async () => {
    const l = launcher({});
    const [row] = await collectProgramStatuses({ plan: plan(), learnerId: 'k', launchers: new Map([['p', l]]), logger: silent, studyDay: '2026-11-12' });
    expect(l.seen).toEqual([null]);
    expect(row.status.weekdays).toBeUndefined();
  });
  it('a replayed past Saturday and a future Saturday preview do not fold', async () => {
    const past = launcher({});
    await run(past, { day: SATURDAY });
    expect(past.seen).toEqual([SATURDAY]);
    const future = launcher({});
    await run(future, { futureDay: SATURDAY });
    expect(future.seen).toEqual([SATURDAY]);
  });
  it('a non-replayable launcher gets no fold', async () => {
    const l = launcher({ replayable: false });
    const [row] = await run(l);
    expect(row.status.weekdays).toBeUndefined();
  });
  it('a weekly program keeps its own fold only', async () => {
    const l = launcher({});
    const [row] = await run(l, { cadence: 'weekly' });
    expect(row.status.weekdays).toBeUndefined();
    expect(row.status.weekly).toBeDefined();
  });
  it('a grown-up day bypass counts the day done', async () => {
    const l = launcher({ doneOn: [] });
    const dayBypasses = { async activeFor({ studyDate }) { return studyDate === '2026-11-09' ? { decidedBy: 'kc' } : null; } };
    const [row] = await run(l, { dayBypasses });
    expect(row.status.weekdays.doneOn).toEqual(['2026-11-09']);
  });
  it('a failed replay drops the fold (no evidence, no offer), not the status', async () => {
    const l = launcher({ failOn: '2026-11-11' });
    const [row] = await run(l);
    expect(row.status.error).toBeUndefined();
    expect(row.status.weekdays).toBeUndefined();
  });
});
