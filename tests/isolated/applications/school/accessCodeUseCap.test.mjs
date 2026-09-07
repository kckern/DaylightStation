/**
 * A PRINTED CODE IS SPENT AFTER A FEW OPENS (2026-09-06).
 *
 * The two clocks on a code bound how LONG it is typable; nothing bounded how
 * MANY times. A `book-log` code minted at 07:55 was typed thirteen times
 * between 07:56 and 13:01 by someone who was probably not the child whose paper
 * it was printed on — and every one of those resolutions was indistinguishable,
 * in the logs and to the panel, from the first.
 *
 * THE COUNT IS TAKEN ON `/act`, NEVER ON `/resolve`, and that is the fact this
 * file exists to pin. `RunSelfServiceAction` re-resolves the same code on its
 * way in, so one real child interaction produces TWO registry lookups —
 * measured in production as 13 frontend resolutions against 25 backend ones.
 * Counting on the lookup would spend two uses per interaction and halve every
 * cap silently. `/resolve` is also read-only by contract, which is the other
 * half of the same argument.
 *
 * The refusal is a THIRD `reason`, and `ResolveAccessCode`'s header spells out
 * what that costs: a consumer must treat an unrecognised reason as a FAULT, so
 * `useSelfService`'s `isBackendFault` had to learn `used_up` in the same change
 * or a spent code would render as an outage with a Retry button.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ResolveAccessCode } from '#apps/school/usecases/ResolveAccessCode.mjs';
import { RunSelfServiceAction } from '#apps/school/usecases/RunSelfServiceAction.mjs';
import { mintToken, isAccessCodeSpent } from '#domains/school/sessions/tokens.mjs';
import { DEFAULT_ACCESS_CODE_MAX_USES } from '#domains/school/sessions/accessCode.mjs';
import { BOOK_LOG_PROGRAM_ID, BOOK_LOG_SHELF_UNIT_ID } from '#domains/school/bookLog.mjs';
import { appendAssignedProgramEntries } from '#apps/school/assignedProgramPlan.mjs';
import { createTokenBucket } from '#system/utils/tokenBucket.mjs';

const LEARNER_ID = 'kid1';
const NOW_ISO = '2026-09-06T18:00:00.000Z';
const CODE = '482913';
const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** A registry of exactly one record, with the read-modify-write under test. */
function registryOf(record) {
  return {
    record,
    useCalls: 0,
    async getByAccessCode(code) { return code === CODE ? this.record : null; },
    async get() { return this.record; },
    async recordUse(token, { at }) {
      this.useCalls += 1;
      const used = Number.isInteger(this.record.useCount) ? this.record.useCount : 0;
      this.record = { ...this.record, useCount: used + 1, lastUsedAt: at };
      return this.record;
    },
  };
}

function codeRecord({ maxUses = DEFAULT_ACCESS_CODE_MAX_USES } = {}) {
  let n = 0;
  return mintToken({
    tokenClass: 'subject_next',
    subject: {
      learnerId: LEARNER_ID, subject: 'english',
      continueToday: true, program: BOOK_LOG_PROGRAM_ID,
    },
    at: NOW_ISO,
    rng: () => { n += 1; return (n % 97) / 97; },
    expiresAt: '2026-09-13T18:00:00.000Z',
    accessCode: CODE,
    accessCodeExpiresAt: '2026-09-07T11:00:00.000Z',
    ...(maxUses === null ? {} : { maxUses }),
  });
}

/** A plan whose english section offers the shelf — the `program` action path. */
function projectionFor() {
  const assignment = {
    learnerId: LEARNER_ID, courses: [],
    programs: [{ programId: BOOK_LOG_PROGRAM_ID, subject: 'english', title: 'Reading' }],
  };
  const plan = appendAssignedProgramEntries({ entries: [], errors: [] }, assignment);
  return {
    plan,
    async project() {
      return {
        plan,
        sections: [{ subject: 'english', servedToday: false, next: plan.entries[0], progressRows: [] }],
        activeExceptions: [],
        programStatuses: [{
          programId: BOOK_LOG_PROGRAM_ID, programInstance: 'shelf',
          status: {
            enrolled: true, error: false, doneToday: false, terminal: false, reopenable: true,
            context: {
              course: { id: `program:${BOOK_LOG_PROGRAM_ID}`, title: 'Reading log' },
              lesson: { id: BOOK_LOG_SHELF_UNIT_ID, title: 'Reading' },
            },
            progressLabel: null, score: null,
          },
        }],
        projection: { assignment, units: [], sessions: [], works: [], nowIso: NOW_ISO },
      };
    },
  };
}

