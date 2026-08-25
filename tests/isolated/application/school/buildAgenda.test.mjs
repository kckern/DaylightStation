import { describe, it, expect, beforeEach } from 'vitest';
import { BuildAgenda } from '#apps/school/usecases/BuildAgenda.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { validateDocument } from '#domains/school/documents/documentValidation.mjs';
import { isSchoolToken } from '#domains/school/sessions/tokens.mjs';
import { studyDayWindow } from '#domains/school/studyDay.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeTokenRegistry, FakeAssignmentStore, FakeReviewQueue,
  fakeClock, seededRng, sequentialIds, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS,
  MEDIA_UNIT, MEDIA_BANK_ID, WORKSHEET_UNIT, OMR_UNIT, MIXED_UNIT, fixtureUnit,
} from '#testlib/school/lifecycleFixtures.mjs';

// A program id used only by the launcher-path tests below. Registered with
// CurriculumAccess in every test so a test can turn WORKSHEET_UNIT into a
// program unit without repeating the plumbing.
const PROGRAM_ID = 'lang-app';

let clock, catalog, curriculum, sessions, tokens, assignments, reviewQueue, useCase;

/**
 * The shared fake registry plus the one method the self-service path needs:
 * the codes that are still live, as a Set the mint can test synchronously.
 * Local to this suite rather than pushed into `lifecycleFakes` (that widening
 * belongs to the registry's own task), and deliberately not the YAML adapter —
 * nothing here should depend on how a code is stored.
 */
class CodeAwareTokenRegistry extends FakeTokenRegistry {
  async liveAccessCodes() {
    return new Set(this.all().filter((r) => r.accessCode && !r.revokedAt).map((r) => r.accessCode));
  }
}

const build = ({
  assignment = { learnerId: 'kid1', courses: ['math-fractions'] }, units, launchers = new Map(),
  timezone = null, schoolCalcStudies = null, schoolCalcMode = 'off',
  selfService = null, subjectTokenTtlHours, rng = seededRng(7), tokenRegistry = null,
  logger = silentLogger,
} = {}) => {
  clock = fakeClock();
  catalog = new FakeCatalog({ units: units ?? rawUnits(), documents: rawDocuments(), manifests: rawManifests() });
  curriculum = new CurriculumAccess({
    catalog, bankIds: () => BANK_IDS, programIds: () => [PROGRAM_ID], clock: clock.epoch, logger: silentLogger,
  });
  sessions = new FakeSessionRepository();
  tokens = tokenRegistry ?? new CodeAwareTokenRegistry();
  assignments = new FakeAssignmentStore(assignment ? [assignment] : []);
  reviewQueue = new FakeReviewQueue();
  useCase = new BuildAgenda({
    curriculum, assignments, sessions, tokens, launchers, reviewQueue, timezone,
    schoolCalcStudies, schoolCalcMode, selfService,
    ...(subjectTokenTtlHours === undefined ? {} : { subjectTokenTtlHours }),
    clock: clock.now, rng, newSessionId: sequentialIds(),
    logger,
  });
};

beforeEach(() => build());

/** Turn WORKSHEET_UNIT into a standalone program unit in a different subject —
 * used only by the launcher-path tests, so "still yields other subjects" has
 * a second, independently-gated subject to check. */
const withLanguageProgram = (assignmentUnits = []) => ({
  units: rawUnits({
    [WORKSHEET_UNIT]: {
      subject: 'language', program: PROGRAM_ID, cadence: 'once',
      courseId: undefined, sequence: undefined, passing: undefined,
      retry: undefined, reward: undefined, review: undefined, document: undefined,
    },
  }),
  assignment: { learnerId: 'kid1', courses: ['math-fractions'], units: [WORKSHEET_UNIT, ...assignmentUnits] },
});

const offerFor = (result, subject) => result.offers.find((o) => o.subject === subject);
const sectionFor = (result, subject) => result.sections.find((s) => s.subject === subject);
const actions = (doc) => doc.blocks.filter((b) => b.type === 'scan_action');
const transcript = (doc) => doc.blocks.map((b) => b.md ?? b.label ?? '').join('\n');

