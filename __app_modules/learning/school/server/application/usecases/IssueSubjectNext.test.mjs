// @vitest-environment node
/**
 * IssueSubjectNext — "print my next sheet" from any School surface, no code.
 *
 * Real `ResolveSubjectNext`, `GetLearnerDayCompletion` and `PlanProjection`
 * over the committed fixture curriculum and the in-memory session store; only
 * `IssueDocument` is a recording stand-in, so a test can say exactly how many
 * sheets went to the tray and what the printer answered.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IssueSubjectNext } from "./IssueSubjectNext.mjs";
import { ResolveSubjectNext } from "./ResolveSubjectNext.mjs";
import { GetLearnerDayCompletion } from "../GetLearnerDayCompletion.mjs";
import { PlanProjection } from "../PlanProjection.mjs";
import { CurriculumAccess } from "../CurriculumAccess.mjs";
import { OpenRemediation } from "./OpenRemediation.mjs";
import {
  FakeCatalog, FakeSessionRepository, FakeAssignmentStore,
  fakeClock, sequentialIds, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS, WORKSHEET_UNIT, fixtureUnit,
} from '#testlib/school/lifecycleFixtures.mjs';

const LANGUAGE_UNIT = 'language-daily';
const SCIENCE_UNIT = 'sample-science.01';
const PRINT_FAILED = 'The printer did not answer. Try that again in a minute.';
const ON_ITS_WAY = "It's already on its way — give it a minute.";

/** WORKSHEET_UNIT on its own, so it is offered without unit 1 before it. */
const standaloneWorksheet = () => rawUnits({
  [WORKSHEET_UNIT]: { courseId: undefined, sequence: undefined },
});

const recordingLogger = () => {
  const calls = [];
  const at = (level) => (event, data) => calls.push({ level, event, data });
  return { info: at('info'), warn: at('warn'), error: at('error'), debug() {}, calls };
};

/** A recording `IssueDocument`: scripted statuses, one per call, last repeats. */
const issueSpy = (...statuses) => {
  const calls = [];
  return {
    calls,
    canIssueBank: () => false,
    async execute({ sessionId }) {
      calls.push(sessionId);
      const status = statuses[Math.min(calls.length - 1, statuses.length - 1)] ?? 'issued';
      return {
        status, sessionId, artifactId: 'art_1', pageCount: 1,
        message: status === 'issued' ? 'Printing your sheet.' : 'Scan the ticket below to try again.',
      };
    },
  };
};

let clock, sessions, issue, logger, useCase;

const build = ({
  units = [WORKSHEET_UNIT, LANGUAGE_UNIT],
  statuses = ['issued'],
  completion = null,
  roster = [{ id: 'kid1' }, { id: 'grownup1' }],
  rewardFor = null,
  remediationMaxRounds = 2,
} = {}) => {
  clock = fakeClock();
  const catalog = new FakeCatalog({
    units: standaloneWorksheet(), documents: rawDocuments(), manifests: rawManifests(),
  });
  const curriculum = new CurriculumAccess({
    catalog, bankIds: () => BANK_IDS, programIds: () => ['language'],
    clock: clock.epoch, logger: silentLogger,
  });
  sessions = new FakeSessionRepository();
  const assignments = new FakeAssignmentStore([{ learnerId: 'kid1', units }]);
  const launchers = new Map([['language', {
    status: async () => ({ doneToday: false, progressLabel: null, score: null }),
  }]]);
  const planProjection = new PlanProjection({
    curriculum, assignments, sessions, launchers, clock: clock.now, logger: silentLogger,
  });
  const newSessionId = sequentialIds();
  issue = issueSpy(...statuses);
  logger = recordingLogger();
  useCase = new IssueSubjectNext({
    resolveSubjectNext: new ResolveSubjectNext({
      planProjection, curriculum, assignments, sessions, launchers,
      clock: clock.now, newSessionId, logger: silentLogger,
    }),
    getLearnerDayCompletion: completion ?? new GetLearnerDayCompletion({
      planProjection, curriculum, assignments, sessions, launchers, clock: clock.now, logger: silentLogger,
    }),
    planProjection,
    sessions,
    issueDocument: issue,
    openRemediation: new OpenRemediation({
      curriculum, sessions, clock: clock.now, newSessionId, remediationMaxRounds, logger: silentLogger,
    }),
    roster: () => roster,
    rewardFor,
    clock: clock.now,
    logger,
  });
};

beforeEach(() => build());