function build(record) {
  const tokens = registryOf(record);
  const resolver = new ResolveAccessCode({
    tokens,
    curriculum: { async listUnits() { return []; }, async listWorks() { return []; } },
    assignments: { async get() { return { units: [] }; } },
    sessions: {
      async listForLearner() { return []; },
      async readEvents(id) { throw new Error(`test fake: unexpected readEvents(${id})`); },
      async appendEvent(id) { throw new Error(`test fake: /resolve must not write (${id})`); },
    },
    planProjection: projectionFor(),
    clock: () => new Date(NOW_ISO),
    logger: silent,
  });
  const act = new RunSelfServiceAction({
    resolveAccessCode: resolver,
    sessions: { async listForLearner() { return []; } },
    tokens,
    launchers: new Map([[BOOK_LOG_PROGRAM_ID, {
      surface: 'portal',
      async launch() { return { ok: false }; },
      issueLaunchTarget: ({ userId }) => ({
        kind: 'program', program: BOOK_LOG_PROGRAM_ID, learnerId: userId, bookGrant: 'grant',
      }),
    }]]),
    clock: () => new Date(NOW_ISO),
    logger: silent,
  });
  return { tokens, resolver, act };
}

describe('access-code use cap', () => {
  let harness;
  beforeEach(() => { harness = build(codeRecord()); });

  it('spends one use per /act, not per /resolve', async () => {
    // The measured production ratio was ~2 backend resolutions per real
    // interaction. Two bare resolves must leave the count untouched.
    await harness.resolver.resolve({ code: CODE });
    await harness.resolver.resolve({ code: CODE });
    expect(harness.tokens.useCalls).toBe(0);
    expect(harness.tokens.record.useCount).toBeUndefined();

    const answer = await harness.act.execute({ code: CODE, action: 'program' });
    expect(answer.outcome).toBe('mount');
    expect(harness.tokens.useCalls).toBe(1);
    expect(harness.tokens.record.useCount).toBe(1);
  });

  it(`refuses the ${DEFAULT_ACCESS_CODE_MAX_USES + 1}th open, with words and no retry`, async () => {
    for (let i = 0; i < DEFAULT_ACCESS_CODE_MAX_USES; i += 1) {
      const ok = await harness.act.execute({ code: CODE, action: 'program' });
      expect(ok.outcome).toBe('mount');
    }
    expect(harness.tokens.record.useCount).toBe(DEFAULT_ACCESS_CODE_MAX_USES);

    const { card, resolution } = await harness.resolver.resolve({ code: CODE });
    expect(card.ok).toBe(false);
    expect(card.reason).toBe('used_up');
    expect(card.sentence).toMatch(/grown-up/i);
    // Not "Try again." — retyping is exactly what cannot help here.
    expect(card.sentence).not.toMatch(/try again/i);
    expect(resolution).toBeNull();

    // ...and `/act` inherits the same sentence through its `!card.ok` guard.
    const refused = await harness.act.execute({ code: CODE, action: 'program' });
    expect(refused.outcome).toBe('refused');
    expect(refused.sentence).toMatch(/grown-up/i);
  });

  it('does not spend a use on `exit` — looking and leaving is free', async () => {
    const answer = await harness.act.execute({ code: CODE, action: 'exit' });
    expect(answer.outcome).toBe('done');
    expect(harness.tokens.useCalls).toBe(0);
  });

  it('does not spend a use when the action failed', async () => {
    // A printer that would not answer gives the child nothing. Charging them
    // for it turns an outage into a lockout.
    const { tokens, act } = build(codeRecord());
    const answer = await act.execute({ code: CODE, action: 'print' });
    expect(answer.outcome).not.toBe('mount');
    expect(tokens.useCalls).toBe(0);
  });

  it('does not spend a use on a code that was never offered that action', async () => {
    const answer = await harness.act.execute({ code: CODE, action: 'launch' });
    expect(answer.outcome).toBe('refused');
    expect(harness.tokens.useCalls).toBe(0);
  });

  it('keeps working when the registry cannot record the use', async () => {
    // Losing the count is cheaper than retracting work that already happened:
    // the child has their screen either way.
    const { act, tokens } = build(codeRecord());
    tokens.recordUse = async () => { throw new Error('disk full'); };
    const answer = await act.execute({ code: CODE, action: 'program' });
    expect(answer.outcome).toBe('mount');
  });
});