describe('the agenda document', () => {
  it('prints Hoffman as a structured course/unit/lesson with a QR and panel code', async () => {
    const status = {
      doneToday: false,
      score: 10,
      progressLabel: '34/344 · next: Lesson 3',
      context: {
        course: { id: 'plex:675689', title: 'Hoffman Academy' },
        unit: { id: 'season-4', title: 'Unit 4', position: 4 },
        lesson: { id: 'plex:9003', title: 'Lesson 3', position: 3 },
      },
      progress: [
        { scope: 'course', label: 'Course', completed: 34, total: 344 },
        { scope: 'module', label: 'Unit 4', completed: 2, total: 20 },
      ],
    };
    build({
      assignment: { learnerId: 'kid1', programs: [{ programId: 'piano-course', courseId: 'plex:675689', subject: 'arts' }] },
      launchers: new Map([['piano-course', { status: async () => status, locationHint: 'at the piano', mountable: true }]]),
      selfService: { enabled: true },
    });
    const result = await useCase.execute({ learnerId: 'kid1' });
    const offer = offerFor(result, 'arts');
    expect(offer).toMatchObject({ tokenClass: 'subject_next', unitId: 'piano-course:plex:675689' });
    expect(offer.token).toEqual(expect.any(String));
    expect(tokens.ofClass('subject_next')[0].accessCode).toMatch(/^\d{6}$/);
    expect(sectionFor(result, 'arts').next).toMatchObject({
      title: 'Lesson 3', courseId: 'plex:675689', module: 'season-4',
      programContext: status.context,
    });
    const renderedFacts = JSON.stringify(result.document);
    expect(renderedFacts).toContain('Hoffman Academy');
    expect(renderedFacts).toContain('Unit 4');
    expect(renderedFacts).toContain('Lesson 3');
  });

  it('is a valid receipt-target document', async () => {
    const { document } = await useCase.execute({ learnerId: 'kid1' });
    expect(validateDocument(document).errors).toEqual([]);
  });

  it('offers exactly the unlocked work — one scan action per live subject', async () => {
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(result.offers.map((o) => o.subject)).toEqual(['math']);
    expect(actions(result.document)).toHaveLength(1);
  });

  it('labels the action from the unit composition, not the reducer default', async () => {
    // The first move on a video unit is to watch it, not to print a sheet.
    expect(offerFor(await useCase.execute({ learnerId: 'kid1' }), 'math').label).toContain('watch or listen');
  });

  it('carries only opaque tokens — no learner, unit or policy on the paper', async () => {
    const { document } = await useCase.execute({ learnerId: 'kid1' });
    actions(document).forEach((action) => {
      expect(isSchoolToken(action.action)).toBe(true);
      expect(action.action).not.toContain('kid1');
      expect(action.action).not.toContain('math');
    });
  });

  it('prints the remedy line when nothing in the subject is available yet', async () => {
    // Only unit 2 assigned (not unit 1): the sectioned agenda shows ONE next
    // thing per subject, so this only surfaces once nothing else in "math" is
    // in progress or available — unlike v1, where every locked unit printed.
    build({ assignment: { learnerId: 'kid1', units: [WORKSHEET_UNIT] } });
    const result = await useCase.execute({ learnerId: 'kid1' });
    const text = transcript(result.document);
    expect(text).toContain(`Finish “${fixtureUnit(MEDIA_UNIT).title}” first`);
    expect(result.offers).toEqual([]);
    expect(tokens.ofClass('subject_next')).toEqual([]);
  });
});

describe('sessions', () => {
  it('creates one work session for the subject offer, before anything is issued', async () => {
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(result.createdSessions).toEqual(['ses_1']);
    expect(sessions.types('ses_1')).toEqual(['created']);
    expect(sessions.derive('ses_1')).toMatchObject({ learnerId: 'kid1', unitId: MEDIA_UNIT, state: 'created' });
  });

  it('RE-SCANNING THE CARD REUSES THE SESSION — never a second one', async () => {
    const first = await useCase.execute({ learnerId: 'kid1' });
    const second = await useCase.execute({ learnerId: 'kid1' });
    expect(second.createdSessions).toEqual([]);
    expect(offerFor(second, 'math').sessionId).toBe(offerFor(first, 'math').sessionId);
    expect(sessions.ids()).toEqual(['ses_1']);
  });

  it('does not open a session for a locked unit', async () => {
    await useCase.execute({ learnerId: 'kid1' });
    expect(sessions.ids()).toHaveLength(1);
  });
});

