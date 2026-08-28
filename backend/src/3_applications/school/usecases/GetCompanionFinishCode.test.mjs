/**
 * The escape hatch: when the media is broken, a grown-up reads the code out.
 *
 * What these pin is the NARROWNESS of it. Revealing is not satisfying — the
 * record must come out of a reveal saying exactly what it said going in about
 * who listened, because a report that cannot tell "listened" from "was told"
 * is the thing this feature was deliberately built not to produce.
 */
import { describe, it, expect, vi } from 'vitest';
import { GetCompanionFinishCode } from './GetCompanionFinishCode.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';

const HOUSEHOLD = 'kern';
const LESSON = 'cfm-w35-d1-psalms-49-61';

const events = [
  { type: 'created', seq: 1, at: '2026-08-27T14:00:00.000Z', learnerId: 'learner3', unitId: LESSON },
  { type: 'issued', seq: 2, at: '2026-08-27T14:01:00.000Z', artifactId: 'ws-1' },
];

const unsatisfied = () => ({
  schema: 'school.companion-code/v1',
  id: 'cmc_deadbeefdeadbeefdeadbeef',
  householdId: HOUSEHOLD,
  lessonId: LESSON,
  lessonDay: 'w35-aug24',
  code: ['A', 'C', 'E'],
  requireParts: 3,
  createdAt: '2026-08-27T14:01:00.000Z',
  satisfiedAt: null,
  satisfiedBy: null,
  satisfiedVia: null,
  coverage: {},
});

/** A stand-in for the YAML store, holding one record in memory. */
function codeStore(record = unsatisfied()) {
  const held = record ? structuredClone(record) : null;
  const state = { record: held };
  return {
    state,
    keyFor: vi.fn(({ householdId, lessonId, lessonDay }) => {
      if ([householdId, lessonId, lessonDay].some((part) => typeof part !== 'string' || !part.trim())) {
        throw new Error('companion code key requires householdId, lessonId and lessonDay');
      }
      return 'cmc_deadbeefdeadbeefdeadbeef';
    }),
    get: vi.fn(async () => (state.record ? structuredClone(state.record) : null)),
    update: vi.fn(async (id, mutate) => {
      if (!state.record) return null;
      const draft = structuredClone(state.record);
      const returned = mutate(draft);
      state.record = returned === undefined ? draft : returned;
      return structuredClone(state.record);
    }),
  };
}

const unit = (companion = { participation: 'required', enabled: true }) => ({
  unitId: LESSON, title: 'Psalms 49–61', subject: 'Scripture',
  courseId: 'come-follow-me', module: 'w35-aug24', companion,
});

function build({ companionCodes = codeStore(), teacherGate = { assert: vi.fn() }, unitRecord = unit(), logger } = {}) {
  return {
    companionCodes,
    teacherGate,
    useCase: new GetCompanionFinishCode({
      sessions: { readEvents: vi.fn(async () => events) },
      curriculum: { getUnit: vi.fn(async () => unitRecord) },
      companionCodes,
      teacherGate,
      householdId: HOUSEHOLD,
      clock: () => new Date('2026-08-27T15:30:00.000Z'),
      logger: logger ?? { info: vi.fn(), warn: vi.fn() },
    }),
  };
}

