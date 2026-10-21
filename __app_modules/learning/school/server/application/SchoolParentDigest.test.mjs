import { describe, it, expect } from 'vitest';
import { SchoolParentDigest } from "./SchoolParentDigest.mjs";
import { NotificationIntent } from '#domains/notification/entities/NotificationIntent.mjs';

const TZ = 'America/Los_Angeles';
const NAMES = { learner_a: 'Learner A', learner_b: 'Learner B' };
const section = (state, reason = null) => ({ subject: 'math', state, reason });
const quiet = { info() {}, warn() {}, debug() {} };

// `sections` per learner for today; `days` per learner per earlier study day,
// shaped as TermVerdictService.computeDay answers.
function makeDigest({
  today = '2026-10-20', learners = ['learner_a'], sections = {}, days = {}, economy = {}, events = {},
  sessions = {}, unreadable = [], coins = 'live', zeroDays = 2, teachers = ['parent_a'], deliveries = null,
  boundaryHour = 4, learnerName = (id) => NAMES[id] ?? null, timezone = TZ,
} = {}) {
  const sent = [];
  const logs = [];
  const warns = [];
  const replayed = [];
  const clock = { today };
  const answers = deliveries ? [...deliveries] : null;
  const computed = [];
  const digest = new SchoolParentDigest({
    roster: () => learners.map((id) => ({ id })),
    learnerName,
    getLearnerDayCompletion: {
      execute: async ({ learnerId }) => {
        if (unreadable.includes(learnerId)) throw new Error('replay failed');
        return { state: 'incomplete', faults: [], sections: sections[learnerId] ?? [] };
      },
    },
    // `dayRow` is the cached read the look-back must use; `computeDay` is
    // the uncached replay it must not.
    termVerdicts: {
      dayRow: async (learnerId, day) => {
        computed.push(`${learnerId}:${day}`);
        return days[learnerId]?.[day] ?? { state: 'exempt', reason: 'not_a_school_day', served: 0, asked: 0 };
      },
      computeDay: async (learnerId, day) => { replayed.push(`${learnerId}:${day}`); return { state: 'unknown', served: 0, asked: 0 }; },
    },
    economyToday: async (learnerId) => economy[learnerId] ?? null,
    coinsMode: () => coins,
    zeroDaysAlert: () => zeroDays,
    ledger: { readDay: async (day) => events[day] ?? [] },
    learnerSessionIds: async (learnerId) => new Set(sessions[learnerId] ?? []),
    notifications: {
      send: async (raw) => {
        sent.push(new NotificationIntent(raw));
        const answer = answers?.length ? answers.shift() : 'delivered';
        if (answer === 'suppressed') return [{ delivered: false, suppressed: true, reason: 'quiet_hours', channel: null }];
        if (answer === 'cooldown') return [{ delivered: false, suppressed: true, reason: 'cooldown', channel: null }];
        if (answer === 'failed') return [{ delivered: false, channel: 'telegram', error: 'bot blocked' }];
        if (answer === 'throw') throw new Error('network down');
        return [{ delivered: true, channel: 'telegram' }];
      },
    },
    teachers: () => teachers,
    today: () => clock.today,
    timezone,
    boundaryHour,
    logger: { ...quiet, info: (event, data) => logs.push([event, data]), warn: (event, data) => warns.push([event, data]) },
  });
  return { digest, sent, computed, replayed, logs, warns, clock };
}

const digests = (sent) => sent.filter((i) => i.dedupeKey?.startsWith('digest:'));
const zeros = (sent) => sent.filter((i) => i.dedupeKey?.startsWith('zero:'));

