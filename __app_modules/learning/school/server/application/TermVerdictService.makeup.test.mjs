// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { TermVerdictService } from "./TermVerdictService.mjs";

const silent = { info() {}, warn() {}, error() {}, debug() {} };
// Week Mon 2026-09-07 … Sat 09-12. Today is Thursday 09-10, 11:00 PDT.
const WED = '2026-09-09'; const THU = '2026-09-10';
const NOW = `${THU}T18:00:00.000Z`;

class MemoryCache {
  docs = new Map();
  async read(l, t) { const d = this.docs.get(`${l}/${t}`); return d ? structuredClone(d) : null; }
  async write(l, t, doc) { this.docs.set(`${l}/${t}`, structuredClone(doc)); }
}

const periods = { listPeriods: () => [{ periodId: '2026-fall', kind: 'semester', startsAt: '2026-08-01T07:00:00.000Z', endsAt: '2026-12-19T08:00:00.000Z' }] };
const ledger = (lessons) => ({ asked: true, lessons, programsDone: [], needsLesson: true, needsPrograms: [] });
const served = (subject, lessons = 1) => ({ subject, state: 'served', reason: null, ledger: ledger(lessons) });
const missed = (subject) => ({ subject, state: 'obligated', reason: null, ledger: ledger(0) });

function build({ table, makeupPolicy }) {
  const asked = [];
  const completion = {
    async execute({ studyDay = null }) {
      const day = studyDay ?? THU;
      asked.push(day);
      const sections = table[day] ?? [served('english'), served('math')];
      const open = sections.some((s) => s.state === 'obligated');
      return { state: open ? 'incomplete' : 'complete', excused: [], faults: [], sections };
    },
  };
  const service = new TermVerdictService({
    getLearnerDayCompletion: completion, cache: new MemoryCache(), academicPeriods: periods,
    window: { from: '2026-09-07' }, timezone: 'America/Los_Angeles', clock: () => new Date(NOW),
    logger: silent, makeupPolicy,
  });
  return { service, asked };
}

const ON = { enabled: true, deadlineWeekday: 6, subjects: null };

describe('TermVerdictService makeup', () => {
  const table = {
    [WED]: [served('english'), missed('math')],
    [THU]: [served('english'), served('math', 2)],
  };

  it("Thursday's second math lesson turns Wednesday green, stamped makeup", async () => {
    const { service } = build({ table, makeupPolicy: ON });
    const out = await service.read('kid', { detail: true });
    const wed = out.days.find((d) => d.studyDay === WED);
    expect(wed).toMatchObject({ state: 'met', timeliness: 'makeup', makeup: [{ subject: 'math', servedOn: THU }], makeupOpen: false });
    expect(wed.sections.find((s) => s.subject === 'math')).toEqual({ subject: 'math', state: 'served', reason: null, makeup: { servedOn: THU } });
    expect(out.days.find((d) => d.studyDay === THU).timeliness).toBe('on-time');
  });

  it('off: Wednesday stays partial and nothing is marked open', async () => {
    const { service } = build({ table, makeupPolicy: undefined });
    const wed = (await service.read('kid')).days.find((d) => d.studyDay === WED);
    expect(wed).toMatchObject({ state: 'partial', timeliness: 'on-time', makeupOpen: false });
  });

  it('a missed day still recoverable reads makeupOpen', async () => {
    const { service } = build({ table: { [WED]: [missed('math')], [THU]: [served('math', 1)] }, makeupPolicy: ON });
    const wed = (await service.read('kid')).days.find((d) => d.studyDay === WED);
    expect(wed).toMatchObject({ state: 'none', makeupOpen: true });
  });

  it('dayRow lays the same credit over a single day', async () => {
    const { service } = build({ table, makeupPolicy: ON });
    await service.read('kid');
    await new Promise((r) => setTimeout(r, 20));
    expect((await service.dayRow('kid', WED)).state).toBe('met');
  });
});