describe('with no subject named', () => {
  it('prints the first obligated subject that has a sheet, passing over a program', async () => {
    const result = await useCase.execute({ learnerId: 'kid1', deviceId: 'portal' });

    expect(issue.calls).toHaveLength(1);
    expect(result).toMatchObject({
      status: 'issued',
      outcome: 'done',
      sentence: 'Printing your sheet.',
      subject: 'math',
      unit: { unitId: WORKSHEET_UNIT, title: fixtureUnit(WORKSHEET_UNIT).title, subject: 'math' },
    });
    expect(result.sessionId).toBe(issue.calls[0]);
    expect(await sessions.readEvents(result.sessionId)).not.toHaveLength(0);
    expect(logger.calls.find((c) => c.event === 'school.subject-next.printed')?.data).toEqual({
      learnerId: 'kid1', subject: 'math', unitId: WORKSHEET_UNIT, status: 'issued', deviceId: 'portal',
    });
  });

  it('passes over a program sitting first in the plan', async () => {
    build({
      completion: {
        execute: async () => ({
          sections: [
            { subject: 'language', state: 'obligated', reason: null },
            { subject: 'math', state: 'obligated', reason: null },
          ],
        }),
      },
    });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(result).toMatchObject({ status: 'issued', subject: 'math' });
  });

  it('with no paper anywhere, answers for the first candidate and prints nothing', async () => {
    build({ units: [LANGUAGE_UNIT] });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(result).toMatchObject({ status: 'program', outcome: 'refused', subject: 'language' });
    expect(issue.calls).toHaveLength(0);
  });

  it('prefers an obligated subject over an elective one', async () => {
    // Science comes first and is printable, but it is only an elective today.
    build({
      units: [SCIENCE_UNIT, WORKSHEET_UNIT],
      completion: {
        execute: async () => ({
          sections: [
            { subject: 'science', state: 'excused', reason: 'elective_only' },
            { subject: 'math', state: 'obligated', reason: null },
          ],
        }),
      },
    });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(result).toMatchObject({ status: 'issued', subject: 'math' });
  });

  it('falls through to an elective when nothing obligated is left', async () => {
    build({
      units: [SCIENCE_UNIT, WORKSHEET_UNIT],
      completion: {
        execute: async () => ({
          sections: [
            { subject: 'math', state: 'served', reason: null },
            { subject: 'science', state: 'excused', reason: 'elective_only' },
          ],
        }),
      },
    });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(result).toMatchObject({ status: 'issued', subject: 'science', unit: { unitId: SCIENCE_UNIT } });
  });
});

describe('a program subject', () => {
  it('answers with a sentence and prints nothing', async () => {
    const result = await useCase.execute({ learnerId: 'kid1', subject: 'language', deviceId: 'kiosk' });

    expect(issue.calls).toHaveLength(0);
    expect(result.status).toBe('program');
    expect(result.outcome).toBe('refused');
    expect(result.sessionId).toBeNull();
    // The card's own button label, as a sentence — no new template.
    expect(result.sentence).toBe(`Open ${fixtureUnit(LANGUAGE_UNIT).title}.`);
    expect(result.unit).toMatchObject({ unitId: LANGUAGE_UNIT, subject: 'language' });
    expect(logger.calls.find((c) => c.event === 'school.subject-next.refused')?.data).toMatchObject({
      learnerId: 'kid1', subject: 'language', unitId: LANGUAGE_UNIT, status: 'program', deviceId: 'kiosk',
    });
  });
});

describe('the per-learner double-tap debounce', () => {
  it('prints once for two taps inside 20 seconds, and again after', async () => {
    const first = await useCase.execute({ learnerId: 'kid1', deviceId: 'portal' });
    clock.advanceMs(19_000);
    const second = await useCase.execute({ learnerId: 'kid1', subject: 'math', deviceId: 'kiosk' });

    expect(first.status).toBe('issued');
    expect(second).toMatchObject({ status: 'debounced', outcome: 'debounced', sentence: ON_ITS_WAY, sessionId: null });
    expect(issue.calls).toHaveLength(1);
    expect(logger.calls.find((c) => c.event === 'school.subject-next.debounced')?.data).toMatchObject({
      learnerId: 'kid1', subject: 'math', deviceId: 'kiosk', status: 'debounced',
    });

    clock.advanceMs(2_000);
    await useCase.execute({ learnerId: 'kid1' });
    expect(issue.calls).toHaveLength(2);
  });

  it('holds two taps that arrive together to one print', async () => {
    const [a, b] = await Promise.all([
      useCase.execute({ learnerId: 'kid1' }),
      useCase.execute({ learnerId: 'kid1' }),
    ]);
    expect(issue.calls).toHaveLength(1);
    expect([a.status, b.status].sort()).toEqual(['debounced', 'issued']);
  });

  it('is per learner: a sibling tapping at the same moment is not held', async () => {
    build({ roster: [{ id: 'kid1' }, { id: 'kid2' }] });
    await useCase.execute({ learnerId: 'kid1' });
    const sibling = await useCase.execute({ learnerId: 'kid2' });
    expect(sibling.status).not.toBe('debounced');
  });

  it('does not hold a tap that printed nothing', async () => {
    await useCase.execute({ learnerId: 'kid1', subject: 'language' });
    const next = await useCase.execute({ learnerId: 'kid1', subject: 'math' });
    expect(next.status).toBe('issued');
  });
});

