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
              course: { id: `program:${BOOK_LOG_PROGRAM_ID}`, title: 'Independent study' },
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