describe('SchoolParentDigest — the digest', () => {
  it('writes one line per child for a mixed day, to each teacher', async () => {
    const { digest, sent } = makeDigest({
      learners: ['learner_a', 'learner_b'],
      teachers: ['parent_a', 'parent_b'],
      sections: {
        learner_a: [section('served'), section('served'), section('obligated'), section('excused', 'household_calendar')],
        learner_b: [section('excused', 'not_a_school_day')],
      },
      economy: { learner_a: { silverEarned: 5, passesUsed: 1 }, learner_b: { silverEarned: 0, passesUsed: 0 } },
      sessions: { learner_a: ['ses_a1'], learner_b: ['ses_b1'] },
      events: {
        '2026-10-20': [
          // 3 am local belongs to the previous study day.
          { ts: '2026-10-20T03:00:00.000-07:00', event: 'school.selfservice.code.rejected', data: { reason: 'expired', learnerId: 'learner_a' } },
          { ts: '2026-10-20T09:00:00.000-07:00', event: 'school.selfservice.code.rejected', data: { reason: 'used_up', learnerId: 'learner_a' } },
          { ts: '2026-10-20T10:00:00.000-07:00', event: 'school.selfservice.action.use-case-failed', data: { sessionId: 'ses_a1', status: 'print_failed' } },
          { ts: '2026-10-20T07:30:00.000-07:00', event: 'school.issue.failed', data: { sessionId: 'ses_b1', stage: 'print', reason: 'timeout' } },
          // A rejection nobody can be named for is nobody's failure.
          { ts: '2026-10-20T06:00:00.000-07:00', event: 'school.selfservice.code.rejected', data: { reason: 'no-live-record', learnerId: null } },
        ],
      },
    });
    const result = await digest.run({ studyDay: '2026-10-20' });
    expect(result.digest).toBe('sent');
    const out = digests(sent);
    expect(out.map((i) => i.metadata.username)).toEqual(['parent_a', 'parent_b']);
    expect(out[0]).toMatchObject({ title: 'School today', category: 'school', dedupeKey: 'digest:2026-10-20' });
    expect(out[0].body.split('\n')).toEqual([
      'Learner A: 2 of 3 done · 5 silver · 1 pass used · a print failed',
      'Learner B: nothing asked · a print failed',
    ]);
    expect(out[0].metadata.pushData).toMatchObject({ tag: 'school-digest', channel: 'School progress' });
  });

  it('says the coins are not live in dry-run, from the ledger only', async () => {
    const { digest, sent } = makeDigest({
      sections: { learner_a: [section('served')] },
      economy: { learner_a: { silverEarned: 0, passesUsed: 0 } },
      coins: 'dry-run',
    });
    await digest.run({});
    expect(digests(sent)[0].body).toBe('Learner A: 1 of 1 done\nCoins not live yet');
  });

  it('keeps a child whose day could not be read, and says so', async () => {
    const { digest, sent } = makeDigest({
      learners: ['learner_a', 'learner_b'], sections: { learner_b: [section('served')] }, unreadable: ['learner_a'],
    });
    await digest.run({});
    expect(digests(sent)[0].body.split('\n')).toEqual(["Learner A: couldn't be checked", 'Learner B: 1 of 1 done']);
  });

  it('reads a self-service print failure as a print failure', async () => {
    const { digest, sent } = makeDigest({
      sections: { learner_a: [section('obligated')] },
      sessions: { learner_a: ['ses_a1'] },
      events: { '2026-10-20': [
        { ts: '2026-10-20T08:00:00.000-07:00', event: 'school.selfservice.action.failed', data: { stage: 'print', sessionId: 'ses_a1', error: 'immutable' } },
      ] },
    });
    await digest.run({ studyDay: '2026-10-20' });
    expect(digests(sent)[0].body).toBe('Learner A: 0 of 1 done · a print failed');
  });

  it('names an expired code for its learner, never a code nobody issued', async () => {
    const { digest, sent } = makeDigest({
      learners: ['learner_a', 'learner_b'],
      sections: { learner_a: [section('served')], learner_b: [section('served')] },
      events: { '2026-10-20': [
        { ts: '2026-10-20T08:00:00.000-07:00', event: 'school.selfservice.code.rejected', data: { reason: 'no-live-record', learnerId: null } },
        { ts: '2026-10-20T09:00:00.000-07:00', event: 'school.selfservice.code.rejected', data: { reason: 'expired', learnerId: 'learner_b' } },
      ] },
    });
    await digest.run({ studyDay: '2026-10-20' });
    expect(digests(sent)[0].body.split('\n')).toEqual(['Learner A: 1 of 1 done', 'Learner B: 1 of 1 done · an old code was typed']);
  });

  it('shows the most actionable failure: a print over a sheet over a code, earliest within a rank', async () => {
    const at = (h) => `2026-10-20T${String(h).padStart(2, '0')}:00:00.000-07:00`;
    const { digest, sent } = makeDigest({
      sections: { learner_a: [section('served')] },
      events: { '2026-10-20': [
        { ts: at(7), event: 'school.selfservice.code.rejected', data: { reason: 'expired', learnerId: 'learner_a' } },
        { ts: at(8), event: 'school.issue.failed', data: { learnerId: 'learner_a', stage: 'render' } },
        { ts: at(11), event: 'school.issue.failed', data: { learnerId: 'learner_a', stage: 'print' } },
        { ts: at(10), event: 'school.card.print-failed', data: { learnerId: 'learner_a', offers: 2 } },
      ] },
    });
    await digest.run({ studyDay: '2026-10-20' });
    expect(digests(sent)[0].body).toBe('Learner A: 1 of 1 done · a print failed');
  });

  it('reads a card print failure by its learner', async () => {
    const { digest, sent } = makeDigest({
      sections: { learner_a: [section('served')] },
      events: { '2026-10-20': [{ ts: '2026-10-20T08:00:00.000-07:00', event: 'school.card.print-failed', data: { learnerId: 'learner_a', offers: 1 } }] },
    });
    await digest.run({ studyDay: '2026-10-20' });
    expect(digests(sent)[0].body).toBe('Learner A: 1 of 1 done · a print failed');
  });

  it('leaves out a used-up code: retyping one is normal', async () => {
    const { digest, sent } = makeDigest({
      sections: { learner_a: [section('served')] },
      events: { '2026-10-20': [{ ts: '2026-10-20T08:00:00.000-07:00', event: 'school.selfservice.code.rejected', data: { reason: 'used_up', learnerId: 'learner_a' } }] },
    });
    await digest.run({ studyDay: '2026-10-20' });
    expect(digests(sent)[0].body).toBe('Learner A: 1 of 1 done');
  });

  it('links a failure to a child by session alone', async () => {
    const { digest, sent } = makeDigest({
      learners: ['learner_a', 'learner_b'],
      sections: { learner_a: [section('served')], learner_b: [section('served')] },
      sessions: { learner_b: ['ses_b9'] },
      events: { '2026-10-20': [{ ts: '2026-10-20T08:00:00.000-07:00', event: 'school.issue.failed', data: { sessionId: 'ses_b9', stage: 'print' } }] },
    });
    await digest.run({ studyDay: '2026-10-20' });
    expect(digests(sent)[0].body.split('\n')).toEqual(['Learner A: 1 of 1 done', 'Learner B: 1 of 1 done · a print failed']);
  });

  it('draws the window right on the day the clocks fall back', async () => {
    // 2026-11-01: PDT ends at 2 am, so the 4 am boundary is 04:00 PST (12:00Z).
    const { digest, sent } = makeDigest({
      today: '2026-11-01', sections: { learner_a: [section('served')] },
      events: { '2026-11-01': [
        { ts: '2026-11-01T03:30:00.000-08:00', event: 'school.card.print-failed', data: { learnerId: 'learner_a' } },
        { ts: '2026-11-01T04:30:00.000-08:00', event: 'school.selfservice.code.rejected', data: { reason: 'expired', learnerId: 'learner_a' } },
      ] },
    });
    await digest.run({ studyDay: '2026-11-01' });
    expect(digests(sent)[0].body).toBe('Learner A: 1 of 1 done · an old code was typed');
  });

  it('numbers a child whose name lookup throws, and warns', async () => {
    const { digest, sent, warns } = makeDigest({
      sections: { learner_a: [section('served')] },
      learnerName: () => { throw new Error('profile unreadable'); },
    });
    await digest.run({});
    expect(digests(sent)[0].body).toBe('A learner (1): 1 of 1 done');
    expect(warns.map(([e]) => e)).toContain('school.parent-digest.name-failed');
  });

  it('logs a thrown send once', async () => {
    const { digest, warns } = makeDigest({ sections: { learner_a: [section('served')] }, deliveries: ['throw'] });
    expect((await digest.run({})).digest).toBe('failed');
    const failed = warns.filter(([e]) => e === 'school.parent-digest.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0][1]).toMatchObject({ studyDay: '2026-10-20', error: 'network down' });
  });

  it('draws the ledger window on the study calendar boundary it was given', async () => {
    const at = (hour) => ({ ts: `2026-10-20T0${hour}:30:00.000-07:00`, event: 'school.issue.failed', data: { learnerId: 'learner_a', stage: 'render' } });
    const early = makeDigest({ boundaryHour: 6, sections: { learner_a: [section('served')] }, events: { '2026-10-20': [at(5)] } });
    await early.digest.run({ studyDay: '2026-10-20' });
    expect(early.sent[0].body).toBe('Learner A: 1 of 1 done');
    const late = makeDigest({ boundaryHour: 4, sections: { learner_a: [section('served')] }, events: { '2026-10-20': [at(5)] } });
    await late.digest.run({ studyDay: '2026-10-20' });
    expect(late.sent[0].body).toBe("Learner A: 1 of 1 done · a sheet couldn't be made");
  });

  it('logs a skip when every teacher already has the day', async () => {
    const { digest, logs } = makeDigest({ sections: { learner_a: [section('served')] } });
    await digest.run({});
    const second = await digest.run({});
    expect(second.digest).toBe('skipped');
    expect(logs).toContainEqual(['school.parent-digest.skipped', { studyDay: '2026-10-20', reason: 'already-sent' }]);
  });

  it('sends nothing when no teacher is configured', async () => {
    const { digest, sent } = makeDigest({ teachers: [], sections: { learner_a: [section('served')] } });
    const result = await digest.run({});
    expect(result.digest).toBe('skipped');
    expect(sent).toEqual([]);
  });

  it('does not send the same day twice', async () => {
    const { digest, sent } = makeDigest({ sections: { learner_a: [section('served')] } });
    await digest.run({});
    await digest.run({});
    expect(digests(sent)).toHaveLength(1);
  });
});

describe('SchoolParentDigest — two empty study days', () => {
  const nothingDone = [section('obligated'), section('obligated')];

  it('fires when today and the previous study day both had work and none done', async () => {
    const { digest, sent } = makeDigest({
      sections: { learner_a: nothingDone },
      days: { learner_a: { '2026-10-19': { state: 'none', served: 0, asked: 2 } } },
    });
    const result = await digest.run({ studyDay: '2026-10-20' });
    expect(result.zeroDays).toEqual(['learner_a']);
    const [alert] = zeros(sent);
    expect(alert).toMatchObject({
      title: '📭 Learner A — School', body: 'Nothing done for the second study day in a row',
      dedupeKey: 'zero:learner_a:2026-10-20', urgency: 'high', category: 'school',
    });
    expect(alert.metadata.pushData).toMatchObject({ channel: 'School needs you' });
  });

  it('counts the whole run, so a third empty day says third', async () => {
    const { digest, sent } = makeDigest({
      sections: { learner_a: nothingDone },
      days: { learner_a: {
        '2026-10-19': { state: 'none', served: 0, asked: 2 },
        '2026-10-18': { state: 'exempt', served: 0, asked: 0 },
        '2026-10-17': { state: 'none', served: 0, asked: 1 },
        '2026-10-16': { state: 'met', served: 1, asked: 1 },
      } },
    });
    await digest.run({ studyDay: '2026-10-20' });
    expect(zeros(sent)[0].body).toBe('Nothing done for the third study day in a row');
  });

  it('ends the run at a day that cannot be judged, and still fires on what it counted', async () => {
    const { digest, sent } = makeDigest({
      sections: { learner_a: nothingDone },
      days: { learner_a: {
        '2026-10-19': { state: 'none', served: 0, asked: 2 },
        '2026-10-18': { state: 'unknown', reason: 'replay_failed', served: 0, asked: 0 },
        '2026-10-17': { state: 'none', served: 0, asked: 1 },
      } },
    });
    await digest.run({ studyDay: '2026-10-20' });
    expect(zeros(sent)[0].body).toBe('Nothing done for the second study day in a row');
  });

  it('walks back through the cached day rows, never an uncached replay', async () => {
    const { digest, computed, replayed } = makeDigest({
      sections: { learner_a: nothingDone },
      days: { learner_a: { '2026-10-19': { state: 'none', served: 0, asked: 2 }, '2026-10-16': { state: 'met', served: 1, asked: 1 } } },
    });
    await digest.run({ studyDay: '2026-10-20' });
    expect(computed).toEqual(['learner_a:2026-10-19', 'learner_a:2026-10-18', 'learner_a:2026-10-17', 'learner_a:2026-10-16']);
    expect(replayed).toEqual([]);
  });

  it('names the day on a zero-days push held overnight', async () => {
    const { digest, sent, clock } = makeDigest({
      // The zero-days push goes first (held), then the digest, then the retry.
      sections: { learner_a: nothingDone }, deliveries: ['suppressed', 'delivered', 'delivered'],
      days: { learner_a: { '2026-10-19': { state: 'none', served: 0, asked: 2 } } },
    });
    await digest.run({ studyDay: '2026-10-20' });
    clock.today = '2026-10-21';
    await digest.retryHeld();
    expect(zeros(sent).map((i) => i.body)).toEqual([
      'Nothing done for the second study day in a row',
      'Nothing done for the second study day in a row · from Tue Oct 20',
    ]);
  });

  it('does not fire on one empty day', async () => {
    const { digest, sent } = makeDigest({
      sections: { learner_a: nothingDone },
      days: { learner_a: { '2026-10-19': { state: 'met', served: 2, asked: 2 } } },
    });
    await digest.run({ studyDay: '2026-10-20' });
    expect(zeros(sent)).toEqual([]);
  });

  it('does not fire on a weekend with nothing asked', async () => {
    const { digest, sent } = makeDigest({ today: '2026-10-18', sections: { learner_a: [] } });
    await digest.run({ studyDay: '2026-10-18' });
    expect(zeros(sent)).toEqual([]);
  });

  it('skips a weekend with nothing asked to find the previous study day', async () => {
    const met = makeDigest({
      today: '2026-10-19', sections: { learner_a: nothingDone },
      days: { learner_a: { '2026-10-16': { state: 'met', served: 1, asked: 1 } } },
    });
    await met.digest.run({ studyDay: '2026-10-19' });
    expect(zeros(met.sent)).toEqual([]);
    expect(met.computed).toEqual(['learner_a:2026-10-18', 'learner_a:2026-10-17', 'learner_a:2026-10-16']);

    const empty = makeDigest({
      today: '2026-10-19', sections: { learner_a: nothingDone },
      days: { learner_a: { '2026-10-16': { state: 'none', served: 0, asked: 3 } } },
    });
    await empty.digest.run({ studyDay: '2026-10-19' });
    expect(zeros(empty.sent).map((i) => i.dedupeKey)).toEqual(['zero:learner_a:2026-10-19']);
  });

  it('does not fire when the previous study day could not be judged', async () => {
    const { digest, sent } = makeDigest({
      sections: { learner_a: nothingDone },
      days: { learner_a: { '2026-10-19': { state: 'unknown', reason: 'replay_failed', served: 0, asked: 0 } } },
    });
    await digest.run({ studyDay: '2026-10-20' });
    expect(zeros(sent)).toEqual([]);
  });

  it('is off when the catalog sets no threshold', async () => {
    const { digest, sent, computed } = makeDigest({
      zeroDays: null, sections: { learner_a: nothingDone },
      days: { learner_a: { '2026-10-19': { state: 'none', served: 0, asked: 2 } } },
    });
    await digest.run({ studyDay: '2026-10-20' });
    expect(zeros(sent)).toEqual([]);
    expect(computed).toEqual([]);
  });
});

describe('SchoolParentDigest — a held push', () => {
  it('retries a suppressed send until it is delivered, then stops', async () => {
    const { digest, sent } = makeDigest({ sections: { learner_a: [section('served')] }, deliveries: ['suppressed', 'suppressed', 'delivered'] });
    const result = await digest.run({ studyDay: '2026-10-20' });
    expect(result.digest).toBe('suppressed');
    expect(await digest.retryHeld()).toEqual({ sent: 0, held: 1 });
    expect(await digest.retryHeld()).toEqual({ sent: 1, held: 0 });
    expect(await digest.retryHeld()).toEqual({ sent: 0, held: 0 });
    expect(digests(sent).map((i) => i.dedupeKey)).toEqual(['digest:2026-10-20', 'digest:2026-10-20', 'digest:2026-10-20']);
  });

  it('never retries a cooldown: the push already reached that teacher', async () => {
    const { digest, sent, logs } = makeDigest({ sections: { learner_a: [section('served')] }, deliveries: ['cooldown'] });
    const result = await digest.run({ studyDay: '2026-10-20' });
    expect(result.digest).toBe('skipped');
    expect(await digest.retryHeld()).toEqual({ sent: 0, held: 0 });
    await digest.run({ studyDay: '2026-10-20' });
    expect(digests(sent)).toHaveLength(1);
    expect(logs).toContainEqual(['school.parent-digest.skipped', { studyDay: '2026-10-20', reason: 'already-sent' }]);
  });

  it('holds per teacher: a quiet-hours hold for one, a cooldown for the other', async () => {
    const { digest, sent } = makeDigest({
      teachers: ['parent_a', 'parent_b'], sections: { learner_a: [section('served')] }, deliveries: ['suppressed', 'cooldown', 'delivered'],
    });
    expect((await digest.run({ studyDay: '2026-10-20' })).digest).toBe('suppressed');
    expect(await digest.retryHeld()).toEqual({ sent: 1, held: 0 });
    expect(digests(sent).map((i) => i.metadata.username)).toEqual(['parent_a', 'parent_b', 'parent_a']);
  });

  it('dates a digest held past its day', async () => {
    const { digest, sent, clock } = makeDigest({ sections: { learner_a: [section('served')] }, deliveries: ['suppressed', 'delivered'] });
    await digest.run({ studyDay: '2026-10-20' });
    clock.today = '2026-10-21';
    expect(await digest.retryHeld()).toEqual({ sent: 1, held: 0 });
    expect(digests(sent).map((i) => i.title)).toEqual(['School today', 'School · Tue Oct 20']);
    expect(digests(sent)[1].body).toBe('Learner A: 1 of 1 done');
  });

  it('gives up a held push whose retry fails, and says so', async () => {
    const { digest, warns } = makeDigest({ sections: { learner_a: [section('served')] }, deliveries: ['suppressed', 'failed'] });
    await digest.run({ studyDay: '2026-10-20' });
    expect(await digest.retryHeld()).toEqual({ sent: 0, held: 0 });
    expect(await digest.retryHeld()).toEqual({ sent: 0, held: 0 });
    expect(warns.filter(([e]) => e === 'school.parent-digest.failed')).toHaveLength(1);
  });

  it('drops a push still held when the next day runs', async () => {
    const day1 = makeDigest({ sections: { learner_a: [section('served')] }, deliveries: ['suppressed'] });
    await day1.digest.run({ studyDay: '2026-10-19' });
    await day1.digest.run({ studyDay: '2026-10-20' });
    expect(await day1.digest.retryHeld()).toEqual({ sent: 0, held: 0 });
    expect(day1.logs.map(([e]) => e)).toContain('school.parent-digest.dropped');
    expect(digests(day1.sent).map((i) => i.dedupeKey)).toEqual(['digest:2026-10-19', 'digest:2026-10-20']);
  });
});