describe('access-code use cap — what it does NOT cap', () => {
  it('an uncapped code (no maxUses) opens without limit', async () => {
    // This is the reading log's shape: `BuildAgenda` mints it with no cap,
    // because "I finished another one" is honest several times a day.
    const { act, tokens } = build(codeRecord({ maxUses: null }));
    expect(tokens.record.maxUses).toBeUndefined();
    for (let i = 0; i < DEFAULT_ACCESS_CODE_MAX_USES + 5; i += 1) {
      const answer = await act.execute({ code: CODE, action: 'program' });
      expect(answer.outcome).toBe('mount');
    }
    expect(tokens.record.useCount).toBe(DEFAULT_ACCESS_CODE_MAX_USES + 5);
  });

  it('isAccessCodeSpent reads an absent count as zero and an absent cap as no limit', () => {
    // Every record written before the cap existed has neither field, and must
    // keep resolving — a migration that retired live paper would be worse than
    // the problem.
    expect(isAccessCodeSpent({ useCount: 99 })).toBe(false);
    expect(isAccessCodeSpent({ maxUses: 3 })).toBe(false);
    expect(isAccessCodeSpent({ maxUses: 3, useCount: 2 })).toBe(false);
    expect(isAccessCodeSpent({ maxUses: 3, useCount: 3 })).toBe(true);
    expect(isAccessCodeSpent(null)).toBe(false);
  });

  it('a spent code stays LIVE, so tomorrow cannot re-mint its digits', async () => {
    // Deliberately not folded into `isAccessCodeLive`: a spent-but-unexpired
    // code must stay in the mint's collision set while its paper is still in a
    // child's hand, or the same six digits could be handed to another learner.
    const { isAccessCodeLive } = await import('#domains/school/sessions/tokens.mjs');
    const spent = { ...codeRecord(), useCount: DEFAULT_ACCESS_CODE_MAX_USES };
    expect(isAccessCodeSpent(spent)).toBe(true);
    expect(isAccessCodeLive(spent, { now: NOW_ISO })).toBe(true);
  });
});

/**
 * THE WRONG-CODE THROTTLE (2026-09-06).
 *
 * 126 `no-live-record` rejections in 14 days arrived in bursts — 8 attempts in
 * 3 minutes, 7 in 65 seconds, 6 in 8 seconds — and nothing rate-limited, backed
 * off, or emitted anything above `info`. Six digits are not guessable in a
 * burst that size, so this is not a brute-force defence; it is there to stop
 * the panel REWARDING hammering, and to make a burst visible in the log store
 * without archaeology.
 *
 * ONLY A REJECTION SPENDS A TOKEN. A child working correctly through several of
 * their own codes is never slowed, however many they type.
 */