describe('a printer that does not answer', () => {
  it('returns the print_failed sentence, and the very next tap retries', async () => {
    build({ statuses: ['print_failed', 'issued'] });
    const failed = await useCase.execute({ learnerId: 'kid1' });
    expect(failed).toMatchObject({ status: 'print_failed', outcome: 'failed', sentence: PRINT_FAILED });

    // No 20 s wait: a failed print put nothing on its way.
    const retried = await useCase.execute({ learnerId: 'kid1' });
    expect(retried.status).toBe('issued');
    expect(retried.sessionId).toBe(failed.sessionId);
    expect(issue.calls).toEqual([failed.sessionId, failed.sessionId]);
  });
});

describe('what it will accept', () => {
  it('refuses a learner who is not on the roster', async () => {
    await expect(useCase.execute({ learnerId: 'stranger' })).rejects.toMatchObject({ name: 'EntityNotFoundError' });
    expect(issue.calls).toHaveLength(0);
  });

  it('refuses a subject that is not one of the learner\'s', async () => {
    await expect(useCase.execute({ learnerId: 'kid1', subject: 'history' })).rejects.toMatchObject({ name: 'ValidationError' });
    // And the refused call did not arm the debounce.
    expect((await useCase.execute({ learnerId: 'kid1' })).status).toBe('issued');
  });

  it('refuses a foreign subject even inside the debounce window', async () => {
    expect((await useCase.execute({ learnerId: 'kid1' })).status).toBe('issued');
    await expect(useCase.execute({ learnerId: 'kid1', subject: 'history' })).rejects.toMatchObject({ name: 'ValidationError' });
  });
});

describe('preview (GET /next)', () => {
  it('names the unit that would print, without opening a session', async () => {
    const result = await useCase.preview({ learnerId: 'kid1' });
    expect(result).toEqual({
      subject: 'math',
      unit: { unitId: WORKSHEET_UNIT, title: fixtureUnit(WORKSHEET_UNIT).title, subject: 'math' },
      printable: true,
      reward: null,
    });
    expect(await sessions.listForLearner('kid1')).toHaveLength(0);
  });

  it('carries the reward port\'s answer, and survives the port throwing', async () => {
    build({ rewardFor: async ({ unit }) => (unit.subject === 'math' ? { silver: 2 } : null) });
    expect((await useCase.preview({ learnerId: 'kid1' })).reward).toEqual({ silver: 2 });

    build({ rewardFor: async () => { throw new Error('economy down'); } });
    const result = await useCase.preview({ learnerId: 'kid1' });
    expect(result.reward).toBeNull();
    expect(result.unit?.unitId).toBe(WORKSHEET_UNIT);
  });
});