describe('GetCompanionFinishCode', () => {
  it('hands a grown-up the code for a companion nobody has satisfied', async () => {
    const { useCase } = build();

    const result = await useCase.execute({ sessionId: 'ses_1', revealedBy: 'kckern', pin: '1234' });

    expect(result).toMatchObject({
      schema: 'school.companion-finish-code/v1',
      sessionId: 'ses_1',
      lessonId: LESSON,
      gated: true,
      available: true,
      finishCode: 'ACE',
      earned: false,
      reason: null,
    });
  });

  it('leaves satisfaction exactly as it found it — a reveal is not a listen', async () => {
    const codes = codeStore();
    const before = structuredClone(codes.state.record);
    const { useCase } = build({ companionCodes: codes });

    await useCase.execute({ sessionId: 'ses_1', revealedBy: 'kckern', pin: '1234' });

    expect(codes.state.record.satisfiedAt).toBeNull();
    expect(codes.state.record.satisfiedBy).toBeNull();
    expect(codes.state.record.satisfiedVia).toBeNull();
    expect(codes.state.record.coverage).toEqual(before.coverage);
    expect(codes.state.record.code).toEqual(before.code);
  });

  it('records the reveal as a teacher action on the record it read', async () => {
    const codes = codeStore();
    const { useCase } = build({ companionCodes: codes });

    await useCase.execute({ sessionId: 'ses_1', revealedBy: 'kckern', pin: '1234' });

    expect(codes.state.record.reveals).toEqual([{
      at: '2026-08-27T15:30:00.000Z', by: 'kckern', sessionId: 'ses_1',
    }]);
  });

  it('says the code was earned when the household actually listened', async () => {
    const codes = codeStore({
      ...unsatisfied(), satisfiedAt: '2026-08-27T14:40:00.000Z', satisfiedBy: 'learner3', satisfiedVia: 'readalong',
    });
    const { useCase } = build({ companionCodes: codes });

    const result = await useCase.execute({ sessionId: 'ses_1', revealedBy: 'kckern', pin: '1234' });

    expect(result).toMatchObject({ earned: true, satisfiedVia: 'readalong', finishCode: 'ACE' });
  });

  it('refuses before it reads anything when the gate says no', async () => {
    const codes = codeStore();
    const teacherGate = { assert: vi.fn(() => { throw new GuestForbiddenError('The teacher PIN is missing or wrong.'); }) };
    const { useCase } = build({ companionCodes: codes, teacherGate });

    await expect(useCase.execute({ sessionId: 'ses_1', revealedBy: 'kckern', pin: 'nope' }))
      .rejects.toThrow(GuestForbiddenError);
    expect(codes.get).not.toHaveBeenCalled();
    expect(codes.update).not.toHaveBeenCalled();
    expect(teacherGate.assert).toHaveBeenCalledWith({
      userId: 'kckern', pin: 'nope', action: 'companion.finish-code.reveal', context: { sessionId: 'ses_1' },
    });
  });

  it('answers cleanly for a lesson with no companion at all', async () => {
    const codes = codeStore();
    const { useCase } = build({ companionCodes: codes, unitRecord: unit({ enabled: false }) });

    const result = await useCase.execute({ sessionId: 'ses_1', revealedBy: 'kckern', pin: '1234' });

    expect(result).toMatchObject({ gated: false, available: false, finishCode: null, reason: 'no-companion' });
    expect(codes.update).not.toHaveBeenCalled();
  });

  it('answers cleanly for an optional companion, which gates nothing', async () => {
    const codes = codeStore();
    const { useCase } = build({ companionCodes: codes, unitRecord: unit({ participation: 'optional' }) });

    const result = await useCase.execute({ sessionId: 'ses_1', revealedBy: 'kckern', pin: '1234' });

    expect(result).toMatchObject({ gated: false, available: false, finishCode: null, reason: 'companion-optional' });
    expect(codes.update).not.toHaveBeenCalled();
  });

  it('says no code exists yet rather than inventing one before the sheet printed', async () => {
    const codes = codeStore(null);
    const { useCase } = build({ companionCodes: codes });

    const result = await useCase.execute({ sessionId: 'ses_1', revealedBy: 'kckern', pin: '1234' });

    expect(result).toMatchObject({ gated: true, available: false, finishCode: null, reason: 'not-issued' });
    expect(codes.update).not.toHaveBeenCalled();
  });

  it('refuses to spell an unusable code as a blank one', async () => {
    const codes = codeStore({ ...unsatisfied(), code: null });
    const { useCase } = build({ companionCodes: codes });

    const result = await useCase.execute({ sessionId: 'ses_1', revealedBy: 'kckern', pin: '1234' });

    expect(result).toMatchObject({ gated: true, available: false, finishCode: null, reason: 'code-unusable' });
    expect(codes.update).not.toHaveBeenCalled();
  });

  it('never writes the letters into the log line that records the reveal', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { useCase } = build({ logger });

    await useCase.execute({ sessionId: 'ses_1', revealedBy: 'kckern', pin: '1234' });

    expect(logger.info).toHaveBeenCalledWith('school.companion-code.revealed', expect.objectContaining({
      sessionId: 'ses_1', lessonId: LESSON, revealedBy: 'kckern', earned: false,
    }));
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('ACE');
  });
});