describe('Adaptive Study handoff', () => {
  const schoolcalc = {
    mode: 'adaptive_flashcards',
    study: { cardCount: 12, maxExposuresPerCard: 4 },
    quiz: { itemCount: 10 },
  };
  const calculatorUnits = () => rawUnits({
    [MEDIA_UNIT]: { schoolcalc, document: undefined, media: undefined, bank: MEDIA_BANK_ID },
  });

  it('ensures one calculator session and prints its leading-zero code instead of a subject token', async () => {
    const calls = [];
    const study = { studySessionId: 'study_1', code: '001234' };
    build({
      units: calculatorUnits(), schoolCalcMode: 'issue',
      schoolCalcStudies: { ensure: async (input) => { calls.push(input); return study; } },
    });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ workSessionId: 'ses_1', learnerId: 'kid1' });
    expect(tokens.ofClass('subject_next')).toEqual([]);
    expect(result.offers[0]).toMatchObject({
      token: null, tokenClass: 'schoolcalc_study',
      calculator: { studySessionId: 'study_1', code: '001234', displayCode: '001 234' },
    });
    expect(sectionFor(result, 'math').next.schoolcalc).toEqual(schoolcalc);
    expect(sectionFor(result, 'math').next.schoolcalcHandoff.displayCode).toBe('001 234');
    expect(transcript(result.document)).toContain('001 234\nEnter on calculator.');
    expect(actions(result.document)).toEqual([]);
  });

  it('preview performs only the read projection and never ensures or mints', async () => {
    const calls = { preview: 0, ensure: 0 };
    build({
      units: calculatorUnits(), schoolCalcMode: 'preview',
      schoolCalcStudies: {
        preview: async () => { calls.preview += 1; return null; },
        ensure: async () => { calls.ensure += 1; throw new Error('must not issue'); },
      },
    });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(calls).toEqual({ preview: 1, ensure: 0 });
    expect(tokens.ofClass('subject_next')).toEqual([]);
    expect(result.offers[0].calculator).toEqual({ eligible: true });
    expect(transcript(result.document)).toContain('Calculator eligible — code issued when printed.');
  });
});

