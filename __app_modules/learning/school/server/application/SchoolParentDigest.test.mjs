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
} = {}) {
  const sent = [];
  const answers = deliveries ? [...deliveries] : null;
  const computed = [];
  const digest = new SchoolParentDigest({
    roster: () => learners.map((id) => ({ id })),
    learnerName: (id) => NAMES[id] ?? null,
    getLearnerDayCompletion: {
      execute: async ({ learnerId }) => {
        if (unreadable.includes(learnerId)) throw new Error('replay failed');
        return { state: 'incomplete', faults: [], sections: sections[learnerId] ?? [] };
      },
    },
    termVerdicts: {
      computeDay: async (learnerId, day) => {
        computed.push(`${learnerId}:${day}`);
        return days[learnerId]?.[day] ?? { state: 'exempt', reason: 'not_a_school_day', served: 0, asked: 0 };
      },
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
        return answer === 'suppressed'
          ? [{ delivered: false, suppressed: true, reason: 'quiet_hours', channel: null }]
          : [{ delivered: true, channel: 'telegram' }];
      },
    },
    teachers: () => teachers,
    today: () => today,
    timezone: TZ,
    logger: quiet,
  });
  return { digest, sent, computed };
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
      'Learner A: 2 of 3 done · 5 silver · 1 pass used · a code was turned away',
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

  it('drops a push still held when the next day runs', async () => {
    const day1 = makeDigest({ sections: { learner_a: [section('served')] }, deliveries: ['suppressed'] });
    await day1.digest.run({ studyDay: '2026-10-19' });
    await day1.digest.run({ studyDay: '2026-10-20' });
    expect(await day1.digest.retryHeld()).toEqual({ sent: 0, held: 0 });
    expect(digests(day1.sent).map((i) => i.dedupeKey)).toEqual(['digest:2026-10-19', 'digest:2026-10-20']);
  });
});