describe('wrong-code throttle', () => {
  const BAD = '000001';

  function throttled({ capacity = 3 } = {}) {
    const emptyRegistry = { async getByAccessCode() { return null; } };
    const events = [];
    const resolver = new ResolveAccessCode({
      tokens: emptyRegistry,
      curriculum: { async listUnits() { return []; }, async listWorks() { return []; } },
      assignments: { async get() { return { units: [] }; } },
      sessions: { async listForLearner() { return []; } },
      planProjection: projectionFor(),
      attemptLimiter: createTokenBucket({ capacity, refillPerMinute: 0, now: () => 0 }),
      clock: () => new Date(NOW_ISO),
      logger: { ...silent, warn: (event, data) => events.push({ event, data }) },
    });
    return { resolver, events };
  }

  it('says "Try again." until the allowance runs out, then asks for a pause', async () => {
    const { resolver } = throttled({ capacity: 3 });
    for (let i = 0; i < 3; i += 1) {
      const { card } = await resolver.resolve({ code: BAD, deviceId: 'portal' });
      expect(card.reason).toBe('unknown_code');
      expect(card.sentence).toMatch(/try again/i);
    }
    const { card } = await resolver.resolve({ code: BAD, deviceId: 'portal' });
    expect(card.reason).toBe('slow_down');
    expect(card.sentence).toMatch(/slow down/i);
  });

  it('emits a warn when it trips — a single wrong code is noise, a burst is not', async () => {
    const { resolver, events } = throttled({ capacity: 1 });
    await resolver.resolve({ code: BAD, deviceId: 'portal' });
    expect(events).toHaveLength(0);
    await resolver.resolve({ code: BAD, deviceId: 'portal' });
    expect(events.map((e) => e.event)).toContain('school.selfservice.code.throttled');
  });

  it('buckets per DEVICE, so one screen cannot throttle another', async () => {
    // The reason this is not keyed on `req.ip`: every panel in the house
    // reaches the backend through one reverse proxy, so an IP names the proxy.
    const { resolver } = throttled({ capacity: 1 });
    await resolver.resolve({ code: BAD, deviceId: 'portal' });
    const mine = await resolver.resolve({ code: BAD, deviceId: 'portal' });
    expect(mine.card.reason).toBe('slow_down');

    const other = await resolver.resolve({ code: BAD, deviceId: 'livingroom-tv' });
    expect(other.card.reason).toBe('unknown_code');
  });

  it('never throttles a code that RESOLVES, however many are typed', async () => {
    const { tokens } = build(codeRecord({ maxUses: null }));
    const resolver = new ResolveAccessCode({
      tokens,
      curriculum: { async listUnits() { return []; }, async listWorks() { return []; } },
      assignments: { async get() { return { units: [] }; } },
      sessions: { async listForLearner() { return []; } },
      planProjection: projectionFor(),
      attemptLimiter: createTokenBucket({ capacity: 1, refillPerMinute: 0, now: () => 0 }),
      clock: () => new Date(NOW_ISO),
      logger: silent,
    });
    for (let i = 0; i < 10; i += 1) {
      const { card } = await resolver.resolve({ code: CODE, deviceId: 'portal' });
      expect(card.ok).toBe(true);
    }
  });

  it('fails OPEN when the limiter throws', async () => {
    // The cost of a missed throttle is a few more wrong codes; the cost of a
    // false one is a child locked out of their own work by a blunting device.
    const events = [];
    const resolver = new ResolveAccessCode({
      tokens: { async getByAccessCode() { return null; } },
      curriculum: { async listUnits() { return []; }, async listWorks() { return []; } },
      assignments: { async get() { return { units: [] }; } },
      sessions: { async listForLearner() { return []; } },
      planProjection: projectionFor(),
      attemptLimiter: { take() { throw new Error('boom'); } },
      clock: () => new Date(NOW_ISO),
      logger: { ...silent, warn: (event) => events.push(event) },
    });
    const { card } = await resolver.resolve({ code: BAD, deviceId: 'portal' });
    expect(card.reason).toBe('unknown_code');
    expect(events).toContain('school.selfservice.attempt-limiter-failed');
  });

  it('works with no limiter injected at all', async () => {
    const resolver = new ResolveAccessCode({
      tokens: { async getByAccessCode() { return null; } },
      curriculum: { async listUnits() { return []; }, async listWorks() { return []; } },
      assignments: { async get() { return { units: [] }; } },
      sessions: { async listForLearner() { return []; } },
      planProjection: projectionFor(),
      clock: () => new Date(NOW_ISO),
      logger: silent,
    });
    for (let i = 0; i < 10; i += 1) {
      const { card } = await resolver.resolve({ code: BAD, deviceId: 'portal' });
      expect(card.reason).toBe('unknown_code');
    }
  });
});