describe('subject tokens', () => {
  it('mints ONE subject_next token per live subject, registered against learner+subject', async () => {
    const result = await useCase.execute({ learnerId: 'kid1' });
    const minted = tokens.ofClass('subject_next');
    expect(minted).toHaveLength(1);
    expect(minted[0]).toMatchObject({ tokenClass: 'subject_next', subject: { learnerId: 'kid1', subject: 'math' } });
    expect(minted[0].token).toBe(offerFor(result, 'math').token);
    expect(isSchoolToken(minted[0].token)).toBe(true);
  });

  it('gives the subject token a conservative default expiry (168h)', async () => {
    const result = await useCase.execute({ learnerId: 'kid1' });
    const record = await tokens.get(offerFor(result, 'math').token);
    expect(Date.parse(record.expiresAt) - Date.parse(record.issuedAt)).toBe(168 * 3_600_000);
  });

  it('honours a configured subjectTokenTtlHours', async () => {
    const short = new BuildAgenda({
      curriculum, assignments, sessions, tokens,
      clock: clock.now, rng: seededRng(3), newSessionId: sequentialIds('s_'),
      subjectTokenTtlHours: 6, logger: silentLogger,
    });
    const result = await short.execute({ learnerId: 'kid1' });
    const record = await tokens.get(offerFor(result, 'math').token);
    expect(Date.parse(record.expiresAt) - Date.parse(record.issuedAt)).toBe(6 * 3_600_000);
  });

  it('mints a fresh ticket on every reprint, even though the session is reused', async () => {
    const first = await useCase.execute({ learnerId: 'kid1' });
    const second = await useCase.execute({ learnerId: 'kid1' });
    expect(second.offers[0].token).not.toBe(first.offers[0].token);
    expect((await tokens.get(first.offers[0].token)).subject)
      .toEqual((await tokens.get(second.offers[0].token)).subject);
  });

  it('a subject served today mints no fresh token and reports "done today"', async () => {
    const first = await useCase.execute({ learnerId: 'kid1' });
    const sessionId = first.offers[0].sessionId;
    for (const event of [
      { type: 'issued', artifactId: 'art_1' },
      { type: 'submitted', transport: 'paper' },
      { type: 'graded', attemptIds: ['att_1'], percent: 90 },
      { type: 'outcome_recorded', outcomeId: `out:${sessionId}`, result: 'passed' },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await sessions.appendEvent(sessionId, { ...event, sessionId, at: clock.iso() });
    }
    const mintedBefore = tokens.ofClass('subject_next').length;
    const second = await useCase.execute({ learnerId: 'kid1' });
    expect(second.offers).toEqual([]);
    expect(tokens.ofClass('subject_next')).toHaveLength(mintedBefore);
    expect(sectionFor(second, 'math')).toMatchObject({ servedToday: true, next: null });
    expect(transcript(second.document)).toContain('done today');
  });
});

describe('sections', () => {
  it('groups the plan by subject and orders it english < ... < math < ... < language < ... < other', async () => {
    build(withLanguageProgram());
    const result = await useCase.execute({ learnerId: 'kid1' });
    // SUBJECT_IDS order places 'math' well before 'language'; a subject-id
    // insertion order would put 'language' first since it was assigned second.
    expect(result.sections.map((s) => s.subject)).toEqual(['math', 'language']);
  });

  it('a launcher error marks its subject unavailable without touching the rest of the agenda', async () => {
    // No launcher registered for PROGRAM_ID at all: the "missing launcher"
    // branch of the try/catch, exercised the same way an actual throw would be.
    build(withLanguageProgram());
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(sectionFor(result, 'language')).toMatchObject({ programUnavailable: true, next: null });
    expect(transcript(result.document)).toContain('Not answering right now — try it on the Portal.');
    // math is a completely different subject/launcher and must still be offered.
    expect(result.offers.map((o) => o.subject)).toEqual(['math']);
    expect(offerFor(result, 'math')).toBeTruthy();
  });

  it('a launcher that throws degrades the same way as a missing one', async () => {
    build({
      ...withLanguageProgram(),
      launchers: new Map([[PROGRAM_ID, { status: async () => { throw new Error('program offline'); } }]]),
    });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(sectionFor(result, 'language').programUnavailable).toBe(true);
    expect(offerFor(result, 'math')).toBeTruthy();
  });

  // Spec review finding: the offer suffix used to hardcode "on the Portal"
  // for EVERY program entry, including a garage surface program — wrong
  // enough to send a child to the wrong room. The suffix now reads the
  // offering launcher's own `locationHint`.
  it('a program entry composes its offer suffix from the launcher\'s configured locationHint', async () => {
    build({
      ...withLanguageProgram(),
      launchers: new Map([[PROGRAM_ID, {
        status: async () => ({ doneToday: false, progressLabel: null, score: null }),
        locationHint: 'in the garage',
      }]]),
    });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(offerFor(result, 'language').label).toContain('in the garage');
  });

  it('a program launcher with no locationHint gets a generic suffix — never the Portal', async () => {
    build({
      ...withLanguageProgram(),
      launchers: new Map([[PROGRAM_ID, {
        status: async () => ({ doneToday: false, progressLabel: null, score: null }),
        // No locationHint at all — mirrors an unconfigured SurfaceProgramLauncher.
      }]]),
    });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(offerFor(result, 'language').label).toContain('go do this');
    expect(offerFor(result, 'language').label).not.toMatch(/portal/i);
  });
});

describe('progression', () => {
  it('offers the next unit once its predecessor has passed', async () => {
    const first = await useCase.execute({ learnerId: 'kid1' });
    const sessionId = first.offers[0].sessionId;
    for (const event of [
      { type: 'issued', artifactId: 'art_1' },
      { type: 'submitted', transport: 'paper' },
      { type: 'graded', attemptIds: ['att_1'], percent: 90 },
      { type: 'outcome_recorded', outcomeId: `out:${sessionId}`, result: 'passed' },
      { type: 'rewarded', txnId: 'txn_1', amount: 5 },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await sessions.appendEvent(sessionId, { ...event, sessionId, at: clock.iso() });
    }
    // The whole SUBJECT is "served today" the moment any of its units passes
    // (agenda.mjs's servedToday rule) — cross the 4am study-day boundary
    // before re-asking, or the section stays done-for-today with no `next`.
    clock.advanceDays(1);
    const second = await useCase.execute({ learnerId: 'kid1' });
    expect(second.offers.map((o) => o.unitId)).toEqual([WORKSHEET_UNIT]);
    expect(transcript(second.document)).toContain(fixtureUnit(WORKSHEET_UNIT).title);
    expect(second.document.blocks.find((block) => block.type === 'scan_action')).toMatchObject({ presentation: 'lesson', hideCode: true });
  });

  // Unit 01 is media + bank with NO document. The reducer cannot see units, so
  // its `media_completed` next action is hardcoded "print the questions" —
  // which offers a sheet that does not exist and dead-ends the whole course.
  it('offers the ON-SCREEN quiz after the media of a bank-only unit', async () => {
    const first = await useCase.execute({ learnerId: 'kid1' });
    const sessionId = first.offers[0].sessionId;
    for (const event of [
      { type: 'media_dispatched', dispatchId: 'dsp_1', target: 'tv', contentId: 'plex:481203' },
      { type: 'media_completed', verified: 'playhead' },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await sessions.appendEvent(sessionId, { ...event, sessionId, at: clock.iso() });
    }
    const second = await useCase.execute({ learnerId: 'kid1' });
    expect(offerFor(second, 'math').label).toContain('answer on the screen');
    expect(transcript(second.document)).not.toContain('print the questions');
    // Still scannable: the subject ticket is minted regardless of the unit's
    // own composition — that is what makes it sessionless.
    expect(offerFor(second, 'math').token).toBeTruthy();
  });

  it('still offers the SHEET after the media of a unit that has one', async () => {
    // Unit 04 is media + document: watching it releases a printed worksheet,
    // and that wording must not change with the bank-only fix.
    // An open session beats the sequence lock (planner rule), so watching unit
    // 04's audio is enough to make it the offered work.
    const sessionId = 'ses_mixed';
    for (const event of [
      { type: 'created', learnerId: 'kid1', unitId: MIXED_UNIT },
      { type: 'media_dispatched', dispatchId: 'dsp_1', target: 'tv', contentId: 'plex:481203' },
      { type: 'media_completed', verified: 'playhead' },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await sessions.appendEvent(sessionId, { ...event, sessionId, at: clock.iso() });
    }
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(offerFor(result, 'math').label).toContain('print the questions');
  });

  it('offers a mid-flight session the move its state actually allows — still a live ticket', async () => {
    const first = await useCase.execute({ learnerId: 'kid1' });
    const sessionId = first.offers[0].sessionId;
    await sessions.appendEvent(sessionId, {
      type: 'media_dispatched', sessionId, at: clock.iso(),
      dispatchId: 'dsp_1', target: 'tv', contentId: 'plex:481203',
    });
    const second = await useCase.execute({ learnerId: 'kid1' });
    // Mid-play there is nothing unit-level to scan, but the SUBJECT ticket is
    // sessionless and always minted — unlike v1's per-unit token, it does not
    // go null just because the current move is "wait".
    expect(offerFor(second, 'math').token).toBeTruthy();
    expect(offerFor(second, 'math').label).toContain('finish watching');
    expect(transcript(second.document)).toContain(fixtureUnit(MEDIA_UNIT).title);
  });
});

describe('a unit with nothing to scan into (no media, document, or bank)', () => {
  it('still offers a "start this" ticket — the scan must never dead-end', async () => {
    // A unit graded entirely by a grown-up's own judgment (`review`, no
    // bank/document/media) is a legitimate composition — `created` still has
    // to hand out something to scan. The token class itself is now
    // `subject_next` (BuildAgenda no longer mints per-unit classes at all —
    // that decision lives in `nextMove`/`offerSession`, exercised here
    // end-to-end via the label it produces), so this guards the WORDING
    // survives the extraction rather than re-asserting a token class that no
    // longer applies at this layer.
    build({
      units: rawUnits({
        [MEDIA_UNIT]: { media: undefined, bank: undefined, review: 'A grown-up reviews this by hand.' },
      }),
    });
    const result = await useCase.execute({ learnerId: 'kid1' });
    const offer = offerFor(result, 'math');
    expect(offer.token).toBeTruthy();
    expect(offer.tokenClass).toBe('subject_next');
    expect(offer.label).toContain('start this');
  });
});

describe('nothing to do', () => {
  it('says so when a learner has no assignment at all', async () => {
    build({ assignment: null });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(result.sections).toEqual([]);
    expect(result.offers).toEqual([]);
    expect(transcript(result.document)).toContain('Nothing is assigned');
    expect(validateDocument(result.document).errors).toEqual([]);
  });

  it('explains rather than failing when nobody can be identified', async () => {
    const result = await useCase.execute({ learnerId: null });
    expect(result.plan).toBeNull();
    expect(result.sections).toEqual([]);
    expect(sessions.ids()).toEqual([]);
    expect(transcript(result.document)).toContain('Whose card is this?');
    expect(validateDocument(result.document).errors).toEqual([]);
  });

  it('ignores draft units — the promotion boundary reaches the printer', async () => {
    build({
      units: rawUnits({ [MEDIA_UNIT]: { provenance: { source: 'hand-authored', reviewState: 'draft' } } }),
    });
    const result = await useCase.execute({ learnerId: 'kid1' });
    // With unit one unpublished, unit two is the first published unit and is
    // gated by nothing that exists — so it is what gets offered.
    expect(result.offers.map((o) => o.unitId)).toEqual([WORKSHEET_UNIT]);
  });

  it('never offers a completed unit again', async () => {
    const first = await useCase.execute({ learnerId: 'kid1' });
    const sessionId = first.offers[0].sessionId;
    for (const event of [
      { type: 'issued', artifactId: 'art_1' },
      { type: 'submitted', transport: 'paper' },
      { type: 'graded', attemptIds: ['att_1'], percent: 90 },
      { type: 'outcome_recorded', outcomeId: `out:${sessionId}`, result: 'passed' },
      { type: 'rewarded', txnId: 'txn_1', amount: 5 },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await sessions.appendEvent(sessionId, { ...event, sessionId, at: clock.iso() });
    }
    // Cross the study-day boundary so "math" is no longer served-today and the
    // course's next unit (still gated behind WORKSHEET_UNIT, not passed yet)
    // is what actually surfaces — otherwise both assertions below hold
    // vacuously on an empty offers array.
    clock.advanceDays(1);
    const second = await useCase.execute({ learnerId: 'kid1' });
    // WORKSHEET_UNIT (course-next, still gated) — never MEDIA_UNIT again, and
    // never OMR_UNIT, which stays locked behind it.
    expect(second.offers.map((o) => o.unitId)).toEqual([WORKSHEET_UNIT]);
  });
});

/**
 * Spec R7: "Notes for you" — a grown-up's resolved-item notes, printed on
 * the agenda itself, bounded to the current/previous study day so a note
 * never goes stale on the paper.
 */
describe('notes for you (spec R7)', () => {
  const seedNote = async ({ itemId, at, note, questionNumber = null }) => {
    await reviewQueue.enqueue([{
      sessionId: 'ses_review', itemId, learnerId: 'kid1', unitId: WORKSHEET_UNIT, reason: 'free_response',
      given: 'x', prompt: null, questionNumber, rubric: null, enqueuedAt: at,
    }]);
    await reviewQueue.resolve({
      sessionId: 'ses_review', itemId, verdict: 'incorrect', gradedBy: 'parent', note, at,
    });
  };

  it('prints yesterday\'s note and omits a week-old one', async () => {
    await seedNote({ itemId: 'q1', at: '2026-07-26T10:00:00.000Z', note: 'Carry the remainder next time', questionNumber: 2 });
    await seedNote({ itemId: 'q2', at: '2026-07-20T10:00:00.000Z', note: 'This note is a week old', questionNumber: 1 });
    const result = await useCase.execute({ learnerId: 'kid1' });
    const text = transcript(result.document);
    expect(text).toContain('Note: Carry the remainder next time (2)');
    expect(text).not.toContain('week old');
  });

  it('prints a note resolved earlier today', async () => {
    await seedNote({ itemId: 'q1', at: clock.iso(), note: 'Great job today', questionNumber: 4 });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(transcript(result.document)).toContain('Note: Great job today (4)');
  });

  it('carries no NOTES FOR YOU section when nothing is within the window', async () => {
    await seedNote({ itemId: 'q1', at: '2026-07-20T10:00:00.000Z', note: 'Ancient note' });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(transcript(result.document)).not.toContain('NOTES FOR YOU');
  });

  it('carries no NOTES FOR YOU section when nothing was ever resolved', async () => {
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(transcript(result.document)).not.toContain('NOTES FOR YOU');
  });

  it('stays a valid receipt document with notes present', async () => {
    await seedNote({ itemId: 'q1', at: clock.iso(), note: 'Nice recovery' });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(validateDocument(result.document).errors).toEqual([]);
  });

  it('builds fine with no review queue wired at all', async () => {
    useCase = new BuildAgenda({
      curriculum, assignments, sessions, tokens,
      clock: clock.now, rng: seededRng(7), newSessionId: sequentialIds(),
      logger: silentLogger,
    });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(validateDocument(result.document).errors).toEqual([]);
    expect(transcript(result.document)).not.toContain('NOTES FOR YOU');
  });
});

/**
 * Self-service panel codes: a six-digit alias for the subject ticket, minted
 * here and printed on the same paper as the QR, so a child can start their own
 * work without a grown-up and a scanner.
 */
describe('self-service panel codes', () => {
  const subjectRecords = () => tokens.ofClass('subject_next');
  // fakeClock stands at 09:00 UTC on 2026-07-27, and the study day rolls at
  // 4am — so the code dies at 04:00 the next morning while the token keeps its
  // week. Read off `studyDayWindow`, never restated, for the same reason
  // BuildAgenda calls it: one copy of the boundary math.
  const rollover = () => new Date(
    studyDayWindow(clock.epoch(), { timezone: null, boundaryHour: 4 }).endAtMs,
  ).toISOString();

  it('MINTS NOTHING when self-service is off — the receipt is exactly today\'s', async () => {
    build();
    const off = await useCase.execute({ learnerId: 'kid1' });
    const offRecords = subjectRecords();
    expect(offRecords).toHaveLength(1);
    offRecords.forEach((record) => {
      // Not "undefined" — ABSENT. A record with the key at all is a changed record.
      expect(Object.prototype.hasOwnProperty.call(record, 'accessCode')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(record, 'accessCodeExpiresAt')).toBe(false);
    });
    expect(JSON.stringify(off.document)).not.toContain('PANEL CODE');

    // ...and an explicit `enabled: false` is the same document, byte for byte.
    build({ selfService: { enabled: false } });
    const disabled = await useCase.execute({ learnerId: 'kid1' });
    expect(JSON.stringify(disabled.document)).toBe(JSON.stringify(off.document));
  });

  it('gives each subject ticket a code that dies at the next study-day rollover', async () => {
    build({ selfService: { enabled: true } });
    await useCase.execute({ learnerId: 'kid1' });
    const [record] = subjectRecords();
    expect(record.accessCode).toMatch(/^\d{6}$/);
    expect(record.accessCodeExpiresAt).toBe(rollover());
    // The QR keeps its week — two clocks on one record is the whole point.
    expect(Date.parse(record.expiresAt)).toBeGreaterThan(Date.parse(record.accessCodeExpiresAt));
    expect(record.expiresAt).toBe('2026-08-03T09:00:00.000Z');
  });

  it('puts the code on the lesson it opens, so it draws under that QR', async () => {
    build({ selfService: { enabled: true } });
    const result = await useCase.execute({ learnerId: 'kid1' });
    const [record] = subjectRecords();
    // It used to be a loose "PANEL CODE …" line after the card, which the
    // canvas renderer drew adrift below the box; it is now a field on the
    // scan_action, drawn beneath that action's own QR.
    const action = result.document.blocks.find((b) => b.type === 'scan_action');
    expect(action.panelCode).toBe(record.accessCode);
    expect(transcript(result.document)).not.toContain('PANEL CODE');
    expect(validateDocument(result.document).errors).toEqual([]);
  });

  it('never gives two lessons on one agenda the same code', async () => {
    // The draw order per subject is ONE code draw then the token body's 16.
    // Scripting positions 0 and 17 to the same value makes the second subject
    // draw a code the first already took; the local set must reject it.
    const base = seededRng(7);
    const scripted = Object.assign([], { 0: 0.481920, 17: 0.481920, 18: 0.222222 });
    let i = 0;
    const rng = () => { const v = scripted[i] ?? base(); i += 1; return v; };
    build({
      ...withLanguageProgram(),
      launchers: new Map([[PROGRAM_ID, {
        status: async () => ({ doneToday: false, progressLabel: null, score: null }),
        locationHint: 'in the garage',
      }]]),
      selfService: { enabled: true },
      rng,
    });
    await useCase.execute({ learnerId: 'kid1' });
    const codes = subjectRecords().map((r) => r.accessCode);
    expect(codes).toHaveLength(2);
    expect(codes).toContain('481920');
    expect(codes).toContain('222222');
    expect(new Set(codes).size).toBe(2);
  });

  it('never reissues a code that is still live from a previous agenda', async () => {
    // What this seed draws first with nothing in the way — the code that is
    // already sitting on a previous day's paper.
    build({ selfService: { enabled: true } });
    await useCase.execute({ learnerId: 'kid1' });
    const [{ accessCode: alreadyOnPaper }] = subjectRecords();
    expect(alreadyOnPaper).toMatch(/^\d{6}$/);

    // Same seed, same learner, same first draw — but the registry now reports
    // that code as live, so the mint must skip past it. One build, one record,
    // asserted on directly: a `forEach` over a collection that can be empty
    // would pass this test by running no assertions at all.
    const carriedOver = new CodeAwareTokenRegistry();
    carriedOver.liveAccessCodes = async () => new Set([alreadyOnPaper]);
    build({ selfService: { enabled: true }, tokenRegistry: carriedOver });
    await useCase.execute({ learnerId: 'kid1' });

    const records = subjectRecords();
    expect(records).toHaveLength(1);
    expect(records[0].accessCode).toMatch(/^\d{6}$/);
    // The whole cross-day half of the guard: without it the index keeps only
    // the last writer and the earlier record's printed code stops resolving —
    // a child types the code on their paper and opens someone else's lesson.
    expect(records[0].accessCode).not.toBe(alreadyOnPaper);
  });

  // A household that shortens `lifecycle.subjectTokenTtlHours` below a day
  // would push the rollover PAST the token's own expiry, and `createTokenRecord`
  // refuses a code that outlives its token. The agenda must still print.
  it('clamps a code that would outlive a short-lived token rather than failing the print', async () => {
    const warnings = [];
    build({
      selfService: { enabled: true },
      subjectTokenTtlHours: 1,
      logger: { ...silentLogger, warn: (event, data) => warnings.push({ event, data }) },
    });
    const result = await useCase.execute({ learnerId: 'kid1' });
    const [record] = subjectRecords();
    expect(record.expiresAt).toBe('2026-07-27T10:00:00.000Z');
    expect(record.accessCodeExpiresAt).toBe(record.expiresAt);
    expect(validateDocument(result.document).errors).toEqual([]);
    // ...and says which config key did it, so the household can see why.
    const clamp = warnings.find((w) => w.event === 'school.agenda.access-code-clamped');
    expect(clamp).toBeTruthy();
    expect(JSON.stringify(clamp.data)).toContain('subjectTokenTtlHours');
  });

  it('refuses to be constructed against a registry that cannot report its live codes', () => {
    // Without it the within-agenda set is the only guard, and it has never
    // heard of yesterday's codes — so this fails loudly at wiring time rather
    // than quietly reissuing a live code some morning.
    expect(() => new BuildAgenda({
      curriculum, assignments, sessions,
      tokens: { put: async () => {}, get: async () => null },
      selfService: { enabled: true },
      clock: clock.now, rng: seededRng(7), newSessionId: sequentialIds(), logger: silentLogger,
    })).toThrow(/liveAccessCodes/);
  });

  it('refuses to mint against a registry that answers with nothing', async () => {
    // `new Set(undefined)` is an empty set, indistinguishable from "no codes
    // are live" — which would leave the cross-day guard quietly not running.
    const mute = new CodeAwareTokenRegistry();
    mute.liveAccessCodes = async () => undefined;
    build({ selfService: { enabled: true }, tokenRegistry: mute });
    await expect(useCase.execute({ learnerId: 'kid1' })).rejects.toThrow(/liveAccessCodes/);
  });

  it('leaves a calculator subject codeless — there is no token to alias', async () => {
    build({
      units: rawUnits({
        [MEDIA_UNIT]: {
          schoolcalc: { mode: 'adaptive_flashcards', study: { cardCount: 12, maxExposuresPerCard: 4 }, quiz: { itemCount: 10 } },
          document: undefined, media: undefined, bank: MEDIA_BANK_ID,
        },
      }),
      schoolCalcMode: 'issue',
      schoolCalcStudies: { ensure: async () => ({ studySessionId: 'study_1', code: '001234' }) },
      selfService: { enabled: true },
    });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(subjectRecords()).toEqual([]);
    expect(transcript(result.document)).not.toContain('PANEL CODE');
    expect(transcript(result.document)).toContain('Enter on calculator.');
  });
});
