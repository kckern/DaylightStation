/**
 * Regression coverage for the 2026-08-25 incident: a learner scored 100% on
 * scripture, the result receipt offered "One more?" as BOTH a QR and a
 * six-digit panel code for the identical `subject_next` token (minted with
 * `subject.continueToday: true` at `CloseSessionOutcome.mjs`). Typing the
 * code was refused with `kind: 'served'` — the panel path
 * (`ResolveAccessCode#resolve`) ignored `continueToday` entirely, while the
 * scan path (`ResolveSubjectNext`) already honoured it. Both resolvers must
 * agree on what the same token means.
 */
import { describe, expect, it } from 'vitest';
import { ResolveAccessCode } from './ResolveAccessCode.mjs';
import { ResolveSubjectNext } from './ResolveSubjectNext.mjs';
import { mintToken } from '#domains/school/sessions/tokens.mjs';

const LEARNER_ID = 'felix';
const SUBJECT = 'scripture';
const NOW_ISO = '2026-08-25T18:00:00.000Z';

const unitA = { unitId: 'scripture-a', title: 'Scripture A', subject: SUBJECT };
const unitB = { unitId: 'scripture-b', title: 'Scripture B', subject: SUBJECT };

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

function makeCurriculum() {
  return {
    async listUnits() { return [unitA, unitB]; },
    async listWorks() { return []; },
  };
}

function makeAssignments() {
  return { async get() { return { units: ['scripture-a', 'scripture-b'] }; } };
}

/** `servedHistory: true` seeds a `passed` session for unit A, dated `now` —
 * the shape that makes the scripture section `servedToday`. */
function makeSessions({ served }) {
  const history = served ? [{
    sessionId: 'session-a',
    learnerId: LEARNER_ID,
    unitId: unitA.unitId,
    state: 'outcome_recorded',
    terminal: true,
    outcome: { result: 'passed', at: NOW_ISO },
    gradedPercent: 100,
    updatedAt: NOW_ISO,
  }] : [];
  const appended = [];
  return {
    appended,
    async listForLearner() { return history; },
    async readEvents(sessionId) {
      throw new Error(`test fake: unexpected readEvents(${sessionId})`);
    },
    async appendEvent(sessionId, event) {
      const stored = { ...event, seq: 1 };
      appended.push({ sessionId, event: stored });
      return stored;
    },
  };
}

function makeAccessCodeResolver({ sessions }) {
  return new ResolveAccessCode({
    tokens: null, // overridden per-test via getByAccessCode below
    curriculum: makeCurriculum(),
    assignments: makeAssignments(),
    sessions,
    clock: () => new Date(NOW_ISO),
    logger: noopLogger,
  });
}

function makeAccessCodeResolverWithToken({ sessions, record }) {
  const resolver = new ResolveAccessCode({
    tokens: { async getByAccessCode() { return record; } },
    curriculum: makeCurriculum(),
    assignments: makeAssignments(),
    sessions,
    clock: () => new Date(NOW_ISO),
    logger: noopLogger,
  });
  return resolver;
}

function makeSubjectNextResolver({ sessions }) {
  return new ResolveSubjectNext({
    curriculum: makeCurriculum(),
    assignments: makeAssignments(),
    sessions,
    newSessionId: () => 'session-new-1',
    clock: () => new Date(NOW_ISO),
    logger: noopLogger,
  });
}

function tokenRecord({ continueToday }) {
  const rng = (() => {
    let n = 0;
    return () => { n += 1; return (n % 97) / 97; };
  })();
  return mintToken({
    tokenClass: 'subject_next',
    subject: { learnerId: LEARNER_ID, subject: SUBJECT, ...(continueToday ? { continueToday: true } : {}) },
    at: NOW_ISO,
    rng,
    accessCode: '482913',
    accessCodeExpiresAt: '2026-08-26T04:00:00.000Z',
  });
}

describe('ResolveAccessCode — continueToday parity with ResolveSubjectNext', () => {
  it('WITH continueToday, subject already served today ⇒ resolves to a real next entry, not "served"', async () => {
    const sessions = makeSessions({ served: true });
    const record = tokenRecord({ continueToday: true });
    const resolver = makeAccessCodeResolverWithToken({ sessions, record });

    const { card, resolution } = await resolver.resolve({ code: '482913' });

    expect(resolution).not.toBeNull();
    expect(resolution.kind).not.toBe('served');
    expect(resolution.kind).toBe('move');
    expect(resolution.entry?.unitId).toBe(unitB.unitId);
    expect(card.ok).toBe(true);
  });

  it('WITHOUT continueToday, subject already served today ⇒ still "served" (the guard)', async () => {
    const sessions = makeSessions({ served: true });
    const record = tokenRecord({ continueToday: false });
    const resolver = makeAccessCodeResolverWithToken({ sessions, record });

    const { card, resolution } = await resolver.resolve({ code: '482913' });

    expect(resolution.kind).toBe('served');
    expect(card.ok).toBe(true);
    expect(card.sentence).toMatch(/already did this today/i);
  });

  it('WITH continueToday, subject NOT served ⇒ unchanged behaviour', async () => {
    const sessions = makeSessions({ served: false });
    const record = tokenRecord({ continueToday: true });
    const resolver = makeAccessCodeResolverWithToken({ sessions, record });

    const { resolution } = await resolver.resolve({ code: '482913' });

    expect(resolution.kind).toBe('move');
    expect(resolution.entry?.unitId).toBe(unitA.unitId);
  });

  it('agrees with ResolveSubjectNext (the scan path) on the same learner/subject/token', async () => {
    const codeSessions = makeSessions({ served: true });
    const scanSessions = makeSessions({ served: true });
    const codeResolver = makeAccessCodeResolverWithToken({
      sessions: codeSessions, record: tokenRecord({ continueToday: true }),
    });
    const scanResolver = makeSubjectNextResolver({ sessions: scanSessions });

    const { resolution: codeResolution } = await codeResolver.resolve({ code: '482913' });
    const scanResolution = await scanResolver.execute({
      learnerId: LEARNER_ID, subject: SUBJECT, continueToday: true,
    });

    expect(codeResolution.kind).toBe(scanResolution.kind);
    expect(codeResolution.entry?.unitId).toBe(scanResolution.entry?.unitId);
  });
});