/** Grade the session `sessionId` as failed, the way the OMR path records it. */
const failSession = async (sessionId) => {
  for (const event of [
    { type: 'issued', artifactId: `art_${sessionId}` },
    { type: 'submitted', transport: 'paper' },
    { type: 'graded', attemptIds: [`att_${sessionId}`], percent: 20 },
    { type: 'outcome_recorded', outcomeId: `out:${sessionId}`, result: 'needs_remediation' },
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await sessions.appendEvent(sessionId, { ...event, sessionId, at: clock.iso() });
  }
};

describe('a failed attempt (needs_remediation)', () => {
  const failFirstSheet = async () => {
    const first = await useCase.execute({ learnerId: 'kid1', subject: 'math' });
    expect(first.status).toBe('issued');
    await failSession(first.sessionId);
    clock.advanceMs(21_000);
    issue.calls.length = 0;
    return first.sessionId;
  };

  it('with the subject named, opens the retry and prints the fresh sheet', async () => {
    const failed = await failFirstSheet();
    const result = await useCase.execute({ learnerId: 'kid1', subject: 'math' });

    expect(result).toMatchObject({
      status: 'issued', outcome: 'done', sentence: 'Printing a fresh sheet to try again.', subject: 'math',
      unit: { unitId: WORKSHEET_UNIT },
    });
    expect(result.sessionId).not.toBe(failed);
    expect(issue.calls).toEqual([result.sessionId]);
    const created = (await sessions.readEvents(result.sessionId))[0];
    expect(created).toMatchObject({ type: 'created', remediationOf: failed });
  });

  it('with no subject named, a retry counts as paper and wins the button', async () => {
    build({
      completion: {
        execute: async () => ({
          sections: [
            { subject: 'language', state: 'obligated', reason: null },
            { subject: 'math', state: 'obligated', reason: null },
          ],
        }),
      },
    });
    await failFirstSheet();
    const preview = await useCase.preview({ learnerId: 'kid1' });
    expect(preview).toMatchObject({ subject: 'math', printable: true });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(result).toMatchObject({ status: 'issued', subject: 'math', sentence: 'Printing a fresh sheet to try again.' });
    expect(issue.calls).toHaveLength(1);
  });

  it('a capped retry answers with the remediation\'s own sentence and prints nothing', async () => {
    build({ remediationMaxRounds: 1 });
    await failFirstSheet();
    const retry = await useCase.execute({ learnerId: 'kid1', subject: 'math' });
    expect(retry.status).toBe('issued');
    await failSession(retry.sessionId);
    clock.advanceMs(21_000);
    issue.calls.length = 0;

    const capped = await useCase.execute({ learnerId: 'kid1', subject: 'math' });
    expect(issue.calls).toHaveLength(0);
    expect(capped).toMatchObject({ outcome: 'refused', sessionId: null });
    expect(capped.sentence).toMatch(/a grown-up will help/i);
  });
});

describe('through the real composition', () => {
  let harness;
  beforeEach(async () => {
    const { createLifecycleHarness } = await import('#testlib/school/lifecycleHarness.mjs');
    harness = await createLifecycleHarness();
    await harness.assign({ courses: ['sample-science'] });
  });
  afterEach(() => harness?.dispose());

  it('prints the next sheet on the console laser, then holds a double tap', async () => {
    const issueNext = harness.useCases.issueSubjectNext;
    const first = await issueNext.execute({ learnerId: 'kid1', deviceId: 'portal' });
    expect(first).toMatchObject({ status: 'issued', outcome: 'done', subject: 'science', unit: { unitId: SCIENCE_UNIT } });
    expect(harness.printedPdfs()).toHaveLength(1);

    const second = await issueNext.execute({ learnerId: 'kid1', deviceId: 'kiosk' });
    expect(second.status).toBe('debounced');
    expect(harness.printedPdfs()).toHaveLength(1);
    await expect(issueNext.execute({ learnerId: 'nobody' })).rejects.toMatchObject({ name: 'EntityNotFoundError' });
  });

  it('prints a failed attempt\'s fresh sheet through the composed OpenRemediation', async () => {
    const issueNext = harness.useCases.issueSubjectNext;
    const first = await issueNext.execute({ learnerId: 'kid1' });
    for (const event of [
      { type: 'submitted', transport: 'paper' },
      { type: 'graded', attemptIds: ['att_x'], percent: 10 },
      { type: 'outcome_recorded', outcomeId: `out:${first.sessionId}`, result: 'needs_remediation' },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await harness.stores.sessions.appendEvent(first.sessionId, { ...event, sessionId: first.sessionId, at: harness.clock.iso() });
    }
    harness.advanceClock(21_000);
    const retry = await issueNext.execute({ learnerId: 'kid1' });
    expect(retry).toMatchObject({ status: 'issued', sentence: 'Printing a fresh sheet to try again.' });
    expect(retry.sessionId).not.toBe(first.sessionId);
    expect(harness.printedPdfs()).toHaveLength(2);
  });

  it('a printer that is offline answers print_failed, and the next tap heals it', async () => {
    const issueNext = harness.useCases.issueSubjectNext;
    harness.setFault('laser', 'offline');
    const failed = await issueNext.execute({ learnerId: 'kid1' });
    expect(failed).toMatchObject({ status: 'print_failed', outcome: 'failed', sentence: PRINT_FAILED });
    expect(harness.printedPdfs()).toHaveLength(0);

    harness.setFault('laser', null);
    const healed = await issueNext.execute({ learnerId: 'kid1' });
    expect(healed).toMatchObject({ status: 'issued', sessionId: failed.sessionId });
    expect(harness.printedPdfs()).toHaveLength(1);
  });
});
